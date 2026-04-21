import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { selectAll, selectOne, insertRow, insertMany, updateRows, deleteRows, countRows, maxVal, selectColumns, findShot, incrementColumn, getSB, T } from '../database.js';
import { readAsBase64, mimeFromExt, saveBase64, saveBuffer, storageUrl } from '../storage.js';
import { generateStyleOptions, generateCharacterLooks, buildCharacterPrompt, generateSingleStyleImage, buildStylePrompt, generateEnvironmentLooks, buildEnvironmentPrompt, generateShotStartFrame } from '../services/imagen.js';
import { critiqueShotImage, chatWithDirector, describeFrame } from '../services/gemini.js';
import { planScenes, refineScript, writeShotPrompts, brainstormStyleDirections, refineStyleDirection, enrichStyleDNA, analyzeImageStyle, refineShotPrompt, refreshChainedShotPrompt } from '../services/claude.js';
import { extractLastFrame } from '../services/ffmpeg.js';
import { generateSegmindVideo, SEGMIND_MODELS, SegmindModelKey } from '../services/segmind.js';
import { getFullProject, forkProject } from './projects.js';
import { logCall, buildContextChain } from '../xray.js';
import { paramStr, ScopeError, requireCastMember, requireEnvironment, requireAsset } from './scope-helpers.js';
import { mountVideoRoutes } from './generate-video.js';
import { mountStyleRoutes } from './generate-style.js';
import { mountLooksRoutes } from './generate-looks.js';

const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Parse "M:SS" or "MM:SS" to seconds
const parseTimestamp = (t: string): number => {
  if (!t || !t.includes(':')) return 0;
  const parts = t.split(':').map(Number);
  return parts[0] * 60 + (parts[1] || 0);
};

// Scope helpers imported from scope-helpers.ts — centralized for all generate routes

// Ownership check for all /:id/* routes — verify user owns the project
router.param('id', async (req, res, next, id) => {
  const projectId = Array.isArray(id) ? id[0] : id;
  const row = await selectOne('projects', { id: projectId });
  if (!row) return res.status(404).json({ error: 'Project not found' });
  if (row.user_id !== req.userId) return res.status(403).json({ error: 'Access denied' });
  next();
});

// Child scoping: verify shotId belongs to a scene in this project
router.param('sceneId', async (req, res, next, sceneId) => {
  const sid = Array.isArray(sceneId) ? sceneId[0] : sceneId;
  const scene = await selectOne('scenes', { id: sid });
  if (!scene) return res.status(404).json({ error: 'Scene not found' });
  if (scene.project_id !== paramStr(req.params.id)) return res.status(403).json({ error: 'Scene does not belong to this project' });
  next();
});

router.param('shotId', async (req, res, next, shotId) => {
  const sid = Array.isArray(shotId) ? shotId[0] : shotId;
  const shot = await selectOne('shots', { id: sid });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });
  const scene = await selectOne('scenes', { id: shot.scene_id });
  if (!scene || scene.project_id !== paramStr(req.params.id)) return res.status(403).json({ error: 'Shot does not belong to this project' });
  next();
});

// ─── Generate Style Options ─────────────────────────────────────────

router.post('/:id/generate-styles', async (req, res) => {
  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const concept = JSON.parse(project.locked_concept || '{}');
  const { notes } = req.body;

  const prompt = `Generate 4 style options for "${concept.deity || project.title}" — ${notes || project.style_description || 'cinematic, photorealistic'}`;

  try {
    console.log(`[${project.id}] Generating style options...`);
    const t0 = Date.now();
    const styles = await generateStyleOptions(
      concept.deity || project.title,
      notes || project.style_description
    );
    const durationMs = Date.now() - t0;

    // Save as assets
    const assetIds: { id: string; style: string; url: string }[] = [];
    for (const s of styles) {
      const assetId = uuidv4();
      await insertRow('assets', { id: assetId, project_id: project.id, category: 'style', file_path: s.assetPath, prompt: s.style });
      assetIds.push({ id: assetId, style: s.style, url: storageUrl(s.assetPath) });
    }

    await logCall({
      projectId: project.id,
      stage: 'generate-styles',
      model: 'imagen-4.0-generate-001',
      prompt,
      contextChain: await buildContextChain(project.id),
      responseSummary: `Generated ${styles.length} style images: ${assetIds.map(a => a.style).join(', ')}`,
      outputAssetIds: assetIds.map(a => a.id),
      durationMs,
      costEstimate: 0.04,
    });

    res.json({ styles: assetIds, project: await getFullProject(project.id) });
  } catch (err: any) {
    console.error(`[${project.id}] Style generation failed:`, err);
    await logCall({
      projectId: project.id,
      stage: 'generate-styles',
      model: 'imagen-4.0-generate-001',
      prompt,
      contextChain: await buildContextChain(project.id),
      durationMs: 0,
      error: err.message,
    });
    res.status((err as any).statusCode || 500).json({ error: err.message });
  }
});


// brainstorm-styles, visualize-style, refine-style-direction, lock-style → generate-style.ts


// ─── Phase unlock endpoints ─────────────────────────────────────────
// All unlocks allow reverting by one step. Downstream-facing phases
// (style, characters, environments) can be unlocked as long as nothing
// was generated after that phase. Script unlock blocks if shots have
// locked content (images/videos).

// All unlocks are pure navigation — they revert the phase marker so the
// user can browse options again, but don't wipe any data. Destructive
// events happen when the user actively picks/regenerates something new
// (e.g. lock-concept with a different choice, generate-script re-run).
router.post('/:id/unlock-script', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.status !== 'scripted') {
    return res.status(400).json({ error: `Cannot unlock script from status "${project.status}". Unlock later phases first.` });
  }
  await updateRows('projects', { id: projectId }, { status: 'concept_locked', updated_at: new Date().toISOString() });
  res.json({ ok: true, status: 'concept_locked' });
});

router.post('/:id/unlock-style', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.status !== 'style_locked') {
    return res.status(400).json({ error: `Cannot unlock style from status "${project.status}". Unlock later phases first.` });
  }
  await updateRows('projects', { id: projectId }, { status: 'scripted', updated_at: new Date().toISOString() });
  res.json({ ok: true, status: 'scripted' });
});

router.post('/:id/unlock-characters', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.status !== 'characters_locked') {
    return res.status(400).json({ error: `Cannot unlock characters from status "${project.status}". Unlock later phases first.` });
  }
  await updateRows('projects', { id: projectId }, { status: 'style_locked', updated_at: new Date().toISOString() });
  res.json({ ok: true, status: 'style_locked' });
});

router.post('/:id/unlock-environments', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.status !== 'environments_locked' && project.status !== 'in_production') {
    return res.status(400).json({ error: `Cannot unlock environments from status "${project.status}".` });
  }
  await updateRows('projects', { id: projectId }, { status: 'characters_locked', updated_at: new Date().toISOString() });
  res.json({ ok: true, status: 'characters_locked' });
});


// upload-and-lock-style, analyze-style-image → generate-style.ts



// generate-looks, lock-character, upload-character-reference, advance-characters,
// generate-environment-look, lock-environment, upload-environment-reference, advance-environments
// → generate-looks.ts


// ─── Generate Script ────────────────────────────────────────────────

