/**
 * Style generation routes — extracted from generate.ts.
 * Handles: brainstorm, visualize, refine, lock, upload-and-lock, analyze-style-image.
 */
import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { selectOne, selectColumns, insertRow, updateRows, selectAll } from '../database.js';
import { saveBuffer, storageUrl } from '../storage.js';
import { buildStylePrompt } from '../services/imagen.js';
import { brainstormStyleDirections, refineStyleDirection, analyzeImageStyle } from '../services/claude.js';
import { getImageGenerationModelName, getImageService } from '../services/image-provider.js';
import { getFullProject } from './projects.js';
import { logCall, buildContextChain } from '../xray.js';
import { paramStr, requireAsset } from './scope-helpers.js';
import { getProjectRuntimePreset, presetSubject } from '../presets.js';
import { getStylePreset, STYLE_PRESETS } from '../style-presets.js';
import { recordDirectorEvent } from '../services/directorEvents.js';
import { sendStructuredError } from '../services/structuredErrors.js';
import { formatSelectedStyleNotes, getProjectStyleNotesState } from '../services/projectConfig.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const mountStyleRoutes = (router: Router) => {
  const markStyleDependentsStale = async (projectId: string) => {
    // On first style lock these are no-ops; on later swaps this surfaces the
    // "Outdated" indicator so refs and shot prompts do not look falsely valid.
    await updateRows('cast_members', { project_id: projectId }, { prompts_stale: true });
    await updateRows('environments', { project_id: projectId }, { prompts_stale: true });
    const scenes = await selectAll('scenes', { project_id: projectId });
    for (const scene of scenes) {
      await updateRows('shots', { scene_id: scene.id }, { prompts_stale: true });
    }
  };

  // ─── Curated Style Presets ─────────────────────────────────────────

  router.get('/:id/style-presets', async (_req, res) => {
    // Resolve the curated preview image path to a public URL per preset.
    const presets = STYLE_PRESETS.map(p => ({
      key: p.key,
      title: p.title,
      description: p.description,
      previewImageUrl: storageUrl(p.previewImagePath),
    }));
    res.json({ presets });
  });

  // Lock a curated style preset directly as the project style. No
  // visualization step — the preset IS the style image. We point a new
  // project-scoped asset row at the preset's shared file path (same shared
  // file_path pattern forks use) and apply the same downstream-stale logic
  // /lock-style uses.
  //
  // style_description is INTENTIONALLY empty: the image carries everything
  // downstream prompts need (buildCharacterPrompt and friends already only
  // reference the style image by index, never the description text). Storing
  // the preset description would leak prose into the concept-regen hint path
  // and re-introduce the "warm hues" pollution the artist was seeing.
  router.post('/:id/lock-style-preset', async (req, res) => {
    const project = await selectOne('projects', { id: paramStr(req.params.id) });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { presetKey } = req.body || {};
    const preset = typeof presetKey === 'string' ? getStylePreset(presetKey) : undefined;
    if (!preset) return res.status(400).json({ error: 'Valid presetKey required' });

    const assetId = uuidv4();
    await insertRow('assets', {
      id: assetId,
      project_id: project.id,
      category: 'style',
      file_path: preset.previewImagePath,
      prompt: `Curated preset: ${preset.title}`,
      metadata: JSON.stringify({ stylePresetKey: preset.key, stylePresetTitle: preset.title, curatedPreset: true }),
    });

    await updateRows('projects', { id: project.id }, {
      status: 'style_locked',
      style_asset_id: assetId,
      style_description: '',
      updated_at: new Date().toISOString(),
    });

    await markStyleDependentsStale(project.id);

    await logCall({
      projectId: project.id,
      stage: 'lock-style-preset',
      model: 'n/a',
      prompt: `Locked curated style preset: ${preset.title}`,
      contextChain: await buildContextChain(project.id),
      responseSummary: `Locked preset ${preset.key} as project style — no image gen, shared curated file path.`,
      outputAssetIds: [assetId],
      durationMs: 0,
      costEstimate: 0,
    });
    await recordDirectorEvent({
      projectId: project.id,
      userId: req.userId,
      source: 'web',
      eventType: 'style_preset_locked',
      entityType: 'project',
      entityId: project.id,
      summary: `Artist locked curated style preset "${preset.title}".`,
      payload: { assetId, presetKey: preset.key, presetTitle: preset.title },
    });

    res.json(await getFullProject(project.id));
  });

  // ─── Brainstorm Style Directions (text only, no images) ─────────────

  router.post('/:id/brainstorm-styles', async (req, res) => {
    const project = await selectOne('projects', { id: paramStr(req.params.id) });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const concept = JSON.parse(project.locked_concept || '{}');
    const { userNotes } = req.body;
    const preset = getProjectRuntimePreset(project, req.body?.presetKey);

    try {
      console.log(`[${project.id}] Brainstorming style directions...`);
      const t0 = Date.now();
      const scenes = await selectColumns('scenes', 'section_label, narrative_description', { project_id: project.id }, { orderBy: 'sort_order', ascending: true });
      const scriptSummary = scenes.length > 0
        ? scenes.map((s: any) => `[${s.section_label}] ${s.narrative_description}`).join('\n')
        : undefined;
      const projectStyleNotes = await getProjectStyleNotesState(project.id);
      const styleNotes = formatSelectedStyleNotes(projectStyleNotes, ['image']);

      const { directions, prompt } = await brainstormStyleDirections(
        project.lyrics || '',
        project.meaning || '',
        concept,
        userNotes,
        scriptSummary,
        project.text_provider,
        preset,
        styleNotes,
      );
      const durationMs = Date.now() - t0;

      await logCall({
        projectId: project.id,
        stage: 'brainstorm-styles',
        model: project.text_provider || 'claude-opus-4-7',
        prompt,
        contextChain: await buildContextChain(project.id),
        responseSummary: JSON.stringify({ presetKey: preset.key, workflowKey: preset.workflowKey, directions }),
        durationMs,
        costEstimate: 0.01,
      });
      await recordDirectorEvent({
        projectId: project.id,
        userId: req.userId,
        source: 'web',
        eventType: 'style_directions_brainstormed',
        entityType: 'project',
        entityId: project.id,
        summary: `Artist brainstormed ${directions.length} style directions.`,
        payload: { count: directions.length, userNotes: userNotes || null },
      });

      res.json({ directions });
    } catch (err: any) {
      console.error(`[${project.id}] Brainstorm failed:`, err);
      await logCall({
        projectId: project.id,
        stage: 'brainstorm-styles',
        model: project.text_provider || 'claude-opus-4-7',
        prompt: `Brainstorm 4 style directions`,
        durationMs: 0,
        error: err.message,
      });
      sendStructuredError(res, err);
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
    const preset = getProjectRuntimePreset(project, req.body?.presetKey);
    const subject = presetSubject(concept, project.title, preset);
    const projectStyleNotes = await getProjectStyleNotesState(project.id);
    const styleNotes = formatSelectedStyleNotes(projectStyleNotes, ['image']);
    const genPrompt = buildStylePrompt(stylePrompt, subject, preset, styleNotes);

    try {
      console.log(`[${project.id}] Visualizing style direction...`);
      const t0 = Date.now();
      const imageService = getImageService(project.image_model);
      const assetPath = await imageService.generateSingleStyleImage(
        stylePrompt,
        subject,
        genPrompt,
        preset,
        getImageGenerationModelName(project.image_model),
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
      await recordDirectorEvent({
        projectId: project.id,
        userId: req.userId,
        source: 'web',
        eventType: 'style_visualized',
        entityType: 'asset',
        entityId: assetId,
        summary: 'Artist visualized a style direction.',
        payload: { assetId },
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
      sendStructuredError(res, err);
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
      const projectStyleNotes = await getProjectStyleNotesState(project.id);
      const styleNotes = formatSelectedStyleNotes(projectStyleNotes, ['image']);
      const refined = await refineStyleDirection(description, feedback, concept, project.text_provider, getProjectRuntimePreset(project, req.body?.presetKey), styleNotes);
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
      await recordDirectorEvent({
        projectId: project.id,
        userId: req.userId,
        source: 'web',
        eventType: 'style_direction_refined',
        entityType: 'project',
        entityId: project.id,
        summary: 'Artist refined a style direction.',
        payload: { feedback: feedback || null, title: refined?.title || null },
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
      sendStructuredError(res, err);
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

    await markStyleDependentsStale(projectId);
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'style_locked',
      entityType: 'asset',
      entityId: assetId,
      summary: 'Artist locked the project style reference; downstream prompts were marked stale.',
      payload: { assetId, hasDescription: !!styleDescription },
    });

    res.json(await getFullProject(projectId));
  });

  // ─── Upload + Lock Style Image (skip visualize) ─────────────────────

  router.post('/:id/upload-and-lock-style', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Image required' });
    const projectId = paramStr(req.params.id);
    const projectForProvider = await selectOne('projects', { id: projectId });

    try {
      const ext = req.file.mimetype.includes('png') ? 'png' : req.file.mimetype.includes('jpeg') ? 'jpg' : 'png';
      const filePath = await saveBuffer(req.file.buffer, 'images', ext);
      const assetId = uuidv4();
      await insertRow('assets', { id: assetId, project_id: projectId, category: 'style', file_path: filePath });

      const t0 = Date.now();
      let styleDesc = 'User-uploaded style reference';
      try {
        const imageBase64 = req.file.buffer.toString('base64');
        styleDesc = await analyzeImageStyle(imageBase64, req.file.mimetype, projectForProvider?.text_provider);
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
      await markStyleDependentsStale(projectId);

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
      await recordDirectorEvent({
        projectId,
        userId: req.userId,
        source: 'web',
        eventType: 'style_uploaded_and_locked',
        entityType: 'asset',
        entityId: assetId,
        summary: 'Artist uploaded and locked a style reference; downstream prompts were marked stale.',
        payload: { assetId, analyzed: !!styleDesc },
      });

      res.json(await getFullProject(projectId));
    } catch (err: any) {
      console.error(`[${projectId}] upload-and-lock-style failed:`, err);
      sendStructuredError(res, err);
    }
  });

  // ─── Analyze Uploaded Style Image ───────────────────────────────────

  router.post('/:id/analyze-style-image', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Image required' });
    const projectId = paramStr(req.params.id);
    const prompt = 'Analyze uploaded style reference image for visual style description';
    const projectForProvider = await selectOne('projects', { id: projectId });

    try {
      const imageBase64 = req.file.buffer.toString('base64');
      const t0 = Date.now();
      const styleDesc = await analyzeImageStyle(imageBase64, req.file.mimetype, projectForProvider?.text_provider);
      const durationMs = Date.now() - t0;

      await updateRows('projects', { id: projectId }, { style_description: styleDesc, updated_at: new Date().toISOString() });
      await recordDirectorEvent({
        projectId,
        userId: req.userId,
        source: 'web',
        eventType: 'style_image_analyzed',
        entityType: 'project',
        entityId: projectId,
        summary: 'Artist analyzed an uploaded style image.',
      });

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
      sendStructuredError(res, err);
    }
  });

};
