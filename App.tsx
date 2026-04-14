
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppStep, ApiProject, VideoShot, GenerationStatus, ChatMessage } from './types';
import { AnalysisEditor } from './components/AnalysisEditor';
import { Storyboard } from './components/Storyboard';
import { StepRender } from './components/StepRender';
import { ChatAssistant } from './components/ChatAssistant';
import { XRayPanel } from './components/XRayPanel';
import { Dashboard } from './components/Dashboard';
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
  uploaded: { label: 'Uploaded', color: 'text-zinc-500' },
  analyzed: { label: 'Analyzed', color: 'text-zinc-400' },
  concept_locked: { label: 'Concept', color: 'text-blue-400' },
  scripted: { label: 'Scripted', color: 'text-indigo-400' },
  style_locked: { label: 'Styled', color: 'text-purple-400' },
  characters_locked: { label: 'Characters', color: 'text-pink-400' },
  environments_locked: { label: 'Environments', color: 'text-emerald-400' },
};

const App: React.FC = () => {
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
  // Studio scene navigation
  const [activeSceneIdx, setActiveSceneIdx] = useState(0);
  // Project sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [projectListLoading, setProjectListLoading] = useState(false);

  // Auto-dismiss error toast
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // On mount: load the most recent project (if any)
  useEffect(() => {
    api.listProjects().then(projects => {
      if (projects.length > 0) {
        return api.getProject(projects[0].id);
      }
      return null;
    }).then(p => {
      if (p) {
        setProject(p);
        navigateToPhase(p);
      }
    }).catch(() => {}); // No projects yet, stay on upload
  }, []);

  // Determine which step to show based on project phase
  const navigateToPhase = (p: ApiProject) => {
    if ((p.status === 'characters_locked' || p.status === 'environments_locked') && p.scenes.length > 0) {
      setCurrentStep(AppStep.STUDIO);
    } else if (p.conceptOptions.length > 0 || p.status === 'concept_locked' || p.status === 'scripted' || p.status === 'style_locked' || p.status === 'characters_locked' || p.status === 'environments_locked') {
      setCurrentStep(AppStep.BLUEPRINT);
    } else {
      setCurrentStep(AppStep.UPLOAD);
    }
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

  const [conceptsLoading, setConceptsLoading] = useState(false);

  const handleGenerateConcepts = async (opts?: { lyrics?: string; context?: string; language?: string; userNote?: string }) => {
    if (!project) return;
    setConceptsLoading(true);
    setError(null);
    try {
      const p = await api.generateConcepts(project.id, opts);
      setProject(p);
      setCurrentStep(AppStep.BLUEPRINT);
    } catch (err: any) {
      setError(err.message || 'Concept generation failed.');
    } finally {
      setConceptsLoading(false);
    }
  };

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
  const handleUnlockScript = () => doUnlock(() => api.unlockScript(project!.id));
  const handleUnlockCharacters = () => doUnlock(() => api.unlockCharacters(project!.id));
  const handleUnlockEnvironments = () => doUnlock(() => api.unlockEnvironments(project!.id));

  const doUnlock = async (fn: () => Promise<any>) => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const p = await fn();
      setProject(p);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
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

  const handleGenerateLooks = async (castMemberId: string, feedback?: string) => {
    if (!project) return;
    setLooksLoading(prev => new Set(prev).add(castMemberId));
    setError(null);
    try {
      const result = await api.generateLooks(project.id, castMemberId, feedback);
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
      const p = await api.lockCharacter(project.id, castMemberId, assetId);
      setProject(p);
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
    try {
      const p = await api.deleteCastMember(project.id, memberId);
      setProject(p);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─── Script Generation ──────────────────────────────────────────

  const handleGenerateScript = async (userNote?: string) => {
    if (!project) return;
    // First-time gen: no existing script to destroy, just run.
    if (project.scenes.length === 0) {
      setLoading(true); setError(null);
      try {
        const p = await api.generateScript(project.id, userNote);
        setProject(p);
      } catch (err: any) {
        setError('Script generation failed: ' + err.message);
      } finally { setLoading(false); }
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
      const p = await api.advanceCharacters(project.id);
      setProject(p);
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
      const p = await api.advanceEnvironments(project.id);
      setProject(p);
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
    try {
      const p = await api.updateProject(project.id, updates);
      setProject(p);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─── Shot Image & Video ─────────────────────────────────────────

  const handleGenerateImage = async (sceneId: string, shotId: string) => {
    if (!project) return;
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
      const p = await api.generateShotImage(project.id, shotId);
      setProject(p);
    } catch (err: any) {
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
  };

  const handleRefinePrompt = async (sceneId: string, shotId: string, feedback: string) => {
    if (!project) return;
    setLoading(true);
    try {
      const p = await api.refineShotPrompt(project.id, shotId, feedback);
      setProject(p);
    } catch (err: any) {
      setError(`Prompt refinement failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLockShot = async (sceneId: string, shotId: string) => {
    if (!project) return;
    const scene = project.scenes.find(s => s.id === sceneId);
    const shot = scene?.shots.find(s => s.id === shotId);
    try {
      const p = shot?.locked
        ? await api.unlockShot(project.id, shotId)
        : await api.lockShot(project.id, shotId);
      setProject(p);
    } catch (err: any) {
      setError(`${shot?.locked ? 'Unlock' : 'Lock'} failed: ${err.message}`);
    }
  };

  const handleGenerateVideo = async (sceneId: string, shotId: string, promptOverride?: string) => {
    if (!project) return;
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
      const p = await api.generateShotVideo(project.id, shotId, promptOverride);
      setProject(p);
    } catch (err: any) {
      setError(`Video generation failed: ${err.message}`);
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
      // Jump to Blueprint — audio + lyrics are already imported from Supabase,
      // user should proceed to concept/script generation.
      setCurrentStep(AppStep.BLUEPRINT);
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
      {/* Header */}
      <header className="h-12 bg-obsidian-950/90 backdrop-blur-xl border-b border-white/[0.04] flex-shrink-0 z-50">
        <div className="h-full px-5 flex items-center gap-6">
          {/* Logo + Project */}
          <button
            onClick={openSidebar}
            className="flex items-center gap-2 group outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md flex-shrink-0"
          >
            <span className="text-[13px] font-display font-medium text-white">Lahari</span>
            {project && (
              <>
                <span className="text-zinc-700">/</span>
                <span className="text-[13px] text-zinc-500 group-hover:text-zinc-300 transition-colors truncate max-w-[180px]">{project.title}</span>
              </>
            )}
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-700 group-hover:text-zinc-400 transition-colors flex-shrink-0"><path d="M6 9l6 6 6-6"/></svg>
          </button>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-0.5 flex-1 justify-center">
            {PIPELINE_STEPS.map((step) => {
              const isActive = currentStep === step.id;
              const isAccessible =
                step.id === AppStep.UPLOAD ||
                (project && (step.id === AppStep.BLUEPRINT)) ||
                (project && (project.status === 'characters_locked' || project.status === 'environments_locked') && project.scenes.length > 0 && (step.id === AppStep.STUDIO || step.id === AppStep.RENDER));

              return (
                <button
                  key={step.id}
                  disabled={!isAccessible}
                  onClick={() => setCurrentStep(step.id)}
                  className={`relative px-3 py-1 text-[12px] font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md ${
                    isActive
                      ? 'text-white bg-white/[0.06]'
                      : isAccessible
                        ? 'text-zinc-500 hover:text-zinc-300'
                        : 'text-zinc-700 cursor-not-allowed'
                  }`}
                >
                  {step.label}
                </button>
              );
            })}

            {isStudio && project && project.scenes.length > 1 && (
              <div className="flex items-center gap-0.5 ml-3 pl-3 border-l border-white/[0.06]">
                {project.scenes.map((scene, idx) => {
                  const isActive = idx === activeSceneIdx;
                  const allLocked = scene.shots.every(s => s.locked);
                  return (
                    <button
                      key={scene.id}
                      onClick={() => setActiveSceneIdx(idx)}
                      className={`w-6 h-6 text-[11px] font-medium rounded-md transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 ${
                        isActive ? 'bg-white/[0.1] text-white'
                          : allLocked ? 'text-zinc-400 hover:text-white'
                          : 'text-zinc-600 hover:text-zinc-400'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
            )}
          </nav>

          {/* Right */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {project && (
              <>
                <span className="text-[10px] font-mono text-zinc-600">${project.costEstimate.toFixed(2)}</span>
                <button
                  onClick={() => setXrayOpen(true)}
                  className="text-[10px] text-zinc-600 hover:text-white px-2 py-1 rounded-md hover:bg-white/[0.06] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 font-mono"
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

          <div className="relative z-10 w-full p-8">
            {/* Page transitions */}
            <AnimatePresence mode="wait">
              {currentStep === AppStep.UPLOAD && (
                <motion.div key="queue" {...pageTransition}>
                  <Dashboard
                    onStartProduction={handleStartProduction}
                    onOpenProject={handleOpenProject}
                  />
                </motion.div>
              )}

              {currentStep === AppStep.BLUEPRINT && project && (
                <motion.div key="blueprint" {...pageTransition}>
                  <AnalysisEditor
                    project={project}
                    isLoading={loading}
                    looksLoading={looksLoading}
                    lookCandidates={lookCandidates}
                    onLockConcept={handleLockConcept}
                    onUnlockConcept={handleUnlockConcept}
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
                    onGenerateScript={handleGenerateScript}
                    onGenerateConcepts={handleGenerateConcepts}
                    onUpdateProject={handleUpdateProject}
                    onLaunchStudio={handleLaunchStudio}
                    onAdvanceCharacters={handleAdvanceCharacters}
                    onAdvanceEnvironments={handleAdvanceEnvironments}
                    onSetProject={setProject}
                  />
                </motion.div>
              )}

              {currentStep === AppStep.STUDIO && project && (
                <motion.div key="studio" {...pageTransition}>
                  <Storyboard
                    scenes={project.scenes}
                    project={project}
                    activeSceneIdx={activeSceneIdx}
                    onSceneChange={setActiveSceneIdx}
                    onUpdateShot={handleUpdateShot}
                    onGenerateImage={handleGenerateImage}
                    onGenerateVideo={handleGenerateVideo}
                    onLockShot={handleLockShot}
                    onRefinePrompt={handleRefinePrompt}
                    onUpdateProject={handleUpdateProject}
                    onRewriteShotPrompts={handleRewriteShotPrompts}
                    onUsePrevLastFrame={handleUsePrevLastFrame}
                    isLoading={loading}
                  />
                </motion.div>
              )}

              {currentStep === AppStep.RENDER && project && (
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
                  className="text-zinc-500 hover:text-white transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md p-1"
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
                  // with depth so we can indent. Originals sorted by updatedAt DESC.
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
                    const kids = (childrenOf.get(p.id) || []).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
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
                                <span className="text-[11px] text-zinc-400 flex-shrink-0 ml-auto group-hover:invisible">
                                  {relativeTime(p.updatedAt)}
                                </span>
                              </div>
                            </button>
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
              <button onClick={() => setError(null)} className="text-zinc-500 hover:text-white flex-shrink-0 p-0.5">
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
