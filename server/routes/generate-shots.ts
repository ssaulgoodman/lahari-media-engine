/**
 * Shot-level generation routes — extracted from generate.ts.
 * Handles: generate-image, generate-end-frame, refine-prompt,
 * refine-end-frame-prompt, refine-video-prompt, use-prev-last-frame,
 * use-as-prev-end, clear/upload end frame, upload/delete shot refs,
 * lock/unlock shots, scene lock-all/unlock-all, history, revert.
 */
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { selectOne, selectAll, insertRow, updateRows, deleteRows, findShot, incrementColumn, getSB, T } from '../database.js';
import { readAsBase64, mimeFromExt, saveBuffer, storageUrl } from '../storage.js';
import { SEGMIND_MODELS } from '../services/segmind.js';
import { refineFramePrompt, refineMotionPrompt } from '../services/claude.js';
import { describeFrame } from '../services/gemini.js';
import { getImageGenerationModelName, getImageService } from '../services/image-provider.js';
import { generateStoryboardVersion, lockStoryboardVersion, unlockStoryboardVersion, updateStoryboardCutPlan, writeStoryboardPrompt } from '../services/storyboard.js';
import { sendStructuredError } from '../services/structuredErrors.js';
import { beginInFlightGeneration, generationAlreadyRunningError, generationKey } from '../services/inFlightGeneration.js';
import { eventResultPointers, recordDirectorEvent } from '../services/directorEvents.js';
import { getFullProject } from './projects.js';
import { logCall, buildContextChain } from '../xray.js';
import { paramStr } from './scope-helpers.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const parseJson = <T>(value: any, fallback: T): T => {
  if (!value) return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

const imageExtFromMime = (mimeType?: string, fallbackName?: string) => {
  const fromName = path.extname(fallbackName || '').replace(/^\./, '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp'].includes(fromName)) return fromName;
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return 'png';
};

const updateShotIfStatus = async (
  shotId: string,
  statusColumn: 'image_status' | 'video_status' | 'end_image_status',
  expectedStatus: string,
  updates: Record<string, any>,
): Promise<boolean> => {
  const { data, error } = await getSB()
    .from(T.shots)
    .update(updates)
    .eq('id', shotId)
    .eq(statusColumn, expectedStatus)
    .select('id');
  if (error) throw new Error(`DB update shots: ${error.message}`);
  return (data?.length || 0) > 0;
};

export const mountShotRoutes = (router: Router) => {

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

    const result = await refineFramePrompt({
      currentPrompt: shot.visual_prompt || '',
      feedback,
      failedImageBase64: imageBase64,
      failedImageMime: mime,
      referenceImageBase64: req.file ? req.file.buffer.toString('base64') : undefined,
      referenceImageMime: req.file ? (req.file.mimetype || 'image/png') : undefined,
      textProvider: project.text_provider,
    });

    // Update the visual prompt with the rewritten version
    await updateRows('shots', { id: shot.id }, {
      visual_prompt: result.visualPrompt,
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
    sendStructuredError(res, err);
  }
});

// ─── Generate Shot Start Frame (with full reference chain) ───────────

