
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppStep, ApiProject, VideoShot, GenerationStatus, ChatMessage } from './types';
import { AnalysisEditor } from './components/AnalysisEditor';
import { Storyboard } from './components/Storyboard';
import { StepRender } from './components/StepRender';
import { ChatAssistant } from './components/ChatAssistant';
import { XRayPanel } from './components/XRayPanel';
import { Dashboard } from './components/Dashboard';
import { PromptsLibrary } from './components/PromptsLibrary';
import { getVideoModel } from './constants/videoModels';
import { useAuth } from './contexts/AuthContext';
import * as api from './services/api';

const PIPELINE_STEPS = [
  { id: AppStep.UPLOAD, label: 'Queue' },
  { id: AppStep.BLUEPRINT, label: 'Blueprint' },
  { id: AppStep.STUDIO, label: 'Studio' },
  { id: AppStep.RENDER, label: 'Render' },
];

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: 'easeOut' as const },
};

type ProjectSummary = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  parentProjectId?: string;
};

// Humanize a timestamp: "3m ago", "2h ago", "yesterday", "Mar 4".
const relativeTime = (iso?: string): string => {
  if (!iso) return '';
  const then = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  uploaded: { label: 'Uploaded', color: 'text-zinc-400' },
  analyzed: { label: 'Analyzed', color: 'text-zinc-400' },
  concept_locked: { label: 'Concept', color: 'text-blue-400' },
  scripted: { label: 'Scripted', color: 'text-indigo-400' },
  style_locked: { label: 'Styled', color: 'text-purple-400' },
  characters_locked: { label: 'Characters', color: 'text-pink-400' },
  environments_locked: { label: 'Environments', color: 'text-emerald-400' },
};

const App: React.FC = () => {
  const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth();

  // Auth gate — show sign-in screen if not authenticated
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#141418] flex items-center justify-center">
        <div className="text-zinc-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#141418] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-display text-white mb-2">Lahari Media Engine</h1>
          <p className="text-zinc-400 text-sm mb-8">AI-powered devotional music video production</p>
          <button
            onClick={signInWithGoogle}
            className="inline-flex items-center gap-3 px-6 py-3 bg-white text-black rounded-lg font-medium text-sm hover:bg-zinc-100 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return <AppMain user={user} signOut={signOut} />;
};

