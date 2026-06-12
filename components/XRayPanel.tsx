import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import * as api from '../services/api';

// ─── Types ───────────────────────────────────────────────────────────

interface XRayReference {
  type: 'image' | 'audio' | 'text';
  label: string;
  url?: string;
}

interface OutputAsset {
  id: string;
  url?: string;
  category?: string;
  shotId?: string;
}

interface XRayEntry {
  id: string;
  stage: string;
  model: string;
  prompt: string;
  referenceInputs: XRayReference[];
  contextChain: Record<string, any>;
  responseSummary: string;
  outputAssetIds: string[];
  outputAssets: OutputAsset[];
  durationMs: number;
  costEstimate: number;
  error?: string;
  createdAt: string;
}

type RecipeSection = {
  key: string;
  title: string;
  body: string;
};

type RecipeTrace = {
  toolKey?: string;
  presetKey?: string;
  workflowKey?: string;
  sectionLabels?: string[];
  sections?: RecipeSection[];
};

interface Props {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  // When set, the panel opens scoped to calls that produced media for this
  // shot ("what made this?"). Shot linkage rides on outputAssets.shotId, so
  // text-only planning calls without output assets stay in the All view.
  focusShotId?: string | null;
  focusShotLabel?: string | null;
}

// ─── Stage grouping (for filter pills) ───────────────────────────────

const STAGE_GROUPS: { key: string; label: string; prefixes: string[] }[] = [
  { key: 'all',     label: 'All',       prefixes: [] },
  { key: 'errors',  label: 'Errors',    prefixes: [] },
  { key: 'blueprint', label: 'Blueprint', prefixes: ['transcribe', 'detect-structure', 'summarize', 'generate-concepts', 'generate-script', 'brainstorm-styles', 'visualize-style', 'refine-style', 'analyze-style', 'enrich-style', 'lock-style', 'generate-looks', 'generate-environment', 'write-shot-prompts'] },
  { key: 'studio',  label: 'Studio',    prefixes: ['generate-shot-image', 'generate-shot-video', 'generate-shot-start-frame', 'generate-shot-end-frame', 'generate-shot-frame-pair', 'generate-end-frame', 'write-storyboard-prompt', 'refine-storyboard', 'generate-storyboard', 'describe-frame'] },
];

// Human labels for the common stages — the artist reads "Start frame",
// not "generate-shot-start-frame". Unknown stages fall back to prettyStage.
const STAGE_LABELS: Record<string, string> = {
  'generate-shot-start-frame': 'Start frame',
  'generate-end-frame': 'End frame',
  'generate-shot-video': 'Video',
  'generate-storyboard-image': 'Storyboard image',
  'write-storyboard-prompt': 'Storyboard prompt',
  'refine-storyboard-prompt': 'Storyboard prompt rewrite',
  'refine-storyboard-image': 'Storyboard image edit',
  'generate-concepts': 'Concept directions',
  'refine-concept': 'Concept refine',
  'generate-script': 'Script',
  'refine-script': 'Script refine',
  'brainstorm-styles': 'Style directions',
  'visualize-style': 'Style frame',
  'refine-style-direction': 'Style refine',
  'analyze-style': 'Style read',
  'generate-looks': 'Character look',
  'generate-environment-looks': 'Environment look',
  'write-shot-prompts': 'Shot prompts',
  'write-audio-plan': 'Audio plan',
  'generate-dialogue-audio': 'Dialogue audio',
  'transcribe': 'Transcription',
  'detect-structure': 'Song structure',
  'refine-shot-prompt': 'Frame prompt refine',
  'refine-end-frame-prompt': 'End-frame prompt refine',
  'refine-video-prompt': 'Motion prompt refine',
  'describe-frame': 'Continuity read',
  'copy-prev-last-frame': 'Continuity frame copy',
};

const prettyStage = (stage: string): string => {
  const base = stage.split(':')[0];
  return STAGE_LABELS[base] || base.replace(/-/g, ' ').replace(/generate /, '');
};

