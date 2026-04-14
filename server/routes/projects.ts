import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { saveBuffer, STORAGE_ROOT_PATH, readAsBase64, mimeFromExt } from '../storage.js';
import { transcribeLyrics, detectStructure } from '../services/gemini.js';
import { summarizeMeaning, generateConceptOptions } from '../services/claude.js';
import { logCall, getCalls, buildContextChain } from '../xray.js';

const router = Router();
const paramStr = (val: string | string[]): string => Array.isArray(val) ? val[0] : val;

// Multer config: save audio files to storage
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// ─── Fork helper ─────────────────────────────────────────────────────
// Deep-copies a project's DB rows under a new id. Asset file_paths are
// shared (same files on disk) so disk usage stays near-zero. Caller can
// then run destructive operations on the new project while the original
// stays frozen as a snapshot.
const forkProject = (sourceId: string): string => {
  const src: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(sourceId);
  if (!src) throw new Error('Source project not found');

  const newId = uuidv4();
  const suffix = ' (fork)';
  const newTitle = src.title.endsWith(suffix) ? src.title : src.title + suffix;

  // Pre-compute remaps so we can rewrite foreign keys.
  const srcCast = db.prepare('SELECT * FROM cast_members WHERE project_id = ?').all(sourceId) as any[];
  const srcEnvs = db.prepare('SELECT * FROM environments WHERE project_id = ?').all(sourceId) as any[];
  const srcAssets = db.prepare('SELECT * FROM assets WHERE project_id = ?').all(sourceId) as any[];
  const srcScenes = db.prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY sort_order').all(sourceId) as any[];

  const castMap = new Map<string, string>();
  srcCast.forEach(c => castMap.set(c.id, uuidv4()));
  const envMap = new Map<string, string>();
  srcEnvs.forEach(e => envMap.set(e.id, uuidv4()));
  const assetMap = new Map<string, string>();
  srcAssets.forEach(a => assetMap.set(a.id, uuidv4()));
  const sceneMap = new Map<string, string>();
  srcScenes.forEach(s => sceneMap.set(s.id, uuidv4()));

  const remapAsset = (oldId: string | null | undefined) => oldId ? (assetMap.get(oldId) || null) : null;

  // Run everything in a single transaction so partial forks never leak.
  const tx = db.transaction(() => {
    // Project row — copy everything, remap style_asset_id, new id + parent.
    db.prepare(`
      INSERT INTO projects (
        id, title, status, audio_path, lyrics, musical_structure, concept_options,
        locked_concept, style_description, style_asset_id, color_palette, meaning,
        video_mode, target_duration, cost_estimate, style_exploration,
        video_model, aspect_ratio, video_resolution,
        last_script_prompt, last_concept_prompt, last_write_shots_prompt,
        parent_project_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      newId, newTitle, src.status, src.audio_path, src.lyrics, src.musical_structure,
      src.concept_options, src.locked_concept, src.style_description, remapAsset(src.style_asset_id),
      src.color_palette, src.meaning, src.video_mode, src.target_duration, src.cost_estimate,
      src.style_exploration, src.video_model, src.aspect_ratio, src.video_resolution,
      src.last_script_prompt, src.last_concept_prompt, src.last_write_shots_prompt,
      sourceId,
    );

    // Assets — same file_path, new ids.
    const insertAsset = db.prepare(`INSERT INTO assets (id, project_id, category, file_path, prompt, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
    for (const a of srcAssets) insertAsset.run(assetMap.get(a.id), newId, a.category, a.file_path, a.prompt || null, a.metadata || null);

    // Cast members.
    const insertCast = db.prepare(`INSERT INTO cast_members (id, project_id, name, description, reference_asset_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const c of srcCast) insertCast.run(castMap.get(c.id), newId, c.name, c.description, remapAsset(c.reference_asset_id), c.sort_order);

    // Environments.
    const insertEnv = db.prepare(`INSERT INTO environments (id, project_id, name, description, reference_asset_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const e of srcEnvs) insertEnv.run(envMap.get(e.id), newId, e.name, e.description, remapAsset(e.reference_asset_id), e.sort_order);

    // Scenes + shots.
    const insertScene = db.prepare(`INSERT INTO scenes (id, project_id, section_label, start_time, end_time, lyrics, narrative_description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertShot = db.prepare(`INSERT INTO shots (id, scene_id, visual_prompt, motion_prompt, duration, cast_ids, image_asset_id, video_asset_id, image_status, video_status, critique, attempt_count, use_next_as_end_frame, sort_order, end_image_asset_id, end_image_status, locked, user_feedback, environment_id, extracted_last_frame_asset_id, continuity_description, continuity_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const s of srcScenes) {
      const newSceneId = sceneMap.get(s.id)!;
      insertScene.run(newSceneId, newId, s.section_label, s.start_time, s.end_time, s.lyrics, s.narrative_description, s.sort_order);
      const shots = db.prepare('SELECT * FROM shots WHERE scene_id = ? ORDER BY sort_order').all(s.id) as any[];
      for (const shot of shots) {
        // Remap cast_ids JSON array.
        let newCastIds = '[]';
        try {
          const ids = JSON.parse(shot.cast_ids || '[]') as string[];
          newCastIds = JSON.stringify(ids.map(id => castMap.get(id) || id).filter(Boolean));
        } catch {}
        insertShot.run(
          uuidv4(), newSceneId, shot.visual_prompt, shot.motion_prompt, shot.duration,
          newCastIds, remapAsset(shot.image_asset_id), remapAsset(shot.video_asset_id),
          shot.image_status, shot.video_status, shot.critique, shot.attempt_count,
          shot.use_next_as_end_frame, shot.sort_order,
          remapAsset(shot.end_image_asset_id), shot.end_image_status,
          shot.locked, shot.user_feedback,
          shot.environment_id ? (envMap.get(shot.environment_id) || null) : null,
          remapAsset(shot.extracted_last_frame_asset_id),
          shot.continuity_description, shot.continuity_from,
        );
      }
    }
    // Note: chat_messages and ai_calls are NOT copied — those belong to the original
    // project's history. The fork starts with a clean audit log.
  });
  tx();

  return newId;
};

export { forkProject };

// ─── Helper: build full project response ────────────────────────────

const getFullProject = (projectId: string) => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;

  const cast = db.prepare('SELECT * FROM cast_members WHERE project_id = ? ORDER BY sort_order').all(projectId);
  const environments = db.prepare('SELECT * FROM environments WHERE project_id = ? ORDER BY sort_order').all(projectId) as any[];
  const scenes = db.prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY sort_order').all(projectId) as any[];
  const chatMessages = db.prepare('SELECT role, text FROM chat_messages WHERE project_id = ? ORDER BY id').all(projectId);

  // Attach shots to scenes
  for (const scene of scenes) {
    scene.shots = db.prepare('SELECT * FROM shots WHERE scene_id = ? ORDER BY sort_order').all(scene.id);
    // Resolve shot image/video/end-frame asset paths to URLs
    for (const shot of scene.shots as any[]) {
      if (shot.image_asset_id) {
        const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(shot.image_asset_id);
        if (asset) shot.imageUrl = `/storage/${asset.file_path}`;
      }
      if (shot.end_image_asset_id) {
        const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(shot.end_image_asset_id);
        if (asset) shot.endImageUrl = `/storage/${asset.file_path}`;
      }
      if (shot.extracted_last_frame_asset_id) {
        const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(shot.extracted_last_frame_asset_id);
        if (asset) shot.extractedLastFrameUrl = `/storage/${asset.file_path}`;
      }
      if (shot.video_asset_id) {
        const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(shot.video_asset_id);
        if (asset) shot.videoUrl = `/storage/${asset.file_path}`;
      }
      shot.castIds = JSON.parse(shot.cast_ids || '[]');
      shot.critique = shot.critique ? JSON.parse(shot.critique) : undefined;
    }
  }

  // Resolve cast reference images
  for (const member of cast as any[]) {
    if (member.reference_asset_id) {
      const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(member.reference_asset_id);
      if (asset) member.referenceImageUrl = `/storage/${asset.file_path}`;
    }
  }

  // Resolve environment reference images
  for (const env of environments) {
    if (env.reference_asset_id) {
      const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(env.reference_asset_id);
      if (asset) env.referenceImageUrl = `/storage/${asset.file_path}`;
    }
  }

  // Resolve style asset
  let styleAssetUrl: string | undefined;
  if (project.style_asset_id) {
    const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(project.style_asset_id);
    if (asset) styleAssetUrl = `/storage/${asset.file_path}`;
  }

  return {
    id: project.id,
    title: project.title,
    status: project.status,
    audioPath: project.audio_path,
    lyrics: project.lyrics,
    meaning: project.meaning,
    musicalStructure: project.musical_structure ? JSON.parse(project.musical_structure) : [],
    conceptOptions: project.concept_options ? JSON.parse(project.concept_options) : [],
    lockedConcept: project.locked_concept ? JSON.parse(project.locked_concept) : null,
    styleDescription: project.style_description,
    styleAssetUrl,
    styleExploration: project.style_exploration ? JSON.parse(project.style_exploration) : null,
    colorPalette: project.color_palette,
    videoMode: project.video_mode,
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
      referenceAssetId: c.reference_asset_id,
      referenceImageUrl: c.referenceImageUrl,
    })),
    environments: environments.map((e: any) => ({
      id: e.id,
      name: e.name,
      description: e.description,
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
        continuityFrom: shot.continuity_from || 'cut',
        endImageStatus: shot.end_image_status || 'idle',
        locked: !!shot.locked,
        userFeedback: shot.user_feedback || undefined,
        environmentId: shot.environment_id || undefined,
        videoUrl: shot.videoUrl,
        imageStatus: shot.image_status,
        videoStatus: shot.video_status,
        critique: shot.critique,
        attemptCount: shot.attempt_count,
        useNextAsEndFrame: !!shot.use_next_as_end_frame,
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
router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, title, status, created_at, updated_at, parent_project_id
    FROM projects ORDER BY updated_at DESC
  `).all() as any[];
  res.json(rows.map(r => ({
    id: r.id,
    title: r.title,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    parentProjectId: r.parent_project_id || undefined,
  })));
});

// Get single project (full state)
router.get('/:id', (req, res) => {
  const project = getFullProject(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// Create project + upload audio + run analysis
router.post('/', upload.single('audio'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Audio file required' });

  const projectId = uuidv4();
  const ext = path.extname(file.originalname).slice(1) || 'mp3';
  const audioPath = saveBuffer(file.buffer, 'audio', ext);
  const title = req.body.title || file.originalname.replace(/\.[^/.]+$/, '');
  const language = req.body.language || undefined;
  const context = req.body.context || undefined;

  // Create project in DB
  db.prepare(`
    INSERT INTO projects (id, title, status, audio_path)
    VALUES (?, ?, 'analyzing', ?)
  `).run(projectId, title, audioPath);

  // Run analysis (synchronous for simplicity — client shows spinner)
  try {
    const audioBase64 = readAsBase64(audioPath);
    const audioMime = mimeFromExt(audioPath);
    const audioRef = [{ type: 'audio' as const, label: 'Uploaded audio', url: `/storage/${audioPath}` }];

    // Phase 1a: parallel lyrics + structure (audio analysis via Gemini)
    console.log(`[${projectId}] Analyzing: lyrics + structure...`);
    const t0Phase1 = Date.now();
    const [lyricsResult, structureResult] = await Promise.allSettled([
      transcribeLyrics(audioBase64, audioMime, language),
      detectStructure(audioBase64, audioMime),
    ]);
    const phase1Duration = Date.now() - t0Phase1;

    const lyrics = lyricsResult.status === 'fulfilled' ? lyricsResult.value : '';
    const musicalStructure = structureResult.status === 'fulfilled' ? structureResult.value : [];

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
    db.prepare(`
      UPDATE projects SET
        status = 'analyzed',
        lyrics = ?,
        musical_structure = ?,
        meaning = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(lyrics, JSON.stringify(musicalStructure), meaning, projectId);

    res.json(getFullProject(projectId));
  } catch (err: any) {
    console.error(`[${projectId}] Analysis failed:`, err);
    db.prepare("UPDATE projects SET status = 'error', updated_at = datetime('now') WHERE id = ?").run(projectId);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

// Generate concept options (separate from analysis)
router.post('/:id/generate-concepts', async (req, res) => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const lyrics = req.body.lyrics ?? project.lyrics ?? '';
  const context = req.body.context || undefined;
  const userNote = req.body.userNote || undefined;
  const title = project.title;
  const language = req.body.language || undefined;
  const musicalStructure = project.musical_structure ? JSON.parse(project.musical_structure) : [];

  // If user edited lyrics, save them
  if (req.body.lyrics && req.body.lyrics !== project.lyrics) {
    db.prepare("UPDATE projects SET lyrics = ?, updated_at = datetime('now') WHERE id = ?").run(req.body.lyrics, paramStr(req.params.id));
  }

  try {
    console.log(`[${project.id}] Generating concept options${userNote ? ` with note: ${userNote}` : ''}...`);
    const t0 = Date.now();
    const meaning = project.meaning || '';
    const result = await generateConceptOptions(title, language || 'Unknown', lyrics, meaning, musicalStructure, context, userNote);
    const conceptOptions = result.concepts;
    const durationMs = Date.now() - t0;

    // Cache prompt for transparency
    db.prepare('UPDATE projects SET last_concept_prompt = ? WHERE id = ?').run(result.prompt, paramStr(req.params.id));

    logCall({
      projectId: project.id,
      stage: 'generate-concepts',
      model: 'claude-opus-4-6',
      prompt: `Generate EXACTLY 3 creative concept directions for "${title}"${language ? ` (${language})` : ''}${context ? ` — Context: ${context}` : ''}\n\nLyrics:\n${lyrics}\n\nStructure:\n${musicalStructure.map((s: any) => `${s.label} [${s.startTime}–${s.endTime}]`).join(', ')}`,
      responseSummary: conceptOptions.map((c: any, i: number) =>
        `[${i + 1}] ${c.conceptDirection} — ${c.mood} / ${c.visualSuggestions?.artStyle || 'N/A'} / ${c.visualSuggestions?.colorPalette || 'N/A'}\n    Theme: ${c.theme}`
      ).join('\n'),
      durationMs,
      costEstimate: 0.01,
    });

    db.prepare(`
      UPDATE projects SET
        concept_options = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(conceptOptions), paramStr(req.params.id));

    res.json(getFullProject(paramStr(req.params.id)));
  } catch (err: any) {
    console.error(`[${project.id}] Concept generation failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'generate-concepts',
      model: 'claude-opus-4-6',
      prompt: `Generate concepts for "${title}"`,
      durationMs: 0,
      error: err.message,
    });
    res.status(500).json({ error: err.message || 'Concept generation failed' });
  }
});

// Lock concept choice
router.post('/:id/lock-concept', (req, res) => {
  const { conceptIndex } = req.body;
  const project: any = db.prepare('SELECT concept_options FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const options = JSON.parse(project.concept_options || '[]');
  if (conceptIndex < 0 || conceptIndex >= options.length) {
    return res.status(400).json({ error: 'Invalid concept index' });
  }

  const chosen = options[conceptIndex];

  // Don't create cast here — the script phase will propose the full cast.
  // Don't set style_description here — that's the style phase's job.
  // Only lock the concept narrative (mood, theme, deity, direction).
  db.prepare(`
    UPDATE projects SET
      status = 'concept_locked',
      locked_concept = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    JSON.stringify(chosen),
    paramStr(req.params.id)
  );

  res.json(getFullProject(paramStr(req.params.id)));
});

// Unlock concept — cascade-wipe everything downstream. Client is expected
// to confirm with the user before calling this since any script / style /
// character / environment work will be lost. Pass { fork: true } to fork first.
router.post('/:id/unlock-concept', (req, res) => {
  const sourceId = paramStr(req.params.id);
  const projectId = req.body?.fork === true ? forkProject(sourceId) : sourceId;
  const shotsWithContent = (db.prepare(
    `SELECT COUNT(*) as n FROM shots WHERE (image_asset_id IS NOT NULL OR video_asset_id IS NOT NULL)
     AND scene_id IN (SELECT id FROM scenes WHERE project_id = ?)`
  ).get(projectId) as any)?.n || 0;
  if (shotsWithContent > 0 && req.body?.force !== true) {
    return res.status(400).json({ error: `Cannot unlock — ${shotsWithContent} shot(s) have generated images or videos. Pass force=true to discard and reset.` });
  }

  // Wipe downstream creative decisions
  db.prepare('DELETE FROM scenes WHERE project_id = ?').run(projectId);
  db.prepare(`
    UPDATE projects SET
      status = 'analyzed',
      locked_concept = NULL,
      style_asset_id = NULL,
      style_description = NULL,
      style_exploration = NULL,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(projectId);
  res.json(getFullProject(projectId));
});

// Update project settings
router.patch('/:id', (req, res) => {
  const { title, videoMode, targetDuration, styleDescription, colorPalette, videoModel, aspectRatio, videoResolution } = req.body;
  const sets: string[] = [];
  const vals: any[] = [];

  if (title !== undefined) { sets.push('title = ?'); vals.push(title); }
  if (videoMode !== undefined) { sets.push('video_mode = ?'); vals.push(videoMode); }
  if (videoModel !== undefined) { sets.push('video_model = ?'); vals.push(videoModel); }
  if (aspectRatio !== undefined) { sets.push('aspect_ratio = ?'); vals.push(aspectRatio); }
  if (videoResolution !== undefined) { sets.push('video_resolution = ?'); vals.push(videoResolution); }
  if (targetDuration !== undefined) { sets.push('target_duration = ?'); vals.push(targetDuration); }
  if (styleDescription !== undefined) { sets.push('style_description = ?'); vals.push(styleDescription); }
  if (colorPalette !== undefined) { sets.push('color_palette = ?'); vals.push(colorPalette); }
  if (req.body.styleExploration !== undefined) { sets.push('style_exploration = ?'); vals.push(JSON.stringify(req.body.styleExploration)); }

  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

  sets.push("updated_at = datetime('now')");
  vals.push(paramStr(req.params.id));

  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json(getFullProject(paramStr(req.params.id)));
});

// Delete project
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(paramStr(req.params.id));
  res.json({ ok: true });
});

// Fork — deep-copy a project as a new one. Used before destructive ops
// so the original stays frozen as a snapshot.
router.post('/:id/fork', (req, res) => {
  try {
    const newId = forkProject(paramStr(req.params.id));
    res.json(getFullProject(newId));
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
  const projectId = req.body?.fork === true ? forkProject(sourceId) : sourceId;
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.audio_path) return res.status(400).json({ error: 'No audio file on this project' });

  try {
    const audioBase64 = readAsBase64(project.audio_path);
    const audioMime = mimeFromExt(project.audio_path);
    const audioRef = [{ type: 'audio' as const, label: 'Project audio', url: `/storage/${project.audio_path}` }];

    const t0 = Date.now();
    const [structureResult, meaningResult] = await Promise.allSettled([
      detectStructure(audioBase64, audioMime),
      project.lyrics
        ? summarizeMeaning(project.title || 'Untitled', 'Unknown', project.lyrics, '')
        : Promise.resolve(''),
    ]);
    const analysisMs = Date.now() - t0;

    const musicalStructure = structureResult.status === 'fulfilled' ? structureResult.value : [];
    const meaning = meaningResult.status === 'fulfilled' ? meaningResult.value : '';

    if (structureResult.status === 'rejected') console.warn(`[${projectId}] structure failed:`, structureResult.reason);
    if (meaningResult.status === 'rejected') console.warn(`[${projectId}] meaning failed:`, meaningResult.reason);

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

    if (project.lyrics) {
      logCall({
        projectId,
        stage: 'summarize-meaning',
        model: 'claude-sonnet-4-6',
        prompt: `Re-run: summarize meaning of "${project.title}".`,
        responseSummary: meaning || 'FAILED',
        durationMs: analysisMs,
        costEstimate: 0.005,
        error: meaningResult.status === 'rejected' ? String(meaningResult.reason) : undefined,
      });
    }

    db.prepare(
      `UPDATE projects SET musical_structure = ?, meaning = ?, status = CASE WHEN status = 'uploaded' OR status = 'analyzing' THEN 'analyzed' ELSE status END, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(musicalStructure), meaning, projectId);

    res.json(getFullProject(projectId));
  } catch (err: any) {
    console.error(`[${projectId}] re-analysis failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Cast Management ────────────────────────────────────────────────

router.post('/:id/cast', (req, res) => {
  const { name, description } = req.body;
  const memberId = uuidv4();
  const maxOrder: any = db.prepare('SELECT MAX(sort_order) as m FROM cast_members WHERE project_id = ?').get(paramStr(req.params.id));
  db.prepare(`INSERT INTO cast_members (id, project_id, name, description, sort_order) VALUES (?, ?, ?, ?, ?)`)
    .run(memberId, paramStr(req.params.id), name || 'New Character', description || '', (maxOrder?.m || 0) + 1);
  res.json(getFullProject(paramStr(req.params.id)));
});

router.put('/:id/cast/:memberId', (req, res) => {
  const { name, description } = req.body;
  if (name !== undefined) db.prepare('UPDATE cast_members SET name = ? WHERE id = ?').run(name, paramStr(req.params.memberId));
  if (description !== undefined) db.prepare('UPDATE cast_members SET description = ? WHERE id = ?').run(description, paramStr(req.params.memberId));
  res.json(getFullProject(paramStr(req.params.id)));
});

router.delete('/:id/cast/:memberId', (req, res) => {
  db.prepare('DELETE FROM cast_members WHERE id = ?').run(paramStr(req.params.memberId));
  res.json(getFullProject(paramStr(req.params.id)));
});

// ─── Environment Management ──────────────────────────────────────────

router.post('/:id/environments', (req, res) => {
  const { name, description } = req.body;
  const envId = uuidv4();
  const maxOrder: any = db.prepare('SELECT MAX(sort_order) as m FROM environments WHERE project_id = ?').get(paramStr(req.params.id));
  db.prepare(`INSERT INTO environments (id, project_id, name, description, sort_order) VALUES (?, ?, ?, ?, ?)`)
    .run(envId, paramStr(req.params.id), name || 'New Environment', description || '', (maxOrder?.m || 0) + 1);
  res.json(getFullProject(paramStr(req.params.id)));
});

router.put('/:id/environments/:envId', (req, res) => {
  const { name, description } = req.body;
  if (name !== undefined) db.prepare('UPDATE environments SET name = ? WHERE id = ?').run(name, paramStr(req.params.envId));
  if (description !== undefined) db.prepare('UPDATE environments SET description = ? WHERE id = ?').run(description, paramStr(req.params.envId));
  res.json(getFullProject(paramStr(req.params.id)));
});

router.delete('/:id/environments/:envId', (req, res) => {
  db.prepare('DELETE FROM environments WHERE id = ?').run(paramStr(req.params.envId));
  res.json(getFullProject(paramStr(req.params.id)));
});

// ─── X-Ray: AI Call Log ──────────────────────────────────────────────

router.get('/:id/xray', (req, res) => {
  const project: any = db.prepare('SELECT id FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const calls = getCalls(paramStr(req.params.id));
  const context = buildContextChain(paramStr(req.params.id));

  // Resolve output asset IDs → URLs for image/video thumbnails
  const enriched = calls.map(call => {
    const outputAssets = call.outputAssetIds.map(assetId => {
      const asset: any = db.prepare('SELECT id, file_path, category FROM assets WHERE id = ?').get(assetId);
      return asset ? { id: asset.id, url: `/storage/${asset.file_path}`, category: asset.category } : { id: assetId };
    });
    return { ...call, outputAssets };
  });

  res.json({ calls: enriched, currentContext: context });
});

// ─── Shot Updates ───────────────────────────────────────────────────

router.patch('/:id/shots/:shotId', (req, res) => {
  const { visualPrompt, motionPrompt, useNextAsEndFrame, userFeedback, continuityFrom } = req.body;
  if (visualPrompt !== undefined) db.prepare('UPDATE shots SET visual_prompt = ? WHERE id = ?').run(visualPrompt, req.params.shotId);
  if (motionPrompt !== undefined) db.prepare('UPDATE shots SET motion_prompt = ? WHERE id = ?').run(motionPrompt, req.params.shotId);
  if (useNextAsEndFrame !== undefined) db.prepare('UPDATE shots SET use_next_as_end_frame = ? WHERE id = ?').run(useNextAsEndFrame ? 1 : 0, req.params.shotId);
  if (userFeedback !== undefined) db.prepare('UPDATE shots SET user_feedback = ? WHERE id = ?').run(userFeedback || null, req.params.shotId);
  if (continuityFrom !== undefined && (continuityFrom === 'cut' || continuityFrom === 'prev_shot')) {
    db.prepare('UPDATE shots SET continuity_from = ? WHERE id = ?').run(continuityFrom, req.params.shotId);
  }
  res.json(getFullProject(paramStr(req.params.id)));
});

export { router as projectsRouter, getFullProject };
