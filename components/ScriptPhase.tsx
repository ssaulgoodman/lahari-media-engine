
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ApiProject, DialogueLine } from '../types';
import * as api from '../services/api';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { Dropdown } from './Dropdown';
import { UnlockPill } from './UnlockPill';
import { AssetShelf } from './AssetShelf';
import { getVideoModel } from '../constants/videoModels';
import { Phase } from './BlueprintContextBar';
import { findPhase } from '../constants/blueprintPhases';
import { canReopenBlueprintPhase } from '../constants/projectStatus';

interface Props {
  project: ApiProject;
  isLoading: boolean;
  phaseTransition: Record<string, any>;
  onGenerateScript: (userNote?: string) => Promise<void> | void;
  onRefineScript?: (feedback: string) => Promise<void> | void;
  onUpdateScene?: (sceneId: string, updates: { narrativeDescription?: string }) => void;
  onUpdateShot?: (sceneId: string, shotId: string, updates: { direction?: string; visualPrompt?: string; castIds?: string[]; environmentId?: string | null; duration?: number }) => void;
  onCancelScript?: () => void;
  onUnlockScript?: () => void;
  onUpdateProject: (updates: Record<string, any>) => void;
  onSetProject?: (project: ApiProject) => void;
  onSetViewPhase: (phase: Phase) => void;
  showActionError: (input: string | unknown) => void;
}

