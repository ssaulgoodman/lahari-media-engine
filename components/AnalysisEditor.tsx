
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ApiProject, ConceptOption, CastMember, Environment, VideoMode } from '../types';
import * as api from '../services/api';
import { ImageModal } from './ImageModal';

interface Props {
  project: ApiProject;
  isLoading: boolean;
  looksLoading: Set<string>;
  lookCandidates: Record<string, { id: string; url: string }[]>;
  onLockConcept: (index: number) => void;
  onLockStyle: (assetId: string, styleDescription?: string) => void;
  onUnlockStyle: () => void;
  onGenerateLooks: (castMemberId: string, feedback?: string) => void;
  onLockCharacter: (castMemberId: string, assetId: string) => void;
  onAddCast: (name: string, description: string) => void;
  onUpdateCast: (memberId: string, updates: { name?: string; description?: string }) => void;
  onDeleteCast: (memberId: string) => void;
  onGenerateScript: (userNote?: string) => void;
  onUpdateProject: (updates: Record<string, any>) => void;
  onLaunchStudio: () => void;
  onAdvanceCharacters: () => void;
  onAdvanceEnvironments: () => void;
  onSetProject?: (project: ApiProject) => void;
}

type Phase = 'concept' | 'script' | 'style' | 'characters' | 'environments';

const PHASE_ORDER: Phase[] = ['concept', 'script', 'style', 'characters', 'environments'];

const phaseIndex = (p: Phase) => PHASE_ORDER.indexOf(p);

const getActivePhase = (project: ApiProject): Phase => {
  switch (project.status) {
    case 'analyzed': return 'concept';
    case 'concept_locked': return 'script';
    case 'scripted': return 'style';
    case 'style_locked': return 'characters';
    case 'characters_locked': return 'environments';
    case 'environments_locked':
    case 'in_production':
      return 'environments';
    default: return 'concept';
  }
};

// ─── Style Slot Type ────────────────────────────────────────────────

interface StyleSlot {
  title: string;
  description: string;
  imageUrl?: string;
  assetId?: string;
  isGenerating?: boolean;
  isRefining?: boolean;
}

// EnvironmentCard removed — environments now use sidebar+detail layout inline

