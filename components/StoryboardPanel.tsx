/**
 * StoryboardPanel — Studio shot panel for Seedance storyboard mode.
 * Matches the PromptToolkit visual rhythm: refs chips → editable cut plan
 * textarea → Generate / Refine / Lock. Cut plan text autosaves on blur.
 *
 * The cut plan lives on the active storyboard version's metadata, not on
 * the shot itself, so we lazy-fetch the storyboard history on mount and
 * after each generate/refine to pick up the active version's cutPlanText.
 */
import React, { useState, useEffect, useRef } from 'react';
import { VideoScene, VideoShot, GenerationStatus, ApiProject } from '../types';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { getStoryboardHistory } from '../services/api';
import type { ShotRefInput } from '../services/api';

interface StoryboardPanelProps {
  project: ApiProject;
  shot: VideoShot;
  scene: VideoScene;

  // Refs — read-only display in this panel; editing happens in keyframe mode
  getActiveRefs: (shot: VideoShot, tab: 'image' | 'endframe' | 'video') => ShotRefInput[];
  resolveRefDisplay: (ref: ShotRefInput, shot: VideoShot) => { label: string; url?: string; removable: boolean };

  // Refine status (parent-owned — shared with PromptToolkit cross-tab tracking)
  isRefining: boolean;
  onRefineStart: (key: string) => void;
  onRefineEnd: (key: string) => void;

  // Storyboard callbacks
  onGenerateStoryboard: (shotId: string) => void | Promise<void>;
  onRefineStoryboard: (shotId: string, feedback: string, previousVersionId?: string) => void | Promise<void>;
  onLockStoryboard: (shotId: string, versionId?: string) => void | Promise<void>;
  onUnlockStoryboard: (shotId: string) => void | Promise<void>;
  onUpdateStoryboardPlan: (shotId: string, cutPlanText: string) => void | Promise<void>;

  setModalImage: (url: string | null) => void;
}

