
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ApiProject } from '../types';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { AssetShelf } from './AssetShelf';
import { Phase } from './BlueprintContextBar';

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

// ConceptPhase is now registry-driven (T10.3). The bespoke status-branch
// logic (isLockedPhase + conceptOptions.length === 0 + ...) is gone:
// AssetShelf reads availableTools/blockedTools from the project and renders
// generate-concept / refine-concept buttons keyed by their asset preconditions.
// Phase content is purely data-driven: input fields, locked-concept block,
// and concept options grid show based on project state, not status enum.
export const ConceptPhase: React.FC<Props> = ({
  project, isLoading, phaseTransition,
  onLockConcept, onGenerateConcepts, onCancelConcepts, onUnlockConcept, onRefineConcept, onUpdateConcept,
  onSetViewPhase,
}) => {
  const [generateNote, setGenerateNote] = useState('');
  const [directorBrief, setDirectorBrief] = useState('');
  const [refineFeedback, setRefineFeedback] = useState('');
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  const handleRunTool = (toolKey: string) => {
    if (toolKey === 'generate-concept' && onGenerateConcepts) {
      const opts: { userNote?: string; directorBrief?: string } = {};
      if (directorBrief.trim()) opts.directorBrief = directorBrief.trim();
      else if (generateNote.trim()) opts.userNote = generateNote.trim();
      onGenerateConcepts(Object.keys(opts).length ? opts : undefined);
      setGenerateNote('');
      setDirectorBrief('');
    } else if (toolKey === 'refine-concept' && onRefineConcept && refineFeedback.trim()) {
      onRefineConcept(refineFeedback.trim());
      setRefineFeedback('');
    }
  };

  const flash = (key: string) => {
    setSavedFlash(key);
    setTimeout(() => setSavedFlash(null), 1500);
  };

  const locked = project.lockedConcept;
  const conceptOptions = project.conceptOptions;

  return (
    <motion.div key="concept" {...phaseTransition} className="space-y-6">
      {project.status === 'analyzing' && (
        <div className="surface rounded-xl p-4 border border-amber-400/20 flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-zinc-600 border-t-amber-400 rounded-full animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm text-white font-medium">{project.analysisStep || 'Analyzing audio'}...</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">{project.audioPath ? 'You can listen while this runs.' : 'Downloading audio and preparing analysis.'}</p>
          </div>
        </div>
      )}

      <AssetShelf surface="asset:concept" project={project} onRunTool={handleRunTool}>
        <div className="surface rounded-xl p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Inputs (used by the tool you fire above)</div>
          <AutoGrowTextarea
            value={directorBrief}
            onChange={e => setDirectorBrief(e.target.value)}
            placeholder="Director brief (optional). If set, generate-concept returns 1 concept that realizes it; otherwise it proposes 3."
            rows={1}
            disabled={isLoading}
            className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed disabled:opacity-50"
          />
          {!directorBrief.trim() && (
            <AutoGrowTextarea
              value={generateNote}
              onChange={e => setGenerateNote(e.target.value)}
              placeholder="Optional nudge for the 3 proposed directions — e.g. 'darker, more nocturnal'"
              rows={1}
              disabled={isLoading}
              className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed disabled:opacity-50"
            />
          )}
          {locked && onRefineConcept && (
            <AutoGrowTextarea
              value={refineFeedback}
              onChange={e => setRefineFeedback(e.target.value)}
              placeholder="Refine note — e.g. 'make it darker' or 'change mood to celebratory'"
              rows={1}
              className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
            />
          )}
          {isLoading && onCancelConcepts && (
            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
              <div className="w-3 h-3 border border-zinc-500 border-t-white rounded-full animate-spin" />
              <span>Generating —</span>
              <button onClick={onCancelConcepts} className="underline hover:text-zinc-200">stop</button>
            </div>
          )}
          {project.lastConceptPrompt && (
            <button onClick={() => setShowPrompt(s => !s)} className="text-[11px] text-zinc-400 hover:text-zinc-300">
              {showPrompt ? 'Hide prompt' : 'View prompt'}
            </button>
          )}
          {showPrompt && project.lastConceptPrompt && (
            <pre className="surface-inset rounded-md p-3 text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{project.lastConceptPrompt}</pre>
          )}
        </div>
      </AssetShelf>

      {locked && (
        <div className="rounded-xl p-6 border border-white/[0.06] space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-white" aria-hidden="true"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
              <h3 className="text-sm font-medium text-white">Locked Concept</h3>
            </div>
            {onUnlockConcept && (
              <button onClick={onUnlockConcept} disabled={isLoading} className="text-[11px] text-zinc-400 hover:text-zinc-200 underline disabled:opacity-50">Unlock</button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs">
            {([
              { key: 'subject', label: 'Subject' },
              { key: 'mood', label: 'Mood' },
              { key: 'conceptDirection', label: 'Direction' },
            ] as const).map(({ key, label }) => {
              const val = key === 'subject'
                ? ((locked as any).subject || (locked as any).primarySubject || '')
                : ((locked as any)[key] || '');
              return (
                <div key={key}>
                  <span className="text-xs text-zinc-400 block uppercase tracking-wide mb-0.5">{label}</span>
                  <span
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={e => {
                      const v = e.currentTarget.textContent?.trim();
                      if (v && v !== val) { onUpdateConcept?.({ [key]: v }); flash(`concept-${key}`); }
                    }}
                    className="text-white outline-none border-b border-dashed border-white/[0.1] hover:border-white/[0.3] focus-visible:border-white/40 pb-0.5 cursor-text transition-colors"
                  >{val}</span>
                  {savedFlash === `concept-${key}` && <span className="text-[10px] text-emerald-400/70 ml-1">Saved</span>}
                </div>
              );
            })}
          </div>
          <div>
            <span className="text-xs text-zinc-400 block uppercase tracking-wide mb-1">Theme</span>
            <div
              contentEditable
              suppressContentEditableWarning
              onBlur={e => {
                const v = e.currentTarget.textContent?.trim();
                if (v && v !== locked.theme) { onUpdateConcept?.({ theme: v }); flash('concept-theme'); }
              }}
              className="text-zinc-300 text-sm leading-relaxed outline-none border-b border-dashed border-white/[0.1] hover:border-white/[0.3] focus-visible:border-white/40 pb-1 cursor-text transition-colors"
            >{locked.theme}</div>
            {savedFlash === 'concept-theme' && <span className="text-[10px] text-emerald-400/70">Saved</span>}
          </div>
          <div className="pt-4 border-t border-white/[0.06] flex justify-end">
            <button
              onClick={() => onSetViewPhase('script')}
              className="bg-white text-black px-5 py-2 rounded-md font-semibold text-xs hover:bg-zinc-200 transition-colors flex items-center gap-2"
            >
              Continue to Script
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      )}

      {!locked && conceptOptions.length > 0 && (
        <div className="space-y-3">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            {conceptOptions.length} concept{conceptOptions.length === 1 ? '' : 's'} proposed — pick one to lock
          </div>
          <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-4">
            {isLoading && (
              <div className="absolute inset-0 bg-black/60 rounded-xl z-10 flex flex-col items-center justify-center gap-3">
                <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
                <p className="text-zinc-300 text-sm">Locking concept...</p>
              </div>
            )}
            {conceptOptions.map((concept, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                whileHover={{ y: -2 }}
                className="surface rounded-xl p-5 flex flex-col gap-4 cursor-pointer group hover:shadow-lg hover:shadow-black/20"
                onClick={() => !isLoading && onLockConcept(idx)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-white font-medium text-sm">{concept.conceptDirection}</span>
                  <span className="text-[11px] text-zinc-400 font-mono">{idx + 1}</span>
                </div>
                <div className="space-y-2 text-sm flex-1">
                  <div><span className="text-white font-medium">Subject:</span> <span className="text-zinc-300">{(concept as any).subject || (concept as any).primarySubject}</span></div>
                  <div><span className="text-white font-medium">Mood:</span> <span className="text-zinc-300">{concept.mood}</span></div>
                  <p className="text-zinc-300 leading-relaxed">{concept.theme}</p>
                  {concept.description && <p className="text-zinc-400 text-xs leading-relaxed">{concept.description}</p>}
                </div>
                <button disabled={isLoading} className="w-full py-2 rounded-md text-xs font-medium transition-colors disabled:opacity-50 mt-auto bg-white/[0.06] text-zinc-300 group-hover:bg-white group-hover:text-black">
                  Choose
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};
