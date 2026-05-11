import { getSB, T } from './database.js';

const DEFAULT_MAX_RENDER_MINUTES = 65;
const DEFAULT_MAX_PENDING_FINALIZE_MINUTES = 15;
const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;

const maxRenderMinutes = () => {
  const parsed = Number(process.env.MAX_RENDER_MINUTES || DEFAULT_MAX_RENDER_MINUTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RENDER_MINUTES;
};

const maxPendingFinalizeMinutes = () => {
  const parsed = Number(process.env.MAX_PENDING_FINALIZE_MINUTES || DEFAULT_MAX_PENDING_FINALIZE_MINUTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PENDING_FINALIZE_MINUTES;
};

export const runRenderWatchdogOnce = async (): Promise<number> => {
  const now = new Date().toISOString();
  const renderCutoff = new Date(Date.now() - maxRenderMinutes() * 60 * 1000).toISOString();
  const pendingCutoff = new Date(Date.now() - maxPendingFinalizeMinutes() * 60 * 1000).toISOString();
  const renderMessage = `watchdog: exceeded max render time (${maxRenderMinutes()} min)`;
  const pendingMessage = `watchdog: exceeded pending finalize time (${maxPendingFinalizeMinutes()} min)`;

  const { data: renderRows, error: renderError } = await getSB()
    .from(T.renders)
    .update({
      status: 'failed',
      error: renderMessage,
      error_code: 'watchdog_timeout',
      stage: 'failed',
      updated_at: now,
    })
    .eq('status', 'rendering')
    .lt('created_at', renderCutoff)
    .select('id');
  if (renderError) throw new Error(`render watchdog failed: ${renderError.message}`);

  const { data: pendingRows, error: pendingError } = await getSB()
    .from(T.renders)
    .update({
      status: 'failed',
      error: pendingMessage,
      error_code: 'pending_finalize_timeout',
      stage: 'failed',
      updated_at: now,
    })
    .eq('status', 'pending_finalize')
    .lt('updated_at', pendingCutoff)
    .select('id');
  if (pendingError) throw new Error(`render pending-finalize watchdog failed: ${pendingError.message}`);

  return (renderRows?.length || 0) + (pendingRows?.length || 0);
};

export const startRenderWatchdog = () => {
  const tick = async () => {
    try {
      const count = await runRenderWatchdogOnce();
      if (count > 0) console.warn(`[render-watchdog] marked ${count} stale render(s) failed`);
    } catch (err: any) {
      console.error('[render-watchdog]', err?.message || err);
    }
  };

  const timer = setInterval(tick, DEFAULT_INTERVAL_MS);
  timer.unref?.();
  setTimeout(tick, 30_000).unref?.();
};