router.post('/:id/generate-script', async (req, res) => {
  // Destructive on re-run: wipes cast + deletes existing scenes. Pass
  // { fork: true } to fork first and run on the new project.
  const sourceId = paramStr(req.params.id);
  const projectId = req.body?.fork === true ? await forkProject(sourceId) : sourceId;
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.audio_path) return res.status(400).json({ error: 'No audio file' });

  const { userNote } = req.body || {};
  const concept = JSON.parse(project.locked_concept || '{}');

  const scriptPrompt = `Plan script + propose cast for "${project.title}" — Concept: ${concept.conceptDirection || concept.title} | Mood: ${concept.mood} | Mode: ${project.video_mode || 'montage'}${userNote ? ' | Note: ' + userNote : ''}`;

  try {
    console.log(`[${project.id}] Generating script + cast${userNote ? ' with note: ' + userNote : ''}...`);

    const t0 = Date.now();
    const data = await planScenes({
      concept,
      videoMode: project.video_mode || 'montage',
      lyrics: project.lyrics || '',
      meaning: project.meaning || '',
      musicalStructure: project.musical_structure || '',
      basePacing: project.target_duration || 8,
      userNote,
    });
    const durationMs = Date.now() - t0;

    // Cache the full prompt for transparency/View Prompt UI
    await updateRows('projects', { id: project.id }, { last_script_prompt: data.prompt });

    // ── Create proposed cast members ──
    // Clear old cast (script proposes fresh cast each time)
    await deleteRows('cast_members', { project_id: project.id });

    const nameToId: Record<string, string> = {};
    const proposedCast = data.cast || [];
    for (let idx = 0; idx < proposedCast.length; idx++) {
      const c = proposedCast[idx];
      const memberId = uuidv4();
      nameToId[c.name] = memberId;
      await insertRow('cast_members', {
        id: memberId,
        project_id: project.id,
        name: c.name || `Character ${idx + 1}`,
        description: c.description || 'To be defined',
        sort_order: idx,
      });
    }

    // ── Create proposed environments ──
    await deleteRows('environments', { project_id: project.id });

    const envNameToId: Record<string, string> = {};
    const proposedEnvironments = data.environments || [];
    for (let idx = 0; idx < proposedEnvironments.length; idx++) {
      const e = proposedEnvironments[idx];
      const envId = uuidv4();
      envNameToId[e.name] = envId;
      await insertRow('environments', {
        id: envId,
        project_id: project.id,
        name: e.name || `Environment ${idx + 1}`,
        description: e.description || '',
        sort_order: idx,
      });
    }

    // ── Clear old scenes/shots ──
    const oldScenes = await selectColumns('scenes', 'id', { project_id: project.id });
    for (const s of oldScenes) {
      await deleteRows('shots', { scene_id: s.id });
    }
    await deleteRows('scenes', { project_id: project.id });

    // ── Insert new scenes and shots ──
    let totalShots = 0;
    for (let sIdx = 0; sIdx < (data.scenes || []).length; sIdx++) {
      const scene = data.scenes[sIdx];
      const sceneId = scene.id || uuidv4();
      await insertRow('scenes', {
        id: sceneId,
        project_id: project.id,
        section_label: scene.sectionLabel || `Scene ${sIdx + 1}`,
        start_time: scene.startTime || '0:00',
        end_time: scene.endTime || '0:00',
        lyrics: scene.lyrics || '',
        narrative_description: scene.narrativeDescription || '',
        sort_order: sIdx,
      });

      // Calculate per-shot durations: base pacing for all, last shot gets remainder (clamped)
      const basePacing = project.target_duration || 8;
      const sceneStartSec = parseTimestamp(scene.startTime);
      const sceneEndSec = parseTimestamp(scene.endTime);
      const sceneDuration = Math.max(0, sceneEndSec - sceneStartSec);
      const shotCount = (scene.shots || []).length;

      for (let shIdx = 0; shIdx < shotCount; shIdx++) {
        const shot = scene.shots[shIdx];
        const shotId = uuidv4();
        // Map castNames → castIds using the name→id lookup
        const castNames: string[] = shot.castNames || [];
        const castIds = castNames.map((name: string) => nameToId[name] || name).filter(Boolean);
        // Map environmentName → environmentId
        const envId = shot.environmentName ? (envNameToId[shot.environmentName] || null) : null;

        // Last shot gets remainder (with ceil pacing, remainder ≤ basePacing). Safety clamp at 2×.
        let duration = basePacing;
        if (shIdx === shotCount - 1 && sceneDuration > 0) {
          const remainder = sceneDuration - (shotCount - 1) * basePacing;
          duration = Math.max(1, Math.min(remainder, basePacing * 2));
        }

        // Store direction as visual_prompt placeholder — writeShotPrompts will overwrite later
        await insertRow('shots', {
          id: shotId,
          scene_id: sceneId,
          visual_prompt: shot.direction || '',
          motion_prompt: '',  // motion_prompt left empty — writeShotPrompts fills it
          duration,
          cast_ids: JSON.stringify(castIds),
          use_next_as_end_frame: project.video_mode === 'cinematic' ? 1 : 0,
          sort_order: shIdx,
          environment_id: envId,
        });
        totalShots++;
      }
    }

    await logCall({
      projectId: project.id,
      stage: 'generate-script',
      model: 'claude-opus-4-6',
      prompt: scriptPrompt,
      referenceInputs: [],
      contextChain: await buildContextChain(project.id),
      responseSummary: `Proposed ${proposedCast.length} cast members, ${proposedEnvironments.length} environments. Generated ${(data.scenes || []).length} scenes with ${totalShots} total shots.`,
      durationMs,
      costEstimate: 0.02,
    });

    await updateRows('projects', { id: project.id }, { status: 'scripted', updated_at: new Date().toISOString() });
    await incrementColumn('projects', { id: project.id }, 'cost_estimate', 0.02);

    res.json(await getFullProject(project.id));
  } catch (err: any) {
    console.error(`[${project.id}] Script gen failed:`, err);
    await logCall({
      projectId: project.id,
      stage: 'generate-script',
      model: 'claude-opus-4-6',
      prompt: scriptPrompt,
      referenceInputs: [],
      contextChain: await buildContextChain(project.id),
      durationMs: 0,
      error: err.message,
    });
    res.status((err as any).statusCode || 500).json({ error: err.message });
  }
});

// ─── Refine Script (surgical edit) ─────────────────────────────────
// Claude sees the current script + director feedback, returns the updated script.
// Preserves existing cast/env references — only updates structure + assignments.

