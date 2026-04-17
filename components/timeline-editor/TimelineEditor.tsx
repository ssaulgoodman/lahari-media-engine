import React, { useEffect, useRef, useState } from 'react';
import { dispatch } from '@designcombo/events';
import StateManager, { ADD_VIDEO } from '@designcombo/state';
import { generateId } from '@designcombo/timeline';
import Player from './Player';
import Timeline from './Timeline';
import EffectsPanel from './EffectsPanel';
import useStore from './store';
import useTimelineEvents from './use-timeline-events';

export type InitialClip = { src: string; name?: string };

interface Props {
  onExit?: () => void;
  // Pre-populate the timeline with these clips on mount, appended in order.
  initialClips?: InitialClip[];
  // When true: fills its parent instead of 100vh, hides the top bar, and
  // the upload toolbar becomes a compact corner control. For embedding in
  // another page (e.g. StepRender) as a live preview.
  embedded?: boolean;
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

// Compute the next clip start position from what's already in the store.
const nextStartMs = () => {
  const map = useStore.getState().trackItemsMap;
  let max = 0;
  Object.values(map).forEach((it) => {
    if (it?.display?.to != null && it.display.to > max) max = it.display.to;
  });
  return max;
};

// Probe a video URL's real duration using a hidden <video> element. Used by
// the seeder below; lets us build the full timeline state synchronously and
// commit it via stateManager.updateState without touching the event bus.
const probeDurationMs = (src: string): Promise<number> =>
  new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (ms: number) => {
      v.onloadedmetadata = null;
      v.onerror = null;
      v.removeAttribute('src');
      v.load();
      resolve(ms);
    };
    v.onloadedmetadata = () => {
      const d = v.duration;
      done(isFinite(d) && d > 0 ? Math.round(d * 1000) : 5000);
    };
    v.onerror = () => done(5000);
    v.src = src;
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
      metadata: { resourceId: id },
    },
    options: existingTrack
      ? { targetTrackId: existingTrack.id, isNewTrack: false }
      : {},
  });
  return id;
};

const tabBtn = (active: boolean): React.CSSProperties => ({
  background: active ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)',
  border: active ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(255,255,255,0.06)',
  color: active ? '#fff' : '#a1a1aa',
  padding: '5px 12px',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
  transition: 'all 0.15s',
});

const TimelineEditor: React.FC<Props> = ({ onExit, initialClips, embedded }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { playerRef, setStateManager, setState, stateManager } = useStore();
  const [sidePanel, setSidePanel] = useState<'effects' | null>(null);
  useTimelineEvents();

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

    return () => {
      sub.unsubscribe();
      durSub.unsubscribe();
      scaleSub.unsubscribe();
      activeSub.unsubscribe();
      sm.purge();
      setStateManager(null as any);
    };
  }, [setStateManager, setState]);

  // Seed with initialClips by probing durations ourselves and committing the
  // full state via stateManager.updateState. This bypasses the global
  // @designcombo/events bus, which under React 18 StrictMode (double-mount)
  // would leak dispatches from sm1's IIFE into sm2's state and throw
  // "Target track not found" because sm2 doesn't know sm1's track IDs.
  //
  // Re-seed trigger: URL signature change (regen, project switch). seededKeyRef
  // prevents a stable prop reference from re-triggering on every render.
  const seededKeyRef = useRef<string>('');
  useEffect(() => {
    if (!stateManager) return;
    const key = (initialClips ?? []).map((c) => c.src).join('|');
    if (seededKeyRef.current === key) return;

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

      if (!initialClips?.length) {
        seededKeyRef.current = key;
        return;
      }

      // Probe all durations in parallel — much faster than serial and
      // side-effect free.
      const durations = await Promise.all(initialClips.map((c) => probeDurationMs(c.src)));
      if (cancelled) return;
      // If the stateManager we captured has been replaced (StrictMode
      // cleanup during probe), bail — the new sm's seed effect will take
      // over with its own capture.
      if (useStore.getState().stateManager !== stateManager) return;

      const trackId = generateId();
      const trackItemIds: string[] = [];
      const trackItemsMap: Record<string, any> = {};
      let from = 0;
      for (let i = 0; i < initialClips.length; i++) {
        const clip = initialClips[i];
        const dur = durations[i] || 5000;
        const itemId = generateId();
        trackItemIds.push(itemId);
        trackItemsMap[itemId] = {
          id: itemId,
          type: 'video',
          display: { from, to: from + dur },
          details: { src: clip.src, volume: 100, ...(clip.name ? { name: clip.name } : {}) },
          metadata: { resourceId: itemId },
          trackId,
          isMain: true,
          duration: dur,
          playbackRate: 1,
          trim: { from: 0, to: dur },
        };
        from += dur;
      }
      const tracks = [{ id: trackId, type: 'video', items: trackItemIds, accepts: ['video'] }];

      if (cancelled) return;
      (stateManager as any).updateState(
        {
          tracks,
          trackItemIds,
          trackItemsMap,
          transitionIds: [],
          transitionsMap: {},
          duration: from,
        },
        { kind: 'update', updateHistory: false },
      );
      seededKeyRef.current = key;
    })();
    return () => {
      cancelled = true;
    };
  }, [stateManager, initialClips]);

  const handleUpload = (files: File[]) => {
    if (!files[0]) return;
    addVideoClip(URL.createObjectURL(files[0]), files[0].name);
  };

  const uploadControl = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={(e) => handleUpload(Array.from(e.target.files || []))}
      />
      <button style={toolbarBtn} onClick={() => fileInputRef.current?.click()}>
        Upload video
      </button>
      <button
        style={tabBtn(sidePanel === 'effects')}
        onClick={() => setSidePanel((cur) => (cur === 'effects' ? null : 'effects'))}
      >
        Effects
      </button>
    </>
  );

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

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'row',
        }}
      >
        {/* Main area: player + controls */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: '100%', maxWidth: 960, flex: 1, display: 'flex', padding: 16 }}>
            {stateManager ? <Player /> : null}
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '16px 0' }}>{uploadControl}</div>
        </div>

        {/* Side panel: Effects */}
        {sidePanel === 'effects' && <EffectsPanel />}
      </div>

      {playerRef && stateManager && <Timeline />}
    </div>
  );
};

export default TimelineEditor;
