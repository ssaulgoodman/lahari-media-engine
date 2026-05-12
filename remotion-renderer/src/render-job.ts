import { stat, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { stageTimelineAssets } from './asset-staging';
import { canRenderWithFfmpeg, renderTimelineWithFfmpeg } from './ffmpeg-render';
import { shutdownPosthog, track, trackError } from './posthog';
import { renderTimeline } from './render';
import { projectExists, uploadRender, writeTerminalFallback } from './storage';
import type { TimelineRenderProps } from './Video';

// Raw, untrusted JSON shape from the caller (HTTP body on CapRover, stdin on
// Modal/RunPod). We narrow into TimelineRenderProps inside buildInputProps
// after validating each field. The project song rides along inside
// timeline.trackItemsMap as an audio item — no separate audioUrl field.
export interface RenderRequestBody {
  renderId?: string;
  projectId?: string;
  timeline?: Record<string, any>;
}

// Validates the minimum shape we need before kicking off a (very expensive)
// render. We don't deeply validate the timeline objects — Remotion will
// surface structural mistakes during selectComposition/renderMedia.
export const buildInputProps = (body: RenderRequestBody): TimelineRenderProps => {
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
const CALLBACK_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000, 45000, 60000, 60000, 60000];
const renderHardCapMinutes = () => {
  const parsed = Number(process.env.RENDER_HARD_CAP_MINUTES || 50);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
};

const renderEngine = () => {
  const engine = (process.env.RENDER_ENGINE || 'ffmpeg').toLowerCase();
  return engine === 'remotion' ? 'remotion' : 'ffmpeg';
};

const withJitter = (ms: number) => {
  const jitter = Math.round(ms * 0.2 * Math.random());
  return ms + jitter;
};

const persistTerminalFallback = async (
  renderId: string,
  payload: Record<string, unknown>,
) => {
  try {
    await writeTerminalFallback(renderId, payload);
    console.error(`[render ${renderId}] wrote terminal fallback to Supabase`);
  } catch (err: any) {
    console.error(`[render ${renderId}] terminal fallback failed:`, err?.message || err);
    trackError(renderId, err, { renderId, stage: 'terminal_fallback' });
  }
};

const postCallback = async (renderId: string, payload: Record<string, unknown>): Promise<boolean> => {
  const base = process.env.MAIN_BACKEND_URL;
  const sharedSecret = process.env.RENDERER_SHARED_SECRET;
  if (!base) {
    console.warn(`[render ${renderId}] MAIN_BACKEND_URL not set — skipping callback`);
    await persistTerminalFallback(renderId, payload);
    return false;
  }
  if (!sharedSecret) {
    await persistTerminalFallback(renderId, payload);
    return false;
  }

  const url = `${base.replace(/\/$/, '')}/api/renders/callback/${renderId}`;
  const attempts = CALLBACK_RETRY_DELAYS_MS.length + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-renderer-secret': sharedSecret,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return true;

      // 400/401/403 mean our request is truly wrong — retrying won't help.
      // Everything else (404, 408, 429, 5xx) could be a transient main-backend
      // issue (mid-deploy, route rollout race, timeout, rate-limit, crash) so
      // we retry.
      const body = await res.text().catch(() => '');
      lastError = new Error(`callback ${res.status}: ${body}`);
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
        console.error(`[render ${renderId}] callback got non-retriable ${res.status}: ${body}`);
        break;
      }
      console.warn(`[render ${renderId}] callback attempt ${attempt}/${attempts} failed ${res.status}: ${body}`);
    } catch (err: any) {
      lastError = err;
      console.warn(`[render ${renderId}] callback attempt ${attempt}/${attempts} threw:`, err?.message || err);
    }

    const delay = CALLBACK_RETRY_DELAYS_MS[attempt - 1];
    if (delay) await new Promise((r) => setTimeout(r, withJitter(delay)));
  }

  console.error(`[render ${renderId}] callback exhausted ${attempts} attempts — writing terminal fallback`);
  trackError(renderId, lastError ?? new Error('callback exhausted retries'), {
    renderId,
    stage: 'callback',
  });
  await persistTerminalFallback(renderId, payload);
  return false;
};

