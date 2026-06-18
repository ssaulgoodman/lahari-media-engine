import React from 'react';
import type { ShotContext, ShotContextPayloadSummary } from '../services/api';

type ShotContextPanelProps = {
  context: ShotContext | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
};

const SLOT_LABELS: Record<string, string> = {
  includeFormat: 'Format',
  includeShotBeat: 'Beat',
  includeRefs: 'Refs',
  includeCutPlan: 'Cut plan',
  includeAudio: 'Audio',
};

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

const EmptyValue = () => <span className="text-zinc-500">none</span>;

const summarizeSlotValue = (value: boolean | null | undefined) => {
  if (value === true) return 'on';
  if (value === false) return 'off';
  return 'default';
};

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

const PayloadSummary: React.FC<{ title: string; payload?: ShotContextPayloadSummary }> = ({ title, payload }) => {
  if (!payload) return null;
  const segments = payload.segments || [];
  const included = segments.filter(segment => segment.included !== false);
  const excluded = segments.filter(segment => segment.included === false);
  const images = payload.images || [];

  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-zinc-200">{title}</span>
          <Chip tone={payload.hasComposition ? 'good' : 'muted'}>
            {payload.hasComposition ? 'composed' : 'not captured'}
          </Chip>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          {payload.generatedAt && <span>{new Date(payload.generatedAt).toLocaleString()}</span>}
          {payload.attemptId && <span className="font-mono">{payload.attemptId.slice(0, 8)}</span>}
          {payload.versionId && <span className="font-mono">{payload.versionId.slice(0, 8)}</span>}
        </div>
      </div>

      {payload.note && <p className="text-[11px] leading-relaxed text-zinc-400">{payload.note}</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone="muted">{included.length} slots in</Chip>
        {excluded.length > 0 && <Chip tone="warn">{excluded.length} slots out</Chip>}
        <Chip tone="muted">{images.filter(image => image.included !== false).length} images</Chip>
      </div>

      {segments.length > 0 && (
        <div className="space-y-1.5">
          {segments.slice(0, 8).map((segment, index) => (
            <div
              key={`${segment.slot || segment.label || 'segment'}-${index}`}
              className={`grid gap-2 rounded-md border px-2.5 py-2 text-[11px] md:grid-cols-[96px_1fr] ${
                segment.included === false
                  ? 'border-amber-400/10 bg-amber-500/[0.03] text-zinc-400'
                  : 'border-white/[0.05] bg-white/[0.025] text-zinc-300'
              }`}
            >
              <div className="space-y-1">
                <div className="font-medium text-zinc-200">{segment.label || segment.slot || 'Segment'}</div>
                <div className={segment.included === false ? 'text-amber-300/80' : 'text-emerald-300/80'}>
                  {segment.included === false ? 'excluded' : 'included'}
                </div>
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-zinc-500">
                  {segment.source && <span>source: {segment.source}</span>}
                  {segment.editPath && <span>edit: {segment.editPath}</span>}
                </div>
                {segment.preview && <p className="line-clamp-2 leading-relaxed text-zinc-300">{segment.preview}</p>}
              </div>
            </div>
          ))}
          {segments.length > 8 && (
            <p className="text-[11px] text-zinc-500">+{segments.length - 8} more segments in describe_prompt.</p>
          )}
        </div>
      )}
    </div>
  );
};

