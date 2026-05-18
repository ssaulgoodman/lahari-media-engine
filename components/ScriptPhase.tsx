
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ApiProject, DialogueLine } from '../types';
import * as api from '../services/api';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { Dropdown } from './Dropdown';
import { UnlockPill } from './UnlockPill';
import { getVideoModel } from '../constants/videoModels';
import { Phase, isLockedPhase } from './BlueprintContextBar';
import { findPhase } from '../constants/blueprintPhases';

interface Props {
  project: ApiProject;
  isLoading: boolean;
  phaseTransition: Record<string, any>;
  onGenerateScript: (userNote?: string) => void;
  onRefineScript?: (feedback: string) => void;
  onUpdateScene?: (sceneId: string, updates: { narrativeDescription?: string }) => void;
  onUpdateShot?: (sceneId: string, shotId: string, updates: { direction?: string; visualPrompt?: string; castIds?: string[]; environmentId?: string | null; duration?: number }) => void;
  onCancelScript?: () => void;
  onUnlockScript?: () => void;
  onUpdateProject: (updates: Record<string, any>) => void;
  onSetProject?: (project: ApiProject) => void;
  onSetViewPhase: (phase: Phase) => void;
  showActionError: (msg: string) => void;
}

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

  // Audio phase visibility is workflow-config driven. Anime exposes it (even
  // when coming-soon); music_video does not. Same gate keeps dialogue UI out
  // of music-video projects so the Script phase stays clean.
  const audioPhaseVisible = !!findPhase(project, 'audio')?.visible;

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

  const writeDialogueForAllShots = async () => {
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

  const characterName = (id: string) =>
    project.cast.find(c => c.id === id)?.name || '?';

  return (
    <motion.div key="script" {...phaseTransition} className="space-y-6">
      {/* Director Settings */}
      <div className="surface rounded-xl p-5">
        <div className="flex items-end gap-6 flex-wrap">
          <div className="space-y-2">
            <label className="text-[11px] uppercase font-medium text-zinc-400 tracking-wide block">Style</label>
            <div className="flex gap-1 surface-inset rounded-md p-0.5">
              <button
                onClick={() => onUpdateProject({ videoMode: 'montage' })}
                className={`px-3 py-1.5 rounded text-[11px] font-medium transition-colors ${project.videoMode === 'montage' ? 'bg-white text-black' : 'text-zinc-400 hover:text-zinc-300'}`}
                title="Quick cuts, varied angles, visual variety — each shot is a self-contained moment"
              >
                Montage
              </button>
              <button
                onClick={() => onUpdateProject({ videoMode: 'cinematic' })}
                className={`px-3 py-1.5 rounded text-[11px] font-medium transition-colors ${project.videoMode === 'cinematic' ? 'bg-white text-black' : 'text-zinc-400 hover:text-zinc-300'}`}
                title="Smooth visual flow, shots connect to each other with continuity between frames"
              >
                Cinematic
              </button>
            </div>
          </div>
          {(() => {
            const model = getVideoModel(project.videoModel);
            const durations = model.durations;
            return durations.length === 1 ? (
              <div className="space-y-2">
                <label className="text-[11px] uppercase font-medium text-zinc-400 tracking-wide block">Shot length</label>
                <div className="px-3 py-1.5 text-[11px] font-mono text-zinc-300">{durations[0]}s <span className="text-zinc-500 font-sans">(fixed by {model.label})</span></div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-[11px] uppercase font-medium text-zinc-400 tracking-wide block">Shot length</label>
                <div className="flex gap-1 surface-inset rounded-md p-0.5">
                  {durations.map(d => (
                    <button
                      key={d}
                      onClick={() => onUpdateProject({ targetDuration: d })}
                      className={`px-3 py-1.5 rounded text-[11px] font-mono transition-colors ${project.targetDuration === d ? 'bg-white text-black' : 'text-zinc-400 hover:text-zinc-300'}`}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
          <div className="flex items-center gap-2 ml-auto">
            {project.scenes.length > 0 && (
              <button
                onClick={() => setShowScriptPrompt(s => !s)}
                className="text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors px-2 py-1"
              >
                {showScriptPrompt ? 'Hide prompt' : 'View prompt'}
              </button>
            )}
            {isLoading ? (
              <button
                onClick={() => onCancelScript?.()}
                className="bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] px-5 py-2 rounded-md font-semibold text-xs flex items-center gap-2 transition-colors"
                title="Stop the in-flight script generation."
              >
                <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>
                Stop
              </button>
            ) : (
              <button
                onClick={() => { onGenerateScript(scriptNote || undefined); setScriptNote(''); }}
                className="bg-white text-black px-5 py-2 rounded-md font-semibold text-xs hover:bg-zinc-200 flex items-center gap-2 transition-colors"
              >
                {project.scenes.length > 0 ? 'Regenerate' : 'Generate Script'}
              </button>
            )}
          </div>
        </div>

        {/* Note + prompt preview */}
        {project.scenes.length > 0 && (
          <div className="space-y-3 pt-2">
            <AutoGrowTextarea
              value={scriptNote}
              onChange={e => setScriptNote(e.target.value)}
              placeholder="e.g. 'make scene 3 more intimate' or 'add a close-up of Ganesha in scene 2'"
              rows={1}
              className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.metaKey && !e.shiftKey && scriptNote.trim()) {
                  e.preventDefault();
                  if (onRefineScript) { onRefineScript(scriptNote); setScriptNote(''); }
                }
              }}
            />
            <div className="flex items-center gap-2">
              {onRefineScript && (
                <button
                  onClick={() => { if (scriptNote.trim()) { onRefineScript(scriptNote); setScriptNote(''); } }}
                  disabled={!scriptNote.trim() || isLoading}
                  className="px-4 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                >
                  Refine script
                </button>
              )}
              <span className="text-[11px] text-zinc-500">Enter = refine (keeps what works) · Regenerate = fresh start</span>
            </div>
            {showScriptPrompt && project.lastScriptPrompt && (
              <pre className="surface-inset rounded-md p-3 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{project.lastScriptPrompt}</pre>
            )}
          </div>
        )}
      </div>

      {/* Loading — first gen */}
      {isLoading && project.scenes.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 space-y-3">
          <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin"></div>
          <p className="text-zinc-400 text-sm">Writing your script...</p>
        </div>
      )}

      {/* Scenes */}
      {project.scenes.length > 0 && (
        <div className="surface rounded-xl relative">
          {isLoading && (
            <div className="absolute inset-0 bg-black/60 rounded-xl z-10 flex flex-col items-center justify-center gap-3">
              <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin"></div>
              <p className="text-zinc-300 text-sm">Rewriting script...</p>
            </div>
          )}
          <div className="p-5 flex justify-between items-center border-b border-white/[0.06]">
            <h3 className="text-sm font-medium text-white">Script Breakdown</h3>
            <div className="flex items-center gap-3">
              {onUnlockScript && isLockedPhase(project, 'script', project.status) && (
                <UnlockPill onClick={onUnlockScript} disabled={isLoading} />
              )}
              {audioPhaseVisible && project.scenes.length > 0 && (
                <button
                  onClick={writeDialogueForAllShots}
                  disabled={writingDialogue.size > 0 || isLoading}
                  className="text-[11px] text-zinc-400 hover:text-zinc-200 surface-inset rounded-md px-2.5 py-1 hover:bg-white/[0.06] transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {writingDialogue.has('__all__') && (
                    <span className="w-3 h-3 border-2 border-zinc-500 border-t-zinc-200 rounded-full animate-spin" />
                  )}
                  {writingDialogue.has('__all__') ? 'Writing…' : 'Write all dialogue'}
                </button>
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
                {project.scenes.length} Scenes / {project.scenes.reduce((acc, s) => acc + s.shots.length, 0)} Shots
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
                            setSavedFlash(scene.id);
                            setTimeout(() => setSavedFlash(null), 1500);
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
                        const castNames = (shot.castIds || [])
                          .map(id => project.cast.find(c => c.id === id)?.name)
                          .filter(Boolean) as string[];
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
                                  setSavedFlash(shot.id);
                                  setTimeout(() => setSavedFlash(null), 1500);
                              }}
                              className="text-sm text-zinc-300 leading-relaxed outline-none border-b border-dashed border-transparent hover:border-white/[0.15] focus-visible:border-white/30 cursor-text transition-colors"
                            >{scriptText || '—'}</div>
                            {savedFlash === shot.id && <span className="text-[10px] text-emerald-400/70">Saved</span>}
                            {realMotion && (
                              <div className="text-sm text-zinc-400 leading-relaxed">{realMotion}</div>
                            )}
                            <div className="text-[11px] text-zinc-400 flex gap-3 flex-wrap items-center">
                              {/* Duration (read-only) + split */}
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
                                        setSavedFlash(shot.id);
                                        setTimeout(() => setSavedFlash(null), 1500);
                                      } catch (err: any) { showActionError(`Shot split failed: ${err.message}`); }
                                    }}
                                    className="text-zinc-500 hover:text-zinc-300 transition-colors ml-1"
                                    title={`Split into ${Math.floor(shot.duration / 2)}s + ${shot.duration - Math.floor(shot.duration / 2)}s`}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><polyline points="8 6 12 2 16 6"/><polyline points="8 18 12 22 16 18"/></svg>
                                  </button>
                                )}
                              </span>
                              {/* Cast multi-select */}
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
                                        setSavedFlash(shot.id);
                                        setTimeout(() => setSavedFlash(null), 1500);
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
                              {/* Environment select */}
                              <span className="flex items-center gap-1">
                                <span className="text-zinc-500">Env:</span>
                                <Dropdown
                                  value={shot.environmentId || ''}
                                  onChange={v => {
                                    if (v === '__add__') { onSetViewPhase('environments'); return; }
                                    onUpdateShot?.(scene.id, shot.id, { environmentId: v || null });
                                    setSavedFlash(shot.id);
                                    setTimeout(() => setSavedFlash(null), 1500);
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

      {project.scenes.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center h-48 text-zinc-400 text-sm">
          <p>Hit "Generate Script" to create a cinematic shot list.</p>
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
// status pill. Editing/voice-assignment/TTS gen live in Audio phase
// (T5.4). Empty state shows a "Write dialogue" CTA. Stale flag
// surfaces an amber rewrite affordance.

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
  const soundNotes = audioPlan?.soundNotes;

  if (!hasLines && !writing) {
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
      {[...lines].sort((a, b) => a.order - b.order).map(line => (
        <div key={line.id} className="flex items-start gap-2 text-xs leading-snug">
          <span className="text-zinc-400 font-medium min-w-[60px] flex-shrink-0">
            {characterName(line.characterId)}
          </span>
          <span className="text-zinc-300 flex-1 italic">"{line.text}"</span>
          <span className="flex-shrink-0 flex items-center gap-1.5">
            {line.delivery && (
              <span className="text-[10px] text-zinc-500">{line.delivery}</span>
            )}
            <TtsStatusPill status={line.ttsStatus} />
          </span>
        </div>
      ))}
      {soundNotes && (
        <div className="text-[11px] text-zinc-500 italic leading-snug pt-1">
          <span className="not-italic text-zinc-600">SFX:</span> {soundNotes}
        </div>
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
