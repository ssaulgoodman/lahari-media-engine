/**
 * Render — kicks off an async render job against the remotion-renderer service.
 *
 * Each render is a row in lahari_renders (status: rendering|completed|failed).
 * We return a renderId immediately and hand it to the renderer so callbacks
 * can target the exact row — late callbacks from superseded jobs get logged
 * and ignored instead of clobbering fresh state.
 *
 * Why async: Railway's edge proxy kills in-flight HTTP requests after ~5 min,
 * but a real render can take 15+ min. Holding the connection synchronously
 * would always 504 even when the render succeeds.
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getSB, insertRow, selectAll, selectOne, updateRows } from '../database.js';
import { recordDirectorEvent } from '../services/directorEvents.js';

const router = Router();

const paramStr = (val: string | string[]): string =>
  Array.isArray(val) ? val[0] : val;

const activeRenderWindowMs = () => {
  const minutes = Number(process.env.MAX_RENDER_MINUTES || 65);
  return Math.max(1, minutes) * 60 * 1000;
};

const insertTimelineVersion = async ({
  projectId,
  version,
  snapshot,
  userId,
  source,
}: {
  projectId: string;
  version: number;
  snapshot: any;
  userId?: string | null;
  source: string;
}) => {
  const { error } = await getSB()
    .from('lahari_project_timeline_versions')
    .insert({
      project_id: projectId,
      version,
      snapshot,
      saved_by: userId || null,
      source,
      item_count: Array.isArray(snapshot?.trackItemIds) ? snapshot.trackItemIds.length : 0,
      duration_ms: Number.isFinite(Number(snapshot?.duration)) ? Number(snapshot.duration) : null,
    });
  return error;
};

const isUniqueConflict = (error: any): boolean =>
  error?.code === '23505' || String(error?.message || '').toLowerCase().includes('duplicate key');

const saveCanonicalTimeline = async ({
  projectId,
  snapshot,
  userId,
  source,
}: {
  projectId: string;
  snapshot: any;
  userId?: string | null;
  source: string;
}): Promise<{ version: number; updatedAt: string } | { error: any }> => {
  const sb = getSB();

  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: existing, error: readErr } = await sb
      .from('lahari_project_timelines')
      .select('version')
      .eq('project_id', projectId)
      .maybeSingle();
    if (readErr) return { error: readErr };

    const nextVersion = existing ? Number(existing.version || 0) + 1 : 1;
    const now = new Date().toISOString();

    const write = existing
      ? await sb
          .from('lahari_project_timelines')
          .update({
            snapshot,
            version: nextVersion,
            updated_by: userId || null,
            updated_at: now,
          })
          .eq('project_id', projectId)
          .select('version, updated_at')
          .single()
      : await sb
          .from('lahari_project_timelines')
          .insert({
            project_id: projectId,
            snapshot,
            version: nextVersion,
            updated_by: userId || null,
            updated_at: now,
          })
          .select('version, updated_at')
          .single();

    if (write.error) {
      if (isUniqueConflict(write.error)) continue;
      return { error: write.error };
    }

    const versionErr = await insertTimelineVersion({
      projectId,
      version: write.data.version,
      snapshot,
      userId,
      source,
    });
    if (versionErr) {
      if (isUniqueConflict(versionErr)) continue;
      return { error: versionErr };
    }

    return { version: write.data.version, updatedAt: write.data.updated_at };
  }

  return { error: new Error('Timeline save raced too many times; retry save.') };
};

router.param('id', async (req, res, next, id) => {
  const projectId = Array.isArray(id) ? id[0] : id;
  const row = await selectOne('projects', { id: projectId });
  if (!row) return res.status(404).json({ error: 'Project not found' });
  if (row.user_id !== req.userId)
    return res.status(403).json({ error: 'Access denied' });
  (req as any).project = row;
  next();
});

router.get('/:id/timeline', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const { data, error } = await getSB()
    .from('lahari_project_timelines')
    .select('snapshot, version, updated_at')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.json({ timeline: null });
  res.json({
    timeline: {
      snapshot: data.snapshot,
      version: data.version,
      updatedAt: data.updated_at,
    },
  });
});

router.get('/:id/timeline/versions', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
  const { data, error } = await getSB()
    .from('lahari_project_timeline_versions')
    .select('id, version, created_at, saved_by, source, item_count, duration_ms')
    .eq('project_id', projectId)
    .order('version', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json({
    versions: (data || []).map((row: any) => ({
      id: row.id,
      version: row.version,
      savedAt: row.created_at,
      savedBy: row.saved_by,
      source: row.source,
      itemCount: row.item_count ?? 0,
      duration: row.duration_ms ?? null,
    })),
  });
});

router.put('/:id/timeline', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const snapshot = req.body?.snapshot;
  const source = typeof req.body?.source === 'string' ? req.body.source : 'save';
  if (!snapshot || typeof snapshot !== 'object') {
    return res.status(400).json({ error: 'snapshot is required' });
  }

  const result = await saveCanonicalTimeline({
    projectId,
    snapshot,
    userId: req.userId,
    source,
  });
  if ('error' in result) return res.status(500).json({ error: result.error.message || String(result.error) });
  res.json(result);
});

router.post('/:id/timeline/restore', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const restoreVersion = Number(req.body?.version);
  if (!Number.isInteger(restoreVersion) || restoreVersion <= 0) {
    return res.status(400).json({ error: 'version is required' });
  }

  const sb = getSB();
  const { data: versionRow, error: versionReadErr } = await sb
    .from('lahari_project_timeline_versions')
    .select('snapshot, version')
    .eq('project_id', projectId)
    .eq('version', restoreVersion)
    .maybeSingle();
  if (versionReadErr) return res.status(500).json({ error: versionReadErr.message });
  if (!versionRow) return res.status(404).json({ error: 'Timeline version not found' });

  const result = await saveCanonicalTimeline({
    projectId,
    snapshot: versionRow.snapshot,
    userId: req.userId,
    source: `restore:${restoreVersion}`,
  });
  if ('error' in result) return res.status(500).json({ error: result.error.message || String(result.error) });
  res.json({ ...result, restoredFromVersion: restoreVersion });
});

router.delete('/:id/timeline', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const { error } = await getSB()
    .from('lahari_project_timelines')
    .delete()
    .eq('project_id', projectId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
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

  const existing = await selectAll('renders', { project_id: projectId, status: ['rendering', 'pending_finalize'] }, {
    orderBy: 'created_at',
    ascending: false,
    limit: 1,
  });
  const activeRender = existing[0];
  if (activeRender?.created_at) {
    const ageMs = Date.now() - new Date(activeRender.created_at).getTime();
    if (Number.isFinite(ageMs) && ageMs < activeRenderWindowMs()) {
      return res.status(409).json({
        error: 'A render is already running or finalizing for this project. Wait for it to finish or fail before starting another.',
        renderId: activeRender.id,
        status: activeRender.status,
      });
    }
  }

  const renderId = uuidv4();
  await insertRow('renders', {
    id: renderId,
    project_id: projectId,
    status: 'rendering',
    progress: 0,
    stage: 'queued',
    last_heartbeat_at: new Date().toISOString(),
  });
  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'render_started',
    entityType: 'render',
    entityId: renderId,
    summary: 'Artist started a final render.',
    payload: { renderId },
  });

  // Fire-and-forget. The renderer will call /api/renders/callback/:renderId
  // when it's done. Immediate request failures flip the row here; deeper
  // renderer failures surface via the callback. If the renderer dies without
  // either path, the render watchdog will fail the stale row.
  void (async () => {
    try {
      const response = await fetch(`${rendererUrl.replace(/\/$/, '')}/render`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-renderer-secret': rendererSecret,
        },
        body: JSON.stringify({ renderId, projectId, timeline }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const message = `renderer rejected render request: HTTP ${response.status}${body ? ` ${body.slice(0, 500)}` : ''}`;
        console.error(`[render ${renderId}] ${message}`);
        const failedAt = new Date().toISOString();
        const { data: failedRow, error: failedUpdateError } = await getSB()
          .from('lahari_renders')
          .update({
            status: 'failed',
            error: message,
            error_code: 'renderer_rejected',
            stage: 'failed',
            updated_at: failedAt,
          })
          .eq('id', renderId)
          .eq('status', 'rendering')
          .select('id')
          .maybeSingle();
        if (failedUpdateError) {
          console.error(`[render ${renderId}] failed to mark renderer rejection:`, failedUpdateError.message);
          return;
        }
        if (!failedRow) return;
        await recordDirectorEvent({
          projectId,
          source: 'system',
          eventType: 'render_failed',
          entityType: 'render',
          entityId: renderId,
          summary: 'Render request was rejected by the renderer.',
          payload: { renderId, errorCode: 'renderer_rejected', error: message.slice(0, 500) },
        });
      } else {
        const body = await response.json().catch(() => null);
        const modalFunctionCallId =
          typeof body?.modalFunctionCallId === 'string' && body.modalFunctionCallId
            ? body.modalFunctionCallId
            : null;
        await updateRows('renders', { id: renderId, status: 'rendering' }, {
          ...(modalFunctionCallId ? { modal_function_call_id: modalFunctionCallId } : {}),
          stage: 'accepted',
          progress: 0.01,
          last_heartbeat_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).catch(() => {});
      }
    } catch (err: any) {
      console.error(`[render ${renderId}] upstream fetch threw:`, err?.message || err);
      const message = err?.message || 'renderer unreachable';
      const failedAt = new Date().toISOString();
      const { data: failedRow, error: failedUpdateError } = await getSB()
        .from('lahari_renders')
        .update({
          status: 'failed',
          error: message,
          error_code: 'renderer_unreachable',
          stage: 'failed',
          updated_at: failedAt,
        })
        .eq('id', renderId)
        .eq('status', 'rendering')
        .select('id')
        .maybeSingle();
      if (failedUpdateError) {
        console.error(`[render ${renderId}] failed to mark renderer unreachable:`, failedUpdateError.message);
        return;
      }
      if (!failedRow) return;
      await recordDirectorEvent({
        projectId,
        source: 'system',
        eventType: 'render_failed',
        entityType: 'render',
        entityId: renderId,
        summary: 'Render request could not reach the renderer.',
        payload: { renderId, errorCode: 'renderer_unreachable', error: String(message).slice(0, 500) },
      });
    }
  })();

  return res.status(202).json({ renderId, status: 'rendering' });
});

router.post('/:id/renders/:renderId/cancel', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const renderId = paramStr(req.params.renderId);
  const render = await selectOne('renders', { id: renderId });
  if (!render || render.project_id !== projectId) {
    return res.status(404).json({ error: 'Render not found' });
  }

  if (render.status === 'cancelled') {
    return res.json({ ok: true, renderId, status: 'cancelled' });
  }
  if (render.status === 'completed') {
    return res.status(409).json({ error: 'Render is already completed.', renderId, status: render.status });
  }
  if (render.status === 'failed') {
    return res.status(409).json({ error: 'Render has already failed.', renderId, status: render.status });
  }
  if (render.status !== 'rendering' && render.status !== 'pending_finalize') {
    return res.status(409).json({ error: 'Render is not cancellable.', renderId, status: render.status });
  }

  const { data, error } = await getSB()
    .from('lahari_renders')
    .update({
      status: 'cancelled',
      error: 'Render cancelled by artist.',
      error_code: 'user_cancelled',
      progress: render.progress ?? null,
      stage: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', renderId)
    .eq('project_id', projectId)
    .in('status', ['rendering', 'pending_finalize'])
    .select('id')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) {
    const latest = await selectOne('renders', { id: renderId });
    return res.status(409).json({
      error: 'Render changed state before it could be cancelled.',
      renderId,
      status: latest?.status || 'unknown',
    });
  }

  await recordDirectorEvent({
    projectId,
    userId: req.userId,
    source: 'web',
    eventType: 'render_cancelled',
    entityType: 'render',
    entityId: renderId,
    summary: 'Artist cancelled a final render.',
    payload: { renderId },
  });

  return res.json({ ok: true, renderId, status: 'cancelled' });
});

// Frontend polls this — returns the most recent render row for the project.
// Per-render polling would go through GET /api/renders/:renderId/status, but
// since the UI only ever shows one render at a time, latest-wins is fine.
router.get('/:id/render-status', async (req, res) => {
  const projectId = paramStr(req.params.id);
  const rows = await selectAll('renders', { project_id: projectId }, {
    orderBy: 'created_at', ascending: false, limit: 1,
  });
  const latest = rows[0];
  if (!latest) {
    return res.json({
      renderId: null,
      status: 'idle',
      videoUrl: null,
      error: null,
      errorCode: null,
      renderMs: null,
      progress: null,
      stage: null,
      lastHeartbeatAt: null,
      modalFunctionCallId: null,
      renderEngine: null,
      ffmpegFallbackReason: null,
    });
  }
  return res.json({
    renderId: latest.id,
    status: latest.status,
    videoUrl: latest.video_url || null,
    error: latest.error || null,
    errorCode: latest.error_code || null,
    renderMs: latest.render_ms || null,
    progress: latest.progress === null || latest.progress === undefined ? null : Number(latest.progress),
    stage: latest.stage || null,
    lastHeartbeatAt: latest.last_heartbeat_at || null,
    modalFunctionCallId: latest.modal_function_call_id || null,
    renderEngine: latest.render_engine || null,
    ffmpegFallbackReason: latest.ffmpeg_fallback_reason || null,
  });
});

export { router as renderRouter };
