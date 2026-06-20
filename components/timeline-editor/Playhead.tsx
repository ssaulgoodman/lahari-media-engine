import React, { useEffect, useRef, useState } from 'react';
import { timeMsToUnits, unitsToTimeMs } from '@designcombo/timeline';
import useStore from './store';
import { useCurrentPlayerFrame } from './use-current-frame';

const formatTimecode = (frame: number, fps: number) => {
  const safeFps = Math.max(1, fps || 30);
  const totalMs = Math.max(0, Math.round((frame / safeFps) * 1000));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const frames = Math.floor(((totalMs % 1000) / 1000) * safeFps);
  return `${minutes}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
};

const Playhead: React.FC<{ scrollLeft: number }> = ({ scrollLeft }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { playerRef, fps, scale } = useStore();
  const currentFrame = useCurrentPlayerFrame(playerRef);
  const position = timeMsToUnits((currentFrame / fps) * 1000, scale.zoom) - scrollLeft;

  const [dragging, setDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startPos, setStartPos] = useState(position);

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    setStartX(e.clientX);
    setStartPos(position);
  };

  useEffect(() => {
    if (!dragging) return;
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = 'ew-resize';
    const move = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      // startPos is scroll-relative (see `position` above: timeMsToUnits - scrollLeft).
      // Add scrollLeft back before converting to absolute time so dragging while
      // the timeline is scrolled seeks to the correct point.
      const newPos = startPos + delta + scrollLeft;
      const time = unitsToTimeMs(newPos, scale.zoom);
      playerRef?.current?.seekTo((time * fps) / 1000);
    };
    const up = () => setDragging(false);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.body.style.cursor = previousCursor;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [dragging, startX, startPos, scale.zoom, fps, playerRef, scrollLeft]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: 40 + position,
        top: 40,
        width: 18,
        height: 'calc(100% - 40px)',
        transform: 'translateX(-50%)',
        zIndex: 20,
        pointerEvents: 'none',
      }}
    >
      {dragging && (
        <div
          style={{
            position: 'absolute',
            top: -2,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '2px 5px',
            borderRadius: 5,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(15,15,19,0.92)',
            color: '#f4f4f5',
            fontSize: 10,
            fontFamily: 'monospace',
            lineHeight: '14px',
            whiteSpace: 'nowrap',
            boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
          }}
        >
          {formatTimecode(currentFrame, fps)}
        </div>
      )}
      <div
        onMouseDown={onDown}
        style={{
          position: 'absolute',
          top: 28,
          left: '50%',
          width: 14,
          height: 16,
          transform: 'translateX(-50%)',
          borderRadius: '7px 7px 4px 4px',
          background: dragging ? '#ffffff' : '#e4e4e7',
          border: '1px solid rgba(0,0,0,0.45)',
          boxShadow: dragging
            ? '0 0 0 3px rgba(255,255,255,0.12), 0 6px 18px rgba(0,0,0,0.45)'
            : '0 3px 10px rgba(0,0,0,0.35)',
          cursor: 'ew-resize',
          pointerEvents: 'auto',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 42,
          left: '50%',
          width: 2,
          height: 'calc(100% - 42px)',
          transform: 'translateX(-50%)',
          background: dragging ? '#ffffff' : '#d4d4d8',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
        }}
      />
      <div
        onMouseDown={onDown}
        style={{
          position: 'absolute',
          top: 42,
          left: '50%',
          width: 8,
          height: 'calc(100% - 42px)',
          transform: 'translateX(-50%)',
          background: 'transparent',
          cursor: 'ew-resize',
          pointerEvents: 'auto',
        }}
      />
    </div>
  );
};

export default Playhead;