router.post('/:id/refine-script', async (req, res) => {
  const { feedback } = req.body;
  if (!feedback?.trim()) return res.status(400).json({ error: 'Feedback required' });

  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const concept = JSON.parse(project.locked_concept || '{}');
  const existingCast = await selectAll('cast_members', { project_id: project.id }, { orderBy: 'sort_order' });
  const existingEnvs = await selectAll('environments', { project_id: project.id }, { orderBy: 'sort_order' });
  const existingScenes = await selectAll('scenes', { project_id: project.id }, { orderBy: 'sort_order' });

  // Build current script structure for Claude
  const currentScript: any = {
    cast: existingCast,
    environments: existingEnvs,
    scenes: [],
  };
  for (const scene of existingScenes) {
    const shots = await selectAll('shots', { scene_id: scene.id }, { orderBy: 'sort_order' });
    currentScript.scenes.push({
      ...scene,
      sectionLabel: scene.section_label,
      startTime: scene.start_time,
      endTime: scene.end_time,
      narrativeDescription: scene.narrative_description,
      shots: shots.map((sh: any) => ({
        direction: sh.visual_prompt || sh.direction || '',
        castNames: JSON.parse(sh.cast_ids || '[]').map((id: string) =>
          existingCast.find((c: any) => c.id === id)?.name || id
        ),
        environmentName: sh.environment_id
          ? existingEnvs.find((e: any) => e.id === sh.environment_id)?.name || ''
          : '',
      }))
    });
  }

  try {
    console.log(`[${project.id}] Refining script with feedback: ${feedback.substring(0, 100)}...`);
    const t0 = Date.now();

    const data = await refineScript(currentScript, feedback, {
      concept,
      videoMode: project.video_mode || 'montage',
      lyrics: project.lyrics || '',
      meaning: project.meaning || '',
      musicalStructure: project.musical_structure || '',
      basePacing: project.target_duration || 8,
    });
    const durationMs = Date.now() - t0;

    // Build name→id maps for existing cast/envs (preserve references)
    const castNameToId = new Map<string, string>();
    for (const c of existingCast) castNameToId.set(c.name.toLowerCase(), c.id);
    const envNameToId = new Map<string, string>();
    for (const e of existingEnvs) envNameToId.set(e.name.toLowerCase(), e.id);

    // Upsert cast — keep existing (with reference images), add new
    const newCastNames = new Set(data.cast.map((c: any) => c.name.toLowerCase()));
    for (const c of data.cast) {
      if (!castNameToId.has(c.name.toLowerCase())) {
        const id = uuidv4();
        castNameToId.set(c.name.toLowerCase(), id);
        const maxOrder = await maxVal('cast_members', 'sort_order', { project_id: project.id });
        await insertRow('cast_members', {
          id, project_id: project.id, name: c.name,
          description: c.description || '', sort_order: maxOrder + 1,
        });
      } else {
        // Update description if Claude changed it
        const existingId = castNameToId.get(c.name.toLowerCase())!;
        const existing = existingCast.find((ec: any) => ec.id === existingId);
        if (existing && c.description && c.description !== existing.description) {
          await updateRows('cast_members', { id: existingId }, { description: c.description });
        }
      }
    }

    // Upsert environments — same pattern
    for (const e of data.environments) {
      if (!envNameToId.has(e.name.toLowerCase())) {
        const id = uuidv4();
        envNameToId.set(e.name.toLowerCase(), id);
        const maxOrder = await maxVal('environments', 'sort_order', { project_id: project.id });
        await insertRow('environments', {
          id, project_id: project.id, name: e.name,
          description: e.description || '', sort_order: maxOrder + 1,
        });
      } else {
        const existingId = envNameToId.get(e.name.toLowerCase())!;
        const existing = existingEnvs.find((ee: any) => ee.id === existingId);
        if (existing && e.description && e.description !== existing.description) {
          await updateRows('environments', { id: existingId }, { description: e.description });
        }
      }
    }

    // Replace scenes + shots with the refined version
    for (const s of existingScenes) {
      await deleteRows('shots', { scene_id: s.id });
    }
    await deleteRows('scenes', { project_id: project.id });

    for (let sIdx = 0; sIdx < data.scenes.length; sIdx++) {
      const scene = data.scenes[sIdx];
      const sceneId = uuidv4();
      await insertRow('scenes', {
        id: sceneId, project_id: project.id,
        section_label: scene.sectionLabel, start_time: scene.startTime, end_time: scene.endTime,
        narrative_description: scene.narrativeDescription, sort_order: sIdx,
      });

      for (let shIdx = 0; shIdx < (scene.shots || []).length; shIdx++) {
        const shot = scene.shots[shIdx];
        const castIds = (shot.castNames || [])
          .map((n: string) => castNameToId.get(n.toLowerCase()))
          .filter(Boolean);
        const envId = shot.environmentName ? envNameToId.get(shot.environmentName.toLowerCase()) : null;

        await insertRow('shots', {
          id: uuidv4(), scene_id: sceneId,
          visual_prompt: shot.direction, duration: shot.duration || project.target_duration || 8,
          cast_ids: JSON.stringify(castIds),
          environment_id: envId || null,
          sort_order: shIdx, image_status: 'idle', video_status: 'idle',
        });
      }
    }

    await updateRows('projects', { id: project.id }, {
      last_script_prompt: data.prompt,
      updated_at: new Date().toISOString(),
    });

    await logCall({
      projectId: project.id,
      stage: 'refine-script',
      model: 'claude-sonnet-4-6',
      prompt: `Refine script: "${feedback.substring(0, 200)}"`,
      contextChain: await buildContextChain(project.id),
      responseSummary: `Refined: ${data.scenes.length} scenes, ${data.cast.length} cast, ${data.environments.length} envs`,
      durationMs,
      costEstimate: 0.02,
    });

    res.json(await getFullProject(paramStr(req.params.id)));
  } catch (err: any) {
    console.error(`[${project.id}] Script refine failed:`, err);
    res.status((err as any).statusCode || 500).json({ error: err.message });
  }
});

// ─── Write Shot Prompts (after all creative decisions locked) ────────
// Input: project with script skeleton + locked style DNA + locked characters
// Output: visualPrompt + motionPrompt written into each shot record
// Stored: shots.visual_prompt, shots.motion_prompt (overwritten from direction placeholders)

router.post('/:id/write-shot-prompts', async (req, res) => {
  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.style_description) return res.status(400).json({ error: 'Style not locked yet' });
  const userNote: string | undefined = req.body?.userNote;

  const concept = JSON.parse(project.locked_concept || '{}');
  const cast = await selectAll('cast_members', { project_id: project.id }, { orderBy: 'sort_order', ascending: true });
  const scenes = await selectAll('scenes', { project_id: project.id }, { orderBy: 'sort_order', ascending: true });

  try {
    console.log(`[${project.id}] Writing shot prompts with full context...`);
    const t0 = Date.now();

    // Gather all shots with their scene context
    const allShots: { id: string; direction: string; duration: number; castNames: string[]; sceneNarrative: string; sceneLyrics: string }[] = [];
    for (const scene of scenes as any[]) {
      const shots = await selectAll('shots', { scene_id: scene.id }, { orderBy: 'sort_order', ascending: true });
      for (const shot of shots) {
        const shotCastIds = JSON.parse(shot.cast_ids || '[]');
        const shotCastNames = cast.filter((c: any) => shotCastIds.includes(c.id)).map((c: any) => c.name);
        allShots.push({
          id: shot.id,
          direction: shot.visual_prompt || '',  // was stored as direction placeholder
          duration: shot.duration,
          castNames: shotCastNames,
          sceneNarrative: scene.narrative_description || '',
          sceneLyrics: scene.lyrics || '',
        });
      }
    }

    // Write prompts in batches with continuity overlap
    const BATCH_SIZE = 15;
    let previousBatchTail: { id: string; visualPrompt: string; motionPrompt: string }[] | undefined;
    const batchPrompts: string[] = [];

    for (let i = 0; i < allShots.length; i += BATCH_SIZE) {
      const batch = allShots.slice(i, i + BATCH_SIZE);
      const result = await writeShotPrompts(batch, {
        styleDNA: project.style_description,
        cast: cast.map((c: any) => ({ name: c.name, description: c.description })),
        concept,
        lyrics: project.lyrics || '',
        userNote,
      }, previousBatchTail);
      const prompts = result.shots;
      batchPrompts.push(
        allShots.length > BATCH_SIZE
          ? `=== Batch ${Math.floor(i / BATCH_SIZE) + 1} (shots ${i + 1}–${Math.min(i + BATCH_SIZE, allShots.length)}) ===\n${result.prompt}`
          : result.prompt
      );

      // Write back to DB, including Claude's continuity decision per shot.
      // First shot of each scene is forced to 'cut' (scene boundaries are always hard cuts).
      const firstShotIdsPerScene = new Set<string>();
      for (const scene of scenes as any[]) {
        const firstShots = await selectAll('shots', { scene_id: scene.id }, { orderBy: 'sort_order', ascending: true, limit: 1 });
        if (firstShots.length > 0) firstShotIdsPerScene.add(firstShots[0].id);
      }

      for (const p of prompts) {
        const continuity = firstShotIdsPerScene.has(p.id) ? 'cut' : (p.continuityFrom || 'cut');
        await updateRows('shots', { id: p.id }, {
          visual_prompt: p.visualPrompt || '',
          motion_prompt: p.motionPrompt || '',
          continuity_from: continuity,
          prompts_stale: false,
        });
      }

      // Keep last 2 shots as continuity context for next batch
      if (prompts.length >= 2) {
        previousBatchTail = prompts.slice(-2);
      } else if (prompts.length === 1) {
        previousBatchTail = prompts;
      }
    }

    await updateRows('projects', { id: project.id }, { last_write_shots_prompt: batchPrompts.join('\n\n') });

    const durationMs = Date.now() - t0;
    console.log(`[${project.id}] Shot prompts written for ${allShots.length} shots in ${durationMs}ms`);

    await logCall({
      projectId: project.id,
      stage: 'write-shot-prompts',
      model: 'claude-opus-4-6',
      prompt: `Write visualPrompt + motionPrompt for ${allShots.length} shots with full style/character context`,
      contextChain: await buildContextChain(project.id),
      responseSummary: `Wrote prompts for ${allShots.length} shots`,
      durationMs,
      costEstimate: 0.02,
    });

    await incrementColumn('projects', { id: project.id }, 'cost_estimate', 0.02);
    await updateRows('projects', { id: project.id }, { updated_at: new Date().toISOString() });

    res.json(await getFullProject(project.id));
  } catch (err: any) {
    console.error(`[${project.id}] Write shot prompts failed:`, err);
    res.status((err as any).statusCode || 500).json({ error: err.message });
  }
});

