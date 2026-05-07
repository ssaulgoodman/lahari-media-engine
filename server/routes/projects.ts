import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  selectAll, selectOne, insertRow, insertMany,
  updateRows, deleteRows, countRows, maxVal,
  selectColumns, getSB, T,
} from '../database.js';
import { saveBuffer, readAsBase64, mimeFromExt, storageUrl, deleteFile } from '../storage.js';
import { findQueueByProjectIds, updateQueueItem } from '../services/supabase.js';
import { transcribeLyrics, detectStructure } from '../services/gemini.js';
import { summarizeMeaning, generateConceptOptions, refineConceptDirection } from '../services/claude.js';
import { logCall, getCalls, buildContextChain } from '../xray.js';

const router = Router();
const paramStr = (val: string | string[]): string => Array.isArray(val) ? val[0] : val;
const parseJson = <T,>(value: any, fallback: T): T => {
  if (!value) return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

// Ownership check for all /:id/* routes — verify user owns the project
router.param('id', async (req, res, next, id) => {
  const projectId = Array.isArray(id) ? id[0] : id;
  const row = await selectOne('projects', { id: projectId });
  if (!row) return res.status(404).json({ error: 'Project not found' });
  if (row.user_id !== req.userId) return res.status(403).json({ error: 'Access denied' });
  next();
});

// Child scoping: verify shotId belongs to a scene in this project
router.param('shotId', async (req, res, next, shotId) => {
  const sid = Array.isArray(shotId) ? shotId[0] : shotId;
  const shot = await selectOne('shots', { id: sid });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });
  const scene = await selectOne('scenes', { id: shot.scene_id });
  if (!scene || scene.project_id !== paramStr(req.params.id)) return res.status(403).json({ error: 'Shot does not belong to this project' });
  next();
});

// Child scoping: verify memberId belongs to this project
router.param('memberId', async (req, res, next, memberId) => {
  const mid = Array.isArray(memberId) ? memberId[0] : memberId;
  const member = await selectOne('cast_members', { id: mid });
  if (!member) return res.status(404).json({ error: 'Cast member not found' });
  if (member.project_id !== paramStr(req.params.id)) return res.status(403).json({ error: 'Cast member does not belong to this project' });
  next();
});

// Child scoping: verify envId belongs to this project
router.param('envId', async (req, res, next, envId) => {
  const eid = Array.isArray(envId) ? envId[0] : envId;
  const env = await selectOne('environments', { id: eid });
  if (!env) return res.status(404).json({ error: 'Environment not found' });
  if (env.project_id !== paramStr(req.params.id)) return res.status(403).json({ error: 'Environment does not belong to this project' });
  next();
});

// Child scoping: verify sceneId belongs to this project
router.param('sceneId', async (req, res, next, sceneId) => {
  const sid = Array.isArray(sceneId) ? sceneId[0] : sceneId;
  const scene = await selectOne('scenes', { id: sid });
  if (!scene) return res.status(404).json({ error: 'Scene not found' });
  if (scene.project_id !== paramStr(req.params.id)) return res.status(403).json({ error: 'Scene does not belong to this project' });
  next();
});

