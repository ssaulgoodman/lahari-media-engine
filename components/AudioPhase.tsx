import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ApiProject, DialogueLine, TtsStatus, VideoShot, VideoScene } from '../types';
import * as api from '../services/api';
import { Phase } from './BlueprintContextBar';
import { Dropdown } from './Dropdown';

interface Props {
  project: ApiProject;
  isLoading: boolean;
  phaseTransition: Record<string, any>;
  onSetProject?: (project: ApiProject) => void;
  onSetViewPhase: (phase: Phase) => void;
  showActionError: (input: string | unknown) => void;
}

// A dialogue line plus the shot/scene context needed to render and filter it.
type EnrichedLine = DialogueLine & {
  shotId: string;
  shotIndex: number;
  sceneId: string;
  sceneLabel: string;
  dialogueStrategy: 'lipsync' | 'overlay';
};

const STATUS_FILTERS: { value: TtsStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'success', label: 'Ready' },
  { value: 'error', label: 'Errored' },
];

export const AudioPhase: React.FC<Props> = ({
  project, isLoading, phaseTransition, onSetProject, onSetViewPhase, showActionError,
}) => {
  const [characterFilter, setCharacterFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<TtsStatus | 'all'>('all');
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [costEstimate, setCostEstimate] = useState<{ totalChars: number; estimatedUsd: number; pendingLines: number } | null>(null);

  // ── Flatten dialogue across all shots with scene context ──
  const allLines: EnrichedLine[] = useMemo(() => {
    const out: EnrichedLine[] = [];
    project.scenes.forEach((scene: VideoScene) => {
      scene.shots.forEach((shot: VideoShot, idx) => {
        const plan = shot.audioPlan;
        if (!plan) return;
        [...plan.dialogue].sort((a, b) => a.order - b.order).forEach(line => {
          out.push({
            ...line,
            shotId: shot.id,
            shotIndex: idx + 1,
            sceneId: scene.id,
            sceneLabel: scene.sectionLabel || 'Scene',
            dialogueStrategy: plan.dialogueStrategy,
          });
        });
      });
    });
    return out;
  }, [project.scenes]);

  // ── Stats ──
  const stats = useMemo(() => {
    const total = allLines.length;
    const ready = allLines.filter(l => l.ttsStatus === 'success').length;
    const pending = allLines.filter(l => l.ttsStatus === 'pending').length;
    const errored = allLines.filter(l => l.ttsStatus === 'error').length;
    const missingVoices = project.cast.filter(c =>
      allLines.some(l => l.characterId === c.id) && !c.voiceId
    );
    return { total, ready, pending, errored, missingVoices };
  }, [allLines, project.cast]);

  // ── Filter ──
  const filteredLines = useMemo(() => {
    return allLines.filter(line => {
      if (characterFilter !== 'all' && line.characterId !== characterFilter) return false;
      if (statusFilter !== 'all' && line.ttsStatus !== statusFilter) return false;
      return true;
    });
  }, [allLines, characterFilter, statusFilter]);

  // ── Group by shot for rendering ──
  const linesByShot = useMemo(() => {
    const map = new Map<string, { sceneLabel: string; shotIndex: number; dialogueStrategy: 'lipsync' | 'overlay'; lines: EnrichedLine[] }>();
    filteredLines.forEach(line => {
      let bucket = map.get(line.shotId);
      if (!bucket) {
        bucket = {
          sceneLabel: line.sceneLabel,
          shotIndex: line.shotIndex,
          dialogueStrategy: line.dialogueStrategy,
          lines: [],
        };
        map.set(line.shotId, bucket);
      }
      bucket.lines.push(line);
    });
    return Array.from(map.entries());
  }, [filteredLines]);

  // ── Cost preview for pending lines ──
  useEffect(() => {
    const pendingLines = allLines.filter(l => l.ttsStatus === 'pending' || l.ttsStatus === 'error');
    if (pendingLines.length === 0) {
      setCostEstimate(null);
      return;
    }
    let cancelled = false;
    api.getAudioPlanCost(project.id, { dialogueIds: pendingLines.map(l => l.id) })
      .then(resp => {
        if (cancelled) return;
        // Backend may return either { data: {...} } or {...} shape; tolerate both.
        const data = resp?.data || resp;
        if (data && typeof data.estimatedUsd === 'number') {
          setCostEstimate({
            totalChars: data.totalChars || 0,
            estimatedUsd: data.estimatedUsd,
            pendingLines: data.pendingLines || pendingLines.length,
          });
        }
      })
      .catch(() => {
        // Cost endpoint may not be live yet (T3.6). Fall back to a local
        // estimate so the UI still shows something useful.
        if (cancelled) return;
        const totalChars = pendingLines.reduce((acc, l) => acc + (l.text?.length || 0), 0);
        setCostEstimate({
          totalChars,
          estimatedUsd: (totalChars / 1000) * 0.30, // ElevenLabs Multilingual v2: $0.30/1k chars
          pendingLines: pendingLines.length,
        });
      });
    return () => { cancelled = true; };
  }, [project.id, allLines]);

  // ── Actions ──
  const generateForLines = async (dialogueIds: string[]) => {
    if (dialogueIds.length === 0) return;
    setGeneratingIds(prev => {
      const next = new Set(prev);
      dialogueIds.forEach(id => next.add(id));
      return next;
    });
    try {
      const resp = await api.generateDialogueAudio(project.id, { dialogueIds });
      const updated = resp?.project || resp?.data?.project || (resp?.id ? resp : null);
      if (updated?.id) onSetProject?.(updated);
    } catch (err) {
      showActionError(err);
    } finally {
      setGeneratingIds(prev => {
        const next = new Set(prev);
        dialogueIds.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  const generateAllPending = () => {
    const ids = allLines
      .filter(l => l.ttsStatus === 'pending' || l.ttsStatus === 'error')
      .map(l => l.id);
    generateForLines(ids);
  };

  const characterName = (id: string) =>
    project.cast.find(c => c.id === id)?.name || '?';

  // ── Empty states ──
  if (allLines.length === 0) {
    return (
      <motion.div key="audio" {...phaseTransition} className="space-y-6">
        <div className="surface rounded-xl p-12 text-center">
          <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400 mb-3">Audio</p>
          <h2 className="text-2xl font-display text-white mb-3 tracking-tight">No dialogue plans yet</h2>
          <p className="text-sm text-zinc-400 max-w-md mx-auto leading-relaxed mb-6">
            Audio production starts after dialogue is written per shot. Head back to the Script phase and use the
            "Write dialogue" button per shot, or "Write all dialogue" to bulk-process every shot at once.
          </p>
          <button
            onClick={() => onSetViewPhase('script')}
            className="bg-white text-black px-5 py-2 rounded-md font-semibold text-xs hover:bg-zinc-200 transition-colors inline-flex items-center gap-2"
          >
            Go to Script
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </motion.div>
    );
  }

  const pendingTotal = stats.pending + stats.errored;
  const hasMissingVoices = stats.missingVoices.length > 0;

  return (
    <motion.div key="audio" {...phaseTransition} className="space-y-5">
      {/* Header: stats + bulk gen */}
      <div className="surface rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-5 flex-wrap">
            <Stat label="Lines" value={stats.total} />
            <Stat label="Ready" value={stats.ready} accent={stats.ready > 0 ? 'emerald' : undefined} />
            <Stat label="Pending" value={stats.pending} accent={stats.pending > 0 ? 'amber' : undefined} />
            {stats.errored > 0 && <Stat label="Errored" value={stats.errored} accent="red" />}
            {costEstimate && pendingTotal > 0 && (
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Est. cost</span>
                <span className="text-base font-mono text-zinc-200">${costEstimate.estimatedUsd.toFixed(2)}</span>
                <span className="text-[10px] text-zinc-500">{costEstimate.totalChars.toLocaleString()} chars</span>
              </div>
            )}
          </div>
          <button
            onClick={generateAllPending}
            disabled={pendingTotal === 0 || hasMissingVoices || generatingIds.size > 0 || isLoading}
            title={hasMissingVoices ? `${stats.missingVoices.length} character(s) need a voice ID before generation` : undefined}
            className="bg-white text-black px-4 py-2 rounded-md font-semibold text-xs hover:bg-zinc-200 disabled:opacity-30 transition-colors inline-flex items-center gap-2"
          >
            {generatingIds.size > 0 && <span className="w-3 h-3 border-2 border-zinc-500 border-t-black rounded-full animate-spin" />}
            {generatingIds.size > 0 ? `Generating ${generatingIds.size}…` : `Generate ${pendingTotal} pending`}
          </button>
        </div>

        {hasMissingVoices && (
          <div className="mt-4 px-3 py-2 rounded-lg surface-inset border-l-2 border-amber-400/60 flex items-center justify-between gap-3">
            <span className="text-xs text-amber-200/90">
              {stats.missingVoices.map(c => c.name).join(', ')} {stats.missingVoices.length === 1 ? 'needs' : 'need'} a voice ID before generation.
            </span>
            <button
              onClick={() => onSetViewPhase('characters')}
              className="text-[11px] text-zinc-300 hover:text-white surface-inset rounded-md px-2.5 py-1 hover:bg-white/[0.06] transition-colors flex-shrink-0"
            >
              Assign voices →
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="surface rounded-xl p-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">Character</span>
          <Dropdown
            value={characterFilter}
            onChange={setCharacterFilter}
            size="xs"
            options={[
              { value: 'all', label: 'All' },
              ...project.cast.map(c => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500 mr-1">Status</span>
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
                statusFilter === f.value
                  ? 'bg-white text-black'
                  : 'surface-inset text-zinc-400 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {(characterFilter !== 'all' || statusFilter !== 'all') && (
          <button
            onClick={() => { setCharacterFilter('all'); setStatusFilter('all'); }}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors ml-auto"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Dialogue by shot */}
      {linesByShot.length === 0 ? (
        <div className="surface rounded-xl p-8 text-center text-sm text-zinc-400">
          No dialogue lines match the current filters.
        </div>
      ) : (
        <div className="space-y-3">
          {linesByShot.map(([shotId, bucket]) => {
            const shotPending = bucket.lines
              .filter(l => l.ttsStatus === 'pending' || l.ttsStatus === 'error')
              .map(l => l.id);
            return (
              <div key={shotId} className="surface rounded-xl">
                <div className="px-5 py-3 flex items-center gap-3 border-b border-white/[0.06]">
                  <span className="text-xs font-mono text-zinc-500">S{bucket.shotIndex}</span>
                  <span className="text-sm text-zinc-300">{bucket.sceneLabel}</span>
                  <StrategyPill strategy={bucket.dialogueStrategy} />
                  <span className="text-[10px] text-zinc-500">{bucket.lines.length} line{bucket.lines.length === 1 ? '' : 's'}</span>
                  <div className="flex-1" />
                  {shotPending.length > 0 && (
                    <button
                      onClick={() => generateForLines(shotPending)}
                      disabled={hasMissingVoices || generatingIds.size > 0 || isLoading}
                      className="text-[11px] text-zinc-300 hover:text-white surface-inset rounded-md px-2.5 py-1 hover:bg-white/[0.06] transition-colors disabled:opacity-30"
                    >
                      Generate shot
                    </button>
                  )}
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {bucket.lines.map(line => (
                    <DialogueRow
                      key={line.id}
                      line={line}
                      castName={characterName(line.characterId)}
                      castVoiceSet={!!project.cast.find(c => c.id === line.characterId)?.voiceId}
                      generating={generatingIds.has(line.id)}
                      onRegenerate={() => generateForLines([line.id])}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────

const Stat: React.FC<{ label: string; value: number; accent?: 'emerald' | 'amber' | 'red' }> = ({ label, value, accent }) => {
  const color = accent === 'emerald' ? 'text-emerald-300'
    : accent === 'amber' ? 'text-amber-300'
    : accent === 'red' ? 'text-red-300'
    : 'text-white';
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={`text-base font-mono ${color}`}>{value}</span>
    </div>
  );
};

const StrategyPill: React.FC<{ strategy: 'lipsync' | 'overlay' }> = ({ strategy }) => (
  <span className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 ${
    strategy === 'lipsync'
      ? 'text-blue-300/90 bg-blue-500/[0.08]'
      : 'text-zinc-400 bg-white/[0.04]'
  }`} title={strategy === 'lipsync' ? 'TTS audio passed to Seedance; video renders with lipsync.' : 'Video stays silent; TTS overlaid at render time.'}>
    {strategy}
  </span>
);

interface DialogueRowProps {
  line: EnrichedLine;
  castName: string;
  castVoiceSet: boolean;
  generating: boolean;
  onRegenerate: () => void;
}

const DialogueRow: React.FC<DialogueRowProps> = ({ line, castName, castVoiceSet, generating, onRegenerate }) => {
  const status: TtsStatus = generating ? 'generating' : line.ttsStatus;
  const canRegenerate = castVoiceSet && !generating && (status === 'pending' || status === 'success' || status === 'error');

  return (
    <div className="px-5 py-3 flex items-start gap-3">
      <span className="text-xs text-zinc-400 font-medium w-20 flex-shrink-0 truncate" title={castName}>{castName}</span>
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm text-zinc-200 italic leading-snug">"{line.text}"</p>
        <div className="flex items-center gap-3 flex-wrap text-[11px] text-zinc-500">
          {line.delivery && <span>{line.delivery}</span>}
          {line.paceHint && line.paceHint !== 'natural' && <span>· {line.paceHint}</span>}
          {line.ttsCharCount !== undefined && <span>· {line.ttsCharCount} chars</span>}
          {line.ttsDurationSec !== undefined && <span>· {line.ttsDurationSec.toFixed(1)}s</span>}
          {line.ttsError && status === 'error' && <span className="text-red-400">· {line.ttsError}</span>}
        </div>
        {line.ttsAssetUrl && status === 'success' && (
          <audio controls src={line.ttsAssetUrl} className="w-full max-w-md mt-2 h-8" preload="none" />
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <TtsStatusPill status={status} />
        {canRegenerate && (
          <button
            onClick={onRegenerate}
            disabled={generating}
            title={status === 'success' ? 'Regenerate TTS' : 'Generate TTS'}
            className="text-[10px] text-zinc-500 hover:text-zinc-200 surface-inset rounded-md px-2 py-1 hover:bg-white/[0.06] transition-colors disabled:opacity-30"
          >
            {status === 'success' ? 'Regen' : 'Gen'}
          </button>
        )}
        {!castVoiceSet && (
          <span className="text-[10px] uppercase tracking-wider text-amber-300/80 bg-amber-500/[0.08] rounded px-1 py-0.5">
            no voice
          </span>
        )}
      </div>
    </div>
  );
};

const TtsStatusPill: React.FC<{ status: TtsStatus }> = ({ status }) => {
  const config = {
    pending: { color: 'text-zinc-500 bg-white/[0.03]', label: 'pending' },
    generating: { color: 'text-blue-300/80 bg-blue-500/[0.08]', label: 'gen…' },
    success: { color: 'text-emerald-300/80 bg-emerald-500/[0.08]', label: 'ready' },
    error: { color: 'text-red-300/80 bg-red-500/[0.08]', label: 'error' },
  }[status];
  return (
    <span className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 ${config.color}`}>
      {config.label}
    </span>
  );
};
