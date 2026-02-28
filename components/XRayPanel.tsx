import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as api from '../services/api';

// ─── Types ───────────────────────────────────────────────────────────

interface XRayReference {
  type: 'image' | 'audio' | 'text';
  label: string;
  url?: string;
  preview?: string;
}

interface XRayContext {
  lockedConcept?: string;
  lockedStyle?: string;
  lockedCharacters?: string[];
  videoMode?: string;
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
  contextChain: XRayContext;
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

// ─── Stage metadata ──────────────────────────────────────────────────

const STAGES: Record<string, { label: string; color: string; accent: string; icon: string }> = {
  'transcribe-lyrics':  { label: 'Transcribe Lyrics',  color: 'bg-sky-500/15',    accent: 'text-sky-400',     icon: 'A' },
  'detect-structure':   { label: 'Detect Structure',   color: 'bg-sky-500/15',    accent: 'text-sky-400',     icon: '~' },
  'summarize-meaning':  { label: 'Summarize Meaning',  color: 'bg-sky-500/15',    accent: 'text-sky-400',     icon: '=' },
  'generate-concepts':  { label: 'Generate Concepts',  color: 'bg-violet-500/15', accent: 'text-violet-400',  icon: '*' },
  'generate-styles':    { label: 'Generate Styles',    color: 'bg-amber-500/15',  accent: 'text-amber-400',   icon: '#' },
  'analyze-style-image':{ label: 'Analyze Style',      color: 'bg-amber-500/15',  accent: 'text-amber-400',   icon: 'o' },
  'generate-looks':     { label: 'Generate Looks',     color: 'bg-emerald-500/15',accent: 'text-emerald-400', icon: '@' },
  'generate-script':    { label: 'Generate Script',    color: 'bg-cyan-500/15',   accent: 'text-cyan-400',    icon: 'S' },
  'generate-shot-image':{ label: 'Shot Image',         color: 'bg-rose-500/15',   accent: 'text-rose-400',    icon: '[]' },
  'generate-shot-video':{ label: 'Shot Video',         color: 'bg-red-500/15',    accent: 'text-red-400',     icon: '>>' },
  'chat':               { label: 'Chat',               color: 'bg-zinc-500/15',   accent: 'text-zinc-400',    icon: '..' },
};

const getStageMeta = (stage: string) => {
  for (const [key, val] of Object.entries(STAGES)) {
    if (stage.startsWith(key)) return val;
  }
  return { label: stage, color: 'bg-zinc-500/15', accent: 'text-zinc-400', icon: '?' };
};

// ─── Sub-components ──────────────────────────────────────────────────

const SectionLabel: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = 'text-zinc-500' }) => (
  <div className={`text-[10px] ${color} uppercase tracking-[0.12em] font-medium mb-2 flex items-center gap-2`}>
    <span>{children}</span>
    <div className="flex-1 h-px bg-current opacity-20" />
  </div>
);

const ImageThumb: React.FC<{ url: string; label?: string; size?: 'sm' | 'md' }> = ({ url, label, size = 'sm' }) => (
  <div className="group relative">
    <img
      src={url}
      alt={label || ''}
      className={`${size === 'sm' ? 'w-16 h-16' : 'w-24 h-24'} object-cover rounded-lg border border-white/[0.08] bg-obsidian-800`}
    />
    {label && (
      <div className="absolute inset-x-0 bottom-0 bg-black/70 text-[10px] text-zinc-300 px-1 py-0.5 rounded-b-lg truncate text-center">
        {label}
      </div>
    )}
  </div>
);

const AudioBadge: React.FC<{ label: string; url?: string }> = ({ label, url }) => (
  <div className="flex items-center gap-2 bg-sky-500/10 border border-sky-500/20 rounded-lg px-3 py-2">
    <div className="flex gap-[2px] items-end h-4">
      {[3,6,10,8,5,9,4,7,11,6,3].map((h, i) => (
        <div key={i} className="w-[2px] bg-sky-400/60 rounded-full" style={{ height: `${h}px` }} />
      ))}
    </div>
    <span className="text-[11px] text-sky-300">{label}</span>
    {url && <a href={url} target="_blank" rel="noreferrer" className="text-[10px] text-sky-400/60 hover:text-sky-300 ml-auto">play</a>}
  </div>
);

