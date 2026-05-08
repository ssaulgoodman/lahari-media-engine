/**
 * StudioShotNav — right-side shot index for Studio.
 *
 * Vertical scroll on a long song is hard to navigate. The horizontal scene
 * pills in StudioHeader give scene-level orientation; this sidebar gives
 * shot-level orientation: every shot listed with shot index, timestamp,
 * duration, three status dots, and an active highlight that follows the
 * user's scroll position via IntersectionObserver.
 *
 * Three-dot status, mode-aware: dot 1 = first creative output (start
 * frame in keyframe mode, storyboard in storyboard mode), dot 2 = video,
 * dot 3 = shot locked. Colors: green = the whole shot is locked (all
 * three turn green together), white = done, amber = exists-but-stale
 * (upstream changed, storyboard generated but not locked, video out of
 * sync with end keyframe), dim = not yet done.
 *
 * No thumbnails — text-only by design. Keeps it scannable, fast, and
 * doesn't fan out 30+ image requests on a long song. Hidden below 1280px.
 */
import React, { useEffect, useRef } from 'react';
import { VideoScene, VideoShot, GenerationStatus } from '../types';

interface StudioShotNavProps {
  scenes: VideoScene[];
  isStoryboardMode: boolean;
  storyboardSupported: boolean;
  activeShotId: string | null;
  frameQueue?: string[];
  videoQueue?: string[];
  storyboardQueue?: string[];
  onJumpToShot: (shotId: string) => void;
  onJumpToScene: (sceneId: string) => void;
}