router.post('/:id/shots/:shotId/generate-image', async (req, res) => {
  const project = await selectOne('projects', { id: paramStr(req.params.id) });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const shot = await selectOne('shots', { id: paramStr(req.params.shotId) });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  const scene = await selectOne('scenes', { id: shot.scene_id });
  const ignoreContinuity = String(project.video_model || '').startsWith('seedance');

  // Sequential enforcement only for continuity-linked shots.
  // Hard-cut shots are independent and can generate in parallel.
  if (!ignoreContinuity && shot.continuity_from === 'prev_shot' && shot.sort_order > 0) {
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
        if (!ignoreContinuity && shot.continuity_from === 'prev_shot' && shot.sort_order > 0) {
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
    if (!ignoreContinuity && shot.continuity_from === 'prev_shot' && shot.sort_order > 0) {
      const prevShot = await findShot(shot.scene_id, shot.sort_order - 1);
      const cid = prevShot?.extracted_last_frame_asset_id || prevShot?.end_image_asset_id;
      if (cid) prevShotEndFramePath = await resolveAssetPath(cid);
    }
    const shotRefAssets = await selectAll('assets', { shot_id: shot.id, category: 'shot_ref' });
    additionalRefs = shotRefAssets.map((a: any) => ({ imagePath: a.file_path }));
  }

  const releaseGeneration = beginInFlightGeneration(generationKey('image', project.id, shot.id));
  if (!releaseGeneration) return sendStructuredError(res, generationAlreadyRunningError('image', project.id, shot.id));

  // Vision-describe continuity frame (shared by both paths)
  if (prevShotEndFramePath && !continuityDescription) {
    try {
      const base64 = await readAsBase64(prevShotEndFramePath);
      const mime = mimeFromExt(prevShotEndFramePath);
      continuityDescription = await describeFrame(base64, mime, project.text_provider);
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

    const imageService = getImageService(project.image_model);
    const imagePath = await imageService.generateShotStartFrame({
      visualPrompt: shotPrompt,
      styleImagePath,
      characterRefs,
      environmentRef,
      prevShotEndFramePath,
      continuityDescription,
      userFeedback,
      failedImagePath,
      aspectRatio: project.aspect_ratio || '16:9',
      additionalRefs: additionalRefs.length > 0 ? additionalRefs : undefined,
      model: getImageGenerationModelName(project.image_model),
    });

    const durationMs = Date.now() - t0;

    // Save asset. If the artist cancelled locally while the provider was still
    // running, keep the paid output as a recoverable version instead of making
    // it the active frame.
    const assetId = uuidv4();
    const shotNow = await selectOne('shots', { id: shot.id });
    const completedAfterLocalCancel = shotNow?.image_status !== 'loading';
    await insertRow('assets', {
      id: assetId,
      project_id: project.id,
      shot_id: shot.id,
      category: 'shot_image',
      file_path: imagePath,
      prompt: shotPrompt,
      metadata: completedAfterLocalCancel ? JSON.stringify({
        completed_after_local_cancel: true,
        local_cancel_status: shotNow?.image_status || null,
      }) : null,
    });

    let savedAfterLocalCancel = completedAfterLocalCancel;
    if (!completedAfterLocalCancel) {
      // Only clear last_error if no other operation is in error state
      const clearError = shot.end_image_status !== 'error' && shot.video_status !== 'error';
      const activated = await updateShotIfStatus(shot.id, 'image_status', 'loading', {
        image_asset_id: assetId,
        image_status: 'success',
        ...(clearError ? { last_error: null } : {}),
        user_feedback: null,
        prompts_stale: false,
      });
      if (!activated) {
        savedAfterLocalCancel = true;
        const latestShot = await selectOne('shots', { id: shot.id });
        await updateRows('assets', { id: assetId }, {
          metadata: JSON.stringify({
            completed_after_local_cancel: true,
            local_cancel_status: latestShot?.image_status || null,
            local_cancel_race: true,
          }),
        });
        await recordDirectorEvent({
          projectId: project.id,
          userId: req.userId,
          source: 'system',
          eventType: 'shot_image_completed_after_cancel',
          entityType: 'asset',
          entityId: assetId,
          summary: 'A locally-cancelled frame generation completed later and was saved as a recoverable version.',
          payload: { shotId: shot.id, assetId, previousStatus: latestShot?.image_status || null, cancelRace: true },
        });
      }
    } else {
      await recordDirectorEvent({
        projectId: project.id,
        userId: req.userId,
        source: 'system',
        eventType: 'shot_image_completed_after_cancel',
        entityType: 'asset',
        entityId: assetId,
        summary: 'A locally-cancelled frame generation completed later and was saved as a recoverable version.',
        payload: { shotId: shot.id, assetId, previousStatus: shotNow?.image_status || null },
      });
    }

    await logCall({
      projectId: project.id,
      stage: 'generate-shot-start-frame',
      model: getImageGenerationModelName(project.image_model),
      prompt: shotPrompt,
      referenceInputs: [
        ...(styleImagePath ? [{ type: 'image' as const, label: 'Style ref', url: storageUrl(styleImagePath) }] : []),
        ...characterRefs.map(r => ({ type: 'image' as const, label: `${r.name} ref`, url: storageUrl(r.imagePath) })),
        ...(environmentRef ? [{ type: 'image' as const, label: `Env: ${environmentRef.name}`, url: storageUrl(environmentRef.imagePath) }] : []),
        ...(prevShotEndFramePath ? [{ type: 'image' as const, label: 'Prev end frame', url: storageUrl(prevShotEndFramePath) }] : []),
      ],
      contextChain: await buildContextChain(project.id),
      responseSummary: savedAfterLocalCancel
        ? 'Generated start frame after local cancel; saved as recoverable version, not active frame'
        : 'Generated start frame for shot',
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
      model: getImageGenerationModelName(project.image_model),
      prompt: shotPrompt,
      durationMs: 0,
      error: err.message,
    });
    const shotNow = await selectOne('shots', { id: shot.id });
    if (shotNow?.image_status === 'loading') {
      await updateRows('shots', { id: shot.id }, { image_status: 'error', last_error: err.message?.slice(0, 500) || 'Unknown error' });
    }
    sendStructuredError(res, err);
  } finally {
    releaseGeneration();
  }
});

// ─── Write / Render / Refine / Lock Storyboard ─────────────────────

router.post('/:id/shots/:shotId/write-storyboard-prompt', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);

  try {
    const result = await writeStoryboardPrompt({
      projectId,
      shotId,
      artistNote: req.body?.feedback || req.body?.artistNote,
      variant: req.body?.variant || 'adaptive_numbered_storyboard',
    });
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'storyboard_prompt_written',
      entityType: 'shot',
      entityId: shotId,
      summary: 'Artist wrote or rewrote the storyboard prompt in the web studio.',
      payload: {
        artistNote: req.body?.feedback || req.body?.artistNote || null,
        variant: req.body?.variant || 'adaptive_numbered_storyboard',
      },
    });
    res.json({ ok: true, ...result, project: await getFullProject(projectId) });
  } catch (err: any) {
    console.error(`[shot ${shotId}] Storyboard prompt write failed:`, err);
    sendStructuredError(res, err);
  }
});

