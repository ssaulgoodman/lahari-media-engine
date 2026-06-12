import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  selectAll, selectOne, insertRow, insertMany,
  updateRows, deleteRows, countRows, maxVal, incrementColumn,
  selectColumns, getSB, T, supportsPlatformColumns, usesLegacyQueueAdapter,
} from '../database.js';
import { saveBuffer, readAsBase64, mimeFromExt, storageUrl, deleteFile } from '../storage.js';
import { findQueueByProjectIds, updateQueueItem } from '../services/supabase.js';
import { GEMINI_AUDIO_ANALYSIS_MODEL, detectStructure } from '../services/gemini.js';
import { transcribeLyricsForAudioPath } from '../services/audioTranscription.js';
import { generateConceptOptions, refineConceptDirection, parseAnimeScriptToPlan } from '../services/claude.js';
import { logCall, getCalls, buildContextChain } from '../xray.js';
import { getProjectRuntimePreset, normalizeWorkflowKey, resolveProjectIntake } from '../presets.js';
import { availableTools, blockedTools } from '../tools/registry.js';
import { sendStructuredError } from '../services/structuredErrors.js';
import { isLegacyLookPrompt } from '../prompts/lookPrompts.js';
import { getProjectPromptOverride } from '../services/projectConfig.js';
// Registry-first-entry defaults so a future reorder in the constants files
// auto-propagates to getFullProject hydration. Old projects with null columns
// (pre-queue.ts-default-fill) get the current default instead of a stale
// hardcoded one.
import { IMAGE_MODELS } from '../../constants/imageModels.js';
import { STORYBOARD_PROVIDERS } from '../../constants/storyboardProviders.js';
import { VIDEO_MODELS } from '../../constants/videoModels.js';
import { TEXT_PROVIDERS, getTextProvider } from '../../constants/textProviders.js';
import { recordDirectorEvent } from '../services/directorEvents.js';
import { assertTranscriptDoesNotRegress } from '../services/codexStudio/audioAnalysis.js';

const router = Router();
const paramStr = (val: string | string[]): string => Array.isArray(val) ? val[0] : val;
const parseJson = <T,>(value: any, fallback: T): T => {
  if (!value) return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};
const platformProjectFields = (fields: Record<string, any>) =>
  supportsPlatformColumns() ? fields : {};

const markAudioPlansStaleForShots = async (shotIds: string[]) => {
  if (!supportsPlatformColumns()) return;
  if (shotIds.length === 0) return;
  const shots = await selectAll('shots', { id: shotIds });
  for (const shot of shots) {
    if (shot.audio_plan && !shot.audio_plan_stale) {
      await updateRows('shots', { id: shot.id }, { audio_plan_stale: true });
    }
  }
};

