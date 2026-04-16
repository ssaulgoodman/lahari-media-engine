import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { selectAll, selectOne, insertRow, insertMany, updateRows, deleteRows, countRows, maxVal, selectColumns, findShot, incrementColumn, getSB, T } from '../database.js';
import { readAsBase64, mimeFromExt, saveBase64, saveBuffer, storageUrl } from '../storage.js';
import { generateStyleOptions, generateCharacterLooks, generateSingleStyleImage, generateEnvironmentLooks, generateShotStartFrame } from '../services/imagen.js';
import { critiqueShotImage, chatWithDirector, describeFrame } from '../services/gemini.js';
import { planScenes, writeShotPrompts, brainstormStyleDirections, refineStyleDirection, enrichStyleDNA, analyzeImageStyle, refineShotPrompt, refreshChainedShotPrompt } from '../services/claude.js';
import { generateVideo, extractLastFrame, VEO_MODELS, VeoModelKey } from '../services/veo.js';
import { generateFalVideo, FAL_VIDEO_MODELS } from '../services/fal.js';
import { getFullProject, forkProject } from './projects.js';
import { logCall, buildContextChain } from '../xray.js';

const router = Router();

// Helper: get route param as string (Express 5 returns string | string[])
const paramStr = (val: string | string[]): string => Array.isArray(val) ? val[0] : val;
const upload = multer({ storage: multer.memoryStorage() });

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
    res.status(500).json({ error: err.message });
  }
});

// ─── Brainstorm Style Directions (text only, no images) ─────────────

router.post('/:id/brainstorm-styles', async (req, res) => {
  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const concept = JSON.parse(project.locked_concept || '{}');
  const structure = JSON.parse(project.musical_structure || '[]');
  const { userNotes } = req.body;

  try {
    console.log(`[${project.id}] Brainstorming style directions...`);
    const t0 = Date.now();
    // Build script summary for richer brainstorm context
    const scenes = await selectColumns('scenes', 'section_label, narrative_description', { project_id: project.id }, { orderBy: 'sort_order', ascending: true });
    const scriptSummary = scenes.length > 0
      ? scenes.map((s: any) => `[${s.section_label}] ${s.narrative_description}`).join('\n')
      : undefined;

    const directions = await brainstormStyleDirections(
      project.lyrics || '',
      structure,
      project.meaning || '',
      concept,
      userNotes,
      scriptSummary
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
    res.status(500).json({ error: err.message });
  }
});

// ─── Visualize a Single Style Direction (one image) ─────────────────

router.post('/:id/visualize-style', async (req, res) => {
  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const concept = JSON.parse(project.locked_concept || '{}');
  const { prompt: stylePrompt } = req.body;
  if (!stylePrompt) return res.status(400).json({ error: 'prompt required' });

  try {
    console.log(`[${project.id}] Visualizing style direction...`);
    const t0 = Date.now();
    const assetPath = await generateSingleStyleImage(
      stylePrompt,
      concept.deity || project.title
    );
    const durationMs = Date.now() - t0;

    const assetId = uuidv4();
    await insertRow('assets', { id: assetId, project_id: project.id, category: 'style', file_path: assetPath, prompt: stylePrompt });

    await logCall({
      projectId: project.id,
      stage: 'visualize-style',
      model: 'gemini-3-pro-image-preview',
      prompt: stylePrompt,
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
      model: 'gemini-3-pro-image-preview',
      prompt: stylePrompt,
      durationMs: 0,
      error: err.message,
    });
    res.status(500).json({ error: err.message });
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
    const refined = await refineStyleDirection(description, feedback, concept);
    const durationMs = Date.now() - t0;

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
    res.status(500).json({ error: err.message });
  }
});

// ─── Lock Style (with DNA enrichment) ───────────────────────────────

router.post('/:id/lock-style', async (req, res) => {
  const { assetId, styleDescription } = req.body;
  if (!assetId) return res.status(400).json({ error: 'assetId required' });

  const projectId = paramStr(req.params.id);

  // Enrich style DNA from the locked image
  let enrichedDescription = styleDescription || '';
  try {
    const asset = await selectOne('assets', { id: assetId });
    if (asset) {
      console.log(`[${projectId}] Enriching style DNA...`);
      const t0 = Date.now();
      const imageBase64 = await readAsBase64(asset.file_path);
      const mimeType = mimeFromExt(asset.file_path);
      enrichedDescription = await enrichStyleDNA(imageBase64, mimeType, styleDescription || '');
      const durationMs = Date.now() - t0;

      await logCall({
        projectId,
        stage: 'enrich-style-dna',
        model: 'claude-sonnet-4-6',
        prompt: `Enrich style DNA from locked image | Short desc: ${(styleDescription || '').substring(0, 100)}`,
        referenceInputs: [{ type: 'image', label: 'Locked style image', url: storageUrl(asset.file_path) }],
        contextChain: await buildContextChain(projectId),
        responseSummary: enrichedDescription.substring(0, 300),
        durationMs,
        costEstimate: 0.01,
      });
    }
  } catch (err) {
    console.error('[lock-style] Style DNA enrichment failed, using short description:', err);
  }

  await updateRows('projects', { id: projectId }, {
    status: 'style_locked',
    style_asset_id: assetId,
    style_description: enrichedDescription,
    updated_at: new Date().toISOString(),
  });

  res.json(await getFullProject(projectId));
});

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
  res.json(await getFullProject(projectId));
});

