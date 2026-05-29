import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ApiProject } from '../types';

type PromptUsage = {
  callCount: number;
  avgDurationMs: number | null;
  totalCost: number;
  errorCount: number;
};

type PromptMeta = {
  id: string;
  name: string;
  stage: string;
  model: string;
  modelLabel: string;
  triggeredBy: string;
  summary: string;
  variables: { name: string; description: string }[];
  template: string;
  source: { file: string; lines: string };
  usage?: PromptUsage;
};

type StageMeta = { label: string; description: string; order: number };
type WorkflowMeta = {
  key: string;
  label: string;
  primarySeed: string;
  acceptedSeeds: string[];
  summary: string;
  projectBriefRules: string;
  shotPlanRules: string;
};
type PresetMeta = {
  key: string;
  label: string;
  workflowKey: string;
  sourceKind: string;
  sourceRules: string;
  conceptRules: string;
  styleRules: string;
  styleBrainstormTaste: string;
  characterRules: string;
  environmentRules: string;
  qualityRules: string;
  shotPromptRules: string;
  storyboardRules: string;
  audioRules: string[];
  defaults: Record<string, any>;
};

interface Props {
  onBack: () => void;
  project?: ApiProject | null;
}

const ROUTING_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'llm', label: 'LLM', match: (p: PromptMeta) => p.model.includes('text_provider') || p.model === 'project.script_writer' || p.model === 'gpt-5.5' || p.model === 'utility.text' },
  { key: 'refine', label: 'Refine', match: (p: PromptMeta) => p.id.includes('refine') || p.name.toLowerCase().includes('refine') || p.model.includes('refine') },
  { key: 'script-writer', label: 'Script writer', match: (p: PromptMeta) => p.model === 'project.script_writer' || p.model === 'gpt-5.5' },
  { key: 'image', label: 'Image', match: (p: PromptMeta) => p.model === 'project.image_model' || p.model === 'project.storyboard_provider' || p.model === 'utility.gemini' },
  { key: 'video', label: 'Video', match: (p: PromptMeta) => p.model === 'project.video_model' },
  { key: 'fixed', label: 'Fixed', match: (p: PromptMeta) => p.model.startsWith('audio.') || p.model.startsWith('utility.') },
];

const formatDuration = (ms: number | null): string => {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
};

// Humanize workflow enum keys for display. Per D26 these are the
// canonical archetype names; legacy aliases collapse to the canonical
// label so old rows don't show two variants.
const WORKFLOW_LABELS: Record<string, string> = {
  music_led: 'Music-led',
  music_video: 'Music-led',
  scripted_narrative: 'Scripted narrative',
  anime_scripted: 'Scripted narrative',
};

const humanizeKey = (key?: string | null): string =>
  key ? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Not set';

const MUSIC_ONLY_PROMPTS = new Set(['transcribe-lyrics', 'detect-structure', 'summarize-meaning', 'plan-scenes']);
const SCRIPTED_ONLY_PROMPTS = new Set(['parse-script-intake', 'write-audio-plan']);

const appliesToWorkflow = (prompt: PromptMeta, workflowKey: string): boolean => {
  if (workflowKey === 'all') return true;
  if (workflowKey === 'music_led') return !SCRIPTED_ONLY_PROMPTS.has(prompt.id);
  if (workflowKey === 'scripted_narrative') return !MUSIC_ONLY_PROMPTS.has(prompt.id);
  return true;
};

const resolveRouteLabel = (prompt: PromptMeta): string => {
  switch (prompt.model) {
    case 'project.text_provider':
      return 'LLM route · project text provider';
    case 'project.text_provider.refine':
      return 'LLM route · refine tier';
    case 'project.script_writer':
      return 'LLM route · script writer';
    case 'project.image_model':
      return 'Image route · project image model';
    case 'project.storyboard_provider':
      return 'Image route · storyboard provider';
    case 'project.text_provider.refine OR project.storyboard_provider':
      return 'Hybrid route · text refine or storyboard image';
    case 'project.video_model':
      return 'Video route · project video model';
    case 'audio.analysis':
      return 'Fixed · audio analysis';
    case 'utility.gemini':
      return 'Fixed · Gemini utility with image input';
    case 'utility.text':
      return 'Fixed · utility text';
    default:
      return prompt.modelLabel;
  }
};