router.post('/:id/shots/:shotId/generate-storyboard', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);

  try {
    const result = await generateStoryboardVersion({
      projectId,
      shotId,
      variant: req.body?.variant || 'adaptive_numbered_storyboard',
    });
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'storyboard_generated',
      entityType: 'shot',
      entityId: shotId,
      summary: 'Artist generated a storyboard board in the web studio.',
      payload: {
        variant: req.body?.variant || 'adaptive_numbered_storyboard',
        result: eventResultPointers(result),
      },
    });
    res.json({ ok: true, storyboard: result, project: await getFullProject(projectId) });
  } catch (err: any) {
    console.error(`[shot ${shotId}] Storyboard generation failed:`, err);
    sendStructuredError(res, err);
  }
});

router.post('/:id/shots/:shotId/refine-storyboard', upload.single('referenceImage'), async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);
  const feedback = req.body?.feedback;
  if (!feedback?.trim()) return res.status(400).json({ error: 'Feedback required' });

  try {
    let artistReferenceImagePath: string | undefined;
    if (req.file) {
      const ext = path.extname(req.file.originalname).slice(1) || 'png';
      artistReferenceImagePath = await saveBuffer(req.file.buffer, 'images', ext);
      await insertRow('assets', {
        id: uuidv4(),
        project_id: projectId,
        shot_id: shotId,
        category: 'storyboard_refine_ref',
        file_path: artistReferenceImagePath,
        prompt: feedback,
      });
    }

    const refineMode = req.body?.refineMode === 'edit_image' ? 'edit_image' : 'replan';
    if (refineMode === 'edit_image') {
      const result = await generateStoryboardVersion({
        projectId,
        shotId,
        artistNote: feedback,
        previousVersionId: req.body?.previousVersionId,
        refineMode,
        variant: req.body?.variant || 'adaptive_numbered_storyboard',
        artistReferenceImagePath,
      });
      await recordDirectorEvent({
        projectId,
        userId: req.userId,
        source: 'web',
        eventType: 'storyboard_refined',
        entityType: 'shot',
        entityId: shotId,
        summary: 'Artist refined the storyboard image in the web studio.',
        payload: {
          feedback,
          refineMode,
          previousVersionId: req.body?.previousVersionId || null,
          variant: req.body?.variant || 'adaptive_numbered_storyboard',
          artistReferenceImagePath: artistReferenceImagePath || null,
          result: eventResultPointers(result),
        },
      });
      res.json({ ok: true, storyboard: result, project: await getFullProject(projectId) });
      return;
    }

    const result = await writeStoryboardPrompt({
      projectId,
      shotId,
      artistNote: feedback,
      variant: req.body?.variant || 'adaptive_numbered_storyboard',
      artistReferenceImagePath,
    });
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'storyboard_prompt_refined',
      entityType: 'shot',
      entityId: shotId,
      summary: 'Artist refined the storyboard prompt in the web studio.',
      payload: {
        feedback,
        variant: req.body?.variant || 'adaptive_numbered_storyboard',
        artistReferenceImagePath: artistReferenceImagePath || null,
      },
    });
    res.json({ ok: true, ...result, project: await getFullProject(projectId) });
  } catch (err: any) {
    console.error(`[shot ${shotId}] Storyboard refinement failed:`, err);
    sendStructuredError(res, err);
  }
});

