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
  setStateManager: (s: StateManager) => void;
  setTimeline: (t: CanvasTimeline) => void;
  setPlayerRef: (r: React.RefObject<PlayerRef> | null) => void;
  setScale: (s: ITimelineScaleState) => void;
  setState: (partial: Partial<ITimelineStore>) => void;
}

const useStore = create<ITimelineStore>((set) => ({
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
  setStateManager: (stateManager) => set({ stateManager }),
  setTimeline: (timeline) => set({ timeline }),
  setPlayerRef: (playerRef) => set({ playerRef }),
  setScale: (scale) => set({ scale }),
  setState: (partial) => set(partial as any),
}));

export default useStore;
