
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ApiProject, ConceptOption, CastMember, Environment, VideoMode } from '../types';
import * as api from '../services/api';
import { ImageModal } from './ImageModal';
import { Markdown } from './Markdown';
import { VIDEO_MODELS, getVideoModel } from '../constants/videoModels';

// StyleRow must live at module scope (not inside AnalysisEditor's body) —
// otherwise every parent re-render creates a new component reference and
// unmounts/remounts all rows on every keystroke, causing jerky animations
// and textarea flicker.
interface StyleSlotType { title: string; description: string; imageUrl?: string; assetId?: string; isGenerating?: boolean; isRefining?: boolean; }
interface StyleRowProps {
  slot: StyleSlotType;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onVisualize: () => void;
  onLock: () => void;
  onRefine: (text: string) => void;
  onOpenModal: (url: string) => void;
  isLocking: boolean;
}
const StyleRow: React.FC<StyleRowProps> = React.memo(({ slot, index, expanded, onToggle, onVisualize, onLock, onRefine, onOpenModal, isLocking }) => {
  const [refineInput, setRefineInput] = useState('');

  return (
    <div className="rounded-xl overflow-hidden border border-white/[0.06]">
      {/* Collapsed row — always visible */}
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-4 min-w-0 flex-1">
          {slot.imageUrl ? (
            <img src={slot.imageUrl} alt={slot.title} className="w-14 h-14 rounded-md object-cover flex-shrink-0" />
          ) : (
            <div className="w-14 h-14 rounded-md surface-inset flex items-center justify-center flex-shrink-0">
              <span className="text-[11px] text-zinc-400 uppercase tracking-wide">#{index + 1}</span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-medium text-white">{slot.title || 'Untitled'}</h4>
            {!expanded && (
              <p className="text-xs text-zinc-400 line-clamp-1 mt-0.5">{slot.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          {slot.isGenerating && (
            <div className="w-3.5 h-3.5 border-2 border-zinc-600 border-t-white rounded-full animate-spin"></div>
          )}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 text-zinc-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>
            <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
          </svg>
        </div>
      </button>

      {/* Expanded content — instant show/hide, no height animation (too jerky). */}
      {expanded && (
        <div className="border-t border-white/[0.06]">
          {(slot.isGenerating || slot.imageUrl) && (
            <div className="bg-black/20">
              {slot.isGenerating ? (
                <div className="h-56 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-zinc-600 border-t-white rounded-full animate-spin"></div>
                </div>
              ) : (
                <div className="relative group">
                  <img src={slot.imageUrl} onClick={() => onOpenModal(slot.imageUrl!)} className="w-full h-auto max-h-[360px] object-contain mx-auto cursor-zoom-in" alt={slot.title} />
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpenModal(slot.imageUrl!); }}
                    className="absolute top-3 right-3 p-1.5 rounded-md bg-black/40 backdrop-blur-sm text-zinc-300 hover:text-white hover:bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="View full screen"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                    </svg>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onLock(); }}
                    disabled={isLocking}
                    className="absolute bottom-3 right-3 bg-white/95 backdrop-blur-sm text-black px-3.5 py-1.5 rounded-md text-xs font-semibold hover:bg-white transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-lg shadow-black/30"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    {isLocking ? 'Locking…' : 'Lock style'}
                  </button>
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
                  if (e.key === 'Enter' && refineInput) { onRefine(refineInput); setRefineInput(''); }
                }}
              />
              <button
                onClick={() => { onRefine(refineInput); setRefineInput(''); }}
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
      )}
    </div>
  );
});
StyleRow.displayName = 'StyleRow';

// Standardized unlock affordance — same icon, same hover style, consistent position across phases.
const UnlockPill: React.FC<{ onClick: () => void; disabled?: boolean; label?: string }> = ({ onClick, disabled, label = 'Unlock' }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="text-[11px] text-zinc-400 hover:text-white hover:bg-white/[0.06] border border-white/[0.08] hover:border-white/20 px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
    title="Unlock this phase to make changes"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
    </svg>
    {label}
  </button>
);

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
  onConfirmDestructive?: (opts: { title: string; description: string; confirmLabel?: string; run: () => any }) => void;
  onGenerateScript: (userNote?: string) => void;
  onGenerateConcepts?: (opts?: { userNote?: string }) => void;
  onUnlockConcept?: () => void;
  onUnlockScript?: () => void;
  onUnlockCharacters?: () => void;
  onUnlockEnvironments?: () => void;
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
  onGenerateScript, onGenerateConcepts, onUnlockConcept, onUnlockScript, onUnlockCharacters, onUnlockEnvironments, onUpdateProject, onLaunchStudio, onAdvanceCharacters, onAdvanceEnvironments, onSetProject, onConfirmDestructive,
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
  const [expandedStyleIdxs, setExpandedStyleIdxs] = useState<Set<number>>(new Set());
  const toggleStyleIdx = (idx: number) => {
    setExpandedStyleIdxs(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };
  const [showCustomSlot, setShowCustomSlot] = useState(true);
  const [uploadedStyleFile, setUploadedStyleFile] = useState<File | null>(null);
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [showSongAnalysis, setShowSongAnalysis] = useState(false);
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState(false);

  const handleRerunAnalysis = async () => {
    setIsAnalyzingAudio(true);
    try {
      const updated = await api.analyzeAudio(project.id);
      onSetProject?.(updated);
    } catch (err: any) {
      console.error('Re-analysis failed:', err);
    } finally {
      setIsAnalyzingAudio(false);
    }
  };

  // Environment look state
  const [envLooks, setEnvLooks] = useState<Record<string, { id: string; url: string }[]>>({});
  const [envGenerating, setEnvGenerating] = useState<Set<string>>(new Set());
  const [promptPreview, setPromptPreview] = useState<string | null>(null); // entity id
  const [scriptNote, setScriptNote] = useState('');
  const [showScriptPrompt, setShowScriptPrompt] = useState(false);
  const [conceptNote, setConceptNote] = useState('');
  const [showConceptPrompt, setShowConceptPrompt] = useState(false);

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
    setUploadedStyleFile(file);
    setUserSlot(prev => ({ ...prev, imageUrl: URL.createObjectURL(file) }));
    try {
      const result = await api.analyzeStyleImage(project.id, file);
      const styleDesc = result.styleDescription || '';
      setUserSlot(prev => ({
        ...prev,
        title: 'Uploaded Reference',
        description: styleDesc,
        imageUrl: prev.imageUrl || URL.createObjectURL(file),
      }));
    } catch (err: any) {
      console.error('Upload analysis failed:', err);
    }
  };

  const handleLockUploadedDirect = async () => {
    if (!uploadedStyleFile) return;
    setIsLocking(true);
    try {
      const updated = await api.uploadAndLockStyle(project.id, uploadedStyleFile);
      onSetProject?.(updated);
    } catch (err: any) {
      console.error('Direct lock failed:', err);
    } finally {
      setIsLocking(false);
    }
  };


  // ─── Phase content animation wrapper ─────────────────────────────

  const phaseTransition = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    transition: { duration: 0.2 },
  };

  const hasGeneratedMedia = !!project.styleAssetUrl
    || project.cast.some(c => c.referenceImageUrl)
    || project.environments.some(e => e.referenceImageUrl);

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

      {/* Render settings — toolbar: 3 equal cells with dividers, plus a title column */}
      <div className="surface rounded-xl overflow-hidden">
        <div className="flex items-stretch divide-x divide-white/[0.06]">
          {/* Title cell */}
          <div className="flex items-center gap-2 px-5 py-3 flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span className="text-[11px] uppercase tracking-wide text-zinc-400">Render</span>
          </div>

          {/* Aspect */}
          <label className="flex-1 px-5 py-3 space-y-1 hover:bg-white/[0.01] transition-colors cursor-pointer group">
            <div className="text-[11px] uppercase tracking-wide text-zinc-400">Aspect</div>
            <div className="relative">
              <select
                value={project.aspectRatio || '16:9'}
                onChange={e => onUpdateProject({ aspectRatio: e.target.value })}
                disabled={hasGeneratedMedia}
                title={hasGeneratedMedia ? 'Aspect is locked once images are generated — unlock phases and regenerate to change' : undefined}
                className="w-full bg-transparent text-sm text-zinc-300 outline-none cursor-pointer disabled:opacity-50 appearance-none pr-5"
              >
                <option value="16:9">16:9 — landscape</option>
                <option value="9:16">9:16 — portrait</option>
                <option value="1:1">1:1 — square</option>
              </select>
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="absolute right-0 top-1/2 -translate-y-1/2 text-zinc-400 group-hover:text-zinc-300 transition-colors pointer-events-none" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
          </label>

          {/* Video resolution */}
          <label className="flex-1 px-5 py-3 space-y-1 hover:bg-white/[0.01] transition-colors cursor-pointer group">
            <div className="text-[11px] uppercase tracking-wide text-zinc-400">Resolution</div>
            <div className="relative">
              <select
                value={project.videoResolution || '720p'}
                onChange={e => onUpdateProject({ videoResolution: e.target.value })}
                className="w-full bg-transparent text-sm text-zinc-300 outline-none cursor-pointer appearance-none pr-5"
              >
                <option value="720p">720p (HD)</option>
                <option value="1080p">1080p (Full HD)</option>
              </select>
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="absolute right-0 top-1/2 -translate-y-1/2 text-zinc-400 group-hover:text-zinc-300 transition-colors pointer-events-none" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
          </label>

          {/* Video model */}
          <label className="flex-[1.5] px-5 py-3 space-y-1 hover:bg-white/[0.01] transition-colors cursor-pointer group">
            <div className="text-[11px] uppercase tracking-wide text-zinc-400">Video model</div>
            <div className="relative">
              <select
                value={project.videoModel || VIDEO_MODELS[0].key}
                onChange={e => {
                  const newModel = getVideoModel(e.target.value);
                  const updates: Record<string, any> = { videoModel: e.target.value };
                  // Clamp pacing to a valid duration for the new model.
                  if (!newModel.durations.includes(project.targetDuration)) {
                    updates.targetDuration = newModel.durations[0];
                  }
                  onUpdateProject(updates);
                }}
                className="w-full bg-transparent text-sm text-zinc-300 outline-none cursor-pointer appearance-none truncate pr-5"
              >
                {VIDEO_MODELS.map(m => (
                  <option key={m.key} value={m.key}>{m.label}{m.note ? ` — ${m.note}` : ''}</option>
                ))}
              </select>
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="absolute right-0 top-1/2 -translate-y-1/2 text-zinc-400 group-hover:text-zinc-300 transition-colors pointer-events-none" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
          </label>
        </div>
      </div>

      {/* Song analysis — Gemini's read on lyrics, meaning, musical structure */}
      {(project.meaning || project.musicalStructure?.length > 0 || project.lyrics) && (() => {
        const needsAnalysis = !project.meaning || !(project.musicalStructure?.length > 0);
        return (
        <div className="surface rounded-xl">
          <div className="w-full px-5 py-3 flex items-center justify-between gap-3">
            <button
              onClick={() => setShowSongAnalysis(s => !s)}
              className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity flex-1 min-w-0"
            >
              <span className="text-[11px] uppercase tracking-wide text-zinc-400">Song analysis</span>
              {/* Explicit pills — what's captured, what's missing */}
              <span className="flex items-center gap-1.5 flex-wrap">
                {(() => {
                  const items = [
                    { label: 'Lyrics', present: !!project.lyrics },
                    { label: `Structure${project.musicalStructure?.length > 0 ? ` · ${project.musicalStructure.length} section${project.musicalStructure.length === 1 ? '' : 's'}` : ''}`, present: project.musicalStructure?.length > 0 },
                    { label: 'Meaning', present: !!project.meaning },
                  ];
                  return items.map(it => (
                    <span
                      key={it.label}
                      className={`text-[11px] px-2 py-0.5 rounded border ${
                        it.present
                          ? 'text-zinc-300 border-white/[0.08] bg-white/[0.03]'
                          : 'text-amber-300/80 border-amber-300/20 bg-amber-300/[0.04]'
                      }`}
                    >
                      {it.present ? '✓ ' : '— '}{it.label}
                    </span>
                  ));
                })()}
              </span>
            </button>
            <div className="flex items-center gap-3 flex-shrink-0">
              {needsAnalysis && (
                <button
                  onClick={handleRerunAnalysis}
                  disabled={isAnalyzingAudio}
                  className="text-[11px] bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-300 hover:text-white px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2"
                  title="Run detect-structure (Gemini) + summarize-meaning (Claude) on this project's audio"
                >
                  {isAnalyzingAudio && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>}
                  {isAnalyzingAudio ? 'Analyzing…' : 'Run analysis'}
                </button>
              )}
              <button onClick={() => setShowSongAnalysis(s => !s)} className="text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors">
                {showSongAnalysis ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          {showSongAnalysis && (
            <div className="px-5 pb-5 space-y-4 border-t border-white/[0.04] pt-4">
              {project.meaning && (
                <div>
                  <h4 className="text-[11px] uppercase tracking-wide text-zinc-400 mb-2">Meaning</h4>
                  <Markdown>{project.meaning}</Markdown>
                </div>
              )}
              {project.musicalStructure?.length > 0 && (
                <div>
                  <h4 className="text-[11px] uppercase tracking-wide text-zinc-400 mb-2">Musical structure</h4>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                    {project.musicalStructure.map((section, idx) => (
                      <div key={idx} className="surface-inset rounded-md px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white font-medium truncate">{section.label}</span>
                          <span className="text-[11px] text-zinc-400 font-mono flex-shrink-0">{section.startTime}–{section.endTime}</span>
                        </div>
                        {section.description && (
                          <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2">{section.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {project.lyrics && (
                <div>
                  <h4 className="text-[11px] uppercase tracking-wide text-zinc-400 mb-2">Lyrics</h4>
                  <pre className="surface-inset rounded-md p-3 text-xs text-zinc-300 font-sans whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">{project.lyrics}</pre>
                </div>
              )}
            </div>
          )}
        </div>
        );
      })()}

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
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white/[0.08] text-white'
                    : locked
                      ? 'text-zinc-300 hover:text-white'
                      : accessible
                        ? 'text-zinc-400 hover:text-zinc-300'
                        : 'text-zinc-400 cursor-not-allowed'
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
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-white" aria-hidden="true"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                    <h3 className="text-sm font-medium text-white">{project.lockedConcept?.conceptDirection}</h3>
                  </div>
                  {onUnlockConcept && (
                    <UnlockPill onClick={onUnlockConcept} disabled={isLoading} />
                  )}
                </div>
                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div><span className="text-xs text-zinc-400 block uppercase tracking-wide mb-0.5">Deity</span><span className="text-white">{project.lockedConcept?.deity}</span></div>
                  <div><span className="text-xs text-zinc-400 block uppercase tracking-wide mb-0.5">Mood</span><span className="text-white">{project.lockedConcept?.mood}</span></div>
                  <div><span className="text-xs text-zinc-400 block uppercase tracking-wide mb-0.5">Direction</span><span className="text-white">{project.lockedConcept?.conceptDirection}</span></div>
                </div>
                <p className="text-zinc-400 mt-4 text-sm leading-relaxed">{project.lockedConcept?.theme}</p>
              </div>
            ) : project.conceptOptions.length === 0 ? (
              /* Empty state — first-time generate */
              <div className="surface rounded-xl p-10 flex flex-col items-center justify-center text-center space-y-4">
                <h3 className="text-sm font-medium text-white">No concepts yet</h3>
                <p className="text-zinc-400 text-xs max-w-md">Claude will propose 3 creative directions based on the song's lyrics, mood, and musical structure.</p>
                {onGenerateConcepts && (
                  <button
                    onClick={() => onGenerateConcepts()}
                    disabled={isLoading}
                    className="bg-white text-black px-6 py-2.5 rounded-md font-semibold text-sm hover:bg-zinc-200 disabled:opacity-50 flex items-center gap-2 transition-colors"
                  >
                    {isLoading && <div className="w-3.5 h-3.5 border-2 border-zinc-400 border-t-black rounded-full animate-spin"></div>}
                    {isLoading ? 'Generating concepts...' : 'Generate Concepts'}
                  </button>
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
                      <button
                        onClick={() => { onGenerateConcepts({ userNote: conceptNote || undefined }); setConceptNote(''); }}
                        disabled={isLoading}
                        className="text-[11px] bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md px-3 py-1.5 transition-colors disabled:opacity-50"
                      >
                        Regenerate
                      </button>
                    </div>
                  )}
                </div>

                {onGenerateConcepts && (
                  <div className="space-y-3">
                    <input
                      value={conceptNote}
                      onChange={e => setConceptNote(e.target.value)}
                      placeholder="Regenerate note — e.g. 'more abstract' or 'focus on devotion not mythology'"
                      className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && conceptNote.trim()) {
                          onGenerateConcepts({ userNote: conceptNote });
                          setConceptNote('');
                        }
                      }}
                    />
                    {showConceptPrompt && project.lastConceptPrompt && (
                      <pre className="surface-inset rounded-md p-3 text-[11px] text-zinc-400 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">{project.lastConceptPrompt}</pre>
                    )}
                  </div>
                )}

                <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {isLoading && (
                    <div className="absolute inset-0 bg-black/60 rounded-xl z-10 flex flex-col items-center justify-center gap-3">
                      <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin"></div>
                      <p className="text-zinc-300 text-sm">Generating concepts...</p>
                    </div>
                  )}
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
                        <span className="text-[11px] text-zinc-400 font-mono">{idx + 1}</span>
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div><span className="text-zinc-400">Deity:</span> <span className="text-zinc-300">{concept.deity}</span></div>
                        <div><span className="text-zinc-400">Mood:</span> <span className="text-zinc-300">{concept.mood}</span></div>
                        <p className="text-zinc-400 text-xs leading-relaxed">{concept.theme}</p>
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
              <div className="flex items-end gap-6 flex-wrap">
                <div className="space-y-2">
                  <label className="text-[11px] uppercase font-medium text-zinc-400 tracking-wide block">Director Mode</label>
                  <div className="flex gap-1 surface-inset rounded-md p-0.5">
                    <button
                      onClick={() => onUpdateProject({ videoMode: 'montage' })}
                      className={`px-3 py-1.5 rounded text-[11px] font-medium transition-colors ${project.videoMode === 'montage' ? 'bg-white text-black' : 'text-zinc-400 hover:text-zinc-300'}`}
                    >
                      Montage
                    </button>
                    <button
                      onClick={() => onUpdateProject({ videoMode: 'cinematic' })}
                      className={`px-3 py-1.5 rounded text-[11px] font-medium transition-colors ${project.videoMode === 'cinematic' ? 'bg-white text-black' : 'text-zinc-400 hover:text-zinc-300'}`}
                    >
                      Cinematic
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] uppercase font-medium text-zinc-400 tracking-wide block" title={`${getVideoModel(project.videoModel).label} allows: ${getVideoModel(project.videoModel).durations.map(d => `${d}s`).join(', ')}`}>
                    Pacing <span className="text-zinc-400 normal-case tracking-normal font-normal">· {getVideoModel(project.videoModel).label}</span>
                  </label>
                  <div className="flex gap-1 surface-inset rounded-md p-0.5">
                    {getVideoModel(project.videoModel).durations.map(d => (
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
                <div className="flex items-center gap-2 ml-auto">
                  {project.scenes.length > 0 && (
                    <button
                      onClick={() => setShowScriptPrompt(s => !s)}
                      className="text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors px-2 py-1"
                    >
                      {showScriptPrompt ? 'Hide prompt' : 'View prompt'}
                    </button>
                  )}
                  <button
                    onClick={() => { onGenerateScript(scriptNote || undefined); setScriptNote(''); }}
                    disabled={isLoading}
                    className="bg-white text-black px-5 py-2 rounded-md font-semibold text-xs hover:bg-zinc-200 disabled:opacity-50 flex items-center gap-2 transition-colors"
                  >
                    {isLoading && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin"></div>}
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
                    className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
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
                    {onUnlockScript && project.status === 'scripted' && (
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
                            <p className="text-zinc-400 text-xs truncate">{scene.narrativeDescription}</p>
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
                          <div className="px-4 pb-4 space-y-2 border-t border-white/[0.04] pt-3">
                            {scene.lyrics && (
                              <p className="text-zinc-400 italic text-xs mb-3">"{scene.lyrics}"</p>
                            )}
                            {scene.shots.map((shot, sIdx) => (
                              <div key={shot.id} className="flex gap-3 p-3 surface-inset rounded-lg">
                                <div className="text-[11px] font-mono text-zinc-400 w-6 pt-0.5 shrink-0">S{sIdx + 1}</div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs text-zinc-300 mb-1">{shot.visualPrompt || '—'}</div>
                                  {shot.motionPrompt && (
                                    <div className="text-[11px] text-zinc-400 mb-1">{shot.motionPrompt}</div>
                                  )}
                                  <div className="text-[11px] text-zinc-400 flex gap-3">
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
              <div className="flex flex-col items-center justify-center h-48 text-zinc-400 text-sm">
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
                          className="text-[11px] text-zinc-400 hover:text-white border border-white/[0.08] hover:border-white/20 px-3 py-1.5 rounded-md transition-colors"
                        >
                          Explore New
                        </button>
                        {project.status === 'style_locked' && (
                          <UnlockPill onClick={onUnlockStyle} disabled={isLoading} />
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
                        <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Style DNA</h4>
                        <Markdown>{project.styleDescription || ''}</Markdown>
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
                        className="text-[11px] text-zinc-400 hover:text-white border border-white/[0.08] hover:border-white/20 px-3 py-1.5 rounded-md transition-colors"
                      >
                        Back to Style
                      </button>
                    </div>

                    {/* Current style thumbnail for reference */}
                    {project.styleAssetUrl && (
                      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-white/[0.06]">
                        <img src={project.styleAssetUrl} alt="Current style" className="w-16 h-16 rounded-md object-cover cursor-zoom-in" onClick={() => setModalImage(project.styleAssetUrl!)} />
                        <div>
                          <span className="text-xs text-zinc-400">Current locked style</span>
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
                        <p className="text-zinc-400 text-sm">Brainstorming...</p>
                      </div>
                    )}

                    {styleSlots.length > 0 && (
                      <div className="space-y-3">
                        {styleSlots.map((slot, idx) => (
                          <StyleRow
                            key={idx}
                            slot={slot}
                            index={idx}
                            expanded={expandedStyleIdxs.has(idx)}
                            onToggle={() => toggleStyleIdx(idx)}
                            onVisualize={() => handleVisualize(idx)}
                            onLock={() => handleLockSlot(slot)}
                            onRefine={(text) => handleRefine(idx, text)}
                            onOpenModal={setModalImage}
                            isLocking={isLocking}
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
                    <p className="text-zinc-400 text-xs">
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
                    {styleSlots.length > 0 && (
                      <button
                        onClick={() => setExpandedStyleIdxs(expandedStyleIdxs.size === styleSlots.length ? new Set() : new Set(styleSlots.map((_, i) => i)))}
                        className="text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors px-3 whitespace-nowrap"
                      >
                        {expandedStyleIdxs.size === styleSlots.length ? 'Collapse all' : 'Expand all'}
                      </button>
                    )}
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
                    <p className="text-zinc-400 text-sm">Brainstorming visual directions...</p>
                  </div>
                )}

                {styleSlots.length > 0 && (
                  <div className="space-y-3">
                    {styleSlots.map((slot, idx) => (
                      <StyleRow
                        key={`ai-${idx}-${slot.title}`}
                        slot={slot}
                        index={idx}
                        expanded={expandedStyleIdxs.has(idx)}
                        onToggle={() => toggleStyleIdx(idx)}
                        onVisualize={() => handleVisualize(idx)}
                        onLock={() => handleLockSlot(slot)}
                        onRefine={(text) => handleRefine(idx, text)}
                        onOpenModal={setModalImage}
                        isLocking={isLocking}
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
                        className="w-full py-3 rounded-xl border border-dashed border-white/[0.1] text-sm text-zinc-400 hover:text-zinc-300 hover:border-white/20 transition-colors"
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
                                className="text-xs text-zinc-400 hover:text-zinc-400 px-2 py-1.5 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                          <textarea
                            value={userSlot.description}
                            onChange={(e) => setUserSlot(prev => ({ ...prev, description: e.target.value }))}
                            placeholder="Describe your visual style direction — or upload a reference image to auto-fill this."
                            className="w-full h-20 surface-inset rounded-md p-3 text-sm text-zinc-300 outline-none focus-visible:ring-1 focus-visible:ring-white/20 resize-none leading-relaxed"
                          />
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              onClick={() => handleVisualize(0, true)}
                              disabled={!userSlot.description || userSlot.isGenerating}
                              className="px-5 py-2 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                            >
                              {userSlot.isGenerating ? 'Generating…' : userSlot.imageUrl && !uploadedStyleFile ? 'Re-visualize' : 'Visualize'}
                            </button>
                            {uploadedStyleFile && (
                              <button
                                onClick={handleLockUploadedDirect}
                                disabled={isLocking}
                                className="px-5 py-2 bg-white/[0.06] border border-white/[0.08] text-zinc-300 hover:text-white hover:bg-white/[0.1] rounded-md text-xs font-semibold transition-colors disabled:opacity-50"
                                title="Skip visualization — lock the uploaded image as the style ref directly"
                              >
                                {isLocking ? 'Locking…' : 'Use uploaded image as style'}
                              </button>
                            )}
                          </div>
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
                                <button
                                  onClick={(e) => { e.stopPropagation(); setModalImage(userSlot.imageUrl!); }}
                                  className="absolute top-3 right-3 p-1.5 rounded-md bg-black/40 backdrop-blur-sm text-zinc-300 hover:text-white hover:bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="View full screen"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                                  </svg>
                                </button>
                                {userSlot.assetId && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleLockSlot(userSlot); }}
                                    disabled={isLocking}
                                    className="absolute bottom-3 right-3 bg-white/95 backdrop-blur-sm text-black px-3.5 py-1.5 rounded-md text-xs font-semibold hover:bg-white transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-lg shadow-black/30"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                    </svg>
                                    {isLocking ? 'Locking…' : 'Lock style'}
                                  </button>
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
                  <div className="flex flex-col items-center justify-center h-40 space-y-2 text-zinc-400">
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
            {onUnlockCharacters && project.status === 'characters_locked' && (
              <div className="flex justify-end">
                <UnlockPill onClick={onUnlockCharacters} disabled={isLoading} label="Unlock characters" />
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Cast sidebar */}
              <div className="lg:col-span-3">
                <div className="surface rounded-xl p-4 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Cast</h3>
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
                              <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">?</div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-white line-clamp-2 leading-snug">{member.name}</div>
                            <div className="text-xs text-zinc-400 truncate flex items-center gap-1">
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
                          className="text-sm font-medium text-white bg-transparent outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded px-1 -ml-1 flex-1 min-w-0"
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
                            const runDelete = () => {
                              onDeleteCast(activeMember.id);
                              setActiveCastId(project.cast.find(c => c.id !== activeMember.id)?.id || null);
                            };
                            if (onConfirmDestructive) {
                              onConfirmDestructive({
                                title: `Delete "${activeMember.name}"?`,
                                description: 'Removes this cast member. Shots that reference them will lose that character ref until you re-add one.',
                                confirmLabel: 'Delete',
                                run: runDelete,
                              });
                            } else {
                              runDelete();
                            }
                          }}
                          className="text-zinc-400 hover:text-red-400 p-1.5 rounded-md transition-colors"
                          aria-label={`Delete ${activeMember.name}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/></svg>
                        </button>
                        <button
                          onClick={() => setPromptPreview(prev => prev === activeMember.id ? null : activeMember.id)}
                          className="text-[11px] text-zinc-400 hover:text-zinc-400 transition-colors"
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
                            <div className="absolute inset-x-0 bottom-0 bg-black/80 text-[11px] text-zinc-400 text-center rounded-b">Style</div>
                          </div>
                        )}
                        <pre className="flex-1 text-[11px] text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">{
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
                          <span className="text-sm text-zinc-400">Generating looks…</span>
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
                        <span className="text-sm text-zinc-400">No reference yet — generate looks below</span>
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
                  <div className="surface rounded-xl p-8 h-full flex items-center justify-center text-zinc-400 text-sm">
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
            {onUnlockEnvironments && project.status === 'environments_locked' && (
              <div className="flex justify-end">
                <UnlockPill onClick={onUnlockEnvironments} disabled={isLoading} label="Unlock environments" />
              </div>
            )}
            {project.environments.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Env sidebar */}
                <div className="lg:col-span-3">
                  <div className="surface rounded-xl p-4 space-y-4">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Environments</h3>
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
                                <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">?</div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-white line-clamp-2 leading-snug">{env.name}</div>
                              <div className="text-xs text-zinc-400 truncate flex items-center gap-1">
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

                    {project.environments.length > 0 && project.status === 'characters_locked' && (
                      <button
                        onClick={() => project.environments.filter(e => !e.referenceImageUrl).forEach(e => handleEnvGenerate(e.id))}
                        disabled={envGenerating.size > 0}
                        className="w-full py-2 bg-white text-black rounded-md text-[11px] font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                      >
                        {envGenerating.size > 0 ? `Generating ${envGenerating.size}...` : 'Generate All Looks'}
                      </button>
                    )}

                    {project.status === 'characters_locked' && (
                      <button
                        onClick={onAdvanceEnvironments}
                        className="w-full py-2 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white rounded-md text-xs font-semibold border border-white/[0.08] transition-colors"
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
                            className="text-[11px] text-zinc-400 hover:text-zinc-400 transition-colors"
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
                              <div className="absolute inset-x-0 bottom-0 bg-black/80 text-[11px] text-zinc-400 text-center rounded-b">Style</div>
                            </div>
                          )}
                          <pre className="flex-1 text-[11px] text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">{
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
                            <span className="text-sm text-zinc-400">Generating looks…</span>
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
                          <span className="text-sm text-zinc-400">No reference yet — generate looks above</span>
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
                    <div className="surface rounded-xl p-8 h-full flex items-center justify-center text-zinc-400 text-sm">
                      Select an environment.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-white/[0.06] p-8 text-center">
                <p className="text-zinc-400 mb-4 text-sm">No environments proposed by the script.</p>
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
