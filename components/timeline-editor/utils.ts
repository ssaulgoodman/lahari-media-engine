import { ITimelineScaleState } from '@designcombo/types';

export const PREVIEW_FRAME_WIDTH = 188;
export const TIMELINE_OFFSET_X = 40;
export const SMALL_FONT_SIZE = 12;
export const SECONDARY_FONT = 'sans-serif';
export const FRAME_INTERVAL = 1000 / 60;

export const TIMELINE_ZOOM_LEVELS: ITimelineScaleState[] = (
  [
    { unit: 18000, zoom: 1 / 12000, segments: 5 },
    { unit: 10800, zoom: 1 / 7200, segments: 3 },
    { unit: 7200, zoom: 1 / 6000, segments: 2 },
    { unit: 3600, zoom: 1 / 3000, segments: 1 },
    { unit: 1800, zoom: 1 / 1200, segments: 2 },
    { unit: 900, zoom: 1 / 600, segments: 3 },
    { unit: 600, zoom: 1 / 450, segments: 2 },
    { unit: 300, zoom: 1 / 240, segments: 5 },
    { unit: 180, zoom: 1 / 150, segments: 3 },
    { unit: 120, zoom: 1 / 120, segments: 10 },
    { unit: 60, zoom: 1 / 90, segments: 5 },
    { unit: 60, zoom: 1 / 60, segments: 5 },
    { unit: 30, zoom: 1 / 30, segments: 2 },
    { unit: 15, zoom: 1 / 15, segments: 3 },
    { unit: 10, zoom: 1 / 10, segments: 2 },
    { unit: 5, zoom: 1 / 5, segments: 5 },
    { unit: 3, zoom: 1 / 3, segments: 3 },
    { unit: 2, zoom: 1 / 2, segments: 5 },
    { unit: 1, zoom: 1, segments: 5 },
  ] as Omit<ITimelineScaleState, 'index'>[]
).map((level, index) => ({ ...level, index }));

const findIdx = (arr: ITimelineScaleState[], p: (v: ITimelineScaleState) => boolean) => {
  let l = -1, r = arr.length - 1;
  while (1 + l < r) {
    const mid = l + ((r - l) >> 1);
    p(arr[mid]) ? (r = mid) : (l = mid);
  }
  return r;
};

export function getNextZoomLevel(cur: ITimelineScaleState): ITimelineScaleState {
  const idx = Math.min(TIMELINE_ZOOM_LEVELS.length - 1, findIdx(TIMELINE_ZOOM_LEVELS, (l) => l.zoom > cur.zoom));
  return TIMELINE_ZOOM_LEVELS[idx];
}

export function getPreviousZoomLevel(cur: ITimelineScaleState): ITimelineScaleState {
  const last = TIMELINE_ZOOM_LEVELS.at(-1);
  const isLast = cur === last;
  const nextIdx = findIdx(TIMELINE_ZOOM_LEVELS, (l) => l.zoom > cur.zoom);
  return TIMELINE_ZOOM_LEVELS[Math.max(0, nextIdx - (isLast ? 1 : 2))];
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
