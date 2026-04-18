import React, { type ComponentType } from 'react';
import { Composition as RemotionComposition } from 'remotion';
import { Video, defaultRenderProps, type TimelineRenderProps } from './Video';

// Remotion's <Composition> wants props typed as `Record<string, unknown>`.
// Cast on the way in — TimelineRenderProps is the real shape and we keep
// it on Video itself so the inner code stays well-typed.
const VideoForRemotion = Video as unknown as ComponentType<Record<string, unknown>>;

// Single registered composition. Width/height/duration are placeholder values —
// `calculateMetadata` derives the real numbers from input props at render time.
export const RemotionRoot: React.FC = () => {
  return (
    <RemotionComposition
      id="LahariTimeline"
      component={VideoForRemotion}
      durationInFrames={1}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={defaultRenderProps as unknown as Record<string, unknown>}
      calculateMetadata={({ props }) => {
        const p = props as unknown as TimelineRenderProps;
        return {
          durationInFrames: Math.max(1, Math.round((p.durationMs / 1000) * p.fps)),
          fps: p.fps,
          width: p.size.width,
          height: p.size.height,
        };
      }}
    />
  );
};
