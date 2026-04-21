/**
 * Render — kicks off an async render job against the remotion-renderer service.
 *
 * Each render is a row in lahari_renders (status: rendering|completed|failed).
 * We return a renderId immediately and hand it to the renderer so callbacks
 * can target the exact row — late callbacks from superseded jobs get logged
 * and ignored instead of clobbering fresh state.
 *
 * Why async: Railway's edge proxy kills in-flight HTTP requests after ~5 min,
 * but a real render can take 15+ min. Holding the connection synchronously
 * would always 504 even when the render succeeds.
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { insertRow, selectAll, selectOne } from '../database.js';

const router = Router();

const paramStr = (val: string | string[]): string =>
  Array.isArray(val) ? val[0] : val;

router.param('id', async (req, res, next, id) => {
  const projectId = Array.isArray(id) ? id[0] : id;
  const row = await selectOne('projects', { id: projectId });
  if (!row) return res.status(404).json({ error: 'Project not found' });
  if (row.user_id !== req.userId)
    return res.status(403).json({ error: 'Access denied' });
  (req as any).project = row;
  next();
});

router.post('/:id/render', async (req, res) => {
  const rendererUrl = process.env.REMOTION_RENDERER_URL;
  const rendererSecret = process.env.RENDERER_SHARED_SECRET;
  if (!rendererUrl || !rendererSecret) {
    return res.status(500).json({
      error:
        'REMOTION_RENDERER_URL and RENDERER_SHARED_SECRET must be configured on the server',
    });
  }

  const projectId = paramStr(req.params.id);
  const { timeline } = req.body ?? {};

  if (!timeline || typeof timeline !== 'object') {
    return res.status(400).json({ error: 'timeline is required' });
  }

  const renderId = uuidv4();
  await insertRow('renders', {
    id: renderId,
    project_id: projectId,
    status: 'rendering',
  });

  // Fire-and-forget. The renderer will call /api/renders/callback/:renderId
  // when it's done. `.catch` swallows the unhandled rejection; real failures
  // surface via the renderer's failure callback. If the renderer is completely
  // unreachable we'll never hear back and the render row stays 'rendering'
  // until someone retries (or a future stale-detection job flips it).
  fetch(`${rendererUrl.replace(/\/$/, '')}/render`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-renderer-secret': rendererSecret,
    },
    body: JSON.stringify({ renderId, projectId, timeline }),
  }).catch(async (err) => {
    console.error(`[render ${renderId}] upstream fetch threw:`, err?.message || err);
    const { updateRows } = await import('../database.js');
    await updateRows('renders', { id: renderId }, {
      status: 'failed',
      error: err?.message || 'renderer unreachable',
      updated_at: new Date().toISOString(),
    }).catch(() => {});
  });

  return res.status(202).json({ renderId, status: 'rendering' });
});

// Frontend polls this — returns the most recent render row for the project.
// Per-render polling would go through GET /api/renders/:renderId/status, but
// since the UI only ever shows one render at a time, latest-wins is fine.
router.get('/:id/render-status', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const rows = await selectAll('renders', { project_id: projectId }, {
    orderBy: 'created_at', ascending: false, limit: 1,
  });
  const latest = rows[0];
  if (!latest) {
    return res.json({ renderId: null, status: 'idle', videoUrl: null, error: null, renderMs: null });
  }
  return res.json({
    renderId: latest.id,
    status: latest.status,
    videoUrl: latest.video_url || null,
    error: latest.error || null,
    renderMs: latest.render_ms || null,
  });
});

export { router as renderRouter };
