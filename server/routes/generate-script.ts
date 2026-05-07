/**
 * Script generation routes — extracted from generate.ts.
 * Handles: generate-script, refine-script, write-shot-prompts.
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { selectOne, selectAll, selectColumns, insertRow, updateRows, deleteRows, incrementColumn, maxVal } from '../database.js';
import { storageUrl, readAsBase64, mimeFromExt } from '../storage.js';
import { planScenes, refineScript, writeShotPrompts } from '../services/claude.js';
import { getModelMinDuration } from '../services/segmind.js';
import { getFullProject, forkProject } from './projects.js';
import { logCall, buildContextChain } from '../xray.js';
import { paramStr, parseTimestamp } from './scope-helpers.js';

export const mountScriptRoutes = (router: Router) => {

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
      minShotDuration: getModelMinDuration(project.video_model),
      videoModel: project.video_model || undefined,
      userNote,
      songType: project.song_type || undefined,
      isNarrative: project.is_narrative ?? undefined,
      isMeditative: project.is_meditative ?? undefined,
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

        // Standard mode uses deterministic ceil+remainder pacing. Seedance
        // storyboard mode lets the script planner choose 4-15s clip blocks.
        let duration = Number(shot.duration || 0) > 0 && String(project.video_model || '').startsWith('seedance')
          ? Number(shot.duration)
          : basePacing;
        if (!(String(project.video_model || '').startsWith('seedance')) && shIdx === shotCount - 1 && sceneDuration > 0) {
          const remainder = sceneDuration - (shotCount - 1) * basePacing;
          duration = Math.max(1, Math.min(remainder, basePacing * 2));
        }

        // direction = shot's creative intent (preserved permanently)
        // visual_prompt stays empty until writeShotPrompts fills it with the cinematographer's start-frame description
        await insertRow('shots', {
          id: shotId,
          scene_id: sceneId,
          direction: shot.direction || '',
          visual_prompt: '',
          motion_prompt: '',
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
      minShotDuration: getModelMinDuration(project.video_model),
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

      // Calculate per-shot durations: base pacing for all, last shot gets remainder (clamped)
      const basePacing = project.target_duration || 8;
      const sceneStartSec = parseTimestamp(scene.startTime);
      const sceneEndSec = parseTimestamp(scene.endTime);
      const sceneDuration = Math.max(0, sceneEndSec - sceneStartSec);
      const shotCount = (scene.shots || []).length;

      for (let shIdx = 0; shIdx < shotCount; shIdx++) {
        const shot = scene.shots[shIdx];
        const castIds = (shot.castNames || [])
          .map((n: string) => castNameToId.get(n.toLowerCase()))
          .filter(Boolean);
        const envId = shot.environmentName ? envNameToId.get(shot.environmentName.toLowerCase()) : null;

        // Last shot gets remainder (with ceil pacing, remainder ≤ basePacing). Safety clamp at 2×.
        let duration = basePacing;
        if (shIdx === shotCount - 1 && sceneDuration > 0) {
          const remainder = sceneDuration - (shotCount - 1) * basePacing;
          duration = Math.max(1, Math.min(remainder, basePacing * 2));
        }

        await insertRow('shots', {
          id: uuidv4(), scene_id: sceneId,
          direction: shot.direction || '',
          visual_prompt: '', motion_prompt: '', duration,
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
  if (!project.style_asset_id) return res.status(400).json({ error: 'Style not locked yet' });
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
          direction: shot.direction || shot.visual_prompt || '',
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
        cast: cast.map((c: any) => ({ name: c.name, description: c.description })),
        concept,
        userNote,
        songType: project.song_type || undefined,
        isNarrative: project.is_narrative ?? undefined,
        isMeditative: project.is_meditative ?? undefined,
        videoModel: project.video_model || undefined,
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

};
