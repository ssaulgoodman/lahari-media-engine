import CanvasTimeline, { generateId } from '@designcombo/timeline';
import { ITimelineScaleState, ITrack, ITrackItem, ITransition } from '@designcombo/types';
import StateManager from '@designcombo/state';
import { PlayerRef } from '@remotion/player';
import { create } from 'zustand';

// Session-only undo/redo: a snapshot is the full render-authoritative slice
// of state. Storing whole snapshots (rather than deltas) bypasses the
// designcombo history's known regrowth bug — where a trim diff is recorded
// but our pack-after-trim is `updateHistory:false`, so undo restores the
// trimmed clip's old width without unwinding neighbor positions and clips
// overlap. Whole-snapshot replay restores layout atomically. Capped to 50
// frames per session and not persisted across reloads (memory only).
export interface HistoryFrame {
  trackItemIds: string[];
  trackItemsMap: Record<string, ITrackItem>;
  transitionIds: string[];
  transitionsMap: Record<string, ITransition>;
  tracks: ITrack[];
  duration: number;
}

interface ITimelineStore {
  stateManager: StateManager | null;
  timeline: CanvasTimeline | null;
  playerRef: React.RefObject<PlayerRef> | null;
  duration: number;
  fps: number;
  scale: ITimelineScaleState;
  scroll: { left: number; top: number };
  tracks: ITrack[];
  trackItemIds: string[];
  transitionIds: string[];
  transitionsMap: Record<string, ITransition>;
  trackItemsMap: Record<string, ITrackItem>;
  activeIds: string[];
  size: { width: number; height: number };
  // Mirrors stateManager.getStateHistory() — populated by a subscribeToHistory
  // wiring in TimelineEditor. Exposed on the store so consumers (StepRender
  // header) can drive disabled state on Undo/Redo buttons reactively.
  canUndo: boolean;
  canRedo: boolean;
  // Timestamp (ms) of the most recent successful localStorage snapshot write,
  // or null if nothing is saved for the current project. Drives the "Saved"
  // pill (tooltip exposes the exact time — no per-second ticker).
  lastSavedAt: number | null;
  // Project id published by TimelineEditor on mount so the Header (which is
  // several layers down) can save/clear snapshots without prop-drilling.
  projectId: string | null;
  // Monotonic counter — bumping it re-runs the seed effect and re-seeds from
  // initialClips. Reset button in Header bumps this after clearSnapshot.
  resetToken: number;
  setStateManager: (s: StateManager) => void;
  setTimeline: (t: CanvasTimeline) => void;
  setPlayerRef: (r: React.RefObject<PlayerRef> | null) => void;
  setScale: (s: ITimelineScaleState) => void;
  setState: (partial: Partial<ITimelineStore>) => void;
  setHistory: (canUndo: boolean, canRedo: boolean) => void;
  setLastSavedAt: (ts: number | null) => void;
  setProjectId: (id: string | null) => void;
  bumpResetToken: () => void;
  // Set by TimelineEditor's main effect when the StateManager is wired up.
  // Header buttons + keyboard shortcuts call these. Null when the editor is
  // unmounted so the Header's disabled-state stays consistent.
  performUndo: (() => void) | null;
  performRedo: (() => void) | null;
  setHistoryHandlers: (
    undo: (() => void) | null,
    redo: (() => void) | null,
  ) => void;
  addTransition: (transition: ITransition) => void;
  removeTransition: (transitionId: string) => void;
  // Deletes the active item(s). Video/image deletes ripple closed so the common
  // "split, remove middle" edit does what artists expect. Audio deletes are
  // non-ripple so the song bed does not unexpectedly shift.
  deleteActiveItems: () => boolean;
  // Slices the currently-selected item into two at the playhead. v1 contract:
  //   - exactly one item selected (activeIds.length === 1)
  //   - item is video / audio / image (no captions/text/effects splits in v1)
  //   - playhead lands strictly inside the item, at least one frame from
  //     either edge (else: silent no-op)
  // Same source media on both halves; trim ranges split at the cut offset.
  // Transition rewiring is conservative: outgoing transitions move to the
  // right half, incoming transitions stay on the left (left's id is unchanged).
  // Returns true when a split actually happened so callers can flash UI.
  splitActiveAtPlayhead: () => boolean;
}