// Inline visual for {{variables}} — renders them as subtle chips so the
// template remains scannable. Falls back to plain text otherwise.
const TemplateBody: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return (
    <pre className="font-mono text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (/^\{\{.+\}\}$/.test(part)) {
          return (
            <span
              key={i}
              className="inline-block align-baseline px-1.5 py-px rounded bg-white/[0.06] text-white/90 font-mono text-[10.5px] border border-white/[0.04]"
            >
              {part.replace(/^\{\{|\}\}$/g, '').trim()}
            </span>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </pre>
  );
};

export const PromptsLibrary: React.FC<Props> = ({ onBack, project }) => {
  const [prompts, setPrompts] = useState<PromptMeta[]>([]);
  const [stages, setStages] = useState<Record<string, StageMeta>>({});
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([]);
  const [presets, setPresets] = useState<PresetMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [routeFilter, setRouteFilter] = useState<string>('all');
  const [workflowFilter, setWorkflowFilter] = useState<string>('all');
  const [presetFilter, setPresetFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const { supabase } = await import('../lib/supabase');
        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = {};
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        const res = await fetch('/api/prompts', { headers });
        const data = await res.json();
        if (!aborted) {
          setPrompts(data.prompts || []);
          setStages(data.stages || {});
          setWorkflows(data.workflows || []);
          setPresets(data.presets || []);
        }
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, []);

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1200);
    } catch {}
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rf = ROUTING_FILTERS.find(f => f.key === routeFilter);
    const preset = presets.find(p => p.key === presetFilter);
    const selectedWorkflow = workflowFilter !== 'all' ? workflowFilter : preset?.workflowKey || 'all';
    return prompts.filter(p => {
      if (rf?.match && !rf.match(p)) return false;
      if (!appliesToWorkflow(p, selectedWorkflow)) return false;
      const routeLabel = resolveRouteLabel(p);
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.summary.toLowerCase().includes(q) ||
        p.triggeredBy.toLowerCase().includes(q) ||
        p.template.toLowerCase().includes(q) ||
        p.modelLabel.toLowerCase().includes(q) ||
        routeLabel.toLowerCase().includes(q)
      );
    });
  }, [prompts, search, presets, routeFilter, presetFilter, workflowFilter]);

  const grouped = useMemo(() => {
    const map: Record<string, PromptMeta[]> = {};
    for (const p of filtered) {
      if (!map[p.stage]) map[p.stage] = [];
      map[p.stage].push(p);
    }
    return Object.entries(map).sort((a, b) => (stages[a[0]]?.order || 99) - (stages[b[0]]?.order || 99));
  }, [filtered, stages]);

  const totalCalls = prompts.reduce((acc, p) => acc + (p.usage?.callCount || 0), 0);
  const totalSpend = prompts.reduce((acc, p) => acc + (p.usage?.totalCost || 0), 0);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <button
            onClick={onBack}
            className="mb-3 flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
            </svg>
            Back
          </button>
          <h1 className="text-2xl font-display font-semibold text-white tracking-tight">Prompts</h1>
          <p className="text-sm text-zinc-400 mt-1.5 max-w-xl">
            A guide to the model-facing prompts, workflow context, and preset taste blocks that make Mirage run.
          </p>
        </div>
        {!loading && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono">Usage</div>
            <div className="text-sm text-zinc-300 tabular-nums mt-1">
              {prompts.length.toLocaleString()} prompts · {totalCalls.toLocaleString()} calls · ${totalSpend.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-3 mb-4">
        <div className="surface rounded-xl p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono mb-3">Workflows</div>
          <div className="space-y-3">
            {workflows.map((workflow) => (
              <div key={workflow.key} className="border-l border-white/[0.08] pl-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-white">{workflow.label}</h3>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">{workflow.primarySeed} seed</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1">{workflow.summary}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="surface rounded-xl p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono mb-3">Presets</div>
          <div className="space-y-3">
            {presets
              .filter((preset) => presetFilter === 'all' || preset.key === presetFilter)
              .map((preset) => (
              <div key={preset.key} className="border-l border-white/[0.08] pl-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-white">{preset.label}</h3>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">{WORKFLOW_LABELS[preset.workflowKey] || preset.workflowKey}</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1">{preset.sourceRules}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {['concept', 'script', 'style', 'looks', 'studio', 'audio'].map((part) => (
                    <span key={part} className="text-[10px] uppercase tracking-wider text-zinc-500 bg-white/[0.035] rounded px-1.5 py-0.5 font-mono">
                      {part}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filter bar — matches Blueprint phase bar pattern */}
      <div className="surface rounded-xl p-3 mb-8 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prompts, variables, source…"
            className="w-full bg-transparent text-sm text-white placeholder:text-zinc-400 pl-9 pr-3 py-1.5 outline-none focus:ring-1 focus:ring-white/20 rounded-md"
          />
        </div>
        <select
          value={workflowFilter}
          onChange={(e) => setWorkflowFilter(e.target.value)}
          className="bg-white/[0.04] text-xs text-zinc-300 rounded-md px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-white/20"
        >
          <option value="all">All workflows</option>
          {workflows.map((workflow) => <option key={workflow.key} value={workflow.key}>{workflow.label}</option>)}
        </select>
        <select
          value={presetFilter}
          onChange={(e) => setPresetFilter(e.target.value)}
          className="bg-white/[0.04] text-xs text-zinc-300 rounded-md px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-white/20"
        >
          <option value="all">All presets</option>
          {presets.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
        </select>
        <div className="flex gap-px bg-white/[0.04] rounded-md overflow-hidden flex-shrink-0">
          {ROUTING_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setRouteFilter(f.key)}
              className={`text-xs px-2.5 py-1.5 transition-colors ${
                routeFilter === f.key ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="surface rounded-xl h-20 skeleton" />
          ))}
        </div>
      ) : (
        <div className="space-y-10">
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-sm text-zinc-400">
              No prompts match your filter.
            </div>
          ) : null}

          {grouped.map(([stageKey, stagePrompts]) => {
            const meta = stages[stageKey];
            return (
              <section key={stageKey}>
                <div className="flex items-baseline gap-4 mb-3 pb-2 border-b border-white/[0.06]">
                  <h2 className="text-lg font-display font-medium text-white tracking-tight">
                    {meta?.label || stageKey}
                  </h2>
                  <p className="text-xs text-zinc-400 flex-1 truncate">
                    {meta?.description || 'Prompt references for this part of the pipeline.'}
                  </p>
                  <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono tabular-nums flex-shrink-0">
                    {stagePrompts.length}
                  </span>
                </div>

                <div className="space-y-2">
                  {stagePrompts.map((p) => {
                    const isExpanded = expanded.has(p.id);
                    return (
                      <div
                        key={p.id}
                        className="rounded-xl border border-white/[0.06] overflow-hidden transition-colors"
                      >
                        {/* Collapsed header — always visible */}
                        <button
                          onClick={() => toggleExpanded(p.id)}
                          className="w-full px-5 py-3.5 flex items-center gap-4 text-left hover:bg-white/[0.02] transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-1">
                              <h3 className="text-sm font-medium text-white truncate">{p.name}</h3>
                              <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-mono flex-shrink-0">
                                {resolveRouteLabel(p)}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-400 line-clamp-1">{p.summary}</p>
                          </div>

                          {/* Usage pill + caret */}
                          <div className="flex items-center gap-3 flex-shrink-0">
                            {p.usage && p.usage.callCount > 0 && (
                              <div className="text-right">
                                <div className="text-[11px] text-zinc-300 tabular-nums font-mono">
                                  {p.usage.callCount}
                                </div>
                                <div className="text-[10px] text-zinc-400 font-mono tabular-nums">
                                  {formatDuration(p.usage.avgDurationMs)}
                                </div>
                              </div>
                            )}
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={`text-zinc-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              aria-hidden="true"
                            >
                              <path d="M6 9l6 6 6-6"/>
                            </svg>
                          </div>
                        </button>

                        {/* Expanded body */}
                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: 'easeOut' }}
                              className="overflow-hidden"
                            >
                              <div className="px-5 pb-5 pt-1 space-y-4 border-t border-white/[0.04]">
                                {/* Trigger + stats row */}
                                <div className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono mb-1.5">Triggered by</div>
                                    <p className="text-xs text-zinc-300">{p.triggeredBy}</p>
                                  </div>
                                  <div>
                                    <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono mb-1.5">Source</div>
                                    <p className="text-xs text-zinc-300 font-mono truncate" title={`${p.source.file}:${p.source.lines}`}>
                                      {p.source.file}:{p.source.lines}
                                    </p>
                                  </div>
                                </div>

                                {/* Usage stats row (only when any calls logged) */}
                                {p.usage && p.usage.callCount > 0 && (
                                  <div className="flex gap-6 text-[11px] font-mono text-zinc-400">
                                    <div>
                                      <span className="text-zinc-300 tabular-nums">{p.usage.callCount}</span> calls
                                    </div>
                                    <div>
                                      avg <span className="text-zinc-300 tabular-nums">{formatDuration(p.usage.avgDurationMs)}</span>
                                    </div>
                                    <div>
                                      spend <span className="text-zinc-300 tabular-nums">${p.usage.totalCost.toFixed(2)}</span>
                                    </div>
                                    {p.usage.errorCount > 0 && (
                                      <div>
                                        <span className="text-amber-300 tabular-nums">{p.usage.errorCount}</span> errors
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Variables */}
                                {p.variables.length > 0 && (
                                  <div>
                                    <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono mb-2">Made from</div>
                                    <div className="flex flex-wrap gap-2">
                                      {p.variables.map(v => (
                                        <div
                                          key={v.name}
                                          className="group/var flex items-center gap-1.5 text-[11px]"
                                        >
                                          <code className="px-1.5 py-0.5 rounded bg-white/[0.06] text-white/90 font-mono border border-white/[0.04]">
                                            {v.name}
                                          </code>
                                          <span className="text-zinc-400 hidden group-hover/var:inline">{v.description}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Template */}
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono">Prompt text</div>
                                    <button
                                      onClick={() => copy(p.id, p.template)}
                                      className="text-[11px] text-zinc-400 hover:text-white transition-colors flex items-center gap-1"
                                    >
                                      {copied === p.id ? (
                                        <>
                                          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <polyline points="20 6 9 17 4 12"/>
                                          </svg>
                                          Copied
                                        </>
                                      ) : (
                                        <>
                                          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                          </svg>
                                          Copy
                                        </>
                                      )}
                                    </button>
                                  </div>
                                  <div className="surface-inset rounded-md p-4 max-h-[420px] overflow-y-auto">
                                    <TemplateBody text={p.template} />
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Footer note */}
      {!loading && (
        <div className="mt-12 pt-6 border-t border-white/[0.06] text-[11px] text-zinc-400 font-mono text-center">
          {filtered.length} of {prompts.length} prompts shown · project overrides apply inside the prompt recipe when the call runs
        </div>
      )}
    </div>
  );
};
