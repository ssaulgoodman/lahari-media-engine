/**
 * StudioShotNav — right-side shot index for Studio.
 *
 * Vertical scroll on a long song is hard to navigate. The horizontal scene
 * pills in StudioHeader give scene-level orientation; this sidebar gives
 * shot-level orientation: every shot listed with shot index, timestamp,
 * duration, three status dots, and an active highlight that follows the
 * user's scroll position via IntersectionObserver.
 *
 * Two-dot status, mode-aware: dot 1 = first creative output (start
 * frame in keyframe mode, storyboard in storyboard mode), dot 2 = video.
 * Each dot turns green when its artifact is locked: dot 1 follows the
 * storyboard lock in storyboard mode (or the shot lock in keyframe mode),
 * dot 2 follows the shot lock since there's no separate video lock.
 * Colors: green = locked, white = created and current, amber = created
 * but stale (upstream changed, video out of sync with end keyframe),
 * dim = not yet created.
 *
 * While generation is in flight the dot becomes a colored spinner in
 * place — white-top for the artifact (dot 1), amber-top for video (dot
 * 2) — so the artist can tell at a glance which step is running and
 * stop spinning the moment status leaves LOADING.
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
  storyboardPromptQueue?: string[];
  storyboardImageQueue?: string[];
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

const dotStateLabel = (s: DotState): string =>
  s === 'locked' ? 'locked' : s === 'done' ? 'done' : s === 'pending' ? 'stale' : 'pending';

export const StudioShotNav: React.FC<StudioShotNavProps> = ({
  scenes, isStoryboardMode, storyboardSupported, activeShotId, frameQueue, videoQueue, storyboardPromptQueue, storyboardImageQueue,
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
          {/* Single-line totals: T = total shots, S = storyboards generated
              (storyboard mode only), F = frames generated, V = videos
              generated, L = whole shots locked by the artist. Hover labels
              spell each one out. */}
          <span className="text-[11px] font-mono tabular-nums whitespace-nowrap flex items-baseline gap-1.5 text-zinc-500">
            <span title={`${totalShots} total shots`}>T</span>
            <span className="text-white" title={`${totalShots} total shots`}>{totalShots}</span>
            {showStoryboardCount && (
              <>
                <span className="text-zinc-600">·</span>
                <span title={`${storyboardShots} of ${totalShots} storyboards generated`}>S</span>
                <span className="text-white" title={`${storyboardShots} of ${totalShots} storyboards generated`}>{storyboardShots}</span>
              </>
            )}
            <span className="text-zinc-600">·</span>
            <span title={`${frameShots} of ${totalShots} start frames generated`}>F</span>
            <span className="text-white" title={`${frameShots} of ${totalShots} start frames generated`}>{frameShots}</span>
            <span className="text-zinc-600">·</span>
            <span title={`${videoShots} of ${totalShots} videos generated`}>V</span>
            <span className="text-white" title={`${videoShots} of ${totalShots} videos generated`}>{videoShots}</span>
            {lockedShots > 0 && (
              <>
                <span className="text-zinc-600">·</span>
                <span title={`${lockedShots} of ${totalShots} shots locked (frame + video frozen)`}>L</span>
                <span className="text-emerald-400/90" title={`${lockedShots} of ${totalShots} shots locked (frame + video frozen)`}>{lockedShots}</span>
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
                <span className="text-[10px] text-zinc-500 truncate ml-auto">{scene.sectionLabel}</span>
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
                // Per-dot loading — shows which artifact is being generated
                // at a glance. Dot 1 covers storyboard gen in storyboard
                // mode and frame gen (incl. critique loop) in keyframe mode.
                // Dot 2 always tracks video gen.
                const dot1Loading = isStoryboardMode
                  ? shot.storyboardStatus === GenerationStatus.LOADING
                  : shot.imageStatus === GenerationStatus.LOADING
                    || shot.imageStatus === GenerationStatus.CRITIQUING;
                const dot2Loading = shot.videoStatus === GenerationStatus.LOADING;
                const promptStale = !!shot.promptsStale;
                const videoStale = shot.videoStatus === GenerationStatus.STALE;

                // Each dot lifts to green when its artifact is locked.
                // Dot 1 (storyboard/start frame): in storyboard mode the
                // storyboard has its own lock the artist sets before video
                // gen; in keyframe mode the start frame inherits lock state
                // from the whole shot. Dot 2 (video) is sealed only when
                // the shot is locked (no separate video-lock concept).
                const dot1Has = isStoryboardMode ? !!shot.storyboardUrl : !!shot.imageUrl;
                const dot1Locked = isStoryboardMode
                  ? !!shot.storyboardLocked || !!shot.locked
                  : !!shot.locked;
                const dot1Stale = dot1Has && promptStale;
                const dot1: DotState =
                  dot1Locked && dot1Has ? 'locked'
                    : !dot1Has ? 'todo'
                    : dot1Stale ? 'pending'
                    : 'done';

                const dot2Has = !!shot.videoUrl;
                const dot2: DotState =
                  shot.locked && dot2Has ? 'locked'
                    : !dot2Has ? 'todo'
                    : videoStale ? 'pending'
                    : 'done';

                // Bulk queue position — mirror the badge ShotCard already shows.
                const sbPromptPos = storyboardPromptQueue?.indexOf(shot.id) ?? -1;
                const sbImagePos = storyboardImageQueue?.indexOf(shot.id) ?? -1;
                const fPos = frameQueue?.indexOf(shot.id) ?? -1;
                const vPos = videoQueue?.indexOf(shot.id) ?? -1;
                const queuePos = sbPromptPos >= 0 ? sbPromptPos + 1 : sbImagePos >= 0 ? sbImagePos + 1 : fPos >= 0 ? fPos + 1 : vPos >= 0 ? vPos + 1 : null;

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
                      {dot1Loading ? (
                        <span
                          className="w-2.5 h-2.5 border-[1.5px] border-zinc-700 border-t-white rounded-full animate-spin"
                          title={`Generating ${isStoryboardMode ? 'storyboard' : 'start frame'}…`}
                        />
                      ) : (
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${dotClass(dot1)}`}
                          title={`${isStoryboardMode ? 'Storyboard' : 'Start frame'} — ${dotStateLabel(dot1)}`}
                        />
                      )}
                      {dot2Loading ? (
                        <span
                          className="w-2.5 h-2.5 border-[1.5px] border-zinc-700 border-t-amber-400/90 rounded-full animate-spin"
                          title="Generating video…"
                        />
                      ) : (
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${dotClass(dot2)}`}
                          title={`Video — ${dotStateLabel(dot2)}`}
                        />
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
