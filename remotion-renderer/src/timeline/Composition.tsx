// SYNCED FROM components/timeline-editor/Composition.tsx — re-run
// `npm run sync-timeline` after editing the upstream file. Server-side build
// removes the StoreComposition wrapper and the './store' import.
import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Img, Sequence } from 'remotion';
// @remotion/media's <Video> streams frames instead of downloading the whole MP4
// per frame (which triggers frame_cache.rs panics on the SSR renderer). Works
// in the browser <Player> too — native buffering, canvas-based draw.
import { Video } from '@remotion/media';
import {
  TransitionSeries,
  linearTiming,
  fade,
  slide,
  wipe,
  flip,
  clockWipe,
  circle,
  star,
  rectangle,
  slidingDoors,
} from '@designcombo/transitions';
import { ITrackItem, ITransition } from '@designcombo/types';
import { buildFilterCSS, buildOpacityCSS } from './effects';
import { groupTrackItems } from './track-items-utils';

type ItemType = 'text' | 'image' | 'video' | 'audio';

// Render-authoritative subset of the timeline state. Everything the composition
// needs to draw a frame is here; UI concerns (zoom, scroll, selection) live only
// in the zustand store. This shape is what we POST to the Remotion SSR service.
//
// Audio (including the project song) travels through trackItemsMap like any
// other clip — the editor owns an audio track; no top-level audio injection.
export interface CompositionInput {
  trackItemIds: string[];
  trackItemsMap: Record<string, ITrackItem>;
  transitionsMap: Record<string, ITransition>;
  fps: number;
  size: { width: number; height: number };
}

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
    // premountFor keeps the sequence mounted (but invisible + silent) 2s before
    // its actual start so the browser can prebuffer the video element. Without
    // this the preview stutters every hard cut as the next clip's mp4 loads.
    //
    // muted — in the music-video pipeline the song track is the authoritative
    // audio; the per-clip video audio is just ambient noise baked in by Veo.
    return (
      <Sequence
        key={item.id}
        from={from}
        durationInFrames={durationInFrames}
        premountFor={fps * 2}
      >
        <AbsoluteFill style={{ pointerEvents: 'none', ...effectStyles(d) }}>
          <Video
            trimBefore={(trim.from / 1000) * fps}
            trimAfter={(trim.to / 1000) * fps || 1 / fps}
            src={d.src}
            muted={d.muted !== false}
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
          <Video
            trimBefore={(trim.from / 1000) * fps}
            trimAfter={(trim.to / 1000) * fps || 1 / fps}
            src={d.src}
            muted={d.muted !== false}
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

// ─── Transition builder ─────────────────────────────────────────────────────
//
// Builds a <TransitionSeries.Transition> from an ITransition record. We own
// the mapping (instead of delegating to `Transitions[kind]` in
// @designcombo/transitions) for two reasons: (1) fade needs
// `shouldFadeOutExitingScene: true` to actually crossfade, and (2) we want to
// pick up per-transition duration overrides that the UI writes back to
// `transition.duration`.

const buildTransitionElement = (
  t: ITransition,
  fps: number,
  size: { width: number; height: number },
): React.JSX.Element | null => {
  const durationInFrames = Math.max(1, Math.round(((t.duration || 500) / 1000) * fps));
  const timing = linearTiming({ durationInFrames });
  const direction = (t as any).direction;
  const { width, height } = size;

  let presentation: any;
  switch (t.kind) {
    case 'fade':
      presentation = fade({ shouldFadeOutExitingScene: true });
      break;
    case 'slide':
      presentation = slide({ direction });
      break;
    case 'wipe':
      presentation = wipe({ direction });
      break;
    case 'flip':
      presentation = flip();
      break;
    case 'clockWipe':
      presentation = clockWipe({ width, height });
      break;
    case 'circle':
      presentation = circle({ width, height });
      break;
    case 'star':
      presentation = star({ width, height });
      break;
    case 'rectangle':
      presentation = rectangle({ width, height });
      break;
    case 'slidingDoors':
      presentation = slidingDoors({ width, height });
      break;
    default:
      return null;
  }

  return (
    <TransitionSeries.Transition
      key={t.id}
      presentation={presentation}
      timing={timing}
    />
  );
};

// ─── Composition ─────────────────────────────────────────────────────────────

// Pure, prop-driven composition. Used by both the in-app Player (via the
// StoreComposition wrapper) and the Remotion SSR renderer (which passes
// inputProps directly).
export const Composition: React.FC<CompositionInput> = ({
  trackItemIds,
  trackItemsMap,
  transitionsMap,
  fps,
  size,
}) => {
  // Group items with their transitions. Memoized so Remotion's per-frame
  // re-render doesn't rebuild the O(items × transitions) grouping every tick —
  // cheap but the rule is "avoid doing work in the frame loop that doesn't
  // depend on the frame."
  const groupedItems = useMemo(
    () => groupTrackItems({ trackItemIds, transitionsMap, trackItemsMap }),
    [trackItemIds, transitionsMap, trackItemsMap],
  );

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
              // Transition element — we build the TransitionSeries.Transition
              // ourselves instead of using `Transitions[kind]` from the lib so
              // we can pass `shouldFadeOutExitingScene: true` on fade. Without
              // that flag the library's fade leaves clip A at opacity 1 the
              // whole time and only B fades in — it looks like "B appears"
              // rather than a crossfade.
              if (element.type === 'transition') {
                return buildTransitionElement(element as ITransition, fps, size);
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