// ─── Layer cards ─────────────────────────────────────────────────────
// Each composed-prompt section renders as a "layer": who put it there and
// what it contributes. Accent color encodes the source — engine contract
// (zinc), project graph data (sky), artist taste (amber), overrides (violet).

const SECTION_META: Record<string, { label: string; source: string; accent: string }> = {
  coreTask:        { label: 'Task',             source: 'engine contract',    accent: 'border-zinc-500/40' },
  inputs:          { label: 'Project inputs',   source: 'your project data',  accent: 'border-sky-400/40' },
  styleNotes:      { label: 'Style notes',      source: 'your saved taste',   accent: 'border-amber-400/50' },
  projectOverride: { label: 'Project override', source: 'your recipe',        accent: 'border-violet-400/50' },
  userNotePolicy:  { label: 'Note policy',      source: 'engine contract',    accent: 'border-zinc-500/40' },
  outputContract:  { label: 'Output contract',  source: 'engine contract',    accent: 'border-zinc-500/40' },
  userNote:        { label: 'Your note',        source: 'this call',          accent: 'border-amber-400/50' },
};

const LayerCard: React.FC<{ section: RecipeSection; defaultOpen: boolean }> = ({ section, defaultOpen }) => {
  const meta = SECTION_META[section.key] || { label: section.title, source: '', accent: 'border-zinc-500/40' };
  return (
    <details open={defaultOpen} className={`group border-l-2 ${meta.accent} pl-3`}>
      <summary className="cursor-pointer list-none flex items-baseline gap-2 py-0.5">
        <span className="text-xs font-medium text-zinc-300">{meta.label}</span>
        {meta.source && <span className="text-[11px] text-zinc-400">{meta.source}</span>}
        <span className="text-[11px] text-zinc-500 ml-auto font-mono group-open:hidden">{section.body.length > 120 ? `${section.body.slice(0, 90).replace(/\s+/g, ' ')}…` : section.body.replace(/\s+/g, ' ')}</span>
      </summary>
      <p className="mt-1 mb-2 text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{section.body}</p>
    </details>
  );
};

// ─── Main panel ──────────────────────────────────────────────────────

