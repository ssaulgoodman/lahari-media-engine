import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { unlink } from 'node:fs/promises';
import { renderTimeline } from './render';
import { uploadRender } from './storage';
import { shutdownPosthog, track, trackError } from './posthog';
import type { TimelineRenderProps } from './Video';

const app = new Hono();

app.use('*', logger());

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
  renderId?: string;
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

// POSTs the final result (or failure) back to the main backend. Retries with
// exponential backoff — if main is briefly down (deploy, network blip) we'd
// otherwise lose the render result forever. After all retries exhaust, we
// surface the failure in PostHog so it's visible in Error Tracking.
const CALLBACK_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

const postCallback = async (renderId: string, payload: Record<string, unknown>) => {
  const base = process.env.MAIN_BACKEND_URL;
  if (!base) {
    console.warn(`[render ${renderId}] MAIN_BACKEND_URL not set — skipping callback`);
    return;
  }
  if (!SHARED_SECRET) return;

  const url = `${base.replace(/\/$/, '')}/api/renders/callback/${renderId}`;
  const attempts = CALLBACK_RETRY_DELAYS_MS.length + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-renderer-secret': SHARED_SECRET,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) return;

      // 400/401/403 mean our request is truly wrong — retrying won't help.
      // Everything else (404, 408, 429, 5xx) could be a transient main-backend
      // issue (mid-deploy, route rollout race, timeout, rate-limit, crash) so
      // we retry.
      const body = await res.text().catch(() => '');
      lastError = new Error(`callback ${res.status}: ${body}`);
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        console.error(`[render ${renderId}] callback got non-retriable ${res.status}: ${body}`);
        break;
      }
      console.warn(`[render ${renderId}] callback attempt ${attempt}/${attempts} failed ${res.status}: ${body}`);
    } catch (err: any) {
      lastError = err;
      console.warn(`[render ${renderId}] callback attempt ${attempt}/${attempts} threw:`, err?.message || err);
    }

    const delay = CALLBACK_RETRY_DELAYS_MS[attempt - 1];
    if (delay) await new Promise((r) => setTimeout(r, delay));
  }

  console.error(`[render ${renderId}] callback exhausted ${attempts} attempts — result lost`);
  trackError(renderId, lastError ?? new Error('callback exhausted retries'), {
    renderId,
    stage: 'callback',
  });
};

// Fired on boot — confirms the main backend is reachable so deploys get a
// loud signal if MAIN_BACKEND_URL is misconfigured or main is down. Doesn't
// block startup: renders can still be attempted, and postCallback retries.
const pingMainBackend = async () => {
  const base = process.env.MAIN_BACKEND_URL;
  if (!base) {
    console.warn('[boot] MAIN_BACKEND_URL not set — callbacks will be skipped');
    return;
  }
  const url = `${base.replace(/\/$/, '')}/api/health`;
  try {
    const res = await fetch(url, { method: 'GET' });
    if (res.ok) console.log(`[boot] main backend reachable at ${base}`);
    else console.warn(`[boot] main backend health returned ${res.status} at ${url}`);
  } catch (err: any) {
    console.error(`[boot] main backend unreachable at ${url}:`, err?.message || err);
  }
};

// Performs the actual work. Runs after the HTTP response has been sent so
// the main backend doesn't hold a connection open for 15+ minutes.
const doRender = async (renderId: string, projectId: string, inputProps: TimelineRenderProps) => {
  const startedAt = Date.now();
  console.log(`[render] start render=${renderId} project=${projectId}`);
  let outputPath: string | undefined;
  try {
    const result = await renderTimeline(inputProps);
    outputPath = result.outputPath;

    const upload = await uploadRender(outputPath, projectId);
    const renderMs = Date.now() - startedAt;

    console.log(`[render] done render=${renderId} project=${projectId} ms=${renderMs} bytes=${upload.sizeBytes}`);
    track('render_completed', projectId, {
      renderId,
      renderMs,
      sizeBytes: upload.sizeBytes,
      durationInFrames: result.durationInFrames,
      width: result.width,
      height: result.height,
    });

    await postCallback(renderId, {
      videoUrl: upload.publicUrl,
      storagePath: upload.path,
      sizeBytes: upload.sizeBytes,
      durationInFrames: result.durationInFrames,
      width: result.width,
      height: result.height,
      renderMs,
    });
  } catch (e) {
    const message = (e as Error).message;
    console.error(`[render] failed render=${renderId} project=${projectId}`, message);
    trackError(projectId, e, { renderId, renderMs: Date.now() - startedAt });
    await postCallback(renderId, { error: message, renderMs: Date.now() - startedAt });
  } finally {
    if (outputPath) {
      unlink(outputPath).catch(() => {});
    }
  }
};

app.post('/render', async (c) => {
  let body: RenderRequestBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  if (!body.renderId) return c.json({ error: 'renderId is required' }, 400);
  if (!body.projectId) return c.json({ error: 'projectId is required' }, 400);

  let inputProps: TimelineRenderProps;
  try {
    inputProps = buildInputProps(body);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  // Respond 202 before starting the render so the caller's connection closes
  // immediately. The real result lands via postCallback when rendering finishes.
  void doRender(body.renderId, body.projectId, inputProps);
  return c.json({ accepted: true, renderId: body.renderId }, 202);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await shutdownPosthog();
    process.exit(0);
  });
}

const port = Number(process.env.PORT ?? 3030);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[remotion-renderer] listening on :${info.port}`);
  void pingMainBackend();
});