router.post('/:id/shots/:shotId/lock-storyboard', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);

  try {
    await lockStoryboardVersion(projectId, shotId, req.body?.versionId);
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'storyboard_locked',
      entityType: 'shot',
      entityId: shotId,
      summary: 'Artist locked the active storyboard board.',
      payload: { versionId: req.body?.versionId || null },
    });
    res.json({ ok: true, project: await getFullProject(projectId) });
  } catch (err: any) {
    console.error(`[shot ${shotId}] Storyboard lock failed:`, err);
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/shots/:shotId/unlock-storyboard', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);

  try {
    await unlockStoryboardVersion(projectId, shotId);
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'storyboard_unlocked',
      entityType: 'shot',
      entityId: shotId,
      summary: 'Artist unlocked the storyboard board for more work.',
    });
    res.json({ ok: true, project: await getFullProject(projectId) });
  } catch (err: any) {
    console.error(`[shot ${shotId}] Storyboard unlock failed:`, err);
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/shots/:shotId/upload-storyboard', upload.single('image'), async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);
  if (!req.file) return res.status(400).json({ error: 'image file required' });
  if (!String(req.file.mimetype || '').toLowerCase().startsWith('image/')) {
    return res.status(400).json({ error: 'Storyboard upload requires an image file' });
  }

  const shot = await selectOne('shots', { id: shotId });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  try {
    const ext = imageExtFromMime(req.file.mimetype, req.file.originalname);
    const filePath = await saveBuffer(req.file.buffer, 'images', ext);
    const assetId = uuidv4();
    const versionId = uuidv4();
    const importedAt = new Date().toISOString();
    const note = String(req.body?.note || 'Uploaded storyboard image as-is').trim();
    const parentVersionId = shot.storyboard_version_id || null;

    await insertRow('assets', {
      id: assetId,
      project_id: projectId,
      shot_id: shotId,
      category: 'shot_storyboard',
      file_path: filePath,
      prompt: note,
      metadata: JSON.stringify({
        storyboardVersionId: versionId,
        variant: 'studio_uploaded_storyboard_image',
        importedAt,
        importedBy: 'web',
        originalName: req.file.originalname || null,
        mimeType: req.file.mimetype || null,
        bytes: req.file.size || null,
      }),
    });

    await insertRow('storyboard_versions', {
      id: versionId,
      project_id: projectId,
      shot_id: shotId,
      asset_id: assetId,
      parent_version_id: parentVersionId,
      openai_response_id: null,
      openai_image_call_ids: [],
      reasoning_model: null,
      image_model: 'studio_upload',
      prompt: shot.storyboard_prompt || null,
      artist_note: note,
      refs: [],
      metadata: {
        variant: 'studio_uploaded_storyboard_image',
        sourceAssetId: assetId,
        importedAt,
        importedBy: 'web',
        previousVersionId: parentVersionId,
        note,
        originalName: req.file.originalname || null,
        mimeType: req.file.mimetype || null,
        bytes: req.file.size || null,
      },
      locked: false,
    });

    await updateRows('storyboard_versions', { shot_id: shotId }, { locked: false });
    await updateRows('shots', { id: shotId }, {
      storyboard_asset_id: assetId,
      storyboard_version_id: versionId,
      storyboard_status: 'success',
      storyboard_locked: false,
      storyboard_user_feedback: note,
      video_status: 'stale',
      last_error: null,
    });

    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'storyboard_uploaded',
      entityType: 'shot',
      entityId: shotId,
      summary: 'Artist uploaded a storyboard image as-is in the web studio.',
      payload: {
        assetId,
        versionId,
        previousVersionId: parentVersionId,
        imageUrl: storageUrl(filePath),
      },
    });

    res.json(await getFullProject(projectId));
  } catch (err: any) {
    console.error(`[shot ${shotId}] Storyboard upload failed:`, err);
    sendStructuredError(res, err);
  }
});