// ─── Refine Shot Prompt (vision + rewrite) ─────────────────────────

router.post('/:id/shots/:shotId/refine-prompt', upload.single('referenceImage'), async (req, res) => {
  const feedback = req.body?.feedback;
  if (!feedback?.trim()) return res.status(400).json({ error: 'Feedback required' });

  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const shot = await selectOne('shots', { id: paramStr(req.params.shotId) });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });
  if (!shot.image_asset_id) return res.status(400).json({ error: 'No image to refine — generate one first' });

  const imageAsset = await selectOne('assets', { id: shot.image_asset_id });
  if (!imageAsset) return res.status(400).json({ error: 'Image asset not found' });

  const shotCastIds = JSON.parse(shot.cast_ids || '[]');
  const cast = await selectAll('cast_members', { project_id: paramStr(req.params.id) });
  const charDescs = cast
    .filter((c: any) => shotCastIds.includes(c.id))
    .map((c: any) => `${c.name}: ${c.description || 'no description'}`);

  // If user uploaded a reference image, save it and include in feedback text
  let refImageNote = '';
  if (req.file) {
    refImageNote = `\n[User attached a reference image — see the second image below for what they want it to look like]`;
  }

  try {
    const t0 = Date.now();
    const imageBase64 = await readAsBase64(imageAsset.file_path);
    const mime = mimeFromExt(imageAsset.file_path);

    // Build images array: failed attempt + optional user reference
    const images: { base64: string; mime: string; label: string }[] = [
      { base64: imageBase64, mime, label: 'Failed attempt' },
    ];
    if (req.file) {
      const refBase64 = req.file.buffer.toString('base64');
      const refMime = req.file.mimetype || 'image/png';
      images.push({ base64: refBase64, mime: refMime, label: 'User reference' });
    }

    const scene = await selectOne('scenes', { id: shot.scene_id });
    const env = shot.environment_id ? await selectOne('environments', { id: shot.environment_id }) : null;

    const result = await refineShotPrompt({
      currentVisualPrompt: shot.visual_prompt || '',
      currentMotionPrompt: shot.motion_prompt || 'Cinematic camera movement',
      feedback: feedback + refImageNote,
      failedImageBase64: imageBase64,
      failedImageMime: mime,
      referenceImageBase64: req.file ? req.file.buffer.toString('base64') : undefined,
      referenceImageMime: req.file ? (req.file.mimetype || 'image/png') : undefined,
      styleDNA: project.style_description || 'Cinematic',
      characterDescriptions: charDescs,
      sceneNarrative: scene?.narrative_description,
      environmentDescription: env?.description,
    });

    // Update the shot prompts with the rewritten versions
    await updateRows('shots', { id: shot.id }, {
      visual_prompt: result.visualPrompt,
      motion_prompt: result.motionPrompt,
      user_feedback: feedback,
      refined_from_prev_frame: 0,
      prompts_stale: false,
    });

    const durationMs = Date.now() - t0;
    await logCall({
      projectId: project.id,
      stage: 'refine-shot-prompt',
      model: 'claude-sonnet-4-6',
      prompt: `Refine: "${feedback}" | Original: "${(shot.visual_prompt || '').substring(0, 80)}…"`,
      referenceInputs: [{ type: 'image', label: 'Failed attempt', url: storageUrl(imageAsset.file_path) }],
      contextChain: await buildContextChain(project.id),
      responseSummary: `Rewritten: "${result.visualPrompt.substring(0, 100)}…"`,
      durationMs,
      costEstimate: 0.01,
    });

    res.json(await getFullProject(paramStr(req.params.id)));
  } catch (err: any) {
    console.error(`[shot ${shot.id}] Prompt refinement failed:`, err);
    res.status((err as any).statusCode || 500).json({ error: err.message });
  }
});

// ─── Generate Shot Start Frame (with full reference chain) ───────────

