/**
 * StudioShotNav — right-side shot index for Studio.
 *
 * Vertical scroll on a long song is hard to navigate. The horizontal scene
 * pills in StudioHeader give scene-level orientation; this sidebar gives
 * shot-level orientation: every shot listed with shot index, timestamp,
 * duration, three status dots, and an active highlight that follows the
 * user's scroll position via IntersectionObserver.
 *
 * Status dots match ShotCard's inline 3-dot vocabulary. Mode-aware: dot 1
 * = `storyboardLocked` in storyboard mode, `imageUrl` in keyframe mode.
 * Dot 2 = video, dot 3 = shot locked.
 *
 * No thumbnails — text-only by design. Keeps it scannable, fast, and
 * doesn't fan out 30+ image requests on a long song. Hidden below 1280px.
 */
import React, { useEffect, useRef } from 'react';
import { VideoScene, VideoShot, GenerationStatus } from '../types';

interface StudioShotNavProps {
  scenes: VideoScene[];
  isStoryboardMode: boolean;
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

type DotState = 'done' | 'todo' | 'pending';

const dotClass = (s: DotState): string =>
  s === 'done' ? 'bg-white' : s === 'pending' ? 'bg-amber-400/80' : 'bg-white/[0.12]';

export const StudioShotNav: React.FC<StudioShotNavProps> = ({
  scenes, isStoryboardMode, activeShotId, frameQueue, videoQueue, storyboardQueue,
  onJumpToShot, onJumpToScene,
}) => {
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
          <span className="text-[11px] uppercase tracking-wider text-zinc-400">Shots</span>
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
                const dot1: DotState = isStoryboardMode
                  ? (shot.storyboardLocked ? 'done' : shot.storyboardUrl ? 'pending' : 'todo')
                  : (shot.imageUrl ? 'done' : 'todo');
                const dot2: DotState = shot.videoUrl ? 'done' : 'todo';
                const dot3: DotState = shot.locked ? 'done' : 'todo';

                const isActive = activeShotId === shot.id;
                const isError = shot.imageStatus === GenerationStatus.ERROR
                  || shot.videoStatus === GenerationStatus.ERROR
                  || shot.storyboardStatus === GenerationStatus.ERROR;
                const isLoading = shot.imageStatus === GenerationStatus.LOADING
                  || shot.videoStatus === GenerationStatus.LOADING
                  || shot.storyboardStatus === GenerationStatus.LOADING;
                const isStale = shot.promptsStale || shot.videoStatus === GenerationStatus.STALE;

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
                      {shot.locked && !isLoading && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/60 ml-0.5" aria-hidden="true">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                      )}
                      {isError && (
                        <span className="text-[9px] text-red-300/80 font-mono ml-0.5" title="Generation error">err</span>
                      )}
                      {isStale && !isError && (
                        <span className="text-[9px] text-amber-400/80 font-mono ml-0.5" title="Outdated — upstream changed">stale</span>
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
