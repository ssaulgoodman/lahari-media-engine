import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { readAsBase64, mimeFromExt, saveBase64, saveBuffer } from '../storage.js';
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
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
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
      db.prepare(`INSERT INTO assets (id, project_id, category, file_path, prompt) VALUES (?, ?, 'style', ?, ?)`)
        .run(assetId, project.id, s.assetPath, s.style);
      assetIds.push({ id: assetId, style: s.style, url: `/storage/${s.assetPath}` });
    }

    logCall({
      projectId: project.id,
      stage: 'generate-styles',
      model: 'imagen-4.0-generate-001',
      prompt,
      contextChain: buildContextChain(project.id),
      responseSummary: `Generated ${styles.length} style images: ${assetIds.map(a => a.style).join(', ')}`,
      outputAssetIds: assetIds.map(a => a.id),
      durationMs,
      costEstimate: 0.04,
    });

    res.json({ styles: assetIds, project: getFullProject(project.id) });
  } catch (err: any) {
    console.error(`[${project.id}] Style generation failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'generate-styles',
      model: 'imagen-4.0-generate-001',
      prompt,
      contextChain: buildContextChain(project.id),
      durationMs: 0,
      error: err.message,
    });
    res.status(500).json({ error: err.message });
  }
});

// ─── Brainstorm Style Directions (text only, no images) ─────────────

router.post('/:id/brainstorm-styles', async (req, res) => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const concept = JSON.parse(project.locked_concept || '{}');
  const structure = JSON.parse(project.musical_structure || '[]');
  const { userNotes } = req.body;

  try {
    console.log(`[${project.id}] Brainstorming style directions...`);
    const t0 = Date.now();
    // Build script summary for richer brainstorm context
    const scenes = db.prepare('SELECT section_label, narrative_description FROM scenes WHERE project_id = ? ORDER BY sort_order').all(project.id) as any[];
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

    logCall({
      projectId: project.id,
      stage: 'brainstorm-styles',
      model: 'claude-opus-4-6',
      prompt: `Brainstorm 4 style directions | Concept: ${concept.conceptDirection || concept.title} | Mood: ${concept.mood}${userNotes ? ` | User notes: ${userNotes}` : ''}`,
      contextChain: buildContextChain(project.id),
      responseSummary: JSON.stringify(directions),
      durationMs,
      costEstimate: 0.01,
    });

    res.json({ directions });
  } catch (err: any) {
    console.error(`[${project.id}] Brainstorm failed:`, err);
    logCall({
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
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
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
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path, prompt) VALUES (?, ?, 'style', ?, ?)`)
      .run(assetId, project.id, assetPath, stylePrompt);

    logCall({
      projectId: project.id,
      stage: 'visualize-style',
      model: 'gemini-3-pro-image-preview',
      prompt: stylePrompt,
      contextChain: buildContextChain(project.id),
      responseSummary: `Generated style image`,
      outputAssetIds: [assetId],
      durationMs,
      costEstimate: 0.01,
    });

    res.json({ assetId, url: `/storage/${assetPath}` });
  } catch (err: any) {
    console.error(`[${project.id}] Visualize style failed:`, err);
    logCall({
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
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const concept = JSON.parse(project.locked_concept || '{}');
  const { description, feedback } = req.body;

  try {
    const t0 = Date.now();
    const refined = await refineStyleDirection(description, feedback, concept);
    const durationMs = Date.now() - t0;

    logCall({
      projectId: project.id,
      stage: 'refine-style-direction',
      model: 'claude-sonnet-4-6',
      prompt: `Refine: "${description.substring(0, 100)}..." | Feedback: "${feedback}"`,
      contextChain: buildContextChain(project.id),
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
    const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(assetId);
    if (asset) {
      console.log(`[${projectId}] Enriching style DNA...`);
      const t0 = Date.now();
      const imageBase64 = readAsBase64(asset.file_path);
      const mimeType = mimeFromExt(asset.file_path);
      enrichedDescription = await enrichStyleDNA(imageBase64, mimeType, styleDescription || '');
      const durationMs = Date.now() - t0;

      logCall({
        projectId,
        stage: 'enrich-style-dna',
        model: 'claude-sonnet-4-6',
        prompt: `Enrich style DNA from locked image | Short desc: ${(styleDescription || '').substring(0, 100)}`,
        referenceInputs: [{ type: 'image', label: 'Locked style image', url: `/storage/${asset.file_path}` }],
        contextChain: buildContextChain(projectId),
        responseSummary: enrichedDescription.substring(0, 300),
        durationMs,
        costEstimate: 0.01,
      });
    }
  } catch (err) {
    console.error('[lock-style] Style DNA enrichment failed, using short description:', err);
  }

  db.prepare(`
    UPDATE projects SET
      status = 'style_locked',
      style_asset_id = ?,
      style_description = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(assetId, enrichedDescription, projectId);

  res.json(getFullProject(projectId));
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
router.post('/:id/unlock-script', (req, res) => {
  const projectId = paramStr(req.params.id);
  const project: any = db.prepare('SELECT status FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.status !== 'scripted') {
    return res.status(400).json({ error: `Cannot unlock script from status "${project.status}". Unlock later phases first.` });
  }
  db.prepare(`UPDATE projects SET status = 'concept_locked', updated_at = datetime('now') WHERE id = ?`).run(projectId);
  res.json(getFullProject(projectId));
});

router.post('/:id/unlock-style', (req, res) => {
  const projectId = paramStr(req.params.id);
  const project: any = db.prepare('SELECT status FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.status !== 'style_locked') {
    return res.status(400).json({ error: `Cannot unlock style from status "${project.status}". Unlock later phases first.` });
  }
  db.prepare(`UPDATE projects SET status = 'scripted', updated_at = datetime('now') WHERE id = ?`).run(projectId);
  res.json(getFullProject(projectId));
});

router.post('/:id/unlock-characters', (req, res) => {
  const projectId = paramStr(req.params.id);
  const project: any = db.prepare('SELECT status FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.status !== 'characters_locked') {
    return res.status(400).json({ error: `Cannot unlock characters from status "${project.status}". Unlock later phases first.` });
  }
  db.prepare(`UPDATE projects SET status = 'style_locked', updated_at = datetime('now') WHERE id = ?`).run(projectId);
  res.json(getFullProject(projectId));
});

router.post('/:id/unlock-environments', (req, res) => {
  const projectId = paramStr(req.params.id);
  const project: any = db.prepare('SELECT status FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.status !== 'environments_locked' && project.status !== 'in_production') {
    return res.status(400).json({ error: `Cannot unlock environments from status "${project.status}".` });
  }
  db.prepare(`UPDATE projects SET status = 'characters_locked', updated_at = datetime('now') WHERE id = ?`).run(projectId);
  res.json(getFullProject(projectId));
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
    const filePath = saveBuffer(req.file.buffer, 'images', ext);
    const assetId = uuidv4();
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path) VALUES (?, ?, 'style', ?)`)
      .run(assetId, projectId, filePath);

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

    db.prepare(
      `UPDATE projects SET status = 'style_locked', style_asset_id = ?, style_description = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(assetId, styleDesc, projectId);

    logCall({
      projectId,
      stage: 'upload-and-lock-style',
      model: 'claude-sonnet-4-6',
      prompt: 'User uploaded image directly as style — analyzed for description, locked as style ref.',
      referenceInputs: [{ type: 'image', label: 'User-uploaded style', url: `/storage/${filePath}` }],
      contextChain: buildContextChain(projectId),
      responseSummary: styleDesc.substring(0, 200),
      outputAssetIds: [assetId],
      durationMs,
      costEstimate: 0.01,
    });

    res.json(getFullProject(projectId));
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

    db.prepare("UPDATE projects SET style_description = ?, updated_at = datetime('now') WHERE id = ?")
      .run(styleDesc, projectId);

    logCall({
      projectId,
      stage: 'analyze-style-image',
      model: 'claude-sonnet-4-6',
      prompt,
      referenceInputs: [{ type: 'image', label: 'User-uploaded style reference' }],
      contextChain: buildContextChain(projectId),
      responseSummary: styleDesc.substring(0, 200),
      durationMs,
      costEstimate: 0.01,
    });

    res.json({ styleDescription: styleDesc, project: getFullProject(projectId) });
  } catch (err: any) {
    logCall({
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

  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const member: any = db.prepare('SELECT * FROM cast_members WHERE id = ?').get(castMemberId);
  if (!member) return res.status(404).json({ error: 'Cast member not found' });

  const styleDNA = project.style_description || 'Cinematic, photorealistic';

  // Resolve style image path for visual ref
  let styleImagePath: string | undefined;
  if (project.style_asset_id) {
    const styleAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(project.style_asset_id);
    if (styleAsset) styleImagePath = styleAsset.file_path;
  }

  // If the director uploaded a reference image for this batch, save it and
  // pass it to generateCharacterLooks as a visual guide.
  let userRefImagePath: string | undefined;
  let userRefAssetId: string | undefined;
  if (req.file) {
    const ext = req.file.mimetype.includes('png') ? 'png' : req.file.mimetype.includes('jpeg') ? 'jpg' : 'png';
    userRefImagePath = saveBuffer(req.file.buffer, 'images', ext);
    userRefAssetId = uuidv4();
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path) VALUES (?, ?, 'character_user_ref', ?)`)
      .run(userRefAssetId, project.id, userRefImagePath);
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
      db.prepare(`INSERT INTO assets (id, project_id, category, file_path, prompt) VALUES (?, ?, 'character', ?, ?)`)
        .run(assetId, project.id, imagePaths[i], `Look ${i + 1} for ${member.name}`);
      looks.push({ id: assetId, url: `/storage/${imagePaths[i]}` });
    }

    logCall({
      projectId: project.id,
      stage: 'generate-looks',
      model: 'gemini-3-pro-image-preview',
      prompt: xrayPrompt,
      referenceInputs: [
        ...(styleImagePath ? [{ type: 'image' as const, label: 'Style reference', url: `/storage/${styleImagePath}` }] : []),
        ...(userRefImagePath ? [{ type: 'image' as const, label: `${member.name} — user-supplied ref`, url: `/storage/${userRefImagePath}` }] : []),
      ],
      contextChain: buildContextChain(project.id),
      responseSummary: `Generated ${imagePaths.length} looks for ${member.name}${userRefImagePath ? ' (guided by user ref)' : ''}`,
      outputAssetIds: looks.map(l => l.id),
      durationMs,
      costEstimate: 0.04,
    });

    res.json({ looks, project: getFullProject(project.id) });
  } catch (err: any) {
    console.error(`[${project.id}] Look gen failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'generate-looks',
      model: 'gemini-3-pro-image-preview',
      prompt: xrayPrompt,
      contextChain: buildContextChain(project.id),
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
  const member: any = db.prepare('SELECT * FROM cast_members WHERE id = ? AND project_id = ?').get(castMemberId, projectId);
  if (!member) return res.status(404).json({ error: 'Cast member not found' });

  try {
    const ext = req.file.mimetype.includes('png') ? 'png' : req.file.mimetype.includes('jpeg') ? 'jpg' : 'png';
    const filePath = saveBuffer(req.file.buffer, 'images', ext);
    const assetId = uuidv4();
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path) VALUES (?, ?, 'character', ?)`)
      .run(assetId, projectId, filePath);
    db.prepare('UPDATE cast_members SET reference_asset_id = ? WHERE id = ?').run(assetId, castMemberId);

    logCall({
      projectId,
      stage: 'upload-character-reference',
      model: 'upload',
      prompt: `User uploaded reference for character "${member.name}"`,
      referenceInputs: [{ type: 'image', label: `${member.name} — uploaded`, url: `/storage/${filePath}` }],
      contextChain: buildContextChain(projectId),
      responseSummary: `Locked uploaded image as ${member.name}'s reference`,
      outputAssetIds: [assetId],
      durationMs: 0,
      costEstimate: 0,
    });

    res.json(getFullProject(projectId));
  } catch (err: any) {
    console.error(`[${projectId}] upload-character-reference failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/lock-character', (req, res) => {
  const { castMemberId, assetId } = req.body;
  if (!castMemberId || !assetId) return res.status(400).json({ error: 'castMemberId and assetId required' });

  db.prepare('UPDATE cast_members SET reference_asset_id = ? WHERE id = ?').run(assetId, castMemberId);

  // Don't auto-advance — user clicks "Proceed" when satisfied
  res.json(getFullProject(paramStr(req.params.id)));
});

// ─── Advance past Characters phase ─────────────────────────────────
// User decides when they're done — not all cast members need looks

// Idempotent: if already past characters_locked, no-op. If before, bump up.
// The UI lets users jump around tabs, so a strict status gate breaks the flow.
const PHASE_ORDER_SERVER = ['uploaded','analyzed','concept_locked','scripted','style_locked','characters_locked','environments_locked','in_production','completed'];
const atLeast = (cur: string, target: string) => PHASE_ORDER_SERVER.indexOf(cur) >= PHASE_ORDER_SERVER.indexOf(target);

router.post('/:id/advance-characters', (req, res) => {
  const project: any = db.prepare('SELECT id, status FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!atLeast(project.status, 'characters_locked')) {
    db.prepare("UPDATE projects SET status = 'characters_locked', updated_at = datetime('now') WHERE id = ?").run(paramStr(req.params.id));
  }
  res.json(getFullProject(paramStr(req.params.id)));
});

// ─── Generate Environment Looks ──────────────────────────────────────

router.post('/:id/generate-environment-look', upload.single('image'), async (req, res) => {
  const { environmentId, note } = req.body;
  if (!environmentId) return res.status(400).json({ error: 'environmentId required' });

  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const env: any = db.prepare('SELECT * FROM environments WHERE id = ?').get(environmentId);
  if (!env) return res.status(404).json({ error: 'Environment not found' });

  const styleDNA = project.style_description || 'Cinematic, photorealistic';

  let styleImagePath: string | undefined;
  if (project.style_asset_id) {
    const styleAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(project.style_asset_id);
    if (styleAsset) styleImagePath = styleAsset.file_path;
  }

  // Optional director-supplied environment reference.
  let userRefImagePath: string | undefined;
  if (req.file) {
    const ext = req.file.mimetype.includes('png') ? 'png' : req.file.mimetype.includes('jpeg') ? 'jpg' : 'png';
    userRefImagePath = saveBuffer(req.file.buffer, 'images', ext);
    const refAssetId = uuidv4();
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path) VALUES (?, ?, 'environment_user_ref', ?)`)
      .run(refAssetId, project.id, userRefImagePath);
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
      db.prepare(`INSERT INTO assets (id, project_id, category, file_path, prompt) VALUES (?, ?, 'environment', ?, ?)`)
        .run(assetId, project.id, imagePaths[i], `Environment look ${i + 1} for ${env.name}`);
      looks.push({ id: assetId, url: `/storage/${imagePaths[i]}` });
    }

    logCall({
      projectId: project.id,
      stage: 'generate-environment-look',
      model: 'gemini-3-pro-image-preview',
      prompt: `Generate 3 environment looks for "${env.name}" — ${(env.description || '').substring(0, 100)}`,
      referenceInputs: [
        ...(styleImagePath ? [{ type: 'image' as const, label: 'Style reference', url: `/storage/${styleImagePath}` }] : []),
        ...(userRefImagePath ? [{ type: 'image' as const, label: `${env.name} — user-supplied ref`, url: `/storage/${userRefImagePath}` }] : []),
      ],
      contextChain: buildContextChain(project.id),
      responseSummary: `Generated ${imagePaths.length} looks for environment ${env.name}${userRefImagePath ? ' (guided by user ref)' : ''}`,
      outputAssetIds: looks.map(l => l.id),
      durationMs,
      costEstimate: 0.04,
    });

    res.json({ looks, project: getFullProject(project.id) });
  } catch (err: any) {
    console.error(`[${project.id}] Environment look gen failed:`, err);
    logCall({
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
  const env: any = db.prepare('SELECT * FROM environments WHERE id = ? AND project_id = ?').get(environmentId, projectId);
  if (!env) return res.status(404).json({ error: 'Environment not found' });

  try {
    const ext = req.file.mimetype.includes('png') ? 'png' : req.file.mimetype.includes('jpeg') ? 'jpg' : 'png';
    const filePath = saveBuffer(req.file.buffer, 'images', ext);
    const assetId = uuidv4();
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path) VALUES (?, ?, 'environment', ?)`)
      .run(assetId, projectId, filePath);
    db.prepare('UPDATE environments SET reference_asset_id = ? WHERE id = ?').run(assetId, environmentId);

    logCall({
      projectId,
      stage: 'upload-environment-reference',
      model: 'upload',
      prompt: `User uploaded reference for environment "${env.name}"`,
      referenceInputs: [{ type: 'image', label: `${env.name} — uploaded`, url: `/storage/${filePath}` }],
      contextChain: buildContextChain(projectId),
      responseSummary: `Locked uploaded image as ${env.name}'s reference`,
      outputAssetIds: [assetId],
      durationMs: 0,
      costEstimate: 0,
    });

    res.json(getFullProject(projectId));
  } catch (err: any) {
    console.error(`[${projectId}] upload-environment-reference failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/lock-environment', (req, res) => {
  const { environmentId, assetId } = req.body;
  if (!environmentId || !assetId) return res.status(400).json({ error: 'environmentId and assetId required' });

  db.prepare('UPDATE environments SET reference_asset_id = ? WHERE id = ?').run(assetId, environmentId);

  // Don't auto-advance — user clicks "Proceed" when satisfied
  res.json(getFullProject(paramStr(req.params.id)));
});

// ─── Advance past Environments phase ────────────────────────────────
// User decides when they're done — not all environments need looks

router.post('/:id/advance-environments', (req, res) => {
  const project: any = db.prepare('SELECT id, status FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  // Also bump through characters_locked if skipped — the user is clearly done with earlier phases.
  if (!atLeast(project.status, 'environments_locked')) {
    db.prepare("UPDATE projects SET status = 'environments_locked', updated_at = datetime('now') WHERE id = ?").run(paramStr(req.params.id));
  }
  res.json(getFullProject(paramStr(req.params.id)));
});

// ─── Generate Script ────────────────────────────────────────────────

router.post('/:id/generate-script', async (req, res) => {
  // Destructive on re-run: wipes cast + deletes existing scenes. Pass
  // { fork: true } to fork first and run on the new project.
  const sourceId = paramStr(req.params.id);
  const projectId = req.body?.fork === true ? forkProject(sourceId) : sourceId;
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
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
    db.prepare('UPDATE projects SET last_script_prompt = ? WHERE id = ?').run(data.prompt, project.id);

    // ── Create proposed cast members ──
    // Clear old cast (script proposes fresh cast each time)
    db.prepare('DELETE FROM cast_members WHERE project_id = ?').run(project.id);

    const nameToId: Record<string, string> = {};
    const proposedCast = data.cast || [];
    proposedCast.forEach((c: any, idx: number) => {
      const memberId = uuidv4();
      nameToId[c.name] = memberId;
      db.prepare(`INSERT INTO cast_members (id, project_id, name, description, sort_order) VALUES (?, ?, ?, ?, ?)`)
        .run(memberId, project.id, c.name || `Character ${idx + 1}`, c.description || 'To be defined', idx);
    });

    // ── Create proposed environments ──
    db.prepare('DELETE FROM environments WHERE project_id = ?').run(project.id);

    const envNameToId: Record<string, string> = {};
    const proposedEnvironments = data.environments || [];
    proposedEnvironments.forEach((e: any, idx: number) => {
      const envId = uuidv4();
      envNameToId[e.name] = envId;
      db.prepare(`INSERT INTO environments (id, project_id, name, description, sort_order) VALUES (?, ?, ?, ?, ?)`)
        .run(envId, project.id, e.name || `Environment ${idx + 1}`, e.description || '', idx);
    });

    // ── Clear old scenes/shots ──
    const oldScenes = db.prepare('SELECT id FROM scenes WHERE project_id = ?').all(project.id) as any[];
    for (const s of oldScenes) {
      db.prepare('DELETE FROM shots WHERE scene_id = ?').run(s.id);
    }
    db.prepare('DELETE FROM scenes WHERE project_id = ?').run(project.id);

    // ── Insert new scenes and shots ──
    const insertScene = db.prepare(`
      INSERT INTO scenes (id, project_id, section_label, start_time, end_time, lyrics, narrative_description, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertShot = db.prepare(`
      INSERT INTO shots (id, scene_id, visual_prompt, motion_prompt, duration, cast_ids, use_next_as_end_frame, sort_order, environment_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let totalShots = 0;
    (data.scenes || []).forEach((scene: any, sIdx: number) => {
      const sceneId = scene.id || uuidv4();
      insertScene.run(
        sceneId, project.id,
        scene.sectionLabel || `Scene ${sIdx + 1}`,
        scene.startTime || '0:00',
        scene.endTime || '0:00',
        scene.lyrics || '',
        scene.narrativeDescription || '',
        sIdx
      );

      (scene.shots || []).forEach((shot: any, shIdx: number) => {
        const shotId = uuidv4();
        // Map castNames → castIds using the name→id lookup
        const castNames: string[] = shot.castNames || [];
        const castIds = castNames.map((name: string) => nameToId[name] || name).filter(Boolean);
        // Map environmentName → environmentId
        const envId = shot.environmentName ? (envNameToId[shot.environmentName] || null) : null;

        // Store direction as visual_prompt placeholder — writeShotPrompts will overwrite later
        insertShot.run(
          shotId, sceneId,
          shot.direction || '',
          '',  // motion_prompt left empty — writeShotPrompts fills it
          shot.duration || (project.target_duration || 8),
          JSON.stringify(castIds),
          project.video_mode === 'cinematic' ? 1 : 0,
          shIdx,
          envId
        );
        totalShots++;
      });
    });

    logCall({
      projectId: project.id,
      stage: 'generate-script',
      model: 'claude-opus-4-6',
      prompt: scriptPrompt,
      referenceInputs: [],
      contextChain: buildContextChain(project.id),
      responseSummary: `Proposed ${proposedCast.length} cast members, ${proposedEnvironments.length} environments. Generated ${(data.scenes || []).length} scenes with ${totalShots} total shots.`,
      durationMs,
      costEstimate: 0.02,
    });

    db.prepare("UPDATE projects SET status = 'scripted', cost_estimate = cost_estimate + 0.02, updated_at = datetime('now') WHERE id = ?")
      .run(project.id);

    res.json(getFullProject(project.id));
  } catch (err: any) {
    console.error(`[${project.id}] Script gen failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'generate-script',
      model: 'claude-opus-4-6',
      prompt: scriptPrompt,
      referenceInputs: [],
      contextChain: buildContextChain(project.id),
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
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.style_description) return res.status(400).json({ error: 'Style not locked yet' });
  const userNote: string | undefined = req.body?.userNote;

  const concept = JSON.parse(project.locked_concept || '{}');
  const cast = db.prepare('SELECT * FROM cast_members WHERE project_id = ? ORDER BY sort_order').all(project.id) as any[];
  const scenes = db.prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY sort_order').all(project.id) as any[];

  try {
    console.log(`[${project.id}] Writing shot prompts with full context...`);
    const t0 = Date.now();

    // Gather all shots with their scene context
    const allShots: { id: string; direction: string; duration: number; castNames: string[]; sceneNarrative: string; sceneLyrics: string }[] = [];
    for (const scene of scenes as any[]) {
      const shots = db.prepare('SELECT * FROM shots WHERE scene_id = ? ORDER BY sort_order').all(scene.id) as any[];
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
      const firstShotIdsPerScene = new Set(
        scenes
          .map((scene: any) => db.prepare('SELECT id FROM shots WHERE scene_id = ? ORDER BY sort_order LIMIT 1').get(scene.id) as any)
          .filter(Boolean)
          .map((row: any) => row.id)
      );
      const updateShot = db.prepare('UPDATE shots SET visual_prompt = ?, motion_prompt = ?, continuity_from = ? WHERE id = ?');
      for (const p of prompts) {
        const continuity = firstShotIdsPerScene.has(p.id) ? 'cut' : (p.continuityFrom || 'cut');
        updateShot.run(p.visualPrompt || '', p.motionPrompt || '', continuity, p.id);
      }

      // Keep last 2 shots as continuity context for next batch
      if (prompts.length >= 2) {
        previousBatchTail = prompts.slice(-2);
      } else if (prompts.length === 1) {
        previousBatchTail = prompts;
      }
    }

    db.prepare('UPDATE projects SET last_write_shots_prompt = ? WHERE id = ?')
      .run(batchPrompts.join('\n\n'), project.id);

    const durationMs = Date.now() - t0;
    console.log(`[${project.id}] Shot prompts written for ${allShots.length} shots in ${durationMs}ms`);

    logCall({
      projectId: project.id,
      stage: 'write-shot-prompts',
      model: 'claude-opus-4-6',
      prompt: `Write visualPrompt + motionPrompt for ${allShots.length} shots with full style/character context`,
      contextChain: buildContextChain(project.id),
      responseSummary: `Wrote prompts for ${allShots.length} shots`,
      durationMs,
      costEstimate: 0.02,
    });

    db.prepare("UPDATE projects SET cost_estimate = cost_estimate + 0.02, updated_at = datetime('now') WHERE id = ?")
      .run(project.id);

    res.json(getFullProject(project.id));
  } catch (err: any) {
    console.error(`[${project.id}] Write shot prompts failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Refine Shot Prompt (vision + rewrite) ─────────────────────────

router.post('/:id/shots/:shotId/refine-prompt', async (req, res) => {
  const { feedback } = req.body;
  if (!feedback?.trim()) return res.status(400).json({ error: 'Feedback required' });

  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const shot: any = db.prepare('SELECT * FROM shots WHERE id = ?').get(paramStr(req.params.shotId));
  if (!shot) return res.status(404).json({ error: 'Shot not found' });
  if (!shot.image_asset_id) return res.status(400).json({ error: 'No image to refine — generate one first' });

  const imageAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(shot.image_asset_id);
  if (!imageAsset) return res.status(400).json({ error: 'Image asset not found' });

  const shotCastIds = JSON.parse(shot.cast_ids || '[]');
  const cast = db.prepare('SELECT * FROM cast_members WHERE project_id = ?').all(paramStr(req.params.id)) as any[];
  const charDescs = cast
    .filter((c: any) => shotCastIds.includes(c.id))
    .map((c: any) => `${c.name}: ${c.description || 'no description'}`);

  try {
    const t0 = Date.now();
    const imageBase64 = readAsBase64(imageAsset.file_path);
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
    db.prepare('UPDATE shots SET visual_prompt = ?, motion_prompt = ?, user_feedback = ?, refined_from_prev_frame = 0 WHERE id = ?')
      .run(result.visualPrompt, result.motionPrompt, feedback, shot.id);

    const durationMs = Date.now() - t0;
    logCall({
      projectId: project.id,
      stage: 'refine-shot-prompt',
      model: 'claude-sonnet-4-6',
      prompt: `Refine: "${feedback}" | Original: "${(shot.visual_prompt || '').substring(0, 80)}…"`,
      referenceInputs: [{ type: 'image', label: 'Failed attempt', url: `/storage/${imageAsset.file_path}` }],
      contextChain: buildContextChain(project.id),
      responseSummary: `Rewritten: "${result.visualPrompt.substring(0, 100)}…"`,
      durationMs,
      costEstimate: 0.01,
    });

    res.json(getFullProject(paramStr(req.params.id)));
  } catch (err: any) {
    console.error(`[shot ${shot.id}] Prompt refinement failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate Shot Start Frame (with full reference chain) ───────────

router.post('/:id/shots/:shotId/generate-image', async (req, res) => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const shot: any = db.prepare('SELECT * FROM shots WHERE id = ?').get(paramStr(req.params.shotId));
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  const scene: any = db.prepare('SELECT * FROM scenes WHERE id = ?').get(shot.scene_id);

  // Sequential enforcement only for continuity-linked shots.
  // Hard-cut shots are independent and can generate in parallel.
  if (shot.continuity_from === 'prev_shot' && shot.sort_order > 0) {
    const prevShot: any = db.prepare(
      'SELECT id, video_asset_id FROM shots WHERE scene_id = ? AND sort_order = ?'
    ).get(shot.scene_id, shot.sort_order - 1);
    if (prevShot && !prevShot.video_asset_id) {
      return res.status(400).json({ error: 'Previous shot must have a generated video first (continuity dependency)' });
    }
  }

  const shotCastIds = JSON.parse(shot.cast_ids || '[]');
  const cast = db.prepare('SELECT * FROM cast_members WHERE project_id = ?').all(paramStr(req.params.id)) as any[];
  const activeCast = cast.filter((c: any) => shotCastIds.includes(c.id));

  const shotPrompt = shot.visual_prompt || '';
  const userFeedback = shot.user_feedback || undefined;

  // Resolve style image path
  let styleImagePath: string | undefined;
  if (project.style_asset_id) {
    const styleAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(project.style_asset_id);
    if (styleAsset) styleImagePath = styleAsset.file_path;
  }

  // Resolve character reference images
  const characterRefs: { name: string; imagePath: string }[] = [];
  for (const c of activeCast) {
    if (c.reference_asset_id) {
      const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(c.reference_asset_id);
      if (asset) characterRefs.push({ name: c.name, imagePath: asset.file_path });
    }
  }

  // Resolve environment reference
  let environmentRef: { name: string; imagePath: string } | undefined;
  if (shot.environment_id) {
    const env: any = db.prepare('SELECT * FROM environments WHERE id = ?').get(shot.environment_id);
    if (env?.reference_asset_id) {
      const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(env.reference_asset_id);
      if (asset) environmentRef = { name: env.name, imagePath: asset.file_path };
    }
  }

  // Continuity lookup — only runs when Claude tagged this shot as continuing
  // from the previous one. Hard-cut shots skip this entirely so they can
  // generate in parallel without waiting for the previous shot's video.
  let prevShotEndFramePath: string | undefined;
  let continuityDescription: string | undefined = shot.continuity_description || undefined;
  if (shot.continuity_from === 'prev_shot' && shot.sort_order > 0) {
    const prevShot: any = db.prepare(
      'SELECT extracted_last_frame_asset_id, end_image_asset_id FROM shots WHERE scene_id = ? AND sort_order = ? AND locked = 1'
    ).get(shot.scene_id, shot.sort_order - 1);
    const continuityAssetId = prevShot?.extracted_last_frame_asset_id || prevShot?.end_image_asset_id;
    if (continuityAssetId) {
      const asset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(continuityAssetId);
      if (asset) prevShotEndFramePath = asset.file_path;
    }

    // Vision-describe the extracted continuity frame once, cache on the shot.
    if (prevShotEndFramePath && !continuityDescription) {
      try {
        const base64 = readAsBase64(prevShotEndFramePath);
        const mime = mimeFromExt(prevShotEndFramePath);
        continuityDescription = await describeFrame(base64, mime);
        db.prepare('UPDATE shots SET continuity_description = ? WHERE id = ?').run(continuityDescription, shot.id);
        console.log(`[shot ${shot.id}] Continuity described: ${continuityDescription.substring(0, 100)}...`);
      } catch (err: any) {
        console.warn(`[shot ${shot.id}] Continuity description failed: ${err.message}`);
      }
    }
  }

  try {
    db.prepare("UPDATE shots SET image_status = 'loading' WHERE id = ?").run(shot.id);
    const t0 = Date.now();

    console.log(`[shot ${shot.id}] Generating start frame with ${characterRefs.length} char refs, env: ${environmentRef?.name || 'none'}, prev end frame: ${prevShotEndFramePath ? 'yes' : 'no'}`);

    // If regenerating with feedback, pass the failed image so the model can
    // see what went wrong and avoid the same issues.
    let failedImagePath: string | undefined;
    if (userFeedback && shot.image_asset_id) {
      const failedAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(shot.image_asset_id);
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
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path, prompt) VALUES (?, ?, 'shot_image', ?, ?)`)
      .run(assetId, project.id, imagePath, shotPrompt);

    db.prepare(`
      UPDATE shots SET
        image_asset_id = ?,
        image_status = 'success',
        attempt_count = COALESCE(attempt_count, 0) + 1,
        user_feedback = NULL
      WHERE id = ?
    `).run(assetId, shot.id);

    logCall({
      projectId: project.id,
      stage: 'generate-shot-start-frame',
      model: 'gemini-3-pro-image-preview',
      prompt: shotPrompt,
      referenceInputs: [
        ...(styleImagePath ? [{ type: 'image' as const, label: 'Style ref', url: `/storage/${styleImagePath}` }] : []),
        ...characterRefs.map(r => ({ type: 'image' as const, label: `${r.name} ref`, url: `/storage/${r.imagePath}` })),
        ...(environmentRef ? [{ type: 'image' as const, label: `Env: ${environmentRef.name}`, url: `/storage/${environmentRef.imagePath}` }] : []),
        ...(prevShotEndFramePath ? [{ type: 'image' as const, label: 'Prev end frame', url: `/storage/${prevShotEndFramePath}` }] : []),
      ],
      contextChain: buildContextChain(project.id),
      responseSummary: `Generated start frame for shot`,
      outputAssetIds: [assetId],
      durationMs,
      costEstimate: 0.04,
    });

    db.prepare("UPDATE projects SET cost_estimate = cost_estimate + 0.04, updated_at = datetime('now') WHERE id = ?")
      .run(paramStr(req.params.id));

    res.json(getFullProject(paramStr(req.params.id)));
  } catch (err: any) {
    console.error(`[shot ${shot.id}] Start frame gen failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'generate-shot-start-frame',
      model: 'gemini-3-pro-image-preview',
      prompt: shotPrompt,
      durationMs: 0,
      error: err.message,
    });
    db.prepare("UPDATE shots SET image_status = 'error' WHERE id = ?").run(shot.id);
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

  const shot: any = db.prepare('SELECT * FROM shots WHERE id = ?').get(shotId);
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  const prevShot: any = db.prepare(
    'SELECT * FROM shots WHERE scene_id = ? AND sort_order < ? ORDER BY sort_order DESC LIMIT 1'
  ).get(shot.scene_id, shot.sort_order);
  if (!prevShot) return res.status(400).json({ error: 'No previous shot in this scene' });
  if (!prevShot.extracted_last_frame_asset_id) {
    return res.status(400).json({ error: 'Previous shot has no extracted last frame yet — generate its video first' });
  }

  const sourceAsset: any = db.prepare('SELECT * FROM assets WHERE id = ?').get(prevShot.extracted_last_frame_asset_id);
  if (!sourceAsset) return res.status(400).json({ error: 'Source frame asset missing' });

  // Create a new asset row (category shot_image) pointing at the same file.
  // Sharing file_path avoids duplication on disk; the separate row keeps
  // provenance/ai_calls traceability clean.
  const newAssetId = uuidv4();
  db.prepare(`INSERT INTO assets (id, project_id, category, file_path) VALUES (?, ?, 'shot_image', ?)`)
    .run(newAssetId, projectId, sourceAsset.file_path);

  db.prepare(
    `UPDATE shots SET image_asset_id = ?, image_status = 'success', continuity_from = 'prev_shot' WHERE id = ?`
  ).run(newAssetId, shotId);

  logCall({
    projectId,
    stage: 'copy-prev-last-frame',
    model: 'copy',
    prompt: `Copied prev shot (${prevShot.id}) extracted last frame as start frame for shot ${shotId}`,
    referenceInputs: [{ type: 'image', label: 'Prev shot last frame', url: `/storage/${sourceAsset.file_path}` }],
    outputAssetIds: [newAssetId],
    durationMs: 0,
    costEstimate: 0,
  });

  res.json(getFullProject(projectId));
});

// ─── Lock Shot ───────────────────────────────────────────────────────

router.post('/:id/shots/:shotId/lock', (req, res) => {
  const shot: any = db.prepare('SELECT * FROM shots WHERE id = ?').get(paramStr(req.params.shotId));
  if (!shot) return res.status(404).json({ error: 'Shot not found' });
  if (!shot.image_asset_id) return res.status(400).json({ error: 'Start frame required to lock' });
  if (!shot.video_asset_id) return res.status(400).json({ error: 'Video must be generated before locking' });

  db.prepare('UPDATE shots SET locked = 1 WHERE id = ?').run(shot.id);
  res.json(getFullProject(paramStr(req.params.id)));
});

router.post('/:id/shots/:shotId/unlock', (req, res) => {
  const shot: any = db.prepare('SELECT * FROM shots WHERE id = ?').get(paramStr(req.params.shotId));
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  db.prepare('UPDATE shots SET locked = 0 WHERE id = ?').run(shot.id);
  res.json(getFullProject(paramStr(req.params.id)));
});

// ─── Generate Shot Video ────────────────────────────────────────────

router.post('/:id/shots/:shotId/generate-video', async (req, res) => {
  const { promptOverride } = req.body || {};

  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const shot: any = db.prepare('SELECT * FROM shots WHERE id = ?').get(paramStr(req.params.shotId));
  if (!shot || !shot.image_asset_id) return res.status(400).json({ error: 'Shot has no image yet' });

  const imageAsset: any = db.prepare('SELECT file_path FROM assets WHERE id = ?').get(shot.image_asset_id);
  if (!imageAsset) return res.status(400).json({ error: 'Image asset not found' });

  const scene: any = db.prepare('SELECT * FROM scenes WHERE id = ?').get(shot.scene_id);
  const concept = JSON.parse(project.locked_concept || '{}');
  const shotCastIds = JSON.parse(shot.cast_ids || '[]');
  const cast = db.prepare('SELECT * FROM cast_members WHERE project_id = ?').all(paramStr(req.params.id)) as any[];
  const activeCast = cast.filter((c: any) => shotCastIds.includes(c.id));

  try {
    db.prepare("UPDATE shots SET video_status = 'loading' WHERE id = ?").run(shot.id);
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
      const result = await generateVideo(imageAsset.file_path, veoPrompt, undefined, {
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
      const result = await generateVideo(imageAsset.file_path, veoPrompt, undefined, {
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
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path) VALUES (?, ?, 'shot_video', ?)`)
      .run(assetId, project.id, videoPath);

    // Extract the actual last frame from the generated video so the next shot
    // can branch from where we truly ended up, not where we predicted we'd be.
    let extractedAssetId: string | null = null;
    let extractedFramePath: string | null = null;
    try {
      const framePath = await extractLastFrame(videoPath);
      extractedFramePath = framePath;
      extractedAssetId = uuidv4();
      db.prepare(`INSERT INTO assets (id, project_id, category, file_path) VALUES (?, ?, 'shot_extracted_last_frame', ?)`)
        .run(extractedAssetId, project.id, framePath);
    } catch (err: any) {
      console.warn(`  [shot ${shot.id}] last-frame extraction failed: ${err.message}`);
    }

    db.prepare(`UPDATE shots SET video_asset_id = ?, video_status = 'success', extracted_last_frame_asset_id = ? WHERE id = ?`)
      .run(assetId, extractedAssetId, shot.id);

    // Chain refresh — if the NEXT shot in this scene is tagged `prev_shot`,
    // show Claude the extracted last frame and rewrite that shot's prompts so
    // the hand-off is grounded in what actually happened on screen (not the
    // blind draft from write-shot-prompts). Cheap text call (~$0.01) — we can
    // fire it inline without blocking the response meaningfully.
    if (extractedFramePath) {
      try {
        const nextShot: any = db.prepare(
          "SELECT * FROM shots WHERE scene_id = ? AND sort_order = ? AND continuity_from = 'prev_shot' AND locked = 0"
        ).get(shot.scene_id, shot.sort_order + 1);
        if (nextShot && nextShot.visual_prompt) {
          const nextCastIds: string[] = JSON.parse(nextShot.cast_ids || '[]');
          const nextCast = cast.filter((c: any) => nextCastIds.includes(c.id));
          const nextEnv: any = nextShot.environment_id
            ? db.prepare('SELECT name FROM environments WHERE id = ?').get(nextShot.environment_id)
            : null;
          const prevFrameBase64 = readAsBase64(extractedFramePath);
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
          db.prepare(`UPDATE shots SET visual_prompt = ?, motion_prompt = ?, refined_from_prev_frame = 1, continuity_description = NULL WHERE id = ?`)
            .run(refreshed.visualPrompt, refreshed.motionPrompt, nextShot.id);
          logCall({
            projectId: project.id,
            stage: 'refresh-chained-shot',
            model: 'claude-sonnet-4-6',
            prompt: `Chain refresh for shot ${nextShot.id} using prev shot ${shot.id}'s last frame`,
            referenceInputs: [{ type: 'image', label: 'Prev extracted last frame', url: `/storage/${extractedFramePath}` }],
            contextChain: buildContextChain(project.id),
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

    logCall({
      projectId: project.id,
      stage: 'generate-shot-video',
      model: modelId,
      prompt: veoPrompt,
      referenceInputs: [
        { type: 'image', label: 'Start keyframe', url: `/storage/${imageAsset.file_path}` },
      ],
      contextChain: buildContextChain(project.id),
      responseSummary: `Video generated via ${isFal ? 'fal.ai' : 'Veo'}: ${videoPath}${extractedAssetId ? ' (last frame extracted)' : ''}`,
      outputAssetIds: extractedAssetId ? [assetId, extractedAssetId] : [assetId],
      durationMs,
      costEstimate,
    });

    db.prepare("UPDATE projects SET cost_estimate = cost_estimate + ?, updated_at = datetime('now') WHERE id = ?")
      .run(costEstimate, paramStr(req.params.id));

    res.json(getFullProject(paramStr(req.params.id)));
  } catch (err: any) {
    console.error(`[shot ${shot.id}] Video gen failed:`, err);
    logCall({
      projectId: project.id,
      stage: 'generate-shot-video',
      model: project.video_model || 'veo-3.1',
      prompt: shot.motion_prompt || 'Cinematic camera movement',
      referenceInputs: [{ type: 'image', label: 'Start keyframe', url: `/storage/${imageAsset.file_path}` }],
      contextChain: buildContextChain(project.id),
      durationMs: 0,
      error: err.message,
    });
    db.prepare("UPDATE shots SET video_status = 'error' WHERE id = ?").run(shot.id);
    res.status(500).json({ error: err.message });
  }
});

// ─── Chat ───────────────────────────────────────────────────────────

router.post('/:id/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(paramStr(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Save user message
  db.prepare('INSERT INTO chat_messages (project_id, role, text) VALUES (?, ?, ?)').run(paramStr(req.params.id), 'user', message);

  const history = db.prepare('SELECT role, text FROM chat_messages WHERE project_id = ? ORDER BY id').all(paramStr(req.params.id)) as any[];
  const concept = JSON.parse(project.locked_concept || project.concept_options || '{}');

  const chatContext = `Project: ${project.title}, Concept: ${JSON.stringify(concept).substring(0, 500)}`;

  try {
    const t0 = Date.now();
    const response = await chatWithDirector(chatContext, message, history);
    const durationMs = Date.now() - t0;

    db.prepare('INSERT INTO chat_messages (project_id, role, text) VALUES (?, ?, ?)').run(paramStr(req.params.id), 'model', response);

    logCall({
      projectId: paramStr(req.params.id),
      stage: 'chat',
      model: 'gemini-3-pro-preview',
      prompt: `[User]: ${message}\n[System context]: ${chatContext}`,
      contextChain: buildContextChain(paramStr(req.params.id)),
      responseSummary: response.substring(0, 300),
      durationMs,
      costEstimate: 0.005,
    });

    res.json({ text: response, project: getFullProject(paramStr(req.params.id)) });
  } catch (err: any) {
    logCall({
      projectId: paramStr(req.params.id),
      stage: 'chat',
      model: 'gemini-3-pro-preview',
      prompt: `[User]: ${message}`,
      durationMs: 0,
      error: err.message,
    });
    const errMsg = 'Error connecting to AI.';
    db.prepare('INSERT INTO chat_messages (project_id, role, text) VALUES (?, ?, ?)').run(paramStr(req.params.id), 'model', errMsg);
    res.json({ text: errMsg });
  }
});

export { router as generateRouter };
