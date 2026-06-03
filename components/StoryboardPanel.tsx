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

// Exported so ShotCard can hold the sub-tab as the single source of truth
// and key the displayed media (storyboard image vs. video) off the same
// value the StoryboardPanel sub-tabs control. Without this lift, clicking
// "Video" only swapped the controls below, leaving the storyboard image
// stuck above — daily friction.
export type StoryboardSubTab = 'storyboard' | 'video';
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
  onCancelStoryboard: (shotId: string) => void;
  onLockStoryboard: (shotId: string, versionId?: string) => void | Promise<void>;
  onUnlockStoryboard: (shotId: string) => void | Promise<void>;
  onUpdateStoryboardPlan: (shotId: string, cutPlanText: string, storyboardPrompt?: string) => Promise<void>;
  onUpdateShot: (sceneId: string, shotId: string, updates: Partial<VideoShot>) => void;

  // Video gen — the panel's Video sub-tab fires this once a storyboard is locked.
  onGenerateVideo: (sceneId: string, shotId: string, promptOverride?: string, refs?: ShotRefInput[]) => void;

  setModalImage: (url: string | null) => void;

  // Sub-tab state owned by the parent (ShotCard) so the displayed media
  // above and the controls below switch in lockstep. Optional: when not
  // provided the panel falls back to its own local state for backwards
  // compatibility with any non-storyboard-mode call sites.
  subTab?: StoryboardSubTab;
  onSubTabChange?: (next: StoryboardSubTab) => void;
  lockRequestToken?: number;
  hideLockControls?: boolean;
}

