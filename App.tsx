
import React, { useState, useEffect, useCallback } from 'react';
import { AppStep, ApiProject, VideoShot, GenerationStatus, ChatMessage } from './types';
import { StepUpload } from './components/StepUpload';
import { AnalysisEditor } from './components/AnalysisEditor';
import { Storyboard } from './components/Storyboard';
import { StepRender } from './components/StepRender';
import { ChatAssistant } from './components/ChatAssistant';
import { XRayPanel } from './components/XRayPanel';
import * as api from './services/api';

const PIPELINE_STEPS = [
  { id: AppStep.UPLOAD, label: 'Import', icon: '💿' },
  { id: AppStep.BLUEPRINT, label: 'Blueprint', icon: '📐' },
  { id: AppStep.STUDIO, label: 'Studio', icon: '🎬' },
  { id: AppStep.RENDER, label: 'Render', icon: '💾' },
];

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.UPLOAD);
  const [project, setProject] = useState<ApiProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Style candidates — now managed inside AnalysisEditor (brainstorm flow)
  // Character look candidates per cast member
  const [lookCandidates, setLookCandidates] = useState<Record<string, { id: string; url: string }[]>>({});
  // Per-member loading state for parallel character generation
  const [looksLoading, setLooksLoading] = useState<Set<string>>(new Set());
  // X-Ray panel
  const [xrayOpen, setXrayOpen] = useState(false);

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
      // All Blueprint phases complete — go to Studio
      setCurrentStep(AppStep.STUDIO);
    } else if (p.conceptOptions.length > 0 || p.status === 'concept_locked' || p.status === 'scripted' || p.status === 'style_locked' || p.status === 'characters_locked' || p.status === 'environments_locked') {
      setCurrentStep(AppStep.BLUEPRINT);
    } else {
      // analyzed but no concepts yet, or still uploading — stay on upload/analysis page
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
      // Stay on UPLOAD step — shows analysis results, user reviews before concepts
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

  const handleGenerateScript = async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const p = await api.generateScript(project.id);
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
    // Optimistic status update
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
      // Reset status
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

  const handleGenerateEndFrame = async (sceneId: string, shotId: string) => {
    if (!project) return;
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map(s => s.id === sceneId ? {
          ...s,
          shots: s.shots.map(sh => sh.id === shotId ? { ...sh, endImageStatus: GenerationStatus.LOADING } : sh)
        } : s)
      };
    });
    try {
      const p = await api.generateShotEndFrame(project.id, shotId);
      setProject(p);
    } catch (err: any) {
      setError(`End frame generation failed: ${err.message}`);
      setProject(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          scenes: prev.scenes.map(s => s.id === sceneId ? {
            ...s,
            shots: s.shots.map(sh => sh.id === shotId ? { ...sh, endImageStatus: GenerationStatus.ERROR } : sh)
          } : s)
        };
      });
    }
  };

  const handleLockShot = async (sceneId: string, shotId: string) => {
    if (!project) return;
    // Toggle: if already locked, unlock; otherwise lock
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
    // Optimistic local update
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
    // Persist to server (fire and forget for prompt edits)
    api.updateShot(project.id, shotId, updates).catch(console.error);
  };

  // ─── Chat ───────────────────────────────────────────────────────

  const handleChatMessage = async (text: string) => {
    if (!project) return;
    // Optimistic add user message
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
    if (window.confirm('Start a new project? Previous projects are saved in the database.')) {
      setProject(null);
      setCurrentStep(AppStep.UPLOAD);
      setLookCandidates({});
      setError(null);
    }
  };

  // ─── Navigation ─────────────────────────────────────────────────

  const isStudio = currentStep === AppStep.STUDIO;

  return (
    <div className="min-h-screen bg-obsidian-950 text-zinc-100 font-sans flex flex-col h-screen overflow-hidden">
      <header className="h-16 border-b border-white/5 bg-obsidian-900/80 backdrop-blur-md flex-shrink-0 z-50">
        <div className="h-full px-6 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 bg-gradient-to-tr from-accent-600 to-accent-400 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-accent-500/20">
                L
              </div>
              <h1 className="text-lg font-display font-medium text-white tracking-wide hidden md:block">
                Lahari Music <span className="text-zinc-500 mx-2">/</span> <span className="text-accent-400">Video Engine</span>
              </h1>
            </div>

            <div className="hidden md:flex items-center bg-zinc-900/50 rounded-full p-1 border border-white/5">
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
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-zinc-800 text-white shadow-md'
                        : isAccessible
                          ? 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                          : 'text-zinc-700 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <span>{step.icon}</span>
                    <span>{step.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-4 items-center">
            {project && (
              <>
                <div className="bg-zinc-900/50 px-3 py-1.5 rounded border border-white/5 text-xs font-mono text-zinc-400">
                  Est. Cost: <span className="text-white">${project.costEstimate.toFixed(2)}</span>
                </div>
                <button
                  onClick={() => setXrayOpen(true)}
                  className="bg-accent-500/10 hover:bg-accent-500/20 border border-accent-500/30 text-accent-400 px-3 py-1.5 rounded text-xs font-mono font-bold transition-colors"
                >
                  X-Ray
                </button>
                <div className="flex gap-2">
                  <button onClick={handleNewProject} className="text-xs text-zinc-400 hover:text-white border border-white/10 px-3 py-1.5 rounded transition-colors flex items-center gap-2">
                    <span>+</span> New
                  </button>
                </div>
                <div className="hidden md:flex items-center px-3 py-1.5 rounded border border-white/5 text-[10px] text-zinc-500 font-mono uppercase">
                  {project.status.replace('_', ' ')}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className={`flex-1 overflow-y-auto relative ${isStudio ? 'bg-zinc-900/20' : ''}`}>
          <div className="fixed inset-0 pointer-events-none z-0 opacity-20 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-accent-900/40 via-obsidian-950 to-obsidian-950"></div>

          <div className="relative z-10 w-full p-6">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-200 p-4 rounded-lg mb-8 flex justify-between items-center max-w-4xl mx-auto">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="hover:text-white px-2">✕</button>
              </div>
            )}

            {currentStep === AppStep.UPLOAD && (
              <StepUpload
                project={project}
                onFileSelect={handleFileUpload}
                onGenerateConcepts={handleGenerateConcepts}
                isAnalyzing={loading}
                isGeneratingConcepts={conceptsLoading}
              />
            )}

            {currentStep === AppStep.BLUEPRINT && project && (
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
            )}

            {currentStep === AppStep.STUDIO && project && (
              <Storyboard
                scenes={project.scenes}
                project={project}
                onUpdateShot={handleUpdateShot}
                onGenerateImage={handleGenerateImage}
                onGenerateEndFrame={handleGenerateEndFrame}
                onGenerateVideo={handleGenerateVideo}
                onLockShot={handleLockShot}
              />
            )}

            {currentStep === AppStep.RENDER && project && (
              <StepRender
                project={project}
                onBack={() => setCurrentStep(AppStep.STUDIO)}
              />
            )}
          </div>
        </main>

        {isStudio && (
          <aside className="w-80 lg:w-96 flex-shrink-0 z-20 shadow-2xl bg-obsidian-900 border-l border-white/5">
            <ChatAssistant
              messages={project?.chatHistory || []}
              onSendMessage={handleChatMessage}
              isLoading={chatLoading}
            />
          </aside>
        )}
      </div>

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