router.post('/:id/shots/:shotId/generate-image', async (req, res) => {
  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const shot = await selectOne('shots', { id: paramStr(req.params.shotId) });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  const scene = await selectOne('scenes', { id: shot.scene_id });

  // Sequential enforcement only for continuity-linked shots.
  // Hard-cut shots are independent and can generate in parallel.
  if (shot.continuity_from === 'prev_shot' && shot.sort_order > 0) {
    const prevShot = await findShot(shot.scene_id, shot.sort_order - 1);
    if (prevShot && !prevShot.video_asset_id) {
      return res.status(400).json({ error: 'Previous shot must have a generated video first (continuity dependency)' });
    }
  }

  const shotPrompt = shot.visual_prompt || '';
  const userFeedback = shot.user_feedback || undefined;

  // ─── Ref resolution: frontend-controlled or legacy auto ───
  // If req.body.refs is provided, the frontend controls exactly which refs go to Gemini.
  // Each ref is { type: 'cast'|'env'|'style'|'start-frame'|'end-frame'|'continuity'|'uploaded', id?: string }
  const frontendRefs: any[] | undefined = req.body?.refs;

  const resolveAssetPath = async (assetId: string): Promise<string | undefined> => {
    const a = await selectOne('assets', { id: assetId });
    return a?.file_path;
  };

  let characterRefs: { name: string; imagePath: string }[] = [];
  let environmentRef: { name: string; imagePath: string } | undefined;
  let styleImagePath: string | undefined;
  let prevShotEndFramePath: string | undefined;
  let continuityDescription: string | undefined = shot.continuity_description || undefined;
  let additionalRefs: { imagePath: string }[] = [];

  if (frontendRefs) {
    // Frontend controls refs — resolve each one
    const allCast = await selectAll('cast_members', { project_id: paramStr(req.params.id) });
    const allEnvs = await selectAll('environments', { project_id: paramStr(req.params.id) });
    for (const ref of frontendRefs) {
      if (ref.type === 'cast' && ref.id) {
        const c = allCast.find((m: any) => m.id === ref.id);
        if (c?.reference_asset_id) {
          const path = await resolveAssetPath(c.reference_asset_id);
          if (path) characterRefs.push({ name: c.name, imagePath: path });
        }
      } else if (ref.type === 'env' && ref.id) {
        const e = allEnvs.find((en: any) => en.id === ref.id);
        if (e?.reference_asset_id) {
          const path = await resolveAssetPath(e.reference_asset_id);
          if (path) environmentRef = { name: e.name, imagePath: path };
        }
      } else if (ref.type === 'style') {
        if (project.style_asset_id) styleImagePath = await resolveAssetPath(project.style_asset_id);
      } else if (ref.type === 'start-frame' && shot.image_asset_id) {
        const path = await resolveAssetPath(shot.image_asset_id);
        if (path) additionalRefs.push({ imagePath: path });
      } else if (ref.type === 'end-frame') {
        const endAssetId = shot.end_image_asset_id || shot.extracted_last_frame_asset_id;
        if (endAssetId) { const path = await resolveAssetPath(endAssetId); if (path) additionalRefs.push({ imagePath: path }); }
      } else if (ref.type === 'continuity') {
        if (shot.continuity_from === 'prev_shot' && shot.sort_order > 0) {
          const prevShot = await findShot(shot.scene_id, shot.sort_order - 1);
          const cid = prevShot?.extracted_last_frame_asset_id || prevShot?.end_image_asset_id;
          if (cid) prevShotEndFramePath = await resolveAssetPath(cid);
        }
      } else if (ref.type === 'uploaded' && ref.id) {
        const path = await resolveAssetPath(ref.id);
        if (path) additionalRefs.push({ imagePath: path });
      }
    }
  } else {
    // Legacy: auto-resolve all refs from DB (backward compat for bulk gen etc.)
    const shotCastIds = JSON.parse(shot.cast_ids || '[]');
    const cast = await selectAll('cast_members', { project_id: paramStr(req.params.id) });
    const activeCast = cast.filter((c: any) => shotCastIds.includes(c.id));

    if (project.style_asset_id) styleImagePath = await resolveAssetPath(project.style_asset_id);
    for (const c of activeCast) {
      if (c.reference_asset_id) {
        const path = await resolveAssetPath(c.reference_asset_id);
        if (path) characterRefs.push({ name: c.name, imagePath: path });
      }
    }
    if (shot.environment_id) {
      const env = await selectOne('environments', { id: shot.environment_id });
      if (env?.reference_asset_id) {
        const path = await resolveAssetPath(env.reference_asset_id);
        if (path) environmentRef = { name: env.name, imagePath: path };
      }
    }
    if (shot.continuity_from === 'prev_shot' && shot.sort_order > 0) {
      const prevShot = await findShot(shot.scene_id, shot.sort_order - 1);
      const cid = prevShot?.extracted_last_frame_asset_id || prevShot?.end_image_asset_id;
      if (cid) prevShotEndFramePath = await resolveAssetPath(cid);
    }
    const shotRefAssets = await selectAll('assets', { shot_id: shot.id, category: 'shot_ref' });
    additionalRefs = shotRefAssets.map((a: any) => ({ imagePath: a.file_path }));
  }

  // Vision-describe continuity frame (shared by both paths)
  if (prevShotEndFramePath && !continuityDescription) {
    try {
      const base64 = await readAsBase64(prevShotEndFramePath);
      const mime = mimeFromExt(prevShotEndFramePath);
      continuityDescription = await describeFrame(base64, mime);
      await updateRows('shots', { id: shot.id }, { continuity_description: continuityDescription });
    } catch (err: any) {
      console.warn(`[shot ${shot.id}] Continuity description failed: ${err.message}`);
    }
  }

  try {
    await updateRows('shots', { id: shot.id }, { image_status: 'loading' });
    const t0 = Date.now();

    console.log(`[shot ${shot.id}] Generating start frame with ${characterRefs.length} char refs, env: ${environmentRef?.name || 'none'}, continuity: ${prevShotEndFramePath ? 'yes' : 'no'}, extra: ${additionalRefs.length}`);

    let failedImagePath: string | undefined;
    if (userFeedback && shot.image_asset_id) {
      const failedAsset = await selectOne('assets', { id: shot.image_asset_id });
      if (failedAsset) failedImagePath = failedAsset.file_path;
    }

    const imagePath = await generateShotStartFrame({
      visualPrompt: shotPrompt,
      styleDNA: project.style_description || 'Cinematic',
      styleImagePath,
      characterRefs,
      environmentRef,
      prevShotEndFramePath,
      continuityDescription,
      userFeedback,
      failedImagePath,
      aspectRatio: project.aspect_ratio || '16:9',
      additionalRefs: additionalRefs.length > 0 ? additionalRefs : undefined,
    });

    const durationMs = Date.now() - t0;

    // Save asset
    const assetId = uuidv4();
    await insertRow('assets', { id: assetId, project_id: project.id, shot_id: shot.id, category: 'shot_image', file_path: imagePath, prompt: shotPrompt });

    // Only clear last_error if no other operation is in error state
    const clearError = shot.end_image_status !== 'error' && shot.video_status !== 'error';
    await updateRows('shots', { id: shot.id }, {
      image_asset_id: assetId,
      image_status: 'success',
      ...(clearError ? { last_error: null } : {}),
      user_feedback: null,
      prompts_stale: false,
    });

    await logCall({
      projectId: project.id,
      stage: 'generate-shot-start-frame',
      model: 'gemini-3-pro-image-preview',
      prompt: shotPrompt,
      referenceInputs: [
        ...(styleImagePath ? [{ type: 'image' as const, label: 'Style ref', url: storageUrl(styleImagePath) }] : []),
        ...characterRefs.map(r => ({ type: 'image' as const, label: `${r.name} ref`, url: storageUrl(r.imagePath) })),
        ...(environmentRef ? [{ type: 'image' as const, label: `Env: ${environmentRef.name}`, url: storageUrl(environmentRef.imagePath) }] : []),
        ...(prevShotEndFramePath ? [{ type: 'image' as const, label: 'Prev end frame', url: storageUrl(prevShotEndFramePath) }] : []),
      ],
      contextChain: await buildContextChain(project.id),
      responseSummary: `Generated start frame for shot`,
      outputAssetIds: [assetId],
      durationMs,
      costEstimate: 0.04,
    });

    await incrementColumn('projects', { id: paramStr(req.params.id) }, 'cost_estimate', 0.04);
    await updateRows('projects', { id: paramStr(req.params.id) }, { updated_at: new Date().toISOString() });

    res.json(await getFullProject(paramStr(req.params.id)));
  } catch (err: any) {
    console.error(`[shot ${shot.id}] Start frame gen failed:`, err);
    await logCall({
      projectId: project.id,
      stage: 'generate-shot-start-frame',
      model: 'gemini-3-pro-image-preview',
      prompt: shotPrompt,
      durationMs: 0,
      error: err.message,
    });
    await updateRows('shots', { id: shot.id }, { image_status: 'error', last_error: err.message?.slice(0, 500) || 'Unknown error' });
    res.status((err as any).statusCode || 500).json({ error: err.message });
  }
});

// End frame and frame-pair endpoints removed — the new workflow captures the
// real last frame from the generated video via ffmpeg extraction (see
// generate-video below). Predicting end frames was unreliable; extracting
// them after Veo plays the shot naturally is truthful continuity.


// ─── Use Previous Shot's Last Frame as This Shot's Start Frame ──────
// Skips image generation entirely — copies the ffmpeg-extracted last frame
// from the previous shot's video and uses it directly. Most seamless form
// of continuity since the frame IS literally where the previous shot ended.
router.post('/:id/shots/:shotId/use-prev-last-frame', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);

  const shot = await selectOne('shots', { id: shotId });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  const prevShot = await findShot(shot.scene_id, shot.sort_order, {}, { lt: true, desc: true });
  if (!prevShot) return res.status(400).json({ error: 'No previous shot in this scene' });
  if (!prevShot.extracted_last_frame_asset_id) {
    return res.status(400).json({ error: 'Previous shot has no extracted last frame yet — generate its video first' });
  }

  const sourceAsset = await selectOne('assets', { id: prevShot.extracted_last_frame_asset_id });
  if (!sourceAsset) return res.status(400).json({ error: 'Source frame asset missing' });

  // Create a new asset row (category shot_image) pointing at the same file.
  // Sharing file_path avoids duplication on disk; the separate row keeps
  // provenance/ai_calls traceability clean.
  const newAssetId = uuidv4();
  await insertRow('assets', { id: newAssetId, project_id: projectId, shot_id: shotId, category: 'shot_image', file_path: sourceAsset.file_path });

  await updateRows('shots', { id: shotId }, {
    image_asset_id: newAssetId,
    image_status: 'success', last_error: null,
    continuity_from: 'prev_shot',
  });

  await logCall({
    projectId,
    stage: 'copy-prev-last-frame',
    model: 'copy',
    prompt: `Copied prev shot (${prevShot.id}) extracted last frame as start frame for shot ${shotId}`,
    referenceInputs: [{ type: 'image', label: 'Prev shot last frame', url: storageUrl(sourceAsset.file_path) }],
    outputAssetIds: [newAssetId],
    durationMs: 0,
    costEstimate: 0,
  });

  res.json(await getFullProject(projectId));
});

