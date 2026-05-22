import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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

type ToolRecipe = {
  key: string;
  label: string;
  description: string;
  enabledFor?: string[];
  requires: string[];
  contextInputs: string[];
  produces: string[];
  surface: string;
  hasPromptBuilder: boolean;
};

interface Props {
  onBack: () => void;
}

const MODEL_FILTERS = [
  { key: 'all', label: 'All models' },
  { key: 'claude', label: 'Claude', match: (m: string) => m.startsWith('claude') },
  { key: 'gemini', label: 'Gemini', match: (m: string) => m.startsWith('gemini') && !m.includes('image') },
  { key: 'gemini-image', label: 'Gemini Image', match: (m: string) => m.includes('gemini') && m.includes('image') },
  { key: 'video', label: 'Video', match: (m: string) => m.includes('veo') || m.includes('seedance') },
];

const formatDuration = (ms: number | null): string => {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
};

const ASSET_LABELS: Record<string, string> = {
  audio: 'audio',
  scriptText: 'script',
  directorBrief: 'director brief',
  targetRuntime: 'target runtime',
  lyrics: 'lyrics',
  musicalStructure: 'musical structure',
  meaning: 'meaning',
  concept: 'locked concept',
  styleDirections: 'style directions',
  styleAsset: 'locked style',
  cast: 'cast',
  environments: 'environments',
  scenes: 'scenes',
  shots: 'shots',
  shotPrompts: 'shot prompts',
  storyboardPrompts: 'storyboard prompts',
  castLooks: 'character looks',
  envLooks: 'environment looks',
  audioPlan: 'audio plan',
  castVoices: 'cast voices',
  ttsAssets: 'dialogue audio',
  storyboards: 'storyboards',
  keyframes: 'keyframes',
  videos: 'videos',
  render: 'final render',
};

