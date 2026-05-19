import React, { useEffect, useState } from 'react';
import * as api from '../services/api';

// Cost preview + explicit confirm before any bulk TTS generation, per D14.
// The modal works on the AVAILABLE subset (voice-IDs-set, pending/error) per
// T5.4a — missing voices appear as a list of skipped tasks with a link to
// Characters, never as a blocker on the run.

export type TtsRunScope = {
  /** Dialogue line IDs that will be generated. Pre-filtered to "available"
   *  (cast has voice + pending/error). */
  dialogueIds: string[];
  /** Human-readable label for the run, e.g. "all available" or "shot S3". */
  scopeLabel: string;
};

interface SkippedVoice {
  characterId: string;
  name: string;
  lineCount: number;
}

interface Props {
  open: boolean;
  scope: TtsRunScope | null;
  projectId: string;
  /** Cast members whose lines are intentionally skipped (no voice assigned).
   *  Passed in so the modal doesn't need to re-derive scope from project. */
  skippedVoices: SkippedVoice[];
  /** Already-generated count for context ("12 of 30 lines already ready"). */
  alreadyReadyCount: number;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  onGoToCharacters: () => void;
}

export const TtsGenerateModal: React.FC<Props> = ({
  open, scope, projectId, skippedVoices, alreadyReadyCount, onClose, onConfirm, onGoToCharacters,
}) => {
  const [cost, setCost] = useState<{ totalChars: number; estimatedUsd: number; pendingLines: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Fetch fresh cost preview when modal opens for a given scope.
  useEffect(() => {
    if (!open || !scope || scope.dialogueIds.length === 0) {
      setCost(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.getAudioPlanCost(projectId, { dialogueIds: scope.dialogueIds })
      .then(resp => {
        if (cancelled) return;
        const data = resp?.data || resp;
        if (data && typeof data.estimatedUsd === 'number') {
          setCost({
            totalChars: data.totalChars || 0,
            estimatedUsd: data.estimatedUsd,
            pendingLines: data.pendingLines || scope.dialogueIds.length,
          });
        }
      })
      .catch(() => {
        // Cost route unavailable — surface "—" rather than blocking.
        if (!cancelled) setCost(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, scope, projectId]);

  // Reset submit state on close.
  useEffect(() => {
    if (!open) setSubmitting(false);
  }, [open]);

  if (!open || !scope) return null;

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const nothingToRun = scope.dialogueIds.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md surface-raised rounded-xl p-6">
        <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400 mb-2">Generate dialogue audio</p>
        <h3 className="text-lg font-display text-white tracking-tight mb-1">
          {scope.scopeLabel}
        </h3>
        <p className="text-xs text-zinc-400 mb-5 leading-relaxed">
          Charges your ElevenLabs key for each line generated. Already-ready lines won't be re-billed.
        </p>

        {/* Run breakdown */}
        <div className="surface-inset rounded-md p-4 space-y-2.5 mb-4">
          <Row label="Lines to generate" value={String(scope.dialogueIds.length)} accent={nothingToRun ? 'zinc' : 'white'} />
          <Row
            label="Characters"
            value={loading ? '…' : cost ? `${cost.totalChars.toLocaleString()}` : '—'}
          />
          <Row
            label="Estimated cost"
            value={loading ? '…' : cost ? `$${cost.estimatedUsd.toFixed(2)}` : '—'}
            accent="emerald"
            mono
          />
          {alreadyReadyCount > 0 && (
            <Row label="Already ready" value={`${alreadyReadyCount} line${alreadyReadyCount === 1 ? '' : 's'}`} accent="zinc" />
          )}
        </div>

        {/* Skipped voices nudge */}
        {skippedVoices.length > 0 && (
          <div className="mb-4 px-3 py-2.5 surface-inset rounded-md border-l-2 border-amber-400/50">
            <p className="text-[11px] text-amber-200/90 mb-1.5">
              Skipping {skippedVoices.reduce((acc, v) => acc + v.lineCount, 0)} line{skippedVoices.reduce((acc, v) => acc + v.lineCount, 0) === 1 ? '' : 's'} waiting on voices:
            </p>
            <ul className="text-[11px] text-zinc-300 space-y-0.5 ml-1">
              {skippedVoices.map(v => (
                <li key={v.characterId}>
                  · {v.name} <span className="text-zinc-500">({v.lineCount} line{v.lineCount === 1 ? '' : 's'})</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => { onClose(); onGoToCharacters(); }}
              className="text-[11px] text-zinc-400 hover:text-white transition-colors mt-2"
            >
              Assign voices →
            </button>
          </div>
        )}

        <p className="text-[10px] text-zinc-500 leading-relaxed mb-4">
          Pricing: ElevenLabs Multilingual v2 ($0.30 per 1,000 characters). Daily cap is $20 per user.
        </p>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting || nothingToRun}
            className="px-4 py-2 bg-white text-black rounded-md text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
          >
            {submitting && <span className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />}
            {submitting ? 'Generating…' : nothingToRun ? 'Nothing to generate' : `Generate ${scope.dialogueIds.length}`}
          </button>
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; accent?: 'white' | 'emerald' | 'zinc'; mono?: boolean }> = ({ label, value, accent = 'white', mono }) => {
  const color = accent === 'emerald' ? 'text-emerald-300' : accent === 'zinc' ? 'text-zinc-400' : 'text-zinc-200';
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className={`${color} ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
};