router.post('/:id/unlock-style', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.status !== 'style_locked') {
    return res.status(400).json({ error: `Cannot unlock style from status "${project.status}". Unlock later phases first.` });
  }
  await updateRows('projects', { id: projectId }, { status: 'scripted', updated_at: new Date().toISOString() });
  res.json(await getFullProject(projectId));
});

router.post('/:id/unlock-characters', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.status !== 'characters_locked') {
    return res.status(400).json({ error: `Cannot unlock characters from status "${project.status}". Unlock later phases first.` });
  }
  await updateRows('projects', { id: projectId }, { status: 'style_locked', updated_at: new Date().toISOString() });
  res.json(await getFullProject(projectId));
});

router.post('/:id/unlock-environments', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.status !== 'environments_locked' && project.status !== 'in_production') {
    return res.status(400).json({ error: `Cannot unlock environments from status "${project.status}".` });
  }
  await updateRows('projects', { id: projectId }, { status: 'characters_locked', updated_at: new Date().toISOString() });
  res.json(await getFullProject(projectId));
});

// ─── Upload + Lock Style Image (skip visualize) ─────────────────────
// User uploads an image, we save it, analyze for style description,
// and lock it as the project's style ref in one shot.
router.post('/:id/upload-and-lock-style', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image required' });
  const projectId = paramStr(req.params.id);

  try {
    // Save the uploaded image as a project asset
    const ext = req.file.mimetype.includes('png') ? 'png' : req.file.mimetype.includes('jpeg') ? 'jpg' : 'png';
    const filePath = await saveBuffer(req.file.buffer, 'images', ext);
    const assetId = uuidv4();
    await insertRow('assets', { id: assetId, project_id: projectId, category: 'style', file_path: filePath });

    // Analyze for style description so downstream shot gen has something to reference
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate Character Looks ───────────────────────────────────────

// Accepts either a JSON body {castMemberId, feedback} or multipart form-data
// with the same fields plus an optional `image` file to use as a visual ref.
// When `image` is provided, the file is saved and fed to Gemini as Image 2 so
// the 3 candidates match a director-supplied reference while being rendered
// in the project's style.
router.post('/:id/generate-looks', upload.single('image'), async (req, res) => {
  const { castMemberId, feedback } = req.body;
  if (!castMemberId) return res.status(400).json({ error: 'castMemberId required' });

  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const member = await selectOne('cast_members', { id: castMemberId });
  if (!member) return res.status(404).json({ error: 'Cast member not found' });

  const styleDNA = project.style_description || 'Cinematic, photorealistic';

  // Resolve style image path for visual ref
  let styleImagePath: string | undefined;
  if (project.style_asset_id) {
    const styleAsset = await selectOne('assets', { id: project.style_asset_id });
    if (styleAsset) styleImagePath = styleAsset.file_path;
  }

  // If the director uploaded a reference image for this batch, save it and
  // pass it to generateCharacterLooks as a visual guide.
  let userRefImagePath: string | undefined;
  let userRefAssetId: string | undefined;
  if (req.file) {
    const ext = req.file.mimetype.includes('png') ? 'png' : req.file.mimetype.includes('jpeg') ? 'jpg' : 'png';
    userRefImagePath = await saveBuffer(req.file.buffer, 'images', ext);
    userRefAssetId = uuidv4();
    await insertRow('assets', { id: userRefAssetId, project_id: project.id, category: 'character_user_ref', file_path: userRefImagePath });
  }

  const xrayPrompt = `Generate 3 looks for "${member.name}" — ${(member.description || '').substring(0, 100)} | Style DNA: ${styleDNA.substring(0, 100)}...${feedback ? ` | Feedback: ${feedback}` : ''}${userRefImagePath ? ' | with user-supplied ref' : ''}`;

  try {
    console.log(`[${project.id}] Generating looks for ${member.name} via gemini-3-pro-image-preview${userRefImagePath ? ' (with user ref)' : ''}...`);
    const t0 = Date.now();

    const imagePaths = await generateCharacterLooks(
      { name: member.name, description: member.description || '' },
      styleDNA,
      styleImagePath,
      feedback,
      project.aspect_ratio || '16:9',
      userRefImagePath,
    );
    const durationMs = Date.now() - t0;

    // Save as assets and return URLs
    const looks: { id: string; url: string }[] = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const assetId = uuidv4();
      await insertRow('assets', { id: assetId, project_id: project.id, category: 'character', file_path: imagePaths[i], prompt: `Look ${i + 1} for ${member.name}` });
      looks.push({ id: assetId, url: storageUrl(imagePaths[i]) });
    }

    await logCall({
      projectId: project.id,
      stage: 'generate-looks',
      model: 'gemini-3-pro-image-preview',
      prompt: xrayPrompt,
      referenceInputs: [
        ...(styleImagePath ? [{ type: 'image' as const, label: 'Style reference', url: storageUrl(styleImagePath) }] : []),
        ...(userRefImagePath ? [{ type: 'image' as const, label: `${member.name} — user-supplied ref`, url: storageUrl(userRefImagePath) }] : []),
      ],
      contextChain: await buildContextChain(project.id),
      responseSummary: `Generated ${imagePaths.length} looks for ${member.name}${userRefImagePath ? ' (guided by user ref)' : ''}`,
      outputAssetIds: looks.map(l => l.id),
      durationMs,
      costEstimate: 0.04,
    });

    res.json({ looks, project: await getFullProject(project.id) });
  } catch (err: any) {
    console.error(`[${project.id}] Look gen failed:`, err);
    await logCall({
      projectId: project.id,
      stage: 'generate-looks',
      model: 'gemini-3-pro-image-preview',
      prompt: xrayPrompt,
      contextChain: await buildContextChain(project.id),
      durationMs: 0,
      error: err.message,
    });
    res.status(500).json({ error: err.message });
  }
});

// ─── Lock Character Reference ───────────────────────────────────────

// ─── Upload Character Reference ─────────────────────────────────────
// Artist has an image they want to use as-is (or as a starting point).
// Saves the file, registers it as a character asset, and sets it as the
// cast member's reference in one shot — skipping Gemini generation.
router.post('/:id/upload-character-reference', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image required' });
  const { castMemberId } = req.body;
  if (!castMemberId) return res.status(400).json({ error: 'castMemberId required' });

  const projectId = paramStr(req.params.id);
  // Check cast member belongs to this project
  const members = await selectAll('cast_members', { id: castMemberId, project_id: projectId });
  const member = members.length > 0 ? members[0] : null;
  if (!member) return res.status(404).json({ error: 'Cast member not found' });

  try {
    const ext = req.file.mimetype.includes('png') ? 'png' : req.file.mimetype.includes('jpeg') ? 'jpg' : 'png';
    const filePath = await saveBuffer(req.file.buffer, 'images', ext);
    const assetId = uuidv4();
    await insertRow('assets', { id: assetId, project_id: projectId, category: 'character', file_path: filePath });
    await updateRows('cast_members', { id: castMemberId }, { reference_asset_id: assetId });

    await logCall({
      projectId,
      stage: 'upload-character-reference',
      model: 'upload',
      prompt: `User uploaded reference for character "${member.name}"`,
      referenceInputs: [{ type: 'image', label: `${member.name} — uploaded`, url: storageUrl(filePath) }],
      contextChain: await buildContextChain(projectId),
      responseSummary: `Locked uploaded image as ${member.name}'s reference`,
      outputAssetIds: [assetId],
      durationMs: 0,
      costEstimate: 0,
    });

    res.json(await getFullProject(projectId));
  } catch (err: any) {
    console.error(`[${projectId}] upload-character-reference failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/lock-character', async (req, res) => {
  const { castMemberId, assetId } = req.body;
  if (!castMemberId || !assetId) return res.status(400).json({ error: 'castMemberId and assetId required' });

  await updateRows('cast_members', { id: castMemberId }, { reference_asset_id: assetId });

  // Don't auto-advance — user clicks "Proceed" when satisfied
  res.json(await getFullProject(paramStr(req.params.id)));
});

// ─── Advance past Characters phase ─────────────────────────────────
// User decides when they're done — not all cast members need looks

// Idempotent: if already past characters_locked, no-op. If before, bump up.
// The UI lets users jump around tabs, so a strict status gate breaks the flow.
const PHASE_ORDER_SERVER = ['uploaded','analyzed','concept_locked','scripted','style_locked','characters_locked','environments_locked','in_production','completed'];
const atLeast = (cur: string, target: string) => PHASE_ORDER_SERVER.indexOf(cur) >= PHASE_ORDER_SERVER.indexOf(target);

router.post('/:id/advance-characters', async (req, res) => {
  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!atLeast(project.status, 'characters_locked')) {
    await updateRows('projects', { id: paramStr(req.params.id) }, { status: 'characters_locked', updated_at: new Date().toISOString() });
  }
  res.json(await getFullProject(paramStr(req.params.id)));
});

// ─── Generate Environment Looks ──────────────────────────────────────

router.post('/:id/generate-environment-look', upload.single('image'), async (req, res) => {
  const { environmentId, note } = req.body;
  if (!environmentId) return res.status(400).json({ error: 'environmentId required' });

  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const env = await selectOne('environments', { id: environmentId });
  if (!env) return res.status(404).json({ error: 'Environment not found' });

  const styleDNA = project.style_description || 'Cinematic, photorealistic';

  let styleImagePath: string | undefined;
  if (project.style_asset_id) {
    const styleAsset = await selectOne('assets', { id: project.style_asset_id });
    if (styleAsset) styleImagePath = styleAsset.file_path;
  }

  // Optional director-supplied environment reference.
  let userRefImagePath: string | undefined;
  if (req.file) {
    const ext = req.file.mimetype.includes('png') ? 'png' : req.file.mimetype.includes('jpeg') ? 'jpg' : 'png';
    userRefImagePath = await saveBuffer(req.file.buffer, 'images', ext);
    const refAssetId = uuidv4();
    await insertRow('assets', { id: refAssetId, project_id: project.id, category: 'environment_user_ref', file_path: userRefImagePath });
  }

  try {
    console.log(`[${project.id}] Generating environment looks for ${env.name}${userRefImagePath ? ' (with user ref)' : ''}...`);
    const t0 = Date.now();

    const imagePaths = await generateEnvironmentLooks(
      { name: env.name, description: env.description || '' },
      styleDNA,
      styleImagePath,
      project.aspect_ratio || '16:9',
      userRefImagePath,
      typeof note === 'string' && note.trim() ? note.trim() : undefined,
    );
    const durationMs = Date.now() - t0;

    const looks: { id: string; url: string }[] = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const assetId = uuidv4();
      await insertRow('assets', { id: assetId, project_id: project.id, category: 'environment', file_path: imagePaths[i], prompt: `Environment look ${i + 1} for ${env.name}` });
      looks.push({ id: assetId, url: storageUrl(imagePaths[i]) });
    }

    await logCall({
      projectId: project.id,
      stage: 'generate-environment-look',
      model: 'gemini-3-pro-image-preview',
      prompt: `Generate 3 environment looks for "${env.name}" — ${(env.description || '').substring(0, 100)}`,
      referenceInputs: [
        ...(styleImagePath ? [{ type: 'image' as const, label: 'Style reference', url: storageUrl(styleImagePath) }] : []),
        ...(userRefImagePath ? [{ type: 'image' as const, label: `${env.name} — user-supplied ref`, url: storageUrl(userRefImagePath) }] : []),
      ],
      contextChain: await buildContextChain(project.id),
      responseSummary: `Generated ${imagePaths.length} looks for environment ${env.name}${userRefImagePath ? ' (guided by user ref)' : ''}`,
      outputAssetIds: looks.map(l => l.id),
      durationMs,
      costEstimate: 0.04,
    });

    res.json({ looks, project: await getFullProject(project.id) });
  } catch (err: any) {
    console.error(`[${project.id}] Environment look gen failed:`, err);
    await logCall({
      projectId: project.id,
      stage: 'generate-environment-look',
      model: 'gemini-3-pro-image-preview',
      prompt: `Generate environment looks for "${env.name}"`,
      durationMs: 0,
      error: err.message,
    });
    res.status(500).json({ error: err.message });
  }
});

// ─── Lock Environment Reference ─────────────────────────────────────

// ─── Upload Environment Reference ───────────────────────────────────

router.post('/:id/upload-environment-reference', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image required' });
  const { environmentId } = req.body;
  if (!environmentId) return res.status(400).json({ error: 'environmentId required' });

  const projectId = paramStr(req.params.id);
  const envRows = await selectAll('environments', { id: environmentId, project_id: projectId });
  const env = envRows.length > 0 ? envRows[0] : null;
  if (!env) return res.status(404).json({ error: 'Environment not found' });

  try {
    const ext = req.file.mimetype.includes('png') ? 'png' : req.file.mimetype.includes('jpeg') ? 'jpg' : 'png';
    const filePath = await saveBuffer(req.file.buffer, 'images', ext);
    const assetId = uuidv4();
    await insertRow('assets', { id: assetId, project_id: projectId, category: 'environment', file_path: filePath });
    await updateRows('environments', { id: environmentId }, { reference_asset_id: assetId });

    await logCall({
      projectId,
      stage: 'upload-environment-reference',
      model: 'upload',
      prompt: `User uploaded reference for environment "${env.name}"`,
      referenceInputs: [{ type: 'image', label: `${env.name} — uploaded`, url: storageUrl(filePath) }],
      contextChain: await buildContextChain(projectId),
      responseSummary: `Locked uploaded image as ${env.name}'s reference`,
      outputAssetIds: [assetId],
      durationMs: 0,
      costEstimate: 0,
    });

    res.json(await getFullProject(projectId));
  } catch (err: any) {
    console.error(`[${projectId}] upload-environment-reference failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/lock-environment', async (req, res) => {
  const { environmentId, assetId } = req.body;
  if (!environmentId || !assetId) return res.status(400).json({ error: 'environmentId and assetId required' });

  await updateRows('environments', { id: environmentId }, { reference_asset_id: assetId });

  // Don't auto-advance — user clicks "Proceed" when satisfied
  res.json(await getFullProject(paramStr(req.params.id)));
});

// ─── Advance past Environments phase ────────────────────────────────
// User decides when they're done — not all environments need looks

router.post('/:id/advance-environments', async (req, res) => {
  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  // Also bump through characters_locked if skipped — the user is clearly done with earlier phases.
  if (!atLeast(project.status, 'environments_locked')) {
    await updateRows('projects', { id: paramStr(req.params.id) }, { status: 'environments_locked', updated_at: new Date().toISOString() });
  }
  res.json(await getFullProject(paramStr(req.params.id)));
});

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

      for (let shIdx = 0; shIdx < (scene.shots || []).length; shIdx++) {
        const shot = scene.shots[shIdx];
        const shotId = uuidv4();
        // Map castNames → castIds using the name→id lookup
        const castNames: string[] = shot.castNames || [];
        const castIds = castNames.map((name: string) => nameToId[name] || name).filter(Boolean);
        // Map environmentName → environmentId
        const envId = shot.environmentName ? (envNameToId[shot.environmentName] || null) : null;

        // Store direction as visual_prompt placeholder — writeShotPrompts will overwrite later
        await insertRow('shots', {
          id: shotId,
          scene_id: sceneId,
          visual_prompt: shot.direction || '',
          motion_prompt: '',  // motion_prompt left empty — writeShotPrompts fills it
          duration: shot.duration || (project.target_duration || 8),
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// ─── Refine Shot Prompt (vision + rewrite) ─────────────────────────

router.post('/:id/shots/:shotId/refine-prompt', async (req, res) => {
  const { feedback } = req.body;
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

  try {
    const t0 = Date.now();
    const imageBase64 = await readAsBase64(imageAsset.file_path);
    const mime = mimeFromExt(imageAsset.file_path);

    const result = await refineShotPrompt({
      currentVisualPrompt: shot.visual_prompt || '',
      currentMotionPrompt: shot.motion_prompt || 'Cinematic camera movement',
      feedback,
      failedImageBase64: imageBase64,
      failedImageMime: mime,
      styleDNA: project.style_description || 'Cinematic',
      characterDescriptions: charDescs,
    });

    // Update the shot prompts with the rewritten versions
    await updateRows('shots', { id: shot.id }, {
      visual_prompt: result.visualPrompt,
      motion_prompt: result.motionPrompt,
      user_feedback: feedback,
      refined_from_prev_frame: 0,
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
    res.status(500).json({ error: err.message });
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

  const shotCastIds = JSON.parse(shot.cast_ids || '[]');
  const cast = await selectAll('cast_members', { project_id: paramStr(req.params.id) });
  const activeCast = cast.filter((c: any) => shotCastIds.includes(c.id));

  const shotPrompt = shot.visual_prompt || '';
  const userFeedback = shot.user_feedback || undefined;

  // Resolve style image path
  let styleImagePath: string | undefined;
  if (project.style_asset_id) {
    const styleAsset = await selectOne('assets', { id: project.style_asset_id });
    if (styleAsset) styleImagePath = styleAsset.file_path;
  }

  // Resolve character reference images
  const characterRefs: { name: string; imagePath: string }[] = [];
  for (const c of activeCast) {
    if (c.reference_asset_id) {
      const asset = await selectOne('assets', { id: c.reference_asset_id });
      if (asset) characterRefs.push({ name: c.name, imagePath: asset.file_path });
    }
  }

  // Resolve environment reference
  let environmentRef: { name: string; imagePath: string } | undefined;
  if (shot.environment_id) {
    const env = await selectOne('environments', { id: shot.environment_id });
    if (env?.reference_asset_id) {
      const asset = await selectOne('assets', { id: env.reference_asset_id });
      if (asset) environmentRef = { name: env.name, imagePath: asset.file_path };
    }
  }

  // Continuity lookup — only runs when Claude tagged this shot as continuing
  // from the previous one. Hard-cut shots skip this entirely so they can
  // generate in parallel without waiting for the previous shot's video.
  let prevShotEndFramePath: string | undefined;
  let continuityDescription: string | undefined = shot.continuity_description || undefined;
  if (shot.continuity_from === 'prev_shot' && shot.sort_order > 0) {
    const prevShot = await findShot(shot.scene_id, shot.sort_order - 1);
    const continuityAssetId = prevShot?.extracted_last_frame_asset_id || prevShot?.end_image_asset_id;
    if (continuityAssetId) {
      const asset = await selectOne('assets', { id: continuityAssetId });
      if (asset) prevShotEndFramePath = asset.file_path;
    }

    // Vision-describe the extracted continuity frame once, cache on the shot.
    if (prevShotEndFramePath && !continuityDescription) {
      try {
        const base64 = await readAsBase64(prevShotEndFramePath);
        const mime = mimeFromExt(prevShotEndFramePath);
        continuityDescription = await describeFrame(base64, mime);
        await updateRows('shots', { id: shot.id }, { continuity_description: continuityDescription });
        console.log(`[shot ${shot.id}] Continuity described: ${continuityDescription.substring(0, 100)}...`);
      } catch (err: any) {
        console.warn(`[shot ${shot.id}] Continuity description failed: ${err.message}`);
      }
    }
  }

  try {
    await updateRows('shots', { id: shot.id }, { image_status: 'loading' });
    const t0 = Date.now();

    console.log(`[shot ${shot.id}] Generating start frame with ${characterRefs.length} char refs, env: ${environmentRef?.name || 'none'}, prev end frame: ${prevShotEndFramePath ? 'yes' : 'no'}`);

    // If regenerating with feedback, pass the failed image so the model can
    // see what went wrong and avoid the same issues.
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
    });

    const durationMs = Date.now() - t0;

    // Save asset
    const assetId = uuidv4();
    await insertRow('assets', { id: assetId, project_id: project.id, category: 'shot_image', file_path: imagePath, prompt: shotPrompt });

    await updateRows('shots', { id: shot.id }, {
      image_asset_id: assetId,
      image_status: 'success',
      user_feedback: null,
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
    await updateRows('shots', { id: shot.id }, { image_status: 'error' });
    res.status(500).json({ error: err.message });
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
  await insertRow('assets', { id: newAssetId, project_id: projectId, category: 'shot_image', file_path: sourceAsset.file_path });

  await updateRows('shots', { id: shotId }, {
    image_asset_id: newAssetId,
    image_status: 'success',
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
  const veoModel = (VEO_MODELS as any)[modelKey];
  const falModel = (FAL_VIDEO_MODELS as any)[modelKey];
  const supportsLastFrame = veoModel?.supportsLastFrame || falModel?.supportsLastFrame || false;
  if (!supportsLastFrame) {
    return res.status(400).json({ error: `Current video model (${modelKey}) does not support end-keyframe conditioning. Switch to Veo 3.1 to use reverse-chain.` });
  }

  const prevShot = await findShot(shot.scene_id, shot.sort_order, {}, { lt: true, desc: true });
  if (!prevShot) return res.status(400).json({ error: 'No previous shot in this scene' });
  if (prevShot.locked) return res.status(400).json({ error: 'Previous shot is locked — unlock it first' });

  await updateRows('shots', { id: prevShot.id }, {
    end_image_asset_id: shot.image_asset_id,
    end_image_status: 'success',
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

  const styleAsset = project.style_asset_id
    ? await selectOne('assets', { id: project.style_asset_id })
    : null;

  try {
    await updateRows('shots', { id: shotId }, { end_image_status: 'loading' });
    const t0 = Date.now();

    const { generateShotEndFrame } = await import('../services/imagen.js');
    const endFramePath = await generateShotEndFrame({
      startFramePath: imageAsset.file_path,
      visualPrompt: shot.visual_prompt || '',
      motionPrompt: shot.motion_prompt || 'Cinematic camera movement',
      styleImagePath: styleAsset?.file_path,
      styleDNA: project.style_description || 'Cinematic',
    });

    const assetId = uuidv4();
    await insertRow('assets', { id: assetId, project_id: projectId, shot_id: shotId, category: 'shot_end_frame', file_path: endFramePath });
    await updateRows('shots', { id: shotId }, { end_image_asset_id: assetId, end_image_status: 'success', video_status: 'stale' });

    const durationMs = Date.now() - t0;
    await logCall({
      projectId,
      stage: 'generate-end-frame',
      model: 'gemini-3-pro-image-preview',
      prompt: `End frame for shot: ${shot.visual_prompt?.substring(0, 100)}`,
      referenceInputs: [{ type: 'image', label: 'Start frame', url: storageUrl(imageAsset.file_path) }],
      outputAssetIds: [assetId],
      contextChain: await buildContextChain(projectId),
      durationMs,
      costEstimate: 0.04,
    });

    res.json(await getFullProject(projectId));
  } catch (err: any) {
    await updateRows('shots', { id: shotId }, { end_image_status: 'error' });
    res.status(500).json({ error: `End frame generation failed: ${err.message}` });
  }
});

// Clear end frame — removes the lastFrame constraint, video generates freely
router.post('/:id/shots/:shotId/clear-end-frame', async (req, res) => {
  const shotId = paramStr(req.params.shotId);
  await updateRows('shots', { id: shotId }, { end_image_asset_id: null, end_image_status: 'idle' });
  res.json(await getFullProject(paramStr(req.params.id)));
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
  await updateRows('shots', { id: shotId }, { end_image_asset_id: assetId, end_image_status: 'success', video_status: 'stale' });

  res.json(await getFullProject(projectId));
});

// ─── Lock Shot ───────────────────────────────────────────────────────

router.post('/:id/shots/:shotId/lock', async (req, res) => {
  const shot = await selectOne('shots', { id: paramStr(req.params.shotId) });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });
  if (!shot.image_asset_id) return res.status(400).json({ error: 'Start frame required to lock' });
  if (!shot.video_asset_id) return res.status(400).json({ error: 'Video must be generated before locking' });

  await updateRows('shots', { id: shot.id }, { locked: 1 });
  res.json(await getFullProject(paramStr(req.params.id)));
});

router.post('/:id/shots/:shotId/unlock', async (req, res) => {
  const shot = await selectOne('shots', { id: paramStr(req.params.shotId) });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  await updateRows('shots', { id: shot.id }, { locked: 0 });
  res.json(await getFullProject(paramStr(req.params.id)));
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

router.post('/:id/shots/:shotId/revert-video', async (req, res) => {
  const shotId = paramStr(req.params.shotId);
  const { assetId } = req.body || {};
  if (!assetId) return res.status(400).json({ error: 'assetId required' });

  const assets = await selectAll('assets', { id: assetId, shot_id: shotId, category: 'shot_video' });
  const asset = assets.length > 0 ? assets[0] : null;
  if (!asset) return res.status(404).json({ error: 'Version not found for this shot' });

  let framePair: string | null = null;
  try { framePair = JSON.parse(asset.metadata || '{}').extracted_last_frame_asset_id || null; } catch {}

  await updateRows('shots', { id: shotId }, {
    video_asset_id: asset.id,
    extracted_last_frame_asset_id: framePair,
    video_status: 'success',
  });

  res.json(await getFullProject(paramStr(req.params.id)));
});

// ─── Generate Shot Video ────────────────────────────────────────────

router.post('/:id/shots/:shotId/generate-video', async (req, res) => {
  const { promptOverride } = req.body || {};

  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const shot = await selectOne('shots', { id: paramStr(req.params.shotId) });
  if (!shot || !shot.image_asset_id) return res.status(400).json({ error: 'Shot has no image yet' });

  const imageAsset = await selectOne('assets', { id: shot.image_asset_id });
  if (!imageAsset) return res.status(400).json({ error: 'Image asset not found' });

  const scene = await selectOne('scenes', { id: shot.scene_id });
  const concept = JSON.parse(project.locked_concept || '{}');
  const shotCastIds = JSON.parse(shot.cast_ids || '[]');
  const cast = await selectAll('cast_members', { project_id: paramStr(req.params.id) });
  const activeCast = cast.filter((c: any) => shotCastIds.includes(c.id));

  try {
    await updateRows('shots', { id: shot.id }, { video_status: 'loading' });
    const t0 = Date.now();

    // Build Veo prompt: motion description + brief scene context.
    // No Claude compile — the keyframes carry all visual information.
    // Veo just needs to know what MOVES and the emotional tone.
    const motionDesc = shot.motion_prompt || 'Cinematic camera movement';
    const castNames = activeCast.map((c: any) => c.name).join(', ');
    const mood = concept.mood || 'Cinematic';

    const veoPromptParts = [motionDesc];
    if (scene?.narrative_description) {
      // One-line scene context so Veo understands the emotional beat
      const narrativeBrief = scene.narrative_description.length > 120
        ? scene.narrative_description.substring(0, 120) + '...'
        : scene.narrative_description;
      veoPromptParts.push(narrativeBrief);
    }
    if (castNames) veoPromptParts.push(`Characters: ${castNames}`);
    veoPromptParts.push(`${mood} mood`);
    // Continuity context — only for shots Claude tagged as 'prev_shot'.
    if (shot.continuity_from === 'prev_shot' && shot.continuity_description) {
      veoPromptParts.push(`Starting state (from previous shot): ${shot.continuity_description}`);
    }

    // Use user-provided override if given, otherwise the auto-built prompt
    const veoPrompt = promptOverride?.trim() ? promptOverride.trim() : veoPromptParts.join('. ');

    // Support legacy 'veo-3.1' key (used to mean Fast) by remapping to veo-3.1-fast.
    const rawModelKey = project.video_model || 'veo-3.1-fast';
    const videoModelKey = rawModelKey === 'veo-3.1' ? 'veo-3.1-fast' : rawModelKey;
    const isFal = videoModelKey in FAL_VIDEO_MODELS;
    const isVeo = videoModelKey in VEO_MODELS;

    console.log(`  [shot ${shot.id} video] model=${videoModelKey} | ${veoPrompt.substring(0, 100)}...`);

    // Route to the right provider
    let videoPath: string;
    let costEstimate: number;
    let modelId: string;

    const aspect = (project.aspect_ratio === '9:16' ? '9:16' : '16:9') as '16:9' | '9:16';
    const resolution = (project.video_resolution === '1080p' ? '1080p' : '720p') as '720p' | '1080p';

    // Reverse-chain: if another shot pushed its start frame into this shot's
    // end_image_asset_id, pass it to Veo as the target last frame so the clip
    // lands exactly where the next shot begins. Skip silently for models
    // that don't accept first+last frame (Seedance, Veo 3.0) — the endpoint
    // that set it already gates the feature, this is just defense in depth.
    let endImagePath: string | undefined;
    const modelSupportsLastFrame =
      (isVeo && (VEO_MODELS[videoModelKey as VeoModelKey] as any)?.supportsLastFrame) ||
      (isFal && (FAL_VIDEO_MODELS[videoModelKey] as any)?.supportsLastFrame);
    if (shot.end_image_asset_id && modelSupportsLastFrame) {
      const endAsset = await selectOne('assets', { id: shot.end_image_asset_id });
      if (endAsset) endImagePath = endAsset.file_path;
    }

    if (isFal) {
      const result = await generateFalVideo(imageAsset.file_path, veoPrompt, videoModelKey, {
        aspectRatio: aspect,
        resolution,
        duration: String(shot.duration || 10),
      });
      videoPath = result.videoPath;
      const falModel = FAL_VIDEO_MODELS[videoModelKey];
      costEstimate = falModel.costPerSec * result.durationSec;
      modelId = falModel.id;
    } else if (isVeo) {
      const result = await generateVideo(imageAsset.file_path, veoPrompt, endImagePath, {
        aspectRatio: aspect,
        resolution,
        durationSec: shot.duration,
        modelKey: videoModelKey as VeoModelKey,
      });
      videoPath = result.videoPath;
      const veoModel = VEO_MODELS[videoModelKey as VeoModelKey];
      costEstimate = veoModel.costPerSec * result.durationSec;
      modelId = result.modelId;
    } else {
      // Unknown key — fall back to Veo Fast
      const result = await generateVideo(imageAsset.file_path, veoPrompt, endImagePath, {
        aspectRatio: aspect,
        resolution,
        durationSec: shot.duration,
        modelKey: 'veo-3.1-fast',
      });
      videoPath = result.videoPath;
      costEstimate = VEO_MODELS['veo-3.1-fast'].costPerSec * result.durationSec;
      modelId = result.modelId;
    }

    const durationMs = Date.now() - t0;

    const assetId = uuidv4();

    // Extract the actual last frame from the generated video so the next shot
    // can branch from where we truly ended up, not where we predicted we'd be.
    let extractedAssetId: string | null = null;
    let extractedFramePath: string | null = null;
    try {
      const framePath = await extractLastFrame(videoPath);
      extractedFramePath = framePath;
      extractedAssetId = uuidv4();
      await insertRow('assets', { id: extractedAssetId, project_id: project.id, shot_id: shot.id, category: 'shot_extracted_last_frame', file_path: framePath });
    } catch (err: any) {
      console.warn(`  [shot ${shot.id}] last-frame extraction failed: ${err.message}`);
    }

    // Pair the extracted-frame id into the video asset's metadata so revert
    // can restore both pointers atomically from a single history entry.
    const videoMetadata = JSON.stringify({ extracted_last_frame_asset_id: extractedAssetId });
    await insertRow('assets', { id: assetId, project_id: project.id, shot_id: shot.id, category: 'shot_video', file_path: videoPath, metadata: videoMetadata });

    await updateRows('shots', { id: shot.id }, {
      video_asset_id: assetId,
      video_status: 'success',
      extracted_last_frame_asset_id: extractedAssetId,
    });

    // Chain refresh — if the NEXT shot in this scene is tagged `prev_shot`,
    // show Claude the extracted last frame and rewrite that shot's prompts so
    // the hand-off is grounded in what actually happened on screen (not the
    // blind draft from write-shot-prompts). Cheap text call (~$0.01) — we can
    // fire it inline without blocking the response meaningfully.
    if (extractedFramePath) {
      try {
        const nextShot = await findShot(shot.scene_id, shot.sort_order + 1, { continuity_from: 'prev_shot', locked: 0 });
        if (nextShot && nextShot.visual_prompt) {
          const nextCastIds: string[] = JSON.parse(nextShot.cast_ids || '[]');
          const nextCast = cast.filter((c: any) => nextCastIds.includes(c.id));
          const nextEnv = nextShot.environment_id
            ? await selectOne('environments', { id: nextShot.environment_id })
            : null;
          const prevFrameBase64 = await readAsBase64(extractedFramePath);
          const prevFrameMime = mimeFromExt(extractedFramePath);
          const refreshed = await refreshChainedShotPrompt({
            prevFrameBase64,
            prevFrameMime,
            currentVisualPrompt: nextShot.visual_prompt || '',
            currentMotionPrompt: nextShot.motion_prompt || 'Cinematic camera movement',
            styleDNA: project.style_description || 'Cinematic',
            characterDescriptions: nextCast.map((c: any) => `${c.name}: ${c.description || ''}`),
            environmentName: nextEnv?.name,
            sceneNarrative: scene?.narrative_description || undefined,
            sceneLyrics: scene?.lyrics || undefined,
            mood: concept.mood || undefined,
            shotDuration: nextShot.duration,
          });
          // Clear any cached continuity description — the prompt itself now
          // encodes the continuity, so we don't want the old stale describe text
          // being re-added to the Veo prompt on the next gen.
          await updateRows('shots', { id: nextShot.id }, {
            visual_prompt: refreshed.visualPrompt,
            motion_prompt: refreshed.motionPrompt,
            refined_from_prev_frame: 1,
            continuity_description: null,
          });
          await logCall({
            projectId: project.id,
            stage: 'refresh-chained-shot',
            model: 'claude-sonnet-4-6',
            prompt: `Chain refresh for shot ${nextShot.id} using prev shot ${shot.id}'s last frame`,
            referenceInputs: [{ type: 'image', label: 'Prev extracted last frame', url: storageUrl(extractedFramePath) }],
            contextChain: await buildContextChain(project.id),
            responseSummary: `Refreshed: "${refreshed.visualPrompt.substring(0, 100)}…"`,
            durationMs: 0,
            costEstimate: 0.01,
          });
          console.log(`  [shot ${shot.id}] next shot ${nextShot.id} prompt refreshed from extracted frame`);
        }
      } catch (err: any) {
        console.warn(`  [shot ${shot.id}] chain refresh failed: ${err.message}`);
      }
    }

    await logCall({
      projectId: project.id,
      stage: 'generate-shot-video',
      model: modelId,
      prompt: veoPrompt,
      referenceInputs: [
        { type: 'image', label: 'Start keyframe', url: storageUrl(imageAsset.file_path) },
      ],
      contextChain: await buildContextChain(project.id),
      responseSummary: `Video generated via ${isFal ? 'fal.ai' : 'Veo'}: ${videoPath}${extractedAssetId ? ' (last frame extracted)' : ''}`,
      outputAssetIds: extractedAssetId ? [assetId, extractedAssetId] : [assetId],
      durationMs,
      costEstimate,
    });

    await incrementColumn('projects', { id: paramStr(req.params.id) }, 'cost_estimate', costEstimate);
    await updateRows('projects', { id: paramStr(req.params.id) }, { updated_at: new Date().toISOString() });

    res.json(await getFullProject(paramStr(req.params.id)));
  } catch (err: any) {
    console.error(`[shot ${shot.id}] Video gen failed:`, err);
    await logCall({
      projectId: project.id,
      stage: 'generate-shot-video',
      model: project.video_model || 'veo-3.1',
      prompt: shot.motion_prompt || 'Cinematic camera movement',
      referenceInputs: [{ type: 'image', label: 'Start keyframe', url: storageUrl(imageAsset.file_path) }],
      contextChain: await buildContextChain(project.id),
      durationMs: 0,
      error: err.message,
    });
    await updateRows('shots', { id: shot.id }, { video_status: 'error' });
    res.status(500).json({ error: err.message });
  }
});

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

export { router as generateRouter };