router.patch('/:id/shots/:shotId/storyboard-plan', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);
  // Empty cutPlanText is a valid save — it clears the cut plan and Seedance
  // falls back to following the board's panel order. Only a missing field is
  // rejected, so callers must state the empty intent explicitly.
  if (req.body?.cutPlanText === undefined) return res.status(400).json({ error: 'cutPlanText required (empty string clears the cut plan)' });
  const cutPlanText = String(req.body.cutPlanText || '').trim();
  const storyboardPrompt = req.body?.storyboardPrompt === undefined ? undefined : String(req.body.storyboardPrompt || '').trim();

  if (storyboardPrompt !== undefined && !storyboardPrompt) return res.status(400).json({ error: 'storyboardPrompt cannot be empty' });

  try {
    await updateStoryboardCutPlan(projectId, shotId, cutPlanText, storyboardPrompt);
    res.json({ ok: true, project: await getFullProject(projectId) });
  } catch (err: any) {
    console.error(`[shot ${shotId}] Storyboard plan update failed:`, err);
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id/shots/:shotId/storyboard-history', async (req, res) => {
  const shotId = paramStr(req.params.shotId);
  const rows = await selectAll('storyboard_versions', { shot_id: shotId }, { orderBy: 'created_at', ascending: false });
  const assetIds = rows.map((row: any) => row.asset_id).filter(Boolean);
  const assets = assetIds.length ? await selectAll('assets', { id: assetIds }) : [];
  const assetMap = new Map(assets.map((asset: any) => [asset.id, asset]));

  res.json({
    versions: rows.map((row: any) => {
      const asset = assetMap.get(row.asset_id);
      const metadata = parseJson<Record<string, any>>(row.metadata, {});
      return {
        id: row.id,
        assetId: row.asset_id,
        imageUrl: asset ? storageUrl(asset.file_path) : undefined,
        parentVersionId: row.parent_version_id || undefined,
        artistNote: row.artist_note || undefined,
        openaiResponseId: row.openai_response_id || undefined,
        reasoningModel: row.reasoning_model || undefined,
        imageModel: row.image_model || undefined,
        cutPlanText: metadata.cutPlanText || undefined,
        continuityNotes: metadata.continuityNotes || undefined,
        locked: !!row.locked,
        createdAt: row.created_at,
      };
    }),
  });
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

  const releaseGeneration = beginInFlightGeneration(generationKey('end-frame', projectId, shotId));
  if (!releaseGeneration) return sendStructuredError(res, generationAlreadyRunningError('end-frame', projectId, shotId));

  try {
    await updateRows('shots', { id: shotId }, { end_image_status: 'loading' });
    const t0 = Date.now();

    const imageService = getImageService(project.image_model);
    const endFramePath = await imageService.generateShotEndFrame({
      startFramePath,
      visualPrompt: shot.end_visual_prompt || shot.visual_prompt || '',
      motionPrompt: shot.motion_prompt || 'Cinematic camera movement',
      styleImagePath,
      characterRefs: characterRefs.length > 0 ? characterRefs : undefined,
      environmentRef,
      additionalRefs: extraRefs.length > 0 ? extraRefs : undefined,
      userFeedback: shot.end_user_feedback || undefined,
      failedImagePath: failedEndFramePath,
      model: getImageGenerationModelName(project.image_model),
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
      model: getImageGenerationModelName(project.image_model),
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
    sendStructuredError(res, err, 'end_frame_generation_failed');
  } finally {
    releaseGeneration();
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

    const result = await refineFramePrompt({
      currentPrompt: shot.end_visual_prompt || shot.visual_prompt || '',
      feedback: `[END FRAME — what the shot should land on] ${feedback}`,
      failedImageBase64: imageBase64,
      failedImageMime: mime,
      referenceImageBase64: req.file ? req.file.buffer.toString('base64') : undefined,
      referenceImageMime: req.file ? (req.file.mimetype || 'image/png') : undefined,
      textProvider: project.text_provider,
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
    sendStructuredError(res, err);
  }
});

// Refine video prompt — Claude rewrites the motion prompt based on feedback
router.post('/:id/shots/:shotId/refine-video-prompt', upload.single('referenceImage'), async (req, res) => {
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

    const userRefBase64 = req.file ? req.file.buffer.toString('base64') : undefined;
    const userRefMime = req.file ? (req.file.mimetype || 'image/png') : undefined;

    const result = await refineMotionPrompt({
      currentMotionPrompt: shot.motion_prompt || 'Cinematic camera movement',
      shotVisualPrompt: shot.visual_prompt || '',
      feedback,
      startFrameBase64: startBase64,
      startFrameMime: startMime,
      endFrameBase64: endBase64,
      endFrameMime: endMime,
      referenceImageBase64: userRefBase64,
      referenceImageMime: userRefMime,
      textProvider: project.text_provider,
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
    sendStructuredError(res, err);
  }
});

// Clear end frame — removes the lastFrame constraint, video generates freely
router.post('/:id/shots/:shotId/clear-end-frame', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);
  await updateRows('shots', { id: shotId }, { end_image_asset_id: null, end_image_status: 'idle', video_status: 'stale' });
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'shot_end_frame_cleared',
    entityType: 'shot',
    entityId: shotId,
    summary: 'Artist cleared the active end frame; video was marked stale.',
  });
  res.json({ ok: true });
});

