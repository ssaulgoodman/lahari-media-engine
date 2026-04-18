import React from 'react';
import Composition, { type CompositionInput } from './timeline/Composition';

// Input props sent by the main backend. Mirrors the render-authoritative
// subset of the timeline store (see components/timeline-editor/store.ts). The
// project song is carried inside trackItemsMap as an audio item.
export interface TimelineRenderProps extends CompositionInput {
  // Total timeline length in milliseconds. Used by calculateMetadata in
  // Root.tsx to derive durationInFrames at render time.
  durationMs: number;
}

export const defaultRenderProps: TimelineRenderProps = {
  trackItemIds: [],
  trackItemsMap: {},
  transitionsMap: {},
  fps: 30,
  size: { width: 1920, height: 1080 },
  durationMs: 1000,
};

export const Video: React.FC<TimelineRenderProps> = (props) => (
  <Composition {...props} />
);