export const AnalysisEditor: React.FC<Props> = ({
  project, isLoading, looksLoading, lookCandidates,
  onLockConcept, onLockStyle, onUnlockStyle,
  onGenerateLooks, onLockCharacter, onAddCast, onUpdateCast, onDeleteCast,
  onGenerateScript, onUpdateProject, onLaunchStudio, onAdvanceCharacters, onAdvanceEnvironments, onSetProject,
}) => {
  const activePhase = getActivePhase(project);
  const [viewPhase, setViewPhase] = useState<Phase>(activePhase);
  const [activeCastId, setActiveCastId] = useState<string | null>(project.cast[0]?.id || null);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(project.environments[0]?.id || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Style exploration state — initialize from persisted data
  const [styleSlots, setStyleSlots] = useState<StyleSlot[]>(() => {
    const saved = project.styleExploration?.slots;
    return saved ? saved.map(s => ({ ...s })) : [];
  });
  const [userSlot, setUserSlot] = useState<StyleSlot>(() => {
    const saved = project.styleExploration?.userSlot;
    return saved ? { ...saved } : { title: 'Your Vision', description: '' };
  });
  const [brainstormNotes, setBrainstormNotes] = useState('');
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  const [isBrainstorming, setIsBrainstorming] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [showExploredStyles, setShowExploredStyles] = useState(false);
  const [expandedStyleIdx, setExpandedStyleIdx] = useState<number | null>(null);
  const [showCustomSlot, setShowCustomSlot] = useState(false);
  const [modalImage, setModalImage] = useState<string | null>(null);

  // Environment look state
  const [envLooks, setEnvLooks] = useState<Record<string, { id: string; url: string }[]>>({});
  const [envGenerating, setEnvGenerating] = useState<Set<string>>(new Set());
  const [promptPreview, setPromptPreview] = useState<string | null>(null); // entity id
  const [scriptNote, setScriptNote] = useState('');
  const [showScriptPrompt, setShowScriptPrompt] = useState(false);

  // Auto-persist style exploration to DB whenever slots change (debounced)
  const styleExplorationInitRef = useRef(true);
  useEffect(() => {
    // Skip the initial render (don't save what we just loaded)
    if (styleExplorationInitRef.current) {
      styleExplorationInitRef.current = false;
      return;
    }
    // Skip if nothing to save
    if (styleSlots.length === 0 && !userSlot.description) return;
    // Debounce to avoid hammering on rapid state changes
    const timer = setTimeout(() => {
      const payload = {
        slots: styleSlots.filter(s => !s.isGenerating && !s.isRefining).map(s => ({ title: s.title, description: s.description, imageUrl: s.imageUrl, assetId: s.assetId })),
        userSlot: userSlot.description ? { title: userSlot.title, description: userSlot.description, imageUrl: userSlot.imageUrl, assetId: userSlot.assetId } : undefined,
      };
      api.updateProject(project.id, { styleExploration: payload }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [styleSlots, userSlot, project.id]);

  const canAccess = (phase: Phase) => phaseIndex(phase) <= phaseIndex(activePhase);
  const isLockedPhase = (phase: Phase) => phaseIndex(phase) < phaseIndex(activePhase);
  const activeMember = project.cast.find(c => c.id === activeCastId);
  const activeLooks = activeCastId ? (lookCandidates[activeCastId] || []) : [];
  const activeEnv = project.environments.find(e => e.id === activeEnvId);
  const activeEnvLooks = activeEnvId ? (envLooks[activeEnvId] || []) : [];

  // ─── Environment Handlers ──────────────────────────────────────

  const handleEnvGenerate = async (envId: string) => {
    setEnvGenerating(prev => new Set(prev).add(envId));
    try {
      const result = await api.generateEnvironmentLook(project.id, envId);
      setEnvLooks(prev => ({ ...prev, [envId]: result.looks || [] }));
      onSetProject?.(result.project);
    } catch (err: any) {
      console.error('Environment look gen failed:', err);
    } finally {
      setEnvGenerating(prev => { const s = new Set(prev); s.delete(envId); return s; });
    }
  };

  const handleEnvLock = async (envId: string, assetId: string) => {
    try {
      const p = await api.lockEnvironment(project.id, envId, assetId);
      onSetProject?.(p);
      setEnvLooks(prev => ({ ...prev, [envId]: [] }));
    } catch (err: any) {
      console.error('Environment lock failed:', err);
    }
  };

  // ─── Style Exploration Handlers ─────────────────────────────────

  const handleBrainstorm = async () => {
    setIsBrainstorming(true);
    try {
      const result = await api.brainstormStyles(project.id, brainstormNotes || undefined);
      setStyleSlots((result.directions || []).map((d: any) => ({
        title: d.title,
        description: d.description,
      })));
    } catch (err: any) {
      console.error('Brainstorm failed:', err);
    } finally {
      setIsBrainstorming(false);
    }
  };

  const handleVisualize = async (index: number, isUserSlot?: boolean) => {
    const slot = isUserSlot ? userSlot : styleSlots[index];
    if (!slot?.description) return;

    const update = (patch: Partial<StyleSlot>) => {
      if (isUserSlot) {
        setUserSlot(prev => ({ ...prev, ...patch }));
      } else {
        setStyleSlots(prev => prev.map((s, i) => i === index ? { ...s, ...patch } : s));
      }
    };

    update({ isGenerating: true, imageUrl: undefined, assetId: undefined });
    try {
      const result = await api.visualizeStyle(project.id, slot.description);
      update({ isGenerating: false, imageUrl: result.url, assetId: result.assetId });
    } catch (err: any) {
      console.error('Visualize failed:', err);
      update({ isGenerating: false });
    }
  };

  const handleRefine = async (index: number, feedback: string) => {
    const slot = styleSlots[index];
    if (!slot || !feedback) return;

    setStyleSlots(prev => prev.map((s, i) => i === index ? { ...s, isRefining: true } : s));
    try {
      const result = await api.refineStyleDirection(project.id, slot.description, feedback);
      setStyleSlots(prev => prev.map((s, i) => i === index ? {
        ...s,
        title: result.title,
        description: result.description,
        isRefining: false,
        imageUrl: undefined,
        assetId: undefined,
      } : s));
    } catch (err: any) {
      console.error('Refine failed:', err);
      setStyleSlots(prev => prev.map((s, i) => i === index ? { ...s, isRefining: false } : s));
    }
  };

  const handleLockSlot = async (slot: StyleSlot) => {
    if (!slot.assetId) return;
    setIsLocking(true);
    try {
      await onLockStyle(slot.assetId, slot.description);
    } finally {
      setIsLocking(false);
    }
  };

  const handleUploadReference = async (file: File) => {
    try {
      const result = await api.analyzeStyleImage(project.id, file);
      const styleDesc = result.styleDescription || '';
      setUserSlot({
        title: 'Uploaded Reference',
        description: styleDesc,
        imageUrl: URL.createObjectURL(file),
      });
    } catch (err: any) {
      console.error('Upload analysis failed:', err);
    }
  };

  // ─── Style Card ──────────────────────────────────────────────────

  const StyleRow: React.FC<{
    slot: StyleSlot;
    index: number;
    expanded: boolean;
    onToggle: () => void;
    onVisualize: () => void;
    onLock: () => void;
  }> = ({ slot, index, expanded, onToggle, onVisualize, onLock }) => {
    const [refineInput, setRefineInput] = useState('');

    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.04 }}
        className="rounded-xl overflow-hidden border border-white/[0.06]"
      >
        {/* Collapsed row — always visible */}
        <button
          onClick={onToggle}
          className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {slot.imageUrl && (
              <img src={slot.imageUrl} alt={slot.title} className="w-10 h-10 rounded-md object-cover flex-shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-medium text-white">{slot.title || 'Untitled'}</h4>
              {!expanded && (
                <p className="text-xs text-zinc-500 line-clamp-1 mt-0.5">{slot.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 ml-4">
            {slot.isGenerating && (
              <div className="w-3.5 h-3.5 border-2 border-zinc-600 border-t-white rounded-full animate-spin"></div>
            )}
            {slot.imageUrl && !expanded && (
              <span className="text-[10px] text-zinc-500 border border-white/[0.08] px-2 py-0.5 rounded">Image ready</span>
            )}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`}>
              <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </div>
        </button>

        {/* Expanded content */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="expanded"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              <div className="border-t border-white/[0.06]">
                {/* Image result — show first if exists */}
                {(slot.isGenerating || slot.imageUrl) && (
                  <div className="bg-black/20">
                    {slot.isGenerating ? (
                      <div className="h-56 flex items-center justify-center">
                        <div className="w-6 h-6 border-2 border-zinc-600 border-t-white rounded-full animate-spin"></div>
                      </div>
                    ) : (
                      <div className="relative group">
                        <img src={slot.imageUrl} onClick={() => setModalImage(slot.imageUrl!)} className="w-full h-auto max-h-[360px] object-contain mx-auto cursor-zoom-in" alt={slot.title} />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <button
                            onClick={onLock}
                            disabled={isLocking}
                            className="bg-white text-black px-5 py-2.5 rounded-md text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50"
                          >
                            {isLocking ? 'Locking…' : 'Lock This Style'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="px-5 py-4 space-y-4">
                  <p className="text-sm text-zinc-300 leading-relaxed">{slot.description}</p>

                  {/* Refine + Visualize row */}
                  <div className="flex gap-2">
                    <input
                      value={refineInput}
                      onChange={(e) => setRefineInput(e.target.value)}
                      placeholder="Refine this direction…"
                      className="flex-1 surface-inset rounded-md px-3 py-2 text-sm text-white outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && refineInput) {
                          handleRefine(index, refineInput);
                          setRefineInput('');
                        }
                      }}
                    />
                    <button
                      onClick={() => { handleRefine(index, refineInput); setRefineInput(''); }}
                      disabled={!refineInput || slot.isRefining}
                      className="px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] rounded-md text-xs text-zinc-300 disabled:opacity-30 transition-colors"
                    >
                      {slot.isRefining ? 'Refining…' : 'Refine'}
                    </button>
                    <button
                      onClick={onVisualize}
                      disabled={!slot.description || slot.isGenerating}
                      className="px-5 py-2 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                    >
                      {slot.isGenerating ? 'Generating…' : slot.imageUrl ? 'Re-visualize' : 'Visualize'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  // ─── Phase content animation wrapper ─────────────────────────────

  const phaseTransition = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    transition: { duration: 0.2 },
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-32">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-display font-medium text-white tracking-tight">{project.title || 'Blueprint'}</h2>
        {(project.status === 'environments_locked' || (project.status === 'characters_locked' && project.environments.length === 0)) && (
          <button onClick={onLaunchStudio} disabled={isLoading} className="bg-white text-black px-6 py-2.5 rounded-md font-semibold text-sm hover:bg-zinc-200 transition-colors disabled:opacity-50 flex items-center gap-2">
            {isLoading && <div className="w-3.5 h-3.5 border-2 border-zinc-400 border-t-black rounded-full animate-spin"></div>}
            {isLoading ? 'Writing shot prompts...' : 'Launch Studio'}
          </button>
        )}
      </div>

      {/* Phase Progress — Chips connected by lines */}
      <div className="flex items-center justify-center gap-0">
        {PHASE_ORDER.map((phase, idx) => {
          const locked = isLockedPhase(phase);
          const active = viewPhase === phase;
          const accessible = canAccess(phase);

          return (
            <React.Fragment key={phase}>
              <button
                disabled={!accessible}
                onClick={() => accessible && setViewPhase(phase)}
                className={`px-4 py-2 rounded-md text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-white/[0.08] text-white'
                    : locked
                      ? 'text-zinc-300 hover:text-white'
                      : accessible
                        ? 'text-zinc-500 hover:text-zinc-300'
                        : 'text-zinc-700 cursor-not-allowed'
                }`}
              >
                {locked && (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 mr-1 inline" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                  </svg>
                )}
                {phase.charAt(0).toUpperCase() + phase.slice(1)}
              </button>
              {idx < PHASE_ORDER.length - 1 && (
                <div className={`w-8 h-px ${locked ? 'bg-white/20' : 'bg-white/[0.08]'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Phase Content */}
      <AnimatePresence mode="wait">
        {/* ═══ CONCEPT ═══ */}
        {viewPhase === 'concept' && (
          <motion.div key="concept" {...phaseTransition} className="space-y-6">
            {isLockedPhase('concept') ? (
              <div className="rounded-xl p-6 border border-white/[0.06]">
                <div className="flex items-center gap-2 mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-white" aria-hidden="true"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                  <h3 className="text-sm font-medium text-white">{project.lockedConcept?.conceptDirection}</h3>
                </div>
                <div className="grid grid-cols-3 gap-4 text-[13px]">
                  <div><span className="text-xs text-zinc-500 block uppercase tracking-wide mb-0.5">Deity</span><span className="text-white">{project.lockedConcept?.deity}</span></div>
                  <div><span className="text-xs text-zinc-500 block uppercase tracking-wide mb-0.5">Mood</span><span className="text-white">{project.lockedConcept?.mood}</span></div>
                  <div><span className="text-xs text-zinc-500 block uppercase tracking-wide mb-0.5">Direction</span><span className="text-white">{project.lockedConcept?.conceptDirection}</span></div>
                </div>
                <p className="text-zinc-400 mt-4 text-sm leading-relaxed">{project.lockedConcept?.theme}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-white mb-1">Choose a Creative Direction</h3>
                  <p className="text-zinc-500 text-[13px]">{project.conceptOptions.length} concepts generated. Pick one to proceed.</p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {project.conceptOptions.map((concept, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      whileHover={{ y: -2 }}
                      className="surface rounded-xl p-5 space-y-3 cursor-pointer group hover:shadow-lg hover:shadow-black/20"
                      onClick={() => !isLoading && onLockConcept(idx)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-white font-medium text-sm">{concept.conceptDirection}</span>
                        <span className="text-[10px] text-zinc-600 font-mono">{idx + 1}</span>
                      </div>
                      <div className="space-y-1.5 text-[13px]">
                        <div><span className="text-zinc-500">Deity:</span> <span className="text-zinc-300">{concept.deity}</span></div>
                        <div><span className="text-zinc-500">Mood:</span> <span className="text-zinc-300">{concept.mood}</span></div>
                        <p className="text-zinc-400 text-[13px] leading-relaxed">{concept.theme}</p>
                      </div>
                      <button disabled={isLoading} className="w-full py-2 bg-white/[0.06] text-zinc-300 rounded-md text-[11px] font-medium group-hover:bg-white group-hover:text-black transition-colors disabled:opacity-50">
                        {isLoading ? 'Locking...' : 'Choose'}
                      </button>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ═══ SCRIPT ═══ */}
        {viewPhase === 'script' && (
          <motion.div key="script" {...phaseTransition} className="space-y-6">
            {/* Director Settings */}
            <div className="surface rounded-xl p-5">
              <div className="flex gap-6 items-center flex-wrap">
                <div className="space-y-2 flex-1 min-w-[200px]">
                  <label className="text-[11px] uppercase font-medium text-zinc-500 tracking-wide">Director Mode</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onUpdateProject({ videoMode: 'montage' })}
                      className={`flex-1 py-2 rounded-md text-[11px] font-medium transition-colors ${project.videoMode === 'montage' ? 'bg-white text-black' : 'bg-obsidian-800 text-zinc-500 hover:text-zinc-300'}`}
                    >
                      Montage
                    </button>
                    <button
                      onClick={() => onUpdateProject({ videoMode: 'cinematic' })}
                      className={`flex-1 py-2 rounded-md text-[11px] font-medium transition-colors ${project.videoMode === 'cinematic' ? 'bg-white text-black' : 'bg-obsidian-800 text-zinc-500 hover:text-zinc-300'}`}
                    >
                      Cinematic
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] uppercase font-medium text-zinc-500 tracking-wide">Pacing</label>
                  <div className="flex gap-2">
                    {[5, 8, 10].map(d => (
                      <button
                        key={d}
                        onClick={() => onUpdateProject({ targetDuration: d })}
                        className={`px-4 py-2 rounded-md text-[11px] font-mono ${project.targetDuration === d ? 'bg-white text-black' : 'bg-obsidian-800 text-zinc-500 hover:text-zinc-300'} transition-colors`}
                      >
                        {d}s
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {project.scenes.length > 0 && (
                    <button
                      onClick={() => setShowScriptPrompt(s => !s)}
                      className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1"
                    >
                      {showScriptPrompt ? 'Hide prompt' : 'View prompt'}
                    </button>
                  )}
                  <button
                    onClick={() => { onGenerateScript(scriptNote || undefined); setScriptNote(''); }}
                    disabled={isLoading}
                    className="bg-white text-black px-6 py-2.5 rounded-md font-semibold text-sm hover:bg-zinc-200 disabled:opacity-50 flex items-center gap-2 transition-colors"
                  >
                    {isLoading && <div className="w-3.5 h-3.5 border-2 border-zinc-400 border-t-black rounded-full animate-spin"></div>}
                    {isLoading ? 'Writing...' : project.scenes.length > 0 ? 'Regenerate' : 'Generate Script'}
                  </button>
                </div>
              </div>

              {/* Note + prompt preview (shown after first generation) */}
              {project.scenes.length > 0 && (
                <div className="space-y-3 pt-2">
                  <input
                    value={scriptNote}
                    onChange={e => setScriptNote(e.target.value)}
                    placeholder="Regenerate note — e.g. 'make scene 3 more intimate' or 'add more deity close-ups'"
                    className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-600 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && scriptNote.trim()) {
                        onGenerateScript(scriptNote);
                        setScriptNote('');
                      }
                    }}
                  />
                  {showScriptPrompt && project.lastScriptPrompt && (
                    <pre className="surface-inset rounded-md p-3 text-[11px] text-zinc-400 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">{project.lastScriptPrompt}</pre>
                  )}
                </div>
              )}
            </div>

            {/* Loading — first gen */}
            {isLoading && project.scenes.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 space-y-3">
                <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin"></div>
                <p className="text-zinc-500 text-sm">Writing your script...</p>
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
                  <div className="flex items-center gap-4">
                    <button
                      className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
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
                    <span className="text-[11px] font-mono text-zinc-600">
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
                              <span className={`text-[10px] px-2 py-0.5 rounded-md ${
                                scene.sectionLabel.toLowerCase().includes('chorus')
                                  ? 'bg-amber-500/10 text-amber-400'
                                  : 'bg-white/[0.04] text-zinc-500'
                              }`}>
                                {scene.sectionLabel}
                              </span>
                              <span className="text-[10px] text-zinc-600">{scene.shots.length} shots</span>
                            </div>
                            <p className="text-zinc-500 text-[13px] truncate">{scene.narrativeDescription}</p>
                          </div>
                          <div className="flex items-center gap-3 ml-4 shrink-0">
                            <span className="text-[11px] font-mono text-zinc-600">{scene.startTime} - {scene.endTime}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                              className={`text-zinc-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                              <path d="M6 9l6 6 6-6"/>
                            </svg>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-4 space-y-2 border-t border-white/[0.04] pt-3">
                            {scene.lyrics && (
                              <p className="text-zinc-600 italic text-[13px] mb-3">"{scene.lyrics}"</p>
                            )}
                            {scene.shots.map((shot, sIdx) => (
                              <div key={shot.id} className="flex gap-3 p-3 surface-inset rounded-lg">
                                <div className="text-[11px] font-mono text-zinc-600 w-6 pt-0.5 shrink-0">S{sIdx + 1}</div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[13px] text-zinc-300 mb-1">{shot.visualPrompt || '—'}</div>
                                  {shot.motionPrompt && (
                                    <div className="text-[11px] text-zinc-500 mb-1">{shot.motionPrompt}</div>
                                  )}
                                  <div className="text-[11px] text-zinc-600 flex gap-3">
                                    <span>{shot.duration}s</span>
                                    <span>{shot.castIds.length > 0 ? shot.castIds.length + ' Cast' : 'No Cast'}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {project.scenes.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center h-48 text-zinc-600 text-sm">
                <p>Hit "Generate Script" to create a cinematic shot list.</p>
              </div>
            )}
          </motion.div>
        )}

        {/* ═══ STYLE ═══ */}
        {viewPhase === 'style' && (
          <motion.div key="style" {...phaseTransition} className="space-y-6">
            {isLockedPhase('style') ? (
              <div className="space-y-5">
                {!showExploredStyles ? (
                  /* ── Locked style overview ── */
                  <div className="rounded-xl overflow-hidden border border-white/[0.06]">
                    {/* Header bar */}
                    <div className="px-5 py-3 flex items-center justify-between border-b border-white/[0.06]">
                      <div className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-white" aria-hidden="true">
                          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                        </svg>
                        <h3 className="text-sm font-medium text-white">Locked Style</h3>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowExploredStyles(true)}
                          className="text-[11px] text-zinc-500 hover:text-white border border-white/[0.08] hover:border-white/20 px-3 py-1.5 rounded-md transition-colors"
                        >
                          Explore New
                        </button>
                        {project.status === 'style_locked' && (
                          <button
                            onClick={onUnlockStyle}
                            disabled={isLoading}
                            className="text-[11px] text-zinc-500 hover:text-red-400 border border-white/[0.08] hover:border-red-500/20 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
                          >
                            Unlock
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Side-by-side: image left, description right */}
                    <div className="flex flex-col md:flex-row">
                      {project.styleAssetUrl && (
                        <div className="md:w-2/5 flex-shrink-0 bg-black/20 cursor-zoom-in" onClick={() => setModalImage(project.styleAssetUrl!)}>
                          <img src={project.styleAssetUrl} alt="Locked style" className="w-full h-full object-cover" />
                        </div>
                      )}
                      <div className="flex-1 px-5 py-4 space-y-4">
                        <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Style DNA</h4>
                        <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{project.styleDescription}</p>
                        {project.status === 'style_locked' && (
                          <button
                            onClick={() => setViewPhase('characters')}
                            className="px-5 py-2 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 transition-colors"
                          >
                            Proceed to Characters
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── Explorer view (replaces locked overview) ── */
                  <div className="space-y-5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-white">Explore New Directions</h3>
                      <button
                        onClick={() => setShowExploredStyles(false)}
                        className="text-[11px] text-zinc-500 hover:text-white border border-white/[0.08] hover:border-white/20 px-3 py-1.5 rounded-md transition-colors"
                      >
                        Back to Style
                      </button>
                    </div>

                    {/* Current style thumbnail for reference */}
                    {project.styleAssetUrl && (
                      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-white/[0.06]">
                        <img src={project.styleAssetUrl} alt="Current style" className="w-16 h-16 rounded-md object-cover cursor-zoom-in" onClick={() => setModalImage(project.styleAssetUrl!)} />
                        <div>
                          <span className="text-xs text-zinc-500">Current locked style</span>
                          <p className="text-sm text-zinc-300 line-clamp-1 mt-0.5">{project.styleDescription?.slice(0, 80)}…</p>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3">
                      <input
                        value={brainstormNotes}
                        onChange={(e) => setBrainstormNotes(e.target.value)}
                        placeholder="Style preferences..."
                        className="flex-1 surface-inset rounded-md px-4 py-2.5 text-sm text-white outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                        onKeyDown={(e) => { if (e.key === 'Enter') handleBrainstorm(); }}
                      />
                      <button
                        onClick={handleBrainstorm}
                        disabled={isBrainstorming}
                        className="px-5 py-2.5 bg-white text-black rounded-md text-[11px] font-semibold hover:bg-zinc-200 disabled:opacity-50 whitespace-nowrap transition-colors"
                      >
                        {isBrainstorming ? 'Thinking...' : styleSlots.length > 0 ? 'Regenerate' : 'Brainstorm'}
                      </button>
                    </div>

                    {isBrainstorming && styleSlots.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-40 space-y-3">
                        <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin"></div>
                        <p className="text-zinc-500 text-sm">Brainstorming...</p>
                      </div>
                    )}

                    {styleSlots.length > 0 && (
                      <div className="space-y-3">
                        {styleSlots.map((slot, idx) => (
                          <StyleRow
                            key={idx}
                            slot={slot}
                            index={idx}
                            expanded={expandedStyleIdx === idx}
                            onToggle={() => setExpandedStyleIdx(prev => prev === idx ? null : idx)}
                            onVisualize={() => handleVisualize(idx)}
                            onLock={() => handleLockSlot(slot)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="surface rounded-xl p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-white mb-1">Art Style Exploration</h3>
                    <p className="text-zinc-500 text-[13px]">
                      Claude brainstorms 4 visual directions. You choose which to visualize as images.
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <input
                      value={brainstormNotes}
                      onChange={(e) => setBrainstormNotes(e.target.value)}
                      placeholder="Style preferences... e.g. 'painterly', 'dark and moody', 'Ravi Varma inspired'"
                      className="flex-1 surface-inset rounded-md px-4 py-2.5 text-sm text-white outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleBrainstorm(); }}
                    />
                    <button
                      onClick={handleBrainstorm}
                      disabled={isBrainstorming}
                      className="px-5 py-2.5 bg-white text-black rounded-md text-[11px] font-semibold hover:bg-zinc-200 disabled:opacity-50 whitespace-nowrap transition-colors"
                    >
                      {isBrainstorming ? 'Thinking...' : styleSlots.length > 0 ? 'Regenerate' : 'Brainstorm 4 Directions'}
                    </button>
                  </div>
                </div>

                {isBrainstorming && styleSlots.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-40 space-y-3">
                    <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin"></div>
                    <p className="text-zinc-500 text-sm">Brainstorming visual directions...</p>
                  </div>
                )}

                {styleSlots.length > 0 && (
                  <div className="space-y-3">
                    {styleSlots.map((slot, idx) => (
                      <StyleRow
                        key={`ai-${idx}-${slot.title}`}
                        slot={slot}
                        index={idx}
                        expanded={expandedStyleIdx === idx}
                        onToggle={() => setExpandedStyleIdx(prev => prev === idx ? null : idx)}
                        onVisualize={() => handleVisualize(idx)}
                        onLock={() => handleLockSlot(slot)}
                      />
                    ))}

                    {/* Custom slot */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.[0]) handleUploadReference(e.target.files[0]);
                      }}
                    />
                    {!showCustomSlot ? (
                      <button
                        onClick={() => setShowCustomSlot(true)}
                        className="w-full py-3 rounded-xl border border-dashed border-white/[0.1] text-sm text-zinc-500 hover:text-zinc-300 hover:border-white/20 transition-colors"
                      >
                        + Add Custom Direction
                      </button>
                    ) : (
                      <div className="rounded-xl overflow-hidden border border-white/[0.06]">
                        <div className="px-5 py-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium text-white">Your Vision</h4>
                            <div className="flex gap-2">
                              <button
                                onClick={() => fileInputRef.current?.click()}
                                className="text-xs bg-white/[0.06] hover:bg-white/[0.1] px-3 py-1.5 rounded-md text-zinc-400 transition-colors"
                              >
                                Upload Reference
                              </button>
                              <button
                                onClick={() => setShowCustomSlot(false)}
                                className="text-xs text-zinc-600 hover:text-zinc-400 px-2 py-1.5 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                          <textarea
                            value={userSlot.description}
                            onChange={(e) => setUserSlot(prev => ({ ...prev, description: e.target.value }))}
                            placeholder="Describe your visual style direction…"
                            className="w-full h-20 surface-inset rounded-md p-3 text-sm text-zinc-300 outline-none focus-visible:ring-1 focus-visible:ring-white/20 resize-none leading-relaxed"
                          />
                          <button
                            onClick={() => handleVisualize(0, true)}
                            disabled={!userSlot.description || userSlot.isGenerating}
                            className="px-5 py-2 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                          >
                            {userSlot.isGenerating ? 'Generating…' : userSlot.imageUrl ? 'Re-visualize' : 'Visualize'}
                          </button>
                        </div>

                        {(userSlot.isGenerating || userSlot.imageUrl) && (
                          <div className="border-t border-white/[0.06]">
                            {userSlot.isGenerating ? (
                              <div className="h-64 skeleton flex items-center justify-center">
                                <div className="w-6 h-6 border-2 border-zinc-600 border-t-white rounded-full animate-spin"></div>
                              </div>
                            ) : (
                              <div className="relative group">
                                <img src={userSlot.imageUrl} className="w-full h-auto max-h-[400px] object-contain mx-auto cursor-zoom-in" onClick={() => setModalImage(userSlot.imageUrl!)} />
                                {userSlot.assetId && (
                                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                    <button
                                      onClick={() => handleLockSlot(userSlot)}
                                      disabled={isLocking}
                                      className="bg-white text-black px-5 py-2.5 rounded-md text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50"
                                    >
                                      {isLocking ? 'Locking…' : 'Lock This Style'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {!isBrainstorming && styleSlots.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-40 space-y-2 text-zinc-600">
                    <p className="text-sm">Hit "Brainstorm 4 Directions" to explore visual styles.</p>
                    <p className="text-[11px]">Or type preferences first to guide the brainstorm.</p>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* ═══ CHARACTERS ═══ */}
        {viewPhase === 'characters' && (
          <motion.div key="characters" {...phaseTransition} className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Cast sidebar */}
              <div className="lg:col-span-3">
                <div className="surface rounded-xl p-4 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-medium text-zinc-500 uppercase tracking-wide">Cast</h3>
                    <button onClick={() => onAddCast('New Character', 'Description...')} className="text-xs bg-white/[0.06] hover:bg-white/[0.1] text-zinc-400 px-2.5 py-1 rounded-md transition-colors">+ Add</button>
                  </div>
                  <div className="space-y-1 overflow-y-auto max-h-[500px] pr-1">
                    {project.cast.map(member => {
                      const isActive = activeCastId === member.id;
                      const hasLook = !!member.referenceImageUrl;
                      return (
                        <button
                          key={member.id}
                          onClick={() => setActiveCastId(member.id)}
                          className={`w-full text-left p-2.5 rounded-lg cursor-pointer transition-colors flex gap-3 items-center ${
                            isActive ? 'bg-white/[0.08] border-l-2 border-l-accent-400' : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
                          }`}
                        >
                          <div className={`w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 ${hasLook ? '' : 'bg-white/[0.04]'}`}>
                            {member.referenceImageUrl ? (
                              <img src={member.referenceImageUrl} alt={member.name} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm">?</div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-white line-clamp-2 leading-snug">{member.name}</div>
                            <div className="text-xs text-zinc-500 truncate flex items-center gap-1">
                              {looksLoading.has(member.id) ? (
                                <><div className="w-3 h-3 border border-zinc-600 border-t-white rounded-full animate-spin"></div> Generating…</>
                              ) : hasLook ? (
                                <><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-white flex-shrink-0" aria-hidden="true"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg> Look set</>
                              ) : 'No look'}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {project.cast.length > 0 && project.status === 'style_locked' && (
                    <button
                      onClick={() => project.cast.filter(c => !c.referenceImageUrl).forEach(c => onGenerateLooks(c.id))}
                      disabled={looksLoading.size > 0}
                      className="w-full py-2 bg-white text-black rounded-md text-[11px] font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                    >
                      {looksLoading.size > 0 ? `Generating ${looksLoading.size}...` : 'Generate All Looks'}
                    </button>
                  )}

                  {project.status === 'style_locked' && (
                    <button
                      onClick={onAdvanceCharacters}
                      className={`w-full py-2 rounded-md text-xs font-semibold transition-colors ${
                        project.cast.some(c => c.referenceImageUrl)
                          ? 'bg-white text-black hover:bg-zinc-200'
                          : 'bg-white/[0.06] text-zinc-400 hover:bg-white/[0.1] hover:text-white border border-white/[0.08]'
                      }`}
                    >
                      {project.cast.some(c => c.referenceImageUrl) ? 'Proceed to Environments' : 'Skip — Proceed to Environments'}
                    </button>
                  )}
                </div>
              </div>

              {/* Character detail */}
              <div className="lg:col-span-9">
                {activeMember ? (
                  <div key={activeMember.id} className="rounded-xl overflow-hidden border border-white/[0.06]">
                    {/* Header bar — name, status, actions */}
                    <div className="px-5 py-3 flex items-center justify-between border-b border-white/[0.06]">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <input
                          key={`name-${activeMember.id}`}
                          defaultValue={activeMember.name}
                          onBlur={(e) => onUpdateCast(activeMember.id, { name: e.target.value })}
                          className="text-sm font-medium text-white bg-transparent outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded px-1 -ml-1 max-w-[200px]"
                        />
                        {activeMember.referenceImageUrl && (
                          <span className="text-xs text-zinc-400 flex items-center gap-1">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-white" aria-hidden="true"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                            Locked
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const feedbackEl = document.getElementById(`char-feedback-${activeMember.id}`) as HTMLInputElement;
                            onGenerateLooks(activeMember.id, feedbackEl?.value || undefined);
                          }}
                          disabled={looksLoading.has(activeMember.id)}
                          className="px-4 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                        >
                          {looksLoading.has(activeMember.id) ? 'Generating…' : activeMember.referenceImageUrl ? 'Regenerate' : 'Generate Looks'}
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete "${activeMember.name}"?`)) {
                              onDeleteCast(activeMember.id);
                              setActiveCastId(project.cast.find(c => c.id !== activeMember.id)?.id || null);
                            }
                          }}
                          className="text-zinc-600 hover:text-red-400 p-1.5 rounded-md transition-colors"
                          aria-label={`Delete ${activeMember.name}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/></svg>
                        </button>
                        <button
                          onClick={() => setPromptPreview(prev => prev === activeMember.id ? null : activeMember.id)}
                          className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                        >
                          {promptPreview === activeMember.id ? 'Hide prompt' : 'View prompt'}
                        </button>
                      </div>
                    </div>

                    {/* Prompt preview */}
                    {promptPreview === activeMember.id && (
                      <div className="px-5 py-3 border-b border-white/[0.06] flex items-start gap-3">
                        {project.styleAssetUrl && (
                          <div className="relative flex-shrink-0">
                            <img src={project.styleAssetUrl} className="w-12 h-12 object-cover rounded border border-white/[0.06]" alt="Style ref" />
                            <div className="absolute inset-x-0 bottom-0 bg-black/80 text-[8px] text-zinc-400 text-center rounded-b">Style</div>
                          </div>
                        )}
                        <pre className="flex-1 text-[10px] text-zinc-500 font-mono whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">{
`${activeMember.name} — ${activeMember.description || '(no description)'}

Mid-shot portrait, upper body and face visible.
Style: ${project.styleDescription?.substring(0, 120) || '(none)'}…

→ Model: gemini-3-pro-image-preview
→ 3 parallel calls, same prompt`
                        }</pre>
                      </div>
                    )}

                    {/* Hero area — locked image, look candidates, loading, or empty */}
                    {activeMember.referenceImageUrl ? (
                      <div className="relative cursor-zoom-in bg-black/20" onClick={() => setModalImage(activeMember.referenceImageUrl!)}>
                        <img src={activeMember.referenceImageUrl} alt={activeMember.name} className="w-full h-auto max-h-[500px] object-contain mx-auto" />
                      </div>
                    ) : looksLoading.has(activeMember.id) && activeLooks.length === 0 ? (
                      <div className="h-64 flex items-center justify-center bg-black/20">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-6 h-6 border-2 border-zinc-600 border-t-white rounded-full animate-spin"></div>
                          <span className="text-sm text-zinc-500">Generating looks…</span>
                        </div>
                      </div>
                    ) : activeLooks.length > 0 ? (
                      <div className="grid grid-cols-3 gap-px bg-black/20">
                        {activeLooks.map((look) => (
                          <div key={look.id} className="relative group cursor-pointer bg-black/10">
                            <img src={look.url} alt={activeMember.name} onClick={() => setModalImage(look.url)} className="w-full h-auto object-contain" />
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity pointer-events-none">
                              <button onClick={() => onLockCharacter(activeMember.id, look.id)} className="pointer-events-auto bg-white text-black px-4 py-2 rounded-md text-sm font-semibold hover:bg-zinc-200 transition-colors">Lock This Look</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-48 flex items-center justify-center bg-black/10">
                        <span className="text-sm text-zinc-500">No reference yet — generate looks below</span>
                      </div>
                    )}

                    {/* Bottom — description + feedback */}
                    <div className="px-5 py-4 space-y-3 border-t border-white/[0.06]">
                      <div
                        key={`desc-${activeMember.id}`}
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={(e) => onUpdateCast(activeMember.id, { description: e.currentTarget.textContent || '' })}
                        className="text-sm text-zinc-300 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded px-1 -mx-1"
                      >
                        {activeMember.description}
                      </div>
                      <input
                        key={`feedback-${activeMember.id}`}
                        placeholder="Feedback — e.g. 'make the crown bigger'"
                        className="w-full surface-inset rounded-md px-3 py-2.5 text-sm text-zinc-300 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                        autoComplete="off"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onGenerateLooks(activeMember.id, (e.target as HTMLInputElement).value || undefined);
                          }
                        }}
                        id={`char-feedback-${activeMember.id}`}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="surface rounded-xl p-8 h-full flex items-center justify-center text-zinc-600 text-sm">
                    Select a cast member.
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* ═══ ENVIRONMENTS ═══ */}
        {viewPhase === 'environments' && (
          <motion.div key="environments" {...phaseTransition} className="space-y-6">
            {project.environments.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Env sidebar */}
                <div className="lg:col-span-3">
                  <div className="surface rounded-xl p-4 space-y-4">
                    <h3 className="text-sm font-medium text-zinc-500 uppercase tracking-wide">Environments</h3>
                    <div className="space-y-1 overflow-y-auto max-h-[500px] pr-1">
                      {project.environments.map(env => {
                        const isActive = activeEnvId === env.id;
                        const hasLook = !!env.referenceImageUrl;
                        return (
                          <button
                            key={env.id}
                            onClick={() => setActiveEnvId(env.id)}
                            className={`w-full text-left p-2.5 rounded-lg cursor-pointer transition-colors flex gap-3 items-center ${
                              isActive ? 'bg-white/[0.08] border-l-2 border-l-accent-400' : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
                            }`}
                          >
                            <div className={`w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 ${hasLook ? '' : 'bg-white/[0.04]'}`}>
                              {env.referenceImageUrl ? (
                                <img src={env.referenceImageUrl} alt={env.name} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm">?</div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-white line-clamp-2 leading-snug">{env.name}</div>
                              <div className="text-xs text-zinc-500 truncate flex items-center gap-1">
                                {envGenerating.has(env.id) ? (
                                  <><div className="w-3 h-3 border border-zinc-600 border-t-white rounded-full animate-spin"></div> Generating…</>
                                ) : hasLook ? (
                                  <><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-white flex-shrink-0" aria-hidden="true"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg> Look set</>
                                ) : 'No look'}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {project.status === 'characters_locked' && (
                      <button
                        onClick={onAdvanceEnvironments}
                        className="w-full py-2 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 transition-colors"
                      >
                        Proceed to Studio
                      </button>
                    )}
                  </div>
                </div>

                {/* Environment detail */}
                <div className="lg:col-span-9">
                  {activeEnv ? (
                    <div key={activeEnv.id} className="rounded-xl overflow-hidden border border-white/[0.06]">
                      {/* Header bar — name, status, actions */}
                      <div className="px-5 py-3 flex items-center justify-between border-b border-white/[0.06]">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="text-sm font-medium text-white">{activeEnv.name}</span>
                          {activeEnv.referenceImageUrl && (
                            <span className="text-xs text-zinc-400 flex items-center gap-1">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-white" aria-hidden="true"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                              Locked
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleEnvGenerate(activeEnv.id)}
                            disabled={envGenerating.has(activeEnv.id)}
                            className="px-4 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                          >
                            {envGenerating.has(activeEnv.id) ? 'Generating…' : activeEnv.referenceImageUrl ? 'Regenerate' : 'Generate Looks'}
                          </button>
                          <button
                            onClick={() => setPromptPreview(prev => prev === activeEnv.id ? null : activeEnv.id)}
                            className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                          >
                            {promptPreview === activeEnv.id ? 'Hide prompt' : 'View prompt'}
                          </button>
                        </div>
                      </div>

                      {/* Prompt preview */}
                      {promptPreview === activeEnv.id && (
                        <div className="px-5 py-3 border-b border-white/[0.06] flex items-start gap-3">
                          {project.styleAssetUrl && (
                            <div className="relative flex-shrink-0">
                              <img src={project.styleAssetUrl} className="w-12 h-12 object-cover rounded border border-white/[0.06]" alt="Style ref" />
                              <div className="absolute inset-x-0 bottom-0 bg-black/80 text-[8px] text-zinc-400 text-center rounded-b">Style</div>
                            </div>
                          )}
                          <pre className="flex-1 text-[10px] text-zinc-500 font-mono whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">{
`${activeEnv.name} — ${activeEnv.description || '(no description)'}

Wide establishing shot, no characters.
Style: ${project.styleDescription?.substring(0, 120) || '(none)'}…

→ Model: gemini-3-pro-image-preview
→ 3 parallel calls, same prompt`
                          }</pre>
                        </div>
                      )}

                      {/* Hero area — locked image, look candidates, loading, or empty */}
                      {activeEnv.referenceImageUrl ? (
                        <div className="relative cursor-zoom-in bg-black/20" onClick={() => setModalImage(activeEnv.referenceImageUrl!)}>
                          <img src={activeEnv.referenceImageUrl} alt={activeEnv.name} className="w-full h-auto max-h-[500px] object-contain mx-auto" />
                        </div>
                      ) : envGenerating.has(activeEnv.id) && activeEnvLooks.length === 0 ? (
                        <div className="h-64 flex items-center justify-center bg-black/20">
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-6 h-6 border-2 border-zinc-600 border-t-white rounded-full animate-spin"></div>
                            <span className="text-sm text-zinc-500">Generating looks…</span>
                          </div>
                        </div>
                      ) : activeEnvLooks.length > 0 ? (
                        <div className="grid grid-cols-3 gap-px bg-black/20">
                          {activeEnvLooks.map(look => (
                            <div key={look.id} className="relative group cursor-pointer bg-black/10">
                              <img src={look.url} alt={activeEnv.name} onClick={() => setModalImage(look.url)} className="w-full h-auto object-contain" />
                              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity pointer-events-none">
                                <button onClick={() => handleEnvLock(activeEnv.id, look.id)} className="pointer-events-auto bg-white text-black px-4 py-2 rounded-md text-sm font-semibold hover:bg-zinc-200 transition-colors">Lock This Look</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="h-48 flex items-center justify-center bg-black/10">
                          <span className="text-sm text-zinc-500">No reference yet — generate looks above</span>
                        </div>
                      )}

                      {/* Bottom — description */}
                      <div className="px-5 py-4 border-t border-white/[0.06]">
                        <div
                          key={`env-desc-${activeEnv.id}`}
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={async (e) => {
                            try {
                              const res = await fetch(`/api/projects/${project.id}/environments/${activeEnv.id}`, {
                                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ name: activeEnv.name, description: e.currentTarget.textContent || '' }),
                              });
                              if (res.ok) onSetProject?.(await res.json());
                            } catch {}
                          }}
                          className="text-sm text-zinc-300 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded px-1 -mx-1"
                        >
                          {activeEnv.description}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="surface rounded-xl p-8 h-full flex items-center justify-center text-zinc-600 text-sm">
                      Select an environment.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-white/[0.06] p-8 text-center">
                <p className="text-zinc-500 mb-4 text-sm">No environments proposed by the script.</p>
                <button
                  onClick={onAdvanceEnvironments}
                  className="px-6 py-2.5 bg-white text-black rounded-md text-sm font-semibold hover:bg-zinc-200 transition-colors"
                >
                  Skip — Proceed to Studio
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modalImage && <ImageModal src={modalImage} onClose={() => setModalImage(null)} />}
      </AnimatePresence>
    </div>
  );
};