const markAudioPlansStaleForScene = async (sceneId: string) => {
  const shots = await selectAll('shots', { scene_id: sceneId });
  await markAudioPlansStaleForShots(shots.map((shot: any) => shot.id));
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
const mediaLibraryUploadCategory = 'media_library_video';

const mediaLibraryUploadResponse = (asset: any) => {
  const metadata = parseJson<Record<string, any>>(asset.metadata, {});
  return {
    assetId: asset.id,
    url: storageUrl(asset.file_path),
    createdAt: asset.created_at,
    name: metadata.name || asset.prompt || 'Uploaded clip',
    mimeType: metadata.mimeType || null,
    bytes: metadata.bytes || null,
  };
};

const insertProductionPlan = async (
  projectId: string,
  data: { cast: any[]; environments: any[]; scenes: any[] },
) => {
  await deleteRows('cast_members', { project_id: projectId });
  await deleteRows('environments', { project_id: projectId });

  const oldScenes = await selectColumns('scenes', 'id', { project_id: projectId });
  for (const s of oldScenes) await deleteRows('shots', { scene_id: s.id });
  await deleteRows('scenes', { project_id: projectId });

  const nameToId: Record<string, string> = {};
  for (let idx = 0; idx < (data.cast || []).length; idx++) {
    const c = data.cast[idx];
    const memberId = uuidv4();
    const name = c.name || `Character ${idx + 1}`;
    nameToId[name] = memberId;
    await insertRow('cast_members', {
      id: memberId,
      project_id: projectId,
      name,
      description: c.description || 'To be defined',
      sort_order: idx,
    });
  }

  const envNameToId: Record<string, string> = {};
  for (let idx = 0; idx < (data.environments || []).length; idx++) {
    const e = data.environments[idx];
    const envId = uuidv4();
    const name = e.name || `Environment ${idx + 1}`;
    envNameToId[name] = envId;
    await insertRow('environments', {
      id: envId,
      project_id: projectId,
      name,
      description: e.description || '',
      sort_order: idx,
    });
  }

  let totalShots = 0;
  for (let sIdx = 0; sIdx < (data.scenes || []).length; sIdx++) {
    const scene = data.scenes[sIdx];
    const sceneId = scene.id || uuidv4();
    await insertRow('scenes', {
      id: sceneId,
      project_id: projectId,
      section_label: scene.sectionLabel || `Scene ${sIdx + 1}`,
      start_time: scene.startTime || '0:00',
      end_time: scene.endTime || '0:00',
      lyrics: scene.lyrics || '',
      narrative_description: scene.narrativeDescription || '',
      sort_order: sIdx,
    });

    for (let shIdx = 0; shIdx < (scene.shots || []).length; shIdx++) {
      const shot = scene.shots[shIdx];
      const castNames: string[] = shot.castNames || [];
      const castIds = castNames.map((name: string) => nameToId[name] || name).filter(Boolean);
      const envId = shot.environmentName ? (envNameToId[shot.environmentName] || null) : null;
      await insertRow('shots', {
        id: uuidv4(),
        scene_id: sceneId,
        direction: shot.direction || '',
        visual_prompt: '',
        motion_prompt: '',
        duration: Math.max(1, Number(shot.duration || 6)),
        cast_ids: JSON.stringify(castIds),
        use_next_as_end_frame: 0,
        sort_order: shIdx,
        environment_id: envId,
      });
      totalShots++;
    }
  }

  return totalShots;
};

// ─── Fork helper ─────────────────────────────────────────────────────
// Deep-copies a project's DB rows under a new id. Asset file_paths are
// shared (same files on disk) so disk usage stays near-zero. Caller can
// then run destructive operations on the new project while the original
// stays frozen as a snapshot.
const forkProject = async (
  sourceId: string,
  opts?: { newUserId?: string; newSourceQueueId?: string | null },
): Promise<string> => {
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
    image_model: src.image_model,
    storyboard_provider: src.storyboard_provider || 'nano-banana-2',
    target_duration: src.target_duration,
    cost_estimate: src.cost_estimate,
    style_exploration: (() => {
      if (!src.style_exploration) return null;
      // Remap assetId references inside style_exploration JSON
      let se = JSON.parse(src.style_exploration);
      if (se.slots) se.slots = se.slots.map((s: any) => ({ ...s, assetId: remapAsset(s.assetId) || s.assetId }));
      if (se.userSlot?.assetId) se.userSlot = { ...se.userSlot, assetId: remapAsset(se.userSlot.assetId) || se.userSlot.assetId };
      if (se.presetSlots) {
        se.presetSlots = Object.fromEntries(
          Object.entries(se.presetSlots as Record<string, any>).map(([k, v]: [string, any]) => [
            k,
            { ...v, assetId: remapAsset(v?.assetId) || v?.assetId },
          ])
        );
      }
      return JSON.stringify(se);
    })(),
    video_model: src.video_model,
    ...platformProjectFields({
      preset_key: src.preset_key || 'music_video_default',
      workflow_key: normalizeWorkflowKey(src.workflow_key) || 'music_led',
      seed_kind: src.seed_kind || (src.audio_path ? 'audio' : 'brief'),
      project_brief: src.project_brief || null,
      source_payload: src.source_payload || null,
    }),
    aspect_ratio: src.aspect_ratio,
    video_resolution: src.video_resolution,
    last_script_prompt: src.last_script_prompt,
    last_concept_prompt: src.last_concept_prompt,
    last_write_shots_prompt: src.last_write_shots_prompt,
    style_generation_prompt: src.style_generation_prompt,
    text_provider: src.text_provider,
    user_id: opts?.newUserId ?? src.user_id,
    parent_project_id: sourceId,
    source_queue_id: opts && 'newSourceQueueId' in opts ? opts.newSourceQueueId : src.source_queue_id,
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
          storyboard_prompt: shot.storyboard_prompt,
          storyboard_cut_plan: shot.storyboard_cut_plan,
          storyboard_prompt_status: shot.storyboard_prompt_status,
          storyboard_prompt_user_feedback: shot.storyboard_prompt_user_feedback,
          lipsync_enabled: shot.lipsync_enabled,
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
          excluded_refs: shot.excluded_refs,
          use_prev_storyboard_ref: shot.use_prev_storyboard_ref,
          include_prev_cut_plan: shot.include_prev_cut_plan,
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

// _getFullProjectCore returns the project shape WITHOUT the tool-registry
// projection. `Project` (used by registry's asset-state resolver and
// codexStudio code) is derived from this so adding registry output to
// getFullProject can't recurse on itself at the type level.
const _getFullProjectCore = async (projectId: string) => {
  // Parallel fetch: project + cast + environments + scenes — 4 queries instead of serial
  const [project, cast, environments, scenes] = await Promise.all([
    selectOne('projects', { id: projectId }),
    selectAll('cast_members', { project_id: projectId }, { orderBy: 'sort_order' }),
    selectAll('environments', { project_id: projectId }, { orderBy: 'sort_order' }),
    selectAll('scenes', { project_id: projectId }, { orderBy: 'sort_order' }),
  ]) as [any, any[], any[], any[]];
  if (!project) return null;

  // Fetch ALL shots for this project's scenes in one query (not N queries per scene)
  const sceneIds = scenes.map((s: any) => s.id);
  const allShots = sceneIds.length > 0
    ? await selectAll('shots', { scene_id: sceneIds }, { orderBy: 'sort_order' })
    : [];

  // Collect every asset ID we need to resolve — one bulk fetch instead of N+1
  const assetIds = new Set<string>();
  const parseAudioPlan = (value: any) => {
    if (!value) return null;
    if (typeof value === 'object') return JSON.parse(JSON.stringify(value));
    try { return JSON.parse(value); } catch { return null; }
  };
  for (const shot of allShots) {
    if (shot.image_asset_id) assetIds.add(shot.image_asset_id);
    if (shot.end_image_asset_id) assetIds.add(shot.end_image_asset_id);
    if (shot.extracted_last_frame_asset_id) assetIds.add(shot.extracted_last_frame_asset_id);
    if (shot.video_asset_id) assetIds.add(shot.video_asset_id);
    if (shot.storyboard_asset_id) assetIds.add(shot.storyboard_asset_id);
    const audioPlan = parseAudioPlan(shot.audio_plan);
    for (const line of audioPlan?.dialogue || []) {
      if (line?.ttsAssetId) assetIds.add(line.ttsAssetId);
    }
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
  const hydrateAudioPlan = (value: any) => {
    const audioPlan = parseAudioPlan(value);
    if (!audioPlan) return undefined;
    if (Array.isArray(audioPlan.dialogue)) {
      audioPlan.dialogue = audioPlan.dialogue.map((line: any) => ({
        ...line,
        ttsAssetUrl: resolveUrl(line?.ttsAssetId),
      }));
    }
    return audioPlan;
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
  const styleAssetId = project.style_asset_id || null;
  const styleAssetUrl = resolveUrl(styleAssetId);

  const fullProject = {
    id: project.id,
    title: project.title,
    status: project.status,
    presetKey: project.preset_key || 'music_video_default',
    workflowKey: normalizeWorkflowKey(project.workflow_key) || 'music_led',
    seedKind: project.seed_kind || (project.audio_path ? 'audio' : 'brief'),
    projectBrief: project.project_brief || null,
    sourcePayload: project.source_payload || null,
    audioPath: project.audio_path ? storageUrl(project.audio_path) : null,
    lyrics: project.lyrics,
    meaning: project.meaning,
    musicalStructure: project.musical_structure ? JSON.parse(project.musical_structure) : [],
    analysisStep: project.analysis_step || null,
    conceptOptions: project.concept_options ? JSON.parse(project.concept_options) : [],
    lockedConcept: project.locked_concept ? JSON.parse(project.locked_concept) : null,
    styleDescription: project.style_description,
    styleAssetId,
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
    imageModel: project.image_model || IMAGE_MODELS[0].key,
    storyboardProvider: project.storyboard_provider || STORYBOARD_PROVIDERS[0].key,
    videoModel: project.video_model || VIDEO_MODELS[0].key,
    textProvider: getTextProvider(project.text_provider || TEXT_PROVIDERS[0].key).key,
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
      promptsStale: !!c.prompts_stale || isLegacyLookPrompt(c.generation_prompt),
      voiceProvider: c.voice_provider || undefined,
      voiceId: c.voice_id || undefined,
      voiceName: c.voice_name || undefined,
      referenceAssetId: c.reference_asset_id,
      referenceImageUrl: c.referenceImageUrl,
    })),
    environments: environments.map((e: any) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      generationPrompt: e.generation_prompt || undefined,
      promptsStale: !!e.prompts_stale || isLegacyLookPrompt(e.generation_prompt),
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
        workflowMode: shot.workflow_mode || 'auto',
        direction: shot.direction || '',
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
        storyboardPrompt: shot.storyboard_prompt || undefined,
        storyboardCutPlan: shot.storyboard_cut_plan || undefined,
        storyboardPromptStatus: shot.storyboard_prompt_status || 'idle',
        storyboardPromptUserFeedback: shot.storyboard_prompt_user_feedback || undefined,
        lipsyncEnabled: !!shot.lipsync_enabled,
        excludedRefs: (() => {
          // Per-tab ref exclusion for storyboard mode (see migration
          // 2026-05-11_add_shot_excluded_refs.sql). Stored as JSONB with
          // {storyboard, video} arrays of string keys. Default both empty
          // when column is missing or malformed so the frontend can treat
          // any shot consistently.
          const raw = shot.excluded_refs;
          if (!raw) return { storyboard: [], video: [] };
          const parsed = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
          if (!parsed || typeof parsed !== 'object') return { storyboard: [], video: [] };
          const sanitize = (v: any): string[] =>
            Array.isArray(v) ? v.filter((k: any) => typeof k === 'string') : [];
          return { storyboard: sanitize(parsed.storyboard), video: sanitize(parsed.video) };
        })(),
        continuityFrom: shot.continuity_from || 'cut',
        // Storyboard continuity flags. usePrevStoryboardRef is explicit
        // boolean; includePrevCutPlan is nullable (null = "use smart default
        // server-side"). Surfacing both lets the StoryboardPanel render the
        // current state without computing the default in two places.
        usePrevStoryboardRef: !!shot.use_prev_storyboard_ref,
        includePrevCutPlan: shot.include_prev_cut_plan === null || shot.include_prev_cut_plan === undefined
          ? null
          : !!shot.include_prev_cut_plan,
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
        audioPlan: hydrateAudioPlan(shot.audio_plan),
        audioPlanStale: !!shot.audio_plan_stale,
        useNextAsEndFrame: !!shot.use_next_as_end_frame,
        lastError: shot.last_error || undefined,
      }))
    })),
    targetDuration: project.target_duration,
    costEstimate: project.cost_estimate,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };

  return fullProject;
};

