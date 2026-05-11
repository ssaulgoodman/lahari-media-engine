import { getSB, T } from './database.js';

const DEFAULT_MAX_RENDER_MINUTES = 65;
const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;

const maxRenderMinutes = () => {
  const parsed = Number(process.env.MAX_RENDER_MINUTES || DEFAULT_MAX_RENDER_MINUTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RENDER_MINUTES;
};

export const runRenderWatchdogOnce = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - maxRenderMinutes() * 60 * 1000).toISOString();
  const message = `watchdog: exceeded max render time (${maxRenderMinutes()} min)`;

  const { data, error } = await getSB()
    .from(T.renders)
    .update({
      status: 'failed',
      error: message,
      error_code: 'watchdog_timeout',
      stage: 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'rendering')
    .lt('created_at', cutoff)
    .select('id');

  if (error) throw new Error(`render watchdog failed: ${error.message}`);
  return data?.length || 0;
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
