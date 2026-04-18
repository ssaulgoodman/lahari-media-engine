import { ITimelineScaleState } from '@designcombo/types';

export const PREVIEW_FRAME_WIDTH = 188;
export const TIMELINE_OFFSET_X = 40;
export const SMALL_FONT_SIZE = 12;
export const SECONDARY_FONT = 'sans-serif';
export const FRAME_INTERVAL = 1000 / 60;
// DOM id assigned to the ruler+timeline canvases so zoom-fit can measure the
// visible width without plumbing refs down to the header.
export const TIMELINE_CANVAS_ID = 'lahari-timeline-canvas';

// Zoom steps tuned so unit*zoom stays on integer ratios — avoids fractional-
// pixel gridlines and keeps the ruler legible at both extremes. Ordered from
// most zoomed-out (index 0) to most zoomed-in (last). Mirrors the reference
// sample's scale table.
export const TIMELINE_ZOOM_LEVELS: ITimelineScaleState[] = [
  { index: 0, unit: 18000, zoom: 1 / 18000, segments: 5 },
  { index: 1, unit: 10800, zoom: 1 / 10800, segments: 5 },
  { index: 2, unit: 7200, zoom: 1 / 7200, segments: 5 },
  { index: 3, unit: 3600, zoom: 1 / 3600, segments: 5 },
  { index: 4, unit: 1800, zoom: 1 / 1800, segments: 5 },
  { index: 5, unit: 900, zoom: 1 / 900, segments: 5 },
  { index: 6, unit: 600, zoom: 1 / 600, segments: 5 },
  { index: 7, unit: 300, zoom: 1 / 300, segments: 5 },
  { index: 8, unit: 180, zoom: 1 / 180, segments: 3 },
  { index: 9, unit: 120, zoom: 1 / 120, segments: 10 },
  { index: 10, unit: 60, zoom: 1 / 60, segments: 3 },
  { index: 11, unit: 60, zoom: 1 / 60, segments: 4 },
  { index: 12, unit: 30, zoom: 1 / 30, segments: 5 },
];

export function getNextZoomLevel(cur: ITimelineScaleState): ITimelineScaleState {
  const larger = TIMELINE_ZOOM_LEVELS.filter((l) => l.zoom > cur.zoom);
  if (larger.length === 0) return cur;
  return larger.reduce((prev, curr) => (curr.zoom < prev.zoom ? curr : prev));
}

export function getPreviousZoomLevel(cur: ITimelineScaleState): ITimelineScaleState {
  const smaller = TIMELINE_ZOOM_LEVELS.filter((l) => l.zoom < cur.zoom);
  if (smaller.length === 0) return cur;
  return smaller.reduce((prev, curr) => (curr.zoom > prev.zoom ? curr : prev));
}

// Look up a preset zoom level by its index (0 = most zoomed out). Used by
// the slider in the timeline header.
export function getZoomByIndex(index: number): ITimelineScaleState {
  const clamped = Math.max(0, Math.min(TIMELINE_ZOOM_LEVELS.length - 1, Math.round(index)));
  return TIMELINE_ZOOM_LEVELS[clamped];
}

// Compute a zoom level where `totalLengthMs` fits exactly inside the visible
// timeline canvas. Returns a custom (non-snapped) zoom so the whole timeline
// is visible without scroll.
export function getFitZoomLevel(
  totalLengthMs: number,
  currentZoom = 1,
  scrollOffset = 16,
): ITimelineScaleState {
  const canvasEl = document.getElementById(TIMELINE_CANVAS_ID) as HTMLCanvasElement | null;
  const visibleWidth = Math.max(
    1,
    (canvasEl?.offsetWidth ?? document.body.offsetWidth) - Math.max(0, scrollOffset),
  );
  const fullWidth = Math.max(1, (totalLengthMs / 1000) * 60 * PREVIEW_FRAME_WIDTH * currentZoom);
  const targetZoom = currentZoom * (visibleWidth / fullWidth);
  // Pick a reasonable `index` to seed sliders/buttons with. We use the first
  // preset whose zoom exceeds our computed target.
  const fitIndex = Math.max(
    0,
    TIMELINE_ZOOM_LEVELS.findIndex((l) => l.zoom > targetZoom),
  );
  return {
    index: fitIndex,
    zoom: targetZoom,
    unit: 1 / targetZoom,
    segments: 5,
  };
}

export function formatTimelineUnit(units?: number): string {
  if (!units) return '0';
  const time = units / PREVIEW_FRAME_WIDTH;
  const frames = Math.trunc(time) % 60;
  const seconds = Math.trunc(time / 60) % 60;
  const minutes = Math.trunc(time / 3600) % 60;
  if (time < 60) return `${String(frames).padStart(2, '0')}f`;
  if (time < 3600) return `${seconds}s`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export const frameToTimeString = (frame: number, fps: number): string => {
  const total = frame / fps;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const ms = Math.floor((total - Math.floor(total)) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(ms).padStart(2, '0')}`;
};

export const timeToString = (ms: number): string => {
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const msR = Math.floor((total - Math.floor(total)) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(msR).padStart(2, '0')}`;
};

export const getCurrentTime = () => {
  const el = document.getElementById('timeline-editor-current-time');
  const sec = el ? parseFloat(el.getAttribute('data-current-time') || '0') : 0;
  return sec * 1000;
};