export const ShotContextPanel: React.FC<ShotContextPanelProps> = ({ context, loading, error, onRefresh }) => {
  const slotEntries = Object.entries(context?.workflowConfig?.videoPromptSlots || {});
  const storyboardRecipe = recipeLabel(context?.workflowConfig?.storyboard);
  const videoRecipe = recipeLabel(context?.workflowConfig?.video);
  const refs = context?.refs;
  const promptState = context?.promptState || {};
  const baseHashes = context?.shot.baseHashes || {};
  const storyboardEligibility = context?.eligibility?.storyboard;
  const videoEligibility = context?.eligibility?.video;

  return (
    <section className="rounded-xl border border-white/[0.06] bg-[#101014] p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium text-white">Shot state</h4>
            {context?.shot.effectiveWorkflowMode && (
              <Chip>{context.shot.effectiveWorkflowMode}</Chip>
            )}
            {context?.shot.promptsStale && <Chip tone="warn">stale prompts</Chip>}
            {context?.shot.storyboardLocked && <Chip tone="good">storyboard locked</Chip>}
          </div>
          <p className="text-[11px] text-zinc-500">
            {context
              ? `${context.shot.label} from ${context.scene.label || `Scene ${context.scene.index}`} - mode source: ${context.shot.effectiveWorkflowModeSource || 'unknown'}`
              : loading ? 'Loading shot context...' : 'Shot context unavailable.'}
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
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">Workflow</div>
              <div className="text-sm text-zinc-200">{context.project.workflowLabel || context.project.workflowKey || 'Workflow'}</div>
              <div className="space-y-1 text-[11px] text-zinc-400">
                <div>Storyboard recipe: {storyboardRecipe || <EmptyValue />}</div>
                <div>Video recipe: {videoRecipe || <EmptyValue />}</div>
                <div>Preset: {context.project.presetLabel || context.project.presetKey || <EmptyValue />}</div>
              </div>
            </div>

            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">Refs</div>
              <div className="flex flex-wrap gap-1.5">
                <Chip tone={refs?.style?.assetId ? 'good' : 'muted'}>style {refs?.style?.assetId ? 'yes' : 'no'}</Chip>
                <Chip tone={(refs?.cast || []).some(cast => cast.hasReference) ? 'good' : 'muted'}>cast {(refs?.cast || []).length}</Chip>
                <Chip tone={refs?.environment?.hasReference ? 'good' : refs?.environment ? 'warn' : 'muted'}>
                  env {refs?.environment?.name || 'none'}
                </Chip>
              </div>
              <div className="space-y-1 text-[11px] text-zinc-400">
                {(refs?.cast || []).slice(0, 3).map(cast => (
                  <div key={cast.id}>
                    {cast.name || cast.id}: {cast.hasReference ? 'ref' : 'no ref'}
                    {cast.storyboardExcluded || cast.videoExcluded ? ' - excluded somewhere' : ''}
                  </div>
                ))}
                {(refs?.cast || []).length > 3 && <div>+{(refs?.cast || []).length - 3} more cast refs</div>}
              </div>
            </div>

            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">Eligibility</div>
              <div className="flex flex-wrap gap-1.5">
                <Chip tone={storyboardEligibility?.canRun ? 'good' : 'warn'}>storyboard {storyboardEligibility?.canRun ? 'ready' : 'blocked'}</Chip>
                <Chip tone={videoEligibility?.canRun ? 'good' : 'warn'}>video {videoEligibility?.canRun ? 'ready' : 'blocked'}</Chip>
              </div>
              <div className="space-y-1 text-[11px] text-zinc-400">
                {videoEligibility?.model && <div>Video model: {videoEligibility.model}</div>}
                {typeof videoEligibility?.providerDuration === 'number' && <div>Provider duration: {videoEligibility.providerDuration}s</div>}
                {storyboardEligibility?.provider && <div>Storyboard provider: {storyboardEligibility.provider}</div>}
              </div>
            </div>
          </div>

          {slotEntries.length > 0 && (
            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">Video prompt slots</div>
                <div className="text-[11px] text-zinc-500">Persistent next-run defaults</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {slotEntries.map(([key, slot]) => {
                  const value = summarizeSlotValue(slot?.value);
                  return (
                    <Chip key={key} tone={value === 'off' ? 'warn' : value === 'on' ? 'good' : 'muted'}>
                      {SLOT_LABELS[key] || key}: {value}
                    </Chip>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">Prompt state</div>
              <div className="grid gap-2 md:grid-cols-2">
                {Object.entries(promptState).map(([key, state]) => (
                  <div key={key} className="rounded-md border border-white/[0.05] bg-white/[0.025] p-2">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-medium text-zinc-200">{key}</span>
                      <span className={state.present ? 'text-emerald-300/80' : 'text-zinc-500'}>{state.present ? 'present' : 'empty'}</span>
                    </div>
                    {state.hash && <div className="mt-1 font-mono text-[10px] text-zinc-500">{hashPreview(state.hash)}</div>}
                    {state.preview && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-400">{state.preview}</p>}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">Base hashes</div>
              <div className="grid gap-1.5 text-[11px] text-zinc-400 sm:grid-cols-2">
                {Object.entries(baseHashes).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-2 rounded-md bg-white/[0.025] px-2 py-1.5">
                    <span>{key}</span>
                    <span className="font-mono text-zinc-500">{hashPreview(value) || 'none'}</span>
                  </div>
                ))}
              </div>
              {context.shot.lastError && (
                <div className="rounded-md border border-red-400/15 bg-red-500/[0.04] px-2 py-1.5 text-[11px] leading-relaxed text-red-200">
                  {context.shot.lastError}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <PayloadSummary title="Storyboard payload" payload={context.promptPayloads?.storyboardRender} />
            <PayloadSummary title="Video payload" payload={context.promptPayloads?.video} />
          </div>

          {(context.recommendedNextActions || []).length > 0 && (
            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">Recommended next actions</div>
              <ul className="space-y-1.5 text-[11px] leading-relaxed text-zinc-300">
                {(context.recommendedNextActions || []).map((action, index) => (
                  <li key={`${action}-${index}`} className="flex gap-2">
                    <span className="text-zinc-600">{index + 1}.</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
};
