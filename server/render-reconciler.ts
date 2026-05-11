import { getSB, T } from './database.js';
import { finalizePublish } from './routes/queue.js';

const DEFAULT_INTERVAL_MS = 60 * 1000;

export const runRenderReconcilerOnce = async (): Promise<number> => {
  const { data, error } = await getSB()
    .from(T.renders)
    .select('id, project_id, video_url, storage_path, render_ms')
    .eq('status', 'pending_finalize')
    .not('video_url', 'is', null)
    .not('storage_path', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(10);
  if (error) throw new Error(`render reconciler select failed: ${error.message}`);

  let finalized = 0;
  for (const row of data || []) {
    try {
      await finalizePublish(row.project_id, row.storage_path, row.video_url);
      const now = new Date().toISOString();
      const { error: updateError } = await getSB()
        .from(T.renders)
        .update({
          status: 'completed',
          progress: 1,
          stage: 'completed',
          render_ms: typeof row.render_ms === 'number' ? row.render_ms : null,
          last_heartbeat_at: now,
          updated_at: now,
        })
        .eq('id', row.id)
        .eq('status', 'pending_finalize');
      if (updateError) throw new Error(updateError.message);
      finalized++;
    } catch (err: any) {
      const now = new Date().toISOString();
      console.error(`[render-reconciler ${row.id}] failed:`, err?.message || err);
      await getSB()
        .from(T.renders)
        .update({
          status: 'failed',
          error: (err?.message || 'reconcile failed').slice(0, 2000),
          error_code: 'reconcile_failed',
          stage: 'failed',
          updated_at: now,
        })
        .eq('id', row.id)
        .eq('status', 'pending_finalize');
    }
  }
  return finalized;
};

export const startRenderReconciler = () => {
  const tick = async () => {
    try {
      const count = await runRenderReconcilerOnce();
      if (count > 0) console.warn(`[render-reconciler] finalized ${count} fallback render(s)`);
    } catch (err: any) {
      console.error('[render-reconciler]', err?.message || err);
    }
  };

  const timer = setInterval(tick, DEFAULT_INTERVAL_MS);
  timer.unref?.();
  setTimeout(tick, 45_000).unref?.();
};
