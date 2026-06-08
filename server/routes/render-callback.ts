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
import { getSB, selectOne, T, updateRows } from '../database.js';
import { finalizePublish } from './queue.js';
import { recordDirectorEvent } from '../services/directorEvents.js';

const router = Router();

const paramStr = (val: string | string[]): string =>
  Array.isArray(val) ? val[0] : val;

const compactRendererError = (error: unknown) => {
  const text = String(error || 'renderer failed');
  if (text.length <= 2000) return text;
  return `${text.slice(0, 500)}\n... renderer error truncated; preserving tail ...\n${text.slice(-1400)}`;
};

const clampProgress = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
};

const isTerminalRenderStatus = (status: string | null | undefined) =>
  status === 'completed' || status === 'failed' || status === 'cancelled';

const updateRenderIfStatus = async (
  renderId: string,
  statuses: string[],
  updates: Record<string, any>,
): Promise<boolean> => {
  const { data, error } = await getSB()
    .from(T.renders)
    .update(updates)
    .eq('id', renderId)
    .in('status', statuses)
    .select('id');
  if (error) throw new Error(`DB update renders: ${error.message}`);
  return (data?.length || 0) > 0;
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
  const renderEngine = typeof req.body?.renderEngine === 'string' ? req.body.renderEngine.slice(0, 40) : null;
  const ffmpegFallbackReason = typeof req.body?.ffmpegFallbackReason === 'string'
    ? req.body.ffmpegFallbackReason.slice(0, 500)
    : null;

  await updateRows('renders', { id: renderId, status: 'rendering' }, {
    ...(progress !== null ? { progress } : {}),
    stage,
    ...(renderEngine ? { render_engine: renderEngine } : {}),
    ...(ffmpegFallbackReason ? { ffmpeg_fallback_reason: ffmpegFallbackReason } : {}),
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
  if (isTerminalRenderStatus(render.status)) {
    return res.json({ ok: true, alreadyFinalized: true });
  }

  const { videoUrl, storagePath, renderMs, error } = req.body ?? {};
  const renderEngine = typeof req.body?.renderEngine === 'string' ? req.body.renderEngine.slice(0, 40) : null;
  const ffmpegFallbackReason = typeof req.body?.ffmpegFallbackReason === 'string'
    ? req.body.ffmpegFallbackReason.slice(0, 500)
    : null;

  try {
    if (error) {
      const errorMessage = String(error).slice(0, 2000);
      const errorCode = typeof req.body?.errorCode === 'string' ? req.body.errorCode.slice(0, 80) : 'renderer_failed';
      const updated = await updateRenderIfStatus(renderId, ['rendering'], {
        status: 'failed',
        error: compactRendererError(error),
        error_code: errorCode,
        stage: 'failed',
        render_ms: typeof renderMs === 'number' ? renderMs : null,
        ...(renderEngine ? { render_engine: renderEngine } : {}),
        ...(ffmpegFallbackReason ? { ffmpeg_fallback_reason: ffmpegFallbackReason } : {}),
        updated_at: new Date().toISOString(),
      });
      if (updated) {
        await recordDirectorEvent({
          projectId: render.project_id,
          source: 'system',
          eventType: 'render_failed',
          entityType: 'render',
          entityId: renderId,
          summary: 'Final render failed.',
          payload: { renderId, errorCode, error: errorMessage.slice(0, 500), renderMs: typeof renderMs === 'number' ? renderMs : null },
        });
      }
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
      ...(renderEngine ? { render_engine: renderEngine } : {}),
      ...(ffmpegFallbackReason ? { ffmpeg_fallback_reason: ffmpegFallbackReason } : {}),
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
    if (recheck?.status === 'failed' || recheck?.status === 'cancelled') {
      console.warn(
        `[render-callback ${renderId}] ${recheck.status} row won race — render row stays "${recheck.status}" but finalizePublish succeeded (queue + assets row are consistent).`,
      );
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error(`[render-callback ${renderId}] failed:`, err);
    const updated = await updateRenderIfStatus(renderId, ['rendering', 'pending_finalize'], {
      status: 'failed',
      error: (err?.message || 'callback failed').slice(0, 2000),
      error_code: 'callback_failed',
      stage: 'failed',
      updated_at: new Date().toISOString(),
    }).catch(() => {});
    if (updated) {
      await recordDirectorEvent({
        projectId: render.project_id,
        source: 'system',
        eventType: 'render_failed',
        entityType: 'render',
        entityId: renderId,
        summary: 'Render callback failed while finalizing.',
        payload: { renderId, errorCode: 'callback_failed', error: String(err?.message || 'callback failed').slice(0, 500) },
      });
    }
    res.status(500).json({ error: err?.message || 'callback failed' });
  }
});

export { router as renderCallbackRouter };
