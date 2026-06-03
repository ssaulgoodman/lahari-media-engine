import React, { useEffect, useState } from 'react';
import { dispatch } from '@designcombo/events';
import {
  TIMELINE_SCALE_CHANGED,
} from '@designcombo/state';
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
  Trash,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Undo2,
  Redo2,
  Save,
  RotateCcw,
  Check,
  Scissors,
} from 'lucide-react';
import useStore from './store';
import { useCurrentPlayerFrame } from './use-current-frame';
import { saveSnapshot, clearSnapshot } from './persistence';
import { clearProjectTimeline, saveProjectTimeline } from '../../services/api';
import {
  frameToTimeString,
  timeToString,
  getFitZoomLevel,
  getZoomByIndex,
  TIMELINE_ZOOM_LEVELS,
} from './utils';

const btn: React.CSSProperties = {
  background: 'transparent',
  color: '#a1a1aa',
  border: 'none',
  height: 28,
  width: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'color 0.15s, background 0.15s',
};

const btnDisabled: React.CSSProperties = { ...btn, opacity: 0.3, cursor: 'not-allowed' };

// Coarse "Saved Xs ago" formatter. Buckets are wide enough that a 30s tick
// cadence (see the interval below) is plenty — once you're past a minute,
// the string only changes once per minute anyway.
const formatSavedAgo = (savedAt: number, nowTs: number): string => {
  const s = Math.max(0, Math.floor((nowTs - savedAt) / 1000));
  if (s < 10) return 'Saved just now';
  if (s < 60) return `Saved ${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `Saved ${m}m ago`;
  const h = Math.floor(m / 60);
  return `Saved ${h}h ago`;
};

const playBtnStyle: React.CSSProperties = {
  ...btn,
  width: 30,
  height: 30,
  borderRadius: '50%',
  background: 'rgba(255,255,255,0.06)',
  color: '#e5e5e5',
};

const Header: React.FC = () => {
  const { duration, fps, scale, playerRef, activeIds } = useStore();
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const performUndo = useStore((s) => s.performUndo);
  const performRedo = useStore((s) => s.performRedo);
  const lastSavedAt = useStore((s) => s.lastSavedAt);
  const timelineVersion = useStore((s) => s.timelineVersion);
  const timelineSaveState = useStore((s) => s.timelineSaveState);
  const timelineSaveMessage = useStore((s) => s.timelineSaveMessage);
  const projectId = useStore((s) => s.projectId);
  const initialVideoSrcs = useStore((s) => s.initialVideoSrcs);
  const initialAudioSrcs = useStore((s) => s.initialAudioSrcs);
  const bumpResetToken = useStore((s) => s.bumpResetToken);
  const setLastSavedAt = useStore((s) => s.setLastSavedAt);
  const setTimelineVersion = useStore((s) => s.setTimelineVersion);
  const setTimelineSaveState = useStore((s) => s.setTimelineSaveState);
  const deleteActiveItems = useStore((s) => s.deleteActiveItems);
  const splitActiveAtPlayhead = useStore((s) => s.splitActiveAtPlayhead);
  const trackItemsMap = useStore((s) => s.trackItemsMap);
  const currentFrame = useCurrentPlayerFrame(playerRef);
  const disabled = !activeIds.length;

  // Cheap enable check: gates the Split button on "is a splittable item
  // selected, and is the playhead inside its range?" The playhead read here
  // is currentFrame (already reactive via useCurrentPlayerFrame), so the
  // button enables/disables as the artist scrubs.
  const canSplit = (() => {
    if (activeIds.length !== 1) return false;
    const item = trackItemsMap[activeIds[0]] as any;
    if (!item) return false;
    if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'image') return false;
    const T = (currentFrame * 1000) / fps;
    const df = item.display?.from ?? 0;
    const dt = item.display?.to ?? 0;
    const minGap = 1000 / fps;
    return T > df + minGap && T < dt - minGap;
  })();

  // Cheap clock for the "Saved Xs ago" pill — 30s cadence (vs the naïve 1s
  // ticker I wrote first). Only runs while a save is actually on screen, and
  // we also bump nowTs immediately when lastSavedAt changes so the label
  // flips from "Saved 2m ago" back to "Saved just now" the instant the user
  // hits Save instead of lagging up to 30s.
  const [nowTs, setNowTs] = useState(() => Date.now());
  // Visual confirmation for the Save click: the icon swaps to a green check
  // for ~1.2s after a successful save. Without this, clicking Save when
  // "Saved just now" is already showing gives no feedback at all.
  const [justSaved, setJustSaved] = useState(false);
  const firstSavedSeenRef = React.useRef<number | null>(null);
  useEffect(() => {
    if (lastSavedAt == null) return;
    setNowTs(Date.now());
    // Skip the flash on the initial hydration from disk — only flash when
    // lastSavedAt advances past the first value we saw in this mount.
    if (firstSavedSeenRef.current === null) {
      firstSavedSeenRef.current = lastSavedAt;
    } else if (lastSavedAt !== firstSavedSeenRef.current) {
      firstSavedSeenRef.current = lastSavedAt;
      setJustSaved(true);
      const flashId = window.setTimeout(() => setJustSaved(false), 1200);
      const id = window.setInterval(() => setNowTs(Date.now()), 30_000);
      return () => {
        window.clearTimeout(flashId);
        window.clearInterval(id);
      };
    }
    const id = window.setInterval(() => setNowTs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [lastSavedAt]);

  const handleSave = async () => {
    if (!projectId) return;
    const s = useStore.getState();
    if (s.trackItemIds.length === 0) return;
    const snapshot = {
      initialVideoSrcs,
      initialAudioSrcs,
      trackItemIds: s.trackItemIds,
      trackItemsMap: s.trackItemsMap,
      transitionIds: s.transitionIds,
      transitionsMap: s.transitionsMap,
      tracks: s.tracks,
      duration: s.duration,
      fps: s.fps,
      size: s.size,
    };
    setTimelineSaveState('saving');
    try {
      const result = await saveProjectTimeline(projectId, snapshot, timelineVersion);
      setTimelineVersion(result.version);
      setTimelineSaveState('saved');
    } catch (err: any) {
      const message = err?.message || 'Timeline save failed';
      setTimelineSaveState(message.includes('changed elsewhere') ? 'conflict' : 'error', message);
      return;
    }
    const savedAt = saveSnapshot(projectId, snapshot);
    if (savedAt != null) setLastSavedAt(savedAt);
  };

  const handleReset = async () => {
    if (!projectId) return;
    if (!confirm('Reset the shared timeline to the original shot videos? Everyone using this project will lose the current timeline draft.'))
      return;
    try {
      await clearProjectTimeline(projectId);
      setTimelineVersion(null);
      setTimelineSaveState('idle');
    } catch (err: any) {
      setTimelineSaveState('error', err?.message || 'Timeline reset failed');
      return;
    }
    clearSnapshot(projectId);
    setLastSavedAt(null);
    bumpResetToken();
  };

  const togglePlay = () => {
    const p = playerRef?.current;
    if (!p) return;
    p.isPlaying() ? p.pause() : p.play();
  };

  const skipBack = () => {
    const p = playerRef?.current;
    if (!p) return;
    p.seekTo(Math.max(0, Math.round(p.getCurrentFrame()) - fps * 5));
  };

  const skipForward = () => {
    const p = playerRef?.current;
    if (!p) return;
    const maxFrame = Math.round((duration / 1000) * fps);
    p.seekTo(Math.min(maxFrame, Math.round(p.getCurrentFrame()) + fps * 5));
  };

  const isPlaying = playerRef?.current?.isPlaying?.() ?? false;

  return (
    <div
      style={{
        position: 'relative',
        height: 44,
        borderTop: '1px solid #27272a',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 4,
      }}
    >
      {/* Left: delete + transport */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <button
          style={disabled ? btnDisabled : btn}
          disabled={disabled}
          onClick={() => deleteActiveItems()}
          title="Delete selected (Del/Backspace)"
        >
          <Trash size={15} />
        </button>
        <button
          style={canSplit ? btn : btnDisabled}
          disabled={!canSplit}
          onClick={() => splitActiveAtPlayhead()}
          title="Split at playhead (S)"
        >
          <Scissors size={14} />
        </button>

        <div style={{ width: 1, height: 18, background: '#27272a', margin: '0 6px' }} />

        <button style={btn} onClick={skipBack} title="Skip back 5s">
          <SkipBack size={14} />
        </button>
        <button style={playBtnStyle} onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause size={14} /> : <Play size={14} style={{ marginLeft: 1 }} />}
        </button>
        <button style={btn} onClick={skipForward} title="Skip forward 5s">
          <SkipForward size={14} />
        </button>
      </div>

      {/* Center: time display */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
        <span
          style={{ fontSize: 12, fontFamily: 'monospace', color: '#e4e4e7', fontWeight: 500 }}
          data-current-time={currentFrame / fps}
          id="timeline-editor-current-time"
        >
          {frameToTimeString(currentFrame, fps)}
        </span>
        <span style={{ color: '#3f3f46', fontSize: 11 }}>/</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#52525b' }}>
          {timeToString(duration)}
        </span>
      </div>

      {/* Right: history + save cluster, then zoom cluster. Kept compact —
          these buttons don't ever need labels since the timeline context
          makes their meaning unambiguous. */}
      {projectId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginRight: 2 }}>
          {/* Session-only undo/redo — replays full state snapshots from
              memory rather than designcombo's diff history. Stack clears on
              page reload (intentional: snapshots are kept in a closure inside
              TimelineEditor, not persisted). */}
          <button
            style={canUndo ? btn : btnDisabled}
            disabled={!canUndo || !performUndo}
            onClick={() => performUndo?.()}
            title="Undo (Ctrl/Cmd+Z)"
          >
            <Undo2 size={14} />
          </button>
          <button
            style={canRedo ? btn : btnDisabled}
            disabled={!canRedo || !performRedo}
            onClick={() => performRedo?.()}
            title="Redo (Shift+Ctrl/Cmd+Z)"
          >
            <Redo2 size={14} />
          </button>
          <button
            style={justSaved ? { ...btn, color: '#4ade80' } : btn}
            onClick={handleSave}
            title="Save timeline"
          >
            {justSaved ? <Check size={14} /> : <Save size={14} />}
          </button>
          <button style={btn} onClick={handleReset} title="Reset to original shot videos">
            <RotateCcw size={14} />
          </button>
          {timelineSaveState === 'saving' && (
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#71717a', marginLeft: 4 }}>
              Saving…
            </span>
          )}
          {timelineSaveState !== 'saving' && lastSavedAt != null && (
            <span
              style={{
                fontSize: 11,
                fontFamily: 'monospace',
                color: timelineSaveState === 'conflict' || timelineSaveState === 'error' ? '#f87171' : '#52525b',
                marginLeft: 4,
              }}
              title={timelineSaveMessage || `Saved to project at ${new Date(lastSavedAt).toLocaleString()}`}
            >
              {timelineSaveState === 'conflict'
                ? 'Updated elsewhere'
                : timelineSaveState === 'error'
                  ? 'Save failed'
                  : formatSavedAgo(lastSavedAt, nowTs)}
            </span>
          )}
          <div style={{ width: 1, height: 18, background: '#27272a', margin: '0 6px' }} />
        </div>
      )}

      {/* Zoom — slider walks through the TIMELINE_ZOOM_LEVELS presets;
          fit button snaps to a custom zoom that shows the entire timeline. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ZoomOut size={13} style={{ color: '#71717a', flexShrink: 0 }} />
        <input
          type="range"
          min={0}
          max={TIMELINE_ZOOM_LEVELS.length - 1}
          step={1}
          value={
            // When `fit` is active the scale.zoom is off-preset and index
            // lookup returns -1. We clamp to the closest preset index so the
            // thumb doesn't jump to 0.
            scale.index >= 0
              ? scale.index
              : Math.max(
                  0,
                  TIMELINE_ZOOM_LEVELS.findIndex((l) => l.zoom >= scale.zoom),
                )
          }
          onChange={(e) => {
            const next = getZoomByIndex(parseInt(e.target.value, 10));
            dispatch(TIMELINE_SCALE_CHANGED, { payload: { scale: next } });
          }}
          className="lahari-zoom-slider"
          style={{
            width: 100,
            accentColor: '#a1a1aa',
            cursor: 'pointer',
          }}
          title={`Zoom (${scale.index + 1}/${TIMELINE_ZOOM_LEVELS.length})`}
        />
        <ZoomIn size={13} style={{ color: '#71717a', flexShrink: 0 }} />
        <button
          style={btn}
          onClick={() =>
            dispatch(TIMELINE_SCALE_CHANGED, {
              payload: { scale: getFitZoomLevel(duration, scale.zoom) },
            })
          }
          title="Fit to screen"
        >
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  );
};

export default Header;
