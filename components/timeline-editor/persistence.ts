// Client-side timeline snapshot persistence (localStorage, keyed by project id).
// Stores the render-authoritative subset of the zustand store — anything not
// here is transient UI state (scroll, zoom, activeIds, refs) and gets rebuilt
// on mount. Bump VERSION when the shape changes so stale blobs are ignored.

import type { ITrack, ITrackItem, ITransition } from '@designcombo/types';

export interface TimelineSnapshot {
  version: number;
  savedAt: number;
  trackItemIds: string[];
  trackItemsMap: Record<string, ITrackItem>;
  transitionIds: string[];
  transitionsMap: Record<string, ITransition>;
  tracks: ITrack[];
  duration: number;
  fps: number;
  size: { width: number; height: number };
}

export type SnapshotPayload = Omit<TimelineSnapshot, 'version' | 'savedAt'>;

// v3 invalidates pre-muted-flag timelines. Older snapshots restored scripted
// video items as effectively muted, even when the source clip carried native
// generated sound/dialogue.
const VERSION = 3;
const key = (projectId: string) => `lahari-timeline-${projectId}`;

export function saveSnapshot(projectId: string, data: SnapshotPayload): number | null {
  try {
    const snapshot: TimelineSnapshot = { ...data, version: VERSION, savedAt: Date.now() };
    localStorage.setItem(key(projectId), JSON.stringify(snapshot));
    return snapshot.savedAt;
  } catch (err) {
    console.error('[timeline-save]', err);
    return null;
  }
}

export function loadSnapshot(projectId: string): TimelineSnapshot | null {
  try {
    const raw = localStorage.getItem(key(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimelineSnapshot;
    if (parsed.version !== VERSION) return null;
    if (!parsed.trackItemsMap || !parsed.trackItemIds) return null;
    return parsed;
  } catch (err) {
    console.error('[timeline-load]', err);
    return null;
  }
}

export function clearSnapshot(projectId: string): void {
  try {
    localStorage.removeItem(key(projectId));
  } catch (err) {
    console.error('[timeline-clear]', err);
  }
}
