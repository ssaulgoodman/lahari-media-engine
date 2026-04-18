import React from 'react';
import { dispatch } from '@designcombo/events';
import { TIMELINE_SCALE_CHANGED, LAYER_DELETE } from '@designcombo/state';
import { Maximize2, ZoomIn, ZoomOut, Trash, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import useStore from './store';
import { useCurrentPlayerFrame } from './use-current-frame';
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
  const currentFrame = useCurrentPlayerFrame(playerRef);
  const disabled = !activeIds.length;

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
          onClick={() => dispatch(LAYER_DELETE, { payload: { trackItemIds: activeIds }, options: {} })}
          title="Delete selected"
        >
          <Trash size={15} />
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

      {/* Right: zoom — slider walks through the TIMELINE_ZOOM_LEVELS presets;
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