// Multer config: save audio files to storage
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// ─── Fork helper ─────────────────────────────────────────────────────
// Deep-copies a project's DB rows under a new id. Asset file_paths are
// shared (same files on disk) so disk usage stays near-zero. Caller can
// then run destructive operations on the new project while the original
// stays frozen as a snapshot.
const forkProject = async (sourceId: string): Promise<string> => {
  const src: any = await selectOne('projects', { id: sourceId });
  if (!src) throw new Error('Source project not found');

  const newId = uuidv4();
  // Pick a unique title. Strip any trailing " (N)" so repeated forks don't
  // compound ("X (1) (1) (1)"). Then find the next free index by scanning
  // existing titles. Artists can rename from the sidebar afterwards.
  const base = (src.title || 'Untitled').replace(/\s*\(\d+\)\s*$/, '').trim() || 'Untitled';
  // Fetch siblings: title = base OR title LIKE 'base (%)'
  const { data: siblings, error: sibErr } = await getSB()
    .from(T.projects)
    .select('title')
    .or(`title.eq.${base},title.like.${base} (%)`);
  if (sibErr) throw new Error(`DB fork siblings: ${sibErr.message}`);

  const usedIndices = new Set<number>();
  for (const r of (siblings || [])) {
    if (r.title === base) { usedIndices.add(0); continue; }
    const m = r.title.match(/\((\d+)\)\s*$/);
    if (m) usedIndices.add(parseInt(m[1], 10));
  }
  let n = 1;
  while (usedIndices.has(n)) n += 1;
  const newTitle = `${base} (${n})`;

  // Pre-compute remaps so we can rewrite foreign keys.
  const srcCast = await selectAll('cast_members', { project_id: sourceId });
  const srcEnvs = await selectAll('environments', { project_id: sourceId });
  const srcAssets = await selectAll('assets', { project_id: sourceId });
  const srcScenes = await selectAll('scenes', { project_id: sourceId }, { orderBy: 'sort_order' });
  const srcStoryboardVersions = await selectAll('storyboard_versions', { project_id: sourceId });

  const castMap = new Map<string, string>();
  srcCast.forEach(c => castMap.set(c.id, uuidv4()));
  const envMap = new Map<string, string>();
  srcEnvs.forEach(e => envMap.set(e.id, uuidv4()));
  const assetMap = new Map<string, string>();
  srcAssets.forEach(a => assetMap.set(a.id, uuidv4()));
  const sceneMap = new Map<string, string>();
  srcScenes.forEach(s => sceneMap.set(s.id, uuidv4()));
  const shotMap = new Map<string, string>();
  const storyboardVersionMap = new Map<string, string>();
  srcStoryboardVersions.forEach(v => storyboardVersionMap.set(v.id, uuidv4()));

  const remapAsset = (oldId: string | null | undefined) => oldId ? (assetMap.get(oldId) || null) : null;
  const remapStoryboardRefs = (refs: any) => parseJson<any[]>(refs, []).map((ref) => ({
    ...ref,
    assetId: remapAsset(ref.assetId) || ref.assetId,
  }));

  // Project row — copy everything, remap style_asset_id, new id + parent.
  const now = new Date().toISOString();
  await insertRow('projects', {
    id: newId,
    title: newTitle,
    status: src.status,
    audio_path: src.audio_path,
    lyrics: src.lyrics,
    musical_structure: src.musical_structure,
    concept_options: src.concept_options,
    locked_concept: src.locked_concept,
    style_description: src.style_description,
    style_asset_id: remapAsset(src.style_asset_id),
    color_palette: src.color_palette,
    meaning: src.meaning,
    video_mode: src.video_mode,
    image_model: src.image_model,
    target_duration: src.target_duration,
    cost_estimate: src.cost_estimate,
    style_exploration: (() => {
      if (!src.style_exploration) return null;
      // Remap assetId references inside style_exploration JSON
      let se = JSON.parse(src.style_exploration);
      if (se.slots) se.slots = se.slots.map((s: any) => ({ ...s, assetId: remapAsset(s.assetId) || s.assetId }));
      if (se.userSlot?.assetId) se.userSlot = { ...se.userSlot, assetId: remapAsset(se.userSlot.assetId) || se.userSlot.assetId };
      return JSON.stringify(se);
    })(),
    video_model: src.video_model,
    aspect_ratio: src.aspect_ratio,
    video_resolution: src.video_resolution,
    last_script_prompt: src.last_script_prompt,
    last_concept_prompt: src.last_concept_prompt,
    last_write_shots_prompt: src.last_write_shots_prompt,
    style_generation_prompt: src.style_generation_prompt,
    user_id: src.user_id,
    parent_project_id: sourceId,
    created_at: now,
    updated_at: now,
  });

  // Assets — same file_path, new ids.
  if (srcAssets.length > 0) {
    await insertMany('assets', srcAssets.map(a => ({
      id: assetMap.get(a.id),
      project_id: newId,
      category: a.category,
      file_path: a.file_path,
      prompt: a.prompt || null,
      metadata: a.metadata || null,
      created_at: now,
    })));
  }

  // Cast members.
  if (srcCast.length > 0) {
    await insertMany('cast_members', srcCast.map(c => ({
      id: castMap.get(c.id),
      project_id: newId,
      name: c.name,
      description: c.description,
      generation_prompt: c.generation_prompt,
      prompts_stale: c.prompts_stale,
      reference_asset_id: remapAsset(c.reference_asset_id),
      sort_order: c.sort_order,
    })));
  }

  // Environments.
  if (srcEnvs.length > 0) {
    await insertMany('environments', srcEnvs.map(e => ({
      id: envMap.get(e.id),
      project_id: newId,
      name: e.name,
      description: e.description,
      generation_prompt: e.generation_prompt,
      prompts_stale: e.prompts_stale,
      reference_asset_id: remapAsset(e.reference_asset_id),
      sort_order: e.sort_order,
    })));
  }

  // Scenes + shots.
  if (srcScenes.length > 0) {
    await insertMany('scenes', srcScenes.map(s => ({
      id: sceneMap.get(s.id),
      project_id: newId,
      section_label: s.section_label,
      start_time: s.start_time,
      end_time: s.end_time,
      lyrics: s.lyrics,
      narrative_description: s.narrative_description,
      sort_order: s.sort_order,
    })));

    // Gather all shots across all source scenes
    const allShotRows: Record<string, any>[] = [];
    for (const s of srcScenes) {
      const shots = await selectAll('shots', { scene_id: s.id }, { orderBy: 'sort_order' });
      const newSceneId = sceneMap.get(s.id)!;
      for (const shot of shots) {
        const newShotId = uuidv4();
        shotMap.set(shot.id, newShotId);
        let newCastIds = '[]';
        try {
          const ids = JSON.parse(shot.cast_ids || '[]') as string[];
          newCastIds = JSON.stringify(ids.map((id: string) => castMap.get(id) || id).filter(Boolean));
        } catch {}
        allShotRows.push({
          id: newShotId,
          scene_id: newSceneId,
          visual_prompt: shot.visual_prompt,
          motion_prompt: shot.motion_prompt,
          duration: shot.duration,
          cast_ids: newCastIds,
          image_asset_id: remapAsset(shot.image_asset_id),
          video_asset_id: remapAsset(shot.video_asset_id),
          storyboard_asset_id: remapAsset(shot.storyboard_asset_id),
          storyboard_version_id: shot.storyboard_version_id
            ? (storyboardVersionMap.get(shot.storyboard_version_id) || null)
            : null,
          storyboard_status: shot.storyboard_status,
          storyboard_locked: shot.storyboard_locked,
          storyboard_user_feedback: shot.storyboard_user_feedback,
          image_status: shot.image_status,
          video_status: shot.video_status,
          critique: shot.critique,
          attempt_count: shot.attempt_count,
          use_next_as_end_frame: shot.use_next_as_end_frame,
          sort_order: shot.sort_order,
          end_image_asset_id: remapAsset(shot.end_image_asset_id),
          end_image_status: shot.end_image_status,
          locked: shot.locked,
          user_feedback: shot.user_feedback,
          environment_id: shot.environment_id ? (envMap.get(shot.environment_id) || null) : null,
          extracted_last_frame_asset_id: remapAsset(shot.extracted_last_frame_asset_id),
          continuity_description: shot.continuity_description,
          continuity_from: shot.continuity_from,
          end_visual_prompt: shot.end_visual_prompt,
          end_user_feedback: shot.end_user_feedback,
          prompts_stale: shot.prompts_stale,
          refined_from_prev_frame: shot.refined_from_prev_frame,
        });
      }
    }
    if (allShotRows.length > 0) {
      await insertMany('shots', allShotRows);
    }

    const storyboardVersionRows = srcStoryboardVersions
      .map((version: any) => {
        const newShotId = shotMap.get(version.shot_id);
        const newAssetId = remapAsset(version.asset_id);
        if (!newShotId || !newAssetId) return null;
        return {
          id: storyboardVersionMap.get(version.id),
          project_id: newId,
          shot_id: newShotId,
          asset_id: newAssetId,
          parent_version_id: version.parent_version_id
            ? (storyboardVersionMap.get(version.parent_version_id) || null)
            : null,
          openai_response_id: version.openai_response_id,
          openai_image_call_ids: version.openai_image_call_ids,
          reasoning_model: version.reasoning_model,
          image_model: version.image_model,
          prompt: version.prompt,
          artist_note: version.artist_note,
          refs: remapStoryboardRefs(version.refs),
          metadata: version.metadata,
          locked: version.locked,
          created_at: version.created_at,
        };
      })
      .filter(Boolean);
    if (storyboardVersionRows.length > 0) {
      await insertMany('storyboard_versions', storyboardVersionRows as any[]);
    }
  }

  // Note: chat_messages and ai_calls are NOT copied — those belong to the original
  // project's history. The fork starts with a clean audit log.

  return newId;
};

export { forkProject };

// ─── Helper: build full project response ────────────────────────────

