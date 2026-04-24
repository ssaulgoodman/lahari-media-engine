
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ApiProject, ConceptOption } from '../types';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { UnlockPill } from './UnlockPill';
import { Phase, isLockedPhase } from './BlueprintContextBar';

interface Props {
  project: ApiProject;
  isLoading: boolean;
  phaseTransition: Record<string, any>;
  onLockConcept: (index: number) => void;
  onGenerateConcepts?: (opts?: { userNote?: string; directorBrief?: string }) => void;
  onCancelConcepts?: () => void;
  onUnlockConcept?: () => void;
  onRefineConcept?: (feedback: string) => Promise<void> | void;
  onUpdateConcept?: (updates: Record<string, any>) => Promise<void> | void;
  onSetViewPhase: (phase: Phase) => void;
}

export const ConceptPhase: React.FC<Props> = ({
  project, isLoading, phaseTransition,
  onLockConcept, onGenerateConcepts, onCancelConcepts, onUnlockConcept, onRefineConcept, onUpdateConcept,
  onSetViewPhase,
}) => {
  const [conceptNote, setConceptNote] = useState('');
  const [showConceptPrompt, setShowConceptPrompt] = useState(false);
  const [conceptMode, setConceptMode] = useState<'presets' | 'custom'>('presets');
  const [directorBrief, setDirectorBrief] = useState('');
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  return (
    <motion.div key="concept" {...phaseTransition} className="space-y-6">
      {/* Analyzing banner */}
      {project.status === 'analyzing' && (
        <div className="surface rounded-xl p-4 border border-amber-400/20 flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-zinc-600 border-t-amber-400 rounded-full animate-spin flex-shrink-0"></div>
          <div>
            <p className="text-sm text-white font-medium">Analyzing audio...</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">Detecting musical structure and meaning. You can listen to the song while this runs.</p>
          </div>
        </div>
      )}
      {isLockedPhase('concept', project.status) ? (
        <div className="rounded-xl p-6 border border-white/[0.06]">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-white" aria-hidden="true"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
              <h3 className="text-sm font-medium text-white">Locked Concept</h3>
            </div>
            {onUnlockConcept && (
              <UnlockPill onClick={onUnlockConcept} disabled={isLoading} />
            )}
          </div>
          {/* Editable concept fields */}
          <div className="grid grid-cols-3 gap-4 text-xs">
            {[
              { key: 'deity', label: 'Deity' },
              { key: 'mood', label: 'Mood' },
              { key: 'conceptDirection', label: 'Direction' },
            ].map(({ key, label }) => (
              <div key={key}>
                <span className="text-xs text-zinc-400 block uppercase tracking-wide mb-0.5">{label}</span>
                <span
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={e => {
                    const val = e.currentTarget.textContent?.trim();
                    if (val && val !== (project.lockedConcept as any)?.[key]) {
                      onUpdateConcept?.({ [key]: val });
                      setSavedFlash(`concept-${key}`);
                      setTimeout(() => setSavedFlash(null), 1500);
                    }
                  }}
                  className="text-white outline-none border-b border-dashed border-white/[0.1] hover:border-white/[0.3] focus-visible:border-white/40 focus-visible:ring-0 pb-0.5 cursor-text transition-colors"
                >{(project.lockedConcept as any)?.[key]}</span>
                {savedFlash === `concept-${key}` && <span className="text-[10px] text-emerald-400/70 ml-1">Saved</span>}
              </div>
            ))}
          </div>
          <div className="mt-3">
            <span className="text-xs text-zinc-400 block uppercase tracking-wide mb-1">Theme</span>
            <div
              contentEditable
              suppressContentEditableWarning
              onBlur={e => {
                const val = e.currentTarget.textContent?.trim();
                if (val && val !== project.lockedConcept?.theme) {
                  onUpdateConcept?.({ theme: val });
                  setSavedFlash('concept-theme');
                  setTimeout(() => setSavedFlash(null), 1500);
                }
              }}
              className="text-zinc-300 text-sm leading-relaxed outline-none border-b border-dashed border-white/[0.1] hover:border-white/[0.3] focus-visible:border-white/40 pb-1 cursor-text transition-colors"
            >{project.lockedConcept?.theme}</div>
            {savedFlash === 'concept-theme' && <span className="text-[10px] text-emerald-400/70">Saved</span>}
          </div>
          {/* Refine section */}
          {onRefineConcept && (
            <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">Refine concept</div>
              <div className="flex items-start gap-2">
                <AutoGrowTextarea
                  id="refine-concept"
                  placeholder="e.g. 'make it darker, more nocturnal' or 'change mood to celebratory'"
                  rows={1}
                  className="flex-1 surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
                />
                <button
                  onClick={() => {
                    const el = document.getElementById('refine-concept') as HTMLTextAreaElement;
                    if (el?.value.trim()) {
                      onRefineConcept(el.value.trim());
                      el.value = '';
                    }
                  }}
                  disabled={isLoading}
                  className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-400 hover:text-white rounded-md text-xs font-medium transition-colors flex-shrink-0 disabled:opacity-50"
                >Refine</button>
              </div>
            </div>
          )}
          <div className="mt-5 pt-4 border-t border-white/[0.06] flex justify-end">
            <button
              onClick={() => onSetViewPhase('script')}
              className="bg-white text-black px-5 py-2 rounded-md font-semibold text-xs hover:bg-zinc-200 transition-colors flex items-center gap-2"
            >
              Continue to Script
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      ) : project.conceptOptions.length === 0 ? (
        <div className="surface rounded-xl p-10 flex flex-col items-center text-center space-y-4">
          <div className="space-y-1.5">
            <h3 className="text-sm font-medium text-white">Creative Direction</h3>
          </div>

          {/* Mode toggle */}
          <div className="flex items-center gap-1 surface-inset rounded-lg p-1 w-fit whitespace-nowrap">
            <button
              onClick={() => setConceptMode('presets')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${conceptMode === 'presets' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
            >Explore 3 directions</button>
            <button
              onClick={() => setConceptMode('custom')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${conceptMode === 'custom' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
            >I have a vision</button>
          </div>

          {onGenerateConcepts && conceptMode === 'presets' && (
            <div className="w-full max-w-lg space-y-3">
              <p className="text-zinc-400 text-xs">Claude proposes 3 creative directions based on the song. Optional: nudge below.</p>
              <AutoGrowTextarea
                value={conceptNote}
                onChange={e => setConceptNote(e.target.value)}
                placeholder="Optional nudge — e.g. 'more abstract, less literal deity imagery'"
                rows={1}
                disabled={isLoading}
                className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed text-left disabled:opacity-50"
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.metaKey && !e.shiftKey && !isLoading) {
                    e.preventDefault();
                    onGenerateConcepts(conceptNote.trim() ? { userNote: conceptNote } : undefined);
                    setConceptNote('');
                  }
                }}
              />
              {isLoading ? (
                <button
                  onClick={() => onCancelConcepts?.()}
                  className="bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] px-6 py-2.5 rounded-md font-semibold text-sm flex items-center gap-2 transition-colors mx-auto"
                >
                  <div className="w-3.5 h-3.5 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>
                  Generating — click to stop
                </button>
              ) : (
                <button
                  onClick={() => { onGenerateConcepts(conceptNote.trim() ? { userNote: conceptNote } : undefined); setConceptNote(''); }}
                  className="bg-white text-black px-6 py-2.5 rounded-md font-semibold text-sm hover:bg-zinc-200 transition-colors mx-auto"
                >
                  {conceptNote.trim() ? 'Generate with this nudge' : 'Generate 3 Concepts'}
                </button>
              )}
            </div>
          )}

          {onGenerateConcepts && conceptMode === 'custom' && (
            <div className="w-full max-w-lg space-y-3">
              <p className="text-zinc-400 text-xs">Describe your vision. Claude will shape it into a structured concept for the pipeline.</p>
              <AutoGrowTextarea
                value={directorBrief}
                onChange={e => setDirectorBrief(e.target.value)}
                placeholder="e.g. 'Dreamy underwater sequence where Vishnu sleeps on the cosmic ocean. Deep blues and golds. Slow, meditative.'"
                rows={1}
                disabled={isLoading}
                className="w-full surface-inset rounded-md px-3 py-2.5 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed text-left disabled:opacity-50"
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.metaKey && !e.shiftKey && !isLoading && directorBrief.trim()) {
                    e.preventDefault();
                    onGenerateConcepts({ directorBrief: directorBrief.trim() });
                  }
                }}
              />
              {isLoading ? (
                <button
                  onClick={() => onCancelConcepts?.()}
                  className="bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] px-6 py-2.5 rounded-md font-semibold text-sm flex items-center gap-2 transition-colors mx-auto"
                >
                  <div className="w-3.5 h-3.5 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>
                  Generating — click to stop
                </button>
              ) : (
                <button
                  onClick={() => { if (directorBrief.trim()) onGenerateConcepts({ directorBrief: directorBrief.trim() }); }}
                  disabled={!directorBrief.trim()}
                  className="bg-white text-black px-6 py-2.5 rounded-md font-semibold text-sm hover:bg-zinc-200 disabled:opacity-30 transition-colors mx-auto"
                >
                  Generate My Concept
                </button>
              )}
            </div>
          )}

          {isLoading && <p className="text-[11px] text-zinc-400">Claude Opus is thinking — typically 20–40s.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-white mb-1">Choose a Creative Direction</h3>
              <p className="text-zinc-400 text-xs">{project.conceptOptions.length} concepts generated. Pick one to proceed.</p>
            </div>
            {onGenerateConcepts && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowConceptPrompt(s => !s)}
                  className="text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors px-2 py-1"
                >
                  {showConceptPrompt ? 'Hide prompt' : 'View prompt'}
                </button>
                {isLoading ? (
                  <button
                    onClick={() => onCancelConcepts?.()}
                    className="text-[11px] bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md px-3 py-1.5 transition-colors flex items-center gap-1.5"
                    title="Stop the in-flight generation."
                  >
                    <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => { onGenerateConcepts({ userNote: conceptNote || undefined }); setConceptNote(''); }}
                    className="text-[11px] bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md px-3 py-1.5 transition-colors"
                  >
                    Regenerate
                  </button>
                )}
              </div>
            )}
          </div>

          {onGenerateConcepts && (
            <div className="space-y-3">
              {/* Mode toggle */}
              <div className="flex items-center gap-1 surface-inset rounded-lg p-1 w-fit whitespace-nowrap">
                <button
                  onClick={() => setConceptMode('presets')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${conceptMode === 'presets' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
                >Regenerate 3</button>
                <button
                  onClick={() => setConceptMode('custom')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${conceptMode === 'custom' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
                >I have a vision</button>
              </div>

              {conceptMode === 'presets' ? (
                <AutoGrowTextarea
                  value={conceptNote}
                  onChange={e => setConceptNote(e.target.value)}
                  placeholder="Regenerate note — e.g. 'more abstract' or 'focus on devotion not mythology'"
                  rows={1}
                  className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.metaKey && !e.shiftKey && conceptNote.trim()) {
                      e.preventDefault();
                      onGenerateConcepts({ userNote: conceptNote });
                      setConceptNote('');
                    }
                  }}
                />
              ) : (
                <div className="space-y-2">
                  <AutoGrowTextarea
                    value={directorBrief}
                    onChange={e => setDirectorBrief(e.target.value)}
                    placeholder="Describe your vision — e.g. 'Dreamy underwater sequence, Vishnu on cosmic ocean, deep blues and golds'"
                    rows={1}
                    className="w-full surface-inset rounded-md px-3 py-2.5 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.metaKey && !e.shiftKey && directorBrief.trim()) {
                        e.preventDefault();
                        onGenerateConcepts({ directorBrief: directorBrief.trim() });
                      }
                    }}
                  />
                  <button
                    onClick={() => { if (directorBrief.trim()) onGenerateConcepts({ directorBrief: directorBrief.trim() }); }}
                    disabled={!directorBrief.trim() || isLoading}
                    className="bg-white text-black px-4 py-1.5 rounded-md font-semibold text-xs hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                  >Generate My Concept</button>
                </div>
              )}

              {showConceptPrompt && project.lastConceptPrompt && (
                <pre className="surface-inset rounded-md p-3 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{project.lastConceptPrompt}</pre>
              )}
            </div>
          )}

          <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-4">
            {isLoading && !isLockedPhase('concept', project.status) && (
              <div className="absolute inset-0 bg-black/60 rounded-xl z-10 flex flex-col items-center justify-center gap-3">
                <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin"></div>
                <p className="text-zinc-300 text-sm">Locking concept...</p>
              </div>
            )}
            {project.conceptOptions.map((concept, idx) => {
              const isCurrent = project.lockedConcept?.conceptDirection === concept.conceptDirection
                && project.lockedConcept?.theme === concept.theme;
              return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                whileHover={{ y: -2 }}
                className={`surface rounded-xl p-5 flex flex-col gap-4 cursor-pointer group hover:shadow-lg hover:shadow-black/20 ${isCurrent ? 'ring-1 ring-white/40' : ''}`}
                onClick={() => !isLoading && onLockConcept(idx)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium text-sm">{concept.conceptDirection}</span>
                    {isCurrent && <span className="text-[11px] text-zinc-400">· current</span>}
                  </div>
                  <span className="text-[11px] text-zinc-400 font-mono">{idx + 1}</span>
                </div>
                <div className="space-y-2 text-sm flex-1">
                  <div><span className="text-white font-medium">Deity:</span> <span className="text-zinc-300">{concept.deity}</span></div>
                  <div><span className="text-white font-medium">Mood:</span> <span className="text-zinc-300">{concept.mood}</span></div>
                  <p className="text-zinc-300 leading-relaxed">{concept.theme}</p>
                  {concept.description && <p className="text-zinc-400 text-xs leading-relaxed">{concept.description}</p>}
                </div>
                <button disabled={isLoading} className={`w-full py-2 rounded-md text-xs font-medium transition-colors disabled:opacity-50 mt-auto ${isCurrent ? 'bg-white/[0.1] text-white border border-white/[0.15]' : 'bg-white/[0.06] text-zinc-300 group-hover:bg-white group-hover:text-black'}`}>
                  {isCurrent ? 'Current' : 'Choose'}
                </button>
              </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
};