// Cancel an in-flight image generation — flips a stuck `loading` row back
// to idle so the artist can retry. Server work (if any) keeps running but
// its terminal write is harmless on an idle row.
router.post('/:id/shots/:shotId/cancel-image', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);
  const shot = await selectOne('shots', { id: shotId });
  if (shot?.image_status === 'loading') {
    await updateRows('shots', { id: shotId }, { image_status: 'idle' });
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'shot_image_cancel_requested',
      entityType: 'shot',
      entityId: shotId,
      summary: 'Artist locally cancelled an in-flight frame generation. Provider work may still complete and be saved as a recoverable version.',
    });
  }
  res.json({ ok: true });
});

// Cancel an in-flight video generation — same pattern as cancel-image.
router.post('/:id/shots/:shotId/cancel-video', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);
  const shot = await selectOne('shots', { id: shotId });
  if (shot?.video_status === 'loading') {
    await updateRows('shots', { id: shotId }, { video_status: 'idle' });
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'shot_video_cancel_requested',
      entityType: 'shot',
      entityId: shotId,
      summary: 'Artist locally cancelled an in-flight video generation. Provider work may still complete and be saved as a recoverable version.',
    });
  }
  res.json({ ok: true });
});

// Clear extracted last frame — removes the ffmpeg-extracted frame from a previous video gen
router.post('/:id/shots/:shotId/clear-extracted-frame', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);
  await updateRows('shots', { id: shotId }, { extracted_last_frame_asset_id: null });
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'shot_extracted_frame_cleared',
    entityType: 'shot',
    entityId: shotId,
    summary: 'Artist cleared the extracted last-frame continuity reference.',
  });
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
  const projectId = paramStr(req.params.id);
  const shot = await selectOne('shots', { id: paramStr(req.params.shotId) });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });
  const hasFrameSource = !!shot.image_asset_id || (!!shot.storyboard_locked && !!shot.storyboard_asset_id);
  if (!hasFrameSource) return res.status(400).json({ error: 'Start frame or locked storyboard required to lock' });
  if (!shot.video_asset_id) return res.status(400).json({ error: 'Video must be generated before locking' });

  await updateRows('shots', { id: shot.id }, { locked: 1 });
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'shot_locked',
    entityType: 'shot',
    entityId: shot.id,
    summary: 'Artist locked the shot.',
  });
  res.json({ ok: true });
});

