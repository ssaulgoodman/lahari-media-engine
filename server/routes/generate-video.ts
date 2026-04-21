/**
 * Video generation routes — extracted from generate.ts.
 * Handles: generate-video, revert-video, chained-shot refresh.
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { selectOne, selectAll, insertRow, updateRows, findShot, incrementColumn } from '../database.js';
import { readAsBase64, mimeFromExt, storageUrl } from '../storage.js';
import { generateSegmindVideo, SEGMIND_MODELS, SegmindModelKey } from '../services/segmind.js';
import { extractLastFrame } from '../services/ffmpeg.js';
import { refreshChainedShotPrompt } from '../services/claude.js';
import { getFullProject } from './projects.js';
import { logCall, buildContextChain } from '../xray.js';

const paramStr = (val: string | string[]): string => Array.isArray(val) ? val[0] : val;

/**
 * Mount video generation routes onto the given router.
 * Called from generate.ts — shares the same router instance so param
 * validators (id, shotId, sceneId) and scope helpers are inherited.
 */
export const mountVideoRoutes = (router: Router) => {

  // ─── Revert Video ──────────────────────────────────────────────────

  router.post('/:id/shots/:shotId/revert-video', async (req, res) => {
    const shotId = paramStr(req.params.shotId);
    const { assetId } = req.body || {};
    if (!assetId) return res.status(400).json({ error: 'assetId required' });
    const shot = await selectOne('shots', { id: shotId });
    if (!shot) return res.status(404).json({ error: 'Shot not found' });

    const asset = await selectOne('assets', { id: assetId });
    if (!asset || asset.shot_id !== shotId || asset.category !== 'shot_video') {
      return res.status(400).json({ error: 'Invalid video asset' });
    }

    // Restore paired extracted-frame pointer from the video asset's metadata
    let framePair: string | null = null;
    if (asset.metadata) {
      try { framePair = JSON.parse(asset.metadata).extracted_last_frame_asset_id || null; } catch {}
    }

    await updateRows('shots', { id: shotId }, {
      video_asset_id: asset.id,
      extracted_last_frame_asset_id: framePair,
      video_status: 'success', last_error: null,
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
      const motionDesc = shot.motion_prompt || 'Cinematic camera movement';
      const castNames = activeCast.map((c: any) => c.name).join(', ');
      const mood = concept.mood || 'Cinematic';

      const veoPromptParts = [motionDesc];
      if (shot.visual_prompt) {
        const visualBrief = shot.visual_prompt.length > 150
          ? shot.visual_prompt.substring(0, 150) + '...'
          : shot.visual_prompt;
        veoPromptParts.push(visualBrief);
      }
      if (castNames) veoPromptParts.push(`Characters: ${castNames}`);
      veoPromptParts.push(`${mood} mood`);

      const refNotes: string[] = [];
      activeCast.forEach((c: any) => {
        if (c.reference_asset_id) refNotes.push(`Reference image: ${c.name} (character — match their appearance)`);
      });
      if (shot.environment_id) {
        const env = await selectOne('environments', { id: shot.environment_id });
        if (env?.reference_asset_id) refNotes.push(`Reference image: ${env.name} (environment — match this setting)`);
      }
      if (refNotes.length) veoPromptParts.push(refNotes.join('. '));
      if (shot.continuity_from === 'prev_shot' && shot.continuity_description) {
        veoPromptParts.push(`Starting state (from previous shot): ${shot.continuity_description}`);
      }

      const veoPrompt = promptOverride?.trim() ? promptOverride.trim() : veoPromptParts.join('. ');

      const videoModelKey = (project.video_model || 'veo-3.1-fast') as SegmindModelKey;
      const modelSpec = SEGMIND_MODELS[videoModelKey] || SEGMIND_MODELS['veo-3.1-fast'];

      console.log(`  [shot ${shot.id} video] model=${videoModelKey} | ${veoPrompt.substring(0, 100)}...`);

      const aspect = (project.aspect_ratio === '9:16' ? '9:16' : '16:9') as '16:9' | '9:16';
      const resolution = (project.video_resolution === '1080p' ? '1080p' : '720p') as '720p' | '1080p';

      // Collect reference images — frontend-controlled or legacy auto
      const videoFrontendRefs: any[] | undefined = req.body?.refs;
      const referenceImagePaths: string[] = [];
      const resolveVideoAsset = async (id: string) => { const a = await selectOne('assets', { id }); return a?.file_path; };

      if (videoFrontendRefs) {
        const allCast = await selectAll('cast_members', { project_id: paramStr(req.params.id) });
        const allEnvs = await selectAll('environments', { project_id: paramStr(req.params.id) });
        for (const ref of videoFrontendRefs) {
          if (referenceImagePaths.length >= 9) break;
          if (ref.type === 'cast' && ref.id) {
            const c = allCast.find((m: any) => m.id === ref.id);
            if (c?.reference_asset_id) { const p = await resolveVideoAsset(c.reference_asset_id); if (p) referenceImagePaths.push(p); }
          } else if (ref.type === 'env' && ref.id) {
            const e = allEnvs.find((en: any) => en.id === ref.id);
            if (e?.reference_asset_id) { const p = await resolveVideoAsset(e.reference_asset_id); if (p) referenceImagePaths.push(p); }
          } else if (ref.type === 'uploaded' && ref.id) {
            const p = await resolveVideoAsset(ref.id); if (p) referenceImagePaths.push(p);
          }
        }
      } else {
        for (const c of activeCast) {
          if (c.reference_asset_id && referenceImagePaths.length < 9) {
            const refAsset = await selectOne('assets', { id: c.reference_asset_id });
            if (refAsset) referenceImagePaths.push(refAsset.file_path);
          }
        }
        if (shot.environment_id && referenceImagePaths.length < 9) {
          const env = await selectOne('environments', { id: shot.environment_id });
          if (env?.reference_asset_id) {
            const envAsset = await selectOne('assets', { id: env.reference_asset_id });
            if (envAsset) referenceImagePaths.push(envAsset.file_path);
          }
        }
        const shotRefAssets = await selectAll('assets', { shot_id: shot.id, category: 'shot_ref' });
        for (const sra of shotRefAssets) {
          if (referenceImagePaths.length < 9) referenceImagePaths.push(sra.file_path);
        }
      }

      // End frame for reverse-chain (if the model supports it)
      let endImagePath: string | undefined;
      if (shot.end_image_asset_id && modelSpec.supportsLastFrame) {
        const endAsset = await selectOne('assets', { id: shot.end_image_asset_id });
        if (endAsset) endImagePath = endAsset.file_path;
      }

      const result = await generateSegmindVideo(imageAsset.file_path, veoPrompt, {
        endImagePath,
        referenceImagePaths: modelSpec.supportsRefs ? referenceImagePaths : undefined,
        aspectRatio: aspect,
        resolution,
        durationSec: shot.duration,
        modelKey: videoModelKey in SEGMIND_MODELS ? videoModelKey : 'veo-3.1-fast',
      });
      let videoPath = result.videoPath;
      let costEstimate = modelSpec.costPerSec * result.durationSec;
      let modelId = result.modelId;

      const durationMs = Date.now() - t0;

      const assetId = uuidv4();

      // Extract the actual last frame from the generated video
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

      const videoMetadata = JSON.stringify({ extracted_last_frame_asset_id: extractedAssetId });
      await insertRow('assets', { id: assetId, project_id: project.id, shot_id: shot.id, category: 'shot_video', file_path: videoPath, metadata: videoMetadata });

      // Only clear last_error if no other operation is in error state
      const shotNow = await selectOne('shots', { id: shot.id });
      const clearVideoError = shotNow?.image_status !== 'error' && shotNow?.end_image_status !== 'error';
      await updateRows('shots', { id: shot.id }, {
        video_asset_id: assetId,
        video_status: 'success',
        ...(clearVideoError ? { last_error: null } : {}),
        extracted_last_frame_asset_id: extractedAssetId,
      });

      // Chain refresh — if the NEXT shot is tagged `prev_shot`, rewrite its prompts
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
            await updateRows('shots', { id: nextShot.id }, {
              visual_prompt: refreshed.visualPrompt,
              motion_prompt: refreshed.motionPrompt,
              refined_from_prev_frame: 1,
              continuity_description: null,
              prompts_stale: false,
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
        responseSummary: `Video generated via Segmind (${modelId}): ${videoPath}${extractedAssetId ? ' (last frame extracted)' : ''}`,
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
      await updateRows('shots', { id: shot.id }, { video_status: 'error', last_error: err.message?.slice(0, 500) || 'Unknown error' });
      res.status((err as any).statusCode || 500).json({ error: err.message });
    }
  });

};