export type FullProjectCore = Awaited<ReturnType<typeof _getFullProjectCore>>;

// getFullProject wraps the core shape with the registry projection so
// every refresh path surfaces what's runnable + blocked. Frontend reads
// project.availableTools / project.blockedTools off the same payload the
// MCP packet uses (D24). Asset-state resolver runs over `fullProject`,
// which is the type registry/assetState already expects.
const getFullProject = async (projectId: string) => {
  const fullProject = await _getFullProjectCore(projectId);
  return {
    ...fullProject,
    availableTools: availableTools(fullProject),
    blockedTools: blockedTools(fullProject),
  };
};

// ─── Routes ─────────────────────────────────────────────────────────

// List all projects
router.get('/', async (req, res) => {
  const rows = await selectColumns(
    'projects',
    'id, title, status, created_at, updated_at, parent_project_id',
    { user_id: req.userId },
    { orderBy: 'updated_at', ascending: false }
  );

  // One extra query: count final_render assets per project so the sidebar can
  // show "Renders (N)" without N round-trips.
  const ids = rows.map((r: any) => r.id);
  const renderCounts = new Map<string, number>();
  const activityTimes = new Map<string, string>();
  const noteActivity = (projectId: string, value?: string | null) => {
    if (!value) return;
    const current = activityTimes.get(projectId);
    if (!current || new Date(value).getTime() > new Date(current).getTime()) {
      activityTimes.set(projectId, value);
    }
  };
  for (const r of rows) noteActivity(r.id, r.updated_at || r.created_at);

  if (ids.length > 0) {
    const { data: assetRows, error } = await getSB()
      .from(T.assets)
      .select('project_id, category, created_at')
      .in('project_id', ids);
    if (error) throw new Error(`DB select assets: ${error.message}`);
    for (const a of (assetRows as any[]) || []) {
      if (a.category === 'final_render') {
        renderCounts.set(a.project_id, (renderCounts.get(a.project_id) || 0) + 1);
      }
      noteActivity(a.project_id, a.created_at);
    }

    const { data: callRows, error: callError } = await getSB()
      .from(T.ai_calls)
      .select('project_id, created_at')
      .in('project_id', ids);
    if (callError) throw new Error(`DB select ai_calls: ${callError.message}`);
    for (const c of (callRows as any[]) || []) {
      noteActivity(c.project_id, c.created_at);
    }
  }

  const summaries = rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastActivityAt: activityTimes.get(r.id) || r.updated_at || r.created_at,
    parentProjectId: r.parent_project_id || undefined,
    renderCount: renderCounts.get(r.id) || 0,
  }));

  summaries.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  res.json(summaries);
});

