import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppStep, ApiProject, VideoShot, GenerationStatus } from '../types';
import { AnalysisEditor } from './AnalysisEditor';
import { Storyboard } from './Storyboard';
import { StepRender } from './StepRender';
import { XRayPanel } from './XRayPanel';
import { StartProject, type CreateIntakeOpts } from './StartProject';
import { PromptsLibrary } from './PromptsLibrary';
import { RendersModal } from './RendersModal';
import { AppHeader } from './AppHeader';
import { DestructiveActionDialog } from './DestructiveActionDialog';
import { ProjectSidebar } from './ProjectSidebar';
import * as api from '../services/api';
import { notifyBulkComplete } from '../lib/notify';
import { usePersistedProject } from '../hooks/usePersistedProject';
import { useRealtimePresence } from '../hooks/useRealtimePresence';
import type { DestructiveAction } from './DestructiveActionDialog';
import type { ProjectSummary } from './ProjectSidebar';

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: 'easeOut' as const },
};

export const AppShell: React.FC<{ user: { id: string; email?: string; user_metadata?: any }; signOut: () => Promise<void> }> = ({ user, signOut }) => {
  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.UPLOAD);
  const [project, setProjectRaw] = useState<ApiProject | null>(null);
  const activeProjectId = React.useRef<string | null>(null);

  // Guarded setter — drops stale updates from in-flight API calls
  // when the user has already switched to a different project.
  const setProject = React.useCallback((update: ApiProject | ((prev: ApiProject | null) => ApiProject | null) | null) => {
    setProjectRaw(prev => {
      const next = typeof update === 'function' ? update(prev) : update;
      if (!next) { activeProjectId.current = null; return next; }
      // Explicit project switch (navigation, start production) — always accept
      if (!prev || next.id !== prev.id) { activeProjectId.current = next.id; return next; }
      // Same project — accept if it matches the active one
      if (next.id === activeProjectId.current) return next;
      // Stale update for a different project — drop
      return prev;
    });
  }, []);
  const [loading, setLoading] = useState(false);
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
  const [storyboardPromptQueue, setStoryboardPromptQueue] = useState<string[]>([]);
  const [storyboardImageQueue, setStoryboardImageQueue] = useState<string[]>([]);
  const [bulkStopNotice, setBulkStopNotice] = useState<string | null>(null);
  const bulkStopRef = useRef({ requested: false, controllers: new Set<AbortController>() });
  // Studio scene navigation
  const [activeSceneIdx, setActiveSceneIdx] = useState(0);
  // Renders viewer (popup) — opened from sidebar entries.
  const [rendersFor, setRendersFor] = useState<{ id: string; title: string } | null>(null);

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

  // Determine which step to show based on project phase
  const navigateToPhase = useCallback((p: ApiProject) => {
    let step: AppStep;
    if ((p.status === 'characters_locked' || p.status === 'environments_locked') && p.scenes.length > 0) {
      step = AppStep.STUDIO;
    } else if (p.conceptOptions.length > 0 || p.status === 'concept_locked' || p.status === 'scripted' || p.status === 'style_locked' || p.status === 'characters_locked' || p.status === 'environments_locked') {
      step = AppStep.BLUEPRINT;
    } else {
      step = AppStep.UPLOAD;
    }
    setCurrentStep(step);
  }, []);

  const { agentOperations, realtimeNotice } = useRealtimePresence(project?.id, activeProjectId, setProject);

  const { restoring } = usePersistedProject({
    currentStep,
    projectId: project?.id,
    setActiveSceneIdx,
    setCurrentStep,
    setProject,
    navigateToPhase,
  });

  // ─── Project Intake ─────────────────────────────────────────────
  // Single entry path for both modes. Music video uploads audio and lands in
  // Blueprint while server-side analysis runs (polled below); anime parses
  // the script synchronously and lands in Blueprint already populated.

  const handleCreateFromIntake = async (opts: CreateIntakeOpts) => {
    setLoading(true);
    setError(null);
    try {
      const p = await api.createProjectFromIntake(opts);
      setProject(p);
      setLookCandidates({});
      setActiveSceneIdx(0);
      setCurrentStep(AppStep.BLUEPRINT);

      // Music video starts in `analyzing` while audio transcription / structure
      // detection runs server-side. Poll until it flips, then refresh project.
      if (p.status === 'analyzing') {
        const projectId = p.id;
        const poll = setInterval(async () => {
          try {
            const next = await api.getProject(projectId);
            if (next.status !== 'analyzing') {
              clearInterval(poll);
              setProject(next);
            }
          } catch { /* ignore polling errors */ }
        }, 3000);
        setTimeout(() => clearInterval(poll), 120000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create project.');
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
  const handleUnlockCharacters = () => doUnlock(() => api.unlockCharacters(project!.id));
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
    if (project.videoModel?.startsWith('seedance')) {
      setCurrentStep(AppStep.STUDIO);
      return;
    }
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
    const signal = startOp('write-prompts');
    setLoading(true);
    setError(null);
    try {
      const p = await api.writeShotPrompts(project.id, userNote, signal);
      setProject(p);
    } catch (err: any) {
      if (!api.isCancelled(err)) setError('Failed to rewrite shot prompts: ' + err.message);
    } finally {
      endOp('write-prompts');
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

  const handleCancelShotImage = (shotId: string) => {
    if (!project) return;
    abortOp(`image:${shotId}`);
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map(s => ({
          ...s,
          shots: s.shots.map(sh => sh.id === shotId ? { ...sh, imageStatus: GenerationStatus.IDLE } : sh)
        }))
      };
    });
    void api.cancelShotImage(project.id, shotId).catch((err: any) => {
      setError(`Cancel image failed: ${err.message}`);
    });
  };

  const handleCancelShotVideo = (shotId: string) => {
    if (!project) return;
    abortOp(`video:${shotId}`);
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map(s => ({
          ...s,
          shots: s.shots.map(sh => sh.id === shotId ? { ...sh, videoStatus: GenerationStatus.IDLE } : sh)
        }))
      };
    });
    void api.cancelShotVideo(project.id, shotId).catch((err: any) => {
      setError(`Cancel video failed: ${err.message}`);
    });
  };

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

  const handleRefineEndFramePrompt = async (shotId: string, feedback: string, referenceImage?: File) => {
    if (!project) return;
    setLoading(true);
    try {
      const p = await api.refineEndFramePrompt(project.id, shotId, feedback, referenceImage);
      setProject(p);
    } catch (err: any) {
      setError(`End frame refinement failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRefineVideoPrompt = async (shotId: string, feedback: string, referenceImage?: File) => {
    if (!project) return;
    setLoading(true);
    try {
      const result = await api.refineVideoPrompt(project.id, shotId, feedback, referenceImage);
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

  const handleGenerateStoryboard = async (shotId: string) => {
    if (!project) return;
    updateShotOptimistic(shotId, { storyboardStatus: GenerationStatus.LOADING });
    const signal = startOp(`storyboard:${shotId}`);
    try {
      const result = await api.generateStoryboard(project.id, shotId, signal);
      setProject(result.project);
    } catch (err: any) {
      if (api.isCancelled(err)) {
        updateShotOptimistic(shotId, { storyboardStatus: GenerationStatus.IDLE });
        return;
      }
      updateShotOptimistic(shotId, { storyboardStatus: GenerationStatus.ERROR });
      setError(`Storyboard generation failed: ${err.message}`);
    } finally {
      endOp(`storyboard:${shotId}`);
    }
  };

  const handleWriteStoryboardPrompt = async (shotId: string, feedback?: string) => {
    if (!project) return;
    updateShotOptimistic(shotId, { storyboardPromptStatus: GenerationStatus.LOADING, storyboardPromptUserFeedback: feedback });
    const signal = startOp(`storyboard-prompt:${shotId}`);
    try {
      const result = await api.writeStoryboardPrompt(project.id, shotId, feedback, signal);
      setProject(result.project);
    } catch (err: any) {
      if (api.isCancelled(err)) {
        updateShotOptimistic(shotId, { storyboardPromptStatus: GenerationStatus.IDLE });
        return;
      }
      updateShotOptimistic(shotId, { storyboardPromptStatus: GenerationStatus.ERROR });
      setError(`Storyboard prompt write failed: ${err.message}`);
    } finally {
      endOp(`storyboard-prompt:${shotId}`);
    }
  };

  const handleRefineStoryboard = async (
    shotId: string,
    feedback: string,
    previousVersionId?: string,
    refineMode: api.StoryboardRefineMode = 'replan',
    referenceImage?: File
  ) => {
    if (!project || !feedback.trim()) return;
    if (refineMode === 'edit_image') {
      updateShotOptimistic(shotId, { storyboardStatus: GenerationStatus.LOADING, storyboardUserFeedback: feedback });
    } else {
      updateShotOptimistic(shotId, { storyboardPromptStatus: GenerationStatus.LOADING, storyboardPromptUserFeedback: feedback });
    }
    const signal = startOp(`storyboard-refine:${shotId}`);
    try {
      const result = await api.refineStoryboard(project.id, shotId, feedback, previousVersionId, refineMode, referenceImage, signal);
      setProject(result.project);
    } catch (err: any) {
      if (api.isCancelled(err)) {
        updateShotOptimistic(shotId, refineMode === 'edit_image' ? { storyboardStatus: GenerationStatus.IDLE } : { storyboardPromptStatus: GenerationStatus.IDLE });
        return;
      }
      updateShotOptimistic(shotId, refineMode === 'edit_image' ? { storyboardStatus: GenerationStatus.ERROR } : { storyboardPromptStatus: GenerationStatus.ERROR });
      setError(`Storyboard refinement failed: ${err.message}`);
    } finally {
      endOp(`storyboard-refine:${shotId}`);
    }
  };

  /** Single stop affordance for any in-flight storyboard work on a shot.
   *  Only one of {generate, write-prompt, refine} can be running at a time
   *  per shot, so aborting all three keys is safe and avoids the UI having
   *  to know which action is actually live. */
  const handleCancelStoryboard = (shotId: string) => {
    if (!project) return;
    abortOp(`storyboard:${shotId}`);
    abortOp(`storyboard-prompt:${shotId}`);
    abortOp(`storyboard-refine:${shotId}`);
    updateShotOptimistic(shotId, {
      storyboardStatus: GenerationStatus.IDLE,
      storyboardPromptStatus: GenerationStatus.IDLE,
    });
  };

  const handleLockStoryboard = async (shotId: string, versionId?: string) => {
    if (!project) return;
    updateShotOptimistic(shotId, { storyboardLocked: true });
    try {
      const result = await api.lockStoryboard(project.id, shotId, versionId);
      setProject(result.project);
    } catch (err: any) {
      updateShotOptimistic(shotId, { storyboardLocked: false });
      setError(`Storyboard lock failed: ${err.message}`);
    }
  };

  const handleUnlockStoryboard = async (shotId: string) => {
    if (!project) return;
    updateShotOptimistic(shotId, { storyboardLocked: false });
    try {
      const result = await api.unlockStoryboard(project.id, shotId);
      setProject(result.project);
    } catch (err: any) {
      updateShotOptimistic(shotId, { storyboardLocked: true });
      setError(`Storyboard unlock failed: ${err.message}`);
    }
  };

  // Cut plan autosaves on blur — server returns { ok: true } and persists
  // cutPlanText on the active storyboard version's metadata. We don't refresh
  // the project (the new text is local to StoryboardPanel and used at video
  // generation time on the server), but we do let parent surface failures.
  const handleUpdateStoryboardPlan = async (shotId: string, cutPlanText: string, storyboardPrompt?: string) => {
    if (!project) return;
    try {
      const result = await api.updateStoryboardPlan(project.id, shotId, cutPlanText, storyboardPrompt);
      if (result?.project) setProject(result.project);
    } catch (err: any) {
      setError(`Cut plan save failed: ${err.message}`);
      throw err;
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
  const beginBulkRun = () => {
    bulkStopRef.current.requested = false;
    bulkStopRef.current.controllers.clear();
    setBulkStopNotice(null);
  };

  const stopBulkRun = useCallback(() => {
    bulkStopRef.current.requested = true;
    bulkStopRef.current.controllers.forEach(ctrl => ctrl.abort());
    bulkStopRef.current.controllers.clear();
    setFrameQueue([]);
    setVideoQueue([]);
    setStoryboardPromptQueue([]);
    setStoryboardImageQueue([]);
    setBulkStopNotice('Stopped queued jobs. Active generations may still finish and appear when they complete.');
  }, []);

  const runWithConcurrency = async <T,>(
    items: T[],
    limit: number,
    fn: (item: T, signal: AbortSignal) => Promise<any>,
    onStart?: (item: T) => void,
  ): Promise<void> => {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        if (bulkStopRef.current.requested) break;
        const idx = cursor++;
        if (bulkStopRef.current.requested) break;
        if (onStart) onStart(items[idx]);
        const ctrl = new AbortController();
        bulkStopRef.current.controllers.add(ctrl);
        try { await fn(items[idx], ctrl.signal); } catch (err) { /* logged by the handler */ }
        finally { bulkStopRef.current.controllers.delete(ctrl); }
      }
    });
    await Promise.all(workers);
  };

  const getReadyFrameTargets = (p: ApiProject) => {
    const targets: { sceneId: string; shotId: string }[] = [];
    const ignoreContinuity = p.videoModel?.startsWith('seedance');
    for (const scene of p.scenes) {
      scene.shots.forEach((shot, idx) => {
        if (shot.imageUrl) return;
        if (shot.imageStatus === GenerationStatus.LOADING) return;
        if (shot.imageStatus === GenerationStatus.ERROR) return;
        if (!ignoreContinuity && shot.continuityFrom === 'prev_shot' && idx > 0) {
          const prev = scene.shots[idx - 1];
          if (!prev?.videoUrl) return;
        }
        targets.push({ sceneId: scene.id, shotId: shot.id });
      });
    }
    return targets;
  };

  const getReadyStoryboardTargets = (p: ApiProject) => {
    // Image gen needs only the storyboard prompt. Cut plan is for the
    // downstream Seedance step (see c8385a0 — backend no longer gates image
    // gen on it). Locked shots are intentionally skipped — artist already
    // committed to a board. ERROR-status shots ARE included so a single bad
    // shot can be retried as part of the bulk run instead of forcing the
    // artist to click each one manually.
    const targets: { sceneId: string; shotId: string }[] = [];
    for (const scene of p.scenes) {
      scene.shots.forEach((shot) => {
        if (shot.storyboardLocked) return;
        if (!shot.storyboardPrompt?.trim()) return;
        if (shot.storyboardStatus === GenerationStatus.LOADING) return;
        targets.push({ sceneId: scene.id, shotId: shot.id });
      });
    }
    return targets;
  };

  const getReadyStoryboardPromptTargets = (p: ApiProject) => {
    const targets: { sceneId: string; shotId: string }[] = [];
    for (const scene of p.scenes) {
      scene.shots.forEach((shot) => {
        if (shot.storyboardPrompt?.trim()) return;
        if (shot.storyboardPromptStatus === GenerationStatus.LOADING) return;
        targets.push({ sceneId: scene.id, shotId: shot.id });
      });
    }
    return targets;
  };

  const handleBulkWriteStoryboardPrompts = async () => {
    if (!project) return;
    const targets = getReadyStoryboardPromptTargets(project);
    if (targets.length === 0) return;
    beginBulkRun();
    setStoryboardPromptQueue(targets.map(t => t.shotId));
    try {
      await runWithConcurrency(
        targets,
        5,
        (t, signal) => api.writeStoryboardPrompt(project.id, t.shotId, undefined, signal),
        t => {
          setStoryboardPromptQueue(q => q.filter(id => id !== t.shotId));
          updateShotOptimistic(t.shotId, { storyboardPromptStatus: GenerationStatus.LOADING });
        },
      );
      if (bulkStopRef.current.requested) return;
      const latest = await api.getProject(project.id);
      setProject(latest);
      // Bulk-complete notification. Fires regardless of tab focus — the
      // artist may be deep in another shot while this finished. Stopped
      // runs intentionally don't notify; the artist clicked Stop and
      // already knows the state.
      void notifyBulkComplete('Mirage · Prompts done', `${targets.length} storyboard prompt${targets.length === 1 ? '' : 's'} written.`);
    } finally {
      setStoryboardPromptQueue([]);
    }
  };

  const handleBulkGenerateStoryboards = async () => {
    if (!project) return;
    const targets = getReadyStoryboardTargets(project);
    if (targets.length === 0) return;
    beginBulkRun();
    setStoryboardImageQueue(targets.map(t => t.shotId));
    try {
      await runWithConcurrency(
        targets,
        2,
        (t, signal) => api.generateStoryboard(project.id, t.shotId, signal),
        t => {
          setStoryboardImageQueue(q => q.filter(id => id !== t.shotId));
          updateShotOptimistic(t.shotId, { storyboardStatus: GenerationStatus.LOADING });
        },
      );
      if (bulkStopRef.current.requested) return;
      const latest = await api.getProject(project.id);
      setProject(latest);
      void notifyBulkComplete('Mirage · Storyboards done', `${targets.length} board${targets.length === 1 ? '' : 's'} rendered.`);
    } finally {
      setStoryboardImageQueue([]);
    }
  };

  const handleBulkGenerateFrames = async () => {
    if (!project) return;
    let latestProject = project;
    // Multi-pass: each pass picks up newly-unblocked prev_shot frames as
    // earlier shots complete. Accumulate the total processed so the
    // notification body reflects the full job, not just the last pass.
    let totalFired = 0;
    beginBulkRun();
    try {
      while (true) {
        if (bulkStopRef.current.requested) break;
        const targets = getReadyFrameTargets(latestProject);
        if (targets.length === 0) break;
        totalFired += targets.length;
        const queueIds = targets.map(t => t.shotId);
        setFrameQueue(queueIds);
        await runWithConcurrency(
          targets,
          10,
          (t, signal) => api.generateShotImage(latestProject.id, t.shotId, undefined, signal),
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
        if (bulkStopRef.current.requested) break;
        // Refresh to see newly unblocked prev_shot frames
        latestProject = await api.getProject(latestProject.id);
        setProject(latestProject);
      }
      if (!bulkStopRef.current.requested && totalFired > 0) {
        void notifyBulkComplete('Mirage · Frames done', `${totalFired} shot frame${totalFired === 1 ? '' : 's'} generated.`);
      }
    } finally {
      setFrameQueue([]);
    }
  };

  const getReadyVideoTargets = (p: ApiProject) => {
    const targets: { sceneId: string; shotId: string }[] = [];
    const allowStoryboardVideo = p.videoModel?.startsWith('seedance');
    const ignoreContinuity = allowStoryboardVideo;
    for (const scene of p.scenes) {
      scene.shots.forEach((shot, idx) => {
        const hasVideoSource = !!shot.imageUrl || (allowStoryboardVideo && !!shot.storyboardLocked && !!shot.storyboardUrl);
        if (!hasVideoSource || shot.videoUrl) return;
        if (shot.videoStatus === GenerationStatus.LOADING) return;
        if (shot.videoStatus === GenerationStatus.ERROR) return;
        if (!ignoreContinuity && shot.continuityFrom === 'prev_shot' && idx > 0) {
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
    let totalFired = 0;
    beginBulkRun();
    try {
      while (true) {
        if (bulkStopRef.current.requested) break;
        const targets = getReadyVideoTargets(latestProject);
        if (targets.length === 0) break;
        totalFired += targets.length;
        const queueIds = targets.map(t => t.shotId);
        setVideoQueue(queueIds);
        // Throttle to 5 concurrent. Sized for Segmind rate limits.
        await runWithConcurrency(
          targets,
          5,
          (t, signal) => api.generateShotVideo(latestProject.id, t.shotId, undefined, undefined, signal),
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
        if (bulkStopRef.current.requested) break;
        // Refresh to see newly unblocked prev_shot shots
        latestProject = await api.getProject(latestProject.id);
        setProject(latestProject);
      }
      if (!bulkStopRef.current.requested && totalFired > 0) {
        void notifyBulkComplete('Mirage · Videos done', `${totalFired} shot clip${totalFired === 1 ? '' : 's'} generated.`);
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

  const activeAgentOperationList = Object.values(agentOperations)
    .sort((a, b) => Date.parse(a.started_at || '') - Date.parse(b.started_at || ''));
  const realtimeBadge = activeAgentOperationList[0]
    ? { tone: 'working' as const, message: activeAgentOperationList[0].label || 'Codex is working' }
    : realtimeNotice;

  return (
    <div className="min-h-screen bg-obsidian-950 text-zinc-100 font-sans flex flex-col h-screen overflow-hidden">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[999] focus:top-2 focus:left-2 focus:bg-white focus:text-black focus:px-4 focus:py-2 focus:rounded-md focus:text-sm">Skip to content</a>
      <AppHeader
        activeAgentOperationList={activeAgentOperationList}
        currentStep={currentStep}
        project={project}
        realtimeBadge={realtimeBadge}
        signOut={signOut}
        user={user}
        onOpenPrompts={() => setPromptsOpen(true)}
        onOpenSidebar={openSidebar}
        onOpenXray={() => setXrayOpen(true)}
        onStepChange={setCurrentStep}
      />

      <div className="flex flex-1 overflow-hidden">
        <main id="main-content" className="flex-1 overflow-y-auto relative">
          {/* Loading overlay — visible during project switch */}
          {(loading || restoring) && !project && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#141418]/80 backdrop-blur-sm">
              <div className="text-sm text-zinc-400 animate-pulse">
                {restoring ? 'Opening workspace…' : 'Loading…'}
              </div>
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
                <motion.div key="start" {...pageTransition}>
                  <StartProject
                    onCreate={handleCreateFromIntake}
                    creating={loading}
                    error={error}
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
                    onSetLookCandidates={(id, candidates) => setLookCandidates(prev => ({ ...prev, [id]: candidates }))}
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
                    onWriteStoryboardPrompt={handleWriteStoryboardPrompt}
                    onGenerateStoryboard={handleGenerateStoryboard}
                    onRefineStoryboard={handleRefineStoryboard}
                    onCancelStoryboard={handleCancelStoryboard}
                    onLockStoryboard={handleLockStoryboard}
                    onUnlockStoryboard={handleUnlockStoryboard}
                    onUpdateStoryboardPlan={handleUpdateStoryboardPlan}
                    onCancelShotImage={handleCancelShotImage}
                    onCancelShotVideo={handleCancelShotVideo}
                    onLockShot={handleLockShot}
                    onRevertVideo={handleRevertVideo}
                    onUseAsPrevEnd={handleUseAsPrevEnd}
                    onRefinePrompt={handleRefinePrompt}
                    onUpdateProject={handleUpdateProject}
                    onRewriteShotPrompts={handleRewriteShotPrompts}
                    onCancelRewritePrompts={() => abortOp('write-prompts')}
                    onBulkGenerateFrames={handleBulkGenerateFrames}
                    onBulkGenerateVideos={handleBulkGenerateVideos}
                    onBulkWriteStoryboardPrompts={handleBulkWriteStoryboardPrompts}
                    onBulkGenerateStoryboards={handleBulkGenerateStoryboards}
                    onCancelBulk={stopBulkRun}
                    bulkStopNotice={bulkStopNotice}
                    frameQueue={frameQueue}
                    videoQueue={videoQueue}
                    storyboardPromptQueue={storyboardPromptQueue}
                    storyboardImageQueue={storyboardImageQueue}
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
                    onJumpToAudioPhase={() => {
                      // T6.8: lipsync-blocked chip click in Studio. Hint the
                      // Blueprint editor to land on Audio phase, then navigate
                      // back to BLUEPRINT. AnalysisEditor reads + clears the
                      // hint on mount so this is a one-shot redirect.
                      try { sessionStorage.setItem('mirage:initialBlueprintPhase', 'audio'); } catch {}
                      setCurrentStep(AppStep.BLUEPRINT);
                    }}
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

      </div>

      <DestructiveActionDialog
        action={destructive}
        onCancel={() => setDestructive(null)}
        onRun={runDestructive}
      />

      <ProjectSidebar
        activeProjectId={project?.id}
        isOpen={sidebarOpen}
        projectList={projectList}
        projectListLoading={projectListLoading}
        renameDraft={renameDraft}
        renamingId={renamingId}
        onCancelRename={cancelRename}
        onClose={() => setSidebarOpen(false)}
        onLoadProject={loadProject}
        onRenameDraftChange={setRenameDraft}
        onRequestDelete={(p) => setDestructive({
          title: `Delete "${p.title}"?`,
          description: 'Removes the project from the list. Generated files stay on disk and can be re-linked later if needed.',
          mode: 'simple',
          confirmLabel: 'Delete',
          run: async () => {
            await api.deleteProject(p.id);
            setProjectList(list => list.filter(x => x.id !== p.id));
            if (project?.id === p.id) setProject(null);
          },
        })}
        onSaveRename={saveRename}
        onStartRename={startRename}
        onViewRenders={(projectId, title) => setRendersFor({ id: projectId, title })}
      />

      {/* Renders viewer popup — accessible from sidebar entries */}
      {rendersFor && (
        <RendersModal
          projectId={rendersFor.id}
          projectTitle={rendersFor.title}
          onClose={() => setRendersFor(null)}
        />
      )}

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
