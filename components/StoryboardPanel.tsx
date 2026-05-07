/**
 * StoryboardPanel — Studio shot panel for Seedance storyboard mode.
 *
 * Two sub-tabs: Storyboard (numbered cut plan editor + generate/refine/lock)
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
import type { ShotRefInput } from '../services/api';

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
  onGenerateStoryboard: (shotId: string) => void | Promise<void>;
  onRefineStoryboard: (shotId: string, feedback: string, previousVersionId?: string) => void | Promise<void>;
  onLockStoryboard: (shotId: string, versionId?: string) => void | Promise<void>;
  onUnlockStoryboard: (shotId: string) => void | Promise<void>;
  onUpdateStoryboardPlan: (shotId: string, cutPlanText: string) => Promise<void>;

  // Video gen — the panel's Video sub-tab fires this once a storyboard is locked.
  onGenerateVideo: (sceneId: string, shotId: string, promptOverride?: string, refs?: ShotRefInput[]) => void;

  setModalImage: (url: string | null) => void;
}

export const StoryboardPanel: React.FC<StoryboardPanelProps> = ({
  project, shot, scene,
  resolveRefDisplay,
  isRefining, onRefineStart, onRefineEnd,
  onGenerateStoryboard, onRefineStoryboard, onLockStoryboard, onUnlockStoryboard, onUpdateStoryboardPlan,
  onGenerateVideo,
  setModalImage,
}) => {
  const [subTab, setSubTab] = useState<SubTab>('storyboard');

  // Cut plan is controlled — local state mirrors the active version's text.
  const [cutPlanText, setCutPlanText] = useState<string>('');
  // Server-known cut plan, used to detect dirty state for autosave.
  const [savedPlanText, setSavedPlanText] = useState<string>('');
  const [planLoading, setPlanLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const savedFlashTimer = useRef<number | null>(null);
  const refineRef = useRef<HTMLTextAreaElement>(null);

  const isGenerating = shot.storyboardStatus === GenerationStatus.LOADING;
  const isVideoGenerating = shot.videoStatus === GenerationStatus.LOADING;
  const isError = shot.storyboardStatus === GenerationStatus.ERROR;
  const hasStoryboard = !!shot.storyboardUrl;
  const hasVideo = !!shot.videoUrl;
  const isLocked = !!shot.storyboardLocked;
  const versionId = shot.storyboardVersionId;
  const dirty = cutPlanText.trim() !== savedPlanText.trim();
  const saving = saveState === 'saving';

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
      setCutPlanText('');
      setSavedPlanText('');
      setSaveState('idle');
      return;
    }
    let cancelled = false;
    setPlanLoading(true);
    getStoryboardHistory(project.id, shot.id)
      .then(d => {
        if (cancelled) return;
        const active = d.versions.find(v => v.id === versionId);
        const text = active?.cutPlanText || '';
        setCutPlanText(text);
        setSavedPlanText(text);
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

  // The single save path used by both onBlur autosave and the explicit Lock
  // flush below. Returns true on success so callers can sequence follow-ups.
  const flushPlan = useCallback(async (): Promise<boolean> => {
    const trimmed = cutPlanText.trim();
    if (!trimmed || trimmed === savedPlanText.trim()) return true;
    setSaveState('saving');
    if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
    try {
      await onUpdateStoryboardPlan(shot.id, trimmed);
      setSavedPlanText(trimmed);
      setSaveState('saved');
      savedFlashTimer.current = window.setTimeout(() => setSaveState('idle'), 1500);
      return true;
    } catch {
      setSaveState('failed');
      return false;
    }
  }, [cutPlanText, savedPlanText, onUpdateStoryboardPlan, shot.id]);

  const handleLock = async () => {
    // Flush any unsaved cut plan edit BEFORE locking, so we never freeze
    // a stale text into the locked version. If save fails, abort the lock —
    // the artist sees the failed state and can retry.
    if (saving) return;
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
      await onRefineStoryboard(shot.id, feedback, versionId);
    } finally {
      onRefineEnd(key);
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
          cutPlanText={cutPlanText}
          onCutPlanChange={(v) => { setCutPlanText(v); if (saveState === 'saved') setSaveState('idle'); }}
          onPlanBlur={flushPlan}
          onPlanRetry={flushPlan}
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
          boundRefCount={boundRefs.length}
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
  cutPlanText: string;
  onCutPlanChange: (v: string) => void;
  onPlanBlur: () => Promise<boolean>;
  onPlanRetry: () => Promise<boolean>;
  onGenerateStoryboard: (shotId: string) => void | Promise<void>;
  onLock: () => Promise<void>;
  onUnlockStoryboard: (shotId: string) => void | Promise<void>;
  onRefine: (feedback: string) => Promise<void>;
  refineRef: React.RefObject<HTMLTextAreaElement>;
}

const StoryboardTabBody: React.FC<StoryboardTabBodyProps> = ({
  shot, isLocked, isGenerating, isError, isRefining, hasStoryboard, versionId,
  planLoading, saveState, dirty, cutPlanText,
  onCutPlanChange, onPlanBlur, onPlanRetry,
  onGenerateStoryboard, onLock, onUnlockStoryboard, onRefine, refineRef,
}) => {
  const saving = saveState === 'saving';

  return (
    <>
      {/* Cut plan editor */}
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1 flex items-center gap-2">
          Cut plan
          {planLoading && <span className="text-[10px] normal-case tracking-normal text-zinc-400">Loading…</span>}
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
        </div>

        {!hasStoryboard ? (
          <div className="surface-inset rounded-md p-3 text-sm text-zinc-400 italic">
            No storyboard yet. Generate to draft a numbered cut plan.
          </div>
        ) : isLocked ? (
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
            onClick={() => onGenerateStoryboard(shot.id)}
            disabled={isGenerating || saving}
            className="px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors flex items-center gap-1.5"
          >
            {isGenerating && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />}
            {isGenerating ? 'Generating…' : hasStoryboard ? 'Regenerate' : 'Generate storyboard'}
          </button>
          {hasStoryboard && (
            <button
              onClick={onLock}
              disabled={isGenerating || saving}
              className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
              title={saving ? 'Saving cut plan first…' : 'Lock this storyboard so video generation can use it.'}
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
                    void onRefine(target.value);
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
  boundRefCount: number;
  onGenerateVideo: (sceneId: string, shotId: string, promptOverride?: string, refs?: ShotRefInput[]) => void;
}

const VideoTabBody: React.FC<VideoTabBodyProps> = ({
  scene, shot, isLocked, hasVideo, isVideoGenerating, cutPlanText, boundRefCount, onGenerateVideo,
}) => {
  const canGenerate = isLocked && !isVideoGenerating;
  const previewLine = `@image1 = locked storyboard${boundRefCount > 0 ? `, @image2..${boundRefCount + 1} = locked refs` : ''}`;

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

      {/* Status + Generate */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onGenerateVideo(scene.id, shot.id, undefined, undefined)}
          disabled={!canGenerate}
          className="px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors flex items-center gap-1.5"
          title={!isLocked ? 'Lock the storyboard first' : isVideoGenerating ? 'Video generation in progress' : hasVideo ? 'Regenerate video from the locked storyboard' : 'Generate video from the locked storyboard'}
        >
          {isVideoGenerating && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />}
          {isVideoGenerating ? 'Generating…' : hasVideo ? 'Regenerate video' : 'Generate video'}
        </button>
        {!isLocked && (
          <span className="text-[11px] text-zinc-400">Lock the storyboard first.</span>
        )}
      </div>

      {shot.videoStatus === GenerationStatus.ERROR && shot.lastError && !isVideoGenerating && (
        <div className="surface-inset border border-red-500/10 bg-red-500/[0.04] rounded-md px-3 py-2">
          <p className="text-[11px] text-red-300/80 font-mono leading-snug break-all">{shot.lastError.slice(0, 200)}</p>
        </div>
      )}
    </>
  );
};