// ─── Reverse-chain: use THIS shot's start frame as PREV shot's end keyframe ─
// Lets the artist rewind: "this start looks right — make the previous shot
// land here." Copies this shot's image_asset_id into the previous shot's
// end_image_asset_id and marks that shot's video as stale so the artist
// regens it. Stale (not deleted) — prior video stays accessible via history.
// Only works on models that support first+last frame conditioning (Veo 3.1).
router.post('/:id/shots/:shotId/use-as-prev-end', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);

  const shot = await selectOne('shots', { id: shotId });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });
  if (!shot.image_asset_id) return res.status(400).json({ error: 'This shot has no start frame to use' });

  const project = await selectOne('projects', { id: projectId });
  const modelKey = project?.video_model || 'veo-3.1-fast';
  const segModel = (SEGMIND_MODELS as any)[modelKey];
  const supportsLastFrame = segModel?.supportsLastFrame || false;
  if (!supportsLastFrame) {
    return res.status(400).json({ error: `Current video model (${modelKey}) does not support end-keyframe conditioning. Switch to Veo 3.1 to use reverse-chain.` });
  }

  const prevShot = await findShot(shot.scene_id, shot.sort_order, {}, { lt: true, desc: true });
  if (!prevShot) return res.status(400).json({ error: 'No previous shot in this scene' });
  if (prevShot.locked) return res.status(400).json({ error: 'Previous shot is locked — unlock it first' });

  await updateRows('shots', { id: prevShot.id }, {
    end_image_asset_id: shot.image_asset_id,
    end_image_status: 'success', last_error: null,
    end_visual_prompt: shot.visual_prompt || null,
    video_status: 'stale',
  });

  res.json(await getFullProject(projectId));
});

// ─── End frame management (mirrors start frame capabilities) ─────────

// Generate an end frame from start frame + motion prompt
router.post('/:id/shots/:shotId/generate-end-frame', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);

  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const shot = await selectOne('shots', { id: shotId });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });
  if (!shot.image_asset_id) return res.status(400).json({ error: 'Start frame required to generate end frame' });

  const imageAsset = await selectOne('assets', { id: shot.image_asset_id });
  if (!imageAsset) return res.status(400).json({ error: 'Start frame asset not found' });

  // If regenerating with feedback, pass the failed end frame
  let failedEndFramePath: string | undefined;
  if (shot.end_user_feedback && shot.end_image_asset_id) {
    const failedAsset = await selectOne('assets', { id: shot.end_image_asset_id });
    if (failedAsset) failedEndFramePath = failedAsset.file_path;
  }

  // ─── Ref resolution: frontend-controlled or legacy auto ───
  const frontendRefs: any[] | undefined = req.body?.refs;
  let startFramePath: string | undefined = imageAsset.file_path;
  let styleImagePath: string | undefined;
  let characterRefs: { name: string; imagePath: string }[] = [];
  let environmentRef: { name: string; imagePath: string } | undefined;
  let extraRefs: { imagePath: string }[] = [];

  const resolveAsset = async (id: string) => { const a = await selectOne('assets', { id }); return a?.file_path; };

  if (frontendRefs) {
    const allCast = await selectAll('cast_members', { project_id: projectId });
    const allEnvs = await selectAll('environments', { project_id: projectId });
    // Only include start frame if explicitly in refs
    startFramePath = undefined;
    for (const ref of frontendRefs) {
      if (ref.type === 'start-frame' && shot.image_asset_id) {
        startFramePath = await resolveAsset(shot.image_asset_id);
      } else if (ref.type === 'end-frame') {
        const endAssetId = shot.end_image_asset_id || shot.extracted_last_frame_asset_id;
        if (endAssetId) { const p = await resolveAsset(endAssetId); if (p) extraRefs.push({ imagePath: p }); }
      } else if (ref.type === 'style' && project.style_asset_id) {
        styleImagePath = await resolveAsset(project.style_asset_id);
      } else if (ref.type === 'cast' && ref.id) {
        const c = allCast.find((m: any) => m.id === ref.id);
        if (c?.reference_asset_id) { const p = await resolveAsset(c.reference_asset_id); if (p) characterRefs.push({ name: c.name, imagePath: p }); }
      } else if (ref.type === 'env' && ref.id) {
        const e = allEnvs.find((en: any) => en.id === ref.id);
        if (e?.reference_asset_id) { const p = await resolveAsset(e.reference_asset_id); if (p) environmentRef = { name: e.name, imagePath: p }; }
      } else if (ref.type === 'uploaded' && ref.id) {
        const p = await resolveAsset(ref.id);
        if (p) extraRefs.push({ imagePath: p });
      }
    }
  } else {
    // Legacy: start frame + style only
    if (project.style_asset_id) styleImagePath = await resolveAsset(project.style_asset_id);
  }

  try {
    await updateRows('shots', { id: shotId }, { end_image_status: 'loading' });
    const t0 = Date.now();

    const { generateShotEndFrame } = await import('../services/imagen.js');
    const endFramePath = await generateShotEndFrame({
      startFramePath,
      visualPrompt: shot.end_visual_prompt || shot.visual_prompt || '',
      motionPrompt: shot.motion_prompt || 'Cinematic camera movement',
      styleImagePath,
      styleDNA: project.style_description || 'Cinematic',
      characterRefs: characterRefs.length > 0 ? characterRefs : undefined,
      environmentRef,
      additionalRefs: extraRefs.length > 0 ? extraRefs : undefined,
      userFeedback: shot.end_user_feedback || undefined,
      failedImagePath: failedEndFramePath,
    });

    const assetId = uuidv4();
    await insertRow('assets', { id: assetId, project_id: projectId, shot_id: shotId, category: 'shot_end_frame', file_path: endFramePath });
    const shotState = await selectOne('shots', { id: shotId });
    const clearEndError = shotState?.image_status !== 'error' && shotState?.video_status !== 'error';
    await updateRows('shots', { id: shotId }, {
      end_image_asset_id: assetId,
      end_image_status: 'success',
      ...(clearEndError ? { last_error: null } : {}),
      end_user_feedback: null,
      video_status: 'stale',
    });

    const durationMs = Date.now() - t0;
    await logCall({
      projectId,
      stage: 'generate-end-frame',
      model: 'gemini-3-pro-image-preview',
      prompt: `End frame for shot: ${(shot.end_visual_prompt || shot.visual_prompt || '').substring(0, 100)}`,
      referenceInputs: [{ type: 'image', label: 'Start frame', url: storageUrl(imageAsset.file_path) }],
      outputAssetIds: [assetId],
      contextChain: await buildContextChain(projectId),
      durationMs,
      costEstimate: 0.04,
    });

    res.json(await getFullProject(projectId));
  } catch (err: any) {
    await updateRows('shots', { id: shotId }, { end_image_status: 'error', last_error: err.message?.slice(0, 500) || 'Unknown error' });
    res.status(500).json({ error: `End frame generation failed: ${err.message}` });
  }
});

