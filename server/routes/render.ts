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
import { insertRow, selectAll, selectOne, updateRows } from '../database.js';
import { recordDirectorEvent } from '../services/directorEvents.js';
import { storageUrl } from '../storage.js';

const router = Router();

const paramStr = (val: string | string[]): string =>
  Array.isArray(val) ? val[0] : val;

const activeRenderWindowMs = () => {
  const minutes = Number(process.env.MAX_RENDER_MINUTES || 65);
  return Math.max(1, minutes) * 60 * 1000;
};

const parseJson = <T>(value: any, fallback: T): T => {
  if (!value) return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

const numberMs = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const itemSrc = (item: any) => {
  const src = item?.details?.src;
  return typeof src === 'string' && src.trim() ? src.trim() : null;
};

const renderCanvasSize = (project: any) => {
  const base = project?.video_resolution === '1080p' ? 1080 : 720;
  if (project?.aspect_ratio === '9:16') return { width: base, height: Math.round((base * 16) / 9) };
  if (project?.aspect_ratio === '1:1') return { width: base, height: base };
  return { width: Math.round((base * 16) / 9), height: base };
};

const normalizeTimelineCanvas = (project: any, timeline: any) => ({
  ...timeline,
  size: renderCanvasSize(project),
});

const enableNativeVideoAudio = async (projectId: string, timeline: any) => {
  const scenes = await selectAll('scenes', { project_id: projectId }, { orderBy: 'sort_order' });
  const sceneIds = scenes.map((scene: any) => scene.id);
  if (sceneIds.length === 0) return timeline;
  const projectShots = await selectAll('shots', { scene_id: sceneIds }, { orderBy: 'sort_order' });
  const videoAssetIds = projectShots.map((shot: any) => shot.video_asset_id).filter(Boolean);
  if (videoAssetIds.length === 0) return timeline;
  const assets = await selectAll('assets', { id: videoAssetIds });
  const nativeAudioUrls = new Set<string>();
  for (const asset of assets) {
    const metadata = parseJson<Record<string, any>>(asset.metadata, {});
    if (metadata.native_audio_generated && asset.file_path) {
      nativeAudioUrls.add(storageUrl(asset.file_path));
    }
  }
  if (nativeAudioUrls.size === 0) return timeline;

  const trackItemsMap = timeline.trackItemsMap && typeof timeline.trackItemsMap === 'object'
    ? { ...timeline.trackItemsMap }
    : {};
  let changed = false;
  for (const [id, item] of Object.entries(trackItemsMap) as [string, any][]) {
    if (item?.type !== 'video') continue;
    const src = itemSrc(item);
    if (!src || !nativeAudioUrls.has(src)) continue;
    trackItemsMap[id] = {
      ...item,
      details: {
        ...(item.details || {}),
        muted: false,
      },
    };
    changed = true;
  }
  if (!changed) return timeline;
  return {
    ...timeline,
    trackItemsMap,
    metadata: {
      ...(timeline.metadata || {}),
      nativeVideoAudioEnabled: true,
    },
  };
};

const enrichTimelineWithOverlayDialogue = async (projectId: string, timeline: any) => {
  const project = await selectOne('projects', { id: projectId });
  const brief = parseJson<Record<string, any>>(project?.project_brief, {});
  if (brief.dialogueVideoMode === 'lipsync') {
    const nativeTimeline = await enableNativeVideoAudio(projectId, timeline);
    if (nativeTimeline?.metadata?.nativeVideoAudioEnabled) return nativeTimeline;
    timeline = nativeTimeline;
  }

  const trackItemIds = Array.isArray(timeline.trackItemIds) ? [...timeline.trackItemIds] : [];
  const trackItemsMap = timeline.trackItemsMap && typeof timeline.trackItemsMap === 'object'
    ? { ...timeline.trackItemsMap }
    : {};
  if (trackItemIds.length === 0 || Object.keys(trackItemsMap).length === 0) return timeline;

  const scenes = await selectAll('scenes', { project_id: projectId }, { orderBy: 'sort_order' });
  const sceneIds = scenes.map((scene: any) => scene.id);
  if (sceneIds.length === 0) return timeline;
  const projectShots = await selectAll('shots', { scene_id: sceneIds }, { orderBy: 'sort_order' });
  const assetIds = new Set<string>();
  for (const shot of projectShots) {
    if (shot.video_asset_id) assetIds.add(shot.video_asset_id);
    const plan = parseJson<any>(shot.audio_plan, null);
    for (const line of plan?.dialogue || []) {
      if (line?.ttsStatus === 'success' && line.ttsAssetId) assetIds.add(line.ttsAssetId);
    }
  }
  if (assetIds.size === 0) return timeline;

  const assets = await selectAll('assets', { id: [...assetIds] });
  const assetMap = new Map(assets.map((asset: any) => [asset.id, asset]));
  const visualItemsBySrc = new Map<string, any[]>();
  for (const id of trackItemIds) {
    const item = trackItemsMap[id];
    if (!item || (item.type !== 'video' && item.type !== 'image')) continue;
    const src = itemSrc(item);
    if (!src) continue;
    const arr = visualItemsBySrc.get(src) || [];
    arr.push(item);
    visualItemsBySrc.set(src, arr);
  }

  let injected = 0;
  let durationMs = numberMs(timeline.durationMs, 0);
  for (const shot of projectShots) {
    const plan = parseJson<any>(shot.audio_plan, null);
    if (!Array.isArray(plan?.dialogue) || plan.dialogue.length === 0) continue;
    const videoAsset = shot.video_asset_id ? assetMap.get(shot.video_asset_id) : null;
    if (!videoAsset?.file_path) continue;
    const shotItem = visualItemsBySrc.get(storageUrl(videoAsset.file_path))?.[0];
    if (!shotItem?.display) continue;
    if (shotItem.details?.muted === false) continue;

    const shotStartMs = numberMs(shotItem.display.from, 0);
    const shotEndMs = numberMs(shotItem.display.to, shotStartMs + numberMs(shot.duration, 5) * 1000);
    const shotDurationMs = Math.max(1, shotEndMs - shotStartMs);
    const dialogue = [...(plan.dialogue || [])]
      .filter((line: any) => line?.ttsStatus === 'success' && line.ttsAssetId)
      .sort((a: any, b: any) => Number(a.order || 0) - Number(b.order || 0));
    if (dialogue.length === 0) continue;

    let cursorMs = shotStartMs;
    const fallbackLineMs = Math.max(800, Math.floor(shotDurationMs / dialogue.length));
    for (const line of dialogue) {
      const ttsAsset = assetMap.get(line.ttsAssetId);
      if (!ttsAsset?.file_path) continue;
      const explicitStartMs = Number(line.startMs);
      const explicitEndMs = Number(line.endMs);
      const lineMs = Math.max(
        500,
        Number.isFinite(explicitStartMs) && Number.isFinite(explicitEndMs) && explicitEndMs > explicitStartMs
          ? Math.round(explicitEndMs - explicitStartMs)
          : Math.round(Number(line.ttsDurationSec || line.targetSec || 0) * 1000) || fallbackLineMs,
      );
      const itemId = `dialogue-${shot.id}-${line.id || uuidv4()}`;
      const desiredFrom = Number.isFinite(explicitStartMs) && explicitStartMs >= 0
        ? shotStartMs + explicitStartMs
        : cursorMs;
      const from = Math.max(shotStartMs, Math.min(desiredFrom, shotEndMs - 500));
      const to = Math.max(from + 500, Math.min(from + lineMs, shotEndMs));
      if (to <= from) continue;
      trackItemIds.push(itemId);
      trackItemsMap[itemId] = {
        id: itemId,
        type: 'audio',
        display: { from, to },
        details: {
          src: storageUrl(ttsAsset.file_path),
          volume: 100,
          name: `dialogue_${line.order || injected + 1}`,
        },
        metadata: {
          resourceId: itemId,
          displayName: `Dialogue ${line.order || injected + 1}`,
          shotId: shot.id,
          dialogueId: line.id || null,
          injectedBy: 'mirage_overlay_dialogue',
        },
        trackId: 'dialogue-overlay-track',
        isMain: false,
        duration: to - from,
        playbackRate: 1,
        trim: { from: 0, to: to - from },
      };
      injected += 1;
      cursorMs = to;
      durationMs = Math.max(durationMs, to);
      if (cursorMs >= shotEndMs) break;
    }
  }

  if (injected === 0) return timeline;
  return {
    ...timeline,
    trackItemIds,
    trackItemsMap,
    durationMs: Math.max(numberMs(timeline.durationMs, durationMs), durationMs),
    metadata: {
      ...(timeline.metadata || {}),
      overlayDialogueInjected: injected,
    },
  };
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

  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const renderTimeline = await enrichTimelineWithOverlayDialogue(projectId, normalizeTimelineCanvas(project, timeline));

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
    payload: { renderId, overlayDialogueInjected: renderTimeline.metadata?.overlayDialogueInjected || 0 },
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
        body: JSON.stringify({ renderId, projectId, timeline: renderTimeline }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const message = `renderer rejected render request: HTTP ${response.status}${body ? ` ${body.slice(0, 500)}` : ''}`;
        console.error(`[render ${renderId}] ${message}`);
        await updateRows('renders', { id: renderId }, {
          status: 'failed',
          error: message,
          error_code: 'renderer_rejected',
          stage: 'failed',
          updated_at: new Date().toISOString(),
        }).catch(() => {});
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
      await updateRows('renders', { id: renderId }, {
        status: 'failed',
        error: err?.message || 'renderer unreachable',
        error_code: 'renderer_unreachable',
        stage: 'failed',
        updated_at: new Date().toISOString(),
      }).catch(() => {});
      await recordDirectorEvent({
        projectId,
        source: 'system',
        eventType: 'render_failed',
        entityType: 'render',
        entityId: renderId,
        summary: 'Render request could not reach the renderer.',
        payload: { renderId, errorCode: 'renderer_unreachable', error: String(err?.message || 'renderer unreachable').slice(0, 500) },
      });
    }
  })();

  return res.status(202).json({ renderId, status: 'rendering' });
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
