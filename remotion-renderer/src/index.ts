import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { shutdownPosthog } from './posthog';
import { buildInputProps, runRenderJob, type RenderRequestBody } from './render-job';
import { runBootBenchmark } from './benchmark';
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
  void runRenderJob({ renderId: body.renderId, projectId: body.projectId, inputProps });
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
  // Gated so local `npm run dev` doesn't pay the ~15s bundle cost every restart.
  // Dockerfile sets this in its ENV block for prod containers.
  if (process.env.RUN_BOOT_BENCHMARK === '1') void runBootBenchmark();
});
