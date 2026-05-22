import React, { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ApiProject, DialogueLine, DialogueVideoMode, TtsStatus, VideoShot, VideoScene } from '../types';
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
  audioPlanStale: boolean;
};

// "Available" means a line is generatable right now — pending/error AND the
// speaking cast member has a voice ID. The harness skips the rest as visible
// tasks (linked to Characters) rather than blocking the whole batch.
const isPendingStatus = (s: TtsStatus) => s === 'pending' || s === 'error';
const dialogueVideoMode = (project: ApiProject): DialogueVideoMode =>
  project.projectBrief?.dialogueVideoMode === 'lipsync' ? 'lipsync' : 'overlay';

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
  const mode = dialogueVideoMode(project);

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
    const map = new Map<string, { sceneLabel: string; shotIndex: number; audioPlanStale: boolean; lines: EnrichedLine[] }>();
    allLines.forEach(line => {
      let bucket = map.get(line.shotId);
      if (!bucket) {
        bucket = {
          sceneLabel: line.sceneLabel,
          shotIndex: line.shotIndex,
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

  const setProjectMode = async (nextMode: DialogueVideoMode) => {
    if (nextMode === mode || isLoading) return;
    try {
      await api.updateProject(project.id, {
        projectBrief: {
          ...(project.projectBrief || {}),
          dialogueVideoMode: nextMode,
        },
      });
      onSetProject?.({
        ...project,
        projectBrief: {
          ...(project.projectBrief || {}),
          dialogueVideoMode: nextMode,
        },
      });
    } catch (err) {
      showActionError(err);
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
      {/* Header: compact one-line summary + actions.
          Generation always targets the AVAILABLE subset — UI is never stricter
          than the engine. */}
      <div className="surface rounded-xl px-5 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-zinc-300">
            <span className="text-white font-medium">{summary.total}</span> line{summary.total === 1 ? '' : 's'}
            {summary.ready > 0 && <> · <span className="text-emerald-300/90">{summary.ready} ready</span></>}
            {summary.available > 0 && <> · <span className="text-zinc-200">{summary.available} available</span></>}
            {summary.waitingOnVoice > 0 && <> · <span className="text-amber-300/80">{summary.waitingOnVoice} waiting on voices</span></>}
            {staleShotIds.length > 0 && <> · <span className="text-amber-300/80">{staleShotIds.length} stale shot{staleShotIds.length === 1 ? '' : 's'}</span></>}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {summary.missingVoiceMembers.length > 0 && (
              <button
                onClick={() => onSetViewPhase('characters')}
                className="surface-inset text-zinc-200 px-3.5 py-2 rounded-md font-semibold text-xs hover:bg-white/[0.08] transition-colors"
              >
                Assign voices
              </button>
            )}
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
                  : 'Generate audio'}
            </button>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-white/[0.06] flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Dialogue video mode</div>
            <p className="mt-1 text-xs text-zinc-400">
              {mode === 'lipsync'
                ? 'TTS is passed into video generation for baked lip-sync.'
                : 'Video is prompted to perform the dialogue; generated TTS is overlaid in the render.'}
            </p>
          </div>
          <div className="surface-inset rounded-lg inline-flex overflow-hidden text-xs" role="group" aria-label="Dialogue video mode">
            <button
              onClick={() => setProjectMode('lipsync')}
              disabled={isLoading}
              aria-pressed={mode === 'lipsync'}
              title="Pass generated TTS into Seedance during video generation. Requires successful TTS for every line in the shot."
              className={`px-3 py-2 transition-colors disabled:opacity-40 ${
                mode === 'lipsync'
                  ? 'bg-blue-500/[0.15] text-blue-100'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              Lipsync
            </button>
            <button
              onClick={() => setProjectMode('overlay')}
              disabled={isLoading}
              aria-pressed={mode === 'overlay'}
              title="Prompt the video model to perform dialogue natively, then mix generated TTS into the final render."
              className={`px-3 py-2 transition-colors disabled:opacity-40 ${
                mode === 'overlay'
                  ? 'bg-white/[0.10] text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              Overlay
            </button>
          </div>
        </div>
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
            const lipsyncTtsMissing = mode === 'lipsync'
              && bucket.lines.some(l => l.ttsStatus !== 'success');
            return (
              <div key={shotId} className="surface rounded-xl">
                <div className="px-5 py-3 flex items-center gap-3 border-b border-white/[0.06]">
                  <span className="text-xs font-mono text-zinc-500">S{bucket.shotIndex}</span>
                  <span className="text-sm text-zinc-300">{bucket.sceneLabel}</span>
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
        {line.ttsError && status === 'error' && (
          <div className="text-[11px] text-red-400">{line.ttsError}</div>
        )}
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