const AppMain: React.FC<{ user: { id: string; email?: string; user_metadata?: any }; signOut: () => Promise<void> }> = ({ user, signOut }) => {
  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.UPLOAD);
  const [project, setProject] = useState<ApiProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Character look candidates per cast member
  const [lookCandidates, setLookCandidates] = useState<Record<string, { id: string; url: string }[]>>({});
  // Per-member loading state for parallel character generation
  const [looksLoading, setLooksLoading] = useState<Set<string>>(new Set());
  // X-Ray panel
  const [xrayOpen, setXrayOpen] = useState(false);
  // Prompts library — full-page overlay, not tied to a project
  const [promptsOpen, setPromptsOpen] = useState(false);
  // Bulk-queue state — shot IDs waiting for a worker to pick them up.
  // Order matters: position in the array = visible "Nth in line" badge.
  // Worker pulls from the front; UI reads indexOf for the badge.
  const [frameQueue, setFrameQueue] = useState<string[]>([]);
  const [videoQueue, setVideoQueue] = useState<string[]>([]);
  // Studio scene navigation
  const [activeSceneIdx, setActiveSceneIdx] = useState(0);
  // Project sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [projectListLoading, setProjectListLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const startRename = (id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameDraft(currentTitle);
  };
  const cancelRename = () => { setRenamingId(null); setRenameDraft(''); };
  const saveRename = async () => {
    const id = renamingId;
    const next = renameDraft.trim();
    if (!id || !next) { cancelRename(); return; }
    // Optimistic — flip both the list entry and (if applicable) the active
    // project so the header updates without waiting.
    setProjectList(list => list.map(p => p.id === id ? { ...p, title: next } : p));
    setProject(cur => cur && cur.id === id ? { ...cur, title: next } : cur);
    cancelRename();
    try { await api.updateProject(id, { title: next }); }
    catch (err: any) { setError(err.message); }
  };

  // Auto-dismiss error toast
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Persist project + step to localStorage so refresh stays on the same page
  const persistState = useCallback((projectId: string | null, step: AppStep) => {
    if (projectId) localStorage.setItem('lahari:projectId', projectId);
    else localStorage.removeItem('lahari:projectId');
    localStorage.setItem('lahari:step', String(step));
  }, []);

  // On mount: restore from localStorage, fall back to most recent project
  useEffect(() => {
    const savedId = localStorage.getItem('lahari:projectId');
    const savedStepRaw = localStorage.getItem('lahari:step');
    const savedStep = savedStepRaw !== null ? Number(savedStepRaw) as AppStep : null;

    const load = async () => {
      try {
        if (savedId) {
          const p = await api.getProject(savedId);
          if (p) {
            setProject(p);
            if (savedStep !== null && savedStep >= AppStep.UPLOAD && savedStep <= AppStep.RENDER) {
              setCurrentStep(savedStep);
            } else {
              navigateToPhase(p);
            }
            return;
          }
        }
        // Fallback: load most recent project
        const projects = await api.listProjects();
        if (projects.length > 0) {
          const p = await api.getProject(projects[0].id);
          if (p) {
            setProject(p);
            navigateToPhase(p);
          }
        }
      } catch {
        // No projects yet, stay on upload
      }
    };
    load();
  }, []);

  // Persist to localStorage whenever project or step changes
  useEffect(() => {
    persistState(project?.id || null, currentStep);
  }, [project?.id, currentStep, persistState]);

  // Determine which step to show based on project phase
  const navigateToPhase = (p: ApiProject) => {
    let step: AppStep;
    if ((p.status === 'characters_locked' || p.status === 'environments_locked') && p.scenes.length > 0) {
      step = AppStep.STUDIO;
    } else if (p.conceptOptions.length > 0 || p.status === 'concept_locked' || p.status === 'scripted' || p.status === 'style_locked' || p.status === 'characters_locked' || p.status === 'environments_locked') {
      step = AppStep.BLUEPRINT;
    } else {
      step = AppStep.UPLOAD;
    }
    setCurrentStep(step);
  };

  // ─── Upload & Analyze ───────────────────────────────────────────

  const handleFileUpload = async (file: File, metadata?: { title?: string; context?: string; language?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const p = await api.createProject(file, metadata);
      setProject(p);
      setCurrentStep(AppStep.UPLOAD);
    } catch (err: any) {
      setError(err.message || 'Failed to analyze audio.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Generate Concepts (separate from analysis) ────────────────

  // One active AbortController per op key. Clicking "Stop" on any pending
  // generate button calls abortOp(key) → the fetch rejects with AbortError,
  // which isCancelled() catches so no error toast. Server-side work keeps
  // running for now (harmless, still logged), but the UI unblocks instantly.
  const opsRef = useRef<Record<string, AbortController>>({});
  const startOp = useCallback((key: string): AbortSignal => {
    opsRef.current[key]?.abort();
    const ctrl = new AbortController();
    opsRef.current[key] = ctrl;
    return ctrl.signal;
  }, []);
  const abortOp = useCallback((key: string) => {
    opsRef.current[key]?.abort();
    delete opsRef.current[key];
  }, []);
  const endOp = useCallback((key: string) => {
    delete opsRef.current[key];
  }, []);

  const handleGenerateConcepts = async (opts?: { lyrics?: string; context?: string; language?: string; userNote?: string; directorBrief?: string }) => {
    if (!project) return;
    const signal = startOp('concepts');
    setLoading(true);
    setError(null);
    try {
      const p = await api.generateConcepts(project.id, opts, signal);
      setProject(p);
      setCurrentStep(AppStep.BLUEPRINT);
    } catch (err: any) {
      if (!api.isCancelled(err)) setError(err.message || 'Concept generation failed.');
    } finally {
      endOp('concepts');
      setLoading(false);
    }
  };

  const handleCancelConcepts = () => abortOp('concepts');

  // ─── Concept Lock-in ────────────────────────────────────────────

  const handleLockConcept = async (conceptIndex: number) => {
    if (!project) return;
    const chosen = project.conceptOptions[conceptIndex];
    const prev = project.lockedConcept;
    const switching = prev && JSON.stringify(prev) !== JSON.stringify(chosen);
    const hasScenes = project.scenes.length > 0;
    const hasMedia = project.scenes.some(s => s.shots.some((x: any) => x.imageUrl || x.videoUrl));

    // Destructive only when switching AWAY from a previously locked concept
    // with downstream work. Picking for the first time, re-picking the same
    // concept, or switching before any script exists is all a plain lock.
    if (switching && hasScenes) {
      setDestructive({
        title: 'Switch to a different concept?',
        description: hasMedia
          ? 'The script, style, cast, environments, and ALL generated images/videos were built around the old concept — switching makes them invalid and they will be discarded. Fork first to keep a snapshot.'
          : 'The script, style, cast, and environments were built around the old concept — switching invalidates them and they will be wiped. Fork first to keep a snapshot.',
        run: ({ fork }) => api.lockConcept(project.id, conceptIndex, { fork }),
      });
      return;
    }
    setLoading(true); setError(null);
    try {
      const p = await api.lockConcept(project.id, conceptIndex);
      setProject(p);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Destructive action dialog state ────────────────────────────
  // The 3-option dialog (Fork primary / Overwrite / Cancel) is opened via
  // setDestructive({...}). We store what to do on each choice.
  type DestructiveAction = {
    title: string;
    description: string;
    // Fork-capable flows: 3 buttons (Fork & change · Overwrite · Cancel)
    // Simple confirms: 2 buttons (confirmLabel · Cancel)
    mode?: 'fork' | 'simple';
    confirmLabel?: string;      // used in 'simple' mode
    overwriteLabel?: string;    // used in 'fork' mode
    run: (opts: { fork: boolean }) => Promise<any> | any;
    onDone?: (result: any) => void;  // handles result when the action is not a project mutation
  };
  const [destructive, setDestructive] = useState<DestructiveAction | null>(null);

  const runDestructive = async (fork: boolean) => {
    if (!destructive) return;
    const action = destructive;
    setDestructive(null);
    setLoading(true);
    setError(null);
    try {
      const result = await action.run({ fork });
      if (action.onDone) {
        action.onDone(result);
      } else if (result && typeof result === 'object' && 'id' in result) {
        // Default: treat result as updated project
        setProject(result);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // All unlocks are pure navigation now — no dialog, no data loss.
  // Destructive events happen when the user actively picks or regenerates
  // something (lock-concept with a different choice, generate-script re-run).
  const handleUnlockConcept = () => doUnlock(() => api.unlockConcept(project!.id));

  const handleRefineConcept = async (feedback: string) => {
    if (!project) return;
    setLoading(true);
    try {
      const p = await api.refineConcept(project.id, feedback);
      setProject(p);
    } catch (err: any) {
      setError(`Concept refinement failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateConcept = async (updates: Record<string, any>) => {
    if (!project) return;
    // Optimistic: merge updates into locked concept
    const prevConcept = project.lockedConcept;
    if (prevConcept) {
      setProject(prev => prev ? { ...prev, lockedConcept: { ...prev.lockedConcept!, ...updates } } : prev);
    }
    try {
      await api.updateConcept(project.id, updates);
    } catch (err: any) {
      if (prevConcept) setProject(prev => prev ? { ...prev, lockedConcept: prevConcept } : prev);
      setError(`Concept update failed: ${err.message}`);
    }
  };

  const handleUnlockScript = () => doUnlock(() => api.unlockScript(project!.id));
  const handleUnlockCharacters = async () => {
    if (!project) return;
    await doUnlock(() => api.unlockCharacters(project.id));
    // Auto-generate fresh candidates for all characters that had a locked reference
    const lockedCast = project.cast.filter(c => c.referenceImageUrl);
    for (const c of lockedCast) {
      handleGenerateLooks(c.id);
    }
  };
  const handleUnlockEnvironments = () => doUnlock(() => api.unlockEnvironments(project!.id));

  const doUnlock = async (fn: () => Promise<any>) => {
    if (!project) return;
    setError(null);
    try {
      const result = await fn();
      // Minimal response: apply status change optimistically
      if (result?.ok && result?.status) {
        setProject(prev => prev ? { ...prev, status: result.status } : prev);
      } else {
        setProject(result);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─── Style Lock ────────────────────────────────────────────────

  const handleLockStyle = async (assetId: string, styleDescription?: string) => {
    if (!project) return;
    setLoading(true);
    try {
      const p = await api.lockStyle(project.id, assetId, styleDescription);
      setProject(p);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlockStyle = async () => { await doUnlock(() => api.unlockStyle(project!.id)); };

  // ─── Character Look Generation & Lock ───────────────────────────

  const handleGenerateLooks = async (castMemberId: string, feedback?: string, refImage?: File) => {
    if (!project) return;
    setLooksLoading(prev => new Set(prev).add(castMemberId));
    setError(null);
    try {
      const result = await api.generateLooks(project.id, castMemberId, feedback, undefined, refImage);
      setLookCandidates(prev => ({ ...prev, [castMemberId]: result.looks }));
      setProject(result.project);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLooksLoading(prev => { const next = new Set(prev); next.delete(castMemberId); return next; });
    }
  };

  const handleLockCharacter = async (castMemberId: string, assetId: string) => {
    if (!project) return;
    try {
      await api.lockCharacter(project.id, castMemberId, assetId);
      // Optimistic: set the reference on the cast member
      setProject(prev => prev ? {
        ...prev,
        cast: prev.cast.map(c => c.id === castMemberId ? { ...c, referenceImageUrl: lookCandidates[castMemberId]?.find(l => l.id === assetId)?.url || c.referenceImageUrl } : c)
      } : prev);
      setLookCandidates(prev => ({ ...prev, [castMemberId]: [] }));
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─── Cast Management ────────────────────────────────────────────

  const handleAddCast = async (name: string, description: string) => {
    if (!project) return;
    try {
      const p = await api.addCastMember(project.id, name, description);
      setProject(p);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUpdateCast = async (memberId: string, updates: { name?: string; description?: string }) => {
    if (!project) return;
    try {
      const p = await api.updateCastMember(project.id, memberId, updates);
      setProject(p);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteCast = async (memberId: string) => {
    if (!project) return;
    const prevCast = project.cast;
    setProject(prev => prev ? { ...prev, cast: prev.cast.filter(c => c.id !== memberId) } : prev);
    try {
      await api.deleteCastMember(project.id, memberId);
    } catch (err: any) {
      setProject(prev => prev ? { ...prev, cast: prevCast } : prev);
      setError(err.message);
    }
  };

  // ─── Script Generation ──────────────────────────────────────────

  const handleUpdateScene = async (sceneId: string, updates: { narrativeDescription?: string }) => {
    if (!project) return;
    // Optimistic update
    setProject(prev => prev ? {
      ...prev,
      scenes: prev.scenes.map(s => s.id === sceneId ? { ...s, ...updates } : s)
    } : prev);
    api.updateScene(project.id, sceneId, updates).catch(console.error);
  };

  const handleRefineScript = async (feedback: string) => {
    if (!project) return;
    const signal = startOp('script');
    setLoading(true); setError(null);
    try {
      const p = await api.refineScript(project.id, feedback, signal);
      setProject(p);
    } catch (err: any) {
      if (!api.isCancelled(err)) setError('Script refinement failed: ' + err.message);
    } finally { endOp('script'); setLoading(false); }
  };

  const handleGenerateScript = async (userNote?: string) => {
    if (!project) return;
    // First-time gen: no existing script to destroy, just run.
    if (project.scenes.length === 0) {
      const signal = startOp('script');
      setLoading(true); setError(null);
      try {
        const p = await api.generateScript(project.id, userNote, undefined, signal);
        setProject(p);
      } catch (err: any) {
        if (!api.isCancelled(err)) setError('Script generation failed: ' + err.message);
      } finally { endOp('script'); setLoading(false); }
      return;
    }
    // Re-gen: destructive (wipes cast + deletes scenes/shots). Offer fork.
    const hasMedia = project.scenes.some(s => s.shots.some((x: any) => x.imageUrl || x.videoUrl));
    setDestructive({
      title: 'Regenerate script?',
      description: hasMedia
        ? 'This wipes the cast, deletes every scene and shot, and DISCARDS all generated images and videos. Fork first to keep a snapshot.'
        : 'This wipes the cast and deletes every scene and shot. Fork first to keep a snapshot.',
      run: ({ fork }) => api.generateScript(project.id, userNote, { fork }),
    });
  };

  // ─── Advance past Characters / Environments ────────────────────

  const handleAdvanceCharacters = async () => {
    if (!project) return;
    setLoading(true);
    try {
      const result = await api.advanceCharacters(project.id);
      if (result?.ok && result?.status) {
        setProject(prev => prev ? { ...prev, status: result.status } : prev);
      } else { setProject(result); }
    } catch (err: any) {
      setError('Failed to advance: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAdvanceEnvironments = async () => {
    if (!project) return;
    setLoading(true);
    try {
      const result = await api.advanceEnvironments(project.id);
      if (result?.ok && result?.status) {
        setProject(prev => prev ? { ...prev, status: result.status } : prev);
      } else { setProject(result); }
    } catch (err: any) {
      setError('Failed to advance: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Launch Studio (write shot prompts first) ──────────────────

  const handleLaunchStudio = async () => {
    if (!project) return;
    // Skip bulk prompt regeneration if every shot already has a prompt written.
    // User just clicking Launch Studio again after coming back from Blueprint
    // shouldn't burn a Claude call. The explicit "Rewrite all" button in Studio
    // covers the deliberate-regen case.
    const allShotsHavePrompts = project.scenes.length > 0
      && project.scenes.every(s => s.shots.length > 0 && s.shots.every(x => !!x.visualPrompt));
    if (allShotsHavePrompts) {
      setCurrentStep(AppStep.STUDIO);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const p = await api.writeShotPrompts(project.id);
      setProject(p);
      setCurrentStep(AppStep.STUDIO);
    } catch (err: any) {
      setError('Failed to prepare shot prompts: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUsePrevLastFrame = async (shotId: string) => {
    if (!project) return;
    setError(null);
    try {
      const p = await api.usePrevLastFrame(project.id, shotId);
      setProject(p);
    } catch (err: any) {
      setError('Failed to copy frame: ' + err.message);
    }
  };

  const updateShotOptimistic = (shotId: string, updates: Partial<VideoShot>) => {
    setProject(prev => prev ? {
      ...prev,
      scenes: prev.scenes.map(s => ({
        ...s,
        shots: s.shots.map(sh => sh.id === shotId ? { ...sh, ...updates } : sh)
      }))
    } : prev);
  };

  const handleClearShotFrame = async (shotId: string) => {
    if (!project) return;
    setError(null);
    const shot = project.scenes.flatMap(s => s.shots).find(s => s.id === shotId);
    const prev = { imageUrl: shot?.imageUrl, imageStatus: shot?.imageStatus, locked: shot?.locked };
    updateShotOptimistic(shotId, { imageUrl: undefined, imageStatus: GenerationStatus.IDLE, locked: false });
    try {
      await api.clearShotFrame(project.id, shotId);
    } catch (err: any) {
      updateShotOptimistic(shotId, prev as any);
      setError('Failed to clear frame: ' + err.message);
    }
  };

  const handleGenerateEndFrame = async (shotId: string, refs?: api.ShotRefInput[]) => {
    if (!project) return;
    updateShotOptimistic(shotId, { endImageStatus: GenerationStatus.LOADING });
    try {
      const p = await api.generateEndFrame(project.id, shotId, refs);
      setProject(p);
    } catch (err: any) {
      updateShotOptimistic(shotId, { endImageStatus: GenerationStatus.ERROR });
      setError(`End frame generation failed: ${err.message}`);
    }
  };

  const handleClearEndFrame = async (shotId: string) => {
    if (!project) return;
    const shot = project.scenes.flatMap(s => s.shots).find(s => s.id === shotId);
    const prev = { endImageUrl: shot?.endImageUrl, endImageStatus: shot?.endImageStatus, videoStatus: shot?.videoStatus };
    updateShotOptimistic(shotId, { endImageUrl: undefined, endImageStatus: GenerationStatus.IDLE, videoStatus: GenerationStatus.STALE });
    try {
      await api.clearEndFrame(project.id, shotId);
    } catch (err: any) {
      updateShotOptimistic(shotId, prev as any);
      setError(`Clear end frame failed: ${err.message}`);
    }
  };

  const handleClearExtractedFrame = async (shotId: string) => {
    if (!project) return;
    const shot = project.scenes.flatMap(s => s.shots).find(s => s.id === shotId);
    const prev = { extractedLastFrameUrl: shot?.extractedLastFrameUrl };
    updateShotOptimistic(shotId, { extractedLastFrameUrl: undefined });
    try {
      await api.clearExtractedFrame(project.id, shotId);
    } catch (err: any) {
      updateShotOptimistic(shotId, prev as any);
      setError(`Clear extracted frame failed: ${err.message}`);
    }
  };

  const handleUploadEndFrame = async (shotId: string, file: File) => {
    if (!project) return;
    try {
      const p = await api.uploadEndFrame(project.id, shotId, file);
      setProject(p);
    } catch (err: any) {
      setError(`Upload end frame failed: ${err.message}`);
    }
  };

  const handleUploadShotRef = async (shotId: string, file: File) => {
    if (!project) return;
    try {
      const result = await api.uploadShotRef(project.id, shotId, file);
      // Optimistic: add the ref to the shot
      updateShotOptimistic(shotId, {
        refImages: [...(project.scenes.flatMap(s => s.shots).find(s => s.id === shotId)?.refImages || []), result.ref],
      });
    } catch (err: any) {
      setError(`Upload ref failed: ${err.message}`);
    }
  };

  const handleDeleteShotRef = async (shotId: string, assetId: string) => {
    if (!project) return;
    const shot = project.scenes.flatMap(s => s.shots).find(s => s.id === shotId);
    const prev = shot?.refImages || [];
    updateShotOptimistic(shotId, { refImages: prev.filter(r => r.id !== assetId) });
    try {
      await api.deleteShotRef(project.id, shotId, assetId);
    } catch (err: any) {
      updateShotOptimistic(shotId, { refImages: prev });
      setError(`Delete ref failed: ${err.message}`);
    }
  };

  const handleRewriteShotPrompts = async (userNote?: string) => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const p = await api.writeShotPrompts(project.id, userNote);
      setProject(p);
    } catch (err: any) {
      setError('Failed to rewrite shot prompts: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Project Settings ───────────────────────────────────────────

  const handleUpdateProject = async (updates: Record<string, any>) => {
    if (!project) return;
    setProject(prev => prev ? { ...prev, ...updates } : prev);
    try {
      await api.updateProject(project.id, updates);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─── Shot Image & Video ─────────────────────────────────────────

  const handleGenerateImage = async (sceneId: string, shotId: string, refs?: api.ShotRefInput[]) => {
    if (!project) return;
    const opKey = `image:${shotId}`;
    const signal = startOp(opKey);
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map(s => s.id === sceneId ? {
          ...s,
          shots: s.shots.map(sh => sh.id === shotId ? { ...sh, imageStatus: GenerationStatus.LOADING } : sh)
        } : s)
      };
    });
    try {
      const p = await api.generateShotImage(project.id, shotId, refs, signal);
      setProject(p);
    } catch (err: any) {
      if (api.isCancelled(err)) {
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            scenes: prev.scenes.map(s => s.id === sceneId ? {
              ...s,
              shots: s.shots.map(sh => sh.id === shotId ? { ...sh, imageStatus: GenerationStatus.IDLE } : sh)
            } : s)
          };
        });
      } else {
        setError(`Image generation failed: ${err.message}`);
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            scenes: prev.scenes.map(s => s.id === sceneId ? {
              ...s,
              shots: s.shots.map(sh => sh.id === shotId ? { ...sh, imageStatus: GenerationStatus.ERROR } : sh)
            } : s)
          };
        });
      }
    } finally {
      endOp(opKey);
    }
  };

  const handleCancelShotImage = (shotId: string) => abortOp(`image:${shotId}`);
  const handleCancelShotVideo = (shotId: string) => abortOp(`video:${shotId}`);

  const handleRefinePrompt = async (sceneId: string, shotId: string, feedback: string, referenceImage?: File) => {
    if (!project) return;
    setLoading(true);
    try {
      const p = await api.refineShotPrompt(project.id, shotId, feedback, referenceImage);
      setProject(p);
    } catch (err: any) {
      setError(`Prompt refinement failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRefineEndFramePrompt = async (shotId: string, feedback: string) => {
    if (!project) return;
    setLoading(true);
    try {
      const p = await api.refineEndFramePrompt(project.id, shotId, feedback);
      setProject(p);
    } catch (err: any) {
      setError(`End frame refinement failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRefineVideoPrompt = async (shotId: string, feedback: string) => {
    if (!project) return;
    setLoading(true);
    try {
      const result = await api.refineVideoPrompt(project.id, shotId, feedback);
      // Update motion prompt optimistically from response
      if (result?.motionPrompt) {
        updateShotOptimistic(shotId, { motionPrompt: result.motionPrompt });
      }
    } catch (err: any) {
      setError(`Video prompt refinement failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUseAsPrevEnd = async (shotId: string) => {
    if (!project) return;
    try {
      const p = await api.useShotAsPrevEnd(project.id, shotId);
      setProject(p);
    } catch (err: any) {
      setError(`Reverse-chain failed: ${err.message}`);
    }
  };

  const handleRevertVideo = async (shotId: string, assetId: string) => {
    if (!project) return;
    try {
      const p = await api.revertShotVideo(project.id, shotId, assetId);
      setProject(p);
    } catch (err: any) {
      setError(`Revert failed: ${err.message}`);
    }
  };

  const handleLockShot = async (sceneId: string, shotId: string) => {
    if (!project) return;
    const scene = project.scenes.find(s => s.id === sceneId);
    const shot = scene?.shots.find(s => s.id === shotId);
    const wasLocked = shot?.locked;
    // Optimistic update — flip lock state immediately
    setProject(prev => prev ? {
      ...prev,
      scenes: prev.scenes.map(s => s.id === sceneId ? {
        ...s,
        shots: s.shots.map(sh => sh.id === shotId ? { ...sh, locked: !wasLocked } : sh)
      } : s)
    } : prev);
    try {
      wasLocked
        ? await api.unlockShot(project.id, shotId)
        : await api.lockShot(project.id, shotId);
    } catch (err: any) {
      // Revert on failure
      setProject(prev => prev ? {
        ...prev,
        scenes: prev.scenes.map(s => s.id === sceneId ? {
          ...s,
          shots: s.shots.map(sh => sh.id === shotId ? { ...sh, locked: !!wasLocked } : sh)
        } : s)
      } : prev);
      setError(`${wasLocked ? 'Unlock' : 'Lock'} failed: ${err.message}`);
    }
  };

  const handleGenerateVideo = async (sceneId: string, shotId: string, promptOverride?: string, refs?: api.ShotRefInput[]) => {
    if (!project) return;
    const opKey = `video:${shotId}`;
    const signal = startOp(opKey);
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map(s => s.id === sceneId ? {
          ...s,
          shots: s.shots.map(sh => sh.id === shotId ? { ...sh, videoStatus: GenerationStatus.LOADING } : sh)
        } : s)
      };
    });
    try {
      const p = await api.generateShotVideo(project.id, shotId, promptOverride, refs, signal);
      setProject(p);
    } catch (err: any) {
      if (api.isCancelled(err)) {
        // Stop button pressed — roll the video back to idle so it doesn't
        // stay in the loading spinner and doesn't look like an error either.
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            scenes: prev.scenes.map(s => s.id === sceneId ? {
              ...s,
              shots: s.shots.map(sh => sh.id === shotId ? { ...sh, videoStatus: GenerationStatus.IDLE } : sh)
            } : s)
          };
        });
      } else {
        setError(err.message);
        setProject(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            scenes: prev.scenes.map(s => s.id === sceneId ? {
              ...s,
              shots: s.shots.map(sh => sh.id === shotId ? { ...sh, videoStatus: GenerationStatus.ERROR } : sh)
            } : s)
          };
        });
      }
    } finally {
      endOp(opKey);
    }
  };

  // ─── Bulk Studio actions ────────────────────────────────────────
  // Frank Sinatra doesn't move his pianos — fire everything auto-firable.
  // Each button fires only what's actionable right now; chained shots stay
  // queued until their predecessor's video lands.

  // Worker-pool concurrency limiter. N workers pull jobs from a shared
  // index; when one finishes, the next job in line starts. This is what
  // "5 at a time, queue the rest" actually means — no artificial sleeps,
  // no fixed batches. Rejections are swallowed into the results array so
  // one failure doesn't abort the whole bulk.
  const runWithConcurrency = async <T,>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<any>,
    onStart?: (item: T) => void,
  ): Promise<void> => {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        if (onStart) onStart(items[idx]);
        try { await fn(items[idx]); } catch (err) { /* logged by the handler */ }
      }
    });
    await Promise.all(workers);
  };

  const getReadyFrameTargets = (p: ApiProject) => {
    const targets: { sceneId: string; shotId: string }[] = [];
    for (const scene of p.scenes) {
      scene.shots.forEach((shot, idx) => {
        if (shot.imageUrl) return;
        if (shot.imageStatus === GenerationStatus.LOADING) return;
        if (shot.imageStatus === GenerationStatus.ERROR) return;
        if (shot.continuityFrom === 'prev_shot' && idx > 0) {
          const prev = scene.shots[idx - 1];
          if (!prev?.videoUrl) return;
        }
        targets.push({ sceneId: scene.id, shotId: shot.id });
      });
    }
    return targets;
  };

  const handleBulkGenerateFrames = async () => {
    if (!project) return;
    let latestProject = project;
    try {
      while (true) {
        const targets = getReadyFrameTargets(latestProject);
        if (targets.length === 0) break;
        const queueIds = targets.map(t => t.shotId);
        setFrameQueue(queueIds);
        await runWithConcurrency(
          targets,
          10,
          t => api.generateShotImage(latestProject.id, t.shotId),
          t => {
            setFrameQueue(q => q.filter(id => id !== t.shotId));
            setProject(prev => prev ? {
              ...prev,
              scenes: prev.scenes.map(s => ({
                ...s,
                shots: s.shots.map(sh =>
                  sh.id === t.shotId ? { ...sh, imageStatus: GenerationStatus.LOADING } : sh
                )
              }))
            } : prev);
          },
        );
        // Refresh to see newly unblocked prev_shot frames
        latestProject = await api.getProject(latestProject.id);
        setProject(latestProject);
      }
    } finally {
      setFrameQueue([]);
    }
  };

  const getReadyVideoTargets = (p: ApiProject) => {
    const targets: { sceneId: string; shotId: string }[] = [];
    for (const scene of p.scenes) {
      scene.shots.forEach((shot, idx) => {
        if (!shot.imageUrl || shot.videoUrl) return;
        if (shot.videoStatus === GenerationStatus.LOADING) return;
        if (shot.videoStatus === GenerationStatus.ERROR) return;
        if (shot.continuityFrom === 'prev_shot' && idx > 0) {
          const prev = scene.shots[idx - 1];
          if (!prev?.videoUrl) return;
        }
        targets.push({ sceneId: scene.id, shotId: shot.id });
      });
    }
    return targets;
  };

  const handleBulkGenerateVideos = async () => {
    if (!project) return;
    let latestProject = project;
    try {
      while (true) {
        const targets = getReadyVideoTargets(latestProject);
        if (targets.length === 0) break;
        const queueIds = targets.map(t => t.shotId);
        setVideoQueue(queueIds);
        // Throttle to 5 concurrent. Sized for Segmind rate limits.
        await runWithConcurrency(
          targets,
          5,
          t => api.generateShotVideo(latestProject.id, t.shotId),
          t => {
            setVideoQueue(q => q.filter(id => id !== t.shotId));
            setProject(prev => prev ? {
              ...prev,
              scenes: prev.scenes.map(s => ({
                ...s,
                shots: s.shots.map(sh =>
                  sh.id === t.shotId ? { ...sh, videoStatus: GenerationStatus.LOADING } : sh
                )
              }))
            } : prev);
          },
        );
        // Refresh to see newly unblocked prev_shot shots
        latestProject = await api.getProject(latestProject.id);
        setProject(latestProject);
      }
    } finally {
      setVideoQueue([]);
    }
  };

  const handleUpdateShot = async (sceneId: string, shotId: string, updates: Partial<VideoShot>) => {
    if (!project) return;
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map(s => s.id === sceneId ? {
          ...s,
          shots: s.shots.map(sh => sh.id === shotId ? { ...sh, ...updates } : sh)
        } : s)
      };
    });
    api.updateShot(project.id, shotId, updates).catch(console.error);
  };

  // ─── Chat ───────────────────────────────────────────────────────

  const handleChatMessage = async (text: string) => {
    if (!project) return;
    setProject(prev => prev ? {
      ...prev,
      chatHistory: [...prev.chatHistory, { role: 'user' as const, text }]
    } : prev);
    setChatLoading(true);
    try {
      const result = await api.sendChatMessage(project.id, text);
      setProject(result.project);
    } catch {
      setProject(prev => prev ? {
        ...prev,
        chatHistory: [...prev.chatHistory, { role: 'model' as const, text: 'Error connecting to AI.' }]
      } : prev);
    } finally {
      setChatLoading(false);
    }
  };

  // ─── Queue: Start Production ──────────────────────────────────────

  const handleStartProduction = async (queueId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.startProduction(queueId);
      setProject(result.project);
      // Jump to Blueprint immediately — analysis runs in background
      setCurrentStep(AppStep.BLUEPRINT);
      // Poll for analysis completion if still analyzing
      if (result.project.status === 'analyzing') {
        const projectId = result.project.id;
        const poll = setInterval(async () => {
          try {
            const p = await api.getProject(projectId);
            if (p.status !== 'analyzing') {
              clearInterval(poll);
              setProject(p);
            }
          } catch { /* ignore polling errors */ }
        }, 3000);
        // Safety: stop polling after 2 minutes
        setTimeout(() => clearInterval(poll), 120000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start production');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenProject = async (projectId: string) => {
    setLoading(true);
    try {
      const p = await api.getProject(projectId);
      setProject(p);
      setLookCandidates({});
      setActiveSceneIdx(0);
      navigateToPhase(p);
    } catch (err: any) {
      setError('Failed to load project: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Project Sidebar ──────────────────────────────────────────

  const openSidebar = async () => {
    setSidebarOpen(true);
    setProjectListLoading(true);
    try {
      const list = await api.listProjects();
      setProjectList(list);
    } catch {
      setProjectList([]);
    } finally {
      setProjectListLoading(false);
    }
  };

  const loadProject = async (id: string) => {
    if (project?.id === id) { setSidebarOpen(false); return; }
    setLoading(true);
    setSidebarOpen(false);
    try {
      const p = await api.getProject(id);
      setProject(p);
      setLookCandidates({});
      setActiveSceneIdx(0);
      navigateToPhase(p);
    } catch (err: any) {
      setError('Failed to load project: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Navigation ─────────────────────────────────────────────────

  const isStudio = currentStep === AppStep.STUDIO;

  return (
    <div className="min-h-screen bg-obsidian-950 text-zinc-100 font-sans flex flex-col h-screen overflow-hidden">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[999] focus:top-2 focus:left-2 focus:bg-white focus:text-black focus:px-4 focus:py-2 focus:rounded-md focus:text-sm">Skip to content</a>
      {/* Header — premium minimalist nav */}
      <header className="h-14 bg-[#141418]/90 backdrop-blur-xl border-b border-white/[0.06] flex-shrink-0 z-50">
        <div className="h-full px-6 flex items-center gap-8">
          {/* Brand + Project breadcrumb */}
          <button
            onClick={openSidebar}
            className="flex items-center gap-2.5 group outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md flex-shrink-0"
          >
            <span className="text-sm font-display font-semibold text-white tracking-tight">Lahari</span>
            {project && (
              <>
                <span className="text-zinc-400/60 text-sm">/</span>
                <span className="text-sm text-zinc-300 group-hover:text-white transition-colors truncate max-w-[200px]">{project.title}</span>
              </>
            )}
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400/60 group-hover:text-zinc-300 transition-colors flex-shrink-0"><path d="M6 9l6 6 6-6"/></svg>
          </button>

          {/* Pipeline nav — minimal underline indicator, matches blueprint phase tabs */}
          <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {PIPELINE_STEPS.map((step) => {
              const isActive = currentStep === step.id;
              const isAccessible =
                step.id === AppStep.UPLOAD ||
                (project && (step.id === AppStep.BLUEPRINT)) ||
                (project && ['characters_locked', 'environments_locked', 'in_production', 'completed'].includes(project.status) && project.scenes.length > 0 && (step.id === AppStep.STUDIO || step.id === AppStep.RENDER));

              return (
                <button
                  key={step.id}
                  disabled={!isAccessible}
                  onClick={() => setCurrentStep(step.id)}
                  className={`relative px-3.5 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md ${
                    isActive
                      ? 'text-white'
                      : isAccessible
                        ? 'text-zinc-400 hover:text-white'
                        : 'text-zinc-400/40 cursor-not-allowed'
                  }`}
                >
                  {step.label}
                  {isActive && <span aria-hidden="true" className="absolute left-3.5 right-3.5 -bottom-[12px] h-px bg-white/70" />}
                </button>
              );
            })}

            {/* Scene picker lives in the Studio sticky bar — one source of
                truth instead of duplicated in the main nav. */}
          </nav>

          {/* Right */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Prompts library — always available, cross-project reference. */}
            <button
              onClick={() => setPromptsOpen(true)}
              className="text-[11px] text-zinc-400 hover:text-white px-2.5 py-1 rounded-md hover:bg-white/[0.06] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 font-mono uppercase tracking-wider"
              title="Prompts — the templates that drive every AI call"
            >
              Prompts
            </button>
            <div className="w-px h-4 bg-white/[0.06]" />
            <button
              onClick={signOut}
              className="flex items-center gap-2 px-2.5 py-1 rounded-md hover:bg-white/[0.06] transition-colors outline-none group"
              title={`Signed in as ${user.email || 'user'} — click to sign out`}
            >
              {user.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="" className="w-5 h-5 rounded-full" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] text-zinc-300 font-medium">
                  {(user.email || '?')[0].toUpperCase()}
                </div>
              )}
              <span className="text-[11px] text-zinc-400 group-hover:text-white transition-colors hidden lg:inline">{user.email?.split('@')[0]}</span>
            </button>
            {project && <div className="w-px h-4 bg-white/[0.06]" />}
            {project && (
              <>
                <span
                  className="text-[11px] font-mono text-zinc-400 tabular-nums px-2"
                  title="Actual spend so far (logged per AI call)"
                >${project.costEstimate.toFixed(2)}</span>
                {(() => {
                  // Projected cost to finish the remaining pipeline at current
                  // state: frames not yet generated + videos not yet generated
                  // (using the selected video model's per-sec price) + a small
                  // Claude overhead for chain prompt refreshes. Shown alongside
                  // actual spend so artists can decide before mass-firing.
                  const model = getVideoModel(project.videoModel);
                  let framesRemaining = 0;
                  let videoCostRemaining = 0;
                  let chainRefreshesRemaining = 0;
                  for (const scene of project.scenes || []) {
                    for (const shot of scene.shots) {
                      if (!shot.imageUrl) framesRemaining += 1;
                      if (!shot.videoUrl) videoCostRemaining += (shot.duration || model.durations[0]) * model.costPerSec;
                      // Chain refresh fires when a chained shot's predecessor video lands
                      if (shot.continuityFrom === 'prev_shot' && !shot.refinedFromPrevFrame) chainRefreshesRemaining += 1;
                    }
                  }
                  const frameCost = framesRemaining * 0.04; // Gemini 3 Pro Image per 3-call batch
                  const chainCost = chainRefreshesRemaining * 0.01;
                  const projected = frameCost + videoCostRemaining + chainCost;
                  if (projected < 0.01) return null;
                  return (
                    <span
                      className="text-[11px] font-mono text-zinc-400 tabular-nums px-2"
                      title={`Projected remaining at current model (${model.label}): ${framesRemaining} frame${framesRemaining === 1 ? '' : 's'} × $0.04 + videos (${videoCostRemaining.toFixed(2)}) + chain refreshes (${chainCost.toFixed(2)}).`}
                    >
                      + <span className="text-zinc-300">~${projected.toFixed(2)}</span>
                    </span>
                  );
                })()}
                <div className="w-px h-4 bg-white/[0.06]" />
                <button
                  onClick={() => setXrayOpen(true)}
                  className="text-[11px] text-zinc-400 hover:text-white px-2.5 py-1 rounded-md hover:bg-white/[0.06] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 font-mono uppercase tracking-wider"
                >
                  X-Ray
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main id="main-content" className="flex-1 overflow-y-auto relative">
          {/* Loading overlay — visible during project switch */}
          {loading && !project && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#141418]/80 backdrop-blur-sm">
              <div className="text-sm text-zinc-400 animate-pulse">Loading…</div>
            </div>
          )}
          {loading && project && (
            <div className="absolute top-3 right-4 z-50">
              <div className="text-[11px] text-zinc-500 animate-pulse">Loading…</div>
            </div>
          )}

          <div className="relative z-10 w-full p-8">
            {/* Prompts library — full-page overlay over the current pipeline state. */}
            <AnimatePresence>
              {promptsOpen && (
                <motion.div
                  key="prompts-library"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                >
                  <PromptsLibrary onBack={() => setPromptsOpen(false)} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Page transitions — hidden while Prompts library is open to
                preserve pipeline state underneath without double-rendering. */}
            <AnimatePresence mode="wait">
              {!promptsOpen && currentStep === AppStep.UPLOAD && (
                <motion.div key="queue" {...pageTransition}>
                  <Dashboard
                    onStartProduction={handleStartProduction}
                    onOpenProject={handleOpenProject}
                  />
                </motion.div>
              )}

              {!promptsOpen && currentStep === AppStep.BLUEPRINT && project && (
                <motion.div key="blueprint" {...pageTransition}>
                  <AnalysisEditor
                    project={project}
                    isLoading={loading}
                    looksLoading={looksLoading}
                    lookCandidates={lookCandidates}
                    onDiscardLookCandidates={(id) => setLookCandidates(prev => ({ ...prev, [id]: [] }))}
                    onLockConcept={handleLockConcept}
                    onUnlockConcept={handleUnlockConcept}
                    onRefineConcept={handleRefineConcept}
                    onUpdateConcept={handleUpdateConcept}
                    onUnlockScript={handleUnlockScript}
                    onUnlockCharacters={handleUnlockCharacters}
                    onUnlockEnvironments={handleUnlockEnvironments}
                    onLockStyle={handleLockStyle}
                    onUnlockStyle={handleUnlockStyle}
                    onGenerateLooks={handleGenerateLooks}
                    onLockCharacter={handleLockCharacter}
                    onAddCast={handleAddCast}
                    onUpdateCast={handleUpdateCast}
                    onDeleteCast={handleDeleteCast}
                    onConfirmDestructive={(opts) => setDestructive({
                      title: opts.title,
                      description: opts.description,
                      mode: 'simple',
                      confirmLabel: opts.confirmLabel,
                      run: async () => { await opts.run(); return null; },
                    })}
                    onGenerateScript={handleGenerateScript}
                    onRefineScript={handleRefineScript}
                    onUpdateScene={handleUpdateScene}
                    onUpdateShot={handleUpdateShot}
                    onGenerateConcepts={handleGenerateConcepts}
                    onCancelConcepts={handleCancelConcepts}
                    onCancelScript={() => abortOp('script')}
                    onUpdateProject={handleUpdateProject}
                    onLaunchStudio={handleLaunchStudio}
                    onAdvanceCharacters={handleAdvanceCharacters}
                    onAdvanceEnvironments={handleAdvanceEnvironments}
                    onSetProject={setProject}
                  />
                </motion.div>
              )}

              {!promptsOpen && currentStep === AppStep.STUDIO && project && (
                <motion.div key="studio" {...pageTransition}>
                  <Storyboard
                    scenes={project.scenes}
                    project={project}
                    activeSceneIdx={activeSceneIdx}
                    onSceneChange={setActiveSceneIdx}
                    onUpdateShot={handleUpdateShot}
                    onGenerateImage={handleGenerateImage}
                    onGenerateVideo={handleGenerateVideo}
                    onCancelShotImage={handleCancelShotImage}
                    onCancelShotVideo={handleCancelShotVideo}
                    onLockShot={handleLockShot}
                    onRevertVideo={handleRevertVideo}
                    onUseAsPrevEnd={handleUseAsPrevEnd}
                    onRefinePrompt={handleRefinePrompt}
                    onUpdateProject={handleUpdateProject}
                    onRewriteShotPrompts={handleRewriteShotPrompts}
                    onBulkGenerateFrames={handleBulkGenerateFrames}
                    onBulkGenerateVideos={handleBulkGenerateVideos}
                    frameQueue={frameQueue}
                    videoQueue={videoQueue}
                    onUsePrevLastFrame={handleUsePrevLastFrame}
                    onClearShotFrame={handleClearShotFrame}
                    onGenerateEndFrame={handleGenerateEndFrame}
                    onClearEndFrame={handleClearEndFrame}
                    onClearExtractedFrame={handleClearExtractedFrame}
                    onUploadEndFrame={handleUploadEndFrame}
                    onRefineEndFramePrompt={handleRefineEndFramePrompt}
                    onRefineVideoPrompt={handleRefineVideoPrompt}
                    onUploadShotRef={handleUploadShotRef}
                    onDeleteShotRef={handleDeleteShotRef}
                    onSetProject={setProject}
                    isLoading={loading}
                  />
                </motion.div>
              )}

              {!promptsOpen && currentStep === AppStep.RENDER && project && (
                <motion.div key="render" {...pageTransition}>
                  <StepRender
                    project={project}
                    onBack={() => setCurrentStep(AppStep.STUDIO)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>

        {/* Co-Director sidebar — commented out, not wired yet
        {isStudio && (
          <aside className="w-80 lg:w-96 flex-shrink-0 z-20 shadow-2xl bg-obsidian-950/80 backdrop-blur-xl shadow-[inset_1px_0_0_0_rgba(255,255,255,0.04)]">
            <ChatAssistant
              messages={project?.chatHistory || []}
              onSendMessage={handleChatMessage}
              isLoading={chatLoading}
            />
          </aside>
        )}
        */}
      </div>

      {/* Destructive action dialog — Fork is primary, Overwrite is secondary */}
      <AnimatePresence>
        {destructive && (
          <>
            <motion.div
              key="destructive-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="fixed inset-0 bg-black/70 z-[200] backdrop-blur-sm"
              onClick={() => setDestructive(null)}
            />
            <motion.div
              key="destructive-dialog"
              initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.15 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,480px)] surface-raised rounded-xl z-[201] p-6 space-y-5"
            >
              <div className="space-y-2">
                <h3 className="text-lg font-medium text-white">{destructive.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{destructive.description}</p>
              </div>
              {destructive.mode !== 'simple' && (
                <div className="surface-inset rounded-md p-3 text-xs text-zinc-400 leading-relaxed">
                  <strong className="text-zinc-300">Fork</strong> creates a copy with a new name and performs the change on it. Original stays frozen as a snapshot you can open from the sidebar.
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setDestructive(null)}
                  className="text-xs text-zinc-400 hover:text-zinc-300 px-3 py-2 rounded-md transition-colors"
                >Cancel</button>
                {destructive.mode === 'simple' ? (
                  <button
                    onClick={() => runDestructive(false)}
                    className="text-xs font-semibold bg-red-500/90 text-white hover:bg-red-500 px-4 py-2 rounded-md transition-colors"
                  >{destructive.confirmLabel || 'Confirm'}</button>
                ) : (
                  <>
                    <button
                      onClick={() => runDestructive(false)}
                      className="text-xs text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] px-3 py-2 rounded-md transition-colors"
                    >{destructive.overwriteLabel || 'Overwrite'}</button>
                    <button
                      onClick={() => runDestructive(true)}
                      className="text-xs font-semibold bg-white text-black hover:bg-zinc-200 px-4 py-2 rounded-md transition-colors"
                    >Fork & change</button>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Project Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              key="sidebar-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 bg-black/60 z-[100]"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              key="sidebar-panel"
              initial={{ x: -320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -320, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              className="fixed top-0 left-0 bottom-0 w-80 bg-obsidian-900 border-r border-white/[0.06] z-[101] flex flex-col"
            >
              <div className="h-14 px-5 flex items-center justify-between border-b border-white/[0.06] flex-shrink-0">
                <span className="text-sm font-medium text-white">Projects</span>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="text-zinc-400 hover:text-white transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md p-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-2">
                {projectListLoading ? (
                  <div className="space-y-2 p-2">
                    {[1, 2, 3].map(i => <div key={i} className="skeleton h-14 rounded-lg" />)}
                  </div>
                ) : projectList.length === 0 ? (
                  <p className="text-sm text-zinc-400 text-center py-8">No projects yet</p>
                ) : (() => {
                  // Build lineage tree: orig → children → grandchildren, flattened
                  // with depth so we can indent. Originals sorted by createdAt DESC.
                  const childrenOf = new Map<string, ProjectSummary[]>();
                  projectList.forEach(p => {
                    if (p.parentProjectId) {
                      const arr = childrenOf.get(p.parentProjectId) || [];
                      arr.push(p);
                      childrenOf.set(p.parentProjectId, arr);
                    }
                  });
                  const byId = new Map(projectList.map(p => [p.id, p]));
                  const roots = projectList.filter(p => !p.parentProjectId || !byId.has(p.parentProjectId));
                  const flat: { project: ProjectSummary; depth: number }[] = [];
                  const walk = (p: ProjectSummary, depth: number) => {
                    flat.push({ project: p, depth });
                    const kids = (childrenOf.get(p.id) || []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                    kids.forEach(k => walk(k, depth + 1));
                  };
                  roots.forEach(r => walk(r, 0));

                  return (
                    <div className="space-y-px">
                      {flat.map(({ project: p, depth }) => {
                        const isActive = project?.id === p.id;
                        const isFork = !!p.parentProjectId && byId.has(p.parentProjectId);
                        return (
                          <div
                            key={p.id}
                            className={`group relative rounded-md transition-colors ${
                              isActive
                                ? 'bg-white/[0.08]'
                                : 'hover:bg-white/[0.03]'
                            }`}
                            style={{ paddingLeft: depth * 14 }}
                          >
                            {/* Fork guide line */}
                            {depth > 0 && (
                              <span
                                aria-hidden="true"
                                className="absolute left-3 top-0 bottom-0 w-px bg-white/[0.08]"
                                style={{ left: (depth - 1) * 14 + 14 }}
                              />
                            )}
                            {renamingId === p.id ? (
                              <div className="w-full px-3 py-2 flex items-center gap-2">
                                {isFork && (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 flex-shrink-0" aria-hidden="true">
                                    <circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9v1a4 4 0 0 1-4 4H8"/><path d="M6 8v7"/>
                                  </svg>
                                )}
                                <input
                                  autoFocus
                                  value={renameDraft}
                                  onChange={e => setRenameDraft(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') { e.preventDefault(); saveRename(); }
                                    if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                                  }}
                                  onBlur={saveRename}
                                  className="flex-1 bg-white/[0.04] text-sm text-white border border-white/[0.12] rounded px-2 py-1 outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                                />
                              </div>
                            ) : (
                              <button
                                onClick={() => loadProject(p.id)}
                                className="w-full text-left px-3 py-2.5 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {isFork && (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 flex-shrink-0" aria-hidden="true">
                                      <circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9v1a4 4 0 0 1-4 4H8"/><path d="M6 8v7"/>
                                    </svg>
                                  )}
                                  <span className={`text-sm truncate ${isActive ? 'text-white font-medium' : 'text-zinc-300 group-hover:text-white'}`}>
                                    {p.title}
                                  </span>
                                  <span className="text-[11px] text-zinc-400 flex-shrink-0 ml-auto group-hover:invisible" title={`Started ${new Date(p.createdAt.includes('T') || p.createdAt.includes('Z') ? p.createdAt : p.createdAt.replace(' ', 'T') + 'Z').toLocaleString()}`}>
                                    {relativeTime(p.createdAt)}
                                  </span>
                                </div>
                              </button>
                            )}
                            {/* Delete button — hover reveal, does not shift layout */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDestructive({
                                  title: `Delete "${p.title}"?`,
                                  description: 'Removes the project from the list. Generated files stay on disk and can be re-linked later if needed.',
                                  mode: 'simple',
                                  confirmLabel: 'Delete',
                                  run: async () => {
                                    await api.deleteProject(p.id);
                                    setProjectList(list => list.filter(x => x.id !== p.id));
                                    if (project?.id === p.id) setProject(null);
                                  },
                                });
                              }}
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-zinc-400 hover:text-red-300 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Delete project"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
                              </svg>
                            </button>
                            {/* Rename — pencil sits just left of delete. */}
                            {renamingId !== p.id && (
                              <button
                                onClick={(e) => { e.stopPropagation(); startRename(p.id, p.title); }}
                                className="absolute right-9 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Rename project"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                                </svg>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.15 }}
            className="fixed top-14 left-1/2 -translate-x-1/2 z-[200] max-w-md w-full px-4"
          >
            <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 flex items-center justify-between gap-2 shadow-lg shadow-black/30">
              <span className="text-[12px] text-red-300 line-clamp-2">{error}</span>
              <button onClick={() => setError(null)} className="text-zinc-400 hover:text-white flex-shrink-0 p-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* X-Ray Panel */}
      {project && (
        <XRayPanel
          projectId={project.id}
          isOpen={xrayOpen}
          onClose={() => setXrayOpen(false)}
        />
      )}
    </div>
  );
};

export default App;