const useStore = create<ITimelineStore>((set, get) => ({
  stateManager: null,
  timeline: null,
  playerRef: null,
  duration: 5000,
  fps: 30,
  scale: { unit: 60, zoom: 1 / 90, segments: 5, index: 10 },
  scroll: { left: 0, top: 0 },
  tracks: [],
  trackItemIds: [],
  transitionIds: [],
  transitionsMap: {},
  trackItemsMap: {},
  activeIds: [],
  size: { width: 1920, height: 1080 },
  canUndo: false,
  canRedo: false,
  lastSavedAt: null,
  projectId: null,
  resetToken: 0,
  setStateManager: (stateManager) => set({ stateManager }),
  setTimeline: (timeline) => set({ timeline }),
  setPlayerRef: (playerRef) => set({ playerRef }),
  setScale: (scale) => set({ scale }),
  setState: (partial) => set(partial as any),
  setHistory: (canUndo, canRedo) => set({ canUndo, canRedo }),
  setLastSavedAt: (lastSavedAt) => set({ lastSavedAt }),
  setProjectId: (projectId) => set({ projectId }),
  bumpResetToken: () => set((s) => ({ resetToken: s.resetToken + 1 })),
  performUndo: null,
  performRedo: null,
  setHistoryHandlers: (performUndo, performRedo) =>
    set({ performUndo, performRedo }),

  addTransition: (transition) => {
    const { transitionIds, transitionsMap, stateManager } = get();
    // Remove any existing transition between the same pair
    const existingId = Object.keys(transitionsMap).find(
      (id) =>
        transitionsMap[id].fromId === transition.fromId &&
        transitionsMap[id].toId === transition.toId,
    );
    const nextIds = existingId
      ? transitionIds.filter((id) => id !== existingId)
      : [...transitionIds];
    const nextMap = { ...transitionsMap };
    if (existingId) delete nextMap[existingId];

    if (transition.kind !== 'none') {
      nextIds.push(transition.id);
      nextMap[transition.id] = transition;
    }

    set({ transitionIds: nextIds, transitionsMap: nextMap });

    // Sync to state manager so undo/redo and timeline canvas stay in sync
    if (stateManager) {
      stateManager.updateState(
        { transitionIds: nextIds, transitionsMap: nextMap },
        { kind: 'update', updateHistory: true },
      );
    }
  },

  removeTransition: (transitionId) => {
    const { transitionIds, transitionsMap, stateManager } = get();
    const nextIds = transitionIds.filter((id) => id !== transitionId);
    const nextMap = { ...transitionsMap };
    delete nextMap[transitionId];

    set({ transitionIds: nextIds, transitionsMap: nextMap });

    if (stateManager) {
      stateManager.updateState(
        { transitionIds: nextIds, transitionsMap: nextMap },
        { kind: 'update', updateHistory: true },
      );
    }
  },

  deleteActiveItems: () => {
    const s = get();
    if (!s.stateManager) return false;
    const deleteIds = new Set(
      s.activeIds.filter((id) => Boolean(s.trackItemsMap[id])),
    );
    if (deleteIds.size === 0) return false;

    const nextItemsMap: Record<string, ITrackItem> = { ...s.trackItemsMap };
    for (const id of deleteIds) {
      delete nextItemsMap[id];
    }

    let nextItemIds = s.trackItemIds.filter((id) => !deleteIds.has(id));

    const nextTransitionsMap: Record<string, ITransition> = {};
    for (const [id, tr] of Object.entries(s.transitionsMap)) {
      if (deleteIds.has(tr.fromId) || deleteIds.has(tr.toId)) continue;
      if (!nextItemsMap[tr.fromId] || !nextItemsMap[tr.toId]) continue;
      nextTransitionsMap[id] = tr;
    }
    const nextTransitionIds = s.transitionIds.filter((id) => nextTransitionsMap[id]);

    const tracksWithoutDeleted = s.tracks.map((track) => ({
      ...track,
      items: (track.items as string[]).filter((id) => !deleteIds.has(id)),
    }));

    const visualTracks = tracksWithoutDeleted.filter(
      (track) => track.type === 'video' || track.type === 'image',
    );
    const mainVisualTrack = visualTracks[0];
    let nextTracks = tracksWithoutDeleted;

    if (mainVisualTrack) {
      const orderIndex = new Map(nextItemIds.map((id, idx) => [id, idx]));
      const pooledVisualItems = visualTracks
        .flatMap((track) =>
          (track.items as string[])
            .map((id) => nextItemsMap[id] as any)
            .filter(Boolean),
        )
        .sort((a, b) => {
          const byTime = (a.display?.from ?? 0) - (b.display?.from ?? 0);
          if (byTime !== 0) return byTime;
          return (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0);
        });

      let cursor = 0;
      const packedVisualIds: string[] = [];
      for (const item of pooledVisualItems) {
        const from = item.display?.from ?? 0;
        const to = item.display?.to ?? from;
        const width = Math.max(0, to - from);
        nextItemsMap[item.id] = {
          ...item,
          display: { from: cursor, to: cursor + width },
          trackId: mainVisualTrack.id,
        };
        packedVisualIds.push(item.id);
        cursor += width;
      }

      nextTracks = tracksWithoutDeleted
        .filter((track) => {
          if (track === mainVisualTrack) return pooledVisualItems.length > 0;
          return track.type !== 'video' && track.type !== 'image';
        })
        .map((track) =>
          track === mainVisualTrack
            ? { ...track, items: packedVisualIds }
            : track,
        );

      const visualIdSet = new Set(packedVisualIds);
      const nonVisualIds = nextItemIds.filter((id) => !visualIdSet.has(id));
      nextItemIds = [...packedVisualIds, ...nonVisualIds];
    }

    let nextDuration = 0;
    for (const item of Object.values(nextItemsMap) as any[]) {
      const to = item?.display?.to ?? 0;
      if (to > nextDuration) nextDuration = to;
    }

    s.stateManager.updateState(
      {
        activeIds: [],
        duration: nextDuration || 5000,
        trackItemIds: nextItemIds,
        trackItemsMap: nextItemsMap,
        tracks: nextTracks,
        transitionIds: nextTransitionIds,
        transitionsMap: nextTransitionsMap,
      },
      { kind: 'update', updateHistory: true },
    );

    return true;
  },

  splitActiveAtPlayhead: () => {
    const s = get();
    if (s.activeIds.length !== 1) return false;
    const itemId = s.activeIds[0];
    const item = s.trackItemsMap[itemId] as any;
    if (!item) return false;
    if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'image') {
      return false;
    }

    // Read playhead from Remotion's player. getCurrentFrame() returns an
    // integer frame, so converting to ms via `frame * 1000 / fps` lands on
    // an exact frame boundary — no rounding needed, no sub-frame drift.
    const frame = s.playerRef?.current?.getCurrentFrame?.();
    if (frame == null) return false;
    const T = (frame * 1000) / s.fps;

    const df = item.display?.from ?? 0;
    const dt = item.display?.to ?? 0;
    if (dt <= df) return false;

    // Refuse to create zero-or-sub-frame fragments. Without this, an
    // accidental click at the very edge of a clip would produce a 1-frame
    // sliver that's painful to grab and unhelpful for the artist.
    const minGapMs = 1000 / s.fps;
    if (T <= df + minGapMs || T >= dt - minGapMs) return false;

    // Trim is optional on the schema but always populated for items seeded
    // by TimelineEditor. Fall back to a full-range trim for safety on
    // hand-added items that omit it.
    const trim = item.trim ?? { from: 0, to: dt - df };
    const cutOffset = T - df;
    const rightId = generateId();

    const left = {
      ...item,
      display: { from: df, to: T },
      trim: { from: trim.from, to: trim.from + cutOffset },
    };
    const right = {
      ...item,
      id: rightId,
      display: { from: T, to: dt },
      trim: { from: trim.from + cutOffset, to: trim.to },
      metadata: {
        ...(item.metadata || {}),
        // Convention used by the seed path + addVideoClip: resourceId ==
        // item id. Mirror it on the new half so anything keying off
        // resourceId stays consistent.
        resourceId: rightId,
      },
    };

    // Insert the right id immediately after the left id in both the global
    // trackItemIds order and the owning track's items[] array. Anything
    // listening to a stable id order (e.g. the pack reflow's sort) will
    // place the halves contiguously.
    const idx = s.trackItemIds.indexOf(itemId);
    if (idx === -1) return false;
    const nextItemIds = [...s.trackItemIds];
    nextItemIds.splice(idx + 1, 0, rightId);

    const nextTracks = s.tracks.map((t) => {
      const arr = t.items as string[];
      if (!arr.includes(itemId)) return t;
      const updated = [...arr];
      updated.splice(updated.indexOf(itemId) + 1, 0, rightId);
      return { ...t, items: updated };
    });

    // Transitions: outgoing (fromId === itemId) attaches to the new right
    // half — that's the side that ends at the next clip boundary now.
    // Incoming (toId === itemId) stays on the left (left's id is
    // unchanged).
    //
    // Validity check: a transition's duration must fit within both endpoint
    // clips' durations (it's a crossfade region that lives inside both).
    // After split, the affected half is shorter than the original clip, so
    // a transition that fit before may no longer fit. Drop those — the
    // Remotion `TransitionSeries` renderer can produce garbage frames or
    // throw when asked to play a transition longer than its host clip.
    // Conservative posture: silent drop. Artist gets clean state + undo;
    // they can re-add a shorter transition explicitly if they want one.
    const leftDuration = T - df;
    const rightDuration = dt - T;
    const droppedTransitionIds = new Set<string>();
    const nextTransitionsMap = { ...s.transitionsMap };
    for (const tid of Object.keys(nextTransitionsMap)) {
      const tr = nextTransitionsMap[tid];
      const trDuration = tr.duration ?? 0;
      if (tr.toId === itemId) {
        // Incoming: stays on left half. Drop if it no longer fits.
        if (trDuration > leftDuration) {
          droppedTransitionIds.add(tid);
        }
      } else if (tr.fromId === itemId) {
        // Outgoing: moves to the right half. Drop if it no longer fits;
        // otherwise rewire the fromId pointer.
        if (trDuration > rightDuration) {
          droppedTransitionIds.add(tid);
        } else {
          nextTransitionsMap[tid] = { ...tr, fromId: rightId };
        }
      }
    }
    for (const tid of droppedTransitionIds) {
      delete nextTransitionsMap[tid];
    }
    const nextTransitionIds = droppedTransitionIds.size
      ? s.transitionIds.filter((id) => !droppedTransitionIds.has(id))
      : s.transitionIds;

    const nextItemsMap = {
      ...s.trackItemsMap,
      [itemId]: left,
      [rightId]: right,
    };

    s.stateManager?.updateState(
      {
        trackItemIds: nextItemIds,
        trackItemsMap: nextItemsMap,
        tracks: nextTracks,
        transitionIds: nextTransitionIds,
        transitionsMap: nextTransitionsMap,
      },
      { kind: 'update', updateHistory: true },
    );

    return true;
  },
}));

export default useStore;
