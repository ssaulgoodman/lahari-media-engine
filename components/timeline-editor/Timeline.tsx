import React, { useEffect, useRef, useState } from 'react';
import CanvasTimeline, { timeMsToUnits, unitsToTimeMs } from '@designcombo/timeline';
import useStore from './store';
import Header from './Header';
import Ruler from './Ruler';
import Playhead from './Playhead';
import TransitionOverlay from './TransitionOverlay';
import { Audio, Image, Text, Video } from './items';
import { TIMELINE_CANVAS_ID } from './utils';

CanvasTimeline.registerItems({ Text, Image, Audio, Video });

const SIZES_MAP = { text: 42, image: 42, audio: 42, video: 42 };
const ACCEPTS_MAP = {
  text: ['text'],
  image: ['image'],
  audio: ['audio'],
  video: ['video'],
};

const Timeline: React.FC = () => {
  const [scrollLeft, setScrollLeft] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<CanvasTimeline | null>(null);
  const { scale, playerRef, fps, stateManager, setTimeline } = useStore();

  useEffect(() => {
    const canvasEl = canvasElRef.current;
    const containerEl = containerRef.current;
    if (!canvasEl || !containerEl || !stateManager) return;

    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    const canvas = new (CanvasTimeline as any)(canvasEl, {
      width,
      height,
      bounding: { width, height: 0 },
      selectionColor: 'rgba(129,140,248,0.12)',
      selectionBorderColor: 'rgba(129,140,248,0.9)',
      tScale: scale.zoom,
      scale,
      duration: 5000,
      state: stateManager,
      itemTypes: ['video', 'audio', 'image', 'text'],
      sizesMap: SIZES_MAP,
      acceptsMap: ACCEPTS_MAP,
      spacing: { left: 0, right: 80 },
      onScroll: (v: { scrollLeft: number; scrollTop: number }) => setScrollLeft(v.scrollLeft),
    });

    // Wires up the canvas-library's wheel handler + visible scrollbar. Without
    // this call the timeline has no horizontal scroll — zoom in past the
    // viewport and you can't reach the offscreen content.
    canvas.initScrollbars({
      scrollbarWidth: 8,
      scrollbarColor: 'rgba(161,161,170,0.45)',
      extraMarginX: 200,
      extraMarginY: 0,
    });

    // The library notifies scroll changes through TWO separate channels:
    //   - wheel scroll  → setViewportPos       → fires the `onScroll` option above
    //   - scrollbar drag → setViewportTransform → fires `onViewportChange`
    // Without wiring `onViewportChange`, dragging the bottom scrollbar moves
    // clips on screen but React's `scrollLeft` state stays at 0, so the Ruler,
    // Playhead, and TransitionOverlay keep painting at scrollLeft=0 while the
    // canvas underneath is at a different viewport. That's the "clips move
    // but the time ruler doesn't follow" bug.
    canvas.onViewportChange?.((left: number) => setScrollLeft(left));

    canvasRef.current = canvas;
    setTimeline(canvas);

    return () => {
      canvas.disposeScrollbars?.();
      canvas.purge();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateManager]);

  useEffect(() => {
    canvasRef.current?.setScale(scale);
  }, [scale]);

  const onClickRuler = (units: number) => {
    const time = unitsToTimeMs(units, scale.zoom);
    playerRef?.current?.seekTo((time * fps) / 1000);
  };

  return (
    <div style={{ position: 'relative', overflow: 'hidden', background: '#0f0f13' }}>
      <Header />
      <Ruler scrollLeft={scrollLeft} onClick={onClickRuler} />
      <Playhead scrollLeft={scrollLeft} />
      <div style={{ display: 'flex' }}>
        <div style={{ width: 40, flex: 'none' }} />
        <div style={{ position: 'relative', height: 240, flex: 1 }}>
          <div
            ref={containerRef}
            style={{ position: 'absolute', top: 0, width: '100%', height: 240, color: '#fff', fontSize: 14 }}
          >
            <canvas ref={canvasElRef} id={TIMELINE_CANVAS_ID} />
          </div>
          <TransitionOverlay scrollLeft={scrollLeft} />
        </div>
      </div>
    </div>
  );
};

export default Timeline;