const getFullProject = async (projectId: string) => {
  // Parallel fetch: project + cast + environments + scenes + chat — 5 queries instead of serial
  const [project, cast, environments, scenes, chatMessages] = await Promise.all([
    selectOne('projects', { id: projectId }),
    selectAll('cast_members', { project_id: projectId }, { orderBy: 'sort_order' }),
    selectAll('environments', { project_id: projectId }, { orderBy: 'sort_order' }),
    selectAll('scenes', { project_id: projectId }, { orderBy: 'sort_order' }),
    selectColumns('chat_messages', 'role, text', { project_id: projectId }, { orderBy: 'id' }),
  ]) as [any, any[], any[], any[], any[]];
  if (!project) return null;

  // Fetch ALL shots for this project's scenes in one query (not N queries per scene)
  const sceneIds = scenes.map((s: any) => s.id);
  const allShots = sceneIds.length > 0
    ? await selectAll('shots', { scene_id: sceneIds }, { orderBy: 'sort_order' })
    : [];

  // Collect every asset ID we need to resolve — one bulk fetch instead of N+1
  const assetIds = new Set<string>();
  for (const shot of allShots) {
    if (shot.image_asset_id) assetIds.add(shot.image_asset_id);
    if (shot.end_image_asset_id) assetIds.add(shot.end_image_asset_id);
    if (shot.extracted_last_frame_asset_id) assetIds.add(shot.extracted_last_frame_asset_id);
    if (shot.video_asset_id) assetIds.add(shot.video_asset_id);
    if (shot.storyboard_asset_id) assetIds.add(shot.storyboard_asset_id);
  }
  for (const c of cast) { if (c.reference_asset_id) assetIds.add(c.reference_asset_id); }
  for (const e of environments) { if (e.reference_asset_id) assetIds.add(e.reference_asset_id); }
  if (project.style_asset_id) assetIds.add(project.style_asset_id);

  // Single bulk asset fetch — replaces 80+ individual selectOne calls
  const assetMap = new Map<string, any>();
  if (assetIds.size > 0) {
    const assets = await selectAll('assets', { id: [...assetIds] });
    for (const a of assets) assetMap.set(a.id, a);
  }

  // Fetch shot-level uploaded refs (not tracked by ID on shot row)
  const shotIds = allShots.map((s: any) => s.id);
  const shotRefAssets = shotIds.length > 0
    ? (await getSB().from(T.assets).select('id, shot_id, file_path').eq('category', 'shot_ref').in('shot_id', shotIds).then(r => r.data || []))
    : [];
  const shotRefsByShot = new Map<string, { id: string; url: string }[]>();
  for (const ref of shotRefAssets) {
    const arr = shotRefsByShot.get(ref.shot_id) || [];
    arr.push({ id: ref.id, url: storageUrl(ref.file_path) });
    shotRefsByShot.set(ref.shot_id, arr);
  }

  const resolveUrl = (id: string | null | undefined) => {
    if (!id) return undefined;
    const a = assetMap.get(id);
    return a ? storageUrl(a.file_path) : undefined;
  };

  // Group shots by scene
  const shotsByScene = new Map<string, any[]>();
  for (const shot of allShots) {
    const arr = shotsByScene.get(shot.scene_id) || [];
    arr.push(shot);
    shotsByScene.set(shot.scene_id, arr);
  }

  for (const scene of scenes) {
    scene.shots = shotsByScene.get(scene.id) || [];
    for (const shot of scene.shots as any[]) {
      shot.imageUrl = resolveUrl(shot.image_asset_id);
      shot.endImageUrl = resolveUrl(shot.end_image_asset_id);
      shot.extractedLastFrameUrl = resolveUrl(shot.extracted_last_frame_asset_id);
      shot.videoUrl = resolveUrl(shot.video_asset_id);
      shot.storyboardUrl = resolveUrl(shot.storyboard_asset_id);
      shot.castIds = JSON.parse(shot.cast_ids || '[]');
      shot.critique = shot.critique ? JSON.parse(shot.critique) : undefined;
      shot.refImages = shotRefsByShot.get(shot.id) || [];
    }
  }

  // Resolve cast + env + style from the same asset map
  for (const member of cast as any[]) {
    member.referenceImageUrl = resolveUrl(member.reference_asset_id);
  }
  for (const env of environments) {
    env.referenceImageUrl = resolveUrl(env.reference_asset_id);
  }
  const styleAssetUrl = resolveUrl(project.style_asset_id);

  return {
    id: project.id,
    title: project.title,
    status: project.status,
    audioPath: project.audio_path ? storageUrl(project.audio_path) : null,
    lyrics: project.lyrics,
    meaning: project.meaning,
    musicalStructure: project.musical_structure ? JSON.parse(project.musical_structure) : [],
    songType: project.song_type || null,
    isNarrative: project.is_narrative ?? null,
    isMeditative: project.is_meditative ?? null,
    analysisStep: project.analysis_step || null,
    conceptOptions: project.concept_options ? JSON.parse(project.concept_options) : [],
    lockedConcept: project.locked_concept ? JSON.parse(project.locked_concept) : null,
    styleDescription: project.style_description,
    styleAssetUrl,
    styleGenerationPrompt: project.style_generation_prompt || undefined,
    styleExploration: (() => {
      if (!project.style_exploration) return null;
      const se = JSON.parse(project.style_exploration);
      // Fix legacy /storage/ paths → full Supabase URLs
      const fixUrl = (url?: string) => {
        if (!url) return url;
        if (url.startsWith('/storage/')) return storageUrl(url.replace('/storage/', ''));
        return url;
      };
      if (se.slots) se.slots = se.slots.map((s: any) => ({ ...s, imageUrl: fixUrl(s.imageUrl) }));
      if (se.userSlot) se.userSlot = { ...se.userSlot, imageUrl: fixUrl(se.userSlot.imageUrl) };
      return se;
    })(),
    colorPalette: project.color_palette,
    videoMode: project.video_mode,
    imageModel: project.image_model || 'nano-banana-2',
    videoModel: project.video_model || 'veo-3.1',
    aspectRatio: project.aspect_ratio || '16:9',
    videoResolution: project.video_resolution || '720p',
    lastScriptPrompt: project.last_script_prompt || undefined,
    lastConceptPrompt: project.last_concept_prompt || undefined,
    lastWriteShotsPrompt: project.last_write_shots_prompt || undefined,
    parentProjectId: project.parent_project_id || undefined,
    cast: cast.map((c: any) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      generationPrompt: c.generation_prompt || undefined,
      promptsStale: !!c.prompts_stale,
      referenceAssetId: c.reference_asset_id,
      referenceImageUrl: c.referenceImageUrl,
    })),
    environments: environments.map((e: any) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      generationPrompt: e.generation_prompt || undefined,
      promptsStale: !!e.prompts_stale,
      referenceAssetId: e.reference_asset_id,
      referenceImageUrl: e.referenceImageUrl,
    })),
    scenes: scenes.map((s: any) => ({
      id: s.id,
      sectionLabel: s.section_label,
      startTime: s.start_time,
      endTime: s.end_time,
      lyrics: s.lyrics || '',
      narrativeDescription: s.narrative_description || '',
      shots: (s.shots || []).map((shot: any) => ({
        id: shot.id,
        visualPrompt: shot.visual_prompt || '',
        motionPrompt: shot.motion_prompt || 'Cinematic camera movement',
        duration: shot.duration,
        castIds: shot.castIds || [],
        imageUrl: shot.imageUrl,
        endImageUrl: shot.endImageUrl,
        extractedLastFrameUrl: shot.extractedLastFrameUrl,
        storyboardUrl: shot.storyboardUrl,
        storyboardAssetId: shot.storyboard_asset_id || undefined,
        storyboardVersionId: shot.storyboard_version_id || undefined,
        storyboardStatus: shot.storyboard_status || 'idle',
        storyboardLocked: !!shot.storyboard_locked,
        storyboardUserFeedback: shot.storyboard_user_feedback || undefined,
        continuityFrom: shot.continuity_from || 'cut',
        refinedFromPrevFrame: !!shot.refined_from_prev_frame,
        endImageStatus: shot.end_image_status || 'idle',
        endVisualPrompt: shot.end_visual_prompt || undefined,
        endUserFeedback: shot.end_user_feedback || undefined,
        locked: !!shot.locked,
        userFeedback: shot.user_feedback || undefined,
        environmentId: shot.environment_id || undefined,
        videoUrl: shot.videoUrl,
        imageStatus: shot.image_status,
        videoStatus: shot.video_status,
        critique: shot.critique,
        attemptCount: shot.attempt_count,
        promptsStale: !!shot.prompts_stale,
        useNextAsEndFrame: !!shot.use_next_as_end_frame,
        lastError: shot.last_error || undefined,
      }))
    })),
    chatHistory: chatMessages,
    targetDuration: project.target_duration,
    costEstimate: project.cost_estimate,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
};