// Get single project (full state)
router.get('/:id', async (req, res) => {
  const project = await getFullProject(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

const bodyString = (body: any, key: string): string | undefined => {
  const value = body?.[key];
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
};
const bodyNumber = (body: any, key: string): number | undefined => {
  const value = Array.isArray(body?.[key]) ? body[key][0] : body?.[key];
  const parsed = typeof value === 'number' ? value : Number(value || 0);
  return parsed > 0 ? parsed : undefined;
};

const createAudioProjectFromSeed = async (opts: {
  file: Express.Multer.File;
  body: any;
  userId: string;
}) => {
  const { workflow, seedKind, preset } = resolveProjectIntake({
    workflowKey: bodyString(opts.body, 'workflowKey') || 'music_led',
    seedKind: bodyString(opts.body, 'seedKind') || 'audio',
    presetKey: bodyString(opts.body, 'presetKey'),
  });
  if (seedKind !== 'audio') {
    const err = new Error(`Audio project intake requires seed_kind=audio, received "${seedKind}".`);
    (err as any).statusCode = 400;
    throw err;
  }

  const projectId = uuidv4();
  const file = opts.file;
  const ext = path.extname(file.originalname).slice(1) || 'mp3';
  const audioPath = await saveBuffer(file.buffer, 'audio', ext);
  const title = bodyString(opts.body, 'title') || file.originalname.replace(/\.[^/.]+$/, '');
  const language = bodyString(opts.body, 'language');
  const context = bodyString(opts.body, 'context') || bodyString(opts.body, 'directorBrief');

  await insertRow('projects', {
    id: projectId,
    title,
    status: 'uploaded',
    audio_path: audioPath,
    image_model: preset.defaults.imageModel,
    storyboard_provider: preset.defaults.imageModel,
    video_model: preset.defaults.videoModel,
    aspect_ratio: preset.defaults.aspectRatio,
    user_id: opts.userId,
    ...platformProjectFields({
      preset_key: preset.key,
      workflow_key: workflow.key,
      seed_kind: seedKind,
      project_brief: { title, language, context },
      source_payload: { kind: seedKind, originalName: file.originalname, storageKey: audioPath },
    }),
  });

  try {
    await recordDirectorEvent({
      projectId,
      userId: opts.userId,
      source: 'web',
      eventType: 'audio_source_uploaded',
      entityType: 'project',
      entityId: projectId,
      summary: 'Artist uploaded an audio source. Analysis is opt-in.',
      payload: { workflowKey: workflow.key, presetKey: preset.key, language: language || null, context: context || null },
    });
    return await getFullProject(projectId);
  } catch (err: any) {
    console.error(`[${projectId}] Audio intake failed:`, err);
    await updateRows('projects', { id: projectId }, { status: 'error', updated_at: new Date().toISOString() });
    throw err;
  }
};

const createScriptProjectFromSeed = async (opts: {
  body: any;
  userId: string;
  file?: Express.Multer.File;
}) => {
  const uploadedText = opts.file ? opts.file.buffer.toString('utf8') : '';
  const scriptText = String(bodyString(opts.body, 'scriptText') || bodyString(opts.body, 'script') || uploadedText).trim();
  if (!scriptText) {
    const err = new Error('scriptText required');
    (err as any).statusCode = 400;
    throw err;
  }

  const { workflow, seedKind, preset } = resolveProjectIntake({
    workflowKey: bodyString(opts.body, 'workflowKey') || 'scripted_narrative',
    seedKind: bodyString(opts.body, 'seedKind') || 'script',
    presetKey: bodyString(opts.body, 'presetKey') || 'anime_default',
  });
  if (seedKind !== 'script') {
    const err = new Error(`Script project intake requires seed_kind=script, received "${seedKind}".`);
    (err as any).statusCode = 400;
    throw err;
  }

  const projectId = uuidv4();
  const title = String(bodyString(opts.body, 'title') || `Untitled ${workflow.label} Project`).trim() || `Untitled ${workflow.label} Project`;
  const directorBrief = bodyString(opts.body, 'directorBrief');
  const targetRuntime = bodyNumber(opts.body, 'targetRuntime') ?? bodyNumber(opts.body, 'targetDuration');
  const targetShotDuration = bodyNumber(opts.body, 'targetShotDuration') || preset.defaults.pacing;

  await insertRow('projects', {
    id: projectId,
    title,
    status: 'analyzing',
    lyrics: scriptText,
    meaning: '',
    musical_structure: JSON.stringify([]),
    locked_concept: JSON.stringify({
      title,
      subject: title,
      mood: 'story-driven',
      theme: directorBrief || `Script-first ${workflow.label} production`,
      conceptDirection: preset.label,
      description: directorBrief || 'Parsed from an uploaded script.',
    }),
    style_description: preset.style.presetBible || preset.style.rules,
    image_model: preset.defaults.imageModel,
    storyboard_provider: preset.defaults.imageModel,
    video_model: preset.defaults.videoModel,
    aspect_ratio: preset.defaults.aspectRatio,
    target_duration: targetShotDuration,
    user_id: opts.userId,
    ...platformProjectFields({
      preset_key: preset.key,
      workflow_key: workflow.key,
      seed_kind: seedKind,
      project_brief: { title, directorBrief, targetRuntime, targetShotDuration },
      source_payload: { kind: seedKind, title, scriptText, originalName: opts.file?.originalname },
    }),
  });

  try {
    console.log(`[${projectId}] Parsing ${workflow.key} script seed via ${preset.key}...`);
    const t0 = Date.now();
    const data = await parseAnimeScriptToPlan({
      scriptText,
      title,
      directorBrief,
      targetDuration: targetRuntime,
      preset,
    });
    const totalShots = await insertProductionPlan(projectId, data);
    const durationMs = Date.now() - t0;

    const projectBrief = {
      title: data.title || title,
      directorBrief,
      targetRuntime,
      targetShotDuration,
      logline: data.logline || '',
    };

    await updateRows('projects', { id: projectId }, {
      title: data.title || title,
      status: 'scripted',
      last_script_prompt: data.prompt,
      meaning: data.logline || '',
      ...platformProjectFields({ project_brief: projectBrief }),
      updated_at: new Date().toISOString(),
    });

    await logCall({
      projectId,
      stage: 'parse-script-intake',
      model: 'claude-opus-4-7',
      prompt: data.prompt,
      responseSummary: `Parsed ${data.cast.length} cast members, ${data.environments.length} environments, ${data.scenes.length} scenes, ${totalShots} shots.`,
      durationMs,
      costEstimate: 0.02,
    });

    await incrementColumn('projects', { id: projectId }, 'cost_estimate', 0.02);
    return await getFullProject(projectId);
  } catch (err: any) {
    console.error(`[${projectId}] Script intake failed:`, err);
    await updateRows('projects', { id: projectId }, { status: 'error', updated_at: new Date().toISOString() });
    await logCall({
      projectId,
      stage: 'parse-script-intake',
      model: 'claude-opus-4-7',
      prompt: `Parse script-first project "${title}"`,
      durationMs: 0,
      error: err.message,
    });
    throw err;
  }
};

// Workflow-first intake for the new platform opening screen.
router.post('/intake', upload.single('seedFile'), async (req, res) => {
  try {
    const guessedSeed = bodyString(req.body, 'seedKind')
      || (req.file ? 'audio' : undefined)
      || (bodyString(req.body, 'scriptText') || bodyString(req.body, 'script') ? 'script' : undefined);
    const { workflow, seedKind } = resolveProjectIntake({
      workflowKey: bodyString(req.body, 'workflowKey'),
      seedKind: guessedSeed,
      presetKey: bodyString(req.body, 'presetKey'),
    });

    if (workflow.key === 'music_led' && seedKind === 'audio') {
      if (!req.file) return res.status(400).json({ error: 'Audio seed file required' });
      return res.json(await createAudioProjectFromSeed({ file: req.file, body: req.body, userId: req.userId }));
    }

    if (workflow.key === 'scripted_narrative' && seedKind === 'script') {
      return res.json(await createScriptProjectFromSeed({ body: req.body, userId: req.userId, file: req.file }));
    }

    return res.status(400).json({
      error: `Project intake for workflow "${workflow.key}" with seed "${seedKind}" is not implemented yet.`,
    });
  } catch (err: any) {
    sendStructuredError(res, err, 'project_intake_failed');
  }
});

// Create project + upload audio + run analysis
router.post('/', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Audio file required' });
    res.json(await createAudioProjectFromSeed({ file: req.file, body: req.body, userId: req.userId }));
  } catch (err: any) {
    sendStructuredError(res, err, 'analysis_failed');
  }
});

// Create script-first anime project + parse it into the shared production plan.
// This is the backend golden path for workflows that do not start with audio.
router.post('/script', async (req, res) => {
  try {
    res.json(await createScriptProjectFromSeed({ body: req.body, userId: req.userId }));
  } catch (err: any) {
    sendStructuredError(res, err);
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
    const projectOverride = await getProjectPromptOverride(project.id, 'concept');
    const result = await generateConceptOptions(
      title,
      language || 'Unknown',
      lyrics,
      meaning,
      musicalStructure,
      context,
      userNote,
      directorBrief,
      project.text_provider,
      getProjectRuntimePreset(project, req.body?.presetKey),
      projectOverride,
    );
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
    await recordDirectorEvent({
      projectId: project.id,
      userId: req.userId,
      source: 'web',
      eventType: 'concepts_generated',
      entityType: 'project',
      entityId: project.id,
      summary: `Artist generated ${conceptOptions.length} concept options.`,
      payload: { count: conceptOptions.length, userNote: userNote || null, directorBrief: !!directorBrief },
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
    sendStructuredError(res, err, 'concept_generation_failed');
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
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'concept_locked',
    entityType: 'project',
    entityId: projectId,
    summary: `Artist locked concept option ${Number(conceptIndex) + 1}${needsWipe ? ' and reset downstream work' : ''}.`,
    payload: {
      sourceProjectId: sourceId,
      forked: fork === true,
      conceptIndex,
      switchedConcept: !!switching,
      resetDownstream: !!needsWipe,
      conceptTitle: chosen?.title || chosen?.conceptDirection || null,
    },
  });

  res.json(await getFullProject(projectId));
});

// Re-parse the existing script seed and replace the production plan.
// Wired to the parse-script registry tool (T10.4): scripted_narrative
// projects need a re-parse path because /generate-script hard-fails on
// missing audio. Destructive — wipes cast / environments / scenes /
// shots before insert (same as the music-led regen path).
router.post('/:id/parse-script', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const sourcePayload = project.source_payload || {};
  const scriptText = (sourcePayload as any).scriptText;
  if (typeof scriptText !== 'string' || !scriptText.trim()) {
    return res.status(400).json({
      error: 'No script text found in source payload. Re-upload the script to re-parse.',
    });
  }

  const preset = getProjectRuntimePreset(project, req.body?.presetKey);
  const projectBrief = (project.project_brief || {}) as Record<string, unknown>;
  const title = (projectBrief.title as string) || project.title || 'Untitled';
  const directorBriefBase = (projectBrief.directorBrief as string) || '';
  const userNote = String(req.body?.userNote || '').trim();
  // userNote layers onto directorBrief for this call so the registry
  // contract holds: parse-script gets one input note, the parser uses it.
  const directorBrief = userNote
    ? (directorBriefBase ? `${directorBriefBase}\n\nAdditional note: ${userNote}` : userNote)
    : directorBriefBase;
  const targetRuntime = typeof projectBrief.targetRuntime === 'number'
    ? (projectBrief.targetRuntime as number)
    : null;

  try {
    console.log(`[${projectId}] Re-parsing scripted_narrative seed via ${preset.key}...`);
    const t0 = Date.now();
    const data = await parseAnimeScriptToPlan({
      scriptText,
      title,
      directorBrief,
      targetDuration: targetRuntime || undefined,
      projectOverride: await getProjectPromptOverride(projectId, 'script'),
      preset,
    });
    const totalShots = await insertProductionPlan(projectId, data);
    const durationMs = Date.now() - t0;

    const updatedBrief = {
      ...projectBrief,
      title: data.title || title,
      directorBrief: directorBriefBase, // preserve original (don't fold userNote in permanently)
      logline: data.logline || projectBrief.logline || '',
    };

    await updateRows('projects', { id: projectId }, {
      title: data.title || title,
      status: 'scripted',
      last_script_prompt: data.prompt,
      meaning: data.logline || project.meaning || '',
      ...platformProjectFields({ project_brief: updatedBrief }),
      updated_at: new Date().toISOString(),
    });

    await logCall({
      projectId,
      stage: 'parse-script',
      model: 'claude-opus-4-7',
      prompt: data.prompt,
      responseSummary: `Re-parsed ${data.cast.length} cast, ${data.environments.length} environments, ${data.scenes.length} scenes, ${totalShots} shots.`,
      durationMs,
      costEstimate: 0.02,
    });
    await incrementColumn('projects', { id: projectId }, 'cost_estimate', 0.02);

    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'script_reparsed',
      entityType: 'project',
      entityId: projectId,
      summary: `Re-parsed script seed; ${data.scenes.length} scenes / ${totalShots} shots.`,
    });

    res.json(await getFullProject(projectId));
  } catch (err: any) {
    console.error(`[${projectId}] parse-script failed:`, err);
    return sendStructuredError(res, err);
  }
});

