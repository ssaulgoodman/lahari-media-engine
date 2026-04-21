/**
 * Renderer callback — receives the final render result from the
 * remotion-renderer service after it has uploaded the mp4 to Supabase.
 *
 * Mounted WITHOUT requireAuth because the caller is the renderer, not a
 * signed-in user. Auth is via the same shared secret used for the outbound
 * render call, in the `x-renderer-secret` header.
 *
 * URL is keyed by renderId (not projectId) so a stale callback from a
 * superseded render can't overwrite the current row. We still look up the
 * render row to resolve the project for finalizePublish.
 */
import { Router } from 'express';
import { selectOne, updateRows } from '../database.js';
import { finalizePublish } from './queue.js';

const router = Router();

const paramStr = (val: string | string[]): string =>
  Array.isArray(val) ? val[0] : val;

router.post('/callback/:renderId', async (req, res) => {
  const expected = process.env.RENDERER_SHARED_SECRET;
  if (!expected) return res.status(500).json({ error: 'RENDERER_SHARED_SECRET not configured' });
  if (req.header('x-renderer-secret') !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const renderId = paramStr(req.params.renderId);
  const render = await selectOne('renders', { id: renderId });
  if (!render) return res.status(404).json({ error: 'Render not found' });

  // Already finalized — treat as idempotent success so the renderer doesn't
  // retry. Covers duplicate callbacks from a flaky network or a renderer retry.
  if (render.status === 'completed' || render.status === 'failed') {
    return res.json({ ok: true, alreadyFinalized: true });
  }

  const { videoUrl, storagePath, renderMs, error } = req.body ?? {};

  try {
    if (error) {
      await updateRows('renders', { id: renderId }, {
        status: 'failed',
        error: String(error).slice(0, 2000),
        render_ms: typeof renderMs === 'number' ? renderMs : null,
        updated_at: new Date().toISOString(),
      });
      return res.json({ ok: true });
    }

    if (!videoUrl || !storagePath) {
      return res.status(400).json({ error: 'videoUrl and storagePath are required on success' });
    }

    await finalizePublish(render.project_id, storagePath, videoUrl);
    await updateRows('renders', { id: renderId }, {
      status: 'completed',
      video_url: videoUrl,
      storage_path: storagePath,
      render_ms: typeof renderMs === 'number' ? renderMs : null,
      updated_at: new Date().toISOString(),
    });

    res.json({ ok: true });
  } catch (err: any) {
    console.error(`[render-callback ${renderId}] failed:`, err);
    await updateRows('renders', { id: renderId }, {
      status: 'failed',
      error: (err?.message || 'callback failed').slice(0, 2000),
      updated_at: new Date().toISOString(),
    }).catch(() => {});
    res.status(500).json({ error: err?.message || 'callback failed' });
  }
});

export { router as renderCallbackRouter };