// ScriptPhase is now registry-driven (T10.4). The Director Settings bar's
// bespoke generate/regenerate buttons + the dialogue header CTA are gone:
// AssetShelf reads the workflow-gated tools (parse-script for scripted_narrative,
// plan-scenes-from-music for music_led, refine-script, write-audio-plan) from
// the registry and surfaces only what's runnable. Per-shot dialogue write
// stays inline (parameterized by shotId, not a tool-level affordance).
export const ScriptPhase: React.FC<Props> = ({
  project, isLoading, phaseTransition,
  onGenerateScript, onRefineScript, onUpdateScene, onUpdateShot, onCancelScript, onUnlockScript,
  onUpdateProject, onSetProject, onSetViewPhase, showActionError,
}) => {
  const [scriptNote, setScriptNote] = useState('');
  const [showScriptPrompt, setShowScriptPrompt] = useState(false);
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [writingDialogue, setWritingDialogue] = useState<Set<string>>(new Set());
  const isSeedanceStoryboard = project.videoModel?.startsWith('seedance');

  // Dialogue UI visibility comes from the workflow phase config. Anime
  // exposes it; music_video does not. Same gate keeps per-shot dialogue
  // blocks out of music-video projects. (T10.8 will replace this with a
  // direct registry check.)
  const audioPhaseVisible = !!findPhase(project, 'audio')?.visible;

  const characterName = (id: string) =>
    project.cast.find(c => c.id === id)?.name || '?';

  const flash = (key: string) => {
    setSavedFlash(key);
    setTimeout(() => setSavedFlash(null), 1500);
  };

  const writeDialogueForShot = async (shotId: string) => {
    setWritingDialogue(prev => new Set(prev).add(shotId));
    try {
      const updated = await api.writeAudioPlan(project.id, { shotIds: [shotId] });
      if (updated?.id) onSetProject?.(updated);
    } catch (err: any) {
      showActionError(`Write dialogue failed: ${err.message || 'unknown error'}`);
    } finally {
      setWritingDialogue(prev => {
        const next = new Set(prev);
        next.delete(shotId);
        return next;
      });
    }
  };

  const writeAllDialogue = async () => {
    setWritingDialogue(new Set(['__all__']));
    try {
      const updated = await api.writeAudioPlan(project.id);
      if (updated?.id) onSetProject?.(updated);
    } catch (err: any) {
      showActionError(`Write dialogue failed: ${err.message || 'unknown error'}`);
    } finally {
      setWritingDialogue(new Set());
    }
  };

  const handleRunTool = async (toolKey: string) => {
    if (toolKey === 'plan-scenes-from-music') {
      // music_led path — hits /generate-script which reads project.audioPath.
      const note = scriptNote.trim() || undefined;
      setScriptNote('');
      await Promise.resolve(onGenerateScript(note));
    } else if (toolKey === 'parse-script') {
      // scripted_narrative path — hits /parse-script which reads
      // project.source_payload.scriptText. Separate route because
      // /generate-script hard-fails on missing audio (T10.4 dispatch fix).
      const note = scriptNote.trim() || undefined;
      setScriptNote('');
      try {
        const updated = await api.parseScript(project.id, note);
        if (updated?.id) onSetProject?.(updated);
      } catch (err: any) {
        showActionError(`Parse script failed: ${err.message || 'unknown error'}`);
      }
    } else if (toolKey === 'refine-script' && onRefineScript) {
      if (!scriptNote.trim()) return;
      const note = scriptNote.trim();
      setScriptNote('');
      await Promise.resolve(onRefineScript(note));
    } else if (toolKey === 'write-audio-plan') {
      await writeAllDialogue();
    }
  };

  const totalShots = project.scenes.reduce((acc, s) => acc + s.shots.length, 0);
  const audioPlannedShots = project.scenes.reduce((acc, s) => acc + s.shots.filter(shot => !!shot.audioPlan).length, 0);
  const staleAudioPlans = project.scenes.reduce((acc, s) => acc + s.shots.filter(shot => !!shot.audioPlanStale).length, 0);
  const hasAnyAudioPlan = audioPlannedShots > 0;
  const writeAllDialogueLabel = staleAudioPlans > 0
    ? `Rewrite stale dialogue (${staleAudioPlans})`
    : hasAnyAudioPlan
      ? 'Rewrite all dialogue'
      : 'Write all dialogue';

  return (
    <motion.div key="script" {...phaseTransition} className="space-y-6">
      {/* Director Settings + AssetShelf */}
      <div className="surface rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-5 flex-wrap">
          {(() => {
            const model = getVideoModel(project.videoModel);
            const durations = model.durations;
            const selectedDuration = durations.includes(project.targetDuration)
              ? project.targetDuration
              : durations[0];
            return (
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-mono">Shot length</span>
                {durations.length === 1 ? (
                  <span className="text-xs font-mono text-zinc-300">
                    {durations[0]}s <span className="text-zinc-400">· fixed by {model.label}</span>
                  </span>
                ) : (
                  <Dropdown
                    value={String(selectedDuration)}
                    onChange={v => onUpdateProject({ targetDuration: Number(v) })}
                    size="xs"
                    options={durations.map(d => ({ value: String(d), label: `${d}s` }))}
                  />
                )}
              </div>
            );
          })()}
          <div className="ml-auto flex items-center gap-2">
            {project.scenes.length > 0 && project.lastScriptPrompt && (
              <button
                onClick={() => setShowScriptPrompt(s => !s)}
                className="text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors px-2 py-1"
              >
                {showScriptPrompt ? 'Hide prompt' : 'View prompt'}
              </button>
            )}
            {isLoading && onCancelScript && (
              <button
                onClick={onCancelScript}
                className="bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] px-3 py-1.5 rounded-md text-[11px] flex items-center gap-2 transition-colors"
                title="Stop the in-flight script generation."
              >
                <div className="w-2.5 h-2.5 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />
                Stop
              </button>
            )}
          </div>
        </div>

        <AssetShelf
          surface="asset:script"
          project={project}
          onRunTool={handleRunTool}
          disabled={isLoading || writingDialogue.size > 0}
        >
          <div className="space-y-2">
            <AutoGrowTextarea
              value={scriptNote}
              onChange={e => setScriptNote(e.target.value)}
              placeholder={
                project.scenes.length > 0
                  ? "Refine note (used by Refine script) — e.g. 'make scene 3 more intimate'"
                  : "Optional nudge for the first generation — e.g. 'tighter pacing in choruses'"
              }
              rows={1}
              className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
            />
            <p className="text-[11px] text-zinc-500">
              Tools above read this note. Refine keeps what works; Plan/Parse rebuilds the script from scratch.
            </p>
          </div>
          {showScriptPrompt && project.lastScriptPrompt && (
            <pre className="mt-3 surface-inset rounded-md p-3 text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{project.lastScriptPrompt}</pre>
          )}
        </AssetShelf>
      </div>

      {/* First-gen loading skeleton */}
      {isLoading && project.scenes.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 space-y-3">
          <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
          <p className="text-zinc-400 text-sm">Writing your script...</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && project.scenes.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 text-zinc-400 text-sm">
          <p>Run the script tool above to create a shot list.</p>
        </div>
      )}

      {/* Scenes / shots */}
      {project.scenes.length > 0 && (
        <div className="surface rounded-xl relative">
          {isLoading && (
            <div className="absolute inset-0 bg-black/60 rounded-xl z-10 flex flex-col items-center justify-center gap-3">
              <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
              <p className="text-zinc-300 text-sm">Rewriting script...</p>
            </div>
          )}
          <div className="p-5 flex justify-between items-center border-b border-white/[0.06]">
            <h3 className="text-sm font-medium text-white">Script Breakdown</h3>
            <div className="flex items-center gap-3">
              {audioPhaseVisible && (
                <button
                  onClick={writeAllDialogue}
                  disabled={isLoading || writingDialogue.size > 0}
                  className="bg-white text-black px-3 py-1.5 rounded-md text-[11px] font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                  title="Write or refresh audio plans for every shot in one backend call."
                >
                  {writingDialogue.has('__all__') ? 'Writing…' : writeAllDialogueLabel}
                </button>
              )}
              {onUnlockScript && canReopenBlueprintPhase(project, 'script') && (
                <UnlockPill onClick={onUnlockScript} disabled={isLoading} />
              )}
              <button
                className="text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors"
                onClick={() => {
                  if (expandedScenes.size === project.scenes.length) {
                    setExpandedScenes(new Set());
                  } else {
                    setExpandedScenes(new Set(project.scenes.map(s => s.id)));
                  }
                }}
              >
                {expandedScenes.size === project.scenes.length ? 'Collapse All' : 'Expand All'}
              </button>
              <span className="text-[11px] font-mono text-zinc-400">
                {project.scenes.length} Scenes / {totalShots} Shots
              </span>
            </div>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {project.scenes.map((scene, idx) => {
              const isExpanded = expandedScenes.has(scene.id);
              return (
                <div key={scene.id}>
                  <button
                    className="w-full text-left p-4 flex justify-between items-start hover:bg-white/[0.02] transition-colors"
                    onClick={() => {
                      const next = new Set(expandedScenes);
                      if (isExpanded) next.delete(scene.id); else next.add(scene.id);
                      setExpandedScenes(next);
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-0.5">
                        <span className="text-white font-medium text-sm">Scene {idx + 1}</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-md ${
                          scene.sectionLabel.toLowerCase().includes('chorus')
                            ? 'bg-amber-500/10 text-amber-400'
                            : 'bg-white/[0.04] text-zinc-400'
                        }`}>
                          {scene.sectionLabel}
                        </span>
                        <span className="text-[11px] text-zinc-400">{scene.shots.length} shots</span>
                      </div>
                      <p
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={e => {
                          const val = e.currentTarget.textContent?.trim();
                          if (val && val !== scene.narrativeDescription) {
                            onUpdateScene?.(scene.id, { narrativeDescription: val });
                            flash(scene.id);
                          }
                        }}
                        className="text-zinc-300 text-sm leading-relaxed outline-none border-b border-dashed border-transparent hover:border-white/[0.15] focus-visible:border-white/30 cursor-text transition-colors"
                      >{scene.narrativeDescription}</p>
                      {savedFlash === scene.id && <span className="text-[10px] text-emerald-400/70 ml-2">Saved</span>}
                    </div>
                    <div className="flex items-center gap-3 ml-4 shrink-0">
                      <span className="text-[11px] font-mono text-zinc-400">{scene.startTime} - {scene.endTime}</span>
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        className={`text-zinc-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                        <path d="M6 9l6 6 6-6"/>
                      </svg>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-white/[0.04] pt-3">
                      {scene.lyrics && (
                        <p className="text-zinc-400 italic text-sm leading-relaxed mb-3">"{scene.lyrics}"</p>
                      )}
                      {scene.shots.map((shot, sIdx) => {
                        const env = shot.environmentId ? project.environments.find(e => e.id === shot.environmentId) : null;
                        const realMotion = shot.motionPrompt && shot.motionPrompt !== 'Cinematic camera movement' ? shot.motionPrompt : null;
                        const scriptText = isSeedanceStoryboard
                          ? (shot.direction || shot.visualPrompt || '')
                          : (shot.visualPrompt || shot.direction || '');
                        return (
                        <div key={shot.id} className="flex gap-3 p-3 surface-inset rounded-lg">
                          <div className="text-xs font-mono text-zinc-400 w-6 pt-0.5 shrink-0">S{sIdx + 1}</div>
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div
                              contentEditable
                              suppressContentEditableWarning
                              onBlur={e => {
                                const val = e.currentTarget.textContent?.trim();
                                if (!val || val === scriptText) return;
                                if (isSeedanceStoryboard) {
                                  onUpdateShot?.(scene.id, shot.id, { direction: val });
                                } else {
                                  onUpdateShot?.(scene.id, shot.id, { visualPrompt: val });
                                }
                                flash(shot.id);
                              }}
                              className="text-sm text-zinc-300 leading-relaxed outline-none border-b border-dashed border-transparent hover:border-white/[0.15] focus-visible:border-white/30 cursor-text transition-colors"
                            >{scriptText || '—'}</div>
                            {savedFlash === shot.id && <span className="text-[10px] text-emerald-400/70">Saved</span>}
                            {realMotion && (
                              <div className="text-sm text-zinc-400 leading-relaxed">{realMotion}</div>
                            )}
                            <div className="text-[11px] text-zinc-400 flex gap-3 flex-wrap items-center">
                              <span className="flex items-center gap-1 font-mono">
                                <span className="text-zinc-300">{shot.duration}</span>
                                <span className="text-zinc-500">s</span>
                                {shot.duration > 4 && (
                                  <button
                                    onClick={async () => {
                                      if (!project) return;
                                      try {
                                        const p = await api.splitShot(project.id, shot.id);
                                        onSetProject?.(p);
                                        flash(shot.id);
                                      } catch (err: any) { showActionError(`Shot split failed: ${err.message}`); }
                                    }}
                                    className="text-zinc-500 hover:text-zinc-300 transition-colors ml-1"
                                    title={`Split into ${Math.floor(shot.duration / 2)}s + ${shot.duration - Math.floor(shot.duration / 2)}s`}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><polyline points="8 6 12 2 16 6"/><polyline points="8 18 12 22 16 18"/></svg>
                                  </button>
                                )}
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="text-zinc-500">Cast:</span>
                                {project.cast.map(c => {
                                  const active = (shot.castIds || []).includes(c.id);
                                  return (
                                    <button
                                      key={c.id}
                                      onClick={() => {
                                        const current = shot.castIds || [];
                                        const next = active ? current.filter(id => id !== c.id) : [...current, c.id];
                                        onUpdateShot?.(scene.id, shot.id, { castIds: next });
                                        flash(shot.id);
                                      }}
                                      className={`px-1.5 py-0.5 rounded transition-colors ${active ? 'bg-white/[0.1] text-zinc-200' : 'bg-transparent text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                      {c.name}
                                    </button>
                                  );
                                })}
                                {project.cast.length === 0 && (
                                  <button onClick={() => onSetViewPhase('characters')} className="text-zinc-500 hover:text-zinc-300 underline underline-offset-2">+ add</button>
                                )}
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="text-zinc-500">Env:</span>
                                <Dropdown
                                  value={shot.environmentId || ''}
                                  onChange={v => {
                                    if (v === '__add__') { onSetViewPhase('environments'); return; }
                                    onUpdateShot?.(scene.id, shot.id, { environmentId: v || null });
                                    flash(shot.id);
                                  }}
                                  size="xs"
                                  options={[
                                    { value: '', label: 'None' },
                                    ...project.environments.map(e => ({ value: e.id, label: e.name })),
                                    { value: '__add__', label: '+ Add environment...', divider: true },
                                  ]}
                                />
                              </span>
                              {shot.continuityFrom === 'prev_shot' && (
                                <span className="text-amber-400/80">· continues</span>
                              )}
                            </div>

                            {audioPhaseVisible && (
                              <DialogueBlock
                                shotId={shot.id}
                                audioPlan={shot.audioPlan}
                                audioPlanStale={shot.audioPlanStale}
                                writing={writingDialogue.has(shot.id) || writingDialogue.has('__all__')}
                                characterName={characterName}
                                onWrite={() => writeDialogueForShot(shot.id)}
                              />
                            )}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {project.scenes.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={() => onSetViewPhase('style')}
            className="bg-white text-black px-5 py-2 rounded-md font-semibold text-xs hover:bg-zinc-200 transition-colors flex items-center gap-2"
          >
            Continue to Style
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      )}
    </motion.div>
  );
};

// ─── Dialogue display per shot ──────────────────────────────────────
// Read-mostly view: each line as one row with speaker, text, and tts
// status pill. Editing/voice-assignment/TTS gen live in Audio phase.
// Per-shot "Write dialogue" stays bespoke (parameterized by shotId);
// "Write all dialogue" lives in AssetShelf above.

interface DialogueBlockProps {
  shotId: string;
  audioPlan?: { dialogue: DialogueLine[]; soundNotes?: string };
  audioPlanStale?: boolean;
  writing: boolean;
  characterName: (id: string) => string;
  onWrite: () => void;
}

const DialogueBlock: React.FC<DialogueBlockProps> = ({
  audioPlan, audioPlanStale, writing, characterName, onWrite,
}) => {
  const lines = audioPlan?.dialogue || [];
  const hasLines = lines.length > 0;
  const hasPlan = !!audioPlan;

  if (!hasPlan && !writing) {
    return (
      <div className="mt-2 pt-2 border-t border-white/[0.04] flex items-center gap-3">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Dialogue</span>
        <button
          onClick={onWrite}
          className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors inline-flex items-center gap-1"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          Write dialogue
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-white/[0.04] space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Dialogue</span>
        {audioPlanStale && (
          <span className="text-[10px] uppercase tracking-wider text-amber-300/80 bg-amber-500/[0.06] rounded px-1.5 py-0.5">
            stale
          </span>
        )}
        {writing && (
          <span className="text-[10px] text-zinc-400 inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
            Writing…
          </span>
        )}
        {(audioPlanStale || hasLines) && !writing && (
          <button
            onClick={onWrite}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors ml-auto"
          >
            {audioPlanStale ? 'Rewrite' : 'Regenerate'}
          </button>
        )}
      </div>
      {!hasLines && hasPlan && !writing ? (
        <div className="flex items-center justify-between gap-3 text-xs leading-snug">
          <span className="text-zinc-500 italic">No dialogue planned for this shot.</span>
          <button
            onClick={onWrite}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Rewrite
          </button>
        </div>
      ) : (
        [...lines].sort((a, b) => a.order - b.order).map(line => (
          <div key={line.id} className="flex items-start gap-2 text-xs leading-snug">
            <span className="text-zinc-400 font-medium min-w-[60px] flex-shrink-0">
              {characterName(line.characterId)}
            </span>
            <span className="text-zinc-300 flex-1 italic">"{line.text}"</span>
            <span className="flex-shrink-0">
              <TtsStatusPill status={line.ttsStatus} />
            </span>
          </div>
        ))
      )}
    </div>
  );
};

const TtsStatusPill: React.FC<{ status: DialogueLine['ttsStatus'] }> = ({ status }) => {
  const config = {
    pending: { color: 'text-zinc-500 bg-white/[0.03]', label: 'pending' },
    generating: { color: 'text-blue-300/80 bg-blue-500/[0.08]', label: 'gen…' },
    success: { color: 'text-emerald-300/80 bg-emerald-500/[0.08]', label: 'ready' },
    error: { color: 'text-red-300/80 bg-red-500/[0.08]', label: 'error' },
  }[status];
  return (
    <span className={`text-[9px] uppercase tracking-wider rounded px-1 py-0.5 ${config.color}`}>
      {config.label}
    </span>
  );
};
