/**
 * Character + environment look generation routes — extracted from generate.ts.
 * Handles: generate-looks, upload-character-reference, lock-character,
 * advance-characters, generate-environment-look, upload-environment-reference,
 * lock-environment, advance-environments.
 */
import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { selectOne, selectAll, insertRow, updateRows } from '../database.js';
import { saveBuffer, readAsBase64, mimeFromExt, storageUrl } from '../storage.js';
import { generateCharacterLooks, buildCharacterPrompt, generateEnvironmentLooks, buildEnvironmentPrompt } from '../services/imagen.js';
import { refineShotPrompt } from '../services/claude.js';
import { getFullProject } from './projects.js';
import { logCall, buildContextChain } from '../xray.js';
import { paramStr, requireCastMember, requireEnvironment, requireAsset, atLeast } from './scope-helpers.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const mountLooksRoutes = (router: Router) => {

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

  const member = await requireCastMember(project.id, castMemberId);

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

  // Build or reuse the generation prompt. First gen auto-builds from template;
  // subsequent gens use the saved (possibly artist-edited) prompt.
  let genPrompt = member.generation_prompt as string | null;
  if (!genPrompt) {
    const styleIdx = styleImagePath ? 1 : undefined;
    const userRefIdx = userRefImagePath ? (styleImagePath ? 2 : 1) : undefined;
    genPrompt = buildCharacterPrompt(
      { name: member.name, description: member.description || '' },
      styleDNA,
      { styleIdx, userRefIdx }
    );
  }

  // If feedback provided and we have a generation prompt, ask Claude to rewrite
  // the prompt (not just append). This is the "refine" path.
  if (feedback && genPrompt) {
    try {
      // If current reference exists, show it to Claude as context
      let refBase64 = '';
      let refMime = 'image/png';
      if (member.reference_asset_id) {
        const refAsset = await selectOne('assets', { id: member.reference_asset_id });
        if (refAsset) {
          refBase64 = await readAsBase64(refAsset.file_path);
          refMime = mimeFromExt(refAsset.file_path);
        }
      }

      const rewritten = await refineShotPrompt({
        currentVisualPrompt: genPrompt,
        currentMotionPrompt: '',
        feedback: `[CHARACTER LOOK REFINEMENT for ${member.name}] ${feedback}`,
        failedImageBase64: refBase64,
        failedImageMime: refMime,
        styleDNA: styleDNA,
        characterDescriptions: [`${member.name}: ${member.description || ''}`],
      });
      genPrompt = rewritten.visualPrompt;
      console.log(`[${project.id}] Claude rewrote generation prompt for ${member.name}: ${genPrompt.substring(0, 100)}...`);
    } catch (err: any) {
      console.warn(`[${project.id}] Prompt rewrite failed, using feedback as director note: ${err.message}`);
      genPrompt += `\n\nDirector note: ${feedback}`;
    }
  }

  // Save the (possibly rewritten) prompt
  await updateRows('cast_members', { id: castMemberId }, { generation_prompt: genPrompt, prompts_stale: false });

  const xrayPrompt = `Generate 3 looks for "${member.name}" | Prompt: ${genPrompt.substring(0, 150)}...`;

  try {
    console.log(`[${project.id}] Generating looks for ${member.name} via gemini-3-pro-image-preview${userRefImagePath ? ' (with user ref)' : ''}...`);
    const t0 = Date.now();

    const imagePaths = await generateCharacterLooks(
      { name: member.name, description: member.description || '' },
      styleDNA,
      styleImagePath,
      undefined, // feedback already baked into genPrompt by Claude
      project.aspect_ratio || '16:9',
      userRefImagePath,
      genPrompt,
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
    res.status((err as any).statusCode || 500).json({ error: err.message });
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
    res.status((err as any).statusCode || 500).json({ error: err.message });
  }
});

router.post('/:id/lock-character', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const { castMemberId, assetId } = req.body;
  if (!castMemberId || !assetId) return res.status(400).json({ error: 'castMemberId and assetId required' });
  await requireCastMember(projectId, castMemberId);
  await requireAsset(projectId, assetId);

  await updateRows('cast_members', { id: castMemberId }, { reference_asset_id: assetId });

  // Don't auto-advance — user clicks "Proceed" when satisfied
  res.json({ ok: true });
});

