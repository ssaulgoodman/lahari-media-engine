import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { selectOne, selectAll, insertRow, updateRows } from '../database.js';
import { storageUrl } from '../storage.js';
import { getImageService, getStyleOptionsModelName } from '../services/image-provider.js';
import { getFullProject } from './projects.js';
import { logCall, buildContextChain } from '../xray.js';
import { paramStr, atLeast } from './scope-helpers.js';
import { mountStyleRoutes } from './generate-style.js';
import { mountLooksRoutes } from './generate-looks.js';
import { mountScriptRoutes } from './generate-script.js';
import { mountShotRoutes } from './generate-shots.js';
import { mountVideoRoutes } from './generate-video.js';
import { mountAudioRoutes } from './generate-audio.js';
import { getProjectRuntimePreset, presetSubject } from '../presets.js';
import { recordDirectorEvent } from '../services/directorEvents.js';
import { sendStructuredError } from '../services/structuredErrors.js';

const router = Router();

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
  const preset = getProjectRuntimePreset(project, req.body?.presetKey);
  const subject = presetSubject(concept, project.title, preset);

  const prompt = `Generate 4 style options for "${subject}" — ${notes || project.style_description || preset.style.rules}`;

  try {
    console.log(`[${project.id}] Generating style options...`);
    const t0 = Date.now();
    const imageService = getImageService(project.image_model);
    const styles = await imageService.generateStyleOptions(
      subject,
      notes || project.style_description,
      undefined,
      preset,
      getStyleOptionsModelName(project.image_model),
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
      model: getStyleOptionsModelName(project.image_model),
      prompt,
      contextChain: await buildContextChain(project.id),
      responseSummary: `Generated ${styles.length} style images: ${assetIds.map(a => a.style).join(', ')}`,
      outputAssetIds: assetIds.map(a => a.id),
      durationMs,
      costEstimate: 0.04,
    });
    await recordDirectorEvent({
      projectId: project.id,
      userId: req.userId,
      source: 'web',
      eventType: 'style_options_generated',
      entityType: 'project',
      entityId: project.id,
      summary: `Artist generated ${assetIds.length} style option images.`,
      payload: { assetIds: assetIds.map((asset) => asset.id), notes: notes || null },
    });

    res.json({ styles: assetIds, project: await getFullProject(project.id) });
  } catch (err: any) {
    console.error(`[${project.id}] Style generation failed:`, err);
    await logCall({
      projectId: project.id,
      stage: 'generate-styles',
      model: getStyleOptionsModelName(project.image_model),
      prompt,
      contextChain: await buildContextChain(project.id),
      durationMs: 0,
      error: err.message,
    });
    sendStructuredError(res, err);
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
// Pure rewind unlocks — allowed from any phase at or past the target.
// No data deleted. Destruction only happens on the next active mutation
// (e.g. lock-concept with a different choice, generate-script re-run).

router.post('/:id/unlock-script', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!atLeast(project.status, 'scripted')) {
    return res.status(400).json({ error: `Script is not locked yet (status: "${project.status}").` });
  }
  await updateRows('projects', { id: projectId }, { status: 'concept_locked', updated_at: new Date().toISOString() });
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'script_unlocked',
    entityType: 'project',
    entityId: projectId,
    summary: 'Artist reopened the script phase without deleting generated script data.',
  });
  res.json({ ok: true, status: 'concept_locked' });
});

router.post('/:id/unlock-style', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!atLeast(project.status, 'style_locked')) {
    return res.status(400).json({ error: `Style is not locked yet (status: "${project.status}").` });
  }
  await updateRows('projects', { id: projectId }, { status: 'scripted', updated_at: new Date().toISOString() });
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'style_unlocked',
    entityType: 'project',
    entityId: projectId,
    summary: 'Artist reopened the style phase without deleting style data.',
  });
  res.json({ ok: true, status: 'scripted' });
});

router.post('/:id/unlock-characters', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!atLeast(project.status, 'characters_locked')) {
    return res.status(400).json({ error: `Characters are not locked yet (status: "${project.status}").` });
  }
  await updateRows('projects', { id: projectId }, { status: 'style_locked', updated_at: new Date().toISOString() });
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'characters_unlocked',
    entityType: 'project',
    entityId: projectId,
    summary: 'Artist reopened the character phase.',
  });
  res.json({ ok: true, status: 'style_locked' });
});

router.post('/:id/unlock-environments', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!atLeast(project.status, 'environments_locked')) {
    return res.status(400).json({ error: `Environments are not locked yet (status: "${project.status}").` });
  }
  await updateRows('projects', { id: projectId }, { status: 'characters_locked', updated_at: new Date().toISOString() });
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'environments_unlocked',
    entityType: 'project',
    entityId: projectId,
    summary: 'Artist reopened the environment phase.',
  });
  res.json({ ok: true, status: 'characters_locked' });
});


// upload-and-lock-style, analyze-style-image → generate-style.ts



// generate-looks, lock-character, upload-character-reference, advance-characters,
// generate-environment-look, lock-environment, upload-environment-reference, advance-environments
// → generate-looks.ts



// generate-script, refine-script, write-shot-prompts → generate-script.ts


// ─── Refine Shot Prompt (vision + rewrite) ─────────────────────────


// All shot-level routes (generate-image, generate-end-frame, refine, clear, lock, history, refs)
// → generate-shots.ts


// ─── Mount extracted route modules ──────────────────────────────────
mountStyleRoutes(router);
mountLooksRoutes(router);
mountScriptRoutes(router);
mountAudioRoutes(router);
mountShotRoutes(router);
mountVideoRoutes(router);

export { router as generateRouter };
