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
import { buildCharacterPrompt, buildEnvironmentPrompt } from '../services/imagen.js';
import { refineFramePrompt } from '../services/claude.js';
import { getImageGenerationModelName, getImageService } from '../services/image-provider.js';
import { getFullProject } from './projects.js';
import { logCall, buildContextChain } from '../xray.js';
import { paramStr, requireCastMember, requireEnvironment, requireAsset, atLeast } from './scope-helpers.js';
import { recordDirectorEvent } from '../services/directorEvents.js';
import { getProjectPromptOverride } from '../services/projectConfig.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const assertGeneratedLooks = (paths: string[], label: string) => {
  if (paths.length > 0) return;
  const err: any = new Error(`${label} generated zero image candidates. Try again or switch the Image model.`);
  err.statusCode = 502;
  throw err;
};

// Mark shots stale when a character or environment reference changes
const markDependentShotsStale = async (projectId: string, type: 'cast' | 'env', entityId: string) => {
  const scenes = await selectAll('scenes', { project_id: projectId });
  for (const s of scenes) {
    const shots = await selectAll('shots', { scene_id: s.id });
    for (const shot of shots) {
      if (type === 'cast') {
        const castIds = JSON.parse(shot.cast_ids || '[]');
        if (castIds.includes(entityId)) await updateRows('shots', { id: shot.id }, { prompts_stale: true });
      } else {
        if (shot.environment_id === entityId) await updateRows('shots', { id: shot.id }, { prompts_stale: true });
      }
    }
  }
};

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
  // When prompts_stale is set (style/description changed upstream), force a rebuild.
  let genPrompt = member.generation_prompt as string | null;
  if (!genPrompt || member.prompts_stale) {
    const styleIdx = styleImagePath ? 1 : undefined;
    const userRefIdx = userRefImagePath ? (styleImagePath ? 2 : 1) : undefined;
    genPrompt = buildCharacterPrompt(
      { name: member.name, description: member.description || '' },
      { styleIdx, userRefIdx }
    );
    if (member.prompts_stale) {
      await updateRows('cast_members', { id: member.id }, { prompts_stale: 0 });
    }
  }
  const characterLooksRecipe = await getProjectPromptOverride(project.id, 'character_looks');
  const withCharacterLooksRecipe = (prompt: string) => {
    if (!characterLooksRecipe || prompt.includes('Project character-look recipe:')) return prompt;
    return `${prompt}\n\nProject character-look recipe:\n${characterLooksRecipe}`;
  };

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

      // If artist attached an image, send it as reference alongside feedback
      const userRefBase64 = userRefImagePath ? await readAsBase64(userRefImagePath) : undefined;
      const userRefMime = userRefImagePath ? mimeFromExt(userRefImagePath) : undefined;

      const rewritten = await refineFramePrompt({
        currentPrompt: withCharacterLooksRecipe(genPrompt),
        feedback: `[CHARACTER LOOK for ${member.name}] ${feedback}`,
        failedImageBase64: refBase64,
        failedImageMime: refMime,
        referenceImageBase64: userRefBase64,
        referenceImageMime: userRefMime,
        textProvider: project.text_provider,
      });
      genPrompt = rewritten.visualPrompt;
      console.log(`[${project.id}] Rewrote character look prompt for ${member.name}: ${genPrompt.substring(0, 100)}...`);
    } catch (err: any) {
      console.warn(`[${project.id}] Prompt rewrite failed, using feedback as director note: ${err.message}`);
      genPrompt += `\n\nDirector note: ${feedback}`;
    }
  }

  // Save the (possibly rewritten) prompt
  await updateRows('cast_members', { id: castMemberId }, { generation_prompt: genPrompt, prompts_stale: false });

  const renderPrompt = withCharacterLooksRecipe(genPrompt);
  const xrayPrompt = `Generate 3 looks for "${member.name}" | Prompt: ${renderPrompt.substring(0, 150)}...`;

  try {
    const imageService = getImageService(project.image_model);
    console.log(`[${project.id}] Generating looks for ${member.name} via ${getImageGenerationModelName(project.image_model)}${userRefImagePath ? ' (with user ref)' : ''}...`);
    const t0 = Date.now();

    // Pass the registry's runtimeModel so the artist's exact pick runs.
    // Only relevant for the Gemini path — Segmind/OpenAI services don't
    // accept a model arg (their service module is the model). When
    // nano-banana-2 routes through Gemini (Segmind credits out), this
    // ensures we run Flash, not Pro.
    const imagePaths = await imageService.generateCharacterLooks(
      { name: member.name, description: member.description || '' },
      styleImagePath,
      undefined, // feedback already baked into genPrompt by Claude
      project.aspect_ratio || '16:9',
      userRefImagePath,
      renderPrompt,
      getImageGenerationModelName(project.image_model),
    );
    assertGeneratedLooks(imagePaths, `Character look generation for ${member.name}`);
    const durationMs = Date.now() - t0;

    // Save as assets and return URLs
    const looks: { id: string; url: string }[] = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const assetId = uuidv4();
      await insertRow('assets', { id: assetId, project_id: project.id, category: 'character_candidate', file_path: imagePaths[i], prompt: `Look ${i + 1} for ${member.name}`, metadata: JSON.stringify({ castMemberId }) });
      looks.push({ id: assetId, url: storageUrl(imagePaths[i]) });
    }

    await logCall({
      projectId: project.id,
      stage: 'generate-looks',
      model: getImageGenerationModelName(project.image_model),
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
    await recordDirectorEvent({
      projectId: project.id,
      userId: req.userId,
      source: 'web',
      eventType: 'character_looks_generated',
      entityType: 'cast_member',
      entityId: member.id,
      summary: `Artist generated ${looks.length} looks for character "${member.name}".`,
      payload: {
        castMemberId: member.id,
        assetIds: looks.map((look) => look.id),
        feedback: feedback || null,
        userRefAssetId: userRefAssetId || null,
      },
    });

    res.json({ looks, project: await getFullProject(project.id) });
  } catch (err: any) {
    console.error(`[${project.id}] Look gen failed:`, err);
    await logCall({
      projectId: project.id,
      stage: 'generate-looks',
      model: getImageGenerationModelName(project.image_model),
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
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'character_reference_uploaded',
      entityType: 'cast_member',
      entityId: castMemberId,
      summary: `Artist uploaded and locked a reference for character "${member.name}".`,
      payload: { castMemberId, assetId },
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
  await markDependentShotsStale(projectId, 'cast', castMemberId);
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'character_locked',
    entityType: 'cast_member',
    entityId: castMemberId,
    summary: 'Artist locked a character reference; dependent shots were marked stale.',
    payload: { castMemberId, assetId },
  });

  // Don't auto-advance — user clicks "Proceed" when satisfied
  res.json({ ok: true });
});

