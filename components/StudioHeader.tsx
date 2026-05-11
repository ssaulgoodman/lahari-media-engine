/**
 * StudioHeader — extracted from Storyboard.tsx.
 * Sticky context bar: progress stats, story popover, master-prompt popover,
 * and bulk actions. Scene + shot navigation lives in StudioShotNav (right
 * sidebar) — having it in two places was redundant and noisy.
 */
import React, { useState, useRef, useEffect } from 'react';
import { VideoScene, VideoShot, GenerationStatus, ApiProject } from '../types';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { STORYBOARD_PROVIDERS } from '../constants/storyboardProviders';

interface StudioHeaderProps {
  scenes: VideoScene[];
  project: ApiProject | null;
  onRewriteShotPrompts?: (userNote?: string) => void;
  onCancelRewritePrompts?: () => void;
  onBulkGenerateFrames?: () => Promise<void> | void;
  onBulkGenerateVideos?: () => Promise<void> | void;
  onBulkWriteStoryboardPrompts?: () => Promise<void> | void;
  onBulkGenerateStoryboards?: () => Promise<void> | void;
  onCancelBulk?: () => void;
  bulkStopNotice?: string | null;
  studioMode: 'storyboard' | 'keyframe';
  onStudioModeChange: (mode: 'storyboard' | 'keyframe') => void;
  storyboardSupported: boolean;
  onUpdateProject?: (updates: Record<string, any>) => void;
  isLoading?: boolean;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  scenes, project,
  onRewriteShotPrompts, onCancelRewritePrompts, onBulkGenerateFrames, onBulkGenerateVideos, onBulkWriteStoryboardPrompts, onBulkGenerateStoryboards, onCancelBulk, bulkStopNotice, studioMode, onStudioModeChange, storyboardSupported, onUpdateProject, isLoading,
}) => {
  const [contextPopover, setContextPopover] = useState<'story' | 'prompts' | null>(null);
  const contextBarRef = useRef<HTMLDivElement>(null);
  const [bulkNote, setBulkNote] = useState('');
  const [bulkRunning, setBulkRunning] = useState<'storyboard-prompts' | 'storyboards' | 'frames' | 'videos' | null>(null);

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

  // Derived stats — only the bits this top bar still uses. Progress totals
  // moved to StudioShotNav; per-bulk-button counts stay here so each button
  // can show "(N)" remaining.
  const hasBulkPrompt = !!project?.lastWriteShotsPrompt;
  const totalShots = scenes.reduce((acc, s) => acc + s.shots.length, 0);
  const concept = project?.lockedConcept;

  const missingPromptCount = scenes.reduce(
    (acc, s) => acc + s.shots.filter(x => !x.visualPrompt || !x.visualPrompt.trim()).length, 0
  );
  const ignoreContinuity = studioMode === 'storyboard' && storyboardSupported;
  const framesToFire = scenes.reduce((acc, s) => {
    return acc + s.shots.filter((shot, idx) => {
      if (shot.imageUrl) return false;
      if (shot.imageStatus === GenerationStatus.LOADING) return false;
      if (!ignoreContinuity && shot.continuityFrom === 'prev_shot' && idx > 0) {
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
      if (!ignoreContinuity && shot.continuityFrom === 'prev_shot' && idx > 0) {
        const prev = s.shots[idx - 1];
        if (!prev?.videoUrl) return false;
      }
      return true;
    }).length;
  }, 0);
  const storyboardsToFire = scenes.reduce((acc, s) => {
    return acc + s.shots.filter(shot => {
      if (shot.storyboardLocked || shot.storyboardUrl) return false;
      if (!shot.storyboardPrompt?.trim()) return false;
      if (shot.storyboardStatus === GenerationStatus.LOADING || shot.storyboardStatus === GenerationStatus.ERROR) return false;
      return true;
    }).length;
  }, 0);
  const storyboardPromptsToWrite = scenes.reduce((acc, s) => {
    return acc + s.shots.filter(shot => {
      if (shot.storyboardPrompt?.trim()) return false;
      if (shot.storyboardPromptStatus === GenerationStatus.LOADING || shot.storyboardPromptStatus === GenerationStatus.ERROR) return false;
      return true;
    }).length;
  }, 0);
  const storyboardProvider = STORYBOARD_PROVIDERS.find(p => p.key === project?.storyboardProvider) || STORYBOARD_PROVIDERS[0];

  return (
    <div ref={contextBarRef} className="sticky top-0 z-40 mb-6">
      <div className="surface rounded-xl border border-white/[0.06] bg-[#141418] shadow-md shadow-black/15 px-4 py-2.5 flex items-center gap-2 flex-wrap">
        {/* Studio mode — leads the bar now that progress lives in the sidebar. */}
        <div className="flex gap-px bg-white/[0.04] rounded-md overflow-hidden border border-white/[0.04] mr-auto" title={storyboardSupported ? 'Choose the generation workflow for this Studio session.' : 'Storyboard mode is available for Seedance models.'}>
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
                  {isLoading ? (
                    <button
                      onClick={onCancelRewritePrompts}
                      className="text-[11px] bg-amber-500/10 hover:bg-amber-500/15 text-amber-300 border border-amber-500/20 rounded-md px-3 py-1.5 font-medium transition-colors"
                      title="Stops waiting for the prompt rewrite. Server work may still finish."
                    >
                      Stop waiting
                    </button>
                  ) : (
                    <button
                      onClick={() => { onRewriteShotPrompts(bulkNote || undefined); setBulkNote(''); setContextPopover(null); }}
                      className="text-[11px] bg-white text-black rounded-md px-3 py-1.5 font-medium hover:bg-zinc-200 transition-colors flex items-center gap-2"
                    >
                      Rewrite all
                    </button>
                  )}
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
        {bulkRunning && (
          <button
            onClick={() => { onCancelBulk?.(); setBulkRunning(null); }}
            className="text-[11px] bg-amber-500/10 hover:bg-amber-500/15 text-amber-300 border border-amber-500/20 rounded-md px-2.5 py-1 transition-colors"
            title="Stops queued jobs and aborts browser requests. Active provider generations may still finish."
          >
            Stop queue
          </button>
        )}
        {studioMode === 'storyboard' && storyboardSupported ? (
          <>
            <button
              onClick={async () => { setBulkRunning('storyboard-prompts'); try { await onBulkWriteStoryboardPrompts?.(); } finally { setBulkRunning(null); } }}
              disabled={!onBulkWriteStoryboardPrompts || storyboardPromptsToWrite === 0 || bulkRunning !== null}
              className="text-[11px] bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white border border-white/[0.06] rounded-md px-2.5 py-1 transition-colors disabled:opacity-40 flex items-center gap-1.5"
              title={storyboardPromptsToWrite > 0 ? `Write ${storyboardPromptsToWrite} storyboard prompt${storyboardPromptsToWrite === 1 ? '' : 's'} first.` : 'All storyboard prompts are written.'}
            >
              {bulkRunning === 'storyboard-prompts' && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />}
              {bulkRunning === 'storyboard-prompts' ? 'Writing…' : <>Board prompts <span className="text-zinc-400">({storyboardPromptsToWrite})</span></>}
            </button>
            <button
              onClick={async () => { setBulkRunning('storyboards'); try { await onBulkGenerateStoryboards?.(); } finally { setBulkRunning(null); } }}
              disabled={!onBulkGenerateStoryboards || storyboardsToFire === 0 || bulkRunning !== null}
              className="text-[11px] bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white border border-white/[0.06] rounded-md px-2.5 py-1 transition-colors disabled:opacity-40 flex items-center gap-1.5"
              title={storyboardsToFire > 0 ? `${storyboardProvider.label}: ${storyboardProvider.note}` : 'Write prompts first, or all storyboard images are generated/locked.'}
            >
              {bulkRunning === 'storyboards' && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />}
              {bulkRunning === 'storyboards' ? 'Rendering…' : <>Board images <span className="text-zinc-400">({storyboardsToFire})</span></>}
            </button>
          </>
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
            {isLoading && onCancelRewritePrompts && (
              <button
                onClick={onCancelRewritePrompts}
                className="text-[11px] bg-amber-500/10 hover:bg-amber-500/15 text-amber-300 border border-amber-500/20 rounded-md px-2.5 py-1 transition-colors"
                title="Stops waiting for the prompt rewrite. Server work may still finish."
              >
                Stop prompts
              </button>
            )}
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
        {bulkStopNotice && (
          <span className="text-[11px] text-amber-300/80 max-w-xs truncate" title={bulkStopNotice}>{bulkStopNotice}</span>
        )}
      </div>
    </div>
  );
};
