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
  audioPlanStale: boolean;
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
  // Shot IDs whose audio_plan is being rewritten right now (per T5.7
  // "Rewrite" action). Driven by writeAudioPlan with force=true.
  const [rewritingShotIds, setRewritingShotIds] = useState<Set<string>>(new Set());
  // Shot IDs whose dialogueStrategy is being toggled. Locks the picker
  // briefly so double-clicks don't fire two PATCH calls.
  const [updatingStrategyShotIds, setUpdatingStrategyShotIds] = useState<Set<string>>(new Set());

  // Cast voice lookup. Computed once per project; used to filter "available"
  // lines for bulk/per-shot generation and to badge no-voice rows.
  const castHasVoice = useMemo(() => {
    const map = new Map<string, boolean>();
    project.cast.forEach(c => map.set(c.id, !!c.voiceId));
    return map;
  }, [project.cast]);

  // Cast look-reference lookup. T5.6: lipsync requires every dialogue speaker
  // in a shot to have a locked look reference (per D3). Used to gate the
  // strategy picker's lipsync option client-side; backend enforces too.
  const castHasLook = useMemo(() => {
    const map = new Map<string, boolean>();
    project.cast.forEach(c => map.set(c.id, !!c.referenceImageUrl));
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
            audioPlanStale: !!shot.audioPlanStale,
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
    const map = new Map<string, { sceneLabel: string; shotIndex: number; dialogueStrategy: 'lipsync' | 'overlay'; audioPlanStale: boolean; lines: EnrichedLine[] }>();
    allLines.forEach(line => {
      let bucket = map.get(line.shotId);
      if (!bucket) {
        bucket = {
          sceneLabel: line.sceneLabel,
          shotIndex: line.shotIndex,
          dialogueStrategy: line.dialogueStrategy,
          audioPlanStale: line.audioPlanStale,
          lines: [],
        };
        map.set(line.shotId, bucket);
      }
      bucket.lines.push(line);
    });
    return Array.from(map.entries());
  }, [allLines]);

  // Shot IDs whose audio_plan is stale. T5.7 surfaces this as an amber chip
  // on the shot header and a "Rewrite" action. Per ledger T3.10 + the
  // 2026-05-19 checkpoint clarification, in-place script edits flip this
  // flag without dropping dialogue; a full script regenerate replaces
  // topology and these shot IDs disappear with the old shots.
  const staleShotIds = useMemo(
    () => linesByShot.filter(([, b]) => b.audioPlanStale).map(([id]) => id),
    [linesByShot],
  );

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

  // T5.6: per-shot dialogueStrategy override. Backend validates that
  // lipsync requires every dialogue speaker to have a locked look
  // reference; UI also gates the lipsync option to match. If the backend
  // returns lipsync_requires_look_reference (race / stale cast state),
  // ApiError flows through showActionError with the structured message.
  const setShotStrategy = async (shotId: string, dialogueStrategy: 'lipsync' | 'overlay') => {
    setUpdatingStrategyShotIds(prev => new Set(prev).add(shotId));
    try {
      const resp = await api.updateShotAudioPlan(project.id, shotId, { dialogueStrategy });
      // Backend returns the full project directly on this endpoint.
      const updated = resp?.id ? resp : resp?.project || resp?.data?.project;
      if (updated?.id) onSetProject?.(updated);
    } catch (err) {
      showActionError(err);
    } finally {
      setUpdatingStrategyShotIds(prev => {
        const next = new Set(prev);
        next.delete(shotId);
        return next;
      });
    }
  };

  // Rewrite a stale audio plan in place (script changed, dialogue still
  // attached but possibly outdated). Calls writeAudioPlan with force=true
  // so the backend skips its "only stale or empty" filter and regenerates
  // the requested shot specifically. Per-line Regen during TTS gen is a
  // different code path — that lives on the DialogueRow.
  const rewriteStaleShot = async (shotId: string) => {
    setRewritingShotIds(prev => new Set(prev).add(shotId));
    try {
      const resp = await api.writeAudioPlan(project.id, { shotIds: [shotId], force: true });
      const updated = resp?.project || resp?.data?.project || (resp?.id ? resp : null);
      if (updated?.id) onSetProject?.(updated);
    } catch (err) {
      showActionError(err);
    } finally {
      setRewritingShotIds(prev => {
        const next = new Set(prev);
        next.delete(shotId);
        return next;
      });
    }
  };

  // Compute skipped voices for an arbitrary set of candidate lines. The
  // modal needs to describe the EXACT run — a per-shot trigger must not
  // mention waiting-voice lines from other shots. See Codex P2.
  const rollupSkipped = useCallback((candidates: EnrichedLine[]) => {
    const skipped = new Map<string, { characterId: string; name: string; lineCount: number }>();
    candidates.forEach(line => {
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
  }, [castHasVoice, project.cast]);

  // Bulk + per-shot triggers route through the cost-preview modal (D14). The
  // modal does the cost fetch, lists skipped voices, and only then fires the
  // actual generation. Per-line Regen stays direct — single small call.
  // Skipped-voices is baked into the run scope so the modal describes
  // exactly this batch, not the whole project (Codex P2).
  const openBulkRun = () => {
    const ids = allLines.filter(lineIsAvailable).map(l => l.id);
    if (ids.length === 0) return;
    setPendingRun({
      dialogueIds: ids,
      scopeLabel: `All available · ${ids.length} line${ids.length === 1 ? '' : 's'}`,
      skippedVoices: rollupSkipped(allLines),
    });
  };

  const openShotRun = (shotIndex: number, sceneLabel: string, ids: string[], shotLines: EnrichedLine[]) => {
    if (ids.length === 0) return;
    setPendingRun({
      dialogueIds: ids,
      scopeLabel: `Shot S${shotIndex} · ${sceneLabel}`,
      skippedVoices: rollupSkipped(shotLines),
    });
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
            {staleShotIds.length > 0 && <> · <span className="text-amber-300/80">{staleShotIds.length} stale shot{staleShotIds.length === 1 ? '' : 's'}</span></>}
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
            // T5.6: lipsync requires every speaker in the shot to have a
            // locked look reference (D3). Surface the blockers so the
            // tooltip names exactly which characters need looks.
            const noLookSpeakers = Array.from(new Set(
              bucket.lines
                .filter(l => castHasLook.get(l.characterId) !== true)
                .map(l => characterName(l.characterId))
            ));
            const canLipsync = noLookSpeakers.length === 0;
            // Lipsync needs TTS baked into the video. Warn if any line
            // doesn't have a successful asset yet.
            const lipsyncTtsMissing = bucket.dialogueStrategy === 'lipsync'
              && bucket.lines.some(l => l.ttsStatus !== 'success');
            return (
              <div key={shotId} className="surface rounded-xl">
                <div className="px-5 py-3 flex items-center gap-3 border-b border-white/[0.06]">
                  <span className="text-xs font-mono text-zinc-500">S{bucket.shotIndex}</span>
                  <span className="text-sm text-zinc-300">{bucket.sceneLabel}</span>
                  <StrategyPicker
                    strategy={bucket.dialogueStrategy}
                    canLipsync={canLipsync}
                    noLookSpeakers={noLookSpeakers}
                    updating={updatingStrategyShotIds.has(shotId)}
                    onChange={(next) => setShotStrategy(shotId, next)}
                  />
                  {lipsyncTtsMissing && (
                    <span
                      className="text-[10px] uppercase tracking-wider text-amber-300/90 bg-amber-500/[0.08] rounded px-1.5 py-0.5"
                      title="Lipsync bakes TTS audio into the video. Generate TTS for every line before running video gen."
                    >
                      tts needed
                    </span>
                  )}
                  {bucket.audioPlanStale && (
                    <span
                      className="text-[10px] uppercase tracking-wider text-amber-300/90 bg-amber-500/[0.08] rounded px-1.5 py-0.5"
                      title="The script was edited after this audio plan was written. Rewrite to refresh dialogue."
                    >
                      stale
                    </span>
                  )}
                  <span className="text-[10px] text-zinc-500">{bucket.lines.length} line{bucket.lines.length === 1 ? '' : 's'}</span>
                  <div className="flex-1" />
                  {bucket.audioPlanStale && (
                    <button
                      onClick={() => rewriteStaleShot(shotId)}
                      disabled={rewritingShotIds.has(shotId) || isLoading}
                      className="text-[11px] text-amber-200/90 hover:text-white surface-inset rounded-md px-2.5 py-1 hover:bg-amber-500/[0.08] transition-colors disabled:opacity-30 inline-flex items-center gap-1.5"
                    >
                      {rewritingShotIds.has(shotId) && (
                        <span className="w-2.5 h-2.5 border-2 border-amber-400/40 border-t-amber-200 rounded-full animate-spin" />
                      )}
                      {rewritingShotIds.has(shotId) ? 'Rewriting…' : 'Rewrite'}
                    </button>
                  )}
                  {shotAvailable.length > 0 && (
                    <button
                      onClick={() => openShotRun(bucket.shotIndex, bucket.sceneLabel, shotAvailable, bucket.lines)}
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
        alreadyReadyCount={summary.ready}
        onClose={() => setPendingRun(null)}
        onConfirm={() => pendingRun ? generateForLines(pendingRun.dialogueIds) : undefined}
        onGoToCharacters={() => onSetViewPhase('characters')}
      />
    </motion.div>
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────

// T5.6: inline two-segment toggle. Active segment is the current strategy
// (white/black). Lipsync segment is disabled with an explanatory tooltip
// when any dialogue speaker in the shot lacks a locked look reference (D3).
// Overlay is always selectable. Click fires a PATCH to the audio-plan
// strategy endpoint via setShotStrategy.
interface StrategyPickerProps {
  strategy: 'lipsync' | 'overlay';
  canLipsync: boolean;
  noLookSpeakers: string[];
  updating: boolean;
  onChange: (next: 'lipsync' | 'overlay') => void;
}

const StrategyPicker: React.FC<StrategyPickerProps> = ({ strategy, canLipsync, noLookSpeakers, updating, onChange }) => {
  const lipsyncTitle = canLipsync
    ? 'TTS audio passed to Seedance; video renders with lipsync. Requires every speaker to have a locked look.'
    : `Needs a locked look reference for: ${noLookSpeakers.join(', ')}`;
  const overlayTitle = 'Video stays silent; TTS overlaid at render time. Use for narrators or off-screen voices.';
  const segBase = 'text-[10px] uppercase tracking-wider px-1.5 py-0.5 transition-colors';

  return (
    <div className="surface-inset rounded inline-flex items-center text-[10px] overflow-hidden" role="group" aria-label="Dialogue strategy">
      <button
        onClick={() => !updating && canLipsync && strategy !== 'lipsync' && onChange('lipsync')}
        disabled={updating || !canLipsync}
        title={lipsyncTitle}
        aria-pressed={strategy === 'lipsync'}
        className={`${segBase} ${
          strategy === 'lipsync'
            ? 'bg-blue-500/[0.15] text-blue-200'
            : canLipsync
              ? 'text-zinc-400 hover:text-white hover:bg-white/[0.05]'
              : 'text-zinc-600 cursor-not-allowed'
        }`}
      >
        lipsync
      </button>
      <button
        onClick={() => !updating && strategy !== 'overlay' && onChange('overlay')}
        disabled={updating}
        title={overlayTitle}
        aria-pressed={strategy === 'overlay'}
        className={`${segBase} ${
          strategy === 'overlay'
            ? 'bg-white/[0.1] text-zinc-100'
            : 'text-zinc-400 hover:text-white hover:bg-white/[0.05]'
        }`}
      >
        overlay
      </button>
      {updating && <span className="w-2.5 h-2.5 mx-1.5 border-2 border-zinc-600 border-t-zinc-200 rounded-full animate-spin" />}
    </div>
  );
};

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
