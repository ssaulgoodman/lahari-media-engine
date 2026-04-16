import React, { useEffect, useRef, useState } from 'react';
import { timeMsToUnits, unitsToTimeMs } from '@designcombo/timeline';
import useStore from './store';
import { useCurrentPlayerFrame } from './use-current-frame';

const Playhead: React.FC<{ scrollLeft: number }> = ({ scrollLeft }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { playerRef, fps, scale } = useStore();
  const currentFrame = useCurrentPlayerFrame(playerRef);
  const position = timeMsToUnits((currentFrame / fps) * 1000, scale.zoom) - scrollLeft;

  const [dragging, setDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startPos, setStartPos] = useState(position);

  const onDown = (e: React.MouseEvent) => {
    setDragging(true);
    setStartX(e.clientX);
    setStartPos(position);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newPos = startPos + delta;
      const time = unitsToTimeMs(newPos, scale.zoom);
      playerRef?.current?.seekTo((time * fps) / 1000);
    };
    const up = () => setDragging(false);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [dragging, startX, startPos, scale.zoom, fps, playerRef]);

  return (
    <div
      ref={ref}
      onMouseDown={onDown}
      style={{
        position: 'absolute',
        left: 40 + position,
        top: 80,
        width: 2,
        height: 'calc(100% - 80px)',
        background: '#d4d4d8',
        zIndex: 10,
        cursor: 'ew-resize',
      }}
    />
  );
};

export default Playhead;