router.post('/:id/unlock-concept', async (req, res) => {
  const projectId = paramStr(req.params.id);
  await updateRows('projects', { id: projectId }, { status: 'analyzed', updated_at: new Date().toISOString() });
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'concept_unlocked',
    entityType: 'project',
    entityId: projectId,
    summary: 'Artist reopened concept selection without deleting downstream work.',
  });
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
    const projectOverride = await getProjectPromptOverride(projectId, 'concept');
    const refined = await refineConceptDirection(current, feedback, project.text_provider, getProjectRuntimePreset(project, req.body?.presetKey), projectOverride);
    await updateRows('projects', { id: projectId }, {
      locked_concept: JSON.stringify(refined),
      updated_at: new Date().toISOString(),
    });
    // Concept change invalidates all downstream — script was built from old concept
    const scenes = await selectAll('scenes', { project_id: projectId });
    for (const s of scenes) {
      await updateRows('shots', { scene_id: s.id }, { prompts_stale: true });
    }
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'concept_refined',
      entityType: 'project',
      entityId: projectId,
      summary: 'Artist refined the locked concept; downstream shot prompts were marked stale.',
      payload: { feedback },
    });
    res.json(await getFullProject(projectId));
  } catch (err: any) {
    sendStructuredError(res, err, 'concept_refinement_failed');
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
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'concept_edited',
    entityType: 'project',
    entityId: projectId,
    summary: 'Artist edited locked concept fields; downstream shot prompts were marked stale.',
    payload: { fields: Object.keys(updates || {}) },
  });
  res.json({ ok: true });
});

// Update project settings
router.patch('/:id', async (req, res) => {
  const { title, targetDuration, styleDescription, colorPalette, imageModel, storyboardProvider, videoModel, textProvider, aspectRatio, videoResolution } = req.body;
  const updates: Record<string, any> = {};
  const projectId = paramStr(req.params.id);

  if (title !== undefined) updates.title = title;
  if (imageModel !== undefined) updates.image_model = imageModel;
  if (storyboardProvider !== undefined) updates.storyboard_provider = storyboardProvider;
  if (videoModel !== undefined) updates.video_model = videoModel;
  if (textProvider !== undefined) updates.text_provider = getTextProvider(textProvider).key;
  if (aspectRatio !== undefined) updates.aspect_ratio = aspectRatio;
  if (videoResolution !== undefined) updates.video_resolution = videoResolution;
  if (targetDuration !== undefined) updates.target_duration = targetDuration;
  if (styleDescription !== undefined) updates.style_description = styleDescription;
  if (colorPalette !== undefined) updates.color_palette = colorPalette;
  if (req.body.styleExploration !== undefined) updates.style_exploration = JSON.stringify(req.body.styleExploration);
  if (req.body.styleGenerationPrompt !== undefined) updates.style_generation_prompt = req.body.styleGenerationPrompt || null;
  if (req.body.projectBrief !== undefined) {
    const existing = await selectOne('projects', { id: projectId });
    const currentBrief = existing?.project_brief && typeof existing.project_brief === 'object'
      ? existing.project_brief
      : {};
    const nextBrief = req.body.projectBrief && typeof req.body.projectBrief === 'object'
      ? req.body.projectBrief
      : {};
    updates.project_brief = { ...currentBrief, ...nextBrief };
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

  updates.updated_at = new Date().toISOString();
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
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'project_settings_edited',
    entityType: 'project',
    entityId: projectId,
    summary: `Artist edited project settings: ${Object.keys(updates).filter((key) => key !== 'updated_at').join(', ')}.`,
    payload: { fields: Object.keys(updates).filter((key) => key !== 'updated_at') },
  });

  res.json({ ok: true });
});