export const StoryboardPanel: React.FC<StoryboardPanelProps> = ({
  project, shot, scene,
  resolveRefDisplay,
  isRefining, onRefineStart, onRefineEnd,
  onWriteStoryboardPrompt, onGenerateStoryboard, onRefineStoryboard, onCancelStoryboard, onLockStoryboard, onUnlockStoryboard, onUpdateStoryboardPlan,
  onUpdateShot,
  onGenerateVideo,
  setModalImage,
  subTab: subTabProp,
  onSubTabChange,
  lockRequestToken,
  hideLockControls = false,
}) => {
  // Controlled/uncontrolled bridge: when the parent passes subTab + onSubTabChange,
  // the panel reads from those (parent-owned). When not, fall back to local state.
  // Lets ShotCard own the source of truth so the media display upstairs stays in
  // sync with the controls down here.
  const [subTabLocal, setSubTabLocal] = useState<StoryboardSubTab>('storyboard');
  const subTab = subTabProp ?? subTabLocal;
  const setSubTab = (next: StoryboardSubTab) => {
    if (onSubTabChange) onSubTabChange(next);
    else setSubTabLocal(next);
  };
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
  // Storyboard prompt is collapsed by default once it has content — the
  // generated text can run several paragraphs and dominates the panel when
  // every shot expands it. Click to expand; a refine auto-expands so the
  // artist sees the change land.
  const [isPromptCollapsed, setIsPromptCollapsed] = useState(true);
  // Transient flash state — flipped true when the server-side prompt or
  // cut plan changes from a refine (NOT from artist typing), false ~1.5s
  // later. Drives a brief amber tint + ring on the affected textareas so
  // the change is visible without diff'ing text manually.
  const [recentlyRefined, setRecentlyRefined] = useState(false);
  const recentlyRefinedTimer = useRef<number | null>(null);
  // Track the last server-side prompt + cut plan we observed, so the replan-
  // sync effect can distinguish "fresh prop value on mount" (no flash) from
  // "value changed externally while mounted" (flash). Reset on shot switch.
  const prevServerPromptRef = useRef<string | null>(null);
  const prevServerPlanRef = useRef<string | null>(null);

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

  // Previous shot in the same scene — used to power the "+ Prev storyboard"
  // continuity chip. Lookup is local to the loaded project; gen-time resolution
  // happens server-side independently. We surface here only the data the chip
  // needs to render: the prev shot's storyboard image (for thumbnail) and
  // whether it exists at all (controls the button's enabled state).
  const prevShotInScene: VideoShot | undefined = (() => {
    const idx = scene.shots.findIndex(s => s.id === shot.id);
    return idx > 0 ? scene.shots[idx - 1] : undefined;
  })();
  const prevStoryboardUrl = prevShotInScene?.storyboardUrl;
  const continuityChipDisabled = !prevShotInScene || !prevStoryboardUrl;
  const continuityChipActive = !!shot.usePrevStoryboardRef && !continuityChipDisabled;

  // Richer chip metadata for the per-tab ref exclusion UI. Mirrors the server's
  // composition refs (style + locked cast + locked env). Order matches what
  // gets sent to the generator: style first, then cast, then env — keeps the
  // chip row visually aligned with the prompt's "Reference bindings" ordering.
  // The continuity chip (prev storyboard) is appended last when active.
  const refChips: { key: string; label: string; imageUrl?: string }[] = [];
  if (project.styleAssetUrl) refChips.push({ key: 'style', label: 'Style', imageUrl: project.styleAssetUrl });
  for (const c of shotCast) refChips.push({ key: `cast:${c.id}`, label: c.name, imageUrl: c.referenceImageUrl });
  if (shotEnv) refChips.push({ key: `env:${shotEnv.id}`, label: shotEnv.name, imageUrl: shotEnv.referenceImageUrl });
  if (continuityChipActive) refChips.push({ key: 'prev_storyboard', label: 'Prev storyboard', imageUrl: prevStoryboardUrl });
  const excludedStoryboard = shot.excludedRefs?.storyboard || [];
  const excludedVideo = shot.excludedRefs?.video || [];
  const toggleRefExclusion = (tab: 'storyboard' | 'video', key: string) => {
    const current = shot.excludedRefs ?? { storyboard: [], video: [] };
    const list = current[tab] || [];
    const newList = list.includes(key) ? list.filter(k => k !== key) : [...list, key];
    onUpdateShot(scene.id, shot.id, { excludedRefs: { ...current, [tab]: newList } });
  };

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

  // Sync local state when the server-side prompt/cutplan change without an
  // accompanying versionId bump. Happens specifically on `replan` refines:
  // the planner step (`/write-storyboard-prompt` via refine-storyboard with
  // refineMode='replan') updates shot.storyboardPrompt + storyboardCutPlan
  // but does NOT create a new storyboard_version, so the version-keyed effect
  // above never refires and the textareas stay stuck on the old text.
  //
  // Guarded by `!dirty && saveState === 'idle'` so an unrelated project
  // refresh mid-typing can't clobber uncommitted artist edits — this is the
  // same protection the version-keyed effect was tightened for earlier.
  useEffect(() => {
    if (dirty || saveState !== 'idle') return;
    const serverPrompt = shot.storyboardPrompt || '';
    const serverPlan = shot.storyboardCutPlan || '';

    // Was this a real external change (refine landed)? Three conditions:
    //  1. We've observed a baseline before (ref not null — skips initial mount).
    //  2. The server value differs from the previously observed one.
    //  3. The artist's locally-saved value also differs from the server
    //     (filters out the artist's own autosave settling — flushPlan
    //     updates savedPromptText synchronously, so own-saves never see
    //     savedPromptText drift from serverPrompt).
    const promptChangedExternally =
      prevServerPromptRef.current !== null &&
      prevServerPromptRef.current !== serverPrompt &&
      savedPromptText !== serverPrompt;
    const planChangedExternally =
      prevServerPlanRef.current !== null &&
      prevServerPlanRef.current !== serverPlan &&
      savedPlanText !== serverPlan;

    // Mirror local state to the server values when they drift (handles the
    // replan-refine case where versionId doesn't bump).
    if (serverPrompt !== savedPromptText) {
      setPromptText(serverPrompt);
      setSavedPromptText(serverPrompt);
    }
    if (serverPlan !== savedPlanText) {
      setCutPlanText(serverPlan);
      setSavedPlanText(serverPlan);
    }

    if (promptChangedExternally || planChangedExternally) {
      // Auto-expand the prompt so the new text is actually visible, and
      // flash both fields briefly so the artist sees where the change
      // landed without having to diff prose.
      setIsPromptCollapsed(false);
      setRecentlyRefined(true);
      if (recentlyRefinedTimer.current) window.clearTimeout(recentlyRefinedTimer.current);
      recentlyRefinedTimer.current = window.setTimeout(() => setRecentlyRefined(false), 1500);
    }

    prevServerPromptRef.current = serverPrompt;
    prevServerPlanRef.current = serverPlan;
  }, [shot.storyboardPrompt, shot.storyboardCutPlan, dirty, saveState, savedPromptText, savedPlanText]);

  // Reset on shot switch — refs to no-flash baseline, collapse to default,
  // and clear any in-flight flash from the previous shot so it doesn't leak
  // across navigation.
  useEffect(() => {
    prevServerPromptRef.current = null;
    prevServerPlanRef.current = null;
    setRecentlyRefined(false);
    setIsPromptCollapsed(true);
    if (recentlyRefinedTimer.current) {
      window.clearTimeout(recentlyRefinedTimer.current);
      recentlyRefinedTimer.current = null;
    }
  }, [shot.id]);

  // Clear any pending Saved-flash + recently-refined timers on unmount.
  useEffect(() => () => {
    if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
    if (recentlyRefinedTimer.current) window.clearTimeout(recentlyRefinedTimer.current);
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

  const lastLockRequestRef = useRef(lockRequestToken ?? 0);
  useEffect(() => {
    const token = lockRequestToken ?? 0;
    if (token <= lastLockRequestRef.current) return;
    lastLockRequestRef.current = token;
    if (!isLocked && hasStoryboard) void handleLock();
  }, [lockRequestToken, isLocked, hasStoryboard, handleLock]);

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
      {/* Sub-tabs: Storyboard | Video. Visible clickable affordance — small
          padding + underline on active so the tab state is obvious and the
          button is clearly a button, not passive text. Clicking either also
          swaps the media displayed above via the lifted state in ShotCard. */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setSubTab('storyboard')}
          className={`relative text-sm font-medium px-2 py-1 rounded cursor-pointer transition-colors ${
            subTab === 'storyboard'
              ? 'text-white'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]'
          }`}
        >
          Storyboard
          {subTab === 'storyboard' && <span className="absolute left-2 right-2 -bottom-px h-px bg-white/70" />}
        </button>
        <button
          type="button"
          onClick={() => setSubTab('video')}
          className={`relative text-sm font-medium px-2 py-1 rounded cursor-pointer transition-colors ${
            subTab === 'video'
              ? 'text-white'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]'
          }`}
        >
          Video
          {subTab === 'video' && <span className="absolute left-2 right-2 -bottom-px h-px bg-white/70" />}
        </button>
        {isLocked && (
          <span className="ml-3 text-[10px] uppercase tracking-wider text-emerald-300/80 bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono">
            Locked
          </span>
        )}
      </div>

      {/* Bound refs — tab-aware. The active sub-tab decides which exclusion
          list this row toggles: chips clicked × on the Storyboard sub-tab
          drop the ref from storyboard image gen; the same chips clicked
          × on the Video sub-tab drop the ref from Seedance only. Excluded
          chips render greyed with a + to restore. The locked storyboard
          image itself (which Seedance always animates) isn't in this row —
          it's not removable. */}
      {(() => {
        const excluded = subTab === 'storyboard' ? excludedStoryboard : excludedVideo;
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-zinc-500 mr-1">
              {subTab === 'storyboard' ? 'Storyboard refs:' : 'Seedance refs:'}
            </span>
            {refChips.length === 0 ? (
              <span className="text-[11px] text-zinc-500 italic">None — assign cast or environment in Blueprint to bind references.</span>
            ) : refChips.map(chip => {
              const isExcluded = excluded.includes(chip.key);
              return (
                <div
                  key={chip.key}
                  className={`group/ref relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border transition-opacity ${
                    isExcluded
                      ? 'border-white/[0.06] bg-white/[0.01] text-zinc-500 opacity-50'
                      : 'border-white/[0.08] bg-white/[0.02] text-zinc-300'
                  }`}
                >
                  {chip.imageUrl && (
                    <img
                      src={chip.imageUrl}
                      className="w-4 h-4 rounded-sm object-cover flex-shrink-0 cursor-zoom-in"
                      alt=""
                      onClick={() => chip.imageUrl && setModalImage(chip.imageUrl)}
                    />
                  )}
                  <span>{chip.label}</span>
                  <button
                    type="button"
                    onClick={() => {
                      // Continuity chip's × turns the master flag off
                      // entirely (so it disappears from both tabs). For all
                      // other chips × is per-tab exclusion as usual.
                      if (chip.key === 'prev_storyboard') {
                        onUpdateShot(scene.id, shot.id, { usePrevStoryboardRef: false });
                      } else {
                        toggleRefExclusion(subTab, chip.key);
                      }
                    }}
                    className={`ml-0.5 transition-colors ${isExcluded ? 'text-zinc-400 hover:text-emerald-400' : 'text-zinc-500 hover:text-red-400'}`}
                    title={
                      chip.key === 'prev_storyboard'
                        ? 'Remove the previous-shot continuity ref'
                        : isExcluded ? `Add ${chip.label} back to this generation` : `Drop ${chip.label} from this generation`
                    }
                  >
                    {isExcluded ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    )}
                  </button>
                  {chip.imageUrl && (
                    <div className="hidden group-hover/ref:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[200] pointer-events-none">
                      <img src={chip.imageUrl} className="max-w-44 max-h-44 object-contain rounded-lg shadow-xl border border-white/[0.1]" alt={chip.label} />
                    </div>
                  )}
                </div>
              );
            })}
            {/* Continuity affordance — appears at the end of the chip row.
                When inactive: shown as a thin "+ Prev storyboard" button that
                turns continuity on (subject to having a prev shot with a
                board to reference). When active: the chip itself is already
                rendered above with the standard × removal behavior; nothing
                extra here. */}
            {!continuityChipActive && (
              <button
                type="button"
                onClick={() => {
                  if (continuityChipDisabled) return;
                  onUpdateShot(scene.id, shot.id, { usePrevStoryboardRef: true });
                }}
                disabled={continuityChipDisabled}
                // Disabled state intentionally still visible — same border
                // weight as the active state, just muted text. Faint outlines
                // were getting lost on the page; the artist needs to see the
                // affordance even when it's not actionable so the feature
                // is discoverable.
                className={`group/cont flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border transition-colors ${
                  continuityChipDisabled
                    ? 'border-white/[0.08] bg-white/[0.01] text-zinc-500 cursor-not-allowed'
                    : 'border-white/[0.08] bg-white/[0.02] text-zinc-300 hover:border-white/[0.2] hover:text-white hover:bg-white/[0.04]'
                }`}
                title={
                  !prevShotInScene
                    ? 'No previous shot in this scene'
                    : !prevStoryboardUrl
                    ? 'Previous shot has no storyboard yet — generate it first'
                    : "Attach the previous shot's storyboard as a continuity ref. Sent to the planner as visual handoff context and to the image renderer as an extra @image ref."
                }
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <span>Prev storyboard</span>
              </button>
            )}
          </div>
        );
      })()}

      {/* Continuity text toggle — sends the previous shot's cut plan to the
          planner as text context. Separate from the chip row because text is
          not visual (no thumbnail, no per-tab exclusion). Always rendered on
          the Storyboard sub-tab so the affordance is discoverable; disabled
          with tooltip when the artist can't act on it right now (locked
          storyboard, or no prev shot in scene). Smart default: checked when
          continuity_from === 'prev_shot' AND a prev shot exists. Null
          column means "use the default"; explicit true/false overrides. */}
      {subTab === 'storyboard' && (() => {
        const hasPrev = !!prevShotInScene;
        const explicit = shot.includePrevCutPlan;
        const smartDefault = hasPrev && shot.continuityFrom === 'prev_shot';
        const effective = explicit === true ? true : explicit === false ? false : smartDefault;
        const isDefault = explicit === null || explicit === undefined;
        const interactive = hasPrev && !isLocked;
        const reason = !hasPrev
          ? '— no previous shot in scene'
          : isLocked
          ? '— unlock the storyboard to change'
          : '';
        return (
          <label className={`flex items-center gap-2 text-[11px] ${interactive ? 'text-zinc-400 hover:text-zinc-300 cursor-pointer' : 'text-zinc-600 cursor-not-allowed'}`}>
            <input
              type="checkbox"
              disabled={!interactive}
              checked={effective}
              onChange={(e) => {
                onUpdateShot(scene.id, shot.id, { includePrevCutPlan: e.target.checked });
              }}
              className="h-3 w-3 rounded border-white/10 bg-transparent accent-white"
            />
            <span>Include previous cut plan as text context</span>
            {isDefault && hasPrev && (
              <span className="text-zinc-600">(default: {smartDefault ? 'on' : 'off'})</span>
            )}
            {reason && <span className="text-zinc-600">{reason}</span>}
          </label>
        );
      })()}

      {subTab === 'storyboard' ? (
        <StoryboardTabBody
          shot={shot}
          isLocked={isLocked}
          isGenerating={isGenerating}
          isError={isError}
          isRefining={isRefining}
          hasStoryboard={hasStoryboard}
          versionId={versionId}
          saveState={saveState}
          cutPlanRequired={cutPlanRequired}
          promptRequired={promptRequired}
          cutPlanText={cutPlanText}
          promptText={promptText}
          refineMode={refineMode}
          onRefineModeChange={setRefineMode}
          onPromptChange={(v) => { setPromptText(v); if (saveState === 'saved') setSaveState('idle'); }}
          onPlanBlur={flushPlan}
          isPromptCollapsed={isPromptCollapsed}
          onTogglePromptCollapse={() => setIsPromptCollapsed(c => !c)}
          recentlyRefined={recentlyRefined}
          hideLockControls={hideLockControls}
          refineImage={refineImage}
          onRefineImageChange={setRefineImage}
          onWriteStoryboardPrompt={onWriteStoryboardPrompt}
          onGenerateStoryboard={onGenerateStoryboard}
          onCancelStoryboard={onCancelStoryboard}
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
          planLoading={planLoading}
          saveState={saveState}
          dirty={dirty}
          onCutPlanChange={setCutPlanText}
          onPlanBlur={flushPlan}
          onPlanRetry={flushPlan}
          recentlyRefined={recentlyRefined}
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
  // saveState drives `saving` (Lock spinner). The full save indicators
  // (Saving/Saved/Failed badges) moved to the Video tab along with the
  // cut plan editor itself.
  saveState: SaveState;
  cutPlanRequired: boolean;
  promptRequired: boolean;
  cutPlanText: string;
  promptText: string;
  refineMode: StoryboardRefineMode;
  onRefineModeChange: (mode: StoryboardRefineMode) => void;
  onPromptChange: (v: string) => void;
  // onPlanBlur fires when the storyboard prompt textarea loses focus —
  // flushes both the prompt and cut plan to the server in one call.
  onPlanBlur: () => Promise<boolean>;
  // Collapsible prompt: default collapsed once content exists. Refines
  // auto-expand via the parent setting isPromptCollapsed=false.
  isPromptCollapsed: boolean;
  onTogglePromptCollapse: () => void;
  // Transient flash when shot.storyboardPrompt changes externally — see
  // the recently-refined effect in the parent.
  recentlyRefined: boolean;
  hideLockControls: boolean;
  refineImage: { file: File; previewUrl: string } | null;
  onRefineImageChange: (image: { file: File; previewUrl: string } | null) => void;
  onWriteStoryboardPrompt: (shotId: string, feedback?: string) => void | Promise<void>;
  onGenerateStoryboard: (shotId: string) => void | Promise<void>;
  onCancelStoryboard: (shotId: string) => void;
  onLock: () => Promise<void>;
  onUnlockStoryboard: (shotId: string) => void | Promise<void>;
  onRefine: (feedback: string) => Promise<void>;
  refineRef: React.RefObject<HTMLTextAreaElement>;
}

const StoryboardTabBody: React.FC<StoryboardTabBodyProps> = ({
  shot, isLocked, isGenerating, isError, isRefining, hasStoryboard, versionId,
  saveState, cutPlanRequired, promptRequired, cutPlanText, promptText,
  refineMode, onRefineModeChange,
  onPromptChange, onPlanBlur,
  isPromptCollapsed, onTogglePromptCollapse, recentlyRefined,
  hideLockControls,
  refineImage, onRefineImageChange,
  onWriteStoryboardPrompt, onGenerateStoryboard, onCancelStoryboard, onLock, onUnlockStoryboard, onRefine, refineRef,
}) => {
  const saving = saveState === 'saving';
  const isWritingPrompt = shot.storyboardPromptStatus === GenerationStatus.LOADING;
  // Cast / environment changed in Script since this storyboard was planned.
  // Only meaningful once a prompt actually exists — otherwise "stale" is
  // unintuitive. Cleared server-side by writeStoryboardPrompt.
  const promptStale = !!shot.promptsStale && promptText.trim().length > 0;
  const stalenessHint = 'Cast or environment changed since this prompt was written. Rewrite to bring the prompt + cut plan back in sync with the refs.';

  return (
    <>
      {/* Prompt editor — collapsible. Long generated prompts dominate vertical
          space across many shots, so collapse-by-default keeps the panel
          scannable; the refine flow auto-expands when text changes so the
          artist can see what landed. */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500 flex items-center gap-2">
            Storyboard prompt
            {shot.storyboardPromptStatus === GenerationStatus.LOADING && <span className="text-[10px] normal-case tracking-normal text-zinc-300">Writing…</span>}
            {promptRequired && <span className="text-[10px] normal-case tracking-normal text-amber-300">Prompt required</span>}
            {promptStale && !isWritingPrompt && (
              <span
                className="text-[10px] normal-case tracking-normal text-amber-300/80"
                title={stalenessHint}
              >
                Outdated
              </span>
            )}
            {recentlyRefined && !isPromptCollapsed && (
              <span className="text-[10px] normal-case tracking-normal text-amber-300/80">Updated</span>
            )}
          </div>
          {promptText.length > 0 && (
            <button
              type="button"
              onClick={onTogglePromptCollapse}
              className="text-[10px] uppercase tracking-wide text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
              title={isPromptCollapsed ? 'Show full prompt' : 'Hide prompt'}
            >
              {isPromptCollapsed ? 'Show' : 'Hide'}
              <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${isPromptCollapsed ? '' : 'rotate-180'}`} aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          )}
        </div>

        {isPromptCollapsed && promptText.length > 0 ? (
          <button
            type="button"
            onClick={onTogglePromptCollapse}
            className={`w-full surface-inset rounded-md px-3 py-2 text-left text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors flex items-center justify-between gap-3 ${recentlyRefined ? 'ring-1 ring-amber-400/40 bg-amber-400/[0.05]' : ''}`}
          >
            <span className="truncate font-mono">{promptText.replace(/\s+/g, ' ').slice(0, 90)}{promptText.length > 90 ? '…' : ''}</span>
            <span className="text-zinc-500 flex-shrink-0 font-mono tabular-nums">{promptText.length} chars</span>
          </button>
        ) : isLocked ? (
          <pre className={`surface-inset rounded-md p-3 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed transition-all duration-700 ${recentlyRefined ? 'ring-1 ring-amber-400/40 bg-amber-400/[0.05]' : ''}`}>{promptText || '(empty prompt)'}</pre>
        ) : (
          <div className={`rounded-md transition-all duration-700 ${recentlyRefined ? 'ring-1 ring-amber-400/40 bg-amber-400/[0.05]' : ''}`}>
            <AutoGrowTextarea
              value={promptText}
              onChange={(e) => onPromptChange((e.target as HTMLTextAreaElement).value)}
              onBlur={() => { if (cutPlanText.trim()) void onPlanBlur(); }}
              placeholder="Write or generate the storyboard image prompt first…"
              rows={4}
              className="w-full surface-inset rounded-md px-3 py-2.5 text-sm text-zinc-300 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 font-mono"
            />
          </div>
        )}
      </div>

      {/* Cut plan editor moved to Video tab. "Write prompt" still fills both
          shot.storyboardPrompt (shown above) and shot.storyboardCutPlan (the
          video prompt over in the Video tab). Errors below point there when
          the cut plan is missing. */}

      {/* Generate + Lock buttons */}
      {!isLocked && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onWriteStoryboardPrompt(shot.id)}
            disabled={isWritingPrompt || isGenerating || saving}
            // Stale → subtle amber ring nominates Rewrite as the recommended
            // next action. No size change; reads as "this one first" without
            // shouting.
            className={`px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md text-xs font-medium transition-colors disabled:opacity-40 flex items-center gap-1.5 ${promptStale ? 'ring-1 ring-amber-400/40' : ''}`}
            title={promptStale ? stalenessHint : undefined}
          >
            {isWritingPrompt && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />}
            {isWritingPrompt ? 'Writing…' : promptText.trim() ? 'Rewrite prompt' : 'Write prompt'}
          </button>
          {isWritingPrompt && (
            <button
              type="button"
              onClick={() => onCancelStoryboard(shot.id)}
              className="px-2.5 py-1.5 text-xs text-zinc-400 hover:text-white border border-white/[0.08] hover:border-white/20 rounded-md transition-colors"
              title="Stop planner step"
            >
              Stop
            </button>
          )}
          {/* Image gen still hard-blocks on empty cut plan — the backend's
              writeStoryboardPrompt contract guarantees both fields are
              populated, so an empty cut plan here means the planner step
              hasn't run yet and the artist should run it before rendering. */}
          <button
            onClick={() => onGenerateStoryboard(shot.id)}
            disabled={isGenerating || saving || promptRequired || cutPlanRequired}
            className="px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors flex items-center gap-1.5"
            // Tooltip priority: required-fields error > staleness hint >
            // nothing. Staleness only surfaces after the first storyboard
            // exists; before that the artist hasn't seen any output yet so
            // "outdated" is meaningless.
            title={
              promptRequired
                ? 'Write a storyboard prompt first.'
                : cutPlanRequired
                ? 'Run "Write prompt" first — image gen needs the planner output (also fills the video prompt over in the Video tab).'
                : promptStale && hasStoryboard
                ? stalenessHint
                : undefined
            }
          >
            {isGenerating && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />}
            {/* Amber dot when the prompt is stale AND a storyboard already
                exists — warns the artist the next render will use
                out-of-date text. Solid amber-500 reads on the white button;
                amber-300/80 (used elsewhere) is too pale on white. */}
            {promptStale && hasStoryboard && !isGenerating && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            )}
            {isGenerating ? 'Rendering…' : hasStoryboard ? 'Regenerate image' : 'Generate image'}
          </button>
          {isGenerating && (
            <button
              type="button"
              onClick={() => onCancelStoryboard(shot.id)}
              className="px-2.5 py-1.5 text-xs text-zinc-400 hover:text-white border border-white/[0.08] hover:border-white/20 rounded-md transition-colors"
              title="Stop storyboard generation"
            >
              Stop
            </button>
          )}
          {/* Lock no longer hard-blocks on empty cut plan. The artist may
              deliberately delete the cut plan to fall back to Seedance's
              "follow the storyboard image" default — see VideoTabBody and
              seedanceShotList(). The Video prompt label shows "Optional" so
              the artist knows the field is empty by choice. */}
          {hasStoryboard && !hideLockControls && (
            <button
              onClick={onLock}
              disabled={isGenerating || saving}
              className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
              title={saving ? 'Saving first…' : 'Lock this storyboard so video generation can use it.'}
            >
              {saving && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />}
              {saving ? 'Locking…' : 'Lock'}
            </button>
          )}
        </div>
      )}

      {isLocked && !hideLockControls && (
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
            {isRefining && (
              <button
                type="button"
                onClick={() => onCancelStoryboard(shot.id)}
                className="px-2.5 py-2 text-xs text-zinc-400 hover:text-white border border-white/[0.08] hover:border-white/20 rounded-md transition-colors flex-shrink-0 self-start"
                title="Stop refine"
              >
                Stop
              </button>
            )}
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
  // Cut plan (= video prompt for Seedance) editing — same save plumbing as
  // the storyboard tab. Editable only while the storyboard is unlocked;
  // locked shots render the value as a read-only block so the input that
  // produced the published video stays visible but immutable.
  planLoading: boolean;
  saveState: SaveState;
  dirty: boolean;
  onCutPlanChange: (v: string) => void;
  onPlanBlur: () => Promise<boolean>;
  onPlanRetry: () => Promise<boolean>;
  // Transient flash when shot.storyboardCutPlan changes from a refine.
  recentlyRefined: boolean;
  onUpdateShot: (sceneId: string, shotId: string, updates: Partial<VideoShot>) => void;
  onGenerateVideo: (sceneId: string, shotId: string, promptOverride?: string, refs?: ShotRefInput[]) => void;
}

const VideoTabBody: React.FC<VideoTabBodyProps> = ({
  scene, shot, isLocked, hasVideo, isVideoGenerating, cutPlanText, cutPlanRequired,
  planLoading, saveState, dirty, onCutPlanChange, onPlanBlur, onPlanRetry,
  recentlyRefined,
  onUpdateShot, onGenerateVideo,
}) => {
  // Cut plan was previously REQUIRED to generate video; the artist's
  // "follow storyboard, no cut plan" workflow makes that a soft hint
  // instead — the Seedance prompt builder already falls back to a
  // minimal shot list when the cut plan is empty, so generating with no
  // motion guide is safe.
  const canGenerate = isLocked && !isVideoGenerating;

  return (
    <>
      {/* Seedance prompt-bindings preview used to live here as a read-only
          <pre>; the editable chip row at the panel top now conveys the same
          info (and lets the artist toggle exclusions), so the duplicate has
          been removed. */}

      {/* Video prompt = the cut plan. Editable text that drives Seedance's
          motion/cut sequencing. Lives here (not the Storyboard tab) so the
          artist edits it next to the Generate video button it feeds. */}
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1 flex items-center gap-2">
          Video prompt
          {planLoading && <span className="text-[10px] normal-case tracking-normal text-zinc-400">Loading…</span>}
          {!planLoading && cutPlanRequired && (
            <span className="text-[10px] normal-case tracking-normal text-zinc-500" title="Empty — Seedance will use a default 'follow the storyboard image's panel order' guide.">
              Optional
            </span>
          )}
          {!planLoading && saveState === 'saving' && (
            <span className="text-[10px] normal-case tracking-normal text-zinc-300">Saving…</span>
          )}
          {!planLoading && saveState === 'saved' && (
            <span className="text-[10px] normal-case tracking-normal text-emerald-400/70">Saved</span>
          )}
          {!planLoading && saveState === 'failed' && (
            <button
              type="button"
              onClick={() => { void onPlanRetry(); }}
              className="text-[10px] normal-case tracking-normal text-red-300 hover:text-red-200 underline-offset-2 hover:underline"
              title="Retry save"
            >Save failed — retry</button>
          )}
          {!planLoading && saveState === 'idle' && dirty && (
            <span className="text-[10px] normal-case tracking-normal text-zinc-400">Unsaved</span>
          )}
          {recentlyRefined && saveState === 'idle' && !dirty && (
            <span className="text-[10px] normal-case tracking-normal text-amber-300/80">Updated</span>
          )}
        </div>
        {isLocked ? (
          <pre className={`surface-inset rounded-md p-3 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed transition-all duration-700 ${recentlyRefined ? 'ring-1 ring-amber-400/40 bg-amber-400/[0.05]' : ''}`}>{cutPlanText.trim() || '(empty video prompt)'}</pre>
        ) : (
          <div className={`rounded-md transition-all duration-700 ${recentlyRefined ? 'ring-1 ring-amber-400/40 bg-amber-400/[0.05]' : ''}`}>
            <AutoGrowTextarea
              value={cutPlanText}
              onChange={(e) => onCutPlanChange((e.target as HTMLTextAreaElement).value)}
              onBlur={() => { void onPlanBlur(); }}
              placeholder="Panel 1 [00:00-..] - camera: …; action: …; Seedance cue: …"
              rows={5}
              className="w-full surface-inset rounded-md px-3 py-2.5 text-sm text-zinc-300 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 font-mono"
            />
          </div>
        )}
        <p className="text-[11px] text-zinc-500">
          Seedance reads the locked storyboard image plus this text as the motion/cut guide. {isLocked ? 'Unlock the storyboard to edit.' : 'Writing or refining the storyboard prompt also fills this field.'}
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

      {/* Status + Generate. Cut plan emptiness no longer blocks — Seedance
          falls back to a default "follow the storyboard image" guide when
          this field is empty (seedanceShotList in seedance-storyboard-rd.ts).
          Lock is still required because Seedance reads the locked image. */}
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
        {isLocked && cutPlanRequired && (
          <span className="text-[11px] text-zinc-500" title="Empty video prompt is OK — Seedance will follow the storyboard image's panel order.">
            No video prompt — will follow storyboard order.
          </span>
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
