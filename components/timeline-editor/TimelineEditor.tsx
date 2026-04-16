import React, { useEffect, useRef } from 'react';
import { dispatch } from '@designcombo/events';
import StateManager, { ADD_VIDEO } from '@designcombo/state';
import { generateId } from '@designcombo/timeline';
import Player from './Player';
import Timeline from './Timeline';
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

// Dispatch an ADD_VIDEO that appends to the first existing video track (or
// creates one when the timeline is empty).
const addVideoClip = (src: string, name?: string) => {
  const id = generateId();
  const from = nextStartMs();
  const existingTrack = useStore.getState().tracks.find((t) => t.type === 'video');
  dispatch(ADD_VIDEO, {
    payload: {
      id,
      display: { from, to: from + 5000 },
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

// Wait until the newly-dispatched item lands in the store. The add-video
// handler is async (it probes the video's real duration before committing),
// so seeding multiple clips requires awaiting each one to keep display.from
// values sequential.
const waitForItem = (id: string, timeoutMs = 8000) =>
  new Promise<void>((resolve) => {
    const start = Date.now();
    const check = () => {
      if (useStore.getState().trackItemsMap[id]) return resolve();
      if (Date.now() - start > timeoutMs) return resolve();
      setTimeout(check, 30);
    };
    check();
  });

const TimelineEditor: React.FC<Props> = ({ onExit, initialClips, embedded }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { playerRef, setStateManager, setState, stateManager } = useStore();
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

  // Seed with initialClips after the state manager is ready. Dispatches
  // sequentially so each clip's display.from reads a fully-committed previous
  // clip's display.to (probe-corrected duration).
  useEffect(() => {
    if (!stateManager || !initialClips?.length) return;
    let cancelled = false;
    (async () => {
      for (const clip of initialClips) {
        if (cancelled) return;
        const id = addVideoClip(clip.src, clip.name);
        await waitForItem(id);
      }
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

      {playerRef && stateManager && <Timeline />}
    </div>
  );
};

export default TimelineEditor;
