import React from 'react';
import { dispatch } from '@designcombo/events';
import { TIMELINE_SCALE_CHANGED, LAYER_DELETE } from '@designcombo/state';
import { ZoomIn, ZoomOut, Trash } from 'lucide-react';
import useStore from './store';
import { useCurrentPlayerFrame } from './use-current-frame';
import { frameToTimeString, timeToString, getNextZoomLevel, getPreviousZoomLevel } from './utils';

const btn = {
  background: 'transparent',
  color: '#e5e5e5',
  border: 'none',
  height: 32,
  width: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  cursor: 'pointer',
} as const;

const btnDisabled = { ...btn, opacity: 0.4, cursor: 'not-allowed' };

const Header: React.FC = () => {
  const { duration, fps, scale, playerRef, activeIds } = useStore();
  const currentFrame = useCurrentPlayerFrame(playerRef);

  const disabled = !activeIds.length;

  return (
    <div
      style={{
        position: 'relative',
        height: 50,
        boxShadow: 'inset 0 1px 0 0 #27272a',
        flex: 'none',
        display: 'grid',
        gridTemplateColumns: '1fr 200px 1fr',
        alignItems: 'center',
      }}
    >
      <div style={{ paddingLeft: 16, display: 'flex', gap: 4 }}>
        <button
          style={disabled ? btnDisabled : btn}
          disabled={disabled}
          onClick={() => dispatch(LAYER_DELETE, { payload: { trackItemIds: activeIds }, options: {} })}
        >
          <Trash size={18} />
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '72px 8px 72px',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
        }}
      >
        <div
          style={{ display: 'flex', justifyContent: 'center', color: '#e4e4e7', fontWeight: 500 }}
          data-current-time={currentFrame / fps}
          id="timeline-editor-current-time"
        >
          {frameToTimeString(currentFrame, fps)}
        </div>
        <span style={{ color: '#52525b' }}>|</span>
        <div style={{ display: 'flex', justifyContent: 'center', color: '#71717a' }}>
          {timeToString(duration)}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingRight: 16, gap: 4 }}>
        <button
          style={btn}
          onClick={() => dispatch(TIMELINE_SCALE_CHANGED, { payload: { scale: getPreviousZoomLevel(scale) } })}
        >
          <ZoomOut size={20} />
        </button>
        <button
          style={btn}
          onClick={() => dispatch(TIMELINE_SCALE_CHANGED, { payload: { scale: getNextZoomLevel(scale) } })}
        >
          <ZoomIn size={20} />
        </button>
      </div>
    </div>
  );
};

export default Header;