// Delete project — legacy Lahari queue projects also reset their linked queue row.
router.delete('/:id', async (req, res) => {
  try {
    const projectId = paramStr(req.params.id);
    let queueRow: Awaited<ReturnType<typeof findQueueByProjectIds>> = null;

    if (usesLegacyQueueAdapter()) {
      // Walk fork chain to find the queue row (same logic as publish)
      const chain: string[] = [projectId];
      let cur = projectId;
      while (true) {
        const row = await selectOne('projects', { id: cur });
        if (!row?.parent_project_id) break;
        chain.push(row.parent_project_id);
        cur = row.parent_project_id;
      }

      // Reset queue item if this was the linked project.
      queueRow = await findQueueByProjectIds(chain);
    }

    await deleteRows('projects', { id: projectId });

    if (queueRow && queueRow.lahari_project_id === projectId) {
      await updateQueueItem(queueRow.id, {
        status: 'queued',
        lahari_project_id: null as any,
      });
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error('[delete-project] failed:', err);
    sendStructuredError(res, err);
  }
});

// Fork — deep-copy a project as a new one. Used before destructive ops
// so the original stays frozen as a snapshot.
router.post('/:id/fork', async (req, res) => {
  try {
    const sourceId = paramStr(req.params.id);
    const newId = await forkProject(sourceId);
    await recordDirectorEvent({
      projectId: sourceId,
      userId: req.userId,
      source: 'web',
      eventType: 'project_forked',
      entityType: 'project',
      entityId: sourceId,
      summary: 'Artist forked the project.',
      payload: { forkProjectId: newId },
    });
    res.json(await getFullProject(newId));
  } catch (err: any) {
    console.error('[fork] failed:', err);
    sendStructuredError(res, err);
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
    const audioRef = [{ type: 'audio' as const, label: 'Project audio', url: storageUrl(project.audio_path) }];
    const t0 = Date.now();

    const needsLyrics = !project.lyrics;
    const requestedSteps = Array.isArray(req.body?.steps)
      ? req.body.steps.map((step: unknown) => String(step))
      : [];
    const runTranscribe = requestedSteps.length === 0 ? needsLyrics : requestedSteps.includes('transcribe');
    const runStructure = requestedSteps.length === 0 ? true : requestedSteps.includes('structure');
    if (!runTranscribe && !runStructure) return res.status(400).json({ error: 'steps must include transcribe and/or structure' });

    const [lyricsResult, structureResult] = await Promise.allSettled([
      runTranscribe ? transcribeLyricsForAudioPath(project.audio_path, bodyString(req.body, 'language')) : Promise.resolve({
        lyrics: project.lyrics || '',
        method: 'single' as const,
        model: GEMINI_AUDIO_ANALYSIS_MODEL,
        durationSec: null,
        chunks: 0,
        quality: undefined,
      }),
      runStructure ? (async () => {
        const audioBase64 = await readAsBase64(project.audio_path);
        const audioMime = mimeFromExt(project.audio_path);
        return detectStructure(audioBase64, audioMime);
      })() : Promise.resolve({
        sections: project.musical_structure ? JSON.parse(project.musical_structure) : [],
      }),
    ]);

    const transcription = lyricsResult.status === 'fulfilled' ? lyricsResult.value : null;
    const lyrics = transcription ? transcription.lyrics : '';
    const structureData2 = structureResult.status === 'fulfilled' ? structureResult.value : { sections: [] };
    const musicalStructure = Array.isArray(structureData2) ? structureData2 : structureData2.sections;
    const structureSucceeded = runStructure && structureResult.status === 'fulfilled';
    let transcriptionQualityError: unknown = null;
    if (runTranscribe && lyricsResult.status === 'fulfilled') {
      try {
        assertTranscriptDoesNotRegress({
          lyrics: project.lyrics || '',
          musicalStructure: structureSucceeded
            ? musicalStructure
            : parseJson(project.musical_structure, []),
        }, lyrics);
      } catch (err) {
        transcriptionQualityError = err;
        console.warn(`[${projectId}] lyrics transcription quality failed:`, err);
      }
    }
    const transcribeSucceeded = runTranscribe && lyricsResult.status === 'fulfilled' && !transcriptionQualityError;
    const anyRequestedSucceeded = transcribeSucceeded || structureSucceeded;
    const settledError = (result: PromiseSettledResult<unknown>) => (
      result.status === 'rejected' ? String(result.reason) : null
    );
    const transcribeError = transcriptionQualityError
      ? ((transcriptionQualityError as any)?.message || String(transcriptionQualityError))
      : settledError(lyricsResult);

    if (lyricsResult.status === 'rejected') console.warn(`[${projectId}] lyrics transcription failed:`, lyricsResult.reason);
    if (structureResult.status === 'rejected') console.warn(`[${projectId}] structure failed:`, structureResult.reason);

    const analysisMs = Date.now() - t0;

    if (runTranscribe) {
      logCall({
        projectId,
        stage: 'transcribe-lyrics',
        model: GEMINI_AUDIO_ANALYSIS_MODEL,
        prompt: `Transcribe lyrics from audio with timestamps.${transcription ? ` Method: ${transcription.method}.` : ''}`,
        referenceInputs: audioRef,
        responseSummary: transcribeSucceeded
          ? `${lyrics.split('\n').length} lines${transcription?.method === 'chunked' ? ` across ${transcription.chunks} chunks` : ''}`
          : (lyrics ? `Rejected partial/regressed transcript (${lyrics.split('\n').length} lines)` : 'FAILED'),
        durationMs: analysisMs,
        costEstimate: Math.max(0.01, (transcription?.chunks || 1) * 0.01),
        error: transcribeError || undefined,
      });
    }
    if (runStructure) {
      logCall({
        projectId,
        stage: 'detect-structure',
        model: GEMINI_AUDIO_ANALYSIS_MODEL,
        prompt: 'Re-run: identify musical sections (label, startTime, endTime, energyLevel, description).',
        referenceInputs: audioRef,
        responseSummary: structureResult.status === 'fulfilled'
          ? musicalStructure.map((s: any) => `${s.label} [${s.startTime}–${s.endTime}]`).join('\n')
          : 'FAILED',
        durationMs: analysisMs,
        costEstimate: 0.01,
        error: structureResult.status === 'rejected' ? String(structureResult.reason) : undefined,
      });
    }

    if (!anyRequestedSucceeded) {
      await recordDirectorEvent({
        projectId,
        userId: req.userId,
        source: 'web',
        eventType: 'audio_analysis_failed',
        entityType: 'project',
        entityId: projectId,
        summary: 'Audio analysis failed before producing transcript or structure.',
        payload: {
          sourceProjectId: sourceId,
          forked: req.body?.fork === true,
          requested: {
            transcribe: runTranscribe,
            structure: runStructure,
          },
          errors: {
            transcribe: runTranscribe ? transcribeError : null,
            structure: runStructure ? settledError(structureResult) : null,
          },
        },
      });
      const err = new Error(JSON.stringify({
        code: 'audio_analysis_failed',
        message: 'Audio analysis failed before producing transcript or structure.',
        details: {
          transcribe: runTranscribe ? transcribeError : null,
          structure: runStructure ? settledError(structureResult) : null,
        },
      }));
      (err as any).statusCode = 502;
      throw err;
    }

    // Conditional status update: only move to 'analyzed' if currently 'uploaded' or 'analyzing'
    const statusUpdate: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (runTranscribe && transcribeSucceeded && lyrics) statusUpdate.lyrics = lyrics;
    if (runStructure && structureSucceeded) {
      statusUpdate.musical_structure = JSON.stringify(musicalStructure);
    }
    if ((project.status === 'uploaded' || project.status === 'analyzing') && anyRequestedSucceeded) {
      statusUpdate.status = 'analyzed';
    }
    await updateRows('projects', { id: projectId }, statusUpdate);
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'audio_analysis_applied',
      entityType: 'project',
      entityId: projectId,
      summary: 'Artist re-ran audio analysis for the project.',
      payload: {
        sourceProjectId: sourceId,
        forked: req.body?.fork === true,
        transcribed: transcribeSucceeded,
        transcription: runTranscribe ? {
          requested: true,
          succeeded: transcribeSucceeded,
          lines: transcribeSucceeded && lyrics ? lyrics.split('\n').length : 0,
          rejectedLines: !transcribeSucceeded && lyrics ? lyrics.split('\n').length : 0,
          error: transcribeError,
          method: transcription?.method || null,
          chunks: transcription?.chunks || 0,
          durationSec: transcription?.durationSec || null,
          quality: transcription?.quality || null,
        } : null,
        structure: runStructure ? {
          requested: true,
          succeeded: structureSucceeded,
          sections: musicalStructure.length,
          error: settledError(structureResult),
        } : null,
      },
    });

    res.json(await getFullProject(projectId));
  } catch (err: any) {
    console.error(`[${projectId}] re-analysis failed:`, err);
    sendStructuredError(res, err);
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
            await markAudioPlansStaleForShots([shot.id]);
          }
        }
      }
    }
  }
  res.json(await getFullProject(projectId));
});

