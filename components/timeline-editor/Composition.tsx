import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence } from 'remotion';
import { ITrackItem } from '@designcombo/types';
import useStore from './store';

type ItemType = 'text' | 'image' | 'video' | 'audio';

const framesOf = (display: { from: number; to: number }, fps: number) => {
  const from = (display.from / 1000) * fps;
  const durationInFrames = Math.max(1, (display.to / 1000) * fps - from);
  return { from, durationInFrames };
};

const renderers: Record<ItemType, (item: ITrackItem, fps: number) => React.JSX.Element> = {
  text: (item, fps) => {
    const { from, durationInFrames } = framesOf(item.display, fps);
    const d: any = item.details || {};
    return (
      <Sequence key={item.id} from={from} durationInFrames={durationInFrames}>
        <div
          style={{
            position: 'absolute',
            width: d.width || 600,
            top: d.top || 400,
            left: d.left || 400,
            fontSize: d.fontSize || 80,
            color: d.color || '#ffffff',
            fontFamily: d.fontFamily || 'Geist, sans-serif',
            textAlign: d.textAlign || 'left',
          }}
        >
          {d.text || ''}
        </div>
      </Sequence>
    );
  },
  image: (item, fps) => {
    const { from, durationInFrames } = framesOf(item.display, fps);
    const d: any = item.details || {};
    return (
      <Sequence key={item.id} from={from} durationInFrames={durationInFrames}>
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          <Img src={d.src} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </AbsoluteFill>
      </Sequence>
    );
  },
  video: (item, fps) => {
    const { from, durationInFrames } = framesOf(item.display, fps);
    const trim = (item as any).trim || { from: 0, to: item.display.to - item.display.from };
    const d: any = item.details || {};
    return (
      <Sequence key={item.id} from={from} durationInFrames={durationInFrames}>
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          <OffthreadVideo
            startFrom={(trim.from / 1000) * fps}
            endAt={(trim.to / 1000) * fps}
            src={d.src}
            volume={(d.volume ?? 100) / 100}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </AbsoluteFill>
      </Sequence>
    );
  },
  audio: (item, fps) => {
    const { from, durationInFrames } = framesOf(item.display, fps);
    const trim = (item as any).trim || { from: 0, to: item.display.to - item.display.from };
    const d: any = item.details || {};
    return (
      <Sequence key={item.id} from={from} durationInFrames={durationInFrames}>
        <Audio
          startFrom={(trim.from / 1000) * fps}
          endAt={(trim.to / 1000) * fps}
          src={d.src}
          volume={(d.volume ?? 100) / 100}
        />
      </Sequence>
    );
  },
};

const Composition: React.FC = () => {
  const { trackItemIds, trackItemsMap, fps } = useStore();
  return (
    <>
      {trackItemIds.map((id) => {
        const item = trackItemsMap[id];
        if (!item) return null;
        const fn = renderers[(item.type as ItemType)];
        return fn ? fn(item, fps) : null;
      })}
    </>
  );
};

export default Composition;
