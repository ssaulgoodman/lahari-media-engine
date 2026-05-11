/**
 * StoryboardPanel — Studio shot panel for Seedance storyboard mode.
 *
 * Two sub-tabs: Storyboard (ordered cut plan editor + generate/refine/lock)
 * and Video (read-only preview of what Seedance will see + generate button).
 *
 * The cut plan lives on the active storyboard version's metadata, so we
 * lazy-fetch the storyboard history on mount and after each version change,
 * load the active version's cutPlanText into controlled local state, and
 * autosave on blur with explicit Saving / Saved / Save failed states.
 *
 * Refs shown here are exactly the ones the backend binds against — locked
 * style, locked cast (those with reference images), and locked environment.
 * No uploaded shot refs, no continuity refs, no artist-edited ref list:
 * the storyboard generator ignores those.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VideoScene, VideoShot, GenerationStatus, ApiProject } from '../types';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { getStoryboardHistory } from '../services/api';
import type { ShotRefInput, StoryboardRefineMode } from '../services/api';

type SubTab = 'storyboard' | 'video';
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

interface StoryboardPanelProps {
  project: ApiProject;
  shot: VideoShot;
  scene: VideoScene;

  // For ref chip rendering — display-only, the backend rebuilds refs itself.
  resolveRefDisplay: (ref: ShotRefInput, shot: VideoShot) => { label: string; url?: string; removable: boolean };

  // Refine status — shared with PromptToolkit cross-tab tracking.
  isRefining: boolean;
  onRefineStart: (key: string) => void;
  onRefineEnd: (key: string) => void;

  // Storyboard callbacks — required at this boundary; parent guarantees them.
  onWriteStoryboardPrompt: (shotId: string, feedback?: string) => void | Promise<void>;
  onGenerateStoryboard: (shotId: string) => void | Promise<void>;
  onRefineStoryboard: (shotId: string, feedback: string, previousVersionId?: string, refineMode?: StoryboardRefineMode, referenceImage?: File) => void | Promise<void>;
  onLockStoryboard: (shotId: string, versionId?: string) => void | Promise<void>;
  onUnlockStoryboard: (shotId: string) => void | Promise<void>;
  onUpdateStoryboardPlan: (shotId: string, cutPlanText: string, storyboardPrompt?: string) => Promise<void>;
  onUpdateShot: (sceneId: string, shotId: string, updates: Partial<VideoShot>) => void;

  // Video gen — the panel's Video sub-tab fires this once a storyboard is locked.
  onGenerateVideo: (sceneId: string, shotId: string, promptOverride?: string, refs?: ShotRefInput[]) => void;

  setModalImage: (url: string | null) => void;
}

export const StoryboardPanel: React.FC<StoryboardPanelProps> = ({
  project, shot, scene,
  resolveRefDisplay,
  isRefining, onRefineStart, onRefineEnd,
  onWriteStoryboardPrompt, onGenerateStoryboard, onRefineStoryboard, onLockStoryboard, onUnlockStoryboard, onUpdateStoryboardPlan,
  onUpdateShot,
  onGenerateVideo,
  setModalImage,
}) => {
  const [subTab, setSubTab] = useState<SubTab>('storyboard');
  const [refineMode, setRefineMode] = useState<StoryboardRefineMode>('replan');

  // Cut plan is controlled — local state mirrors the active version's text.
  const [cutPlanText, setCutPlanText] = useState<string>('');
  const [promptText, setPromptText] = useState<string>('');
  // Server-known cut plan, used to detect dirty state for autosave.
  const [savedPlanText, setSavedPlanText] = useState<string>('');
  const [savedPromptText, setSavedPromptText] = useState<string>('');
  const [planLoading, setPlanLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const savedFlashTimer = useRef<number | null>(null);
  const refineRef = useRef<HTMLTextAreaElement>(null);
  const [refineImage, setRefineImage] = useState<{ file: File; previewUrl: string } | null>(null);

  const isGenerating = shot.storyboardStatus === GenerationStatus.LOADING;
  const isWritingPrompt = shot.storyboardPromptStatus === GenerationStatus.LOADING;
  const isVideoGenerating = shot.videoStatus === GenerationStatus.LOADING;
  const isError = shot.storyboardStatus === GenerationStatus.ERROR;
  const hasStoryboard = !!shot.storyboardUrl;
  const hasVideo = !!shot.videoUrl;
  const isLocked = !!shot.storyboardLocked;
  const versionId = shot.storyboardVersionId;
  const dirty = cutPlanText.trim() !== savedPlanText.trim() || promptText.trim() !== savedPromptText.trim();
  const saving = saveState === 'saving';
  // The backend rejects empty cutPlanText, and an empty plan would
  // produce a meaningless Seedance prompt. When a storyboard exists,
  // the cut plan must be non-empty before lock or video generation
  // is allowed — otherwise the locked version would silently retain
  // the previous server text, mismatching what the artist sees.
  const promptRequired = !promptText.trim();
  const cutPlanRequired = (hasStoryboard || !!promptText.trim()) && cutPlanText.trim() === '';

  // Backend-bound refs only — what the storyboard generator actually uses.
  // Mirrors server/services/storyboard.ts: locked style + locked cast (only
  // members with referenceImageUrl) + locked environment. No continuity, no
  // shot uploads, no artist-removed refs.
  const boundRefs: ShotRefInput[] = [];
  const shotCast = (project.cast || []).filter(c => (shot.castIds || []).includes(c.id) && !!c.referenceImageUrl);
  shotCast.forEach(c => boundRefs.push({ type: 'cast', id: c.id }));
  const shotEnv = shot.environmentId
    ? project.environments?.find(e => e.id === shot.environmentId && !!e.referenceImageUrl)
    : null;
  if (shotEnv) boundRefs.push({ type: 'env', id: shotEnv.id });
  if (project.styleAssetUrl) boundRefs.push({ type: 'style' });

  // Lazy-fetch the active version's cutPlanText whenever the active version
  // changes (after generate/refine the project state updates with a new
  // versionId, which is our cue to re-pull the canonical text).
  useEffect(() => {
    if (!versionId) {
      setCutPlanText(shot.storyboardCutPlan || '');
      setSavedPlanText(shot.storyboardCutPlan || '');
      setPromptText(shot.storyboardPrompt || '');
      setSavedPromptText(shot.storyboardPrompt || '');
      setSaveState('idle');
      return;
    }
    let cancelled = false;
    setPlanLoading(true);
    getStoryboardHistory(project.id, shot.id)
      .then(d => {
        if (cancelled) return;
        const active = d.versions.find(v => v.id === versionId);
        const text = active?.cutPlanText || shot.storyboardCutPlan || '';
        setCutPlanText(text);
        setSavedPlanText(text);
        setPromptText(shot.storyboardPrompt || '');
        setSavedPromptText(shot.storyboardPrompt || '');
        setSaveState('idle');
      })
      .catch(() => {
        if (cancelled) return;
        setCutPlanText('');
        setSavedPlanText('');
      })
      .finally(() => { if (!cancelled) setPlanLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, shot.id, versionId]);

  // Clear any pending Saved-flash timer on unmount.
  useEffect(() => () => {
    if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
  }, []);

  useEffect(() => () => {
    if (refineImage) URL.revokeObjectURL(refineImage.previewUrl);
  }, [refineImage]);

  // The single save path used by both onBlur autosave and the explicit Lock
  // flush below. Returns true on success so callers can sequence follow-ups.
  // An empty cut plan with a storyboard present is treated as a hard failure:
  // the backend rejects empty cutPlanText, and silently treating it as saved
  // would let Lock freeze the previous server text instead of what the artist
  // sees. A no-storyboard or no-change call is a no-op success.
  const flushPlan = useCallback(async (): Promise<boolean> => {
    const trimmed = cutPlanText.trim();
    const promptTrimmed = promptText.trim();
    if (!trimmed) {
      if (hasStoryboard || promptTrimmed) {
        setSaveState('failed');
        return false;
      }
      return true;
    }
    if (!promptTrimmed) {
      setSaveState('failed');
      return false;
    }
    if (trimmed === savedPlanText.trim() && promptTrimmed === savedPromptText.trim()) return true;
    setSaveState('saving');
    if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
    try {
      await onUpdateStoryboardPlan(shot.id, trimmed, promptTrimmed);
      setSavedPlanText(trimmed);
      setSavedPromptText(promptTrimmed);
      setSaveState('saved');
      savedFlashTimer.current = window.setTimeout(() => setSaveState('idle'), 1500);
      return true;
    } catch {
      setSaveState('failed');
      return false;
    }
  }, [cutPlanText, promptText, savedPlanText, savedPromptText, hasStoryboard, onUpdateStoryboardPlan, shot.id]);

  const handleLock = async () => {
    // Defense in depth — Lock is also disabled in the UI when these are true.
    if (saving || cutPlanRequired) return;
    // Flush any unsaved edit BEFORE locking, so we never freeze stale text
    // into the locked version. If save fails, abort the lock — the artist
    // sees the failed state and can retry.
    if (dirty) {
      const ok = await flushPlan();
      if (!ok) return;
    }
    await onLockStoryboard(shot.id, versionId);
  };

  const handleRefine = async (feedback: string) => {
    if (!feedback.trim()) return;
    const key = `storyboard:${shot.id}`;
    onRefineStart(key);
    try {
      await onRefineStoryboard(shot.id, feedback, versionId, refineMode, refineImage?.file);
    } finally {
      onRefineEnd(key);
      if (refineImage) {
        URL.revokeObjectURL(refineImage.previewUrl);
        setRefineImage(null);
      }
    }
  };

  return (
    <div className="space-y-3">
      {/* Sub-tabs: Storyboard | Video — same visual rhythm as PromptToolkit */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => setSubTab('storyboard')}
          className={`text-sm font-medium transition-colors ${subTab === 'storyboard' ? 'text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
        >Storyboard</button>
        <button
          onClick={() => setSubTab('video')}
          className={`text-sm font-medium transition-colors ${subTab === 'video' ? 'text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
        >Video</button>
        {isLocked && (
          <span className="text-[10px] uppercase tracking-wider text-emerald-300/80 bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono">
            Locked
          </span>
        )}
      </div>

      {/* Bound refs — display-only. Same chip pattern as keyframe mode but
          without remove buttons; refs are derived from the locked entities,
          not editable here. Manage them in the Blueprint phase. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] text-zinc-500 mr-1">Refs:</span>
        {boundRefs.length === 0 ? (
          <span className="text-[11px] text-zinc-500 italic">None — assign cast or environment in Blueprint to bind references.</span>
        ) : boundRefs.map((ref, i) => {
          const display = resolveRefDisplay(ref, shot);
          if (!display.url) return null;
          return (
            <div
              key={`${ref.type}-${ref.id || i}`}
              className="group/ref relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border border-white/[0.08] bg-white/[0.02] text-zinc-300 cursor-pointer"
              onClick={() => setModalImage(display.url!)}
            >
              <img src={display.url} className="w-4 h-4 rounded-sm object-cover flex-shrink-0" alt="" />
              <span>{display.label}</span>
              <div className="hidden group-hover/ref:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[200] pointer-events-none">
                <img src={display.url} className="max-w-44 max-h-44 object-contain rounded-lg shadow-xl border border-white/[0.1]" alt={display.label} />
              </div>
            </div>
          );
        })}
      </div>

      {subTab === 'storyboard' ? (
        <StoryboardTabBody
          shot={shot}
          isLocked={isLocked}
          isGenerating={isGenerating}
          isError={isError}
          isRefining={isRefining}
          hasStoryboard={hasStoryboard}
          versionId={versionId}
          planLoading={planLoading}
          saveState={saveState}
          dirty={dirty}
          cutPlanRequired={cutPlanRequired}
          promptRequired={promptRequired}
          cutPlanText={cutPlanText}
          promptText={promptText}
          refineMode={refineMode}
          onRefineModeChange={setRefineMode}
          onPromptChange={(v) => { setPromptText(v); if (saveState === 'saved') setSaveState('idle'); }}
          onCutPlanChange={(v) => { setCutPlanText(v); if (saveState === 'saved') setSaveState('idle'); }}
          onPlanBlur={flushPlan}
          onPlanRetry={flushPlan}
          refineImage={refineImage}
          onRefineImageChange={setRefineImage}
          onWriteStoryboardPrompt={onWriteStoryboardPrompt}
          onGenerateStoryboard={onGenerateStoryboard}
          onLock={handleLock}
          onUnlockStoryboard={onUnlockStoryboard}
          onRefine={handleRefine}
          refineRef={refineRef}
        />
      ) : (
        <VideoTabBody
          scene={scene}
          shot={shot}
          isLocked={isLocked}
          hasVideo={hasVideo}
          isVideoGenerating={isVideoGenerating}
          cutPlanText={cutPlanText}
          cutPlanRequired={cutPlanRequired}
          boundRefCount={boundRefs.length}
          onUpdateShot={onUpdateShot}
          onGenerateVideo={onGenerateVideo}
        />
      )}
    </div>
  );
};

// ─── Storyboard sub-tab body ───────────────────────────────────────────────

interface StoryboardTabBodyProps {
  shot: VideoShot;
  isLocked: boolean;
  isGenerating: boolean;
  isError: boolean;
  isRefining: boolean;
  hasStoryboard: boolean;
  versionId?: string;
  planLoading: boolean;
  saveState: SaveState;
  dirty: boolean;
  cutPlanRequired: boolean;
  promptRequired: boolean;
  cutPlanText: string;
  promptText: string;
  refineMode: StoryboardRefineMode;
  onRefineModeChange: (mode: StoryboardRefineMode) => void;
  onPromptChange: (v: string) => void;
  onCutPlanChange: (v: string) => void;
  onPlanBlur: () => Promise<boolean>;
  onPlanRetry: () => Promise<boolean>;
  refineImage: { file: File; previewUrl: string } | null;
  onRefineImageChange: (image: { file: File; previewUrl: string } | null) => void;
  onWriteStoryboardPrompt: (shotId: string, feedback?: string) => void | Promise<void>;
  onGenerateStoryboard: (shotId: string) => void | Promise<void>;
  onLock: () => Promise<void>;
  onUnlockStoryboard: (shotId: string) => void | Promise<void>;
  onRefine: (feedback: string) => Promise<void>;
  refineRef: React.RefObject<HTMLTextAreaElement>;
}

const StoryboardTabBody: React.FC<StoryboardTabBodyProps> = ({
  shot, isLocked, isGenerating, isError, isRefining, hasStoryboard, versionId,
  planLoading, saveState, dirty, cutPlanRequired, promptRequired, cutPlanText, promptText,
  refineMode, onRefineModeChange,
  onPromptChange, onCutPlanChange, onPlanBlur, onPlanRetry,
  refineImage, onRefineImageChange,
  onWriteStoryboardPrompt, onGenerateStoryboard, onLock, onUnlockStoryboard, onRefine, refineRef,
}) => {
  const saving = saveState === 'saving';
  const isWritingPrompt = shot.storyboardPromptStatus === GenerationStatus.LOADING;

  return (
    <>
      {/* Prompt editor */}
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1 flex items-center gap-2">
          Storyboard prompt
          {shot.storyboardPromptStatus === GenerationStatus.LOADING && <span className="text-[10px] normal-case tracking-normal text-zinc-300">Writing…</span>}
          {promptRequired && <span className="text-[10px] normal-case tracking-normal text-amber-300">Prompt required</span>}
        </div>
        {isLocked ? (
          <pre className="surface-inset rounded-md p-3 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{promptText || '(empty prompt)'}</pre>
        ) : (
          <AutoGrowTextarea
            value={promptText}
            onChange={(e) => onPromptChange((e.target as HTMLTextAreaElement).value)}
            onBlur={() => { if (cutPlanText.trim()) void onPlanBlur(); }}
            placeholder="Write or generate the storyboard image prompt first…"
            rows={4}
            className="w-full surface-inset rounded-md px-3 py-2.5 text-sm text-zinc-300 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 font-mono"
          />
        )}
      </div>

      {/* Cut plan editor */}
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1 flex items-center gap-2">
          Cut plan
          {planLoading && <span className="text-[10px] normal-case tracking-normal text-zinc-400">Loading…</span>}
          {!planLoading && cutPlanRequired ? (
            <span className="text-[10px] normal-case tracking-normal text-red-300">Cut plan required</span>
          ) : (
            <>
              {!planLoading && saveState === 'saving' && (
                <span className="text-[10px] normal-case tracking-normal text-zinc-300">Saving…</span>
              )}
              {!planLoading && saveState === 'saved' && (
                <span className="text-[10px] normal-case tracking-normal text-emerald-400/70">Saved</span>
              )}
              {!planLoading && saveState === 'failed' && (
                <button
                  type="button"
                  onClick={onPlanRetry}
                  className="text-[10px] normal-case tracking-normal text-red-300 hover:text-red-200 underline-offset-2 hover:underline"
                  title="Retry save"
                >Save failed — retry</button>
              )}
              {!planLoading && saveState === 'idle' && dirty && (
                <span className="text-[10px] normal-case tracking-normal text-zinc-400">Unsaved</span>
              )}
            </>
          )}
        </div>

        {isLocked ? (
          <pre className="surface-inset rounded-md p-3 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{cutPlanText || '(empty cut plan)'}</pre>
        ) : (
          <AutoGrowTextarea
            value={cutPlanText}
            onChange={(e) => onCutPlanChange((e.target as HTMLTextAreaElement).value)}
            onBlur={() => { void onPlanBlur(); }}
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
            onClick={() => onWriteStoryboardPrompt(shot.id)}
            disabled={isWritingPrompt || isGenerating || saving}
            className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center gap-1.5"
          >
            {isWritingPrompt && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />}
            {isWritingPrompt ? 'Writing…' : promptText.trim() ? 'Rewrite prompt' : 'Write prompt'}
          </button>
          <button
            onClick={() => onGenerateStoryboard(shot.id)}
            disabled={isGenerating || saving || promptRequired || cutPlanRequired}
            className="px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors flex items-center gap-1.5"
            title={promptRequired ? 'Write a storyboard prompt first.' : cutPlanRequired ? 'Write a cut plan first.' : undefined}
          >
            {isGenerating && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />}
            {isGenerating ? 'Rendering…' : hasStoryboard ? 'Regenerate image' : 'Generate image'}
          </button>
          {hasStoryboard && (
            <button
              onClick={onLock}
              disabled={isGenerating || saving || cutPlanRequired}
              className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
              title={cutPlanRequired ? 'Write a cut plan before locking — empty plans cannot drive Seedance.' : saving ? 'Saving cut plan first…' : 'Lock this storyboard so video generation can use it.'}
            >
              {saving && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />}
              {saving ? 'Locking…' : 'Lock'}
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

      {/* Error banner */}
      {isError && !isGenerating && (
        <div className="surface-inset border border-red-500/10 bg-red-500/[0.04] rounded-md px-3 py-2 space-y-1">
          <span className="text-xs text-red-300">Storyboard generation failed — click regenerate to retry.</span>
          {shot.lastError && (
            <p className="text-[11px] text-red-300/60 font-mono leading-snug break-all">{shot.lastError.slice(0, 200)}</p>
          )}
        </div>
      )}

      {/* Refine — disabled when locked */}
      {!isLocked && (hasStoryboard || promptText.trim()) && (
        <>
          <div className="h-px bg-white/[0.06] my-1" />
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
              Refine storyboard
            </div>
            <div className="flex gap-px bg-white/[0.04] rounded-md overflow-hidden border border-white/[0.04]">
              {([
                ['replan', 'Redo', 'Rewrite the cut plan and draw a fresh board.'],
                ['edit_image', 'Edit', 'Keep the cut plan; edit the current board image.'],
              ] as const).map(([mode, label, hint]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onRefineModeChange(mode)}
                  disabled={isRefining || isGenerating || (mode === 'edit_image' && !hasStoryboard)}
                  className={`text-[11px] px-2.5 py-1 transition-colors disabled:opacity-50 ${
                    refineMode === mode
                      ? 'bg-white/[0.1] text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  title={hint}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {refineImage && (
            <div className="flex items-center gap-1.5 mb-2">
              <img src={refineImage.previewUrl} className="w-8 h-8 rounded object-cover border border-amber-400/30" alt="Reference" />
              <span className="text-[10px] text-zinc-400">Your ref</span>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(refineImage.previewUrl);
                  onRefineImageChange(null);
                }}
                className="text-zinc-500 hover:text-red-400 transition-colors"
                title="Remove attached reference"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <AutoGrowTextarea
              inputRef={refineRef}
              placeholder={refineMode === 'replan'
                ? "e.g. 'make it 4 panels', 'fewer cuts', 'make the landing more intimate'"
                : "e.g. 'fix the hand', 'remove the number', 'keep same panels but make Ganesha screen-right'"}
              rows={1}
              disabled={isRefining || isGenerating}
              className="flex-1 surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isRefining && !isGenerating) {
                  const target = e.target as HTMLTextAreaElement;
                  if (target.value.trim()) {
                    e.preventDefault();
                    void onRefine(target.value);
                    target.value = '';
                  }
                }
              }}
            />
            <label className="px-2 py-2 bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-white rounded-md transition-colors flex-shrink-0 self-start cursor-pointer flex items-center disabled:opacity-50" title="Attach a reference image for this storyboard refinement">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>
              <input type="file" accept="image/*" className="hidden" disabled={isRefining || isGenerating} onChange={e => {
                const file = e.target.files?.[0];
                if (file) {
                  if (refineImage) URL.revokeObjectURL(refineImage.previewUrl);
                  onRefineImageChange({ file, previewUrl: URL.createObjectURL(file) });
                }
                e.target.value = '';
              }} />
            </label>
            <button
              disabled={isRefining || isGenerating}
              onClick={() => {
                const el = refineRef.current;
                if (el?.value.trim() && !isRefining && !isGenerating) {
                  void onRefine(el.value);
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
    </>
  );
};

// ─── Video sub-tab body ────────────────────────────────────────────────────
//
// Read-only preview of what Seedance receives + a Generate button. The
// motion guidance comes from the cut plan, so artists who want to influence
// the video edit it via the Storyboard tab's cut plan textarea.

interface VideoTabBodyProps {
  scene: VideoScene;
  shot: VideoShot;
  isLocked: boolean;
  hasVideo: boolean;
  isVideoGenerating: boolean;
  cutPlanText: string;
  cutPlanRequired: boolean;
  boundRefCount: number;
  onUpdateShot: (sceneId: string, shotId: string, updates: Partial<VideoShot>) => void;
  onGenerateVideo: (sceneId: string, shotId: string, promptOverride?: string, refs?: ShotRefInput[]) => void;
}

const VideoTabBody: React.FC<VideoTabBodyProps> = ({
  scene, shot, isLocked, hasVideo, isVideoGenerating, cutPlanText, cutPlanRequired, boundRefCount, onUpdateShot, onGenerateVideo,
}) => {
  const canGenerate = isLocked && !isVideoGenerating && !cutPlanRequired;
  const audioLine = shot.lipsyncEnabled ? '\naudio 1 = sliced song segment for subtle visible vocal lip-sync' : '';
  const previewLine = `@image1 = locked storyboard${boundRefCount > 0 ? `, @image2..${boundRefCount + 1} = locked refs` : ''}${audioLine}`;

  return (
    <>
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1">Seedance prompt preview</div>
        <pre className="surface-inset rounded-md p-3 text-[11px] text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed">
{previewLine}
{`\n\nMotion guide (from cut plan):\n`}
{cutPlanText.trim() || '(empty — generate or edit the cut plan in the Storyboard tab)'}
        </pre>
        <p className="text-[11px] text-zinc-500">
          Seedance receives the locked storyboard plus the cut plan as the motion/cut guide. To change the video, refine the storyboard or edit the cut plan.
        </p>
      </div>

      <label className="surface-inset rounded-md px-3 py-2 flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={!!shot.lipsyncEnabled}
          disabled={isVideoGenerating}
          onChange={(e) => onUpdateShot(scene.id, shot.id, { lipsyncEnabled: e.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-white/10 bg-transparent accent-white"
        />
        <span className="min-w-0">
          <span className="block text-xs font-medium text-zinc-200">Lip-sync from song audio</span>
          <span className="block text-[11px] text-zinc-500 leading-relaxed">
            Sends this shot's sliced audio as an extra Seedance reference. Use only when vocals are present and a singing or chanting face is clearly visible.
          </span>
        </span>
      </label>

      {/* Status + Generate */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onGenerateVideo(scene.id, shot.id, undefined, undefined)}
          disabled={!canGenerate}
          className="px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors flex items-center gap-1.5"
          title={cutPlanRequired ? 'Write a cut plan in the Storyboard tab first.' : !isLocked ? 'Lock the storyboard first' : isVideoGenerating ? 'Video generation in progress' : hasVideo ? 'Regenerate video from the locked storyboard' : 'Generate video from the locked storyboard'}
        >
          {isVideoGenerating && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />}
          {isVideoGenerating ? 'Generating…' : hasVideo ? 'Regenerate video' : 'Generate video'}
        </button>
        {cutPlanRequired ? (
          <span className="text-[11px] text-red-300/80">Cut plan required.</span>
        ) : !isLocked ? (
          <span className="text-[11px] text-zinc-400">Lock the storyboard first.</span>
        ) : null}
      </div>

      {shot.videoStatus === GenerationStatus.ERROR && shot.lastError && !isVideoGenerating && (
        <div className="surface-inset border border-red-500/10 bg-red-500/[0.04] rounded-md px-3 py-2">
          <p className="text-[11px] text-red-300/80 font-mono leading-snug break-all">{shot.lastError.slice(0, 200)}</p>
        </div>
      )}
    </>
  );
};