router.patch('/:id/cast/:memberId/voice', async (req, res) => {
  const { voiceProvider, voiceId, voiceName } = req.body;
  const memberId = paramStr(req.params.memberId);
  const projectId = paramStr(req.params.id);

  try {
    if (voiceProvider !== 'elevenlabs') {
      const err = new Error(`Unsupported voice provider: ${voiceProvider}`);
      (err as any).statusCode = 400;
      throw err;
    }
    if (typeof voiceId !== 'string' || !voiceId.trim()) {
      const err = new Error('voiceId is required.');
      (err as any).statusCode = 400;
      throw err;
    }

    await updateRows('cast_members', { id: memberId }, {
      voice_provider: voiceProvider,
      voice_id: voiceId.trim(),
      voice_name: typeof voiceName === 'string' && voiceName.trim() ? voiceName.trim() : null,
    });

    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'cast_voice_assigned',
      entityType: 'cast',
      entityId: memberId,
      summary: `Assigned ${voiceProvider} voice to cast member`,
      payload: { voiceProvider, voiceName: voiceName || null },
    });

    res.json(await getFullProject(projectId));
  } catch (err) {
    sendStructuredError(res, err);
  }
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
            await markAudioPlansStaleForShots([shot.id]);
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

// ─── Render media library uploads ───────────────────────────────────
//
// Uploaded clips are library takes, not canonical shot state. They can be
// appended to the render timeline but never mark shots stale or replace
// generated media. Ownership is enforced by the `router.param('id')` guard
// at the top of the file.

router.get('/:id/media-library/uploads', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const rows = await selectAll(
    'assets',
    { project_id: projectId, category: mediaLibraryUploadCategory },
    { orderBy: 'created_at', ascending: false },
  );
  const uploads = (rows as any[])
    .filter((row) => parseJson<Record<string, any>>(row.metadata, {}).hiddenFromMediaLibrary !== true)
    .map(mediaLibraryUploadResponse);
  res.json({ uploads });
});

router.post('/:id/media-library/uploads', upload.single('file'), async (req, res) => {
  const projectId = paramStr(req.params.id);
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'file required' });
  if (!file.mimetype?.startsWith('video/')) {
    return res.status(400).json({ error: 'Media library upload currently supports video files only.' });
  }

  const rawExt = path.extname(file.originalname || '').replace('.', '').toLowerCase();
  const ext = rawExt || (file.mimetype === 'video/webm' ? 'webm' : file.mimetype === 'video/quicktime' ? 'mov' : 'mp4');
  const filePath = await saveBuffer(file.buffer, 'videos', ext);
  const assetId = uuidv4();
  const name = (req.body?.name || file.originalname || 'Uploaded clip').toString().slice(0, 160);
  const metadata = {
    mediaLibrary: true,
    source: 'upload',
    name,
    mimeType: file.mimetype,
    bytes: file.size,
  };
  const asset = {
    id: assetId,
    project_id: projectId,
    category: mediaLibraryUploadCategory,
    file_path: filePath,
    prompt: name,
    metadata: JSON.stringify(metadata),
    created_at: new Date().toISOString(),
  };
  await insertRow('assets', asset);
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'media_library_upload_added',
    entityType: 'asset',
    entityId: assetId,
    summary: `Artist uploaded "${name}" to the render media library.`,
    payload: { assetId, filePath, mimeType: file.mimetype, bytes: file.size },
  });
  res.json({ upload: mediaLibraryUploadResponse(asset) });
});

router.post('/:id/media-library/uploads/:assetId/hide', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const assetId = paramStr(req.params.assetId);
  const asset: any = await selectOne('assets', { id: assetId });
  if (!asset || asset.project_id !== projectId || asset.category !== mediaLibraryUploadCategory) {
    return res.status(404).json({ error: 'Uploaded media not found for this project' });
  }
  const metadata = parseJson<Record<string, any>>(asset.metadata, {});
  await updateRows('assets', { id: assetId }, {
    metadata: JSON.stringify({
      ...metadata,
      hiddenFromMediaLibrary: true,
      hiddenFromMediaLibraryAt: new Date().toISOString(),
    }),
  });
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'media_library_upload_hidden',
    entityType: 'asset',
    entityId: assetId,
    summary: 'Artist hid an uploaded clip from the render media library.',
    payload: { assetId },
  });
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
    { project_id: projectId, status: ['completed', 'cancelled'] },
  );
  const urlByPath = new Map<string, string>();
  for (const rr of renderRows as any[]) {
    if (rr.storage_path && rr.video_url) urlByPath.set(rr.storage_path, rr.video_url);
  }

  // In legacy Lahari mode, mark which render matches the queue row's current
  // `video_url`, so the UI can label it and refuse to delete it without
  // confirmation. Mirage's clean schema has no queue catalog.
  const queueRow = usesLegacyQueueAdapter() ? await findQueueByProjectIds([projectId]) : null;
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
  const queueRow = usesLegacyQueueAdapter() ? await findQueueByProjectIds([projectId]) : null;
  const currentUrl = (queueRow as any)?.video_url || null;
  const renderRow: any = await selectOne('renders', {
    project_id: projectId, storage_path: asset.file_path,
  });
  const thisUrl = renderRow?.video_url ?? storageUrl(asset.file_path);
  if (queueRow && currentUrl === thisUrl) {
    await updateQueueItem(queueRow.id, { video_url: null });
  }

  // Remove the mp4 from Supabase Storage (failure here isn't fatal — the row
  // removal below is the source of truth) and then drop the assets row.
  //
  // Renderer-uploaded renders live in the renderer's SUPABASE_BUCKET. Production
  // Modal currently sets SUPABASE_BUCKET=videos, so the backend default matches
  // that. Override RENDER_STORAGE_BUCKET only if the renderer bucket changes.
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
      return asset ? { id: asset.id, url: storageUrl(asset.file_path), category: asset.category, shotId: asset.shot_id || undefined } : { id: assetId };
    }));
    return { ...call, outputAssets };
  }));

  res.json({ calls: enriched, currentContext: context });
});

