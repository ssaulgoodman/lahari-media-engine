/**
 * Render — proxies timeline state to the remotion-renderer service.
 *
 * The frontend posts the render-authoritative subset of the timeline editor's
 * zustand store here. The editor owns an audio track now (the project song
 * rides inside trackItemsMap as an audio item), so this endpoint is a thin
 * authorization+forward shim. Ownership, auth, and queue writeback stay on the
 * main backend; the renderer is a pure compute service.
 */
import { Router } from 'express';
import { selectOne } from '../database.js';

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

  try {
    const t0 = Date.now();
    const upstream = await fetch(`${rendererUrl.replace(/\/$/, '')}/render`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-renderer-secret': rendererSecret,
      },
      body: JSON.stringify({ projectId, timeline }),
    });

    const body = await upstream.json().catch(() => ({ error: upstream.statusText }));
    if (!upstream.ok) {
      return res
        .status(upstream.status === 401 ? 502 : upstream.status)
        .json({ error: body.error || `renderer failed: ${upstream.status}` });
    }

    return res.json({ ...body, proxyMs: Date.now() - t0 });
  } catch (err: any) {
    console.error(`[render ${projectId}] proxy failed:`, err);
    return res.status(502).json({ error: err?.message || 'renderer unreachable' });
  }
});

export { router as renderRouter };