router.post('/:id/shots/:shotId/unlock', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const shot = await selectOne('shots', { id: paramStr(req.params.shotId) });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  await updateRows('shots', { id: shot.id }, { locked: 0 });
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'shot_unlocked',
    entityType: 'shot',
    entityId: shot.id,
    summary: 'Artist unlocked the shot for more work.',
  });
  res.json({ ok: true });
});

// ─── Batch lock/unlock all shots in a scene ────────────────────────

router.post('/:id/scenes/:sceneId/lock-all', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const sceneId = paramStr(req.params.sceneId);
  const shots = await selectAll('shots', { scene_id: sceneId });
  // Only lock shots that have video plus either a start frame or a locked storyboard.
  const lockable = shots.filter((s: any) =>
    (s.image_asset_id || (s.storyboard_locked && s.storyboard_asset_id)) && s.video_asset_id && !s.locked
  );
  for (const shot of lockable) {
    await updateRows('shots', { id: shot.id }, { locked: 1 });
  }
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'scene_shots_locked',
    entityType: 'scene',
    entityId: sceneId,
    summary: `Artist locked ${lockable.length} lockable shots in the scene.`,
    payload: { lockedShotIds: lockable.map((shot: any) => shot.id), skipped: shots.length - lockable.length },
  });
  res.json({ ok: true, locked: lockable.length, skipped: shots.length - lockable.length });
});

router.post('/:id/scenes/:sceneId/unlock-all', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const sceneId = paramStr(req.params.sceneId);
  await getSB().from(T.shots).update({ locked: 0 }).eq('scene_id', sceneId);
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'scene_shots_unlocked',
    entityType: 'scene',
    entityId: sceneId,
    summary: 'Artist unlocked all shots in the scene.',
  });
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

  const parseMetadata = (metadata: any) => {
    if (!metadata) return {};
    if (typeof metadata === 'object') return metadata;
    try { return JSON.parse(metadata); } catch { return {}; }
  };
  const isHiddenFromMediaLibrary = (asset: any) => {
    const metadata = parseMetadata(asset.metadata);
    return metadata.hiddenFromMediaLibrary === true || metadata.hidden_from_media_library === true;
  };
  const visibleVideos = (videos as any[]).filter((asset) => !isHiddenFromMediaLibrary(asset));

  const videoThumbIds = visibleVideos
    .map((a: any) => parseMetadata(a.metadata).extracted_last_frame_asset_id || null)
    .filter(Boolean);
  const thumbAssets = videoThumbIds.length > 0
    ? await selectAll('assets', { id: videoThumbIds })
    : [];
  const thumbById = new Map(thumbAssets.map((a: any) => [a.id, a]));

  const mapAsset = (a: any, currentId: string | null) => ({
    assetId: a.id,
    url: storageUrl(a.file_path),
    createdAt: a.created_at,
    isCurrent: a.id === currentId,
  });

  res.json({
    firstFrame: frames.map(a => mapAsset(a, shot.image_asset_id)),
    lastFrame: endFrames.map(a => mapAsset(a, shot.end_image_asset_id)),
    video: visibleVideos.map(a => {
      let thumbId: string | null = null;
      thumbId = parseMetadata(a.metadata).extracted_last_frame_asset_id || null;
      const thumbAsset = thumbId ? thumbById.get(thumbId) : null;
      return {
        ...mapAsset(a, shot.video_asset_id),
        thumbnailUrl: thumbAsset?.file_path ? storageUrl(thumbAsset.file_path) : null,
      };
    }),
  });
});