// ─── Scene Updates ──────────────────────────────────────────────────

router.patch('/:id/scenes/:sceneId', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const { narrativeDescription } = req.body;
  const sceneId = paramStr(req.params.sceneId);
  const updates: Record<string, any> = {};
  if (narrativeDescription !== undefined) updates.narrative_description = narrativeDescription;
  if (Object.keys(updates).length > 0) {
    await updateRows('scenes', { id: sceneId }, updates);
    // Scene narrative change → shots in this scene are stale
    if (narrativeDescription !== undefined) {
      await updateRows('shots', { scene_id: sceneId }, { prompts_stale: true });
      await markAudioPlansStaleForScene(sceneId);
      await recordDirectorEvent({
        projectId,
        userId: req.userId,
        source: 'web',
        eventType: 'scene_narrative_edited',
        entityType: 'scene',
        entityId: sceneId,
        summary: 'Artist edited scene narrative; shot prompts in the scene were marked stale.',
        payload: { narrativeDescription },
      });
    }
  }
  res.json({ ok: true });
});

// ─── Shot Updates ───────────────────────────────────────────────────

// Clear the start frame on a shot — keeps the video (if any) intact.
// Also unlocks the shot since a locked shot requires a start frame + video.
router.post('/:id/shots/:shotId/clear-frame', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);
  await updateRows('shots', { id: shotId }, { image_asset_id: null, image_status: 'idle', locked: 0 });
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'shot_frame_cleared',
    entityType: 'shot',
    entityId: shotId,
    summary: 'Artist cleared the active start frame; the shot was unlocked.',
  });
  res.json({ ok: true });
});

router.patch('/:id/shots/:shotId', async (req, res) => {
  const { direction, visualPrompt, motionPrompt, endVisualPrompt, useNextAsEndFrame, userFeedback, continuityFrom, lipsyncEnabled } = req.body;
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);
  const eventTypes: string[] = [];

  // Manual edits to the prompt invalidate the auto-refresh chip — it meant
  // "this text was written by the vision rewrite", not "this text is current".
  if (direction !== undefined) {
    await updateRows('shots', { id: shotId }, { direction, prompts_stale: true });
    await markAudioPlansStaleForShots([shotId]);
    eventTypes.push('direction');
  }
  if (visualPrompt !== undefined) {
    await updateRows('shots', { id: shotId }, { visual_prompt: visualPrompt, refined_from_prev_frame: 0 });
    eventTypes.push('visual_prompt');
  }
  if (motionPrompt !== undefined) {
    await updateRows('shots', { id: shotId }, { motion_prompt: motionPrompt, refined_from_prev_frame: 0 });
    eventTypes.push('motion_prompt');
  }
  if (useNextAsEndFrame !== undefined) {
    await updateRows('shots', { id: shotId }, { use_next_as_end_frame: useNextAsEndFrame ? 1 : 0 });
    eventTypes.push('use_next_as_end_frame');
  }
  if (lipsyncEnabled !== undefined) {
    await updateRows('shots', { id: shotId }, { lipsync_enabled: !!lipsyncEnabled });
    eventTypes.push('lipsync_enabled');
  }
  if (userFeedback !== undefined) {
    await updateRows('shots', { id: shotId }, { user_feedback: userFeedback || null });
    eventTypes.push('user_feedback');
  }
  if (endVisualPrompt !== undefined) {
    await updateRows('shots', { id: shotId }, { end_visual_prompt: endVisualPrompt || null });
    eventTypes.push('end_visual_prompt');
  }
  if (continuityFrom !== undefined && (continuityFrom === 'cut' || continuityFrom === 'prev_shot')) {
    await updateRows('shots', { id: shotId }, { continuity_from: continuityFrom });
    eventTypes.push('continuity_from');
  }
  const { castIds, environmentId } = req.body;
  if (castIds !== undefined) {
    await updateRows('shots', { id: shotId }, { cast_ids: JSON.stringify(castIds), prompts_stale: true });
    await markAudioPlansStaleForShots([shotId]);
    eventTypes.push('cast_ids');
  }
  if (environmentId !== undefined) {
    await updateRows('shots', { id: shotId }, { environment_id: environmentId || null, prompts_stale: true });
    await markAudioPlansStaleForShots([shotId]);
    eventTypes.push('environment_id');
  }
  const { duration } = req.body;
  if (duration !== undefined && typeof duration === 'number' && duration > 0) {
    await updateRows('shots', { id: shotId }, { duration, prompts_stale: true });
    await markAudioPlansStaleForShots([shotId]);
    eventTypes.push('duration');
  }

  // Storyboard continuity flags — see migrations/2026-05-12_add_storyboard_continuity.sql.
  // use_prev_storyboard_ref is an explicit boolean; include_prev_cut_plan
  // is nullable to distinguish "artist hasn't decided" (null → smart
  // default applies server-side) from "explicit true/false".
  const { usePrevStoryboardRef, includePrevCutPlan } = req.body;
  if (usePrevStoryboardRef !== undefined) {
    await updateRows('shots', { id: shotId }, { use_prev_storyboard_ref: !!usePrevStoryboardRef });
    eventTypes.push('use_prev_storyboard_ref');
  }
  if (includePrevCutPlan !== undefined) {
    const v = includePrevCutPlan === null ? null : !!includePrevCutPlan;
    await updateRows('shots', { id: shotId }, { include_prev_cut_plan: v });
    eventTypes.push('include_prev_cut_plan');
  }

  // Per-step ref exclusion for storyboard mode. Payload shape:
  //   excludedRefs: { storyboard?: string[], video?: string[] }
  // Sanitized server-side: only string keys, both arrays present in the
  // stored JSON so the column has stable shape downstream.
  const { excludedRefs } = req.body;
  if (excludedRefs !== undefined && excludedRefs && typeof excludedRefs === 'object') {
    const sanitize = (v: any): string[] =>
      Array.isArray(v) ? v.filter((k: any) => typeof k === 'string') : [];
    const payload = {
      storyboard: sanitize(excludedRefs.storyboard),
      video: sanitize(excludedRefs.video),
    };
    await updateRows('shots', { id: shotId }, { excluded_refs: JSON.stringify(payload) });
    eventTypes.push('excluded_refs');
  }

  if (eventTypes.length) {
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'shot_fields_edited',
      entityType: 'shot',
      entityId: shotId,
      summary: `Artist edited shot fields: ${eventTypes.join(', ')}.`,
      payload: { fields: eventTypes, body: req.body },
    });
  }

  res.json({ ok: true });
});

// Shot split moved to server/routes/generate-shots.ts

export { router as projectsRouter, getFullProject };
