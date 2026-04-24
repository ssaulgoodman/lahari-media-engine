import CanvasTimeline from '@designcombo/timeline';
import { ITimelineScaleState, ITrack, ITrackItem, ITransition } from '@designcombo/types';
import StateManager from '@designcombo/state';
import { PlayerRef } from '@remotion/player';
import { create } from 'zustand';

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
  addTransition: (transition: ITransition) => void;
  removeTransition: (transitionId: string) => void;
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
}));

export default useStore;
