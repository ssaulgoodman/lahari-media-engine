import React, { useEffect, useRef, useState } from 'react';
import { describePrompt } from '../services/api';
import type { PromptDescription, PromptDescriptionKind, ShotContext, ShotContextPayloadSummary, ShotWorkflowMode, VideoPromptSlotDefaults } from '../services/api';
import { PromptCompositionInspector } from './PromptCompositionInspector';

type ShotContextPanelProps = {
  context: ShotContext | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onSaveVideoPromptSlots?: (slots: VideoPromptSlotDefaults) => Promise<void> | void;
  onSaveWorkflowMode?: (mode: ShotWorkflowMode) => Promise<void> | void;
};

const SLOT_LABELS: Record<string, string> = {
  includeFormat: 'Format',
  includeShotBeat: 'Beat',
  includeRefs: 'Refs',
  includeCutPlan: 'Cut plan',
  includeAudio: 'Audio',
};

const VIDEO_SEGMENT_SLOT_FIELDS: Record<string, keyof VideoPromptSlotDefaults> = {
  beat: 'includeShotBeat',
  refs: 'includeRefs',
  cut_plan: 'includeCutPlan',
  audio: 'includeAudio',
};

// Render every payload slot, including the ones inheriting the default — an
// invisible "default" slot is still hidden prompt behavior.
const VIDEO_SLOT_ORDER: Array<keyof VideoPromptSlotDefaults> = [
  'includeFormat',
  'includeShotBeat',
  'includeRefs',
  'includeCutPlan',
  'includeAudio',
];

// Which surface(s) a ref is held out of, drawn from the same excludedRefs the
// storyboard/video composers read. '' means the ref binds everywhere.
const excludeLabel = (storyboard?: boolean, video?: boolean): string => {
  if (storyboard && video) return 'storyboard + video';
  if (storyboard) return 'storyboard';
  if (video) return 'video';
  return '';
};

const WORKFLOW_MODE_OPTIONS: Array<{ value: ShotWorkflowMode; label: string; title: string }> = [
  { value: 'auto', label: 'Auto', title: 'Follow the project/model default for this shot.' },
  { value: 'storyboard', label: 'Storyboard', title: 'Force storyboard-board video generation for this shot.' },
  { value: 'keyframe', label: 'Keyframe', title: 'Force start-keyframe video generation for this shot.' },
];

