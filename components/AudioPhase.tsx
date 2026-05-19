import React, { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ApiProject, DialogueLine, TtsStatus, VideoShot, VideoScene } from '../types';
import * as api from '../services/api';
import { Phase } from './BlueprintContextBar';
import { TtsGenerateModal, TtsRunScope } from './TtsGenerateModal';

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

// "Available" means a line is generatable right now — pending/error AND the
// speaking cast member has a voice ID. The harness skips the rest as visible
// tasks (linked to Characters) rather than blocking the whole batch.
const isPendingStatus = (s: TtsStatus) => s === 'pending' || s === 'error';

export const AudioPhase: React.FC<Props> = ({
  project, isLoading, phaseTransition, onSetProject, onSetViewPhase, showActionError,
}) => {
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  // Modal-driven cost preview + confirm gate for bulk and per-shot runs.
  // Per-line Regen stays direct (single small call, no confirmation needed).
  const [pendingRun, setPendingRun] = useState<TtsRunScope | null>(null);

  // Cast voice lookup. Computed once per project; used to filter "available"
  // lines for bulk/per-shot generation and to badge no-voice rows.
  const castHasVoice = useMemo(() => {
    const map = new Map<string, boolean>();
    project.cast.forEach(c => map.set(c.id, !!c.voiceId));
    return map;
  }, [project.cast]);

  const lineIsAvailable = useCallback((line: { characterId: string; ttsStatus: TtsStatus }) =>
    isPendingStatus(line.ttsStatus) && castHasVoice.get(line.characterId) === true, [castHasVoice]);

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

  // ── Top-line counts (kept compact — one inline summary, not a stats grid) ──
  const summary = useMemo(() => {
    const ready = allLines.filter(l => l.ttsStatus === 'success').length;
    const available = allLines.filter(lineIsAvailable).length;
    const waitingOnVoice = allLines.filter(l =>
      isPendingStatus(l.ttsStatus) && castHasVoice.get(l.characterId) !== true
    ).length;
    const missingVoiceMembers = project.cast.filter(c =>
      !c.voiceId && allLines.some(l => l.characterId === c.id)
    );
    return { total: allLines.length, ready, available, waitingOnVoice, missingVoiceMembers };
  }, [allLines, project.cast, castHasVoice, lineIsAvailable]);

  // ── Group by shot for rendering ──
  const linesByShot = useMemo(() => {
    const map = new Map<string, { sceneLabel: string; shotIndex: number; dialogueStrategy: 'lipsync' | 'overlay'; lines: EnrichedLine[] }>();
    allLines.forEach(line => {
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
  }, [allLines]);

  // ── Actions ──
  // Generation always targets the subset the engine can actually process now.
  // Missing voices stay visible as nudges; they don't block ready lines.
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

  // Bulk + per-shot triggers route through the cost-preview modal (D14). The
  // modal does the cost fetch, lists skipped voices, and only then fires the
  // actual generation. Per-line Regen stays direct — single small call.
  const openBulkRun = () => {
    const ids = allLines.filter(lineIsAvailable).map(l => l.id);
    if (ids.length === 0) return;
    setPendingRun({ dialogueIds: ids, scopeLabel: `All available · ${ids.length} line${ids.length === 1 ? '' : 's'}` });
  };

  const openShotRun = (shotIndex: number, sceneLabel: string, ids: string[]) => {
    if (ids.length === 0) return;
    setPendingRun({ dialogueIds: ids, scopeLabel: `Shot S${shotIndex} · ${sceneLabel}` });
  };

  // Project-level skipped-voice rollup: characters with unassigned voices,
  // plus the count of waiting-on-voice lines per character. Surfaced inside
  // the modal as a nudge — "these will be skipped this run."
  const skippedVoiceRollup = useMemo(() => {
    const skipped = new Map<string, { characterId: string; name: string; lineCount: number }>();
    allLines.forEach(line => {
      if (!isPendingStatus(line.ttsStatus)) return;
      if (castHasVoice.get(line.characterId) === true) return;
      const existing = skipped.get(line.characterId);
      if (existing) {
        existing.lineCount += 1;
      } else {
        const member = project.cast.find(c => c.id === line.characterId);
        skipped.set(line.characterId, {
          characterId: line.characterId,
          name: member?.name || 'Unknown',
          lineCount: 1,
        });
      }
    });
    return [...skipped.values()];
  }, [allLines, castHasVoice, project.cast]);

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

  return (
    <motion.div key="audio" {...phaseTransition} className="space-y-4">
      {/* Header: compact one-line summary + bulk action.
          Generation always targets the AVAILABLE subset — UI is never stricter
          than the engine. Missing voices appear as a nudge below, not a gate. */}
      <div className="surface rounded-xl px-5 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-zinc-300">
            <span className="text-white font-medium">{summary.total}</span> line{summary.total === 1 ? '' : 's'}
            {summary.ready > 0 && <> · <span className="text-emerald-300/90">{summary.ready} ready</span></>}
            {summary.available > 0 && <> · <span className="text-zinc-200">{summary.available} available</span></>}
            {summary.waitingOnVoice > 0 && <> · <span className="text-amber-300/80">{summary.waitingOnVoice} waiting on voices</span></>}
          </p>
          <button
            onClick={openBulkRun}
            disabled={summary.available === 0 || generatingIds.size > 0 || isLoading}
            className="bg-white text-black px-4 py-2 rounded-md font-semibold text-xs hover:bg-zinc-200 disabled:opacity-30 transition-colors inline-flex items-center gap-2"
          >
            {generatingIds.size > 0 && <span className="w-3 h-3 border-2 border-zinc-500 border-t-black rounded-full animate-spin" />}
            {generatingIds.size > 0
              ? `Generating ${generatingIds.size}…`
              : summary.available > 0
                ? `Generate ${summary.available} available`
                : summary.waitingOnVoice > 0 ? 'Assign voices to enable' : 'Nothing to generate'}
          </button>
        </div>

        {summary.missingVoiceMembers.length > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-400">
            <span>
              {summary.missingVoiceMembers.map(c => c.name).join(', ')} {summary.missingVoiceMembers.length === 1 ? 'is' : 'are'} waiting on voice IDs — their lines will be skipped.
            </span>
            <button
              onClick={() => onSetViewPhase('characters')}
              className="text-zinc-300 hover:text-white transition-colors flex-shrink-0"
            >
              Assign voices →
            </button>
          </div>
        )}
      </div>

      {/* Dialogue by shot */}
      {linesByShot.length === 0 ? (
        <div className="surface rounded-xl p-8 text-center text-sm text-zinc-400">
          No dialogue lines.
        </div>
      ) : (
        <div className="space-y-3">
          {linesByShot.map(([shotId, bucket]) => {
            // Per-shot bulk targets only available lines in the shot.
            // Matches the harness invariant: never block one line because
            // another in the same shot is waiting on a voice.
            const shotAvailable = bucket.lines.filter(lineIsAvailable).map(l => l.id);
            return (
              <div key={shotId} className="surface rounded-xl">
                <div className="px-5 py-3 flex items-center gap-3 border-b border-white/[0.06]">
                  <span className="text-xs font-mono text-zinc-500">S{bucket.shotIndex}</span>
                  <span className="text-sm text-zinc-300">{bucket.sceneLabel}</span>
                  <StrategyPill strategy={bucket.dialogueStrategy} />
                  <span className="text-[10px] text-zinc-500">{bucket.lines.length} line{bucket.lines.length === 1 ? '' : 's'}</span>
                  <div className="flex-1" />
                  {shotAvailable.length > 0 && (
                    <button
                      onClick={() => openShotRun(bucket.shotIndex, bucket.sceneLabel, shotAvailable)}
                      disabled={generatingIds.size > 0 || isLoading}
                      className="text-[11px] text-zinc-300 hover:text-white surface-inset rounded-md px-2.5 py-1 hover:bg-white/[0.06] transition-colors disabled:opacity-30"
                    >
                      Generate {shotAvailable.length}
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
      <TtsGenerateModal
        open={!!pendingRun}
        scope={pendingRun}
        projectId={project.id}
        skippedVoices={skippedVoiceRollup}
        alreadyReadyCount={summary.ready}
        onClose={() => setPendingRun(null)}
        onConfirm={() => pendingRun ? generateForLines(pendingRun.dialogueIds) : undefined}
        onGoToCharacters={() => onSetViewPhase('characters')}
      />
    </motion.div>
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────

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