export const StoryboardPanel: React.FC<StoryboardPanelProps> = ({
  project, shot, scene,
  getActiveRefs, resolveRefDisplay,
  isRefining, onRefineStart, onRefineEnd,
  onGenerateStoryboard, onRefineStoryboard, onLockStoryboard, onUnlockStoryboard, onUpdateStoryboardPlan,
  setModalImage,
}) => {
  const [cutPlanText, setCutPlanText] = useState<string>('');
  const [planLoading, setPlanLoading] = useState(false);
  const [planSaved, setPlanSaved] = useState(false);
  const planSavedTimer = useRef<number | null>(null);
  const refineRef = useRef<HTMLTextAreaElement>(null);

  const isGenerating = shot.storyboardStatus === GenerationStatus.LOADING;
  const isError = shot.storyboardStatus === GenerationStatus.ERROR;
  const hasStoryboard = !!shot.storyboardUrl;
  const isLocked = !!shot.storyboardLocked;
  const versionId = shot.storyboardVersionId;

  // Lazy-fetch the active version's cutPlanText whenever the active version changes.
  useEffect(() => {
    if (!versionId) { setCutPlanText(''); return; }
    let cancelled = false;
    setPlanLoading(true);
    getStoryboardHistory(project.id, shot.id)
      .then(d => {
        if (cancelled) return;
        const active = d.versions.find(v => v.id === versionId);
        setCutPlanText(active?.cutPlanText || '');
      })
      .catch(() => { if (!cancelled) setCutPlanText(''); })
      .finally(() => { if (!cancelled) setPlanLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, shot.id, versionId]);

  // Clear the saved-flash timer on unmount
  useEffect(() => () => {
    if (planSavedTimer.current) window.clearTimeout(planSavedTimer.current);
  }, []);

  const handlePlanBlur = async (val: string) => {
    const trimmed = val.trim();
    if (!trimmed || trimmed === cutPlanText.trim()) return;
    try {
      await onUpdateStoryboardPlan(shot.id, trimmed);
      setCutPlanText(trimmed);
      setPlanSaved(true);
      if (planSavedTimer.current) window.clearTimeout(planSavedTimer.current);
      planSavedTimer.current = window.setTimeout(() => setPlanSaved(false), 1500);
    } catch {
      // Parent surfaces error via toast; nothing to revert here since textarea
      // is uncontrolled — artist can retry by editing again.
    }
  };

  const handleRefine = async (feedback: string) => {
    if (!feedback.trim()) return;
    const key = `storyboard:${shot.id}`;
    onRefineStart(key);
    try {
      await onRefineStoryboard(shot.id, feedback, versionId);
    } finally {
      onRefineEnd(key);
    }
  };

  // Locked refs that the storyboard generator binds to. Mirror keyframe
  // refs so the artist has a consistent mental model.
  const refs = getActiveRefs(shot, 'image');

  return (
    <div className="space-y-3">
      {/* Tab header — single tab in storyboard mode */}
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-white">Storyboard</span>
        {isLocked && (
          <span className="text-[10px] uppercase tracking-wider text-emerald-300/80 bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono">
            Locked
          </span>
        )}
      </div>

      {/* Ref chips — locked refs the storyboard binds against */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] text-zinc-500 mr-1">Refs:</span>
        {refs.length === 0 && (
          <span className="text-[11px] text-zinc-500 italic">None — assign cast or environment to bind references.</span>
        )}
        {refs.map((ref, i) => {
          const display = resolveRefDisplay(ref, shot);
          if (!display.url && ref.type !== 'continuity') return null;
          return (
            <div
              key={`${ref.type}-${ref.id || i}`}
              className="group/ref relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border border-white/[0.08] bg-white/[0.02] text-zinc-300 cursor-pointer"
              onClick={() => display.url && setModalImage(display.url)}
            >
              {display.url && <img src={display.url} className="w-4 h-4 rounded-sm object-cover flex-shrink-0" alt="" />}
              <span>{display.label}</span>
              {display.url && (
                <div className="hidden group-hover/ref:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[200] pointer-events-none">
                  <img src={display.url} className="max-w-44 max-h-44 object-contain rounded-lg shadow-xl border border-white/[0.1]" alt={display.label} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Cut plan editor */}
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1 flex items-center gap-2">
          Cut plan
          {planLoading && <span className="text-[10px] normal-case tracking-normal text-zinc-400">Loading…</span>}
          {planSaved && !planLoading && <span className="text-[10px] normal-case tracking-normal text-emerald-400/70">Saved</span>}
        </div>
        {!hasStoryboard ? (
          <div className="surface-inset rounded-md p-3 text-sm text-zinc-400 italic">
            No storyboard yet. Generate to draft a numbered cut plan.
          </div>
        ) : isLocked ? (
          <pre className="surface-inset rounded-md p-3 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{cutPlanText || '(empty cut plan)'}</pre>
        ) : (
          <AutoGrowTextarea
            key={`cutplan-${versionId || shot.id}`}
            defaultValue={cutPlanText}
            onBlur={(e) => handlePlanBlur((e.target as HTMLTextAreaElement).value)}
            placeholder="Panel 1 [00:00-..] - camera: …; action: …; Seedance cue: …"
            rows={5}
            className="w-full surface-inset rounded-md px-3 py-2.5 text-sm text-zinc-300 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 font-mono"
          />
        )}
      </div>

      {/* Generate + Lock buttons */}
      {!isLocked && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onGenerateStoryboard(shot.id)}
            disabled={isGenerating}
            className="px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors flex items-center gap-1.5"
          >
            {isGenerating && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />}
            {isGenerating ? 'Generating…' : hasStoryboard ? 'Regenerate' : 'Generate storyboard'}
          </button>
          {hasStoryboard && (
            <button
              onClick={() => onLockStoryboard(shot.id, versionId)}
              disabled={isGenerating}
              className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md text-xs font-medium transition-colors disabled:opacity-50"
              title="Lock this storyboard so video generation can use it."
            >
              Lock
            </button>
          )}
        </div>
      )}

      {isLocked && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onUnlockStoryboard(shot.id)}
            className="text-[11px] text-zinc-400 hover:text-white transition-colors flex items-center gap-1.5"
            title="Unlock to refine or regenerate this storyboard."
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
            </svg>
            Unlock storyboard
          </button>
        </div>
      )}

      {/* Error banner — match keyframe pattern */}
      {isError && !isGenerating && (
        <div className="surface-inset border border-red-500/10 bg-red-500/[0.04] rounded-md px-3 py-2 space-y-1">
          <span className="text-xs text-red-300">Storyboard generation failed — click regenerate to retry.</span>
          {shot.lastError && (
            <p className="text-[11px] text-red-300/60 font-mono leading-snug break-all">{shot.lastError.slice(0, 200)}</p>
          )}
        </div>
      )}

      {/* Refine — disabled when locked */}
      {!isLocked && hasStoryboard && (
        <>
          <div className="h-px bg-white/[0.06] my-1" />
          <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-2">
            Refine — describe what's wrong, GPT rewrites the storyboard
          </div>
          <div className="flex gap-2">
            <AutoGrowTextarea
              inputRef={refineRef}
              placeholder="e.g. 'panel 3 should pull wider', 'add a cutaway to the lamp before the bow'"
              rows={1}
              disabled={isRefining || isGenerating}
              className="flex-1 surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isRefining && !isGenerating) {
                  const target = e.target as HTMLTextAreaElement;
                  if (target.value.trim()) {
                    e.preventDefault();
                    handleRefine(target.value);
                    target.value = '';
                  }
                }
              }}
            />
            <button
              disabled={isRefining || isGenerating}
              onClick={() => {
                const el = refineRef.current;
                if (el?.value.trim() && !isRefining && !isGenerating) {
                  handleRefine(el.value);
                  el.value = '';
                }
              }}
              className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-400 hover:text-white rounded-md text-xs font-medium transition-colors flex-shrink-0 self-start disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {isRefining && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />}
              {isRefining ? 'Refining…' : 'Refine'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