export const XRayPanel: React.FC<Props> = ({ projectId, isOpen, onClose, focusShotId, focusShotLabel }) => {
  const [calls, setCalls] = useState<XRayEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  // Shot scope is its own axis on top of the stage filter; opening from a
  // shot card turns it on, the chip in the header turns it off.
  const [shotScoped, setShotScoped] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await api.getXRayCalls(projectId);
      setCalls(data.calls || []);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (isOpen) {
      refresh();
      setShotScoped(true);
      setExpandedId(null);
    }
  }, [isOpen, refresh]);

  const shotCalls = useMemo(() => (
    focusShotId
      ? calls.filter(c => (c.outputAssets || []).some(a => a.shotId === focusShotId))
      : calls
  ), [calls, focusShotId]);

  const scoped = focusShotId && shotScoped ? shotCalls : calls;

  const filtered = useMemo(() => {
    let list = scoped;
    if (filter === 'errors') {
      list = list.filter(c => c.error);
    } else if (filter !== 'all') {
      const group = STAGE_GROUPS.find(g => g.key === filter);
      if (group) list = list.filter(c => group.prefixes.some(p => c.stage.startsWith(p)));
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(c =>
        c.stage.toLowerCase().includes(q)
        || c.prompt.toLowerCase().includes(q)
        || (c.responseSummary || '').toLowerCase().includes(q)
        || (c.error || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [scoped, filter, query]);

  const totalCost = scoped.reduce((s, c) => s + (c.costEstimate || 0), 0);
  const totalDuration = scoped.reduce((s, c) => s + (c.durationMs || 0), 0);
  const errorCount = scoped.filter(c => c.error).length;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        className="relative ml-auto w-full max-w-2xl bg-obsidian-950 border-l border-white/[0.06] shadow-2xl flex flex-col h-full"
      >
        {/* Header */}
        <div className="flex-shrink-0 h-14 px-5 flex items-center justify-between border-b border-white/[0.06]">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-medium text-white flex-shrink-0">X-Ray</h2>
            {focusShotId && shotScoped && (
              <button
                onClick={() => setShotScoped(false)}
                className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full bg-white/[0.08] text-zinc-200 hover:bg-white/[0.12] transition-colors flex-shrink-0"
                title="Showing only this shot's generations. Click to see the whole project."
              >
                {focusShotLabel || 'This shot'}
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            )}
            <span className="text-[11px] text-zinc-400 font-mono truncate">
              {scoped.length} calls · ${totalCost.toFixed(2)} · {(totalDuration / 1000).toFixed(0)}s
              {errorCount > 0 && <span className="text-red-400 ml-2">· {errorCount} errors</span>}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={refresh}
              disabled={loading}
              className="text-[11px] text-zinc-400 hover:text-white transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md px-2 py-1"
            >
              {loading ? '…' : 'Refresh'}
            </button>
            <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md p-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        {/* Filters + search */}
        <div className="flex-shrink-0 px-5 py-3 border-b border-white/[0.06] flex items-center gap-3">
          <div className="flex items-center gap-1">
            {STAGE_GROUPS.map(g => {
              const count = g.key === 'all' ? scoped.length
                : g.key === 'errors' ? errorCount
                : scoped.filter(c => g.prefixes.some(p => c.stage.startsWith(p))).length;
              if (g.key !== 'all' && g.key !== 'errors' && count === 0) return null;
              const active = filter === g.key;
              return (
                <button
                  key={g.key}
                  onClick={() => setFilter(g.key)}
                  className={`text-[11px] px-2.5 py-1 rounded-md transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 ${
                    active ? 'bg-white/[0.08] text-white' : 'text-zinc-400 hover:text-zinc-300'
                  }`}
                >
                  {g.label}{count > 0 ? ` ${count}` : ''}
                </button>
              );
            })}
          </div>
          <div className="flex-1" />
          <input
            type="text"
            placeholder="Search prompts…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="surface-inset rounded-md px-2.5 py-1 text-[11px] text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20 w-40"
          />
        </div>

        {/* Call list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="flex items-center justify-center h-48 text-zinc-400 text-xs">
              {scoped.length === 0
                ? (focusShotId && shotScoped ? 'No generations recorded for this shot yet' : 'No calls yet')
                : 'No matches'}
            </div>
          )}

          {filtered.map(call => {
            const isExpanded = expandedId === call.id;
            const hasError = !!call.error;
            const imageOutputs = (call.outputAssets || []).filter(a => a.url && (a.category === 'style' || a.category === 'character' || a.category === 'shot_image' || a.category === 'shot_end_frame' || a.category === 'shot_extracted_last_frame' || a.category === 'storyboard'));
            const videoOutputs = (call.outputAssets || []).filter(a => a.url && a.category === 'shot_video');
            const imageRefs = call.referenceInputs.filter(r => r.type === 'image' && r.url);
            const recipe = call.contextChain?.recipe as RecipeTrace | undefined;
            const sections = recipe?.sections || [];
            // A single PROMPT section means this wasn't a composed prompt
            // (media calls) — show the prompt directly instead of one
            // meaningless layer card.
            const layered = sections.length > 1;
            const time = new Date(call.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            return (
              <div key={call.id} className={`border-b border-white/[0.04] ${hasError ? 'bg-red-500/[0.02]' : ''}`}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : call.id)}
                  className="w-full text-left px-5 py-2.5 flex items-center gap-3 hover:bg-white/[0.02] transition-colors outline-none focus-visible:bg-white/[0.04]"
                >
                  <span className="text-[11px] font-mono text-zinc-400 w-16 flex-shrink-0">{time}</span>
                  <span className={`text-xs flex-shrink-0 w-40 truncate ${hasError ? 'text-red-400' : 'text-zinc-300'}`}>
                    {prettyStage(call.stage)}
                  </span>
                  <span className="text-[11px] text-zinc-400 truncate flex-1 min-w-0">
                    {hasError ? call.error : call.responseSummary || call.prompt.substring(0, 80)}
                  </span>
                  <span className="text-[11px] font-mono text-zinc-400 flex-shrink-0">{(call.durationMs / 1000).toFixed(1)}s</span>
                  <span className="text-[11px] font-mono text-zinc-400 flex-shrink-0 w-12 text-right">${(call.costEstimate || 0).toFixed(2)}</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`text-zinc-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>

                {isExpanded && (
                  <div className="px-5 pb-5 pt-1 space-y-4">
                    {/* What we asked for — layered recipe or plain prompt */}
                    <div>
                      <div className="text-[11px] text-zinc-400 uppercase tracking-wide mb-1.5 flex items-center gap-2">
                        What we asked for
                        {recipe?.toolKey && <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-400 font-mono normal-case">{recipe.toolKey}</span>}
                      </div>
                      <div className="surface-inset rounded-md p-3">
                        {layered ? (
                          <div className="space-y-1.5">
                            {sections.map((section) => (
                              <LayerCard key={`${call.id}-${section.key}`} section={section} defaultOpen={section.key !== 'outputContract' && section.key !== 'userNotePolicy'} />
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{call.prompt}</p>
                        )}
                      </div>
                      {layered && (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer list-none text-[11px] text-zinc-500 hover:text-zinc-300">Raw prompt as sent</summary>
                          <pre className="mt-1.5 surface-inset rounded-md p-3 text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed">{call.prompt}</pre>
                        </details>
                      )}
                    </div>

                    {/* What it saw — reference images */}
                    {imageRefs.length > 0 && (
                      <div>
                        <div className="text-[11px] text-zinc-400 uppercase tracking-wide mb-1.5">What it saw</div>
                        <div className="flex gap-2 flex-wrap">
                          {imageRefs.map((ref, i) => (
                            <div key={i} className="relative group">
                              <img src={ref.url} className="w-20 h-20 object-cover rounded-md border border-white/[0.06]" alt={ref.label} />
                              <div className="absolute inset-x-0 bottom-0 bg-black/70 text-[11px] text-zinc-300 px-1 py-0.5 rounded-b-md truncate text-center">{ref.label}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Output or error */}
                    {hasError ? (
                      <div>
                        <div className="text-[11px] text-red-400 uppercase tracking-wide mb-1.5">Error</div>
                        <div className="bg-red-500/[0.05] border border-red-500/10 rounded-md p-3">
                          <pre className="text-sm text-red-300 whitespace-pre-wrap font-mono leading-relaxed">{call.error}</pre>
                        </div>
                      </div>
                    ) : call.responseSummary ? (
                      <div>
                        <div className="text-[11px] text-zinc-400 uppercase tracking-wide mb-1.5">What came back</div>
                        <div className="surface-inset rounded-md p-3">
                          <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{call.responseSummary}</p>
                        </div>
                      </div>
                    ) : null}

                    {/* Image outputs */}
                    {imageOutputs.length > 0 && (
                      <div>
                        <div className="text-[11px] text-zinc-400 uppercase tracking-wide mb-1.5">Generated images</div>
                        <div className="flex gap-2 flex-wrap">
                          {imageOutputs.map((a, i) => (
                            <img key={i} src={a.url} className="w-24 h-24 object-cover rounded-md border border-white/[0.06]" alt="" />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Video outputs */}
                    {videoOutputs.length > 0 && (
                      <div>
                        <div className="text-[11px] text-zinc-400 uppercase tracking-wide mb-1.5">Generated video</div>
                        <div className="flex gap-2 flex-wrap">
                          {videoOutputs.map((a, i) => (
                            <video key={i} src={a.url} className="w-48 h-28 object-cover rounded-md border border-white/[0.06]" controls muted />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center gap-3 pt-2 text-[11px] font-mono text-zinc-400 border-t border-white/[0.04]">
                      <span>{call.model}</span>
                      <span className="text-zinc-400">·</span>
                      <span>{(call.durationMs / 1000).toFixed(2)}s</span>
                      <span className="text-zinc-400">·</span>
                      <span>${(call.costEstimate || 0).toFixed(4)}</span>
                      <span className="text-zinc-400 ml-auto">{new Date(call.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
};