const postProgress = async (
  renderId: string,
  payload: { stage: string; progress?: number },
) => {
  const base = process.env.MAIN_BACKEND_URL;
  const sharedSecret = process.env.RENDERER_SHARED_SECRET;
  if (!base || !sharedSecret) return;

  try {
    await fetch(`${base.replace(/\/$/, '')}/api/renders/progress/${renderId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-renderer-secret': sharedSecret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err: any) {
    console.warn(`[render ${renderId}] progress callback failed:`, err?.message || err);
  }
};

type RenderErrorCode =
  | 'bundle_failed'
  | 'chromium_oom'
  | 'asset_404'
  | 'project_deleted'
  | 'supabase_5xx'
  | 'timeout'
  | 'empty_output'
  | 'renderer_failed';

const classifyRenderError = (err: unknown): RenderErrorCode => {
  const message = err instanceof Error ? err.message : String(err || '');
  const text = message.toLowerCase();

  if (text.includes('empty render output')) return 'empty_output';
  if (text.includes('project not found before render')) return 'project_deleted';
  if (text.includes('out of memory') || /\boom\b/.test(text) || text.includes('memory limit')) {
    return 'chromium_oom';
  }
  if (
    (text.includes('404') || text.includes('not found')) &&
    (text.includes('asset') || text.includes('media') || text.includes('video') || text.includes('image') || text.includes('fetch'))
  ) {
    return 'asset_404';
  }
  if (
    text.includes('asset fetch failed') &&
    (text.includes('500') || text.includes('502') || text.includes('503') || text.includes('504'))
  ) {
    return 'supabase_5xx';
  }
  if (
    (text.includes('supabase') || text.includes('storage')) &&
    (text.includes('500') || text.includes('502') || text.includes('503') || text.includes('504') || text.includes('5xx'))
  ) {
    return 'supabase_5xx';
  }
  if (text.includes('timeout') || text.includes('timed out') || text.includes('deadline')) return 'timeout';
  if (text.includes('bundle') || text.includes('webpack') || text.includes('esbuild')) return 'bundle_failed';

  return 'renderer_failed';
};

const withHardCap = async <T,>(promise: Promise<T>): Promise<T> => {
  const minutes = renderHardCapMinutes();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`render timeout: exceeded ${minutes} min hard cap`));
    }, minutes * 60 * 1000);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export interface RunRenderJobArgs {
  renderId: string;
  projectId: string;
  inputProps: TimelineRenderProps;
}

export interface RunRenderJobResult {
  ok: boolean;
  videoUrl?: string;
  storagePath?: string;
  sizeBytes?: number;
  durationInFrames?: number;
  width?: number;
  height?: number;
  renderMs: number;
  error?: string;
}

// Performs the render end-to-end: renderTimeline → uploadRender → postCallback
// (plus PostHog tracking). Never throws — failure is reported via the callback
// and returned to the caller. Safe to invoke fire-and-forget from the Hono
// handler; safe to await from a subprocess CLI that wants the final result.
export const runRenderJob = async ({
  renderId,
  projectId,
  inputProps,
}: RunRenderJobArgs): Promise<RunRenderJobResult> => {
  const startedAt = Date.now();
  console.log(`[render] start render=${renderId} project=${projectId}`);
  let outputPath: string | undefined;
  let cleanupStagedAssets: (() => Promise<void>) | undefined;
  let lastProgressPostAt = 0;
  let lastProgress = 0;
  let lastStage = 'starting';
  const reportProgress = async (stage: string, progress?: number, force = false) => {
    const now = Date.now();
    const clamped = typeof progress === 'number' ? Math.max(0, Math.min(1, progress)) : undefined;
    if (
      !force &&
      clamped !== undefined &&
      now - lastProgressPostAt < 3000 &&
      Math.abs(clamped - lastProgress) < 0.03
    ) {
      return;
    }
    lastProgressPostAt = now;
    lastStage = stage;
    if (clamped !== undefined) lastProgress = clamped;
    await postProgress(renderId, { stage, ...(clamped !== undefined ? { progress: clamped } : {}) });
  };
  const heartbeat = setInterval(() => {
    void postProgress(renderId, {
      stage: lastStage,
      progress: lastProgress,
    });
  }, 30000);
  heartbeat.unref?.();

  try {
    const exists = await projectExists(projectId);
    if (!exists) {
      throw new Error(`project not found before render: ${projectId}`);
    }
    const stagedAssets = await stageTimelineAssets(inputProps, renderId, reportProgress);
    cleanupStagedAssets = stagedAssets.cleanup;
    if (stagedAssets.count > 0) {
      track('render_assets_staged', projectId, {
        renderId,
        count: stagedAssets.count,
        bytes: stagedAssets.bytes,
        stagingMs: stagedAssets.stagingMs,
      });
    } else {
      await reportProgress('bundling', 0.04, true);
    }

    const ffmpegEligibility = canRenderWithFfmpeg(stagedAssets.inputProps);
    const useFfmpeg = renderEngine() === 'ffmpeg' && ffmpegEligibility.ok;
    if (renderEngine() === 'ffmpeg' && !ffmpegEligibility.ok) {
      console.log(`[render ${renderId}] falling back to Remotion: ${ffmpegEligibility.reason}`);
      track('render_engine_fallback', projectId, {
        renderId,
        requestedEngine: 'ffmpeg',
        fallbackEngine: 'remotion',
        reason: ffmpegEligibility.reason,
      });
    }

    await reportProgress(useFfmpeg ? 'ffmpeg_rendering' : 'rendering_frames', 0.08, true);
    const engine = useFfmpeg ? 'ffmpeg' : 'remotion';
    const result = await withHardCap(
      useFfmpeg
        ? renderTimelineWithFfmpeg(stagedAssets.inputProps, (progress) => {
            void reportProgress('ffmpeg_rendering', 0.08 + progress * 0.79);
          })
        : renderTimeline(stagedAssets.inputProps, (progress) => {
            void reportProgress('rendering_frames', 0.08 + progress * 0.79);
          }),
    );
    outputPath = result.outputPath;

    await reportProgress('validating_output', 0.9, true);
    const outputStat = await stat(outputPath);
    if (outputStat.size < 1024) {
      throw new Error(`empty render output: ${outputStat.size} bytes`);
    }
    if (!result.durationInFrames || result.durationInFrames <= 0) {
      throw new Error(`empty render output: ${result.durationInFrames} frames`);
    }

    await reportProgress('uploading', 0.94, true);
    const upload = await uploadRender(outputPath, projectId);
    const renderMs = Date.now() - startedAt;

    console.log(
      `[render] done render=${renderId} project=${projectId} ms=${renderMs} bytes=${upload.sizeBytes}`,
    );
    track('render_completed', projectId, {
      renderId,
      engine,
      renderMs,
      sizeBytes: upload.sizeBytes,
      durationInFrames: result.durationInFrames,
      width: result.width,
      height: result.height,
    });

    const payload = {
      videoUrl: upload.publicUrl,
      storagePath: upload.path,
      sizeBytes: upload.sizeBytes,
      durationInFrames: result.durationInFrames,
      width: result.width,
      height: result.height,
      renderMs,
    };
    await reportProgress('finalizing', 0.98, true);
    await postCallback(renderId, payload);
    return { ok: true, ...payload };
  } catch (e) {
    const message = (e as Error).message;
    const errorCode = classifyRenderError(e);
    const renderMs = Date.now() - startedAt;
    console.error(`[render] failed render=${renderId} project=${projectId}`, message);
    trackError(projectId, e, { renderId, renderMs, errorCode });
    await postCallback(renderId, { error: message, errorCode, renderMs });
    return { ok: false, error: message, renderMs };
  } finally {
    clearInterval(heartbeat);
    if (cleanupStagedAssets) {
      await cleanupStagedAssets().catch((err: any) => {
        console.warn(`[render ${renderId}] staged asset cleanup failed:`, err?.message || err);
      });
    }
    if (outputPath) {
      unlink(outputPath).catch(() => {});
    }
  }
};

// ---------------------------------------------------------------------------
// CLI entrypoint — Modal and RunPod handlers shell into this, piping a single
// JSON object on stdin. Example:
//   echo '{"renderId":"...","projectId":"...","timeline":{...}}' | tsx render-job.ts
// Emits the final RunRenderJobResult as a single JSON line on stdout and exits
// 0 (success or handled failure) / 1 (unexpected crash). postCallback fires
// the same way it does in the Hono path, so downstream state machines are
// unchanged regardless of which host invoked the job.
// ---------------------------------------------------------------------------

const readAllStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

const cliMain = async (): Promise<void> => {
  let body: RenderRequestBody;
  try {
    const raw = await readAllStdin();
    if (!raw.trim()) throw new Error('stdin was empty — expected JSON {renderId, projectId, timeline}');
    body = JSON.parse(raw) as RenderRequestBody;
  } catch (e) {
    console.error('[render-job] failed to read/parse stdin:', (e as Error).message);
    process.exit(1);
  }

  if (!body.renderId || !body.projectId) {
    console.error('[render-job] renderId and projectId are required');
    process.exit(1);
  }

  let inputProps: TimelineRenderProps;
  try {
    inputProps = buildInputProps(body);
  } catch (e) {
    console.error('[render-job] invalid timeline:', (e as Error).message);
    process.exit(1);
  }

  const result = await runRenderJob({
    renderId: body.renderId,
    projectId: body.projectId,
    inputProps,
  });

  // Single JSON line on stdout so Modal/RunPod handlers can parse it with
  // JSON.loads without dealing with log noise.
  process.stdout.write(JSON.stringify(result) + '\n');
  await shutdownPosthog();
  // Exit code mirrors reality so Modal/RunPod dashboards show the render's
  // real status. Main backend already has the authoritative result via
  // postCallback, so this is purely for host-side visibility.
  process.exit(result.ok ? 0 : 1);
};

// Run cliMain only when this file is the Node entrypoint, not when index.ts
// imports runRenderJob/buildInputProps as a library.
const isEntrypoint = () => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
};

if (isEntrypoint()) {
  void cliMain();
}
