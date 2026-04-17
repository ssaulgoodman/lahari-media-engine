import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence } from 'remotion';
import { TransitionSeries, Transitions } from '@designcombo/transitions';
import { ITrackItem, ITransition } from '@designcombo/types';
import { buildFilterCSS, buildOpacityCSS } from './effects';
import { groupTrackItems } from './track-items-utils';
import useStore from './store';

type ItemType = 'text' | 'image' | 'video' | 'audio';

const framesOf = (display: { from: number; to: number }, fps: number) => {
  const from = (display.from / 1000) * fps;
  const durationInFrames = Math.max(1, (display.to / 1000) * fps - from);
  return { from, durationInFrames };
};

// Build inline styles for effects from item details.
const effectStyles = (details: any): React.CSSProperties => {
  const filter = buildFilterCSS(details);
  const opacity = buildOpacityCSS(details);
  return {
    ...(filter !== 'none' ? { filter } : {}),
    ...(opacity !== 1 ? { opacity } : {}),
  };
};

// ─── Per-type renderers (standalone Sequence — no transition) ────────────────

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
            ...effectStyles(d),
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
        <AbsoluteFill style={{ pointerEvents: 'none', ...effectStyles(d) }}>
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
        <AbsoluteFill style={{ pointerEvents: 'none', ...effectStyles(d) }}>
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

// ─── Per-type renderers for items inside a TransitionSeries ─────────────────
// These render without a wrapping <Sequence> since TransitionSeries handles timing.

const transitionRenderers: Record<ItemType, (item: ITrackItem, fps: number) => React.JSX.Element> = {
  text: (item, fps) => {
    const { durationInFrames } = framesOf(item.display, fps);
    const d: any = item.details || {};
    return (
      <TransitionSeries.Sequence key={item.id} durationInFrames={durationInFrames}>
        <AbsoluteFill>
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
              ...effectStyles(d),
            }}
          >
            {d.text || ''}
          </div>
        </AbsoluteFill>
      </TransitionSeries.Sequence>
    );
  },
  image: (item, fps) => {
    const { durationInFrames } = framesOf(item.display, fps);
    const d: any = item.details || {};
    return (
      <TransitionSeries.Sequence key={item.id} durationInFrames={durationInFrames}>
        <AbsoluteFill style={{ pointerEvents: 'none', ...effectStyles(d) }}>
          <Img src={d.src} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </AbsoluteFill>
      </TransitionSeries.Sequence>
    );
  },
  video: (item, fps) => {
    const { durationInFrames } = framesOf(item.display, fps);
    const trim = (item as any).trim || { from: 0, to: item.display.to - item.display.from };
    const d: any = item.details || {};
    return (
      <TransitionSeries.Sequence key={item.id} durationInFrames={durationInFrames}>
        <AbsoluteFill style={{ pointerEvents: 'none', ...effectStyles(d) }}>
          <OffthreadVideo
            startFrom={(trim.from / 1000) * fps}
            endAt={(trim.to / 1000) * fps}
            src={d.src}
            volume={(d.volume ?? 100) / 100}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </AbsoluteFill>
      </TransitionSeries.Sequence>
    );
  },
  audio: (item, fps) => {
    const { durationInFrames } = framesOf(item.display, fps);
    const trim = (item as any).trim || { from: 0, to: item.display.to - item.display.from };
    const d: any = item.details || {};
    return (
      <TransitionSeries.Sequence key={item.id} durationInFrames={durationInFrames}>
        <Audio
          startFrom={(trim.from / 1000) * fps}
          endAt={(trim.to / 1000) * fps}
          src={d.src}
          volume={(d.volume ?? 100) / 100}
        />
      </TransitionSeries.Sequence>
    );
  },
};

// ─── Composition ─────────────────────────────────────────────────────────────

const Composition: React.FC = () => {
  const { trackItemIds, trackItemsMap, transitionsMap, fps, size } = useStore();

  // Group items with their transitions (mirrors reference repo logic).
  const groupedItems = groupTrackItems({ trackItemIds, transitionsMap, trackItemsMap });

  return (
    <>
      {groupedItems.map((group, groupIdx) => {
        // Single item — no transition wrapper needed.
        if (group.length === 1) {
          const item = trackItemsMap[group[0].id];
          if (!item) return null;
          const fn = renderers[item.type as ItemType];
          return fn ? fn(item, fps) : null;
        }

        // Group with transitions — wrap in TransitionSeries.
        const firstItem = trackItemsMap[group[0].id];
        if (!firstItem) return null;
        const from = (firstItem.display.from / 1000) * fps;

        return (
          <TransitionSeries from={from} key={`tg-${groupIdx}`}>
            {group.map((element) => {
              // Transition element
              if (element.type === 'transition') {
                const t = element as ITransition;
                const durationInFrames = Math.max(1, ((t.duration || 500) / 1000) * fps);
                const transitionFn = Transitions[t.kind];
                if (!transitionFn) return null;
                return transitionFn({
                  durationInFrames,
                  width: size.width,
                  height: size.height,
                  id: t.id,
                  direction: (t as any).direction,
                });
              }

              // Media element inside transition series
              const item = trackItemsMap[element.id];
              if (!item) return null;
              const fn = transitionRenderers[item.type as ItemType];
              return fn ? fn(item, fps) : null;
            })}
          </TransitionSeries>
        );
      })}
    </>
  );
};

export default Composition;
