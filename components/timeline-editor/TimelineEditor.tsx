import React, { useEffect, useRef, useState } from 'react';
import { dispatch } from '@designcombo/events';
import StateManager, {
  ADD_VIDEO,
  LAYER_DELETE,
  TIMELINE_SCALE_CHANGED,
} from '@designcombo/state';
import { generateId } from '@designcombo/timeline';
import { getFitZoomLevel } from './utils';
import { Upload, Sparkles } from 'lucide-react';
import Player from './Player';
import Timeline from './Timeline';
import EffectsPanel from './EffectsPanel';
import useStore, { HistoryFrame } from './store';
import useTimelineEvents from './use-timeline-events';
import { loadSnapshot, saveSnapshot, clearSnapshot } from './persistence';

export type InitialClip = { src: string; name?: string };

interface Props {
  onExit?: () => void;
  // Pre-populate the video track with these clips on mount, appended in order.
  initialClips?: InitialClip[];
  // Pre-populate the audio track. Each clip starts at 0ms and plays for its
  // full duration — typically just the project song. The timeline's total
  // duration is max(video stack end, audio end) so audio past the videos is
  // preserved.
  initialAudioClips?: InitialClip[];
  // When true: fills its parent instead of 100vh, hides the top bar, and
  // the upload toolbar becomes a compact corner control. For embedding in
  // another page (e.g. StepRender) as a live preview.
  embedded?: boolean;
  // When set, enables client-side persistence: on mount we try to restore
  // the saved snapshot for this project, and subsequent edits auto-save
  // (debounced) to localStorage. Omit for ephemeral use. The id is also
  // mirrored into the store so the Header's Reset/Save buttons can act on
  // it without prop-drilling.
  projectId?: string;
}

const toolbarBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#e5e5e5',
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
};

const sidebarBtn = (active: boolean): React.CSSProperties => ({
  background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
  border: '1px solid ' + (active ? 'rgba(255,255,255,0.12)' : 'transparent'),
  color: active ? '#fff' : '#a1a1aa',
  width: 40,
  height: 40,
  borderRadius: 8,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.15s',
});

// Compute the next video-clip start position from what's already in the store.
// Audio items intentionally excluded — the song usually runs longer than the
// video stack, and we don't want uploads to land after its tail.
const nextStartMs = () => {
  const map = useStore.getState().trackItemsMap;
  let max = 0;
  Object.values(map).forEach((it: any) => {
    if (it?.type !== 'video') return;
    if (it?.display?.to != null && it.display.to > max) max = it.display.to;
  });
  return max;
};

// Probe a media URL's real duration using a hidden element. Used by the
// seeder below; lets us build the full timeline state synchronously and
// commit it via stateManager.updateState without touching the event bus.
const probeMediaDurationMs = (src: string, kind: 'video' | 'audio'): Promise<number> =>
  new Promise((resolve) => {
    const el = document.createElement(kind) as HTMLMediaElement;
    el.preload = 'metadata';
    if (kind === 'video') (el as HTMLVideoElement).muted = true;
    const done = (ms: number) => {
      el.onloadedmetadata = null;
      el.onerror = null;
      el.removeAttribute('src');
      el.load();
      resolve(ms);
    };
    el.onloadedmetadata = () => {
      const d = el.duration;
      done(isFinite(d) && d > 0 ? Math.round(d * 1000) : 5000);
    };
    el.onerror = () => done(5000);
    el.src = src;
  });

// Dispatch an ADD_VIDEO that appends to the first existing video track (or
// creates one when the timeline is empty). Used by the manual-upload button.
const addVideoClip = (src: string, name?: string) => {
  const id = generateId();
  const from = nextStartMs();
  const existingTrack = useStore.getState().tracks.find((t) => t.type === 'video');
  dispatch(ADD_VIDEO, {
    payload: {
      id,
      display: { from },
      type: 'video',
      details: { src, volume: 100, ...(name ? { name } : {}) },
      metadata: { resourceId: id, ...(name ? { displayName: name } : {}) },
    },
    options: existingTrack
      ? { targetTrackId: existingTrack.id, isNewTrack: false }
      : {},
  });
  return id;
};

