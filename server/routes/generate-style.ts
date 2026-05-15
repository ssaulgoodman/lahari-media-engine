/**
 * Style generation routes — extracted from generate.ts.
 * Handles: brainstorm, visualize, refine, lock, upload-and-lock, analyze-style-image.
 */
import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { selectOne, selectColumns, insertRow, updateRows } from '../database.js';
import { saveBuffer, storageUrl } from '../storage.js';
import { buildStylePrompt } from '../services/imagen.js';
import { brainstormStyleDirections, refineStyleDirection, analyzeImageStyle } from '../services/claude.js';
import { getImageGenerationModelName, getImageService } from '../services/image-provider.js';
import { getFullProject } from './projects.js';
import { logCall, buildContextChain } from '../xray.js';
import { paramStr, requireAsset } from './scope-helpers.js';
import { getRuntimePreset, presetSubject } from '../presets.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const mountStyleRoutes = (router: Router) => {

  // ─── Brainstorm Style Directions (text only, no images) ─────────────

  router.post('/:id/brainstorm-styles', async (req, res) => {
    const project = await selectOne('projects', { id: paramStr(req.params.id) });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const concept = JSON.parse(project.locked_concept || '{}');
    const { userNotes } = req.body;
    const preset = getRuntimePreset(req.body?.presetKey);

    try {
      console.log(`[${project.id}] Brainstorming style directions...`);
      const t0 = Date.now();
      const scenes = await selectColumns('scenes', 'section_label, narrative_description', { project_id: project.id }, { orderBy: 'sort_order', ascending: true });
      const scriptSummary = scenes.length > 0
        ? scenes.map((s: any) => `[${s.section_label}] ${s.narrative_description}`).join('\n')
        : undefined;

      const directions = await brainstormStyleDirections(
        project.lyrics || '',
        project.meaning || '',
        concept,
        userNotes,
        scriptSummary,
        project.song_type || undefined,
        project.is_narrative ?? undefined,
        project.is_meditative ?? undefined,
        preset,
      );
      const durationMs = Date.now() - t0;

      await logCall({
        projectId: project.id,
        stage: 'brainstorm-styles',
        model: 'claude-opus-4-6',
        prompt: `Brainstorm 4 style directions | Concept: ${concept.conceptDirection || concept.title} | Mood: ${concept.mood}${userNotes ? ` | User notes: ${userNotes}` : ''}`,
        contextChain: await buildContextChain(project.id),
        responseSummary: JSON.stringify(directions),
        durationMs,
        costEstimate: 0.01,
      });

      res.json({ directions });
    } catch (err: any) {
      console.error(`[${project.id}] Brainstorm failed:`, err);
      await logCall({
        projectId: project.id,
        stage: 'brainstorm-styles',
        model: 'claude-opus-4-6',
        prompt: `Brainstorm 4 style directions`,
        durationMs: 0,
        error: err.message,
      });
      res.status((err as any).statusCode || 500).json({ error: err.message });
    }
  });

  // ─── Visualize a Single Style Direction (one image) ─────────────────

  router.post('/:id/visualize-style', async (req, res) => {
    const project = await selectOne('projects', { id: paramStr(req.params.id) });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const concept = JSON.parse(project.locked_concept || '{}');
    const { prompt: stylePrompt } = req.body;
    if (!stylePrompt) return res.status(400).json({ error: 'prompt required' });

    // Build prompt fresh per slot — no project-level cache.
    // Each direction gets its own prompt from its own description.
    const preset = getRuntimePreset(req.body?.presetKey);
    const subject = presetSubject(concept, project.title, preset);
    const genPrompt = buildStylePrompt(stylePrompt, subject, preset);

    try {
      console.log(`[${project.id}] Visualizing style direction...`);
      const t0 = Date.now();
      const imageService = getImageService(project.image_model);
      const assetPath = await imageService.generateSingleStyleImage(
        stylePrompt,
        subject,
        genPrompt,
      );
      const durationMs = Date.now() - t0;

      const assetId = uuidv4();
      await insertRow('assets', { id: assetId, project_id: project.id, category: 'style', file_path: assetPath, prompt: stylePrompt });

      await logCall({
        projectId: project.id,
        stage: 'visualize-style',
        model: getImageGenerationModelName(project.image_model),
        prompt: genPrompt,
        contextChain: await buildContextChain(project.id),
        responseSummary: `Generated style image`,
        outputAssetIds: [assetId],
        durationMs,
        costEstimate: 0.01,
      });

      res.json({ assetId, url: storageUrl(assetPath) });
    } catch (err: any) {
      console.error(`[${project.id}] Visualize style failed:`, err);
      await logCall({
        projectId: project.id,
        stage: 'visualize-style',
        model: getImageGenerationModelName(project.image_model),
        prompt: stylePrompt,
        durationMs: 0,
        error: err.message,
      });
      res.status((err as any).statusCode || 500).json({ error: err.message });
    }
  });

  // ─── Refine Style Direction (text only) ─────────────────────────────

  router.post('/:id/refine-style-direction', async (req, res) => {
    const project = await selectOne('projects', { id: paramStr(req.params.id) });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const concept = JSON.parse(project.locked_concept || '{}');
    const { description, feedback } = req.body;

    try {
      const t0 = Date.now();
      const refined = await refineStyleDirection(description, feedback, concept, getRuntimePreset(req.body?.presetKey));
      const durationMs = Date.now() - t0;

      await updateRows('projects', { id: project.id }, { style_generation_prompt: null });

      await logCall({
        projectId: project.id,
        stage: 'refine-style-direction',
        model: 'claude-sonnet-4-6',
        prompt: `Refine: "${description.substring(0, 100)}..." | Feedback: "${feedback}"`,
        contextChain: await buildContextChain(project.id),
        responseSummary: `${refined.title}: ${refined.description.substring(0, 150)}`,
        durationMs,
        costEstimate: 0.005,
      });

      res.json(refined);
    } catch (err: any) {
      console.error(`[${project.id}] Refine direction failed:`, err);
      await logCall({
        projectId: project.id,
        stage: 'refine-style-direction',
        model: 'claude-sonnet-4-6',
        prompt: `Refine: "${(description || '').substring(0, 100)}..."`,
        durationMs: 0,
        error: err.message,
      });
      res.status((err as any).statusCode || 500).json({ error: err.message });
    }
  });

  // ─── Lock Style (with DNA enrichment) ───────────────────────────────

  router.post('/:id/lock-style', async (req, res) => {
    const { assetId, styleDescription } = req.body;
    if (!assetId) return res.status(400).json({ error: 'assetId required' });

    const projectId = paramStr(req.params.id);
    await requireAsset(projectId, assetId);

    await updateRows('projects', { id: projectId }, {
      status: 'style_locked',
      style_asset_id: assetId,
      style_description: styleDescription || '',
      updated_at: new Date().toISOString(),
    });

    res.json(await getFullProject(projectId));
  });

  // ─── Upload + Lock Style Image (skip visualize) ─────────────────────

  router.post('/:id/upload-and-lock-style', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Image required' });
    const projectId = paramStr(req.params.id);

    try {
      const ext = req.file.mimetype.includes('png') ? 'png' : req.file.mimetype.includes('jpeg') ? 'jpg' : 'png';
      const filePath = await saveBuffer(req.file.buffer, 'images', ext);
      const assetId = uuidv4();
      await insertRow('assets', { id: assetId, project_id: projectId, category: 'style', file_path: filePath });

      const t0 = Date.now();
      let styleDesc = 'User-uploaded style reference';
      try {
        const imageBase64 = req.file.buffer.toString('base64');
        styleDesc = await analyzeImageStyle(imageBase64, req.file.mimetype);
      } catch (err: any) {
        console.warn(`[${projectId}] style analysis failed, using default description:`, err.message);
      }
      const durationMs = Date.now() - t0;

      await updateRows('projects', { id: projectId }, {
        status: 'style_locked',
        style_asset_id: assetId,
        style_description: styleDesc,
        updated_at: new Date().toISOString(),
      });

      await logCall({
        projectId,
        stage: 'upload-and-lock-style',
        model: 'claude-sonnet-4-6',
        prompt: 'User uploaded image directly as style — analyzed for description, locked as style ref.',
        referenceInputs: [{ type: 'image', label: 'User-uploaded style', url: storageUrl(filePath) }],
        contextChain: await buildContextChain(projectId),
        responseSummary: styleDesc.substring(0, 200),
        outputAssetIds: [assetId],
        durationMs,
        costEstimate: 0.01,
      });

      res.json(await getFullProject(projectId));
    } catch (err: any) {
      console.error(`[${projectId}] upload-and-lock-style failed:`, err);
      res.status((err as any).statusCode || 500).json({ error: err.message });
    }
  });

  // ─── Analyze Uploaded Style Image ───────────────────────────────────

  router.post('/:id/analyze-style-image', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Image required' });
    const projectId = paramStr(req.params.id);
    const prompt = 'Analyze uploaded style reference image for visual style description';

    try {
      const imageBase64 = req.file.buffer.toString('base64');
      const t0 = Date.now();
      const styleDesc = await analyzeImageStyle(imageBase64, req.file.mimetype);
      const durationMs = Date.now() - t0;

      await updateRows('projects', { id: projectId }, { style_description: styleDesc, updated_at: new Date().toISOString() });

      await logCall({
        projectId,
        stage: 'analyze-style-image',
        model: 'claude-sonnet-4-6',
        prompt,
        referenceInputs: [{ type: 'image', label: 'User-uploaded style reference' }],
        contextChain: await buildContextChain(projectId),
        responseSummary: styleDesc.substring(0, 200),
        durationMs,
        costEstimate: 0.01,
      });

      res.json({ styleDescription: styleDesc, project: await getFullProject(projectId) });
    } catch (err: any) {
      await logCall({
        projectId,
        stage: 'analyze-style-image',
        model: 'claude-sonnet-4-6',
        prompt,
        durationMs: 0,
        error: err.message,
      });
      res.status((err as any).statusCode || 500).json({ error: err.message });
    }
  });

};