// Refine end frame prompt — mirrors refine-prompt but for the end frame
router.post('/:id/shots/:shotId/refine-end-frame-prompt', upload.single('referenceImage'), async (req, res) => {
  const feedback = req.body?.feedback;
  if (!feedback?.trim()) return res.status(400).json({ error: 'Feedback required' });

  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const shot = await selectOne('shots', { id: paramStr(req.params.shotId) });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });
  // End frame image is optional — refine can work from prompt + feedback alone
  const endImageAsset = shot.end_image_asset_id
    ? await selectOne('assets', { id: shot.end_image_asset_id })
    : null;

  try {
    const t0 = Date.now();
    const imageBase64 = endImageAsset ? await readAsBase64(endImageAsset.file_path) : '';
    const mime = endImageAsset ? mimeFromExt(endImageAsset.file_path) : 'image/png';

    // Get character descriptions for context
    const castIds = JSON.parse(shot.cast_ids || '[]');
    const castMembers = castIds.length > 0
      ? await selectAll('cast_members', { project_id: project.id })
      : [];
    const shotCast = castMembers.filter((c: any) => castIds.includes(c.id));
    const charDescs = shotCast.map((c: any) => `${c.name}: ${c.description || 'No description'}`);

    const scene = await selectOne('scenes', { id: shot.scene_id });
    const env = shot.environment_id ? await selectOne('environments', { id: shot.environment_id }) : null;

    const result = await refineShotPrompt({
      currentVisualPrompt: shot.end_visual_prompt || shot.visual_prompt || '',
      currentMotionPrompt: shot.motion_prompt || 'Cinematic camera movement',
      feedback: `[END FRAME — this is what the shot should land on] ${feedback}`,
      failedImageBase64: imageBase64,
      failedImageMime: mime,
      referenceImageBase64: req.file ? req.file.buffer.toString('base64') : undefined,
      referenceImageMime: req.file ? (req.file.mimetype || 'image/png') : undefined,
      styleDNA: project.style_description || 'Cinematic',
      characterDescriptions: charDescs,
      sceneNarrative: scene?.narrative_description,
      environmentDescription: env?.description,
    });

    // Save rewritten prompt — user sees it update, then generates separately
    await updateRows('shots', { id: shot.id }, {
      end_visual_prompt: result.visualPrompt,
      end_user_feedback: feedback,
    });

    const durationMs = Date.now() - t0;
    await logCall({
      projectId: project.id,
      stage: 'refine-end-frame-prompt',
      model: 'claude-sonnet-4-6',
      prompt: `Refine end frame: "${feedback}" | Original: "${(shot.end_visual_prompt || shot.visual_prompt || '').substring(0, 80)}…"`,
      referenceInputs: [{ type: 'image', label: 'Failed end frame', url: storageUrl(endImageAsset.file_path) }],
      contextChain: await buildContextChain(project.id),
      responseSummary: `Rewritten: "${result.visualPrompt.substring(0, 100)}…"`,
      durationMs,
      costEstimate: 0.01,
    });

    res.json(await getFullProject(paramStr(req.params.id)));
  } catch (err: any) {
    console.error(`[shot ${shot.id}] End frame prompt refinement failed:`, err);
    res.status((err as any).statusCode || 500).json({ error: err.message });
  }
});

// Refine video prompt — Claude rewrites the motion prompt based on feedback
router.post('/:id/shots/:shotId/refine-video-prompt', async (req, res) => {
  const feedback = req.body?.feedback;
  if (!feedback?.trim()) return res.status(400).json({ error: 'Feedback required' });

  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const shot = await selectOne('shots', { id: paramStr(req.params.shotId) });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  const scene = await selectOne('scenes', { id: shot.scene_id });
  const env = shot.environment_id ? await selectOne('environments', { id: shot.environment_id }) : null;
  const castIds = JSON.parse(shot.cast_ids || '[]');
  const castMembers = castIds.length > 0 ? await selectAll('cast_members', { project_id: project.id }) : [];
  const charDescs = castMembers.filter((c: any) => castIds.includes(c.id)).map((c: any) => `${c.name}: ${c.description || 'No description'}`);

  try {
    const t0 = Date.now();
    // Pass the video/start frame as context if available
    // Start frame as main context image
    let startBase64 = '';
    let startMime = 'image/png';
    if (shot.image_asset_id) {
      const imageAsset = await selectOne('assets', { id: shot.image_asset_id });
      if (imageAsset) {
        startBase64 = await readAsBase64(imageAsset.file_path);
        startMime = mimeFromExt(imageAsset.file_path);
      }
    }
    // End frame as reference image (if exists)
    let endBase64: string | undefined;
    let endMime: string | undefined;
    const endAssetId = shot.end_image_asset_id || shot.extracted_last_frame_asset_id;
    if (endAssetId) {
      const endAsset = await selectOne('assets', { id: endAssetId });
      if (endAsset) {
        endBase64 = await readAsBase64(endAsset.file_path);
        endMime = mimeFromExt(endAsset.file_path);
      }
    }

    const endFrameNote = endBase64
      ? '\n[SECOND IMAGE is the end frame — the video should transition from the first image to this one]'
      : '';

    const result = await refineShotPrompt({
      currentVisualPrompt: shot.visual_prompt || '',
      currentMotionPrompt: shot.motion_prompt || 'Cinematic camera movement',
      feedback: `[VIDEO/MOTION REFINEMENT — focus on camera movement, pacing, and action]${endFrameNote} ${feedback}`,
      failedImageBase64: startBase64,
      failedImageMime: startMime,
      referenceImageBase64: endBase64,
      referenceImageMime: endMime,
      styleDNA: project.style_description || 'Cinematic',
      characterDescriptions: charDescs,
      sceneNarrative: scene?.narrative_description,
      environmentDescription: env?.description,
    });

    await updateRows('shots', { id: shot.id }, {
      motion_prompt: result.motionPrompt,
    });

    const durationMs = Date.now() - t0;
    await logCall({
      projectId: project.id,
      stage: 'refine-video-prompt',
      model: 'claude-sonnet-4-6',
      prompt: `Refine video: "${feedback}" | Original motion: "${(shot.motion_prompt || '').substring(0, 80)}…"`,
      contextChain: await buildContextChain(project.id),
      responseSummary: `Rewritten motion: "${result.motionPrompt.substring(0, 100)}…"`,
      durationMs,
      costEstimate: 0.01,
    });

    res.json({ ok: true, motionPrompt: result.motionPrompt });
  } catch (err: any) {
    res.status((err as any).statusCode || 500).json({ error: err.message });
  }
});

// Clear end frame — removes the lastFrame constraint, video generates freely
router.post('/:id/shots/:shotId/clear-end-frame', async (req, res) => {
  const shotId = paramStr(req.params.shotId);
  await updateRows('shots', { id: shotId }, { end_image_asset_id: null, end_image_status: 'idle', video_status: 'stale' });
  res.json({ ok: true });
});

// Clear extracted last frame — removes the ffmpeg-extracted frame from a previous video gen
router.post('/:id/shots/:shotId/clear-extracted-frame', async (req, res) => {
  const shotId = paramStr(req.params.shotId);
  await updateRows('shots', { id: shotId }, { extracted_last_frame_asset_id: null });
  res.json({ ok: true });
});

// Upload a custom end frame
router.post('/:id/shots/:shotId/upload-end-frame', upload.single('image'), async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);
  if (!req.file) return res.status(400).json({ error: 'Image file required' });

  const ext = path.extname(req.file.originalname).slice(1) || 'png';
  const filePath = await saveBuffer(req.file.buffer, 'images', ext);
  const assetId = uuidv4();
  await insertRow('assets', { id: assetId, project_id: projectId, shot_id: shotId, category: 'shot_end_frame', file_path: filePath });
  await updateRows('shots', { id: shotId }, { end_image_asset_id: assetId, end_image_status: 'success', last_error: null, video_status: 'stale' });

  res.json(await getFullProject(projectId));
});

// ─── Shot Reference Images ─────────────────────────────────────────

router.post('/:id/shots/:shotId/upload-ref', upload.single('image'), async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);
  if (!req.file) return res.status(400).json({ error: 'Image file required' });

  const ext = path.extname(req.file.originalname).slice(1) || 'png';
  const filePath = await saveBuffer(req.file.buffer, 'images', ext);
  const assetId = uuidv4();
  await insertRow('assets', { id: assetId, project_id: projectId, shot_id: shotId, category: 'shot_ref', file_path: filePath });
  // Return the new ref so frontend can add it optimistically
  res.json({ ok: true, ref: { id: assetId, url: storageUrl(filePath) } });
});

