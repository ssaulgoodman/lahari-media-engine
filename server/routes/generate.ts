import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { selectOne, selectAll, insertRow, updateRows } from '../database.js';
import { storageUrl } from '../storage.js';
import { generateStyleOptions } from '../services/imagen.js';
import { chatWithDirector } from '../services/gemini.js';
import { getFullProject } from './projects.js';
import { logCall, buildContextChain } from '../xray.js';
import { paramStr } from './scope-helpers.js';
import { mountStyleRoutes } from './generate-style.js';
import { mountLooksRoutes } from './generate-looks.js';
import { mountScriptRoutes } from './generate-script.js';
import { mountShotRoutes } from './generate-shots.js';
import { mountVideoRoutes } from './generate-video.js';

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



// generate-script, refine-script, write-shot-prompts → generate-script.ts


// ─── Refine Shot Prompt (vision + rewrite) ─────────────────────────


// All shot-level routes (generate-image, generate-end-frame, refine, clear, lock, history, refs)
// → generate-shots.ts


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
mountScriptRoutes(router);
mountShotRoutes(router);
mountVideoRoutes(router);

export { router as generateRouter };
