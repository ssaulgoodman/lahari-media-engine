
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ApiProject, ConceptOption, CastMember, Environment, VideoMode } from '../types';
import * as api from '../services/api';
import { ImageModal } from './ImageModal';
import { Markdown } from './Markdown';
import { AutoGrowTextarea } from './AutoGrowTextarea';
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
            <div>
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1">Style description</div>
              <p className="text-sm text-zinc-300 leading-relaxed">{slot.description}</p>
            </div>

            {/* Compiled prompt preview — what actually goes to Gemini */}
            <details className="group">
              <summary className="text-[11px] uppercase tracking-wide text-zinc-500 cursor-pointer hover:text-zinc-400 transition-colors">
                View generation prompt
              </summary>
              <pre className="mt-2 surface-inset rounded-md p-3 text-xs text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed">
{`Cinematic film still showcasing a specific visual style. ${slot.description}. The scene evokes the world of ${slot.title}. Focus entirely on lighting, atmosphere, color, texture, and visual style. High production value, no text, no watermark.

Avoid: overly AI/CGI look, excessive intricate details, generic fantasy aesthetic. Should feel like a real film frame.`}
              </pre>
            </details>

            {/* Refine + Visualize row */}
            <div className="flex gap-2">
              <AutoGrowTextarea
                value={refineInput}
                onChange={(e) => setRefineInput(e.target.value)}
                placeholder="Refine this direction…"
                rows={1}
                className="flex-1 surface-inset rounded-md px-3 py-2 text-sm text-white outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.metaKey && !e.shiftKey && refineInput) {
                    e.preventDefault();
                    onRefine(refineInput);
                    setRefineInput('');
                  }
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
  onDiscardLookCandidates?: (castMemberId: string) => void;
  onLockConcept: (index: number) => void;
  onLockStyle: (assetId: string, styleDescription?: string) => void;
  onUnlockStyle: () => void;
  onGenerateLooks: (castMemberId: string, feedback?: string, refImage?: File) => void | Promise<void>;
  onLockCharacter: (castMemberId: string, assetId: string) => void;
  onAddCast: (name: string, description: string) => void;
  onUpdateCast: (memberId: string, updates: { name?: string; description?: string; generationPrompt?: string }) => void;
  onDeleteCast: (memberId: string) => void;
  onConfirmDestructive?: (opts: { title: string; description: string; confirmLabel?: string; run: () => any }) => void;
  onGenerateScript: (userNote?: string) => void;
  onRefineScript?: (feedback: string) => void;
  onUpdateScene?: (sceneId: string, updates: { narrativeDescription?: string }) => void;
  onUpdateShot?: (sceneId: string, shotId: string, updates: { visualPrompt?: string; castIds?: string[]; environmentId?: string | null; duration?: number }) => void;
  onGenerateConcepts?: (opts?: { userNote?: string; directorBrief?: string }) => void;
  onCancelConcepts?: () => void;
  onCancelScript?: () => void;
  onUnlockConcept?: () => void;
  onRefineConcept?: (feedback: string) => Promise<void> | void;
  onUpdateConcept?: (updates: Record<string, any>) => Promise<void> | void;
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
  // Derive the FURTHEST phase from status, but also check data in case
  // the status is behind (e.g. user unlocked concept to edit it, but
  // cast/envs/scenes still exist from a prior run). Take the max of
  // status-derived phase and data-derived phase so tabs stay accessible.
  let statusPhase: Phase;
  switch (project.status) {
    case 'uploaded':
    case 'analyzing':
    case 'analyzed':
    case 'error':
      statusPhase = 'concept'; break;
    case 'concept_locked':
      statusPhase = 'script'; break;
    case 'scripted':
      statusPhase = 'style'; break;
    case 'style_locked':
      statusPhase = 'characters'; break;
    case 'characters_locked':
    case 'environments_locked':
    case 'in_production':
    case 'rendered':
      statusPhase = 'environments'; break;
    default:
      statusPhase = 'concept';
  }

  // Data-derived phase — furthest phase that has real data
  let dataPhase: Phase = 'concept';
  if (project.lockedConcept) dataPhase = 'script';
  if ((project.scenes?.length ?? 0) > 0) dataPhase = 'style';
  if (project.styleAssetUrl) dataPhase = 'characters';
  if (project.cast?.some(c => !!c.referenceImageUrl)) dataPhase = 'environments';
  if (project.environments?.some(e => !!e.referenceImageUrl)) dataPhase = 'environments';

  // Take the further of the two — so unlocking doesn't hide tabs with existing data
  return phaseIndex(dataPhase) > phaseIndex(statusPhase) ? dataPhase : statusPhase;
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
  project, isLoading, looksLoading, lookCandidates, onDiscardLookCandidates,
  onLockConcept, onLockStyle, onUnlockStyle,
  onGenerateLooks, onLockCharacter, onAddCast, onUpdateCast, onDeleteCast,
  onGenerateScript, onRefineScript, onUpdateScene, onUpdateShot, onGenerateConcepts, onCancelConcepts, onCancelScript, onUnlockConcept, onRefineConcept, onUpdateConcept, onUnlockScript, onUnlockCharacters, onUnlockEnvironments, onUpdateProject, onLaunchStudio, onAdvanceCharacters, onAdvanceEnvironments, onSetProject, onConfirmDestructive,
}) => {
  const activePhase = getActivePhase(project);
  const [viewPhase, setViewPhase] = useState<Phase>(activePhase);
  const [activeCastId, setActiveCastId] = useState<string | null>(project.cast[0]?.id || null);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(project.environments[0]?.id || null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Two-mode uploads. "As guide" sends the image to Gemini alongside the style
  // ref so the 3 candidates match the user's reference while being rendered in
  // the project style. "As-is" skips Gemini entirely and locks the uploaded
  // file as the character/env's reference — reuses an asset from a past run.
  const castGuideUploadRef = useRef<HTMLInputElement>(null);
  const castAsIsUploadRef = useRef<HTMLInputElement>(null);
  const envGuideUploadRef = useRef<HTMLInputElement>(null);
  const envAsIsUploadRef = useRef<HTMLInputElement>(null);
  const styleDirectUploadRef = useRef<HTMLInputElement>(null);
  const [castUploading, setCastUploading] = useState<Set<string>>(new Set());
  const [envUploading, setEnvUploading] = useState<Set<string>>(new Set());

  // Staged "upload as guide" files awaiting a user note before firing Gemini.
  // Without this the image goes in blind — the user can't say "just take the
  // face" or "use the composition but re-render in our style".
  const [pendingCastRef, setPendingCastRef] = useState<{ memberId: string; file: File; previewUrl: string; note: string } | null>(null);
  const [pendingEnvRef, setPendingEnvRef] = useState<{ envId: string; file: File; previewUrl: string; note: string } | null>(null);
  useEffect(() => () => {
    if (pendingCastRef?.previewUrl) URL.revokeObjectURL(pendingCastRef.previewUrl);
    if (pendingEnvRef?.previewUrl) URL.revokeObjectURL(pendingEnvRef.previewUrl);
  }, [pendingCastRef?.previewUrl, pendingEnvRef?.previewUrl]);

  const handleCastUploadAsIs = async (castMemberId: string, file: File) => {
    setCastUploading(prev => new Set([...prev, castMemberId]));
    try {
      const updated = await api.uploadCharacterReference(project.id, castMemberId, file);
      onSetProject?.(updated);
    } catch (err: any) {
      showActionError(`Character upload failed: ${err.message}`);
    } finally {
      setCastUploading(prev => { const next = new Set(prev); next.delete(castMemberId); return next; });
    }
  };

  const stageCastRef = (castMemberId: string, file: File) => {
    if (pendingCastRef?.previewUrl) URL.revokeObjectURL(pendingCastRef.previewUrl);
    setPendingCastRef({ memberId: castMemberId, file, previewUrl: URL.createObjectURL(file), note: '' });
  };
  const fireCastRefWithNote = () => {
    if (!pendingCastRef) return;
    const { memberId, file, note } = pendingCastRef;
    URL.revokeObjectURL(pendingCastRef.previewUrl);
    setPendingCastRef(null);
    onGenerateLooks(memberId, note.trim() || undefined, file);
  };
  const clearPendingCastRef = () => {
    if (pendingCastRef?.previewUrl) URL.revokeObjectURL(pendingCastRef.previewUrl);
    setPendingCastRef(null);
  };

  const handleEnvUploadAsIs = async (environmentId: string, file: File) => {
    setEnvUploading(prev => new Set([...prev, environmentId]));
    try {
      const updated = await api.uploadEnvironmentReference(project.id, environmentId, file);
      onSetProject?.(updated);
    } catch (err: any) {
      showActionError(`Environment upload failed: ${err.message}`);
    } finally {
      setEnvUploading(prev => { const next = new Set(prev); next.delete(environmentId); return next; });
    }
  };

  const stageEnvRef = (environmentId: string, file: File) => {
    if (pendingEnvRef?.previewUrl) URL.revokeObjectURL(pendingEnvRef.previewUrl);
    setPendingEnvRef({ envId: environmentId, file, previewUrl: URL.createObjectURL(file), note: '' });
  };
  const fireEnvRefWithNote = () => {
    if (!pendingEnvRef) return;
    const { envId, file, note } = pendingEnvRef;
    URL.revokeObjectURL(pendingEnvRef.previewUrl);
    setPendingEnvRef(null);
    // Env gen doesn't have a note path yet — we'll thread it in below.
    handleEnvGenerate(envId, file, note.trim() || undefined);
  };
  const clearPendingEnvRef = () => {
    if (pendingEnvRef?.previewUrl) URL.revokeObjectURL(pendingEnvRef.previewUrl);
    setPendingEnvRef(null);
  };

  // Snap viewPhase back whenever an unlock (or forward lock) moves activePhase.
  // Without this, the unlocked phase stays rendered as "locked" because
  // viewPhase is stuck at its previous value.
  useEffect(() => {
    setViewPhase(prev => prev === activePhase ? prev : activePhase);
  }, [activePhase]);

  // Single popover from the sticky context bar — only one open at a time.
  const [contextPopover, setContextPopover] = useState<'render' | 'analysis' | null>(null);
  const contextBarRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  useEffect(() => {
    if (!contextPopover) return;
    const onDown = (e: MouseEvent) => {
      if (contextBarRef.current && !contextBarRef.current.contains(e.target as Node)) setContextPopover(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextPopover(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [contextPopover]);

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
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState(false);

  // Shared inline error feedback — surfaces async failures to the artist
  const [actionError, setActionError] = useState<string | null>(null);
  const actionErrorTimer = useRef<ReturnType<typeof setTimeout>>();
  const showActionError = (msg: string) => {
    setActionError(msg);
    clearTimeout(actionErrorTimer.current);
    actionErrorTimer.current = setTimeout(() => setActionError(null), 8000);
  };

  const handleRerunAnalysis = async () => {
    setIsAnalyzingAudio(true);
    try {
      const updated = await api.analyzeAudio(project.id);
      onSetProject?.(updated);
    } catch (err: any) {
      showActionError(`Analysis failed: ${err.message}`);
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
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [showConceptPrompt, setShowConceptPrompt] = useState(false);
  const [conceptMode, setConceptMode] = useState<'presets' | 'custom'>('presets');
  const [directorBrief, setDirectorBrief] = useState('');

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
  // A phase is "locked" only if the STATUS has advanced past it — not just data presence.
  // This way unlock-concept (which reverts status but keeps lockedConcept data) correctly
  // shows the concept as unlocked/editable.
  const statusLockedPhase = (() => {
    switch (project.status) {
      case 'uploaded': case 'analyzing': case 'analyzed': case 'error': return 'concept';
      case 'concept_locked': return 'script';
      case 'scripted': return 'style';
      case 'style_locked': return 'characters';
      default: return 'environments';
    }
  })();
  const isLockedPhase = (phase: Phase) => phaseIndex(phase) < phaseIndex(statusLockedPhase);
  const activeMember = project.cast.find(c => c.id === activeCastId);
  const activeLooks = activeCastId ? (lookCandidates[activeCastId] || []) : [];
  const activeEnv = project.environments.find(e => e.id === activeEnvId);
  const activeEnvLooks = activeEnvId ? (envLooks[activeEnvId] || []) : [];

  // ─── Environment Handlers ──────────────────────────────────────

  const handleEnvGenerate = async (envId: string, refImage?: File, note?: string) => {
    setEnvGenerating(prev => new Set(prev).add(envId));
    try {
      const result = await api.generateEnvironmentLook(project.id, envId, undefined, refImage, note);
      setEnvLooks(prev => ({ ...prev, [envId]: result.looks || [] }));
      onSetProject?.(result.project);
    } catch (err: any) {
      showActionError(`Environment look generation failed: ${err.message}`);
    } finally {
      setEnvGenerating(prev => { const s = new Set(prev); s.delete(envId); return s; });
    }
  };

  const handleEnvLock = async (envId: string, assetId: string) => {
    try {
      await api.lockEnvironment(project.id, envId, assetId);
      // Optimistic: set the reference on the environment
      const lockedUrl = envLooks[envId]?.find(l => l.id === assetId)?.url;
      onSetProject?.({
        ...project,
        environments: project.environments.map(e => e.id === envId ? { ...e, referenceImageUrl: lockedUrl || e.referenceImageUrl } : e),
      });
      setEnvLooks(prev => ({ ...prev, [envId]: [] }));
    } catch (err: any) {
      showActionError(`Environment lock failed: ${err.message}`);
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
      showActionError(`Style brainstorm failed: ${err.message}`);
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
      showActionError(`Style visualize failed: ${err.message}`);
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
      showActionError(`Style refine failed: ${err.message}`);
      setStyleSlots(prev => prev.map((s, i) => i === index ? { ...s, isRefining: false } : s));
    }
  };

  const handleLockSlot = async (slot: StyleSlot) => {
    if (!slot.assetId) return;
    setIsLocking(true);
    try {
      await onLockStyle(slot.assetId, slot.description);
    } catch (err: any) {
      showActionError(`Style lock failed: ${err.message}`);
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
      showActionError(`Style image analysis failed: ${err.message}`);
    }
  };

  const handleLockUploadedDirect = async () => {
    if (!uploadedStyleFile) return;
    setIsLocking(true);
    try {
      const updated = await api.uploadAndLockStyle(project.id, uploadedStyleFile);
      onSetProject?.(updated);
    } catch (err: any) {
      showActionError(`Style lock failed: ${err.message}`);
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

  // ─── Context bar derived values ───
  const aspectLabel = project.aspectRatio || '16:9';
  const resLabel = project.videoResolution || '720p';
  const modelLabel = getVideoModel(project.videoModel || VIDEO_MODELS[0].key).label;
  const renderSummary = `${aspectLabel} · ${resLabel} · ${modelLabel}`;
  const analysisItems = [
    { label: 'Lyrics', present: !!project.lyrics },
    { label: 'Structure', present: project.musicalStructure?.length > 0 },
    { label: 'Meaning', present: !!project.meaning },
  ];
  const hasAnalysis = !!(project.meaning || project.musicalStructure?.length > 0 || project.lyrics);
  const needsAnalysis = !project.lyrics || !project.meaning || !(project.musicalStructure?.length > 0);
  // Ready to launch if we have the creative foundations — don't gate strictly on
  // project.status because status can drift (fork, regen, old projects).
  const everyoneHasLook = project.cast.length > 0 && project.cast.every(c => !!c.referenceImageUrl);
  const everyEnvHasLook = project.environments.length === 0 || project.environments.every(e => !!e.referenceImageUrl);
  const showLaunch = !!project.styleDescription && everyoneHasLook && everyEnvHasLook && project.scenes.length > 0;

  return (
    <div className="max-w-5xl mx-auto pb-32">
      {/* ═══ Sticky Context Bar — title + render + analysis + phase tabs ═══ */}
      {/* Sticky inside <main> (the scroll container). top:0 pins to top of main once user scrolls past. */}
      <div ref={contextBarRef} className="sticky top-0 z-40 mb-6">
        <div className="surface rounded-xl border border-white/[0.06] bg-[#141418] shadow-md shadow-black/15">
          {/* Row 1: Title + chips + Launch */}
          <div className="flex items-center gap-3 h-12 px-4">
            <h2 className="text-base font-display font-medium text-white tracking-tight truncate flex-shrink-0 max-w-[180px]">{project.title || 'Blueprint'}</h2>

            {/* Audio mini player — play/pause + seekable progress + time */}
            {project.audioPath && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <audio
                  ref={audioRef}
                  src={project.audioPath}
                  onEnded={() => setAudioPlaying(false)}
                  onPause={() => setAudioPlaying(false)}
                  onPlay={() => setAudioPlaying(true)}
                  onLoadedMetadata={() => setAudioDuration(audioRef.current?.duration || 0)}
                  onTimeUpdate={() => {
                    const el = audioRef.current;
                    if (!el || !el.duration) return;
                    setAudioCurrentTime(el.currentTime);
                    setAudioProgress(el.currentTime / el.duration);
                  }}
                />
                <button
                  onClick={() => {
                    const el = audioRef.current;
                    if (!el) return;
                    if (el.paused) el.play().catch(() => {});
                    else el.pause();
                  }}
                  className={`w-6 h-6 rounded flex items-center justify-center transition-colors flex-shrink-0 ${audioPlaying ? 'text-white' : 'text-zinc-400 hover:text-white'}`}
                  title={audioPlaying ? 'Pause' : 'Play song'}
                >
                  {audioPlaying ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  )}
                </button>
                {/* Seekable progress bar */}
                <div
                  className="relative w-28 h-5 flex items-center cursor-pointer group"
                  onClick={(e) => {
                    const el = audioRef.current;
                    if (!el || !el.duration) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    el.currentTime = pct * el.duration;
                  }}
                >
                  <div className="absolute inset-x-0 h-1 rounded-full bg-white/[0.08]">
                    <div className="h-full rounded-full bg-white/40 group-hover:bg-white/60 transition-colors" style={{ width: `${audioProgress * 100}%` }} />
                  </div>
                </div>
                <span className="text-[10px] font-mono text-zinc-400 tabular-nums w-[70px] text-right flex-shrink-0">
                  {Math.floor(audioCurrentTime / 60)}:{String(Math.floor(audioCurrentTime % 60)).padStart(2, '0')}
                  {audioDuration > 0 && <span className="text-zinc-500"> / {Math.floor(audioDuration / 60)}:{String(Math.floor(audioDuration % 60)).padStart(2, '0')}</span>}
                </span>
              </div>
            )}

            <div className="w-px h-5 bg-white/[0.06] flex-shrink-0" />

            {/* Render chip */}
            <button
              onClick={() => setContextPopover(p => p === 'render' ? null : 'render')}
              className={`flex items-center gap-2 px-2.5 py-1 rounded-md transition-colors ${contextPopover === 'render' ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'}`}
              aria-expanded={contextPopover === 'render'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400" aria-hidden="true">
                <circle cx="12" cy="12" r="3"/><path d="M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24"/>
              </svg>
              <span className="text-[11px] uppercase tracking-wide text-zinc-400">Render</span>
              <span className="text-xs text-zinc-300 truncate max-w-[260px]">{renderSummary}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-zinc-400 transition-transform ${contextPopover === 'render' ? 'rotate-180' : ''}`} aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Analysis chip — right-aligned */}
            {hasAnalysis && (
              <button
                onClick={() => setContextPopover(p => p === 'analysis' ? null : 'analysis')}
                className={`flex items-center gap-2 px-2.5 py-1 rounded-md transition-colors ${contextPopover === 'analysis' ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'}`}
                aria-expanded={contextPopover === 'analysis'}
              >
                <span className="flex items-center gap-1.5">
                  {analysisItems.map(it => (
                    <span key={it.label} className={`text-[11px] ${it.present ? 'text-zinc-300' : 'text-amber-300/80'}`}>
                      {it.present ? '✓' : '—'} {it.label}
                    </span>
                  ))}
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-zinc-400 transition-transform ${contextPopover === 'analysis' ? 'rotate-180' : ''}`} aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
            )}

            {/* Launch Studio (when ready) */}
            {showLaunch && (
              <button onClick={onLaunchStudio} disabled={isLoading} className="bg-white text-black px-4 py-1.5 rounded-md font-semibold text-xs hover:bg-zinc-200 transition-colors disabled:opacity-50 flex items-center gap-2 flex-shrink-0">
                {isLoading && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin"></div>}
                {isLoading ? 'Writing prompts…' : 'Launch Studio'}
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            )}
          </div>

          {/* Row 2: Phase tabs */}
          <div className="flex items-center justify-center gap-0 px-4 py-2.5 border-t border-white/[0.04]">
            {PHASE_ORDER.map((phase, idx) => {
              const locked = isLockedPhase(phase);
              const active = viewPhase === phase;
              const accessible = canAccess(phase);
              return (
                <React.Fragment key={phase}>
                  <button
                    disabled={!accessible}
                    onClick={() => accessible && setViewPhase(phase)}
                    className={`relative px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'text-white'
                        : locked
                          ? 'text-zinc-300 hover:text-white'
                          : accessible
                            ? 'text-zinc-400 hover:text-zinc-300'
                            : 'text-zinc-400/40 cursor-not-allowed'
                    }`}
                  >
                    {locked && (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-2.5 h-2.5 mr-1 inline" aria-hidden="true">
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                      </svg>
                    )}
                    {phase.charAt(0).toUpperCase() + phase.slice(1)}
                    {active && <span aria-hidden="true" className="absolute left-3 right-3 -bottom-0.5 h-px bg-white/60" />}
                  </button>
                  {idx < PHASE_ORDER.length - 1 && <div className={`w-6 h-px ${locked ? 'bg-white/20' : 'bg-white/[0.06]'}`} />}
                </React.Fragment>
              );
            })}
          </div>

          {/* Popover panel — slides down from the bar */}
          <AnimatePresence initial={false}>
            {contextPopover === 'render' && (
              <motion.div
                key="render-pop"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto', overflow: 'visible' }}
                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                transition={{ duration: 0.18 }}
                className="border-t border-white/[0.06]"
              >
                <div className="flex items-stretch divide-x divide-white/[0.06]">
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
                  <label className="flex-[1.5] px-5 py-3 space-y-1 hover:bg-white/[0.01] transition-colors cursor-pointer group">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-400">Video model</div>
                    <div className="relative">
                      <select
                        value={project.videoModel || VIDEO_MODELS[0].key}
                        onChange={e => {
                          const newModel = getVideoModel(e.target.value);
                          const currentModel = getVideoModel(project.videoModel);
                          const shotCount = project.scenes.reduce((acc, s) => acc + s.shots.length, 0);
                          const hasVideos = project.scenes.some(s => s.shots.some((sh: any) => sh.videoUrl));
                          const durationMismatch = shotCount > 0 && !newModel.durations.some(d => currentModel.durations.includes(d));

                          if (hasVideos && durationMismatch) {
                            const ok = window.confirm(
                              `Switching from ${currentModel.label} (${currentModel.durations.join('/')}s) to ${newModel.label} (${newModel.durations.join('/')}s).\n\nExisting shot durations will be clamped to the nearest supported value. Already-generated videos won't change, but new generations will use the new durations.\n\nContinue?`
                            );
                            if (!ok) return;
                          }

                          const updates: Record<string, any> = { videoModel: e.target.value };
                          if (!newModel.durations.includes(project.targetDuration)) updates.targetDuration = newModel.durations[0];
                          onUpdateProject(updates);
                        }}
                        className="w-full bg-transparent text-sm text-zinc-300 outline-none cursor-pointer appearance-none truncate pr-5"
                      >
                        {VIDEO_MODELS.map(m => (<option key={m.key} value={m.key}>{m.label} · {m.durations.join('/')}s · ${m.costPerSec.toFixed(2)}/s</option>))}
                      </select>
                      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="absolute right-0 top-1/2 -translate-y-1/2 text-zinc-400 group-hover:text-zinc-300 transition-colors pointer-events-none" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
                  </label>
                </div>
              </motion.div>
            )}

            {contextPopover === 'analysis' && (
              <motion.div
                key="analysis-pop"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden border-t border-white/[0.06]"
              >
                <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                  {needsAnalysis && (
                    <div className="flex justify-end">
                      <button
                        onClick={handleRerunAnalysis}
                        disabled={isAnalyzingAudio}
                        className="text-[11px] bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-300 hover:text-white px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {isAnalyzingAudio && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>}
                        {isAnalyzingAudio ? 'Analyzing…' : `Fill missing (${analysisItems.filter(i => !i.present).map(i => i.label).join(', ')})`}
                      </button>
                    </div>
                  )}
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
                          <div key={idx} className="surface-inset rounded-md px-3 py-2 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-white font-medium truncate">{section.label}</span>
                              <span className="text-[11px] text-zinc-400 font-mono flex-shrink-0">{section.startTime}–{section.endTime}</span>
                            </div>
                            {section.description && <p className="text-sm text-zinc-300 mt-1 leading-relaxed">{section.description}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {project.lyrics && (
                    <div>
                      <h4 className="text-[11px] uppercase tracking-wide text-zinc-400 mb-2">Lyrics</h4>
                      <pre className="surface-inset rounded-md p-3 text-sm text-zinc-300 font-sans whitespace-pre-wrap leading-relaxed">{project.lyrics}</pre>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border border-red-500/20 bg-red-500/[0.06] flex items-start gap-2 text-sm text-red-400 cursor-pointer" onClick={() => setActionError(null)}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 mt-0.5 flex-shrink-0">
            <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
          </svg>
          <span>{actionError}</span>
        </div>
      )}

      {/* Phase Content */}
      <AnimatePresence mode="wait">
        {/* ═══ CONCEPT ═══ */}
        {viewPhase === 'concept' && (
          <motion.div key="concept" {...phaseTransition} className="space-y-6">
            {/* Analyzing banner — shown when analysis is running in background */}
            {project.status === 'analyzing' && (
              <div className="surface rounded-xl p-4 border border-amber-400/20 flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-zinc-600 border-t-amber-400 rounded-full animate-spin flex-shrink-0"></div>
                <div>
                  <p className="text-sm text-white font-medium">Analyzing audio...</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">Detecting musical structure and meaning. You can listen to the song while this runs.</p>
                </div>
              </div>
            )}
            {isLockedPhase('concept') ? (
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
                    onClick={() => setViewPhase('script')}
                    className="bg-white text-black px-5 py-2 rounded-md font-semibold text-xs hover:bg-zinc-200 transition-colors flex items-center gap-2"
                  >
                    Continue to Script
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                </div>
              </div>
            ) : project.conceptOptions.length === 0 ? (
              /* Empty state — first-time generate. Optional nudge upfront so
                  the artist can steer the first pass (e.g. "make it abstract"
                  or "focus on devotion over mythology") instead of burning a
                  generation cycle just to regenerate with a note. */
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
                    {/* Mode toggle — same as empty state */}
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
                  {isLoading && viewPhase === 'concept' && !isLockedPhase('concept') && (
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
        )}

        {/* ═══ SCRIPT ═══ */}
        {viewPhase === 'script' && (
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
                  // Single-duration models show inline text, multi-duration show buttons
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

              {/* Note + prompt preview (shown after first generation) */}
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
                    {onUnlockScript && isLockedPhase('script') && (
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
                              className="text-zinc-300 text-sm leading-relaxed truncate outline-none border-b border-dashed border-transparent hover:border-white/[0.15] focus-visible:border-white/30 cursor-text transition-colors"
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
                              // Suppress the fallback motion text — only show real motion prompts
                              const realMotion = shot.motionPrompt && shot.motionPrompt !== 'Cinematic camera movement' ? shot.motionPrompt : null;
                              return (
                              <div key={shot.id} className="flex gap-3 p-3 surface-inset rounded-lg">
                                <div className="text-xs font-mono text-zinc-400 w-6 pt-0.5 shrink-0">S{sIdx + 1}</div>
                                <div className="flex-1 min-w-0 space-y-1.5">
                                  <div
                                    contentEditable
                                    suppressContentEditableWarning
                                    onBlur={e => {
                                      const val = e.currentTarget.textContent?.trim();
                                      if (val && val !== shot.visualPrompt) {
                                        onUpdateShot?.(scene.id, shot.id, { visualPrompt: val });
                                        setSavedFlash(shot.id);
                                        setTimeout(() => setSavedFlash(null), 1500);
                                      }
                                    }}
                                    className="text-sm text-zinc-300 leading-relaxed outline-none border-b border-dashed border-transparent hover:border-white/[0.15] focus-visible:border-white/30 cursor-text transition-colors"
                                  >{shot.visualPrompt || '—'}</div>
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
                                        <button onClick={() => setViewPhase('characters')} className="text-zinc-500 hover:text-zinc-300 underline underline-offset-2">+ add</button>
                                      )}
                                    </span>
                                    {/* Environment select */}
                                    <span className="flex items-center gap-1">
                                      <span className="text-zinc-500">Env:</span>
                                      <select
                                        value={shot.environmentId || ''}
                                        onChange={e => {
                                          const val = e.target.value;
                                          if (val === '__add__') { setViewPhase('environments'); return; }
                                          onUpdateShot?.(scene.id, shot.id, { environmentId: val || null });
                                          setSavedFlash(shot.id);
                                          setTimeout(() => setSavedFlash(null), 1500);
                                        }}
                                        className="bg-transparent text-[11px] text-zinc-300 outline-none cursor-pointer appearance-none border-b border-dashed border-white/[0.1] hover:border-white/[0.2] px-1 py-0.5"
                                      >
                                        <option value="">None</option>
                                        {project.environments.map(e => (
                                          <option key={e.id} value={e.id}>{e.name}</option>
                                        ))}
                                        <option value="__add__">+ Add environment...</option>
                                      </select>
                                    </span>
                                    {shot.continuityFrom === 'prev_shot' && (
                                      <span className="text-amber-400/80">· continues</span>
                                    )}
                                  </div>
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
                  onClick={() => setViewPhase('style')}
                  className="bg-white text-black px-5 py-2 rounded-md font-semibold text-xs hover:bg-zinc-200 transition-colors flex items-center gap-2"
                >
                  Continue to Style
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
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
                            className="bg-white text-black px-5 py-2 rounded-md font-semibold text-xs hover:bg-zinc-200 transition-colors flex items-center gap-2"
                          >
                            Continue to Characters
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
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

                    <div className="flex gap-2 items-center">
                      <AutoGrowTextarea
                        value={brainstormNotes}
                        onChange={(e) => setBrainstormNotes(e.target.value)}
                        placeholder="Style preferences..."
                        rows={1}
                        className="flex-1 surface-inset rounded-md px-3 py-1.5 text-sm text-white outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.metaKey && !e.shiftKey) { e.preventDefault(); handleBrainstorm(); } }}
                      />
                      <button
                        onClick={handleBrainstorm}
                        disabled={isBrainstorming}
                        className="px-3 py-1.5 bg-white text-black rounded-md text-[11px] font-semibold hover:bg-zinc-200 disabled:opacity-50 whitespace-nowrap transition-colors"
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

                  <div className="flex gap-2 items-center">
                    <AutoGrowTextarea
                      value={brainstormNotes}
                      onChange={(e) => setBrainstormNotes(e.target.value)}
                      placeholder="Style preferences... e.g. 'painterly', 'dark and moody', 'Ravi Varma inspired'"
                      rows={1}
                      className="flex-1 surface-inset rounded-md px-3 py-1.5 text-sm text-white outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.metaKey && !e.shiftKey) { e.preventDefault(); handleBrainstorm(); } }}
                    />
                    {styleSlots.length > 0 && (
                      <button
                        onClick={() => setExpandedStyleIdxs(expandedStyleIdxs.size === styleSlots.length ? new Set() : new Set(styleSlots.map((_, i) => i)))}
                        className="text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors px-3 whitespace-nowrap"
                      >
                        {expandedStyleIdxs.size === styleSlots.length ? 'Collapse all' : 'Expand all'}
                      </button>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      ref={styleDirectUploadRef}
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setIsLocking(true);
                        try {
                          const updated = await api.uploadAndLockStyle(project.id, file);
                          onSetProject?.(updated);
                        } catch (err: any) {
                          console.error('Upload-and-lock style failed:', err);
                        } finally {
                          setIsLocking(false);
                          if (e.target) e.target.value = '';
                        }
                      }}
                    />
                    <button
                      onClick={() => styleDirectUploadRef.current?.click()}
                      disabled={isLocking}
                      className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-300 hover:text-white rounded-md text-[11px] whitespace-nowrap transition-colors disabled:opacity-50 flex items-center gap-1.5"
                      title="Upload your own reference image and lock it as the style directly — skips brainstorm + visualize."
                    >
                      {isLocking && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>}
                      {isLocking ? 'Uploading…' : 'Upload reference'}
                    </button>
                    <button
                      onClick={handleBrainstorm}
                      disabled={isBrainstorming}
                      className="px-3 py-1.5 bg-white text-black rounded-md text-[11px] font-semibold hover:bg-zinc-200 disabled:opacity-50 whitespace-nowrap transition-colors"
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
            {onUnlockCharacters && isLockedPhase('characters') && (
              <div className="flex justify-end">
                <UnlockPill onClick={onUnlockCharacters} disabled={isLoading} label="Unlock characters" />
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Cast sidebar */}
              <div className="lg:col-span-3">
                <div className="surface rounded-xl p-4 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Cast</h3>
                    <button onClick={() => onAddCast('New Character', 'Description...')} className="text-xs text-zinc-400 hover:text-white hover:bg-white/[0.04] px-2 py-1 rounded-md transition-colors flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Add
                    </button>
                  </div>
                  <div className="space-y-1 overflow-y-auto max-h-[500px] pr-1">
                    {project.cast.map(member => {
                      const isActive = activeCastId === member.id;
                      const hasLook = !!member.referenceImageUrl;
                      return (
                        <div
                          key={member.id}
                          className={`group relative rounded-lg transition-colors ${
                            isActive ? 'bg-white/[0.08] border-l-2 border-l-white/70' : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
                          }`}
                        >
                          <button
                            onClick={() => setActiveCastId(member.id)}
                            className="w-full text-left p-2.5 cursor-pointer flex gap-3 items-center outline-none"
                          >
                            <div className={`w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 ${hasLook ? '' : 'bg-white/[0.04]'}`}>
                              {member.referenceImageUrl ? (
                                <img src={member.referenceImageUrl} alt={member.name} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-zinc-400/60">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                                  </svg>
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1 pr-6">
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
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const runDelete = () => {
                                onDeleteCast(member.id);
                                if (activeCastId === member.id) setActiveCastId(project.cast.find(c => c.id !== member.id)?.id || null);
                              };
                              if (onConfirmDestructive) {
                                onConfirmDestructive({
                                  title: `Delete "${member.name}"?`,
                                  description: 'Removes this cast member. Shots that reference them will lose that character ref until you re-add one.',
                                  confirmLabel: 'Delete',
                                  run: runDelete,
                                });
                              } else {
                                runDelete();
                              }
                            }}
                            className="absolute top-1/2 right-2 -translate-y-1/2 text-zinc-400 hover:text-red-400 p-1 rounded transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                            aria-label={`Delete ${member.name}`}
                            title="Delete"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {project.cast.length > 0 && project.status !== 'characters_locked' && project.status !== 'environments_locked' && (() => {
                    const pending = project.cast.filter(c => !c.referenceImageUrl);
                    const allDone = pending.length === 0;
                    return (
                      <button
                        onClick={() => {
                          // If everyone has a look, treat as regen-all; otherwise fill the gaps.
                          const targets = allDone ? project.cast : pending;
                          targets.forEach(c => onGenerateLooks(c.id));
                        }}
                        disabled={looksLoading.size > 0}
                        className="w-full py-2 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                      >
                        {looksLoading.size > 0
                          ? `Generating ${looksLoading.size}…`
                          : allDone
                            ? `Regenerate all (${project.cast.length})`
                            : `Generate all looks (${pending.length})`}
                      </button>
                    );
                  })()}

                  {project.status === 'style_locked' && (
                    <button
                      onClick={() => { onAdvanceCharacters(); setViewPhase('environments'); }}
                      className={`w-full py-2 rounded-md text-xs font-semibold transition-colors flex items-center justify-center gap-2 ${
                        project.cast.some(c => c.referenceImageUrl)
                          ? 'bg-white text-black hover:bg-zinc-200'
                          : 'bg-white/[0.06] text-zinc-400 hover:bg-white/[0.1] hover:text-white border border-white/[0.08]'
                      }`}
                    >
                      {project.cast.some(c => c.referenceImageUrl) ? 'Continue to Environments' : 'Skip — Continue to Environments'}
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Character detail */}
              <div className="lg:col-span-9">
                {activeMember ? (
                  <div key={activeMember.id} className="rounded-xl overflow-hidden border border-white/[0.06]">
                    {/* Header bar — name, status, view prompt | regenerate */}
                    <div className="px-5 py-3 flex items-center gap-4 border-b border-white/[0.06]">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <input
                          key={`name-${activeMember.id}`}
                          defaultValue={activeMember.name}
                          size={Math.max(8, (activeMember.name || '').length)}
                          onBlur={(e) => onUpdateCast(activeMember.id, { name: e.target.value })}
                          className="text-sm font-medium text-white bg-transparent outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded px-1 -ml-1 w-auto"
                        />
                        {activeMember.referenceImageUrl && (
                          <span className="text-xs text-zinc-400 flex items-center gap-1 flex-shrink-0">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-white" aria-hidden="true"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                            Locked
                          </span>
                        )}
                        <button
                          onClick={() => setPromptPreview(prev => prev === activeMember.id ? null : activeMember.id)}
                          className="text-[11px] text-zinc-400 hover:text-white transition-colors px-2 py-1 rounded-md hover:bg-white/[0.04] flex-shrink-0"
                        >
                          {promptPreview === activeMember.id ? 'Hide prompt' : 'View prompt'}
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <input
                          type="file"
                          accept="image/*"
                          ref={castGuideUploadRef}
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file && activeMember) stageCastRef(activeMember.id, file);
                            if (e.target) e.target.value = '';
                          }}
                        />
                        <input
                          type="file"
                          accept="image/*"
                          ref={castAsIsUploadRef}
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file && activeMember) handleCastUploadAsIs(activeMember.id, file);
                            if (e.target) e.target.value = '';
                          }}
                        />
                        <button
                          onClick={() => castGuideUploadRef.current?.click()}
                          disabled={looksLoading.has(activeMember.id) || castUploading.has(activeMember.id)}
                          className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-300 hover:text-white rounded-md text-xs transition-colors disabled:opacity-50"
                          title="Upload a reference image — Gemini will render 3 candidates guided by it in the project's style."
                        >
                          Upload as guide
                        </button>
                        <button
                          onClick={() => castAsIsUploadRef.current?.click()}
                          disabled={castUploading.has(activeMember.id) || looksLoading.has(activeMember.id)}
                          className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-300 hover:text-white rounded-md text-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
                          title="Use this image directly as the locked reference — skips Gemini generation entirely. Good for reusing a look from a past run."
                        >
                          {castUploading.has(activeMember.id) && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>}
                          {castUploading.has(activeMember.id) ? 'Uploading…' : 'Use as-is'}
                        </button>
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
                      </div>
                    </div>

                    {/* Pending "upload as guide" — the artist picks a file,
                        then writes exactly what Gemini should take from it
                        before firing the 3-call batch. */}
                    {pendingCastRef?.memberId === activeMember.id && (
                      <div className="px-5 py-3 border-b border-white/[0.06] flex items-start gap-3 bg-white/[0.02]">
                        <img src={pendingCastRef.previewUrl} alt="Staged reference" className="w-16 h-16 object-cover rounded-md border border-white/[0.08] flex-shrink-0" />
                        <div className="flex-1 space-y-2 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] uppercase tracking-wide text-zinc-400">Reference ready</span>
                            <span className="text-[11px] text-zinc-400">— tell Gemini how to use it</span>
                          </div>
                          <AutoGrowTextarea
                            value={pendingCastRef.note}
                            onChange={e => setPendingCastRef(prev => prev ? { ...prev, note: e.target.value } : prev)}
                            placeholder="e.g. 'match the face and crown but re-render in our cinematic style' · 'use the composition, not the palette' · 'keep the pose, give him brighter lighting'"
                            rows={1}
                            autoFocus
                            className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.metaKey && !e.shiftKey) { e.preventDefault(); fireCastRefWithNote(); }
                              if (e.key === 'Escape') clearPendingCastRef();
                            }}
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={clearPendingCastRef}
                              className="text-[11px] text-zinc-400 hover:text-zinc-300 px-2 py-1 transition-colors"
                            >Cancel</button>
                            <button
                              onClick={fireCastRefWithNote}
                              className="text-[11px] bg-white text-black rounded-md px-3 py-1.5 font-semibold hover:bg-zinc-200 transition-colors"
                            >Generate 3 looks</button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Prompt preview */}
                    {promptPreview === activeMember.id && (
                      <div className="px-5 py-3 border-b border-white/[0.06] flex items-start gap-3">
                        {project.styleAssetUrl && (
                          <div className="relative flex-shrink-0">
                            <img src={project.styleAssetUrl} className="w-12 h-12 object-cover rounded border border-white/[0.06]" alt="Style ref" />
                            <div className="absolute inset-x-0 bottom-0 bg-black/80 text-[11px] text-zinc-400 text-center rounded-b">Style</div>
                          </div>
                        )}
                        <pre className="flex-1 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{
`Generate ONE cinematic character portrait in the visual style of Image 1.

${activeMember.name} — ${activeMember.description || '(no description)'}

Mid-shot character portrait, upper body and face visible, detailed costume and ornaments. Eye-level framing, natural cinematic lighting.

Style: ${project.styleDescription || '(none)'}

One single image. No collage, no grid, no multiple panels. No text, no watermark.
Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy. Should feel like a real film still.

→ Model: gemini-3-pro-image-preview · aspect ${project.aspectRatio || '16:9'}
→ 3 parallel calls, same prompt`
                        }</pre>
                      </div>
                    )}

                    {/* Hero area — new candidates take priority over locked, so a regen
                        is always visible. The locked look is preserved in the DB until the
                        user picks a new one or hits "Keep current" to discard the candidates. */}
                    {activeLooks.length > 0 ? (
                      <div>
                        {activeMember.referenceImageUrl && (
                          <div className="px-5 py-2.5 flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02]">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="text-[11px] uppercase tracking-wide text-zinc-400 flex-shrink-0">New candidates</span>
                              <span className="text-xs text-zinc-400">— pick one to replace the locked look, or</span>
                              <button
                                onClick={() => onDiscardLookCandidates?.(activeMember.id)}
                                className="text-xs text-zinc-300 hover:text-white px-2 py-0.5 rounded-md hover:bg-white/[0.06] transition-colors flex items-center gap-1.5 flex-shrink-0"
                                title="Discard these candidates and revert to the currently locked look"
                              >
                                <img src={activeMember.referenceImageUrl} alt="" className="w-4 h-4 rounded object-cover" />
                                Keep current
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-3 gap-px bg-black/20">
                          {activeLooks.map((look) => (
                            <div key={look.id} className="relative group cursor-pointer bg-black/10">
                              <img src={look.url} alt={activeMember.name} onClick={() => setModalImage(look.url)} className="w-full h-auto object-contain" />
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity pointer-events-none">
                                <button
                                  onClick={() => onLockCharacter(activeMember.id, look.id)}
                                  className="pointer-events-auto bg-white/95 backdrop-blur text-black px-3 py-1.5 rounded-md text-xs font-medium hover:bg-white transition-colors flex items-center gap-1.5"
                                  aria-label="Lock this look"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                  Lock
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : looksLoading.has(activeMember.id) ? (
                      // Generating — keep the locked image visible in the background if it exists.
                      <div className="relative">
                        {activeMember.referenceImageUrl && (
                          <img src={activeMember.referenceImageUrl} alt={activeMember.name} className="w-full h-auto max-h-[500px] object-contain mx-auto opacity-30" />
                        )}
                        <div className={`${activeMember.referenceImageUrl ? 'absolute inset-0' : 'h-64'} flex items-center justify-center bg-black/40`}>
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-6 h-6 border-2 border-zinc-600 border-t-white rounded-full animate-spin"></div>
                            <span className="text-sm text-zinc-300">Generating new looks…</span>
                            {activeMember.referenceImageUrl && <span className="text-[11px] text-zinc-400">Your locked look is safe — pick a new one only if you prefer it.</span>}
                          </div>
                        </div>
                      </div>
                    ) : activeMember.referenceImageUrl ? (
                      <div className="relative cursor-zoom-in bg-black/20" onClick={() => setModalImage(activeMember.referenceImageUrl!)}>
                        <img src={activeMember.referenceImageUrl} alt={activeMember.name} className="w-full h-auto max-h-[500px] object-contain mx-auto" />
                      </div>
                    ) : (
                      <div className="h-48 flex items-center justify-center bg-black/10">
                        <span className="text-sm text-zinc-400">No reference yet — generate looks below</span>
                      </div>
                    )}

                    {/* ═══ UNIFIED TOOLKIT — same pattern as Studio ═══ */}
                    <div className="px-5 py-4 space-y-3 border-t border-white/[0.06]">
                      {/* Description — collapsed context */}
                      <details className="group">
                        <summary className="text-[11px] uppercase tracking-wide text-zinc-500 cursor-pointer hover:text-zinc-400 flex items-center gap-1">
                          <svg className="w-3 h-3 transition-transform group-open:rotate-90" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
                          Description (from script)
                        </summary>
                        <div
                          key={`desc-${activeMember.id}`}
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => onUpdateCast(activeMember.id, { description: e.currentTarget.textContent || '' })}
                          className="mt-1 text-sm text-zinc-400 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded px-1 -mx-1"
                        >
                          {activeMember.description}
                        </div>
                      </details>

                      {/* 1. Ref chips */}
                      {project.styleAssetUrl && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] text-zinc-400 mr-1">Refs:</span>
                          <div className="group/ref relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border border-white/[0.08] text-zinc-300 bg-white/[0.02] cursor-pointer"
                            onClick={() => setModalImage(project.styleAssetUrl!)}>
                            <img src={project.styleAssetUrl} className="w-4 h-4 rounded-sm object-cover flex-shrink-0" alt="" />
                            <span>Style</span>
                            <div className="hidden group-hover/ref:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[200] pointer-events-none">
                              <img src={project.styleAssetUrl} className="max-w-44 max-h-44 object-contain rounded-lg shadow-xl border border-white/[0.1]" alt="Style" />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 2. Prompt — editable */}
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1 flex items-center gap-2">
                          Prompt
                          {activeMember.promptsStale && (
                            <span className="text-amber-400/80 normal-case tracking-normal text-[10px] bg-amber-500/10 px-1.5 py-0.5 rounded">Outdated</span>
                          )}
                          {savedFlash === `cast-prompt-${activeMember.id}` && <span className="text-[10px] text-emerald-400/70 normal-case">Saved</span>}
                        </div>
                        {activeMember.generationPrompt ? (
                          <AutoGrowTextarea
                            key={`gen-prompt-${activeMember.id}`}
                            defaultValue={activeMember.generationPrompt}
                            onBlur={(e) => {
                              const val = (e.target as HTMLTextAreaElement).value.trim();
                              if (val && val !== activeMember.generationPrompt) {
                                onUpdateCast(activeMember.id, { generationPrompt: val });
                                setSavedFlash(`cast-prompt-${activeMember.id}`);
                                setTimeout(() => setSavedFlash(null), 1500);
                              }
                            }}
                            rows={3}
                            className="w-full surface-inset rounded-md px-3 py-2.5 text-sm text-zinc-300 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                          />
                        ) : (
                          <div className="text-xs text-zinc-500 italic">Auto-generated on first look generation</div>
                        )}
                      </div>

                      {/* 3. Generate button */}
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => onGenerateLooks(activeMember.id)}
                          disabled={looksLoading.has(activeMember.id)}
                          className="px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                        >
                          {activeMember.referenceImageUrl ? 'Regenerate looks' : 'Generate 3 looks'}
                        </button>
                      </div>

                      {/* 4. Refine — plain text feedback */}
                      <div className="h-px bg-white/[0.06]" />
                      <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-2">
                        Refine — describe what's wrong, Claude rewrites the prompt
                      </div>
                      <div className="flex gap-2">
                        <AutoGrowTextarea
                          key={`feedback-${activeMember.id}`}
                          id={`char-feedback-${activeMember.id}`}
                          placeholder="e.g. 'make him older, more regal costume'"
                          rows={1}
                          className="flex-1 surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLTextAreaElement).value.trim()) {
                              e.preventDefault();
                              onGenerateLooks(activeMember.id, (e.target as HTMLTextAreaElement).value);
                              (e.target as HTMLTextAreaElement).value = '';
                            }
                          }}
                        />
                        <button
                          onClick={() => {
                            const input = document.getElementById(`char-feedback-${activeMember.id}`) as HTMLTextAreaElement;
                            if (input?.value.trim()) {
                              onGenerateLooks(activeMember.id, input.value);
                              input.value = '';
                            }
                          }}
                          disabled={looksLoading.has(activeMember.id)}
                          className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-400 hover:text-white rounded-md text-xs font-medium transition-colors flex-shrink-0 self-start"
                        >Refine</button>
                      </div>
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
            {onUnlockEnvironments && isLockedPhase('environments') && (
              <div className="flex justify-end">
                <UnlockPill onClick={onUnlockEnvironments} disabled={isLoading} label="Unlock environments" />
              </div>
            )}
            {project.environments.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Env sidebar */}
                <div className="lg:col-span-3">
                  <div className="surface rounded-xl p-4 space-y-4">
                    <h3 className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Environments</h3>
                    <div className="space-y-1 overflow-y-auto max-h-[500px] pr-1">
                      {project.environments.map(env => {
                        const isActive = activeEnvId === env.id;
                        const hasLook = !!env.referenceImageUrl;
                        return (
                          <div
                            key={env.id}
                            className={`group relative rounded-lg transition-colors ${
                              isActive ? 'bg-white/[0.08] border-l-2 border-l-white/70' : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
                            }`}
                          >
                            <button
                              onClick={() => setActiveEnvId(env.id)}
                              className="w-full text-left p-2.5 cursor-pointer flex gap-3 items-center outline-none"
                            >
                              <div className={`w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 ${hasLook ? '' : 'bg-white/[0.04]'}`}>
                                {env.referenceImageUrl ? (
                                  <img src={env.referenceImageUrl} alt={env.name} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-zinc-400/60">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>
                                    </svg>
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1 pr-6">
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
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const runDelete = async () => {
                                  try {
                                    await api.deleteEnvironment(project.id, env.id);
                                    if (activeEnvId === env.id) setActiveEnvId(project.environments.find(x => x.id !== env.id)?.id || null);
                                    onSetProject?.({ ...project, environments: project.environments.filter(x => x.id !== env.id) });
                                  } catch (err: any) { showActionError(`Delete failed: ${err.message}`); }
                                };
                                if (onConfirmDestructive) {
                                  onConfirmDestructive({
                                    title: `Delete "${env.name}"?`,
                                    description: 'Removes this environment. Shots that reference it will lose that environment ref until you re-add one.',
                                    confirmLabel: 'Delete',
                                    run: runDelete,
                                  });
                                } else {
                                  runDelete();
                                }
                              }}
                              className="absolute top-1/2 right-2 -translate-y-1/2 text-zinc-400 hover:text-red-400 p-1 rounded transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                              aria-label={`Delete ${env.name}`}
                              title="Delete"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {project.environments.length > 0 && project.status !== 'environments_locked' && (() => {
                      const pending = project.environments.filter(e => !e.referenceImageUrl);
                      const allDone = pending.length === 0;
                      return (
                        <button
                          onClick={() => {
                            const targets = allDone ? project.environments : pending;
                            targets.forEach(e => handleEnvGenerate(e.id));
                          }}
                          disabled={envGenerating.size > 0}
                          className="w-full py-2 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                        >
                          {envGenerating.size > 0
                            ? `Generating ${envGenerating.size}…`
                            : allDone
                              ? `Regenerate all (${project.environments.length})`
                              : `Generate all looks (${pending.length})`}
                        </button>
                      );
                    })()}

                    {project.status !== 'environments_locked' && (
                      <button
                        onClick={onAdvanceEnvironments}
                        className={`w-full py-2 rounded-md text-xs font-semibold transition-colors flex items-center justify-center gap-2 ${
                          project.environments.some(e => e.referenceImageUrl)
                            ? 'bg-white text-black hover:bg-zinc-200'
                            : 'bg-white/[0.06] text-zinc-400 hover:bg-white/[0.1] hover:text-white border border-white/[0.08]'
                        }`}
                      >
                        {project.environments.some(e => e.referenceImageUrl) ? 'Continue to Studio' : 'Skip — Continue to Studio'}
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Environment detail */}
                <div className="lg:col-span-9">
                  {activeEnv ? (
                    <div key={activeEnv.id} className="rounded-xl overflow-hidden border border-white/[0.06]">
                      {/* Header bar — name, status, view prompt | regenerate */}
                      <div className="px-5 py-3 flex items-center gap-4 border-b border-white/[0.06]">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <input
                            key={`env-name-${activeEnv.id}`}
                            defaultValue={activeEnv.name}
                            size={Math.max(8, (activeEnv.name || '').length)}
                            onBlur={async (e) => {
                              if (e.target.value === activeEnv.name) return;
                              try {
                                const updated = await api.updateEnvironment(project.id, activeEnv.id, { name: e.target.value });
                                onSetProject?.(updated);
                              } catch (err: any) { showActionError(`Save failed: ${err.message}`); }
                            }}
                            className="text-sm font-medium text-white bg-transparent outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded px-1 -ml-1 w-auto"
                          />
                          {activeEnv.referenceImageUrl && (
                            <span className="text-xs text-zinc-400 flex items-center gap-1 flex-shrink-0">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-white" aria-hidden="true"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                              Locked
                            </span>
                          )}
                          <button
                            onClick={() => setPromptPreview(prev => prev === activeEnv.id ? null : activeEnv.id)}
                            className="text-[11px] text-zinc-400 hover:text-white transition-colors px-2 py-1 rounded-md hover:bg-white/[0.04] flex-shrink-0"
                          >
                            {promptPreview === activeEnv.id ? 'Hide prompt' : 'View prompt'}
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <input
                            type="file"
                            accept="image/*"
                            ref={envGuideUploadRef}
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (file && activeEnv) stageEnvRef(activeEnv.id, file);
                              if (e.target) e.target.value = '';
                            }}
                          />
                          <input
                            type="file"
                            accept="image/*"
                            ref={envAsIsUploadRef}
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (file && activeEnv) handleEnvUploadAsIs(activeEnv.id, file);
                              if (e.target) e.target.value = '';
                            }}
                          />
                          <button
                            onClick={() => envGuideUploadRef.current?.click()}
                            disabled={envGenerating.has(activeEnv.id) || envUploading.has(activeEnv.id)}
                            className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-300 hover:text-white rounded-md text-xs transition-colors disabled:opacity-50"
                            title="Upload a reference image — Gemini will render 3 candidates guided by it in the project's style."
                          >
                            Upload as guide
                          </button>
                          <button
                            onClick={() => envAsIsUploadRef.current?.click()}
                            disabled={envUploading.has(activeEnv.id) || envGenerating.has(activeEnv.id)}
                            className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-300 hover:text-white rounded-md text-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
                            title="Use this image directly as the locked reference — skips Gemini generation. Good for reusing from a past run."
                          >
                            {envUploading.has(activeEnv.id) && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>}
                            {envUploading.has(activeEnv.id) ? 'Uploading…' : 'Use as-is'}
                          </button>
                          <button
                            onClick={() => handleEnvGenerate(activeEnv.id)}
                            disabled={envGenerating.has(activeEnv.id)}
                            className="px-4 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                          >
                            {envGenerating.has(activeEnv.id) ? 'Generating…' : activeEnv.referenceImageUrl ? 'Regenerate' : 'Generate Looks'}
                          </button>
                        </div>
                      </div>

                      {/* Pending "upload as guide" for this environment. */}
                      {pendingEnvRef?.envId === activeEnv.id && (
                        <div className="px-5 py-3 border-b border-white/[0.06] flex items-start gap-3 bg-white/[0.02]">
                          <img src={pendingEnvRef.previewUrl} alt="Staged reference" className="w-16 h-16 object-cover rounded-md border border-white/[0.08] flex-shrink-0" />
                          <div className="flex-1 space-y-2 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] uppercase tracking-wide text-zinc-400">Reference ready</span>
                              <span className="text-[11px] text-zinc-400">— tell Gemini how to use it</span>
                            </div>
                            <AutoGrowTextarea
                              value={pendingEnvRef.note}
                              onChange={e => setPendingEnvRef(prev => prev ? { ...prev, note: e.target.value } : prev)}
                              placeholder="e.g. 'match the architecture but re-render at golden hour' · 'keep the layout, change palette to our style'"
                              rows={1}
                              autoFocus
                              className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
                              onKeyDown={e => {
                                if (e.key === 'Enter' && !e.metaKey && !e.shiftKey) { e.preventDefault(); fireEnvRefWithNote(); }
                                if (e.key === 'Escape') clearPendingEnvRef();
                              }}
                            />
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={clearPendingEnvRef}
                                className="text-[11px] text-zinc-400 hover:text-zinc-300 px-2 py-1 transition-colors"
                              >Cancel</button>
                              <button
                                onClick={fireEnvRefWithNote}
                                className="text-[11px] bg-white text-black rounded-md px-3 py-1.5 font-semibold hover:bg-zinc-200 transition-colors"
                              >Generate 3 looks</button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Prompt preview */}
                      {promptPreview === activeEnv.id && (
                        <div className="px-5 py-3 border-b border-white/[0.06] flex items-start gap-3">
                          {project.styleAssetUrl && (
                            <div className="relative flex-shrink-0">
                              <img src={project.styleAssetUrl} className="w-12 h-12 object-cover rounded border border-white/[0.06]" alt="Style ref" />
                              <div className="absolute inset-x-0 bottom-0 bg-black/80 text-[11px] text-zinc-400 text-center rounded-b">Style</div>
                            </div>
                          )}
                          <pre className="flex-1 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{
`Generate ONE cinematic environment shot in the visual style of Image 1. No characters or figures.

${activeEnv.name} — ${activeEnv.description || '(no description)'}

Wide establishing shot, full environment visible, empty scene.

Style: ${project.styleDescription || '(none)'}

One single image. No collage, no grid, no multiple panels. No text, no watermark.
Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy. Should feel like a real film still.

→ Model: gemini-3-pro-image-preview · aspect ${project.aspectRatio || '16:9'}
→ 3 parallel calls, same prompt`
                          }</pre>
                        </div>
                      )}

                      {/* Hero area — same regen-priority pattern as cast: new candidates show
                          on top of the locked look so a regen is always visible. Locked stays
                          in the DB until the user picks a new one or hits "Keep current". */}
                      {activeEnvLooks.length > 0 ? (
                        <div>
                          {activeEnv.referenceImageUrl && (
                            <div className="px-5 py-2.5 flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02]">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="text-[11px] uppercase tracking-wide text-zinc-400 flex-shrink-0">New candidates</span>
                                <span className="text-xs text-zinc-400">— pick one to replace the locked look, or</span>
                                <button
                                  onClick={() => setEnvLooks(prev => ({ ...prev, [activeEnv.id]: [] }))}
                                  className="text-xs text-zinc-300 hover:text-white px-2 py-0.5 rounded-md hover:bg-white/[0.06] transition-colors flex items-center gap-1.5 flex-shrink-0"
                                  title="Discard these candidates and revert to the currently locked look"
                                >
                                  <img src={activeEnv.referenceImageUrl} alt="" className="w-4 h-4 rounded object-cover" />
                                  Keep current
                                </button>
                              </div>
                            </div>
                          )}
                          <div className="grid grid-cols-3 gap-px bg-black/20">
                            {activeEnvLooks.map(look => (
                              <div key={look.id} className="relative group cursor-pointer bg-black/10">
                                <img src={look.url} alt={activeEnv.name} onClick={() => setModalImage(look.url)} className="w-full h-auto object-contain" />
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity pointer-events-none">
                                  <button
                                    onClick={() => handleEnvLock(activeEnv.id, look.id)}
                                    className="pointer-events-auto bg-white/95 backdrop-blur text-black px-3 py-1.5 rounded-md text-xs font-medium hover:bg-white transition-colors flex items-center gap-1.5"
                                    aria-label="Lock this look"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                    Lock
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : envGenerating.has(activeEnv.id) ? (
                        <div className="relative">
                          {activeEnv.referenceImageUrl && (
                            <img src={activeEnv.referenceImageUrl} alt={activeEnv.name} className="w-full h-auto max-h-[500px] object-contain mx-auto opacity-30" />
                          )}
                          <div className={`${activeEnv.referenceImageUrl ? 'absolute inset-0' : 'h-64'} flex items-center justify-center bg-black/40`}>
                            <div className="flex flex-col items-center gap-3">
                              <div className="w-6 h-6 border-2 border-zinc-600 border-t-white rounded-full animate-spin"></div>
                              <span className="text-sm text-zinc-300">Generating new looks…</span>
                              {activeEnv.referenceImageUrl && <span className="text-[11px] text-zinc-400">Your locked look is safe — pick a new one only if you prefer it.</span>}
                            </div>
                          </div>
                        </div>
                      ) : activeEnv.referenceImageUrl ? (
                        <div className="relative cursor-zoom-in bg-black/20" onClick={() => setModalImage(activeEnv.referenceImageUrl!)}>
                          <img src={activeEnv.referenceImageUrl} alt={activeEnv.name} className="w-full h-auto max-h-[500px] object-contain mx-auto" />
                        </div>
                      ) : (
                        <div className="h-48 flex items-center justify-center bg-black/10">
                          <span className="text-sm text-zinc-400">No reference yet — generate looks above</span>
                        </div>
                      )}

                      {/* ═══ UNIFIED TOOLKIT — same pattern as characters ═══ */}
                      <div className="px-5 py-4 space-y-3 border-t border-white/[0.06]">
                        {/* Description — collapsed context */}
                        <details className="group">
                          <summary className="text-[11px] uppercase tracking-wide text-zinc-500 cursor-pointer hover:text-zinc-400 flex items-center gap-1">
                            <svg className="w-3 h-3 transition-transform group-open:rotate-90" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
                            Description (from script)
                          </summary>
                          <div
                            key={`env-desc-${activeEnv.id}`}
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={async (e) => {
                              try {
                                await api.updateEnvironment(project.id, activeEnv.id, { name: activeEnv.name, description: e.currentTarget.textContent || '' });
                              } catch (err: any) { showActionError(`Save failed: ${err.message}`); }
                            }}
                            className="mt-1 text-sm text-zinc-400 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded px-1 -mx-1"
                          >
                            {activeEnv.description}
                          </div>
                        </details>

                        {/* 1. Ref chips */}
                        {project.styleAssetUrl && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] text-zinc-400 mr-1">Refs:</span>
                            <div className="group/ref relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border border-white/[0.08] text-zinc-300 bg-white/[0.02] cursor-pointer"
                              onClick={() => setModalImage(project.styleAssetUrl!)}>
                              <img src={project.styleAssetUrl} className="w-4 h-4 rounded-sm object-cover flex-shrink-0" alt="" />
                              <span>Style</span>
                              <div className="hidden group-hover/ref:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[200] pointer-events-none">
                                <img src={project.styleAssetUrl} className="max-w-44 max-h-44 object-contain rounded-lg shadow-xl border border-white/[0.1]" alt="Style" />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* 2. Prompt — editable */}
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1 flex items-center gap-2">
                            Prompt
                            {activeEnv.promptsStale && (
                              <span className="text-amber-400/80 normal-case tracking-normal text-[10px] bg-amber-500/10 px-1.5 py-0.5 rounded">Outdated</span>
                            )}
                            {savedFlash === `env-prompt-${activeEnv.id}` && <span className="text-[10px] text-emerald-400/70 normal-case">Saved</span>}
                          </div>
                          {activeEnv.generationPrompt ? (
                            <AutoGrowTextarea
                              key={`env-gen-prompt-${activeEnv.id}`}
                              defaultValue={activeEnv.generationPrompt}
                              onBlur={async (e) => {
                                const val = e.target.value.trim();
                                if (val && val !== activeEnv.generationPrompt) {
                                  try {
                                    await api.updateEnvironment(project.id, activeEnv.id, { generationPrompt: val });
                                    setSavedFlash(`env-prompt-${activeEnv.id}`);
                                    setTimeout(() => setSavedFlash(null), 1500);
                                  } catch (err: any) { showActionError(`Save failed: ${err.message}`); }
                                }
                              }}
                              rows={3}
                              className="w-full surface-inset rounded-md px-3 py-2.5 text-sm text-zinc-300 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                            />
                          ) : (
                            <div className="text-xs text-zinc-500 italic">Auto-generated on first look generation</div>
                          )}
                        </div>

                        {/* 3. Generate button */}
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleEnvGenerate(activeEnv.id)}
                            disabled={envGenerating.has(activeEnv.id)}
                            className="px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                          >
                            {activeEnv.referenceImageUrl ? 'Regenerate looks' : 'Generate 3 looks'}
                          </button>
                        </div>

                        {/* 4. Refine — plain text feedback */}
                        <div className="h-px bg-white/[0.06]" />
                        <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-2">
                          Refine — describe what's wrong, Claude rewrites the prompt
                        </div>
                        <div className="flex gap-2">
                          <AutoGrowTextarea
                            key={`env-feedback-${activeEnv.id}`}
                            id={`env-feedback-${activeEnv.id}`}
                            placeholder="e.g. 'more ancient, add river in foreground'"
                            rows={1}
                            className="flex-1 surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLTextAreaElement).value.trim()) {
                                e.preventDefault();
                                handleEnvGenerate(activeEnv.id, undefined, (e.target as HTMLTextAreaElement).value);
                                (e.target as HTMLTextAreaElement).value = '';
                              }
                            }}
                          />
                          <button
                            onClick={() => {
                              const input = document.getElementById(`env-feedback-${activeEnv.id}`) as HTMLTextAreaElement;
                              if (input?.value.trim()) {
                                handleEnvGenerate(activeEnv.id, undefined, input.value);
                                input.value = '';
                              }
                            }}
                            disabled={envGenerating.has(activeEnv.id)}
                            className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-400 hover:text-white rounded-md text-xs font-medium transition-colors flex-shrink-0 self-start"
                          >Refine</button>
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