// ─── Routes ─────────────────────────────────────────────────────────

// List all projects
router.get('/', async (req, res) => {
  const rows = await selectColumns(
    'projects',
    'id, title, status, created_at, updated_at, parent_project_id',
    { user_id: req.userId },
    { orderBy: 'created_at', ascending: false }
  );

  // One extra query: count final_render assets per project so the sidebar can
  // show "Renders (N)" without N round-trips.
  const ids = rows.map((r: any) => r.id);
  const renderCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: assetRows, error } = await getSB()
      .from(T.assets)
      .select('project_id')
      .eq('category', 'final_render')
      .in('project_id', ids);
    if (error) throw new Error(`DB select assets: ${error.message}`);
    for (const a of (assetRows as any[]) || []) {
      renderCounts.set(a.project_id, (renderCounts.get(a.project_id) || 0) + 1);
    }
  }

  res.json(rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    parentProjectId: r.parent_project_id || undefined,
    renderCount: renderCounts.get(r.id) || 0,
  })));
});

// Get single project (full state)
router.get('/:id', async (req, res) => {
  const project = await getFullProject(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// Create project + upload audio + run analysis
router.post('/', upload.single('audio'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Audio file required' });

  const projectId = uuidv4();
  const ext = path.extname(file.originalname).slice(1) || 'mp3';
  const audioPath = await saveBuffer(file.buffer, 'audio', ext);
  const title = req.body.title || file.originalname.replace(/\.[^/.]+$/, '');
  const language = req.body.language || undefined;
  const context = req.body.context || undefined;

  // Create project in DB
  await insertRow('projects', {
    id: projectId,
    title,
    status: 'analyzing',
    audio_path: audioPath,
    image_model: 'nano-banana-2',
    user_id: req.userId,
  });

  // Run analysis (synchronous for simplicity — client shows spinner)
  try {
    const audioBase64 = await readAsBase64(audioPath);
    const audioMime = mimeFromExt(audioPath);
    const audioRef = [{ type: 'audio' as const, label: 'Uploaded audio', url: storageUrl(audioPath) }];

    // Phase 1a: parallel lyrics + structure (audio analysis via Gemini)
    console.log(`[${projectId}] Analyzing: lyrics + structure...`);
    const t0Phase1 = Date.now();
    const [lyricsResult, structureResult] = await Promise.allSettled([
      transcribeLyrics(audioBase64, audioMime, language),
      detectStructure(audioBase64, audioMime),
    ]);
    const phase1Duration = Date.now() - t0Phase1;

    const lyrics = lyricsResult.status === 'fulfilled' ? lyricsResult.value : '';
    const structureData = structureResult.status === 'fulfilled' ? structureResult.value : { sections: [], songType: 'unknown', isNarrative: false, isMeditative: false };
    const musicalStructure = Array.isArray(structureData) ? structureData : structureData.sections;
    const songType = Array.isArray(structureData) ? 'unknown' : (structureData.songType || 'unknown');
    const isNarrative = Array.isArray(structureData) ? false : (structureData.isNarrative ?? false);
    const isMeditative = Array.isArray(structureData) ? false : (structureData.isMeditative ?? false);

    if (lyricsResult.status === 'rejected') console.warn('[lyrics] Failed:', lyricsResult.reason);
    if (structureResult.status === 'rejected') console.warn('[structure] Failed:', structureResult.reason);

    logCall({
      projectId,
      stage: 'transcribe-lyrics',
      model: 'gemini-3-pro-preview',
      prompt: `Transcribe the lyrics of this audio.\nLanguage: ${language || 'Detect automatically'}.\nFormat: [timestamp] lyrics — original language only, no translations.`,
      referenceInputs: audioRef,
      responseSummary: lyricsResult.status === 'fulfilled' ? lyrics : 'FAILED',
      durationMs: phase1Duration,
      costEstimate: 0.01,
      error: lyricsResult.status === 'rejected' ? String(lyricsResult.reason) : undefined,
    });

    logCall({
      projectId,
      stage: 'detect-structure',
      model: 'gemini-3-pro-preview',
      prompt: 'Identify musical sections: label, startTime, endTime, energy level, description. Max 10 sections.',
      referenceInputs: audioRef,
      responseSummary: structureResult.status === 'fulfilled'
        ? musicalStructure.map((s: any) => `${s.label} [${s.startTime}–${s.endTime}] ${s.energyLevel || ''} ${s.description || ''}`).join('\n')
        : 'FAILED',
      durationMs: phase1Duration,
      costEstimate: 0.01,
      error: structureResult.status === 'rejected' ? String(structureResult.reason) : undefined,
    });

    // Phase 1b: meaning summary (Claude Sonnet, text-only — needs lyrics)
    let meaning = '';
    if (lyrics) {
      console.log(`[${projectId}] Summarizing meaning (Claude Sonnet)...`);
      const t0Meaning = Date.now();
      try {
        meaning = await summarizeMeaning(title, language || 'Unknown', lyrics, context);
      } catch (err: any) {
        console.warn('[meaning] Failed:', err.message);
      }
      logCall({
        projectId,
        stage: 'summarize-meaning',
        model: 'claude-sonnet-4-6',
        prompt: `Summarize the meaning of "${title}": what it's about, who it addresses, emotional arc, cultural context.`,
        responseSummary: meaning || 'FAILED',
        durationMs: Date.now() - t0Meaning,
        costEstimate: 0.005,
      });
    }

    // Save to DB — analysis only (concepts generated separately)
    await updateRows('projects', { id: projectId }, {
      status: 'analyzed',
      lyrics,
      musical_structure: JSON.stringify(musicalStructure),
      song_type: songType,
      is_narrative: isNarrative,
      is_meditative: isMeditative,
      meaning,
      updated_at: new Date().toISOString(),
    });

    res.json(await getFullProject(projectId));
  } catch (err: any) {
    console.error(`[${projectId}] Analysis failed:`, err);
    await updateRows('projects', { id: projectId }, { status: 'error', updated_at: new Date().toISOString() });
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

// Generate concept options (separate from analysis)
router.post('/:id/generate-concepts', async (req, res) => {
  const project: any = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const lyrics = req.body.lyrics ?? project.lyrics ?? '';
  const context = req.body.context || undefined;
  const userNote = req.body.userNote || undefined;
  const directorBrief = req.body.directorBrief || undefined;
  const title = project.title;
  const language = req.body.language || undefined;
  const musicalStructure = project.musical_structure ? JSON.parse(project.musical_structure) : [];

  // If user edited lyrics, save them
  if (req.body.lyrics && req.body.lyrics !== project.lyrics) {
    await updateRows('projects', { id: paramStr(req.params.id) }, { lyrics: req.body.lyrics, updated_at: new Date().toISOString() });
  }

  try {
    console.log(`[${project.id}] Generating concept${directorBrief ? ' from director brief' : ' options'}${userNote ? ` with note: ${userNote}` : ''}...`);
    const t0 = Date.now();
    const meaning = project.meaning || '';
    const result = await generateConceptOptions(title, language || 'Unknown', lyrics, meaning, musicalStructure, context, userNote, directorBrief, project.song_type || undefined, project.is_narrative ?? undefined, project.is_meditative ?? undefined);
    const conceptOptions = result.concepts;
    const durationMs = Date.now() - t0;

    // Cache prompt for transparency
    await updateRows('projects', { id: paramStr(req.params.id) }, { last_concept_prompt: result.prompt });

    logCall({
      projectId: project.id,
      stage: 'generate-concepts',
      model: 'claude-opus-4-7',
      prompt: `Generate EXACTLY 3 creative concept directions for "${title}"${language ? ` (${language})` : ''}${context ? ` — Context: ${context}` : ''}\n\nLyrics:\n${lyrics}\n\nStructure:\n${musicalStructure.map((s: any) => `${s.label} [${s.startTime}–${s.endTime}]`).join(', ')}`,
      responseSummary: conceptOptions.map((c: any, i: number) =>
        `[${i + 1}] ${c.conceptDirection} — ${c.mood} / ${c.visualSuggestions?.artStyle || 'N/A'} / ${c.visualSuggestions?.colorPalette || 'N/A'}\n    Theme: ${c.theme}`
      ).join('\n'),
      durationMs,
      costEstimate: 0.01,
    });

    await updateRows('projects', { id: paramStr(req.params.id) }, {
      concept_options: JSON.stringify(conceptOptions),
      updated_at: new Date().toISOString(),
    });

    res.json(await getFullProject(paramStr(req.params.id)));
  } catch (err: any) {
    console.error(`[${project.id}] Concept generation failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'generate-concepts',
      model: 'claude-opus-4-7',
      prompt: `Generate concepts for "${title}"`,
      durationMs: 0,
      error: err.message,
    });
    res.status(500).json({ error: err.message || 'Concept generation failed' });
  }
});

// Lock concept choice
router.post('/:id/lock-concept', async (req, res) => {
  const { conceptIndex, fork } = req.body;
  const sourceId = paramStr(req.params.id);
  const srcProject: any = await selectOne('projects', { id: sourceId });
  if (!srcProject) return res.status(404).json({ error: 'Project not found' });

  const options = JSON.parse(srcProject.concept_options || '[]');
  if (conceptIndex < 0 || conceptIndex >= options.length) {
    return res.status(400).json({ error: 'Invalid concept index' });
  }
  const chosen = options[conceptIndex];

  // Destructive case: the user is switching AWAY from a previously locked
  // concept and downstream work (scenes/style/cast/env) was built around
  // the old one. That downstream work is now semantically invalid, so wipe
  // it. If fork=true, do all of this on a new fork, leaving the original
  // frozen as a snapshot.
  const prevLocked = srcProject.locked_concept ? JSON.parse(srcProject.locked_concept) : null;
  const switching = prevLocked && JSON.stringify(prevLocked) !== JSON.stringify(chosen);
  const sceneCount = await countRows('scenes', { project_id: sourceId });
  const needsWipe = switching && sceneCount > 0;

  const projectId = fork === true ? await forkProject(sourceId) : sourceId;

  if (needsWipe) {
    // Delete scenes — shots will be orphaned but scenes own the relationship.
    // First get scene ids to delete their shots.
    const scenesToDelete = await selectColumns('scenes', 'id', { project_id: projectId });
    for (const s of scenesToDelete) {
      await deleteRows('shots', { scene_id: s.id });
    }
    await deleteRows('scenes', { project_id: projectId });
    await deleteRows('cast_members', { project_id: projectId });
    await deleteRows('environments', { project_id: projectId });
    await updateRows('projects', { id: projectId }, {
      style_asset_id: null,
      style_description: null,
      style_exploration: null,
      last_script_prompt: null,
      last_write_shots_prompt: null,
    });
  }

  await updateRows('projects', { id: projectId }, {
    status: 'concept_locked',
    locked_concept: JSON.stringify(chosen),
    updated_at: new Date().toISOString(),
  });

  res.json(await getFullProject(projectId));
});

// Unlock concept — pure navigation: reveal the concept options grid
// without touching anything downstream. locked_concept stays so we know
// what was previously chosen. The cascade-wipe only triggers if the user
// then picks a DIFFERENT concept via /lock-concept (see that endpoint).
router.post('/:id/unlock-concept', async (req, res) => {
  const projectId = paramStr(req.params.id);
  await updateRows('projects', { id: projectId }, { status: 'analyzed', updated_at: new Date().toISOString() });
  res.json({ ok: true, status: 'analyzed' });
});

// Refine locked concept — Claude rewrites fields based on feedback. Non-destructive (no wipe).
router.post('/:id/refine-concept', async (req, res) => {
  const { feedback } = req.body;
  if (!feedback?.trim()) return res.status(400).json({ error: 'Feedback required' });

  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.locked_concept) return res.status(400).json({ error: 'No locked concept to refine' });

  const current = JSON.parse(project.locked_concept);

  try {
    const projectId = paramStr(req.params.id);
    const refined = await refineConceptDirection(current, feedback);
    await updateRows('projects', { id: projectId }, {
      locked_concept: JSON.stringify(refined),
      updated_at: new Date().toISOString(),
    });
    // Concept change invalidates all downstream — script was built from old concept
    const scenes = await selectAll('scenes', { project_id: projectId });
    for (const s of scenes) {
      await updateRows('shots', { scene_id: s.id }, { prompts_stale: true });
    }
    res.json(await getFullProject(projectId));
  } catch (err: any) {
    res.status(500).json({ error: `Concept refinement failed: ${err.message}` });
  }
});

// Update locked concept fields directly — artist edits inline. Non-destructive.
router.patch('/:id/concept', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.locked_concept) return res.status(400).json({ error: 'No locked concept to update' });

  const current = JSON.parse(project.locked_concept);
  const updates = req.body;
  const merged = { ...current, ...updates };
  if (updates.visualSuggestions) {
    merged.visualSuggestions = { ...current.visualSuggestions, ...updates.visualSuggestions };
  }

  await updateRows('projects', { id: projectId }, {
    locked_concept: JSON.stringify(merged),
    updated_at: new Date().toISOString(),
  });
  // Concept change invalidates downstream shots
  const scenes = await selectAll('scenes', { project_id: projectId });
  for (const s of scenes) {
    await updateRows('shots', { scene_id: s.id }, { prompts_stale: true });
  }
  res.json({ ok: true });
});

// Update project settings
router.patch('/:id', async (req, res) => {
  const { title, videoMode, targetDuration, styleDescription, colorPalette, imageModel, videoModel, aspectRatio, videoResolution } = req.body;
  const updates: Record<string, any> = {};

  if (title !== undefined) updates.title = title;
  if (videoMode !== undefined) updates.video_mode = videoMode;
  if (imageModel !== undefined) updates.image_model = imageModel;
  if (videoModel !== undefined) updates.video_model = videoModel;
  if (aspectRatio !== undefined) updates.aspect_ratio = aspectRatio;
  if (videoResolution !== undefined) updates.video_resolution = videoResolution;
  if (targetDuration !== undefined) updates.target_duration = targetDuration;
  if (styleDescription !== undefined) updates.style_description = styleDescription;
  if (colorPalette !== undefined) updates.color_palette = colorPalette;
  if (req.body.styleExploration !== undefined) updates.style_exploration = JSON.stringify(req.body.styleExploration);
  if (req.body.styleGenerationPrompt !== undefined) updates.style_generation_prompt = req.body.styleGenerationPrompt || null;

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

  updates.updated_at = new Date().toISOString();
  const projectId = paramStr(req.params.id);
  await updateRows('projects', { id: projectId }, updates);

  // Staleness propagation: style_description change invalidates all downstream generation_prompts
  if (styleDescription !== undefined) {
    await updateRows('cast_members', { project_id: projectId }, { prompts_stale: true });
    await updateRows('environments', { project_id: projectId }, { prompts_stale: true });
    // Shots are also stale because visual style changes can invalidate prompts and media.
    const scenes = await selectAll('scenes', { project_id: projectId });
    for (const s of scenes) {
      await updateRows('shots', { scene_id: s.id }, { prompts_stale: true });
    }
  }

  res.json({ ok: true });
});

// Delete project — also resets the linked queue item back to 'queued'
router.delete('/:id', async (req, res) => {
  const projectId = paramStr(req.params.id);

  // Walk fork chain to find the queue row (same logic as publish)
  const chain: string[] = [projectId];
  let cur = projectId;
  while (true) {
    const row = await selectOne('projects', { id: cur });
    if (!row?.parent_project_id) break;
    chain.push(row.parent_project_id);
    cur = row.parent_project_id;
  }

  await deleteRows('projects', { id: projectId });

  // Reset queue item if this was the linked project
  const queueRow = await findQueueByProjectIds(chain);
  if (queueRow && queueRow.lahari_project_id === projectId) {
    await updateQueueItem(queueRow.id, {
      status: 'queued',
      lahari_project_id: null as any,
    });
  }

  res.json({ ok: true });
});

// Fork — deep-copy a project as a new one. Used before destructive ops
// so the original stays frozen as a snapshot.
router.post('/:id/fork', async (req, res) => {
  try {
    const newId = await forkProject(paramStr(req.params.id));
    res.json(await getFullProject(newId));
  } catch (err: any) {
    console.error('[fork] failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Re-run audio analysis for an existing project — useful for projects that
// were created before queue /start ran the full analysis pipeline.
// Pass { fork: true } in the body to fork first and run on the new project,
// leaving the original's analysis (and any downstream work) untouched.
router.post('/:id/analyze-audio', async (req, res) => {
  const sourceId = paramStr(req.params.id);
  const projectId = req.body?.fork === true ? await forkProject(sourceId) : sourceId;
  const project: any = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.audio_path) return res.status(400).json({ error: 'No audio file on this project' });

  try {
    const audioBase64 = await readAsBase64(project.audio_path);
    const audioMime = mimeFromExt(project.audio_path);
    const audioRef = [{ type: 'audio' as const, label: 'Project audio', url: storageUrl(project.audio_path) }];
    const t0 = Date.now();

    // Step 1: Transcribe lyrics (if missing) + detect structure — in parallel
    const needsLyrics = !project.lyrics;
    const [lyricsResult, structureResult] = await Promise.allSettled([
      needsLyrics ? transcribeLyrics(audioBase64, audioMime) : Promise.resolve(project.lyrics as string),
      detectStructure(audioBase64, audioMime),
    ]);

    const lyrics = lyricsResult.status === 'fulfilled' ? lyricsResult.value : '';
    const structureData2 = structureResult.status === 'fulfilled' ? structureResult.value : { sections: [], songType: 'unknown', isNarrative: false, isMeditative: false };
    const musicalStructure = Array.isArray(structureData2) ? structureData2 : structureData2.sections;
    const songType2 = Array.isArray(structureData2) ? 'unknown' : (structureData2.songType || 'unknown');
    const isNarrative2 = Array.isArray(structureData2) ? false : (structureData2.isNarrative ?? false);
    const isMeditative2 = Array.isArray(structureData2) ? false : (structureData2.isMeditative ?? false);

    if (lyricsResult.status === 'rejected') console.warn(`[${projectId}] lyrics transcription failed:`, lyricsResult.reason);
    if (structureResult.status === 'rejected') console.warn(`[${projectId}] structure failed:`, structureResult.reason);

    // Step 2: Meaning — requires lyrics, so runs after step 1
    let meaning = project.meaning || '';
    let meaningError: string | undefined;
    if (lyrics && !project.meaning) {
      try {
        meaning = await summarizeMeaning(project.title || 'Untitled', 'Unknown', lyrics, '');
      } catch (e: any) {
        console.warn(`[${projectId}] meaning failed:`, e);
        meaningError = String(e);
      }
    }
    const analysisMs = Date.now() - t0;

    // Log AI calls
    if (needsLyrics) {
      logCall({
        projectId,
        stage: 'transcribe',
        model: 'gemini-3-pro-preview',
        prompt: 'Transcribe lyrics from audio with timestamps.',
        referenceInputs: audioRef,
        responseSummary: lyrics ? `${lyrics.split('\n').length} lines` : 'FAILED',
        durationMs: analysisMs,
        costEstimate: 0.01,
        error: lyricsResult.status === 'rejected' ? String(lyricsResult.reason) : undefined,
      });
    }
    logCall({
      projectId,
      stage: 'detect-structure',
      model: 'gemini-3-pro-preview',
      prompt: 'Re-run: identify musical sections (label, startTime, endTime, energyLevel, description).',
      referenceInputs: audioRef,
      responseSummary: structureResult.status === 'fulfilled'
        ? musicalStructure.map((s: any) => `${s.label} [${s.startTime}–${s.endTime}]`).join('\n')
        : 'FAILED',
      durationMs: analysisMs,
      costEstimate: 0.01,
      error: structureResult.status === 'rejected' ? String(structureResult.reason) : undefined,
    });
    if (lyrics) {
      logCall({
        projectId,
        stage: 'summarize-meaning',
        model: 'claude-sonnet-4-6',
        prompt: `Summarize meaning of "${project.title}".`,
        responseSummary: meaning || 'FAILED',
        durationMs: analysisMs,
        costEstimate: 0.005,
        error: meaningError,
      });
    }

    // Conditional status update: only move to 'analyzed' if currently 'uploaded' or 'analyzing'
    const statusUpdate: Record<string, any> = {
      musical_structure: JSON.stringify(musicalStructure),
      song_type: songType2,
      is_narrative: isNarrative2,
      is_meditative: isMeditative2,
      meaning,
      updated_at: new Date().toISOString(),
    };
    if (lyrics && needsLyrics) statusUpdate.lyrics = lyrics;
    if (project.status === 'uploaded' || project.status === 'analyzing') {
      statusUpdate.status = 'analyzed';
    }
    await updateRows('projects', { id: projectId }, statusUpdate);

    res.json(await getFullProject(projectId));
  } catch (err: any) {
    console.error(`[${projectId}] re-analysis failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Cast Management ────────────────────────────────────────────────

router.post('/:id/cast', async (req, res) => {
  const { name, description } = req.body;
  const memberId = uuidv4();
  const maxOrder = await maxVal('cast_members', 'sort_order', { project_id: paramStr(req.params.id) });
  await insertRow('cast_members', {
    id: memberId,
    project_id: paramStr(req.params.id),
    name: name || 'New Character',
    description: description || '',
    sort_order: maxOrder + 1,
  });
  res.json(await getFullProject(paramStr(req.params.id)));
});

router.put('/:id/cast/:memberId', async (req, res) => {
  const { name, description, generationPrompt } = req.body;
  const memberId = paramStr(req.params.memberId);
  const projectId = paramStr(req.params.id);
  const updates: Record<string, any> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (generationPrompt !== undefined) { updates.generation_prompt = generationPrompt || null; updates.prompts_stale = false; }
  if (Object.keys(updates).length > 0) {
    await updateRows('cast_members', { id: memberId }, updates);
    // Cast description change → shots referencing this character are stale
    if (description !== undefined) {
      const scenes = await selectAll('scenes', { project_id: projectId });
      for (const s of scenes) {
        const shots = await selectAll('shots', { scene_id: s.id });
        for (const shot of shots) {
          const castIds = JSON.parse(shot.cast_ids || '[]');
          if (castIds.includes(memberId)) {
            await updateRows('shots', { id: shot.id }, { prompts_stale: true });
          }
        }
      }
    }
  }
  res.json(await getFullProject(projectId));
});

router.delete('/:id/cast/:memberId', async (req, res) => {
  await deleteRows('cast_members', { id: paramStr(req.params.memberId) });
  res.json({ ok: true });
});

// ─── Environment Management ──────────────────────────────────────────

router.post('/:id/environments', async (req, res) => {
  const { name, description } = req.body;
  const envId = uuidv4();
  const maxOrder = await maxVal('environments', 'sort_order', { project_id: paramStr(req.params.id) });
  await insertRow('environments', {
    id: envId,
    project_id: paramStr(req.params.id),
    name: name || 'New Environment',
    description: description || '',
    sort_order: maxOrder + 1,
  });
  res.json(await getFullProject(paramStr(req.params.id)));
});

router.put('/:id/environments/:envId', async (req, res) => {
  const { name, description, generationPrompt } = req.body;
  const envId = paramStr(req.params.envId);
  const projectId = paramStr(req.params.id);
  const updates: Record<string, any> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (generationPrompt !== undefined) { updates.generation_prompt = generationPrompt || null; updates.prompts_stale = false; }
  if (Object.keys(updates).length > 0) {
    await updateRows('environments', { id: envId }, updates);
    // Env description change → shots referencing this environment are stale
    if (description !== undefined) {
      const scenes = await selectAll('scenes', { project_id: projectId });
      for (const s of scenes) {
        const shots = await selectAll('shots', { scene_id: s.id });
        for (const shot of shots) {
          if (shot.environment_id === envId) {
            await updateRows('shots', { id: shot.id }, { prompts_stale: true });
          }
        }
      }
    }
  }
  res.json(await getFullProject(projectId));
});

router.delete('/:id/environments/:envId', async (req, res) => {
  await deleteRows('environments', { id: paramStr(req.params.envId) });
  res.json({ ok: true });
});

// ─── Final-render history ───────────────────────────────────────────
//
// Every call to /render inserts a `final_render` asset row and keeps the mp4
// at a unique timestamped path in Supabase Storage. These endpoints expose
// that history so the artist can re-watch or prune old renders. Ownership is
// enforced by the `router.param('id')` guard at the top of the file.

router.get('/:id/renders', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const rows = await selectAll(
    'assets',
    { project_id: projectId, category: 'final_render' },
    { orderBy: 'created_at', ascending: false },
  );

  // The remotion-renderer uploads into its own bucket (via its SUPABASE_BUCKET
  // env), so the mp4 may not live in this backend's `lahari-assets` bucket.
  // `lahari_renders.video_url` is the authoritative URL the renderer returned;
  // join on storage_path so the history shows URLs that actually load.
  const renderRows = await selectAll(
    'renders',
    { project_id: projectId, status: 'completed' },
  );
  const urlByPath = new Map<string, string>();
  for (const rr of renderRows as any[]) {
    if (rr.storage_path && rr.video_url) urlByPath.set(rr.storage_path, rr.video_url);
  }

  // Mark which render matches the queue row's current `video_url`, so the UI
  // can label it and refuse to delete it without confirmation.
  const queueRow = await findQueueByProjectIds([projectId]);
  const currentUrl = (queueRow as any)?.video_url || null;

  const renders = rows.map((r: any) => {
    const videoUrl = urlByPath.get(r.file_path) ?? storageUrl(r.file_path);
    return {
      assetId: r.id,
      videoUrl,
      storagePath: r.file_path,
      createdAt: r.created_at,
      isCurrent: currentUrl != null && currentUrl === videoUrl,
    };
  });

  res.json({ renders });
});

router.delete('/:id/renders/:assetId', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const assetId = paramStr(req.params.assetId);

  const asset: any = await selectOne('assets', { id: assetId });
  if (!asset || asset.project_id !== projectId || asset.category !== 'final_render') {
    return res.status(404).json({ error: 'Render not found for this project' });
  }

  // If this asset is the one the queue row currently points at, clear the
  // queue's video_url so we don't leave a dangling reference. The row stays
  // `completed` — the artist may have more renders in the list.
  //
  // Compare against the renderer-provided URL stored on lahari_renders when
  // available — the renderer can upload to a different bucket than this
  // backend's default, so storageUrl(file_path) wouldn't match queue.video_url.
  const queueRow = await findQueueByProjectIds([projectId]);
  const currentUrl = (queueRow as any)?.video_url || null;
  const renderRow: any = await selectOne('renders', {
    project_id: projectId, storage_path: asset.file_path, status: 'completed',
  });
  const thisUrl = renderRow?.video_url ?? storageUrl(asset.file_path);
  if (queueRow && currentUrl === thisUrl) {
    await updateQueueItem(queueRow.id, { video_url: null });
  }

  // Remove the mp4 from Supabase Storage (failure here isn't fatal — the row
  // removal below is the source of truth) and then drop the assets row.
  //
  // Renderer-uploaded renders live in a separate bucket (RENDER_STORAGE_BUCKET,
  // default `videos`) to match the renderer's SUPABASE_BUCKET. Legacy assets
  // with no matching `lahari_renders` row fall back to the default bucket.
  const renderBucket = process.env.RENDER_STORAGE_BUCKET ?? 'videos';
  const deleteBucket = renderRow ? renderBucket : undefined;
  try {
    await deleteFile(asset.file_path, deleteBucket);
  } catch (err) {
    console.warn(`[renders ${projectId}] storage delete failed for ${asset.file_path}:`, err);
  }
  await deleteRows('assets', { id: assetId });

  res.json({ ok: true, clearedQueueVideoUrl: queueRow && currentUrl === thisUrl });
});

// ─── X-Ray: AI Call Log ──────────────────────────────────────────────

router.get('/:id/xray', async (req, res) => {
  const project: any = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const calls = await getCalls(paramStr(req.params.id));
  const context = await buildContextChain(paramStr(req.params.id));

  // Resolve output asset IDs → URLs for image/video thumbnails
  const enriched = await Promise.all(calls.map(async (call) => {
    const outputAssets = await Promise.all(call.outputAssetIds.map(async (assetId: string) => {
      const asset: any = await selectOne('assets', { id: assetId });
      return asset ? { id: asset.id, url: storageUrl(asset.file_path), category: asset.category } : { id: assetId };
    }));
    return { ...call, outputAssets };
  }));

  res.json({ calls: enriched, currentContext: context });
});

// ─── Scene Updates ──────────────────────────────────────────────────

router.patch('/:id/scenes/:sceneId', async (req, res) => {
  const { narrativeDescription } = req.body;
  const sceneId = paramStr(req.params.sceneId);
  const updates: Record<string, any> = {};
  if (narrativeDescription !== undefined) updates.narrative_description = narrativeDescription;
  if (Object.keys(updates).length > 0) {
    await updateRows('scenes', { id: sceneId }, updates);
    // Scene narrative change → shots in this scene are stale
    if (narrativeDescription !== undefined) {
      await updateRows('shots', { scene_id: sceneId }, { prompts_stale: true });
    }
  }
  res.json({ ok: true });
});

// ─── Shot Updates ───────────────────────────────────────────────────

// Clear the start frame on a shot — keeps the video (if any) intact.
// Also unlocks the shot since a locked shot requires a start frame + video.
router.post('/:id/shots/:shotId/clear-frame', async (req, res) => {
  const shotId = paramStr(req.params.shotId);
  await updateRows('shots', { id: shotId }, { image_asset_id: null, image_status: 'idle', locked: 0 });
  res.json({ ok: true });
});

router.patch('/:id/shots/:shotId', async (req, res) => {
  const { visualPrompt, motionPrompt, endVisualPrompt, useNextAsEndFrame, userFeedback, continuityFrom } = req.body;
  const shotId = paramStr(req.params.shotId);

  // Manual edits to the prompt invalidate the auto-refresh chip — it meant
  // "this text was written by the vision rewrite", not "this text is current".
  if (visualPrompt !== undefined) {
    await updateRows('shots', { id: shotId }, { visual_prompt: visualPrompt, refined_from_prev_frame: 0 });
  }
  if (motionPrompt !== undefined) {
    await updateRows('shots', { id: shotId }, { motion_prompt: motionPrompt, refined_from_prev_frame: 0 });
  }
  if (useNextAsEndFrame !== undefined) {
    await updateRows('shots', { id: shotId }, { use_next_as_end_frame: useNextAsEndFrame ? 1 : 0 });
  }
  if (userFeedback !== undefined) {
    await updateRows('shots', { id: shotId }, { user_feedback: userFeedback || null });
  }
  if (endVisualPrompt !== undefined) {
    await updateRows('shots', { id: shotId }, { end_visual_prompt: endVisualPrompt || null });
  }
  if (continuityFrom !== undefined && (continuityFrom === 'cut' || continuityFrom === 'prev_shot')) {
    await updateRows('shots', { id: shotId }, { continuity_from: continuityFrom });
  }
  const { castIds, environmentId } = req.body;
  if (castIds !== undefined) {
    await updateRows('shots', { id: shotId }, { cast_ids: JSON.stringify(castIds), prompts_stale: true });
  }
  if (environmentId !== undefined) {
    await updateRows('shots', { id: shotId }, { environment_id: environmentId || null, prompts_stale: true });
  }
  const { duration } = req.body;
  if (duration !== undefined && typeof duration === 'number' && duration > 0) {
    await updateRows('shots', { id: shotId }, { duration, prompts_stale: true });
  }
  res.json({ ok: true });
});

// Shot split moved to server/routes/generate-shots.ts

export { router as projectsRouter, getFullProject };