const ContextPill: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-baseline gap-1.5 bg-violet-500/[0.06] border border-violet-500/15 rounded-md px-2.5 py-1.5">
    <span className="text-[10px] text-violet-400/60 uppercase tracking-wider font-medium shrink-0">{label}</span>
    <span className="text-[11px] text-violet-300/90">{value}</span>
  </div>
);

// ─── Card for a single call ──────────────────────────────────────────

const CallCard: React.FC<{ call: XRayEntry; isExpanded: boolean; onToggle: () => void }> = ({ call, isExpanded, onToggle }) => {
  const meta = getStageMeta(call.stage);
  const hasError = !!call.error;
  const hasContext = Object.values(call.contextChain || {}).some(v => v !== undefined && (Array.isArray(v) ? v.length > 0 : true));
  const imageOutputs = (call.outputAssets || []).filter(a => a.url && (a.category === 'style' || a.category === 'character' || a.category === 'shot_image'));
  const videoOutputs = (call.outputAssets || []).filter(a => a.url && a.category === 'shot_video');
  const imageRefs = call.referenceInputs.filter(r => r.type === 'image' && r.url);
  const audioRefs = call.referenceInputs.filter(r => r.type === 'audio');

  return (
    <div className={`${hasError ? 'bg-red-500/[0.03]' : ''}`}>
      <button onClick={onToggle} className="w-full text-left px-5 py-3.5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors">
        <div className={`w-8 h-8 rounded-lg ${meta.color} flex items-center justify-center flex-shrink-0 border border-white/[0.04]`}>
          <span className={`text-[10px] font-bold font-mono ${meta.accent}`}>{meta.icon}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[12px] font-medium ${meta.accent}`}>{meta.label}</span>
            {call.stage.includes(':attempt-') && (
              <span className="text-[10px] bg-white/[0.04] border border-white/[0.08] text-zinc-400 px-1.5 py-0.5 rounded-md font-mono">
                {call.stage.split(':')[1]}
              </span>
            )}
            {hasError && (
              <span className="text-[10px] bg-red-500/20 border border-red-500/30 text-red-400 px-1.5 py-0.5 rounded-md font-medium">FAILED</span>
            )}
          </div>
          <div className="text-[11px] text-zinc-600 truncate mt-0.5 max-w-md">
            {hasError ? call.error : call.responseSummary || '—'}
          </div>
        </div>

        <div className="flex items-center gap-4 flex-shrink-0 text-[10px] font-mono text-zinc-600">
          <span>{(call.durationMs / 1000).toFixed(1)}s</span>
          <span>${(call.costEstimate || 0).toFixed(3)}</span>
        </div>

        {!isExpanded && imageOutputs.length > 0 && (
          <div className="flex -space-x-2 flex-shrink-0">
            {imageOutputs.slice(0, 3).map((a, i) => (
              <img key={i} src={a.url} className="w-8 h-8 object-cover rounded-md border-2 border-obsidian-950" alt="" />
            ))}
            {imageOutputs.length > 3 && (
              <div className="w-8 h-8 rounded-md border-2 border-obsidian-950 bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-400">
                +{imageOutputs.length - 3}
              </div>
            )}
          </div>
        )}

        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-zinc-700 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {isExpanded && (
        <div className="px-5 pb-5 space-y-4">
          <SectionLabel color={meta.accent}>Input</SectionLabel>

          <div>
            <div className="text-[10px] text-zinc-500 font-medium mb-1.5">Prompt sent to model</div>
            <div className="surface-inset rounded-lg p-4 max-h-[400px] overflow-y-auto">
              <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">{call.prompt}</pre>
            </div>
          </div>

          {(audioRefs.length > 0 || imageRefs.length > 0) && (
            <div className="flex gap-4 flex-wrap">
              {audioRefs.map((ref, i) => (
                <AudioBadge key={`a${i}`} label={ref.label} url={ref.url} />
              ))}
              {imageRefs.map((ref, i) => (
                <ImageThumb key={`i${i}`} url={ref.url!} label={ref.label} size="sm" />
              ))}
            </div>
          )}

          {hasContext && (
            <div>
              <div className="text-[10px] text-zinc-500 font-medium mb-1.5">Rolling context</div>
              <div className="flex flex-wrap gap-1.5">
                {call.contextChain.lockedConcept && <ContextPill label="Concept" value={call.contextChain.lockedConcept} />}
                {call.contextChain.lockedStyle && <ContextPill label="Style" value={call.contextChain.lockedStyle} />}
                {call.contextChain.videoMode && <ContextPill label="Mode" value={call.contextChain.videoMode} />}
                {call.contextChain.lockedCharacters?.map((c, i) => (
                  <ContextPill key={i} label="Cast" value={c} />
                ))}
              </div>
            </div>
          )}

          <div className="mt-2" />
          <SectionLabel color={hasError ? 'text-red-400' : 'text-emerald-400'}>
            {hasError ? 'Error' : 'Output'}
          </SectionLabel>

          {hasError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 max-h-[300px] overflow-y-auto">
              <pre className="text-[11px] text-red-300 whitespace-pre-wrap font-mono leading-relaxed">{call.error}</pre>
            </div>
          )}

          {call.responseSummary && (
            <div>
              <div className="text-[10px] text-zinc-500 font-medium mb-1.5">Model response</div>
              <div className="surface-inset rounded-lg p-4 max-h-[400px] overflow-y-auto">
                <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">{call.responseSummary}</pre>
              </div>
            </div>
          )}

          {imageOutputs.length > 0 && (
            <div>
              <div className="text-[10px] text-zinc-500 font-medium mb-1.5">Generated images</div>
              <div className="flex gap-3 flex-wrap">
                {imageOutputs.map((a, i) => (
                  <ImageThumb key={i} url={a.url!} label={a.category} size="md" />
                ))}
              </div>
            </div>
          )}

          {videoOutputs.length > 0 && (
            <div>
              <div className="text-[10px] text-zinc-500 font-medium mb-1.5">Generated video</div>
              <div className="flex gap-3 flex-wrap">
                {videoOutputs.map((a, i) => (
                  <video key={i} src={a.url} className="w-48 h-28 object-cover rounded-lg border border-white/[0.08] bg-obsidian-800" controls muted />
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2 border-t border-white/[0.06]">
            <span className="text-[10px] font-mono bg-obsidian-800 border border-white/[0.06] text-zinc-500 px-2 py-1 rounded-md">{call.model}</span>
            <span className="text-[10px] font-mono text-zinc-600">{(call.durationMs / 1000).toFixed(2)}s</span>
            <span className="text-[10px] font-mono text-zinc-600">${(call.costEstimate || 0).toFixed(4)}</span>
            <span className="text-[10px] font-mono text-zinc-700 ml-auto">{new Date(call.createdAt).toLocaleTimeString()}</span>
          </div>
        </div>
      )}

      <div className="h-px bg-white/[0.04]" />
    </div>
  );
};

// ─── Main panel ──────────────────────────────────────────────────────

export const XRayPanel: React.FC<Props> = ({ projectId, isOpen, onClose }) => {
  const [calls, setCalls] = useState<XRayEntry[]>([]);
  const [currentContext, setCurrentContext] = useState<XRayContext>({});
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await api.getXRayCalls(projectId);
      setCalls(data.calls || []);
      setCurrentContext(data.currentContext || {});
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (isOpen) refresh();
  }, [isOpen, refresh]);

  if (!isOpen) return null;

  const filteredCalls = filter === 'all'
    ? calls
    : filter === 'errors'
      ? calls.filter(c => c.error)
      : calls.filter(c => c.stage.startsWith(filter));

  const totalCost = calls.reduce((sum, c) => sum + (c.costEstimate || 0), 0);
  const totalDuration = calls.reduce((sum, c) => sum + (c.durationMs || 0), 0);
  const errorCount = calls.filter(c => c.error).length;
  const hasCurrentContext = Object.values(currentContext).some(v => v !== undefined && (Array.isArray(v) ? v.length > 0 : true));

  return (
    <div className="fixed inset-0 z-[100] flex">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        className="relative ml-auto w-full max-w-3xl bg-obsidian-950 border-l border-white/[0.08] shadow-2xl flex flex-col h-full"
      >
        {/* Header */}
        <div className="flex-shrink-0 p-5 border-b border-white/[0.06]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                <span className="text-white font-bold text-sm font-mono">X</span>
              </div>
              <div>
                <h2 className="text-sm font-display font-medium text-white">X-Ray</h2>
                <p className="text-[11px] text-zinc-600">Every AI call, fully transparent</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={refresh}
                disabled={loading}
                className="text-[11px] text-zinc-500 hover:text-white border border-white/[0.08] hover:border-white/20 px-3 py-1.5 rounded-md transition-all"
              >
                {loading ? 'Loading...' : 'Refresh'}
              </button>
              <button onClick={onClose} className="text-zinc-600 hover:text-white w-8 h-8 rounded-md hover:bg-white/[0.06] flex items-center justify-center transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-2 mb-4">
            <div className="surface rounded-lg px-3 py-1.5">
              <div className="text-[10px] text-zinc-600 uppercase tracking-wide">Calls</div>
              <div className="text-sm text-white font-mono font-medium">{calls.length}</div>
            </div>
            <div className="surface rounded-lg px-3 py-1.5">
              <div className="text-[10px] text-zinc-600 uppercase tracking-wide">Cost</div>
              <div className="text-sm text-white font-mono font-medium">${totalCost.toFixed(2)}</div>
            </div>
            <div className="surface rounded-lg px-3 py-1.5">
              <div className="text-[10px] text-zinc-600 uppercase tracking-wide">Time</div>
              <div className="text-sm text-white font-mono font-medium">{(totalDuration / 1000).toFixed(0)}s</div>
            </div>
            {errorCount > 0 && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5">
                <div className="text-[10px] text-red-400/60 uppercase tracking-wide">Errors</div>
                <div className="text-sm text-red-400 font-mono font-medium">{errorCount}</div>
              </div>
            )}
          </div>

          {/* Current rolling context */}
          {hasCurrentContext && (
            <div className="mb-4 p-3 bg-violet-500/[0.04] border border-violet-500/10 rounded-xl">
              <div className="text-[10px] text-violet-400/70 uppercase tracking-wide font-medium mb-2">Current Rolling Context</div>
              <div className="space-y-1">
                {currentContext.lockedConcept && <ContextPill label="Concept" value={currentContext.lockedConcept} />}
                {currentContext.lockedStyle && <ContextPill label="Style" value={currentContext.lockedStyle} />}
                {currentContext.videoMode && <ContextPill label="Mode" value={currentContext.videoMode} />}
                {currentContext.lockedCharacters?.map((c, i) => <ContextPill key={i} label="Cast" value={c} />)}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex gap-1.5 flex-wrap">
            {[
              { key: 'all', label: 'All' },
              { key: 'errors', label: 'Errors' },
              { key: 'transcribe-lyrics', label: 'Lyrics' },
              { key: 'detect-structure', label: 'Structure' },
              { key: 'summarize-meaning', label: 'Meaning' },
              { key: 'generate-concepts', label: 'Concepts' },
              { key: 'generate-styles', label: 'Styles' },
              { key: 'generate-looks', label: 'Looks' },
              { key: 'generate-script', label: 'Script' },
              { key: 'generate-shot-image', label: 'Shot Img' },
              { key: 'generate-shot-video', label: 'Shot Vid' },
              { key: 'chat', label: 'Chat' },
            ].map(f => {
              const count = f.key === 'all' ? calls.length
                : f.key === 'errors' ? errorCount
                : calls.filter(c => c.stage.startsWith(f.key)).length;
              if (f.key !== 'all' && f.key !== 'errors' && count === 0) return null;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`text-[11px] px-2.5 py-1 rounded-md border transition-all ${
                    filter === f.key
                      ? 'bg-white/[0.08] border-white/20 text-white font-medium'
                      : 'border-transparent text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.04]'
                  }`}
                >
                  {f.label}{count > 0 ? ` (${count})` : ''}
                </button>
              );
            })}
          </div>
        </div>

        {/* Call list */}
        <div className="flex-1 overflow-y-auto">
          {filteredCalls.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-zinc-700">
              <div className="text-2xl mb-3 opacity-40">~</div>
              <div className="text-sm">
                {calls.length === 0
                  ? 'No AI calls yet. Run a generation to see the trace.'
                  : 'No calls match this filter.'}
              </div>
            </div>
          )}

          {filteredCalls.map((call) => (
            <CallCard
              key={call.id}
              call={call}
              isExpanded={expandedId === call.id}
              onToggle={() => setExpandedId(expandedId === call.id ? null : call.id)}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
};