router.post('/:id/shots/:shotId/assets/:assetId/hide-from-media-library', async (req, res) => {
  // Ownership is enforced by generate.ts router.param('id') and router.param('shotId') before this handler runs.
  const projectId = paramStr(req.params.id);
  const shotId = paramStr(req.params.shotId);
  const assetId = paramStr(req.params.assetId);
  const shot = await selectOne('shots', { id: shotId });
  const asset: any = await selectOne('assets', { id: assetId });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });
  if (!asset || asset.shot_id !== shotId || asset.category !== 'shot_video') {
    return res.status(404).json({ error: 'Video asset not found for this shot' });
  }
  if (asset.id === shot.video_asset_id) {
    return res.status(400).json({ error: 'Cannot hide the current shot video. Revert or generate another take first.' });
  }

  let metadata: Record<string, any> = {};
  if (asset.metadata) {
    if (typeof asset.metadata === 'object') metadata = asset.metadata;
    else {
      try { metadata = JSON.parse(asset.metadata); } catch { metadata = {}; }
    }
  }
  await updateRows('assets', { id: assetId }, {
    metadata: JSON.stringify({
      ...metadata,
      hiddenFromMediaLibrary: true,
      hiddenFromMediaLibraryAt: new Date().toISOString(),
    }),
  });
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'media_library_asset_hidden',
    entityType: 'asset',
    entityId: assetId,
    summary: 'Artist hid a shot video take from the render media library.',
    payload: { shotId, assetId },
  });

  res.json({ ok: true });
});

router.post('/:id/shots/:shotId/revert-frame', async (req, res) => {
  const projectId = paramStr(req.params.id);
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
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'shot_frame_reverted',
    entityType: 'shot',
    entityId: shotId,
    summary: 'Artist restored a previous start-frame version.',
    payload: { assetId },
  });

  res.json({ ok: true });
});

router.post('/:id/shots/:shotId/revert-end-frame', async (req, res) => {
  const projectId = paramStr(req.params.id);
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
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'shot_end_frame_reverted',
    entityType: 'shot',
    entityId: shotId,
    summary: 'Artist restored a previous end-frame version; video was marked stale.',
    payload: { assetId },
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

// ─── Split Shot ─────────────────────────────────────────────────────
// Moved from projects.ts — logically belongs with other shot-admin routes.

router.post('/:id/shots/:shotId/split', async (req, res) => {
  const shotId = paramStr(req.params.shotId);
  const shot: any = await selectOne('shots', { id: shotId });
  if (!shot) return res.status(404).json({ error: 'Shot not found' });

  const splitAt = req.body.splitAt || Math.floor(shot.duration / 2);
  const firstDuration = Math.max(1, splitAt);
  const secondDuration = Math.max(1, shot.duration - firstDuration);

  // Update original shot duration + mark stale (prompt was for old duration)
  await updateRows('shots', { id: shotId }, { duration: firstDuration, prompts_stale: true });

  // Bump sort_order of all shots after this one in the scene
  const laterShots = await getSB()
    .from(T.shots)
    .select('id, sort_order')
    .eq('scene_id', shot.scene_id)
    .gt('sort_order', shot.sort_order);
  for (const ls of (laterShots.data || [])) {
    await updateRows('shots', { id: ls.id }, { sort_order: ls.sort_order + 1 });
  }

  // Create new shot right after — empty prompt (artist writes new prompts), marked stale
  // direction copied from original — same creative beat, split in time
  const newId = uuidv4();
  await insertRow('shots', {
    id: newId,
    scene_id: shot.scene_id,
    direction: shot.direction || '',
    visual_prompt: '',
    motion_prompt: '',
    duration: secondDuration,
    cast_ids: shot.cast_ids || '[]',
    environment_id: shot.environment_id || null,
    continuity_from: 'cut',
    sort_order: shot.sort_order + 1,
    image_status: 'idle',
    video_status: 'idle',
    prompts_stale: true,
  });

  res.json(await getFullProject(paramStr(req.params.id)));
});

};
