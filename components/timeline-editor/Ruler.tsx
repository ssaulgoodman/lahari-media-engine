import React, { useEffect, useRef, useState } from 'react';
import useStore from './store';
import {
  PREVIEW_FRAME_WIDTH,
  SECONDARY_FONT,
  SMALL_FONT_SIZE,
  TIMELINE_OFFSET_X,
  formatTimelineUnit,
} from './utils';

interface RulerProps {
  scrollLeft?: number;
  onClick?: (units: number) => void;
}

const HEIGHT = 40;

const Ruler: React.FC<RulerProps> = ({ scrollLeft = 0, onClick }) => {
  const { scale } = useStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ctxRef, setCtxRef] = useState<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    setCtxRef(ctx);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ctxRef) return;
    const parent = canvas.offsetParent as HTMLDivElement | null;
    const width = parent?.offsetWidth ?? canvas.offsetWidth;
    canvas.width = width;
    canvas.height = HEIGHT;
    draw(ctxRef, width);
  }, [ctxRef, scrollLeft, scale]);

  const draw = (ctx: CanvasRenderingContext2D, width: number) => {
    const { zoom, unit, segments } = scale;
    ctx.clearRect(0, 0, width, HEIGHT);
    ctx.save();
    ctx.strokeStyle = '#71717a';
    ctx.fillStyle = '#71717a';
    ctx.lineWidth = 1;
    ctx.font = `${SMALL_FONT_SIZE}px ${SECONDARY_FONT}`;
    ctx.textBaseline = 'top';
    ctx.translate(0.5, 0);

    const zoomUnit = unit * zoom * PREVIEW_FRAME_WIDTH;
    const minRange = Math.floor(scrollLeft / zoomUnit);
    const maxRange = Math.ceil((scrollLeft + width) / zoomUnit);
    const length = maxRange - minRange;

    for (let i = 0; i <= length; i++) {
      const value = i + minRange;
      if (value < 0) continue;
      const startValue = (value * zoomUnit) / zoom;
      const startPos = (startValue - scrollLeft / zoom) * zoom;
      if (startPos < -zoomUnit || startPos >= width + zoomUnit) continue;
      const text = formatTimelineUnit(startValue);
      const tw = ctx.measureText(text).width;
      ctx.fillText(text, startPos - tw / 2 + TIMELINE_OFFSET_X, 12);
    }

    for (let i = 0; i <= length; i++) {
      const value = i + minRange;
      if (value < 0) continue;
      const startValue = value * zoomUnit;
      const startPos = startValue - scrollLeft + TIMELINE_OFFSET_X;
      for (let j = 0; j < segments; j++) {
        const pos = startPos + (j / segments) * zoomUnit;
        if (pos < 0 || pos >= width) continue;
        const lineSize = j % segments ? 6 : 8;
        ctx.strokeStyle = lineSize === 6 ? '#a1a1aa' : '#d4d4d8';
        ctx.beginPath();
        ctx.moveTo(pos, 32);
        ctx.lineTo(pos, 32 + lineSize);
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !onClick) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    onClick(clickX + scrollLeft - TIMELINE_OFFSET_X);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: HEIGHT, borderTop: '1px solid #27272a' }}>
      <canvas ref={canvasRef} onClick={handleClick} height={HEIGHT} />
    </div>
  );
};

export default Ruler;