// ─── Advance past Characters phase ─────────────────────────────────
// User decides when they're done — not all cast members need looks

router.post('/:id/advance-characters', async (req, res) => {
  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!atLeast(project.status, 'characters_locked')) {
    await updateRows('projects', { id: paramStr(req.params.id) }, { status: 'characters_locked', updated_at: new Date().toISOString() });
  }
  res.json({ ok: true, status: 'characters_locked' });
});

// ─── Generate Environment Looks ──────────────────────────────────────

router.post('/:id/generate-environment-look', upload.single('image'), async (req, res) => {
  const { environmentId, note } = req.body;
  if (!environmentId) return res.status(400).json({ error: 'environmentId required' });

  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const env = await requireEnvironment(project.id, environmentId);

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

  // Build or reuse generation prompt
  let genPrompt = env.generation_prompt as string | null;
  if (!genPrompt) {
    const styleIdx = styleImagePath ? 1 : undefined;
    const userRefIdx = userRefImagePath ? (styleImagePath ? 2 : 1) : undefined;
    genPrompt = buildEnvironmentPrompt(
      { name: env.name, description: env.description || '' },
      styleDNA,
      { styleIdx, userRefIdx }
    );
  }

  const userNote = typeof note === 'string' && note.trim() ? note.trim() : undefined;

  // If feedback provided and we have a generation prompt, ask Claude to rewrite
  if (userNote && genPrompt) {
    try {
      let refBase64 = '';
      let refMime = 'image/png';
      if (env.reference_asset_id) {
        const refAsset = await selectOne('assets', { id: env.reference_asset_id });
        if (refAsset) {
          refBase64 = await readAsBase64(refAsset.file_path);
          refMime = mimeFromExt(refAsset.file_path);
        }
      }

      const rewritten = await refineShotPrompt({
        currentVisualPrompt: genPrompt,
        currentMotionPrompt: '',
        feedback: `[ENVIRONMENT LOOK REFINEMENT for ${env.name}] ${userNote}`,
        failedImageBase64: refBase64,
        failedImageMime: refMime,
        styleDNA: styleDNA,
        characterDescriptions: [],
      });
      genPrompt = rewritten.visualPrompt;
      console.log(`[${project.id}] Claude rewrote generation prompt for env ${env.name}: ${genPrompt.substring(0, 100)}...`);
    } catch (err: any) {
      console.warn(`[${project.id}] Env prompt rewrite failed, using note as director note: ${err.message}`);
      genPrompt += `\n\nDirector note: ${userNote}`;
    }
  }

  // Save the (possibly rewritten) prompt
  await updateRows('environments', { id: environmentId }, { generation_prompt: genPrompt, prompts_stale: false });

  try {
    console.log(`[${project.id}] Generating environment looks for ${env.name}${userRefImagePath ? ' (with user ref)' : ''}...`);
    const t0 = Date.now();

    const imagePaths = await generateEnvironmentLooks(
      { name: env.name, description: env.description || '' },
      styleDNA,
      styleImagePath,
      project.aspect_ratio || '16:9',
      userRefImagePath,
      undefined, // feedback already baked into genPrompt by Claude
      genPrompt,
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
    res.status((err as any).statusCode || 500).json({ error: err.message });
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
    res.status((err as any).statusCode || 500).json({ error: err.message });
  }
});

router.post('/:id/lock-environment', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const { environmentId, assetId } = req.body;
  if (!environmentId || !assetId) return res.status(400).json({ error: 'environmentId and assetId required' });
  await requireEnvironment(projectId, environmentId);
  await requireAsset(projectId, assetId);

  await updateRows('environments', { id: environmentId }, { reference_asset_id: assetId });

  // Don't auto-advance — user clicks "Proceed" when satisfied
  res.json({ ok: true });
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
  res.json({ ok: true, status: 'environments_locked' });
});

};