const TimelineEditor: React.FC<Props> = ({
  onExit,
  initialClips,
  initialAudioClips,
  embedded,
  projectId,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    playerRef,
    setStateManager,
    setState,
    stateManager,
    setHistory,
    setLastSavedAt,
    setProjectId,
    setHistoryHandlers,
  } = useStore();
  // Filled in by the main effect once a StateManager is mounted; called by
  // the seed effect after seeding completes so the first user edit has a
  // baseline to push onto the undo stack.
  const captureBaselineRef = useRef<(() => void) | null>(null);
  // Reset signal lives in the store so the Header can trigger it. Reading it
  // as a dep here makes the seed effect re-run on bump.
  const resetToken = useStore((s) => s.resetToken);

  // Mirror the prop into the store so deep children (Header) can read it.
  useEffect(() => {
    setProjectId(projectId ?? null);
    return () => setProjectId(null);
  }, [projectId, setProjectId]);
  const [sidePanel, setSidePanel] = useState<'effects' | null>(null);
  useTimelineEvents();

  // Gate auto-save until after the seed effect has finished committing. Seeds
  // (both initial-clips and snapshot restore) flow through the same
  // subscribeToState wiring as user edits, and we don't want the first
  // post-seed fire to immediately rewrite the very snapshot we just loaded.
  const hasSeededRef = useRef(false);

  // Init the StateManager once.
  useEffect(() => {
    const sm = new StateManager(
      {
        size: { width: 1920, height: 1080 },
        fps: 30,
        duration: 5000,
        scale: { unit: 60, zoom: 1 / 90, segments: 5, index: 10 },
      } as any,
      {
        acceptsMap: {
          video: ['video'],
          audio: ['audio'],
        },
      },
    );
    setStateManager(sm);

    // The zustand store is module-level — on remount (project switch) it can
    // still hold track items from the previous project's StateManager. Reset
    // the store explicitly so a stale render doesn't show old clips before
    // the seed effect finishes re-populating.
    setState({
      tracks: [],
      trackItemIds: [],
      trackItemsMap: {},
      transitionIds: [],
      transitionsMap: {},
      activeIds: [],
    });

    // Session-only undo/redo. Whole-snapshot replay (vs. designcombo's
    // diff-based history) sidesteps the regrowth bug where a trim diff is
    // recorded but the pack-after-trim is `updateHistory:false`, so an undo
    // would restore the trimmed clip's old width without unwinding neighbor
    // positions — clips would overlap. Closure-local arrays keep history out
    // of the zustand state (which is sufficient since reload clears it).
    const undoStack: HistoryFrame[] = [];
    const redoStack: HistoryFrame[] = [];
    const HIST_MAX = 50;
    let lastCommitted: HistoryFrame | null = null;
    let isReplayingHistory = false;
    let captureTimer: number | null = null;
    const captureFrame = (): HistoryFrame => {
      const s = sm.getState() as any;
      return {
        trackItemIds: s.trackItemIds,
        trackItemsMap: s.trackItemsMap,
        transitionIds: s.transitionIds,
        transitionsMap: s.transitionsMap,
        tracks: s.tracks,
        duration: s.duration,
      };
    };
    const updateButtons = () => {
      setHistory(undoStack.length > 0, redoStack.length > 0);
    };
    const commit = () => {
      const current = captureFrame();
      if (lastCommitted) {
        undoStack.push(lastCommitted);
        if (undoStack.length > HIST_MAX) undoStack.shift();
        redoStack.length = 0;
        updateButtons();
      }
      lastCommitted = current;
    };
    captureBaselineRef.current = () => {
      lastCommitted = captureFrame();
      undoStack.length = 0;
      redoStack.length = 0;
      updateButtons();
    };
    const applyFrame = (target: HistoryFrame) => {
      isReplayingHistory = true;
      try {
        (sm as any).updateState(
          {
            trackItemIds: target.trackItemIds,
            trackItemsMap: target.trackItemsMap,
            transitionIds: target.transitionIds,
            transitionsMap: target.transitionsMap,
            tracks: target.tracks,
            duration: target.duration,
          },
          { kind: 'update', updateHistory: false },
        );
      } finally {
        // Clear after the synchronous subscriber chain has flushed. queueMicrotask
        // is enough — RxJS dispatches are sync, so the store.subscribe handler
        // below has already fired by the time the microtask runs.
        queueMicrotask(() => {
          isReplayingHistory = false;
        });
      }
    };
    const performUndo = () => {
      if (undoStack.length === 0 || !lastCommitted) return;
      const target = undoStack.pop()!;
      redoStack.push(lastCommitted);
      lastCommitted = target;
      applyFrame(target);
      updateButtons();
    };
    const performRedo = () => {
      if (redoStack.length === 0 || !lastCommitted) return;
      const target = redoStack.pop()!;
      undoStack.push(lastCommitted);
      lastCommitted = target;
      applyFrame(target);
      updateButtons();
    };
    setHistoryHandlers(performUndo, performRedo);

    const sub = sm.subscribeToState((s: any) => {
      setState({
        tracks: s.tracks,
        trackItemIds: s.trackItemIds,
        trackItemsMap: s.trackItemsMap,
        transitionIds: s.transitionIds,
        transitionsMap: s.transitionsMap,
      });
    });
    const durSub = sm.subscribeToDuration(({ duration }: any) => setState({ duration }));
    const scaleSub = sm.subscribeToScale(({ scale }: any) => setState({ scale }));
    const activeSub = sm.subscribeToActiveIds(({ activeIds }: any) => setState({ activeIds }));
    // Trim/drag on canvas fires timing-only updates — subscribeToState doesn't
    // cover them, so without these subscriptions the zustand trackItemsMap
    // keeps the pre-trim ranges and both the Player and the /render payload
    // play/export the full clip.
    //
    // Re-entrancy guard: our own pack-write re-fires this subscription.
    let packing = false;
    const timingSub = sm.subscribeToUpdateTrackItemTiming(
      ({ trackItemsMap, changedTrimIds, changedDisplayIds }: any) => {
        setState({ trackItemsMap });
        if (packing) return;
        // Only repack when a trim actually happened. Delete and other
        // structural mutations also fan out timing events (sometimes with a
        // pre-mutation snapshot of the map), and blindly writing back would
        // resurrect the deleted item.
        const isTrim =
          (changedTrimIds && changedTrimIds.length > 0) ||
          (changedDisplayIds && changedDisplayIds.length > 0);
        if (!isTrim) return;

      // Trim reflow: trimming is the only timing edit we do, and both
      // directions need the same treatment:
      //   - inward  → shrinks the item, leaves a gap, we close it
      //   - outward → grows the item past its neighbor; @designcombo's
      //               collision logic hoists it to a brand-new track. We
      //               fold that back in and just let the width push the
      //               next clip further right.
      //
      // Strategy: pool every video/image item (across any auto-created
      // tracks), sort by from, pack end-to-end into a single video track.
      // Audio/transition tracks are left alone.
      //
      // Direct updateState rather than EDIT_OBJECT — the latter recomputes
      // display from playbackRate and corrupts pure translations.
      const s = sm.getState() as any;
      const tracks: any[] = s.tracks || [];
      const map: Record<string, any> = s.trackItemsMap || {};

      const videoTracks = tracks.filter((t) => t.type === 'video' || t.type === 'image');
      if (videoTracks.length === 0) return;
      const mainTrack = videoTracks[0];

      const pooled = videoTracks
        .flatMap((t) => (t.items as string[]).map((id) => map[id]).filter(Boolean))
        .sort((a, b) => (a.display?.from ?? 0) - (b.display?.from ?? 0));

      const nextMap: Record<string, any> = { ...map };
      let changed = videoTracks.length > 1; // more than one video track means we need to fold
      let cursor = 0;
      const packedIds: string[] = [];
      for (const it of pooled) {
        const from = it.display?.from ?? 0;
        const to = it.display?.to ?? 0;
        const width = to - from;
        const needsMove = from !== cursor || it.trackId !== mainTrack.id;
        if (needsMove) {
          nextMap[it.id] = {
            ...it,
            display: { from: cursor, to: cursor + width },
            trackId: mainTrack.id,
          };
          changed = true;
        }
        packedIds.push(it.id);
        cursor += width;
      }

      if (!changed) return;

      // Drop the ghost tracks; keep the canonical one with every packed id.
      const nextTracks = tracks
        .filter((t) => t === mainTrack || (t.type !== 'video' && t.type !== 'image'))
        .map((t) => (t === mainTrack ? { ...t, items: packedIds } : t));

      // Total duration = max(video end, audio/other end).
      let totalDuration = 0;
      Object.values(nextMap).forEach((it: any) => {
        const to = it?.display?.to ?? 0;
        if (to > totalDuration) totalDuration = to;
      });

      packing = true;
      try {
        (sm as any).updateState(
          {
            trackItemsMap: nextMap,
            tracks: nextTracks,
            duration: totalDuration || 5000,
          },
          { kind: 'update', updateHistory: false },
        );
      } finally {
        queueMicrotask(() => {
          packing = false;
        });
      }
    });
    const itemDetailsSub = sm.subscribeToUpdateItemDetails(({ trackItemsMap }: any) =>
      setState({ trackItemsMap }),
    );
    const trackItemSub = sm.subscribeToUpdateTrackItem(({ trackItemsMap }: any) =>
      setState({ trackItemsMap }),
    );
    // History capture: subscribe to the store and debounce 400ms so that a
    // trim event followed by our pack reflow coalesces into ONE snapshot
    // (post-pack), which is what we want both forward (redo) and backward
    // (undo) replay to land on. isReplayingHistory blocks capture during
    // our own undo/redo applies.
    const histUnsub = useStore.subscribe((state, prev) => {
      if (isReplayingHistory) return;
      if (!hasSeededRef.current) return;
      if (
        state.trackItemIds === prev.trackItemIds &&
        state.trackItemsMap === prev.trackItemsMap &&
        state.transitionIds === prev.transitionIds &&
        state.transitionsMap === prev.transitionsMap &&
        state.tracks === prev.tracks &&
        state.duration === prev.duration
      )
        return;
      if (captureTimer != null) window.clearTimeout(captureTimer);
      captureTimer = window.setTimeout(() => {
        if (isReplayingHistory) return;
        commit();
      }, 400);
    });

    return () => {
      sub.unsubscribe();
      durSub.unsubscribe();
      scaleSub.unsubscribe();
      activeSub.unsubscribe();
      timingSub.unsubscribe();
      itemDetailsSub.unsubscribe();
      trackItemSub.unsubscribe();
      histUnsub();
      if (captureTimer != null) window.clearTimeout(captureTimer);
      sm.purge();
      setStateManager(null as any);
      setHistory(false, false);
      setHistoryHandlers(null, null);
      captureBaselineRef.current = null;
    };
  }, [setStateManager, setState, setHistory, setHistoryHandlers]);

  // Seed with initialClips + initialAudioClips by probing durations ourselves
  // and committing the full state via stateManager.updateState. This bypasses
  // the global @designcombo/events bus, which under React 18 StrictMode
  // (double-mount) would leak dispatches from sm1's IIFE into sm2's state and
  // throw "Target track not found" because sm2 doesn't know sm1's track IDs.
  //
  // Re-seed trigger: URL signature change (regen, project switch). seededKeyRef
  // prevents a stable prop reference from re-triggering on every render.
  const seededKeyRef = useRef<string>('');
  useEffect(() => {
    if (!stateManager) return;
    const videoKey = (initialClips ?? []).map((c) => c.src).join('|');
    const audioKey = (initialAudioClips ?? []).map((c) => c.src).join('|');
    // resetToken is folded into the key so bumping it in the parent forces a
    // re-seed even when the clip URLs are identical.
    const key = `${videoKey}#${audioKey}#${resetToken ?? 0}#${projectId ?? ''}`;
    if (seededKeyRef.current === key) return;

    hasSeededRef.current = false;
    let cancelled = false;
    (async () => {
      // Always hard-reset before seeding, even when there are no clips. This
      // also wipes any stale state left by a previous mount (StrictMode or
      // project switch) before we rebuild.
      (stateManager as any).updateState(
        {
          tracks: [],
          trackItemIds: [],
          trackItemsMap: {},
          transitionIds: [],
          transitionsMap: {},
        },
        { kind: 'update', updateHistory: false },
      );

      // Snapshot restore path: when a projectId is provided and a saved
      // timeline exists in localStorage, hydrate from it and skip the
      // initialClips seeding entirely. Reset flow calls clearSnapshot before
      // bumping resetToken, so after a reset this returns null and we fall
      // through to the fresh-clips path below.
      if (projectId) {
        const snap = loadSnapshot(projectId);
        // Validate snapshot srcs against the current initialClips set. If the
        // studio regenerated a shot video, the snapshot's src is a dead URL
        // and the Player would just show a broken clip. `blob:` srcs (manual
        // uploads from the Upload button) are ephemeral to the page session
        // but we accept them — they'll fail to load silently which is no
        // worse than the current non-persistent behavior.
        const freshSrcs = new Set([
          ...(initialClips ?? []).map((c) => c.src),
          ...(initialAudioClips ?? []).map((c) => c.src),
        ]);
        const hasStaleSrc =
          !!snap &&
          Object.values(snap.trackItemsMap).some((it: any) => {
            const src = it?.details?.src;
            if (typeof src !== 'string') return false;
            if (src.startsWith('blob:')) return false;
            return !freshSrcs.has(src);
          });
        if (hasStaleSrc) {
          clearSnapshot(projectId);
        } else if (snap && snap.trackItemIds.length > 0) {
          if (cancelled) return;
          if (useStore.getState().stateManager !== stateManager) return;
          (stateManager as any).updateState(
            {
              tracks: snap.tracks,
              trackItemIds: snap.trackItemIds,
              trackItemsMap: snap.trackItemsMap,
              transitionIds: snap.transitionIds,
              transitionsMap: snap.transitionsMap,
              duration: snap.duration,
            },
            { kind: 'update', updateHistory: false },
          );
          setLastSavedAt(snap.savedAt);
          seededKeyRef.current = key;
          hasSeededRef.current = true;
          captureBaselineRef.current?.();
          if (snap.duration > 0) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (cancelled) return;
                if (useStore.getState().stateManager !== stateManager) return;
                const currentZoom = useStore.getState().scale?.zoom ?? 1 / 90;
                dispatch(TIMELINE_SCALE_CHANGED, {
                  payload: { scale: getFitZoomLevel(snap.duration, currentZoom) },
                });
              });
            });
          }
          return;
        }
        // No snapshot (or empty) — ensure stale "Saved X ago" pill clears.
        setLastSavedAt(null);
      }

      if (!initialClips?.length && !initialAudioClips?.length) {
        seededKeyRef.current = key;
        hasSeededRef.current = true;
        captureBaselineRef.current?.();
        return;
      }

      // Probe all durations in parallel — much faster than serial and
      // side-effect free.
      const [videoDurations, audioDurations] = await Promise.all([
        Promise.all((initialClips ?? []).map((c) => probeMediaDurationMs(c.src, 'video'))),
        Promise.all((initialAudioClips ?? []).map((c) => probeMediaDurationMs(c.src, 'audio'))),
      ]);
      if (cancelled) return;
      // If the stateManager we captured has been replaced (StrictMode
      // cleanup during probe), bail — the new sm's seed effect will take
      // over with its own capture.
      if (useStore.getState().stateManager !== stateManager) return;

      const videoTrackId = generateId();
      const audioTrackId = generateId();
      const trackItemIds: string[] = [];
      const trackItemsMap: Record<string, any> = {};

      // Video items appended sequentially on the video track.
      const videoItemIds: string[] = [];
      let videoEnd = 0;
      (initialClips ?? []).forEach((clip, i) => {
        const dur = videoDurations[i] || 5000;
        const itemId = generateId();
        videoItemIds.push(itemId);
        trackItemIds.push(itemId);
        trackItemsMap[itemId] = {
          id: itemId,
          type: 'video',
          display: { from: videoEnd, to: videoEnd + dur },
          details: { src: clip.src, volume: 100, ...(clip.name ? { name: clip.name } : {}) },
          metadata: { resourceId: itemId, ...(clip.name ? { displayName: clip.name } : {}) },
          trackId: videoTrackId,
          isMain: true,
          duration: dur,
          playbackRate: 1,
          trim: { from: 0, to: dur },
        };
        videoEnd += dur;
      });

      // Audio items each start at 0ms on a dedicated audio track (typically
      // just the song). Parallel to the video track — not sequential.
      const audioItemIds: string[] = [];
      let maxAudioEnd = 0;
      (initialAudioClips ?? []).forEach((clip, i) => {
        const dur = audioDurations[i] || 5000;
        const itemId = generateId();
        audioItemIds.push(itemId);
        trackItemIds.push(itemId);
        trackItemsMap[itemId] = {
          id: itemId,
          type: 'audio',
          display: { from: 0, to: dur },
          details: { src: clip.src, volume: 100, ...(clip.name ? { name: clip.name } : {}) },
          metadata: { resourceId: itemId, ...(clip.name ? { displayName: clip.name } : {}) },
          trackId: audioTrackId,
          isMain: false,
          duration: dur,
          playbackRate: 1,
          trim: { from: 0, to: dur },
        };
        if (dur > maxAudioEnd) maxAudioEnd = dur;
      });

      const tracks: any[] = [];
      if (videoItemIds.length) {
        tracks.push({ id: videoTrackId, type: 'video', items: videoItemIds, accepts: ['video'] });
      }
      if (audioItemIds.length) {
        tracks.push({ id: audioTrackId, type: 'audio', items: audioItemIds, accepts: ['audio'] });
      }

      const totalDuration = Math.max(videoEnd, maxAudioEnd) || 5000;

      if (cancelled) return;
      (stateManager as any).updateState(
        {
          tracks,
          trackItemIds,
          trackItemsMap,
          transitionIds: [],
          transitionsMap: {},
          duration: totalDuration,
        },
        { kind: 'update', updateHistory: false },
      );
      seededKeyRef.current = key;
      hasSeededRef.current = true;
      captureBaselineRef.current?.();

      // Fit-to-screen after the timeline canvas has rendered. getFitZoomLevel
      // reads the canvas element's width, so we have to wait a frame for the
      // DOM to flush. Two rAFs is belt-and-suspenders — the first lets React
      // commit, the second lets layout settle.
      if (totalDuration > 0 && (videoItemIds.length || audioItemIds.length)) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (cancelled) return;
            if (useStore.getState().stateManager !== stateManager) return;
            const currentZoom = useStore.getState().scale?.zoom ?? 1 / 90;
            dispatch(TIMELINE_SCALE_CHANGED, {
              payload: { scale: getFitZoomLevel(totalDuration, currentZoom) },
            });
          });
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stateManager, initialClips, initialAudioClips, projectId, resetToken, setLastSavedAt]);

  // Auto-save: debounced writer that mirrors the render-authoritative subset
  // of the store into localStorage whenever the user edits the timeline.
  // Gated by hasSeededRef so the seed effect's own commits don't immediately
  // overwrite the snapshot we may have just loaded.
  useEffect(() => {
    if (!projectId || !stateManager) return;
    let timer: number | null = null;
    const unsub = useStore.subscribe((state, prev) => {
      if (!hasSeededRef.current) return;
      // Only save when the render-authoritative subset actually changed.
      if (
        state.trackItemIds === prev.trackItemIds &&
        state.trackItemsMap === prev.trackItemsMap &&
        state.transitionsMap === prev.transitionsMap &&
        state.transitionIds === prev.transitionIds &&
        state.tracks === prev.tracks &&
        state.duration === prev.duration
      )
        return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const s = useStore.getState();
        if (s.trackItemIds.length === 0) return;
        const savedAt = saveSnapshot(projectId, {
          trackItemIds: s.trackItemIds,
          trackItemsMap: s.trackItemsMap,
          transitionIds: s.transitionIds,
          transitionsMap: s.transitionsMap,
          tracks: s.tracks,
          duration: s.duration,
          fps: s.fps,
          size: s.size,
        });
        if (savedAt != null) s.setLastSavedAt(savedAt);
      }, 500);
    });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      unsub();
    };
  }, [projectId, stateManager]);

  // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z = redo. Routes through the store's
  // session-only history handlers (not designcombo's diff history).
  // S (no modifier) = split selected item at the playhead — the store action
  // is a silent no-op when the playhead isn't inside a splittable item.
  useEffect(() => {
    if (!stateManager) return;
    const onKey = (e: KeyboardEvent) => {
      // Always ignore typing into form controls / contentEditable. Otherwise
      // hitting `S` while renaming a clip would slice the clip in two.
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        const { performUndo, performRedo } = useStore.getState();
        if (e.shiftKey) {
          if (!performRedo) return;
          e.preventDefault();
          performRedo();
        } else {
          if (!performUndo) return;
          e.preventDefault();
          performUndo();
        }
        return;
      }

      if (!mod && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
        const { splitActiveAtPlayhead } = useStore.getState();
        const did = splitActiveAtPlayhead();
        if (did) e.preventDefault();
        return;
      }

      // Delete/Backspace = remove selected clip(s). The same pack reflow
      // that runs after a trim closes the gap automatically, so this is
      // effectively a ripple delete. No modifier required — Backspace on
      // its own is the convention every editor (Premiere/FCP/Resolve) uses
      // and our input-focus guard above keeps it from firing while typing.
      if (!mod && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace')) {
        const { activeIds } = useStore.getState();
        if (activeIds.length === 0) return;
        e.preventDefault();
        dispatch(LAYER_DELETE, { payload: { trackItemIds: activeIds }, options: {} });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stateManager]);

  const handleUpload = (files: File[]) => {
    if (!files[0]) return;
    addVideoClip(URL.createObjectURL(files[0]), files[0].name);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: embedded ? '100%' : '100vh',
        background: '#141418',
      }}
    >
      {!embedded && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            flex: 'none',
          }}
        >
          <div style={{ color: '#e5e5e5', fontSize: 14, fontWeight: 500 }}>
            Timeline Editor (preview)
          </div>
          {onExit && (
            <button style={toolbarBtn} onClick={onExit}>
              Back
            </button>
          )}
        </div>
      )}

      {/* Upper half: vertical tool rail • viewer • (optional) effects panel */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'row',
        }}
      >
        {/* Left tool rail — Upload + Effects */}
        <div
          style={{
            width: 56,
            flexShrink: 0,
            borderRight: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '12px 0',
            gap: 6,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            style={{ display: 'none' }}
            onChange={(e) => handleUpload(Array.from(e.target.files || []))}
          />
          <button
            style={sidebarBtn(false)}
            onClick={() => fileInputRef.current?.click()}
            title="Upload video"
          >
            <Upload size={16} />
          </button>
          <button
            style={sidebarBtn(sidePanel === 'effects')}
            onClick={() => setSidePanel((cur) => (cur === 'effects' ? null : 'effects'))}
            title="Effects"
          >
            <Sparkles size={16} />
          </button>
        </div>

        {/* Viewer — fills all remaining horizontal space */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            padding: 12,
          }}
        >
          {stateManager ? <Player /> : null}
        </div>

        {/* Effects panel (when toggled on) */}
        {sidePanel === 'effects' && <EffectsPanel />}
      </div>

      {/* Full-width timeline below */}
      {playerRef && stateManager && <Timeline />}
    </div>
  );
};

export default TimelineEditor;
