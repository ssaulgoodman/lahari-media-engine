/**
 * Video generation routes — extracted from generate.ts.
 * Handles: generate-video, revert-video.
 */
import { Router } from 'express';
import { selectOne, updateRows } from '../database.js';
import { generateShotVideo } from '../services/videoGeneration.js';
import { eventResultPointers, recordDirectorEvent } from '../services/directorEvents.js';
import { getFullProject } from './projects.js';
import { paramStr } from './scope-helpers.js';

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

    // Restore paired extracted-frame pointer from the video asset's metadata.
    let framePair: string | null = null;
    if (asset.metadata) {
      try { framePair = JSON.parse(asset.metadata).extracted_last_frame_asset_id || null; } catch {}
    }

    await updateRows('shots', { id: shotId }, {
      video_asset_id: asset.id,
      extracted_last_frame_asset_id: framePair,
      video_status: 'success', last_error: null,
    });
    await recordDirectorEvent({
      projectId: paramStr(req.params.id),
      userId: req.userId,
      source: 'web',
      eventType: 'shot_video_reverted',
      entityType: 'shot',
      entityId: shotId,
      summary: 'Artist restored a previous video version.',
      payload: { assetId, extractedLastFrameAssetId: framePair },
    });

    res.json(await getFullProject(paramStr(req.params.id)));
  });

  // ─── Generate Shot Video ────────────────────────────────────────────

  router.post('/:id/shots/:shotId/generate-video', async (req, res) => {
    try {
      const projectId = paramStr(req.params.id);
      const shotId = paramStr(req.params.shotId);
      const result = await generateShotVideo(projectId, shotId, {
        promptOverride: req.body?.promptOverride,
        refs: req.body?.refs,
      });
      await recordDirectorEvent({
        projectId,
        userId: req.userId,
        source: 'web',
        eventType: 'video_generated',
        entityType: 'shot',
        entityId: shotId,
        summary: 'Artist generated a shot video in the web studio.',
        payload: {
          promptOverride: req.body?.promptOverride || null,
          refs: req.body?.refs || null,
          result: eventResultPointers(result),
        },
      });
      res.json(await getFullProject(projectId));
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

};