const Chip: React.FC<{ children: React.ReactNode; tone?: 'default' | 'good' | 'warn' | 'muted' }> = ({ children, tone = 'default' }) => {
  const toneClass = tone === 'good'
    ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
    : tone === 'warn'
      ? 'border-amber-400/20 bg-amber-500/10 text-amber-200'
      : tone === 'muted'
        ? 'border-white/[0.06] bg-white/[0.03] text-zinc-400'
        : 'border-white/[0.08] bg-white/[0.05] text-zinc-200';
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] leading-5 ${toneClass}`}>
      {children}
    </span>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode; aside?: React.ReactNode }> = ({ children, aside }) => (
  <div className="flex items-center justify-between gap-2">
    <div className="text-[11px] uppercase tracking-wide text-zinc-400">{children}</div>
    {aside && <div className="text-[11px] text-zinc-500">{aside}</div>}
  </div>
);

const EmptyValue = () => <span className="text-zinc-500">none</span>;

const recipeLabel = (config?: Record<string, unknown>) => {
  const recipe = config?.workflowRecipe;
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return null;
  const record = recipe as Record<string, unknown>;
  return typeof record.label === 'string'
    ? record.label
    : typeof record.name === 'string'
      ? record.name
      : null;
};

const hashPreview = (hash?: string | null) => hash ? hash.slice(0, 8) : null;

const videoSlotsFromContext = (context: ShotContext | null): VideoPromptSlotDefaults => {
  const out: VideoPromptSlotDefaults = {};
  const source = context?.workflowConfig?.videoPromptSlots || {};
  (Object.keys(source) as Array<keyof VideoPromptSlotDefaults>).forEach((key) => {
    const value = source[key]?.value;
    if (typeof value === 'boolean') out[key] = value;
  });
  return out;
};

const workflowModeFromContext = (context: ShotContext | null): ShotWorkflowMode => {
  const value = context?.shot.savedWorkflowMode;
  return value === 'storyboard' || value === 'keyframe' ? value : 'auto';
};

// Compact payload status only. The full provenance-annotated segment breakdown
// lives in the dedicated PromptCompositionInspector (describe_prompt), so this
// panel does not re-render the segment list — it reports captured-yet + in/out.
const PayloadStatus: React.FC<{
  title: string;
  payload?: ShotContextPayloadSummary;
  onInspect?: () => void;
  inspecting?: boolean;
}> = ({ title, payload, onInspect, inspecting }) => {
  const segments = payload?.segments || [];
  const included = segments.filter(segment => segment.included !== false).length;
  const excluded = segments.length - included;
  const images = (payload?.images || []).filter(image => image.included !== false).length;
  const composed = !!payload?.hasComposition;

  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-medium text-zinc-200">{title}</span>
          <Chip tone={composed ? 'good' : 'muted'}>{composed ? 'composed' : 'not captured'}</Chip>
        </div>
        <div className="flex items-center gap-2">
          {payload?.generatedAt && (
            <span className="text-[11px] text-zinc-500">{new Date(payload.generatedAt).toLocaleString()}</span>
          )}
          {onInspect && (
            <button
              type="button"
              onClick={onInspect}
              disabled={inspecting}
              className="rounded border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-wait disabled:opacity-50"
            >
              {inspecting ? 'Loading' : 'Inspect'}
            </button>
          )}
        </div>
      </div>
      {composed ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone="muted">{included} slots in</Chip>
          {excluded > 0 && <Chip tone="warn">{excluded} out</Chip>}
          <Chip tone="muted">{images} images</Chip>
          <span className="text-[11px] text-zinc-500">Inspect for the full payload</span>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-zinc-400">
          {payload?.note || 'No payload captured yet — generate or dry-run to capture the composition.'}
        </p>
      )}
    </div>
  );
};

export const ShotContextPanel: React.FC<ShotContextPanelProps> = ({ context, loading, error, onRefresh, onSaveVideoPromptSlots, onSaveWorkflowMode }) => {
  const contextVideoPromptSlots = videoSlotsFromContext(context);
  const [optimisticVideoPromptSlots, setOptimisticVideoPromptSlots] = useState<VideoPromptSlotDefaults | null>(null);
  const effectiveVideoPromptSlots = optimisticVideoPromptSlots || contextVideoPromptSlots;
  const contextWorkflowMode = workflowModeFromContext(context);
  const [optimisticWorkflowMode, setOptimisticWorkflowMode] = useState<ShotWorkflowMode | null>(null);
  const effectiveWorkflowMode = optimisticWorkflowMode || contextWorkflowMode;
  const storyboardRecipe = recipeLabel(context?.workflowConfig?.storyboard);
  const videoRecipe = recipeLabel(context?.workflowConfig?.video);
  const refs = context?.refs;
  const promptState = context?.promptState || {};
  const baseHashes = context?.shot.baseHashes || {};
  const storyboardEligibility = context?.eligibility?.storyboard;
  const videoEligibility = context?.eligibility?.video;
  const nextActions = context?.recommendedNextActions || [];
  const [activeDescription, setActiveDescription] = useState<PromptDescription | null>(null);
  const [descriptionLoadingKey, setDescriptionLoadingKey] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [slotSavingKey, setSlotSavingKey] = useState<string | null>(null);
  const [slotSaveError, setSlotSaveError] = useState<string | null>(null);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [workflowSaveError, setWorkflowSaveError] = useState<string | null>(null);
  const inspectRequestId = useRef(0);

  useEffect(() => {
    inspectRequestId.current += 1;
    setActiveDescription(null);
    setDescriptionLoadingKey(null);
    setDescriptionError(null);
    setOptimisticVideoPromptSlots(null);
    setOptimisticWorkflowMode(null);
    setSlotSavingKey(null);
    setSlotSaveError(null);
    setWorkflowSaving(false);
    setWorkflowSaveError(null);
  }, [context?.project.id, context?.shot.id]);

  const inspectPrompt = async (kind: PromptDescriptionKind, versionId?: string | null) => {
    if (!context) return;
    const requestId = inspectRequestId.current + 1;
    inspectRequestId.current = requestId;
    const loadingKey = versionId ? `${kind}:${versionId}` : kind;
    setDescriptionLoadingKey(loadingKey);
    setDescriptionError(null);
    setActiveDescription(null);
    try {
      const description = await describePrompt(
        context.project.id,
        context.shot.id,
        kind,
        kind === 'storyboard_render' && versionId ? { versionId } : {},
      );
      if (inspectRequestId.current !== requestId) return;
      setActiveDescription(description);
    } catch (err: any) {
      if (inspectRequestId.current !== requestId) return;
      setDescriptionError(err?.message || 'Unable to inspect prompt payload.');
    } finally {
      if (inspectRequestId.current === requestId) {
        setDescriptionLoadingKey(current => current === loadingKey ? null : current);
      }
    }
  };

  const saveVideoPromptSlotDefault = async (
    field: keyof VideoPromptSlotDefaults,
    next: boolean | undefined,
  ) => {
    if (!context || !onSaveVideoPromptSlots) return;
    const previous = effectiveVideoPromptSlots;
    const nextSlots: VideoPromptSlotDefaults = { ...previous };
    if (next === undefined) delete nextSlots[field];
    else nextSlots[field] = next;

    setOptimisticVideoPromptSlots(nextSlots);
    setSlotSavingKey(field);
    setSlotSaveError(null);
    try {
      await onSaveVideoPromptSlots(nextSlots);
      onRefresh?.();
    } catch (err: any) {
      setOptimisticVideoPromptSlots(previous);
      setSlotSaveError(err?.message || 'Unable to save video payload defaults.');
    } finally {
      setSlotSavingKey(current => current === field ? null : current);
    }
  };

  const saveWorkflowMode = async (next: ShotWorkflowMode) => {
    if (!context || !onSaveWorkflowMode || next === effectiveWorkflowMode) return;
    const previous = effectiveWorkflowMode;
    setOptimisticWorkflowMode(next);
    setWorkflowSaving(true);
    setWorkflowSaveError(null);
    try {
      await onSaveWorkflowMode(next);
      onRefresh?.();
    } catch (err: any) {
      setOptimisticWorkflowMode(previous);
      setWorkflowSaveError(err?.message || 'Unable to save workflow mode.');
    } finally {
      setWorkflowSaving(false);
    }
  };

  const videoPromptSegmentControls = activeDescription?.kind === 'video'
    ? Object.fromEntries(Object.entries(VIDEO_SEGMENT_SLOT_FIELDS).map(([slot, field]) => [
      slot,
      {
        value: effectiveVideoPromptSlots[field],
        disabled: !!slotSavingKey || !onSaveVideoPromptSlots,
        title: 'Save this segment default for future video generations on this shot.',
        onChange: (next: boolean | undefined) => saveVideoPromptSlotDefault(field, next),
      },
    ]))
    : undefined;

  const blockers: Array<{ surface: string; prerequisites: string[] }> = [];
  if (storyboardEligibility && storyboardEligibility.canRun === false) {
    blockers.push({ surface: 'Storyboard', prerequisites: storyboardEligibility.prerequisites || [] });
  }
  if (videoEligibility && videoEligibility.canRun === false) {
    blockers.push({ surface: 'Video', prerequisites: videoEligibility.prerequisites || [] });
  }

  return (
    <section className="rounded-xl border border-white/[0.06] bg-[#101014] p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium text-white">Shot state</h4>
            {context?.shot.effectiveWorkflowMode && <Chip>{context.shot.effectiveWorkflowMode}</Chip>}
            {context?.shot.promptsStale && <Chip tone="warn">stale prompts</Chip>}
            {context?.shot.storyboardLocked && <Chip tone="good">storyboard locked</Chip>}
          </div>
          <p className="text-[11px] text-zinc-400">
            {context
              ? `${context.shot.label} · ${context.scene.label || `Scene ${context.scene.index}`} · mode source: ${context.shot.effectiveWorkflowModeSource || 'unknown'}`
              : loading ? 'Loading shot context…' : 'Shot context unavailable.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/15 bg-red-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-red-200">
          {error}
        </div>
      )}

      {!context && !error && (
        <div className="h-16 rounded-lg border border-white/[0.05] bg-white/[0.02] animate-pulse" />
      )}

      {context && (
        <>
          {context.shot.lastError && (
            <div className="rounded-lg border border-red-400/15 bg-red-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-red-200">
              <span className="font-medium">Last error: </span>{context.shot.lastError}
            </div>
          )}

          {/* Lead with what's actionable: can it run, why not, what to do next. */}
          <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip tone={storyboardEligibility?.canRun ? 'good' : 'warn'}>storyboard {storyboardEligibility?.canRun ? 'ready' : 'blocked'}</Chip>
              <Chip tone={videoEligibility?.canRun ? 'good' : 'warn'}>video {videoEligibility?.canRun ? 'ready' : 'blocked'}</Chip>
              {videoEligibility?.model && <Chip tone="muted">{videoEligibility.model}</Chip>}
              {typeof videoEligibility?.providerDuration === 'number' && <Chip tone="muted">{videoEligibility.providerDuration}s</Chip>}
              {storyboardEligibility?.provider && <Chip tone="muted">{storyboardEligibility.provider}</Chip>}
            </div>

            {blockers.map(blocker => (
              <div key={blocker.surface} className="rounded-md border border-amber-400/15 bg-amber-500/[0.05] px-2.5 py-2">
                <div className="text-[11px] font-medium text-amber-200">{blocker.surface} blocked because</div>
                {blocker.prerequisites.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-amber-100/80">
                    {blocker.prerequisites.map((reason, index) => (
                      <li key={`${blocker.surface}-${index}`} className="flex gap-1.5">
                        <span className="text-amber-300/70">·</span><span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[11px] text-amber-100/70">prerequisites not met</p>
                )}
              </div>
            ))}

            {nextActions.length > 0 && (
              <div className="space-y-1">
                <SectionLabel>Next actions</SectionLabel>
                <ol className="space-y-1 text-[11px] leading-relaxed text-zinc-300">
                  {nextActions.map((action, index) => (
                    <li key={`${action}-${index}`} className="flex gap-2">
                      <span className="text-zinc-500">{index + 1}.</span><span>{action}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          {/* Context: workflow, refs, saved slot defaults. */}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-2">
              <SectionLabel>Workflow</SectionLabel>
              <div className="text-sm text-zinc-200">{context.project.workflowLabel || context.project.workflowKey || 'Workflow'}</div>
              <div className="space-y-1 text-[11px] text-zinc-400">
                <div>Storyboard recipe: {storyboardRecipe || <EmptyValue />}</div>
                <div>Video recipe: {videoRecipe || <EmptyValue />}</div>
                <div>Preset: {context.project.presetLabel || context.project.presetKey || <EmptyValue />}</div>
              </div>
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-zinc-400">Shot mode</span>
                  <span className="text-[11px] text-zinc-500">
                    effective {context.shot.effectiveWorkflowMode || 'unknown'}
                    {workflowSaving ? ' · saving…' : ''}
                  </span>
                </div>
                <div className="inline-flex rounded-md border border-white/[0.08] bg-white/[0.03] p-0.5">
                  {WORKFLOW_MODE_OPTIONS.map(option => {
                    const active = effectiveWorkflowMode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => saveWorkflowMode(option.value)}
                        disabled={workflowSaving || !onSaveWorkflowMode}
                        title={option.title}
                        className={`min-w-[74px] rounded px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-wait ${
                          active
                            ? 'bg-white text-black'
                            : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {workflowSaveError && (
                  <div className="rounded-md border border-red-400/15 bg-red-500/[0.06] px-2 py-1.5 text-[11px] leading-relaxed text-red-200">
                    {workflowSaveError}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-2">
              <SectionLabel>Refs</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                <Chip tone={refs?.style?.assetId ? 'good' : 'muted'}>style {refs?.style?.assetId ? 'yes' : 'no'}</Chip>
                <Chip tone={(refs?.cast || []).some(cast => cast.hasReference) ? 'good' : 'muted'}>cast {(refs?.cast || []).length}</Chip>
                <Chip tone={refs?.environment?.hasReference ? 'good' : refs?.environment ? 'warn' : 'muted'}>
                  env {refs?.environment?.name || 'none'}
                </Chip>
              </div>
              <div className="space-y-1 text-[11px] text-zinc-400">
                {(refs?.cast || []).slice(0, 3).map(cast => {
                  const excluded = excludeLabel(cast.storyboardExcluded, cast.videoExcluded);
                  return (
                    <div key={cast.id}>
                      {cast.name || cast.id}: {cast.hasReference ? 'ref' : 'no ref'}
                      {excluded && <span className="text-amber-300/80"> · held out of {excluded}</span>}
                    </div>
                  );
                })}
                {(refs?.cast || []).length > 3 && <div className="text-zinc-500">+{(refs?.cast || []).length - 3} more cast refs</div>}
                {refs?.environment && excludeLabel(refs.environment.storyboardExcluded, refs.environment.videoExcluded) && (
                  <div>
                    {refs.environment.name || 'environment'}:
                    <span className="text-amber-300/80"> held out of {excludeLabel(refs.environment.storyboardExcluded, refs.environment.videoExcluded)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-2">
            <SectionLabel aside={slotSavingKey ? `Saving ${SLOT_LABELS[slotSavingKey] || slotSavingKey}…` : 'saved = this shot overrides the default'}>Video prompt slots</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {VIDEO_SLOT_ORDER.map((key) => {
                const saved = typeof effectiveVideoPromptSlots[key] === 'boolean';
                const on = effectiveVideoPromptSlots[key] === true;
                const tone = !saved ? 'muted' : on ? 'good' : 'warn';
                const editPath = context?.workflowConfig?.videoPromptSlots?.[key]?.editPath || undefined;
                return (
                  <Chip key={key} tone={tone}>
                    <span title={editPath}>
                      {SLOT_LABELS[key] || key}: {saved ? (on ? 'on' : 'off') : 'default'}
                      {saved && <span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">saved</span>}
                    </span>
                  </Chip>
                );
              })}
            </div>
            {slotSaveError && (
              <div className="rounded-md border border-red-400/15 bg-red-500/[0.06] px-2 py-1.5 text-[11px] leading-relaxed text-red-200">
                {slotSaveError}
              </div>
            )}
          </div>

          {/* Compact payload status; full segment audit lives in describe_prompt. */}
          <div className="grid gap-3 xl:grid-cols-2">
            <PayloadStatus
              title="Storyboard payload"
              payload={context.promptPayloads?.storyboardRender}
              onInspect={() => inspectPrompt('storyboard_render', context.promptPayloads?.storyboardRender?.versionId || context.assets?.storyboardVersionId || null)}
              inspecting={descriptionLoadingKey === `storyboard_render:${context.promptPayloads?.storyboardRender?.versionId || context.assets?.storyboardVersionId || ''}` || descriptionLoadingKey === 'storyboard_render'}
            />
            <PayloadStatus
              title="Video payload"
              payload={context.promptPayloads?.video}
              onInspect={() => inspectPrompt('video')}
              inspecting={descriptionLoadingKey === 'video'}
            />
          </div>

          {(descriptionError || activeDescription || descriptionLoadingKey) && (
            <div className="space-y-2">
              {descriptionError && (
                <div className="rounded-lg border border-red-400/15 bg-red-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-red-200">
                  {descriptionError}
                </div>
              )}
              {activeDescription ? (
                <PromptCompositionInspector
                  title={`${activeDescription.kind === 'storyboard_render' ? 'Storyboard' : 'Video'} payload inspector`}
                  composition={activeDescription.composition || null}
                  note={activeDescription.note}
                  generatedAt={activeDescription.generatedAt}
                  source={activeDescription.source}
                  segmentControls={videoPromptSegmentControls}
                />
              ) : descriptionLoadingKey ? (
                <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-zinc-400">
                  Loading payload inspector...
                </div>
              ) : null}
            </div>
          )}

          {/* Engine internals — collapsed by default; not artist-facing. */}
          <details className="group rounded-lg border border-white/[0.05] bg-black/10">
            <summary className="list-none cursor-pointer select-none px-3 py-2 flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-zinc-400 hover:text-zinc-200 transition-colors">
              <span>Technical detail</span>
              <span className="text-zinc-500 group-open:rotate-180 transition-transform" aria-hidden="true">▾</span>
            </summary>
            <div className="border-t border-white/[0.06] p-3 space-y-3">
              {Object.keys(promptState).length > 0 && (
                <div className="space-y-1.5">
                  <SectionLabel>Prompt state</SectionLabel>
                  <div className="grid gap-2 md:grid-cols-2">
                    {Object.entries(promptState).map(([key, state]) => (
                      <div key={key} className="rounded-md border border-white/[0.05] bg-white/[0.025] p-2">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-medium text-zinc-300">{key}</span>
                          <span className={state.present ? 'text-emerald-300/80' : 'text-zinc-500'}>{state.present ? 'present' : 'empty'}</span>
                        </div>
                        {state.hash && <div className="mt-1 font-mono text-[10px] text-zinc-500">{hashPreview(state.hash)}</div>}
                        {state.preview && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-400">{state.preview}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {Object.keys(baseHashes).length > 0 && (
                <div className="space-y-1.5">
                  <SectionLabel>Base hashes</SectionLabel>
                  <div className="grid gap-1.5 text-[11px] text-zinc-400 sm:grid-cols-2">
                    {Object.entries(baseHashes).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between gap-2 rounded-md bg-white/[0.025] px-2 py-1.5">
                        <span>{key}</span>
                        <span className="font-mono text-zinc-500">{hashPreview(value) || 'none'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>
        </>
      )}
    </section>
  );
};
