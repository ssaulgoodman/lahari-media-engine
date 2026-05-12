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
import { recordDirectorEvent } from '../services/directorEvents.js';

const router = Router();

const paramStr = (val: string | string[]): string =>
  Array.isArray(val) ? val[0] : val;

const clampProgress = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
};

router.post('/progress/:renderId', async (req, res) => {
  const expected = process.env.RENDERER_SHARED_SECRET;
  if (!expected) return res.status(500).json({ error: 'RENDERER_SHARED_SECRET not configured' });
  if (req.header('x-renderer-secret') !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const renderId = paramStr(req.params.renderId);
  const render = await selectOne('renders', { id: renderId });
  if (!render) return res.status(404).json({ error: 'Render not found' });

  // Terminal rows are intentionally immutable from progress pings. This makes
  // watchdog failure authoritative even if a late renderer heartbeat arrives.
  if (render.status !== 'rendering') {
    return res.json({ ok: true, alreadyFinalized: true });
  }

  const progress = clampProgress(req.body?.progress);
  const stage = typeof req.body?.stage === 'string' ? req.body.stage.slice(0, 80) : 'rendering';

  await updateRows('renders', { id: renderId, status: 'rendering' }, {
    ...(progress !== null ? { progress } : {}),
    stage,
    last_heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return res.json({ ok: true });
});

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
      const errorMessage = String(error).slice(0, 2000);
      const errorCode = typeof req.body?.errorCode === 'string' ? req.body.errorCode.slice(0, 80) : 'renderer_failed';
      await updateRows('renders', { id: renderId }, {
        status: 'failed',
        error: errorMessage,
        error_code: errorCode,
        stage: 'failed',
        render_ms: typeof renderMs === 'number' ? renderMs : null,
        updated_at: new Date().toISOString(),
      });
      await recordDirectorEvent({
        projectId: render.project_id,
        source: 'system',
        eventType: 'render_failed',
        entityType: 'render',
        entityId: renderId,
        summary: 'Final render failed.',
        payload: { renderId, errorCode, error: errorMessage.slice(0, 500), renderMs: typeof renderMs === 'number' ? renderMs : null },
      });
      return res.json({ ok: true });
    }

    if (!videoUrl || !storagePath) {
      return res.status(400).json({ error: 'videoUrl and storagePath are required on success' });
    }

    await finalizePublish(render.project_id, storagePath, videoUrl);

    // Compare-and-swap: only flip to `completed` if the row is still `rendering`.
    // Without this guard, a late callback (whose finalizePublish is mid-flight
    // when the watchdog ticks at minute 65) would overwrite the watchdog's
    // `failed` write. The asset upload + queue/project completion from
    // finalizePublish are real either way; the render row just reflects the
    // watchdog's verdict instead of being silently rewritten.
    await updateRows('renders', { id: renderId, status: 'rendering' }, {
      status: 'completed',
      video_url: videoUrl,
      storage_path: storagePath,
      render_ms: typeof renderMs === 'number' ? renderMs : null,
      progress: 1,
      stage: 'completed',
      last_heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await recordDirectorEvent({
      projectId: render.project_id,
      source: 'system',
      eventType: 'render_completed',
      entityType: 'render',
      entityId: renderId,
      summary: 'Final render completed and was published back to the queue.',
      payload: {
        renderId,
        storagePath,
        renderMs: typeof renderMs === 'number' ? renderMs : null,
      },
    });

    // Surface the race if it bit us — finalizePublish already ran, so the
    // queue + assets row are good; only the render row says `failed`. Log so
    // we can spot it in dashboards.
    const recheck = await selectOne('renders', { id: renderId });
    if (recheck?.status === 'failed') {
      console.warn(
        `[render-callback ${renderId}] watchdog won race — render row stays "failed" but finalizePublish succeeded (queue + assets row are consistent).`,
      );
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error(`[render-callback ${renderId}] failed:`, err);
    await updateRows('renders', { id: renderId }, {
      status: 'failed',
      error: (err?.message || 'callback failed').slice(0, 2000),
      error_code: 'callback_failed',
      stage: 'failed',
      updated_at: new Date().toISOString(),
    }).catch(() => {});
    await recordDirectorEvent({
      projectId: render.project_id,
      source: 'system',
      eventType: 'render_failed',
      entityType: 'render',
      entityId: renderId,
      summary: 'Render callback failed while finalizing.',
      payload: { renderId, errorCode: 'callback_failed', error: String(err?.message || 'callback failed').slice(0, 500) },
    });
    res.status(500).json({ error: err?.message || 'callback failed' });
  }
});

export { router as renderCallbackRouter };
