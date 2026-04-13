
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppStep, ApiProject, VideoShot, GenerationStatus, ChatMessage } from './types';
import { StepUpload } from './components/StepUpload';
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

type ProjectSummary = { id: string; title: string; status: string; created_at: string; updated_at: string };

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

  const handleGenerateConcepts = async (opts?: { lyrics?: string; context?: string; language?: string }) => {
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
    setLoading(true);
    setError(null);
    try {
      const p = await api.lockConcept(project.id, conceptIndex);
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

  const handleUnlockStyle = async () => {
    if (!project) return;
    setLoading(true);
    try {
      const p = await api.unlockStyle(project.id);
      setProject(p);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

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
    setLoading(true);
    setError(null);
    try {
      const p = await api.generateScript(project.id, userNote);
      setProject(p);
    } catch (err: any) {
      setError('Script generation failed: ' + err.message);
    } finally {
      setLoading(false);
    }
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

  const handleGenerateVideo = async (sceneId: string, shotId: string) => {
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
      const p = await api.generateShotVideo(project.id, shotId);
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

  // ─── New Project ────────────────────────────────────────────────

  const handleNewProject = () => {
    setProject(null);
    setCurrentStep(AppStep.UPLOAD);
    setLookCandidates({});
    setError(null);
    setSidebarOpen(false);
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
                    onLockStyle={handleLockStyle}
                    onUnlockStyle={handleUnlockStyle}
                    onGenerateLooks={handleGenerateLooks}
                    onLockCharacter={handleLockCharacter}
                    onAddCast={handleAddCast}
                    onUpdateCast={handleUpdateCast}
                    onDeleteCast={handleDeleteCast}
                    onGenerateScript={handleGenerateScript}
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

              <div className="p-3 border-b border-white/[0.06] flex-shrink-0">
                <button
                  onClick={handleNewProject}
                  className="w-full text-[13px] text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] rounded-lg px-3 py-2 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 flex items-center justify-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
                  New Project
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-2">
                {projectListLoading ? (
                  <div className="space-y-2 p-2">
                    {[1, 2, 3].map(i => <div key={i} className="skeleton h-16 rounded-lg" />)}
                  </div>
                ) : projectList.length === 0 ? (
                  <p className="text-sm text-zinc-600 text-center py-8">No projects yet</p>
                ) : (
                  <div className="space-y-1">
                    {projectList.map(p => {
                      const isActive = project?.id === p.id;
                      const status = STATUS_LABELS[p.status] || { label: p.status, color: 'text-zinc-500' };
                      return (
                        <button
                          key={p.id}
                          onClick={() => loadProject(p.id)}
                          className={`w-full text-left rounded-lg px-3 py-3 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 group ${
                            isActive
                              ? 'bg-white/[0.08] border border-white/[0.1]'
                              : 'hover:bg-white/[0.04] border border-transparent'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className={`text-[13px] font-medium truncate ${isActive ? 'text-white' : 'text-zinc-300 group-hover:text-white'} transition-colors`}>
                              {p.title}
                            </span>
                            {isActive && (
                              <span className="text-[9px] bg-white/10 text-zinc-400 px-1.5 py-0.5 rounded flex-shrink-0">OPEN</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className={`text-[11px] font-medium ${status.color}`}>{status.label}</span>
                            <span className="text-[10px] text-zinc-600">{new Date(p.updated_at).toLocaleDateString()}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
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