// Compute an absolute timestamp for a shot — the same math ShotCard does.
const parseTimeToSec = (t?: string): number => {
  if (!t) return 0;
  const parts = t.split(':').map(Number);
  if (parts.some(n => Number.isNaN(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] || 0;
};

const fmtTime = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

type DotState = 'done' | 'todo' | 'pending' | 'locked';

const dotClass = (s: DotState): string =>
  s === 'locked' ? 'bg-emerald-400/90'
    : s === 'done' ? 'bg-white'
    : s === 'pending' ? 'bg-amber-400/80'
    : 'bg-white/[0.12]';

export const StudioShotNav: React.FC<StudioShotNavProps> = ({
  scenes, isStoryboardMode, storyboardSupported, activeShotId, frameQueue, videoQueue, storyboardQueue,
  onJumpToShot, onJumpToScene,
}) => {
  // Progress totals — same math StudioHeader used to display in the top bar.
  // Lives here now so the sidebar is the single place where status reads.
  const totalShots = scenes.reduce((acc, s) => acc + s.shots.length, 0);
  const lockedShots = scenes.reduce((acc, s) => acc + s.shots.filter(x => x.locked).length, 0);
  const videoShots = scenes.reduce((acc, s) => acc + s.shots.filter(x => !!x.videoUrl).length, 0);
  const frameShots = scenes.reduce((acc, s) => acc + s.shots.filter(x => !!x.imageUrl).length, 0);
  const storyboardShots = scenes.reduce((acc, s) => acc + s.shots.filter(x => !!x.storyboardUrl).length, 0);
  const showStoryboardCount = isStoryboardMode && storyboardSupported;
  // Only auto-scroll the sidebar to follow the active shot when the user
  // hasn't manually scrolled the sidebar in the last ~1.5s — otherwise the
  // sidebar fights the user's intent.
  const navScrollRef = useRef<HTMLDivElement>(null);
  const lastUserScrollAt = useRef<number>(0);
  const onUserScroll = () => { lastUserScrollAt.current = Date.now(); };

  useEffect(() => {
    if (!activeShotId) return;
    const now = Date.now();
    if (now - lastUserScrollAt.current < 1500) return;
    const el = document.getElementById(`shot-nav-${activeShotId}`);
    const container = navScrollRef.current;
    if (!el || !container) return;
    const elRect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    if (elRect.top < cRect.top + 24 || elRect.bottom > cRect.bottom - 24) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeShotId]);

  return (
    <aside
      className="hidden xl:block w-64 flex-shrink-0 sticky top-20 self-start"
      style={{ maxHeight: 'calc(100vh - 6rem)' }}
      aria-label="Shot navigator"
    >
      <div
        ref={navScrollRef}
        onScroll={onUserScroll}
        className="surface rounded-xl border border-white/[0.06] bg-[#141418] overflow-y-auto"
        style={{ maxHeight: 'calc(100vh - 6rem)' }}
      >
        <div className="px-3 py-2 sticky top-0 bg-[#141418]/95 backdrop-blur border-b border-white/[0.04] z-10">
          {/* Compact single-line: lowercase labels in zinc, counts in white,
              denominator only on the first stat (all share the same total),
              locked count in emerald to match the locked-shot dot color. */}
          <span className="text-[11px] font-mono tabular-nums whitespace-nowrap flex items-baseline gap-1.5 text-zinc-500">
            {showStoryboardCount ? (
              <>
                <span>sb</span>
                <span className="text-white">{storyboardShots}/{totalShots}</span>
              </>
            ) : (
              <>
                <span>f</span>
                <span className="text-white">{frameShots}/{totalShots}</span>
              </>
            )}
            {showStoryboardCount && (
              <>
                <span className="text-zinc-600">·</span>
                <span>f</span>
                <span className="text-white">{frameShots}</span>
              </>
            )}
            <span className="text-zinc-600">·</span>
            <span>v</span>
            <span className="text-white">{videoShots}</span>
            {lockedShots > 0 && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-emerald-400/70">L</span>
                <span className="text-emerald-400/90">{lockedShots}</span>
              </>
            )}
          </span>
        </div>

        {scenes.map((scene, sceneIdx) => (
          <div key={scene.id} className="border-b border-white/[0.03] last:border-b-0">
            <button
              onClick={() => onJumpToScene(scene.id)}
              className="w-full px-3 py-1.5 flex items-baseline gap-2 hover:bg-white/[0.03] transition-colors text-left"
              title={`Jump to scene ${sceneIdx + 1}`}
            >
              <span className="text-[11px] font-mono text-zinc-300">S{sceneIdx + 1}</span>
              <span className="text-[10px] text-zinc-500 font-mono tabular-nums">{scene.startTime}–{scene.endTime}</span>
              {scene.sectionLabel && (
                <span className="text-[10px] text-zinc-500 truncate">· {scene.sectionLabel}</span>
              )}
            </button>

            <div className="pb-1">
              {scene.shots.map((shot, shotIdx) => {
                const absSec = parseTimeToSec(scene.startTime)
                  + scene.shots.slice(0, shotIdx).reduce((a, s) => a + (s.duration || 0), 0);

                // Mode-aware progress dots — same vocabulary as ShotCard's
                // inline 3-dot indicator. Dot 1 differs by mode; 2 and 3 are
                // shared (video / shot-locked).
                const isActive = activeShotId === shot.id;
                const isError = shot.imageStatus === GenerationStatus.ERROR
                  || shot.videoStatus === GenerationStatus.ERROR
                  || shot.storyboardStatus === GenerationStatus.ERROR;
                const isLoading = shot.imageStatus === GenerationStatus.LOADING
                  || shot.videoStatus === GenerationStatus.LOADING
                  || shot.storyboardStatus === GenerationStatus.LOADING;
                const promptStale = !!shot.promptsStale;
                const videoStale = shot.videoStatus === GenerationStatus.STALE;

                // When the shot is locked, all three dots go green — that's
                // the "this is done and frozen" signal, replacing the
                // previous separate lock glyph next to the dots.
                let dot1: DotState;
                let dot2: DotState;
                let dot3: DotState;
                if (shot.locked) {
                  dot1 = dot2 = dot3 = 'locked';
                } else {
                  // Dot 1 = first creative output. Amber when the artist's
                  // existing frame/storyboard is out of sync with upstream
                  // edits (promptsStale), or when a storyboard exists but
                  // isn't locked yet. Otherwise white if done, dim if not.
                  const dot1Has = isStoryboardMode ? !!shot.storyboardUrl : !!shot.imageUrl;
                  const dot1Amber = dot1Has && (promptStale || (isStoryboardMode && !shot.storyboardLocked));
                  dot1 = !dot1Has ? 'todo' : dot1Amber ? 'pending' : 'done';

                  // Dot 2 = video. Amber when the rendered video is stale
                  // relative to a changed end keyframe.
                  dot2 = !shot.videoUrl ? 'todo' : videoStale ? 'pending' : 'done';

                  // Dot 3 = shot lock — turns green when locked (handled above).
                  dot3 = 'todo';
                }

                // Bulk queue position — mirror the badge ShotCard already shows.
                const sbPos = storyboardQueue?.indexOf(shot.id) ?? -1;
                const fPos = frameQueue?.indexOf(shot.id) ?? -1;
                const vPos = videoQueue?.indexOf(shot.id) ?? -1;
                const queuePos = sbPos >= 0 ? sbPos + 1 : fPos >= 0 ? fPos + 1 : vPos >= 0 ? vPos + 1 : null;

                return (
                  <button
                    key={shot.id}
                    id={`shot-nav-${shot.id}`}
                    onClick={() => onJumpToShot(shot.id)}
                    className={`w-full pl-3 pr-2 py-1.5 flex items-center gap-2.5 transition-colors text-left border-l-2 ${
                      isActive
                        ? 'bg-white/[0.04] border-white/70'
                        : 'border-transparent hover:bg-white/[0.02]'
                    }`}
                    title={`Shot ${shotIdx + 1} · ${fmtTime(absSec)} · ${shot.duration}s`}
                  >
                    {/* Index — primary identifier in the absence of a thumbnail */}
                    <span
                      className={`text-[11px] font-medium tabular-nums w-5 flex-shrink-0 ${
                        isActive ? 'text-white' : 'text-zinc-400'
                      }`}
                    >
                      {shotIdx + 1}
                    </span>

                    {/* Timestamp + duration */}
                    <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                      <span className="text-[11px] text-zinc-400 font-mono tabular-nums">
                        {fmtTime(absSec)}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono">[{shot.duration}s]</span>
                    </div>

                    {/* Status dots + flags */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isLoading ? (
                        <div className="w-3 h-3 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>
                          <div className={`w-1.5 h-1.5 rounded-full ${dotClass(dot1)}`} />
                          <div className={`w-1.5 h-1.5 rounded-full ${dotClass(dot2)}`} />
                          <div className={`w-1.5 h-1.5 rounded-full ${dotClass(dot3)}`} />
                        </>
                      )}
                      {isError && (
                        <span className="text-[9px] text-red-300/80 font-mono ml-0.5" title="Generation error">err</span>
                      )}
                      {queuePos !== null && (
                        <span className="text-[9px] text-zinc-400 font-mono ml-0.5" title="Bulk queue position">#{queuePos}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};
