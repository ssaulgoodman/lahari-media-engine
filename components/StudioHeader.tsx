/**
 * StudioHeader — extracted from Storyboard.tsx.
 * Sticky context bar: scene pills with lock toggles, progress stats,
 * story popover, master-prompt popover, and bulk actions.
 */
import React, { useState, useRef, useEffect } from 'react';
import { VideoScene, VideoShot, GenerationStatus, ApiProject } from '../types';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { lockAllSceneShots, unlockAllSceneShots } from '../services/api';

interface StudioHeaderProps {
  scenes: VideoScene[];
  project: ApiProject | null;
  activeSceneIdx: number;
  onSceneChange: (idx: number) => void;
  onUpdateShot: (sceneId: string, shotId: string, updates: Partial<VideoShot>) => void;
  onRewriteShotPrompts?: (userNote?: string) => void;
  onBulkGenerateFrames?: () => Promise<void> | void;
  onBulkGenerateVideos?: () => Promise<void> | void;
  onBulkGenerateStoryboards?: () => Promise<void> | void;
  studioMode: 'storyboard' | 'keyframe';
  onStudioModeChange: (mode: 'storyboard' | 'keyframe') => void;
  storyboardSupported: boolean;
  isLoading?: boolean;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  scenes, project, activeSceneIdx, onSceneChange, onUpdateShot,
  onRewriteShotPrompts, onBulkGenerateFrames, onBulkGenerateVideos, onBulkGenerateStoryboards, studioMode, onStudioModeChange, storyboardSupported, isLoading,
}) => {
  const [contextPopover, setContextPopover] = useState<'story' | 'prompts' | null>(null);
  const contextBarRef = useRef<HTMLDivElement>(null);
  const [bulkNote, setBulkNote] = useState('');
  const [bulkRunning, setBulkRunning] = useState<'storyboards' | 'frames' | 'videos' | null>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!contextPopover) return;
    const onDown = (e: MouseEvent) => {
      if (contextBarRef.current && !contextBarRef.current.contains(e.target as Node)) setContextPopover(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextPopover(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [contextPopover]);

  // Derived stats
  const hasBulkPrompt = !!project?.lastWriteShotsPrompt;
  const totalShots = scenes.reduce((acc, s) => acc + s.shots.length, 0);
  const lockedShots = scenes.reduce((acc, s) => acc + s.shots.filter(x => x.locked).length, 0);
  const videoShots = scenes.reduce((acc, s) => acc + s.shots.filter(x => !!x.videoUrl).length, 0);
  const frameShots = scenes.reduce((acc, s) => acc + s.shots.filter(x => !!x.imageUrl).length, 0);
  const storyboardShots = scenes.reduce((acc, s) => acc + s.shots.filter(x => !!x.storyboardUrl).length, 0);
  const concept = project?.lockedConcept;

  const missingPromptCount = scenes.reduce(
    (acc, s) => acc + s.shots.filter(x => !x.visualPrompt || !x.visualPrompt.trim()).length, 0
  );
  const framesToFire = scenes.reduce((acc, s) => {
    return acc + s.shots.filter((shot, idx) => {
      if (shot.imageUrl) return false;
      if (shot.imageStatus === GenerationStatus.LOADING) return false;
      if (shot.continuityFrom === 'prev_shot' && idx > 0) {
        const prev = s.shots[idx - 1];
        if (!prev?.videoUrl) return false;
      }
      return true;
    }).length;
  }, 0);
  const videosToFire = scenes.reduce((acc, s) => {
    return acc + s.shots.filter((shot, idx) => {
      if (studioMode === 'storyboard' && storyboardSupported) {
        if (!shot.storyboardLocked || !shot.storyboardUrl || shot.videoUrl) return false;
      } else if (!shot.imageUrl || shot.videoUrl) return false;
      if (shot.videoStatus === GenerationStatus.LOADING) return false;
      if (shot.continuityFrom === 'prev_shot' && idx > 0) {
        const prev = s.shots[idx - 1];
        if (!prev?.videoUrl) return false;
      }
      return true;
    }).length;
  }, 0);
  const storyboardsToFire = scenes.reduce((acc, s) => {
    return acc + s.shots.filter(shot => {
      if (shot.storyboardLocked || shot.storyboardUrl) return false;
      if (shot.storyboardStatus === GenerationStatus.LOADING || shot.storyboardStatus === GenerationStatus.ERROR) return false;
      return true;
    }).length;
  }, 0);
  const chainWaitingCount = scenes.reduce((acc, s) => {
    return acc + s.shots.filter((shot, idx) => {
      if (shot.imageUrl || idx === 0) return false;
      if (shot.continuityFrom !== 'prev_shot') return false;
      const prev = s.shots[idx - 1];
      return !prev?.videoUrl;
    }).length;
  }, 0);

  return (
    <div ref={contextBarRef} className="sticky top-0 z-40 mb-6">
      <div className="surface rounded-xl border border-white/[0.06] bg-[#141418] shadow-md shadow-black/15 px-4 py-2.5 flex items-center gap-2 flex-wrap">
        {/* Scene pills */}
        <div className="flex items-center gap-1 overflow-x-auto mr-auto">
          {scenes.map((s, i) => {
            const sceneVideoCount = s.shots.filter(x => !!x.videoUrl).length;
            const sceneFrameCount = s.shots.filter(x => !!x.imageUrl).length;
            const done = sceneVideoCount === s.shots.length && s.shots.length > 0;
            const inProgress = sceneVideoCount > 0 && !done;
            const isActive = i === activeSceneIdx;
            const dotClass = done ? 'bg-white' : inProgress ? 'bg-amber-400/80' : sceneFrameCount > 0 ? 'bg-white/50' : 'bg-white/15';
            const lockableShots = s.shots.filter(x => x.imageUrl && x.videoUrl);
            const lockedCount = s.shots.filter(x => x.locked).length;
            const allLocked = lockableShots.length > 0 && lockedCount === lockableShots.length;
            return (
              <div key={s.id} className="flex items-center gap-0 flex-shrink-0">
                <button
                  onClick={() => {
                    onSceneChange(i);
                    const el = document.getElementById(`scene-${s.id}`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className={`px-2.5 py-1 rounded-l-md text-[11px] font-medium transition-colors flex items-center gap-1.5 border border-r-0 ${
                    isActive
                      ? 'bg-white/[0.08] text-white border-white/[0.12]'
                      : 'bg-transparent text-zinc-300 border-white/[0.04] hover:bg-white/[0.04]'
                  }`}
                  title={`Scene ${i + 1} · ${s.shots.length} shot${s.shots.length === 1 ? '' : 's'} · ${sceneVideoCount}/${s.shots.length} videos`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
                  <span className="font-mono">S{i + 1}</span>
                </button>
                {lockableShots.length > 0 && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!project) return;
                      try {
                        if (allLocked) {
                          await unlockAllSceneShots(project.id, s.id);
                          s.shots.forEach(sh => onUpdateShot(s.id, sh.id, { locked: false }));
                        } else {
                          const result = await lockAllSceneShots(project.id, s.id);
                          s.shots.forEach(sh => {
                            if (sh.imageUrl && sh.videoUrl) onUpdateShot(s.id, sh.id, { locked: true });
                          });
                        }
                      } catch (err: any) {
                        console.error('Scene lock/unlock failed:', err);
                      }
                    }}
                    className={`px-1.5 py-1 rounded-r-md text-[11px] transition-colors border ${
                      isActive ? 'border-white/[0.12]' : 'border-white/[0.04]'
                    } ${allLocked ? 'text-white/60 hover:text-amber-400/80 bg-white/[0.04]' : 'text-zinc-500 hover:text-white/60 bg-transparent hover:bg-white/[0.04]'}`}
                    title={allLocked ? `Unlock all ${lockedCount} shots in scene ${i + 1}` : `Lock ${lockableShots.length - lockedCount} ready shots in scene ${i + 1}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      {allLocked ? (
                        <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>
                      ) : (
                        <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>
                      )}
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Compact progress */}
        <span className="text-[11px] text-zinc-400 font-mono tabular-nums">
          {studioMode === 'storyboard' && storyboardSupported ? <><span className="text-white">{storyboardShots}</span>/{totalShots}sb · </> : null}
          <span className="text-white">{frameShots}</span>/{totalShots}f · <span className="text-white">{videoShots}</span>/{totalShots}v
          {lockedShots > 0 && <> · <span className="text-white">{lockedShots}</span>/{totalShots} locked</>}
          {chainWaitingCount > 0 && <> · <span className="text-amber-400/80">{chainWaitingCount} wait</span></>}
        </span>

        {/* Studio mode */}
        <div className="flex gap-px bg-white/[0.04] rounded-md overflow-hidden border border-white/[0.04]" title={storyboardSupported ? 'Choose the generation workflow for this Studio session.' : 'Storyboard mode is available for Seedance models.'}>
          <button
            onClick={() => storyboardSupported && onStudioModeChange('storyboard')}
            disabled={!storyboardSupported}
            className={`text-[11px] px-2.5 py-1 transition-colors disabled:opacity-35 ${studioMode === 'storyboard' && storyboardSupported ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            Storyboard
          </button>
          <button
            onClick={() => onStudioModeChange('keyframe')}
            className={`text-[11px] px-2.5 py-1 transition-colors ${studioMode === 'keyframe' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            Keyframe
          </button>
        </div>

        {/* Story popover */}
        {concept && (
          <div className="relative">
            <button
              onClick={() => setContextPopover(p => p === 'story' ? null : 'story')}
              className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${contextPopover === 'story' ? 'bg-white/[0.08] text-white border-white/[0.12]' : 'text-zinc-300 border-white/[0.04] hover:bg-white/[0.04]'}`}
              title="Concept summary"
            >
              Story
            </button>
            {contextPopover === 'story' && (
              <div className="absolute top-full right-0 mt-2 w-96 bg-zinc-900 border border-white/[0.08] rounded-xl p-4 shadow-2xl z-30 space-y-2">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-400">
                  <span>Story</span>
                  {concept.deity && <><span>·</span><span className="text-zinc-300 normal-case tracking-normal">{concept.deity}</span></>}
                  {concept.mood && <><span>·</span><span className="text-zinc-300 normal-case tracking-normal">{concept.mood}</span></>}
                </div>
                <p className="text-sm text-zinc-300 leading-relaxed">{concept.conceptDirection || concept.theme}</p>
                {concept.conceptDirection && concept.theme && concept.theme !== concept.conceptDirection && (
                  <p className="text-sm text-zinc-400 leading-relaxed">{concept.theme}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Master shot-prompts popover */}
        {onRewriteShotPrompts && hasBulkPrompt && (
          <div className="relative">
            <button
              onClick={() => setContextPopover(p => p === 'prompts' ? null : 'prompts')}
              className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${contextPopover === 'prompts' ? 'bg-white/[0.08] text-white border-white/[0.12]' : 'text-zinc-300 border-white/[0.04] hover:bg-white/[0.04]'}`}
              title="Master shot-prompts — view or rewrite with a note"
            >
              Prompts
            </button>
            {contextPopover === 'prompts' && (
              <div className="absolute top-full right-0 mt-2 w-[28rem] bg-zinc-900 border border-white/[0.08] rounded-xl p-4 shadow-2xl z-30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wide text-zinc-400">Rewrite all shot prompts</span>
                  <button
                    onClick={() => { onRewriteShotPrompts(bulkNote || undefined); setBulkNote(''); setContextPopover(null); }}
                    disabled={isLoading}
                    className="text-[11px] bg-white text-black rounded-md px-3 py-1.5 font-medium hover:bg-zinc-200 disabled:opacity-50 transition-colors flex items-center gap-2"
                  >
                    {isLoading && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>}
                    {isLoading ? 'Rewriting…' : 'Rewrite all'}
                  </button>
                </div>
                <AutoGrowTextarea
                  value={bulkNote}
                  onChange={e => setBulkNote(e.target.value)}
                  placeholder="Rewrite note — e.g. 'more deity close-ups', 'reduce camera motion'"
                  rows={1}
                  className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.metaKey && !e.shiftKey && bulkNote.trim() && !isLoading) {
                      e.preventDefault();
                      onRewriteShotPrompts(bulkNote); setBulkNote(''); setContextPopover(null);
                    }
                  }}
                />
                <details className="text-[11px] text-zinc-400">
                  <summary className="cursor-pointer hover:text-zinc-300">View current master prompt</summary>
                  <pre className="mt-2 surface-inset rounded-md p-3 text-[11px] text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed max-h-64 overflow-auto">{project?.lastWriteShotsPrompt}</pre>
                </details>
              </div>
            )}
          </div>
        )}

        {/* Bulk actions */}
        {studioMode === 'storyboard' && storyboardSupported ? (
          <button
            onClick={async () => { setBulkRunning('storyboards'); try { await onBulkGenerateStoryboards?.(); } finally { setBulkRunning(null); } }}
            disabled={!onBulkGenerateStoryboards || storyboardsToFire === 0 || bulkRunning !== null}
            className="text-[11px] bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white border border-white/[0.06] rounded-md px-2.5 py-1 transition-colors disabled:opacity-40 flex items-center gap-1.5"
            title={storyboardsToFire > 0 ? `Generate ${storyboardsToFire} storyboard${storyboardsToFire === 1 ? '' : 's'} with low concurrency.` : 'All eligible storyboards generated or locked.'}
          >
            {bulkRunning === 'storyboards' && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />}
            {bulkRunning === 'storyboards' ? 'Running…' : <>Storyboards <span className="text-zinc-400">({storyboardsToFire})</span></>}
          </button>
        ) : (
          <>
            <button
              onClick={() => onRewriteShotPrompts?.(undefined)}
              disabled={isLoading || !onRewriteShotPrompts || totalShots === 0}
              className="text-[11px] bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white border border-white/[0.06] rounded-md px-2.5 py-1 transition-colors disabled:opacity-40 flex items-center gap-1.5"
              title={missingPromptCount > 0 ? `${missingPromptCount} missing — also rewrites existing.` : 'Rewrite every shot prompt from scratch.'}
            >
              {isLoading && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>}
              Write prompts{missingPromptCount > 0 && <span className="text-zinc-400">({missingPromptCount})</span>}
            </button>
            <button
              onClick={async () => { setBulkRunning('frames'); try { await onBulkGenerateFrames?.(); } finally { setBulkRunning(null); } }}
              disabled={!onBulkGenerateFrames || framesToFire === 0 || bulkRunning !== null}
              className="text-[11px] bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white border border-white/[0.06] rounded-md px-2.5 py-1 transition-colors disabled:opacity-40 flex items-center gap-1.5"
              title={framesToFire > 0 ? `Fire ${framesToFire} start frame${framesToFire === 1 ? '' : 's'} in parallel.` : 'All eligible frames generated.'}
            >
              {bulkRunning === 'frames' && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />}
              {bulkRunning === 'frames' ? 'Running…' : <>Frames <span className="text-zinc-400">({framesToFire})</span></>}
            </button>
          </>
        )}
        <button
          onClick={async () => { setBulkRunning('videos'); try { await onBulkGenerateVideos?.(); } finally { setBulkRunning(null); } }}
          disabled={!onBulkGenerateVideos || videosToFire === 0 || bulkRunning !== null}
          className="text-[11px] bg-white text-black hover:bg-zinc-100 rounded-md px-2.5 py-1 font-medium transition-colors disabled:opacity-40 flex items-center gap-1.5"
          title={videosToFire > 0 ? `Fire ${videosToFire} video${videosToFire === 1 ? '' : 's'} in parallel.` : studioMode === 'storyboard' && storyboardSupported ? 'Lock storyboards first.' : 'Generate frames first.'}
        >
          {bulkRunning === 'videos' && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />}
          {bulkRunning === 'videos' ? 'Running…' : <>Videos <span className="opacity-70">({videosToFire})</span></>}
        </button>
      </div>
    </div>
  );
};