const SURFACE_LABELS: Record<string, string> = {
  'asset:concept': 'Concept',
  'asset:script': 'Script',
  'asset:style': 'Style',
  'asset:characters': 'Characters',
  'asset:environments': 'Environments',
  'asset:audio': 'Audio',
  'asset:studio': 'Studio',
  'asset:render': 'Render',
  'agent-only': 'Agent only',
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

const formatWorkflowList = (keys?: string[]): string =>
  (keys || []).map((key) => WORKFLOW_LABELS[key] || key).join(' · ');

const WORKFLOW_FILTERS: Array<{ key: string; label: string; match: (tool: ToolRecipe) => boolean }> = [
  { key: 'all', label: 'All workflows', match: () => true },
  { key: 'music_led', label: 'Music-led', match: (tool) => !tool.enabledFor || tool.enabledFor.some((k) => WORKFLOW_LABELS[k] === 'Music-led') },
  { key: 'scripted_narrative', label: 'Scripted narrative', match: (tool) => !tool.enabledFor || tool.enabledFor.some((k) => WORKFLOW_LABELS[k] === 'Scripted narrative') },
];

const formatAssetList = (keys: string[], fallback: string): string =>
  keys.length ? keys.map((key) => ASSET_LABELS[key] || key).join(', ') : fallback;

const COMPOSER_SECTIONS = [
  { label: 'Core task', note: 'what this tool is trying to do' },
  { label: 'Workflow context', note: 'music-led or scripted narrative framing' },
  { label: 'Project inputs', note: 'script, style, cast, shots, or audio' },
  { label: 'Preset taste', note: 'medium guard and taste rules' },
  { label: 'User note policy', note: 'how strongly your note should steer it' },
  { label: 'Output contract', note: 'the exact shape the model must return' },
];

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

export const PromptsLibrary: React.FC<Props> = ({ onBack }) => {
  const [prompts, setPrompts] = useState<PromptMeta[]>([]);
  const [tools, setTools] = useState<ToolRecipe[]>([]);
  const [stages, setStages] = useState<Record<string, StageMeta>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [workflowFilter, setWorkflowFilter] = useState<string>('all');
  const [showReferences, setShowReferences] = useState(false);
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
          setTools(data.tools || []);
          setStages(data.stages || {});
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
    const mf = MODEL_FILTERS.find(f => f.key === modelFilter);
    return prompts.filter(p => {
      if (mf?.match && !mf.match(p.model)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.summary.toLowerCase().includes(q) ||
        p.triggeredBy.toLowerCase().includes(q) ||
        p.template.toLowerCase().includes(q) ||
        p.modelLabel.toLowerCase().includes(q)
      );
    });
  }, [prompts, search, modelFilter]);

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
  const visibleTools = useMemo(() => {
    const matcher = WORKFLOW_FILTERS.find((f) => f.key === workflowFilter) || WORKFLOW_FILTERS[0];
    const q = search.trim().toLowerCase();
    return tools.filter((tool) => {
      if (!matcher.match(tool)) return false;
      if (!q) return true;
      // Search hits the artist-facing fields (label, description, surface,
      // produced/required asset labels) AND the registry key for debugging.
      // Per Codex review on 5ad7c29: search box must filter the primary
      // Tool Recipes grid, not only the legacy template list.
      const assetSearchText = [...tool.requires, ...tool.contextInputs, ...tool.produces]
        .map((key) => ASSET_LABELS[key] || key)
        .join(' ')
        .toLowerCase();
      const surfaceLabel = (SURFACE_LABELS[tool.surface] || tool.surface).toLowerCase();
      return (
        tool.label.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q) ||
        tool.key.toLowerCase().includes(q) ||
        surfaceLabel.includes(q) ||
        assetSearchText.includes(q)
      );
    });
  }, [tools, workflowFilter, search]);
  const toolsBySurface = useMemo(() => {
    const map: Record<string, ToolRecipe[]> = {};
    for (const tool of visibleTools) {
      if (!map[tool.surface]) map[tool.surface] = [];
      map[tool.surface].push(tool);
    }
    return Object.entries(map);
  }, [visibleTools]);

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
          <h1 className="text-2xl font-display font-semibold text-white tracking-tight">Prompt System</h1>
          <p className="text-sm text-zinc-400 mt-1.5 max-w-xl">
            The buttons Mirage and the agent can run, plus the prompt recipe each model call is assembled from.
          </p>
        </div>
        {!loading && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono">Tools + calls</div>
            <div className="text-sm text-zinc-300 tabular-nums mt-1">
              {tools.length.toLocaleString()} tools · {totalCalls.toLocaleString()} prompt calls · ${totalSpend.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      <div className="surface rounded-xl p-4 mb-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h2 className="text-sm font-medium text-white">How a composed prompt is built</h2>
            <p className="text-xs text-zinc-400 mt-1 max-w-2xl">
              Most v1 tools do not use one hidden wall of text. They stack these sections, then X-Ray records the exact stack for each call.
            </p>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono flex-shrink-0">Composer</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {COMPOSER_SECTIONS.map((section, idx) => (
            <div key={section.label} className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
              <div className="text-[10px] text-zinc-500 font-mono mb-1">{idx + 1}</div>
              <div className="text-xs text-white font-medium">{section.label}</div>
              <div className="text-[11px] text-zinc-400 leading-snug mt-1">{section.note}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter bar — matches Blueprint phase bar pattern */}
      <div className="surface rounded-xl p-3 mb-8 flex items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, summary, recipe, template…"
            className="w-full bg-transparent text-sm text-white placeholder:text-zinc-400 pl-9 pr-3 py-1.5 outline-none focus:ring-1 focus:ring-white/20 rounded-md"
          />
        </div>
        <div className="flex gap-px bg-white/[0.04] rounded-md overflow-hidden flex-shrink-0">
          {WORKFLOW_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setWorkflowFilter(f.key)}
              className={`text-xs px-2.5 py-1.5 transition-colors ${
                workflowFilter === f.key ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'
              }`}
              title="Filter Tool Recipes by workflow. Prompt templates below are not filtered."
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
          {toolsBySurface.length > 0 && (
            <section>
              <div className="flex items-baseline gap-4 mb-3 pb-2 border-b border-white/[0.06]">
                <h2 className="text-lg font-display font-medium text-white tracking-tight">Production buttons</h2>
                <p className="text-xs text-zinc-400 flex-1 truncate">
                  These are the actions surfaced in Blueprint, Studio, Render, and the agent harness.
                </p>
                <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono tabular-nums flex-shrink-0">
                  {visibleTools.length === tools.length ? tools.length : `${visibleTools.length} / ${tools.length}`}
                </span>
              </div>

              <div className="space-y-4">
                {toolsBySurface.map(([surface, surfaceTools]) => (
                  <div key={surface}>
                    <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono mb-2">{SURFACE_LABELS[surface] || surface}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {surfaceTools.map((tool) => (
                        <div key={tool.key} className="group rounded-lg border border-white/[0.06] px-4 py-3 bg-white/[0.015]" title={`Registry key: ${tool.key}`}>
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-sm font-medium text-white truncate">{tool.label}</h3>
                                <span className="text-[10px] text-zinc-500 font-mono truncate opacity-0 group-hover:opacity-100 transition-opacity">{tool.key}</span>
                              </div>
                              <p className="text-xs text-zinc-400 leading-relaxed">{tool.description}</p>
                            </div>
                            <span className={`text-[10px] rounded px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap ${tool.hasPromptBuilder ? 'text-cyan-200 bg-cyan-400/[0.08]' : 'text-zinc-400 bg-white/[0.04]'}`}>
                              {tool.hasPromptBuilder ? 'Prompted' : 'Action'}
                            </span>
                            {tool.enabledFor && tool.enabledFor.length > 0 && (
                              <span className="text-[10px] text-zinc-300 bg-white/[0.04] rounded px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap">
                                {formatWorkflowList(tool.enabledFor)}
                              </span>
                            )}
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                            <div>
                              <div className="uppercase tracking-wide text-zinc-500 mb-1">Can run after</div>
                              <div className="text-zinc-400">{formatAssetList(tool.requires, 'nothing')}</div>
                            </div>
                            <div>
                              <div className="uppercase tracking-wide text-zinc-500 mb-1">Also reads</div>
                              <div className="text-zinc-400">{formatAssetList(tool.contextInputs, 'minimal context')}</div>
                            </div>
                            <div>
                              <div className="uppercase tracking-wide text-zinc-500 mb-1">Creates / updates</div>
                              <div className="text-zinc-300">{formatAssetList(tool.produces, 'nothing')}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="flex items-center gap-4 mb-3 pb-2 border-b border-white/[0.06]">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-display font-medium text-white tracking-tight">Prompt references and usage</h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Debug view for old template references and aggregate call history. X-Ray is the better place to inspect one real call.
                </p>
              </div>
              <div className="flex gap-px bg-white/[0.04] rounded-md overflow-hidden flex-shrink-0">
                {MODEL_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setModelFilter(f.key)}
                    className={`text-xs px-2.5 py-1.5 transition-colors ${
                      modelFilter === f.key ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowReferences((v) => !v)}
                className="text-xs text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-md px-3 py-1.5 transition-colors"
              >
                {showReferences ? 'Hide references' : `Show ${filtered.length} references`}
              </button>
            </div>
          </section>

          {showReferences && filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-zinc-400">
              No prompt references match your filter.
            </div>
          ) : null}

          {showReferences && grouped.map(([stageKey, stagePrompts]) => {
            const meta = stages[stageKey];
            return (
              <section key={stageKey}>
                <div className="flex items-baseline gap-4 mb-3 pb-2 border-b border-white/[0.06]">
                  <h2 className="text-lg font-display font-medium text-white tracking-tight">
                    {meta?.label || stageKey}
                  </h2>
                  <p className="text-xs text-zinc-400 flex-1 truncate">
                    {meta?.description || 'Legacy/template reference. Runtime recipes above are the primary contract.'}
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
                                {p.modelLabel}
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
                                    <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono mb-2">Variables</div>
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
                                    <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono">Prompt text / composed sections</div>
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
          {visibleTools.length} of {tools.length} buttons shown · {filtered.length} of {prompts.length} debug references match — project overrides apply to recipe sections, not whole hidden templates
        </div>
      )}
    </div>
  );
};