// ─── Get candidates for a character or environment ────────────────
router.get('/:id/candidates/:entityType/:entityId', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const entityType = req.params.entityType as string; // 'character' or 'environment'
  const entityId = req.params.entityId as string;
  const category = entityType === 'character' ? 'character_candidate' : 'environment_candidate';
  const metaKey = entityType === 'character' ? 'castMemberId' : 'environmentId';

  const allAssets = await selectAll('assets', { project_id: projectId, category });
  const candidates = allAssets
    .filter((a: any) => {
      try { return JSON.parse(a.metadata || '{}')[metaKey] === entityId; } catch { return false; }
    })
    .map((a: any) => ({ id: a.id, url: storageUrl(a.file_path) }));

  res.json({ candidates });
});

// ─── Unlock individual character look ─────────────────────────────
router.post('/:id/unlock-character-look', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const { castMemberId } = req.body;
  if (!castMemberId) return res.status(400).json({ error: 'castMemberId required' });
  await requireCastMember(projectId, castMemberId);
  await updateRows('cast_members', { id: castMemberId }, { reference_asset_id: null });
  await markDependentShotsStale(projectId, 'cast', castMemberId);
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'character_unlocked',
    entityType: 'cast_member',
    entityId: castMemberId,
    summary: 'Artist unlocked a character reference; dependent shots were marked stale.',
    payload: { castMemberId },
  });
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
  await recordDirectorEvent({
    projectId: project.id,
    userId: req.userId,
    source: 'web',
    eventType: 'characters_advanced',
    entityType: 'project',
    entityId: project.id,
    summary: 'Artist advanced past the character phase.',
  });
  res.json({ ok: true, status: 'characters_locked' });
});

// ─── Generate Environment Looks ──────────────────────────────────────

