import React from 'react';
import { timeMsToUnits } from '@designcombo/timeline';
import useStore from './store';

// Renders editor markers as amber flags + stems over the timeline, positioned
// exactly like the Playhead (40px gutter + timeMsToUnits - scrollLeft). Click a
// flag to seek to it. Pure overlay — markers never touch the clip model.
const MarkersOverlay: React.FC<{ scrollLeft: number }> = ({ scrollLeft }) => {
  const { markers, scale, playerRef, fps } = useStore();
  if (!markers.length) return null;

  const seekTo = (ms: number) => {
    playerRef?.current?.seekTo((ms * fps) / 1000);
  };

  return (
    <>
      {markers.map((ms, index) => {
        const left = 40 + timeMsToUnits(ms, scale.zoom) - scrollLeft;
        if (left < 38) return null; // scrolled off the left gutter
        return (
          <div
            key={`${ms}-${index}`}
            style={{
              position: 'absolute',
              left,
              top: 40,
              height: 'calc(100% - 40px)',
              width: 0,
              zIndex: 15,
              pointerEvents: 'none',
            }}
          >
            <button
              type="button"
              onClick={() => seekTo(ms)}
              title={`Marker · click to seek`}
              style={{
                position: 'absolute',
                top: 0,
                left: -5,
                width: 10,
                height: 12,
                padding: 0,
                border: 'none',
                background: '#f59e0b',
                borderRadius: '2px 2px 0 0',
                clipPath: 'polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%)',
                cursor: 'pointer',
                pointerEvents: 'auto',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: 0,
                width: 1,
                height: 'calc(100% - 12px)',
                background: 'rgba(245, 158, 11, 0.55)',
              }}
            />
          </div>
        );
      })}
    </>
  );
};

export default MarkersOverlay;