router.post('/:id/shots/:shotId/delete-ref', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const { assetId } = req.body;
  if (!assetId) return res.status(400).json({ error: 'assetId required' });
  // Verify it belongs to this project + shot
  const asset = await selectOne('assets', { id: assetId, project_id: projectId, category: 'shot_ref' });
  if (!asset) return res.status(404).json({ error: 'Ref not found' });
  await deleteRows('assets', { id: assetId });
  res.json({ ok: true });
});

// ─── Lock Shot ───────────────────────────────────────────────────────

router.post('/:id/shots/:shotId/lock', async (req, res) => {
  const shot = await selectOne('shots', { id: paramStr(req.params.shotId) });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });
  if (!shot.image_asset_id) return res.status(400).json({ error: 'Start frame required to lock' });
  if (!shot.video_asset_id) return res.status(400).json({ error: 'Video must be generated before locking' });

  await updateRows('shots', { id: shot.id }, { locked: 1 });
  res.json({ ok: true });
});

router.post('/:id/shots/:shotId/unlock', async (req, res) => {
  const shot = await selectOne('shots', { id: paramStr(req.params.shotId) });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  await updateRows('shots', { id: shot.id }, { locked: 0 });
  res.json({ ok: true });
});

// ─── Batch lock/unlock all shots in a scene ────────────────────────

router.post('/:id/scenes/:sceneId/lock-all', async (req, res) => {
  const sceneId = paramStr(req.params.sceneId);
  const shots = await selectAll('shots', { scene_id: sceneId });
  // Only lock shots that have both start frame + video
  const lockable = shots.filter((s: any) => s.image_asset_id && s.video_asset_id && !s.locked);
  for (const shot of lockable) {
    await updateRows('shots', { id: shot.id }, { locked: 1 });
  }
  res.json({ ok: true, locked: lockable.length, skipped: shots.length - lockable.length });
});

router.post('/:id/scenes/:sceneId/unlock-all', async (req, res) => {
  const sceneId = paramStr(req.params.sceneId);
  await getSB().from(T.shots).update({ locked: 0 }).eq('scene_id', sceneId);
  res.json({ ok: true });
});

// ─── Unified version history ────────────────────────────────────────
// Returns all versions for a shot: first frames, end frames, and videos.
// Each has its own category. Revert endpoints swap the active pointer.

router.get('/:id/shots/:shotId/history', async (req, res) => {
  const shotId = paramStr(req.params.shotId);
  const shot = await selectOne('shots', { id: shotId });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  const [frames, endFrames, videos] = await Promise.all([
    selectAll('assets', { shot_id: shotId, category: 'shot_image' }, { orderBy: 'created_at', ascending: false }),
    selectAll('assets', { shot_id: shotId, category: 'shot_end_frame' }, { orderBy: 'created_at', ascending: false }),
    selectAll('assets', { shot_id: shotId, category: 'shot_video' }, { orderBy: 'created_at', ascending: false }),
  ]);

  const mapAsset = (a: any, currentId: string | null) => ({
    assetId: a.id,
    url: storageUrl(a.file_path),
    createdAt: a.created_at,
    isCurrent: a.id === currentId,
  });

  res.json({
    firstFrame: frames.map(a => mapAsset(a, shot.image_asset_id)),
    lastFrame: endFrames.map(a => mapAsset(a, shot.end_image_asset_id)),
    video: videos.map(a => {
      let thumbId: string | null = null;
      try { thumbId = JSON.parse(a.metadata || '{}').extracted_last_frame_asset_id || null; } catch {}
      return {
        ...mapAsset(a, shot.video_asset_id),
        thumbnailUrl: thumbId ? storageUrl(frames.find((f: any) => f.id === thumbId)?.file_path || '') || null : null,
      };
    }),
  });
});

router.post('/:id/shots/:shotId/revert-frame', async (req, res) => {
  const shotId = paramStr(req.params.shotId);
  const { assetId } = req.body || {};
  if (!assetId) return res.status(400).json({ error: 'assetId required' });

  const asset = await selectOne('assets', { id: assetId });
  if (!asset || asset.shot_id !== shotId || asset.category !== 'shot_image') {
    return res.status(404).json({ error: 'Frame version not found for this shot' });
  }

  await updateRows('shots', { id: shotId }, {
    image_asset_id: assetId,
    image_status: 'success', last_error: null,
  });

  res.json({ ok: true });
});

router.post('/:id/shots/:shotId/revert-end-frame', async (req, res) => {
  const shotId = paramStr(req.params.shotId);
  const { assetId } = req.body || {};
  if (!assetId) return res.status(400).json({ error: 'assetId required' });

  const asset = await selectOne('assets', { id: assetId });
  if (!asset || asset.shot_id !== shotId || asset.category !== 'shot_end_frame') {
    return res.status(404).json({ error: 'End frame version not found for this shot' });
  }

  await updateRows('shots', { id: shotId }, {
    end_image_asset_id: assetId,
    end_image_status: 'success', last_error: null,
    video_status: 'stale',
  });

  res.json({ ok: true });
});

// ─── Shot video history (revert after bad regen) ────────────────────

router.get('/:id/shots/:shotId/video-history', async (req, res) => {
  const shotId = paramStr(req.params.shotId);
  const shot = await selectOne('shots', { id: shotId });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  const rows = await selectAll('assets', { shot_id: shotId, category: 'shot_video' }, { orderBy: 'created_at', ascending: false });

  const versions = [];
  for (const r of rows) {
    let pairedFrameId: string | null = null;
    try { pairedFrameId = JSON.parse(r.metadata || '{}').extracted_last_frame_asset_id || null; } catch {}
    const frame = pairedFrameId
      ? await selectOne('assets', { id: pairedFrameId })
      : null;
    versions.push({
      assetId: r.id,
      videoUrl: storageUrl(r.file_path),
      thumbnailUrl: frame ? storageUrl(frame.file_path) : null,
      createdAt: r.created_at,
      isCurrent: r.id === shot.video_asset_id,
    });
  }

  res.json({ versions });
});


// revert-video + generate-video moved to generate-video.ts


// ─── Chat ───────────────────────────────────────────────────────────

router.post('/:id/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Save user message
  await insertRow('chat_messages', { project_id: paramStr(req.params.id), role: 'user', text: message });

  const history = await selectAll('chat_messages', { project_id: paramStr(req.params.id) }, { orderBy: 'id', ascending: true });
  const concept = JSON.parse(project.locked_concept || project.concept_options || '{}');

  const chatContext = `Project: ${project.title}, Concept: ${JSON.stringify(concept).substring(0, 500)}`;

  try {
    const t0 = Date.now();
    const response = await chatWithDirector(chatContext, message, history);
    const durationMs = Date.now() - t0;

    await insertRow('chat_messages', { project_id: paramStr(req.params.id), role: 'model', text: response });

    await logCall({
      projectId: paramStr(req.params.id),
      stage: 'chat',
      model: 'gemini-3-pro-preview',
      prompt: `[User]: ${message}\n[System context]: ${chatContext}`,
      contextChain: await buildContextChain(paramStr(req.params.id)),
      responseSummary: response.substring(0, 300),
      durationMs,
      costEstimate: 0.005,
    });

    res.json({ text: response, project: await getFullProject(paramStr(req.params.id)) });
  } catch (err: any) {
    await logCall({
      projectId: paramStr(req.params.id),
      stage: 'chat',
      model: 'gemini-3-pro-preview',
      prompt: `[User]: ${message}`,
      durationMs: 0,
      error: err.message,
    });
    const errMsg = 'Error connecting to AI.';
    await insertRow('chat_messages', { project_id: paramStr(req.params.id), role: 'model', text: errMsg });
    res.json({ text: errMsg });
  }
});

// ─── Mount extracted route modules ──────────────────────────────────
mountStyleRoutes(router);
mountLooksRoutes(router);
mountVideoRoutes(router);

export { router as generateRouter };