router.post('/:id/generate-environment-look', upload.single('image'), async (req, res) => {
  const { environmentId, note } = req.body;
  if (!environmentId) return res.status(400).json({ error: 'environmentId required' });

  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const env = await requireEnvironment(project.id, environmentId);

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

  // Build or reuse generation prompt.
  // When prompts_stale is set (style/description changed upstream), force a rebuild.
  let genPrompt = env.generation_prompt as string | null;
  if (!genPrompt || env.prompts_stale) {
    const styleIdx = styleImagePath ? 1 : undefined;
    const userRefIdx = userRefImagePath ? (styleImagePath ? 2 : 1) : undefined;
    genPrompt = buildEnvironmentPrompt(
      { name: env.name, description: env.description || '' },
      { styleIdx, userRefIdx }
    );
    if (env.prompts_stale) {
      await updateRows('environments', { id: env.id }, { prompts_stale: 0 });
    }
  }
  const environmentLooksRecipe = await getProjectPromptOverride(project.id, 'environment_looks');
  const withEnvironmentLooksRecipe = (prompt: string) => {
    if (!environmentLooksRecipe || prompt.includes('Project environment-look recipe:')) return prompt;
    return `${prompt}\n\nProject environment-look recipe:\n${environmentLooksRecipe}`;
  };

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

      // If artist attached an image, send it as reference alongside feedback
      const userEnvRefBase64 = userRefImagePath ? await readAsBase64(userRefImagePath) : undefined;
      const userEnvRefMime = userRefImagePath ? mimeFromExt(userRefImagePath) : undefined;

      const rewritten = await refineFramePrompt({
        currentPrompt: withEnvironmentLooksRecipe(genPrompt),
        feedback: `[ENVIRONMENT LOOK for ${env.name}] ${userNote}`,
        failedImageBase64: refBase64,
        failedImageMime: refMime,
        referenceImageBase64: userEnvRefBase64,
        referenceImageMime: userEnvRefMime,
        textProvider: project.text_provider,
      });
      genPrompt = rewritten.visualPrompt;
      console.log(`[${project.id}] Rewrote env look prompt for ${env.name}: ${genPrompt.substring(0, 100)}...`);
    } catch (err: any) {
      console.warn(`[${project.id}] Env prompt rewrite failed, using note as director note: ${err.message}`);
      genPrompt += `\n\nDirector note: ${userNote}`;
    }
  }

  // Save the (possibly rewritten) prompt
  await updateRows('environments', { id: environmentId }, { generation_prompt: genPrompt, prompts_stale: false });

  try {
    const imageService = getImageService(project.image_model);
    const renderPrompt = withEnvironmentLooksRecipe(genPrompt);
    console.log(`[${project.id}] Generating environment looks for ${env.name} via ${getImageGenerationModelName(project.image_model)}${userRefImagePath ? ' (with user ref)' : ''}...`);
    const t0 = Date.now();

    const imagePaths = await imageService.generateEnvironmentLooks(
      { name: env.name, description: env.description || '' },
      styleImagePath,
      project.aspect_ratio || '16:9',
      userRefImagePath,
      undefined, // feedback already baked into genPrompt by Claude
      renderPrompt,
      getImageGenerationModelName(project.image_model),
    );
    assertGeneratedLooks(imagePaths, `Environment look generation for ${env.name}`);
    const durationMs = Date.now() - t0;

    const looks: { id: string; url: string }[] = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const assetId = uuidv4();
      await insertRow('assets', { id: assetId, project_id: project.id, category: 'environment_candidate', file_path: imagePaths[i], prompt: `Environment look ${i + 1} for ${env.name}`, metadata: JSON.stringify({ environmentId: env.id }) });
      looks.push({ id: assetId, url: storageUrl(imagePaths[i]) });
    }

    await logCall({
      projectId: project.id,
      stage: 'generate-environment-look',
      model: getImageGenerationModelName(project.image_model),
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
    await recordDirectorEvent({
      projectId: project.id,
      userId: req.userId,
      source: 'web',
      eventType: 'environment_looks_generated',
      entityType: 'environment',
      entityId: env.id,
      summary: `Artist generated ${looks.length} looks for environment "${env.name}".`,
      payload: {
        environmentId: env.id,
        assetIds: looks.map((look) => look.id),
        note: userNote || null,
      },
    });

    res.json({ looks, project: await getFullProject(project.id) });
  } catch (err: any) {
    console.error(`[${project.id}] Environment look gen failed:`, err);
    await logCall({
      projectId: project.id,
      stage: 'generate-environment-look',
      model: getImageGenerationModelName(project.image_model),
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
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'environment_reference_uploaded',
      entityType: 'environment',
      entityId: environmentId,
      summary: `Artist uploaded and locked a reference for environment "${env.name}".`,
      payload: { environmentId, assetId },
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
  await markDependentShotsStale(projectId, 'env', environmentId);
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'environment_locked',
    entityType: 'environment',
    entityId: environmentId,
    summary: 'Artist locked an environment reference; dependent shots were marked stale.',
    payload: { environmentId, assetId },
  });

  // Don't auto-advance — user clicks "Proceed" when satisfied
  res.json({ ok: true });
});

// ─── Unlock individual environment look ───────────────────────────
router.post('/:id/unlock-environment-look', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const { environmentId } = req.body;
  if (!environmentId) return res.status(400).json({ error: 'environmentId required' });
  await requireEnvironment(projectId, environmentId);
  await updateRows('environments', { id: environmentId }, { reference_asset_id: null });
  await markDependentShotsStale(projectId, 'env', environmentId);
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'environment_unlocked',
    entityType: 'environment',
    entityId: environmentId,
    summary: 'Artist unlocked an environment reference; dependent shots were marked stale.',
    payload: { environmentId },
  });
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
  await recordDirectorEvent({
    projectId: project.id,
    userId: req.userId,
    source: 'web',
    eventType: 'environments_advanced',
    entityType: 'project',
    entityId: project.id,
    summary: 'Artist advanced past the environment phase.',
  });
  res.json({ ok: true, status: 'environments_locked' });
});

};
