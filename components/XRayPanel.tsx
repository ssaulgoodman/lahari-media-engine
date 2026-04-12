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

interface Props {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

// ─── Stage grouping (for filter pills) ───────────────────────────────

const STAGE_GROUPS: { key: string; label: string; prefixes: string[] }[] = [
  { key: 'all',     label: 'All',       prefixes: [] },
  { key: 'errors',  label: 'Errors',    prefixes: [] },
  { key: 'blueprint', label: 'Blueprint', prefixes: ['transcribe', 'detect-structure', 'summarize', 'generate-concepts', 'generate-script', 'brainstorm-styles', 'visualize-style', 'refine-style', 'analyze-style', 'enrich-style', 'lock-style', 'generate-looks', 'generate-environment', 'write-shot-prompts'] },
  { key: 'studio',  label: 'Studio',    prefixes: ['generate-shot-image', 'generate-shot-video', 'generate-shot-start-frame', 'generate-shot-end-frame', 'generate-shot-frame-pair', 'describe-frame', 'critique'] },
  { key: 'chat',    label: 'Chat',      prefixes: ['chat'] },
];

const prettyStage = (stage: string): string => {
  const base = stage.split(':')[0];
  return base.replace(/-/g, ' ').replace(/generate /, '');
};

// ─── Main panel ──────────────────────────────────────────────────────

export const XRayPanel: React.FC<Props> = ({ projectId, isOpen, onClose }) => {
  const [calls, setCalls] = useState<XRayEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

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
    if (isOpen) refresh();
  }, [isOpen, refresh]);

  const filtered = useMemo(() => {
    let list = calls;
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
  }, [calls, filter, query]);

  const totalCost = calls.reduce((s, c) => s + (c.costEstimate || 0), 0);
  const totalDuration = calls.reduce((s, c) => s + (c.durationMs || 0), 0);
  const errorCount = calls.filter(c => c.error).length;

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
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-white">X-Ray</h2>
            <span className="text-[11px] text-zinc-600 font-mono">
              {calls.length} calls · ${totalCost.toFixed(2)} · {(totalDuration / 1000).toFixed(0)}s
              {errorCount > 0 && <span className="text-red-400 ml-2">· {errorCount} errors</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              disabled={loading}
              className="text-[11px] text-zinc-500 hover:text-white transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md px-2 py-1"
            >
              {loading ? '…' : 'Refresh'}
            </button>
            <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md p-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        {/* Filters + search */}
        <div className="flex-shrink-0 px-5 py-3 border-b border-white/[0.06] flex items-center gap-3">
          <div className="flex items-center gap-1">
            {STAGE_GROUPS.map(g => {
              const count = g.key === 'all' ? calls.length
                : g.key === 'errors' ? errorCount
                : calls.filter(c => g.prefixes.some(p => c.stage.startsWith(p))).length;
              if (g.key !== 'all' && g.key !== 'errors' && count === 0) return null;
              const active = filter === g.key;
              return (
                <button
                  key={g.key}
                  onClick={() => setFilter(g.key)}
                  className={`text-[11px] px-2.5 py-1 rounded-md transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 ${
                    active ? 'bg-white/[0.08] text-white' : 'text-zinc-500 hover:text-zinc-300'
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
            className="surface-inset rounded-md px-2.5 py-1 text-[11px] text-zinc-300 placeholder:text-zinc-700 outline-none focus-visible:ring-1 focus-visible:ring-white/20 w-40"
          />
        </div>

        {/* Call list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="flex items-center justify-center h-48 text-zinc-700 text-xs">
              {calls.length === 0 ? 'No calls yet' : 'No matches'}
            </div>
          )}

          {filtered.map(call => {
            const isExpanded = expandedId === call.id;
            const hasError = !!call.error;
            const imageOutputs = (call.outputAssets || []).filter(a => a.url && (a.category === 'style' || a.category === 'character' || a.category === 'shot_image' || a.category === 'shot_end_frame' || a.category === 'shot_extracted_last_frame'));
            const videoOutputs = (call.outputAssets || []).filter(a => a.url && a.category === 'shot_video');
            const imageRefs = call.referenceInputs.filter(r => r.type === 'image' && r.url);
            const time = new Date(call.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            return (
              <div key={call.id} className={`border-b border-white/[0.04] ${hasError ? 'bg-red-500/[0.02]' : ''}`}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : call.id)}
                  className="w-full text-left px-5 py-2.5 flex items-center gap-3 hover:bg-white/[0.02] transition-colors outline-none focus-visible:bg-white/[0.04]"
                >
                  <span className="text-[10px] font-mono text-zinc-700 w-16 flex-shrink-0">{time}</span>
                  <span className={`text-[12px] flex-shrink-0 w-40 truncate ${hasError ? 'text-red-400' : 'text-zinc-300'}`}>
                    {prettyStage(call.stage)}
                  </span>
                  <span className="text-[11px] text-zinc-600 truncate flex-1 min-w-0">
                    {hasError ? call.error : call.responseSummary || call.prompt.substring(0, 80)}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-600 flex-shrink-0">{(call.durationMs / 1000).toFixed(1)}s</span>
                  <span className="text-[10px] font-mono text-zinc-600 flex-shrink-0 w-12 text-right">${(call.costEstimate || 0).toFixed(2)}</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`text-zinc-700 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>

                {isExpanded && (
                  <div className="px-5 pb-5 pt-1 space-y-4">
                    {/* Prompt */}
                    <div>
                      <div className="text-[10px] text-zinc-600 uppercase tracking-wide mb-1.5">Prompt</div>
                      <div className="surface-inset rounded-md p-3 max-h-64 overflow-y-auto">
                        <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">{call.prompt}</pre>
                      </div>
                    </div>

                    {/* Reference images */}
                    {imageRefs.length > 0 && (
                      <div>
                        <div className="text-[10px] text-zinc-600 uppercase tracking-wide mb-1.5">Reference inputs</div>
                        <div className="flex gap-2 flex-wrap">
                          {imageRefs.map((ref, i) => (
                            <div key={i} className="relative group">
                              <img src={ref.url} className="w-16 h-16 object-cover rounded-md border border-white/[0.06]" alt={ref.label} />
                              <div className="absolute inset-x-0 bottom-0 bg-black/70 text-[9px] text-zinc-300 px-1 py-0.5 rounded-b-md truncate text-center">{ref.label}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Output or error */}
                    {hasError ? (
                      <div>
                        <div className="text-[10px] text-red-400 uppercase tracking-wide mb-1.5">Error</div>
                        <div className="bg-red-500/[0.05] border border-red-500/10 rounded-md p-3 max-h-48 overflow-y-auto">
                          <pre className="text-[11px] text-red-300 whitespace-pre-wrap font-mono leading-relaxed">{call.error}</pre>
                        </div>
                      </div>
                    ) : call.responseSummary ? (
                      <div>
                        <div className="text-[10px] text-zinc-600 uppercase tracking-wide mb-1.5">Response</div>
                        <div className="surface-inset rounded-md p-3 max-h-48 overflow-y-auto">
                          <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">{call.responseSummary}</pre>
                        </div>
                      </div>
                    ) : null}

                    {/* Image outputs */}
                    {imageOutputs.length > 0 && (
                      <div>
                        <div className="text-[10px] text-zinc-600 uppercase tracking-wide mb-1.5">Generated images</div>
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
                        <div className="text-[10px] text-zinc-600 uppercase tracking-wide mb-1.5">Generated video</div>
                        <div className="flex gap-2 flex-wrap">
                          {videoOutputs.map((a, i) => (
                            <video key={i} src={a.url} className="w-48 h-28 object-cover rounded-md border border-white/[0.06]" controls muted />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center gap-3 pt-2 text-[10px] font-mono text-zinc-600 border-t border-white/[0.04]">
                      <span>{call.model}</span>
                      <span className="text-zinc-700">·</span>
                      <span>{(call.durationMs / 1000).toFixed(2)}s</span>
                      <span className="text-zinc-700">·</span>
                      <span>${(call.costEstimate || 0).toFixed(4)}</span>
                      <span className="text-zinc-700 ml-auto">{new Date(call.createdAt).toLocaleTimeString()}</span>
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
