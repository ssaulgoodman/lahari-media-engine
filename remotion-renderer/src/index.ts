import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { unlink } from 'node:fs/promises';
import { renderTimeline } from './render';
import { uploadRender } from './storage';
import type { TimelineRenderProps } from './Video';

const app = new Hono();

// Shared-secret guard. The main backend includes this header on every call;
// the renderer never trusts unsigned requests since rendering is expensive.
const SHARED_SECRET = process.env.RENDERER_SHARED_SECRET;
app.use('/render', async (c, next) => {
  if (!SHARED_SECRET) {
    return c.json({ error: 'RENDERER_SHARED_SECRET not configured' }, 500);
  }
  if (c.req.header('x-renderer-secret') !== SHARED_SECRET) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
});

app.get('/health', (c) => c.json({ ok: true }));

// Raw, untrusted JSON shape from the main backend. We narrow into
// TimelineRenderProps inside buildInputProps after validating each field.
// The project song rides along inside timeline.trackItemsMap as an audio
// item — no separate audioUrl field.
interface RenderRequestBody {
  projectId?: string;
  timeline?: Record<string, any>;
}

// Validates the minimum shape we need before kicking off a (very expensive)
// render. We don't try to deeply validate the timeline objects — Remotion will
// surface any structural mistakes during selectComposition/renderMedia.
const buildInputProps = (body: RenderRequestBody): TimelineRenderProps => {
  if (!body.timeline) throw new Error('timeline is required');
  const t = body.timeline;
  if (!Array.isArray(t.trackItemIds)) throw new Error('timeline.trackItemIds must be an array');
  if (!t.trackItemsMap || typeof t.trackItemsMap !== 'object') {
    throw new Error('timeline.trackItemsMap must be an object');
  }
  if (typeof t.fps !== 'number' || t.fps <= 0) throw new Error('timeline.fps must be > 0');
  if (!t.size || typeof t.size.width !== 'number' || typeof t.size.height !== 'number') {
    throw new Error('timeline.size.{width,height} must be numbers');
  }
  if (typeof t.durationMs !== 'number' || t.durationMs <= 0) {
    throw new Error('timeline.durationMs must be > 0');
  }

  return {
    trackItemIds: t.trackItemIds,
    trackItemsMap: t.trackItemsMap as TimelineRenderProps['trackItemsMap'],
    transitionsMap: (t.transitionsMap ?? {}) as TimelineRenderProps['transitionsMap'],
    fps: t.fps,
    size: t.size,
    durationMs: t.durationMs,
  };
};

app.post('/render', async (c) => {
  let body: RenderRequestBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  if (!body.projectId) return c.json({ error: 'projectId is required' }, 400);

  let inputProps: TimelineRenderProps;
  try {
    inputProps = buildInputProps(body);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  const startedAt = Date.now();
  let outputPath: string | undefined;
  try {
    const result = await renderTimeline(inputProps);
    outputPath = result.outputPath;

    const upload = await uploadRender(outputPath, body.projectId);

    return c.json({
      videoUrl: upload.publicUrl,
      storagePath: upload.path,
      sizeBytes: upload.sizeBytes,
      durationInFrames: result.durationInFrames,
      width: result.width,
      height: result.height,
      renderMs: Date.now() - startedAt,
    });
  } catch (e) {
    console.error('[render] failed', e);
    return c.json({ error: (e as Error).message }, 500);
  } finally {
    // Always remove the temp file — Supabase has the only copy we care about.
    if (outputPath) {
      unlink(outputPath).catch(() => {});
    }
  }
});

const port = Number(process.env.PORT ?? 3030);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[remotion-renderer] listening on :${info.port}`);
});
