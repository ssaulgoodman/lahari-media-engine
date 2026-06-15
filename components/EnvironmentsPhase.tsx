
import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { ApiProject } from '../types';
import * as api from '../services/api';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { UnlockPill } from './UnlockPill';
import { Phase } from './BlueprintContextBar';
import { AssetShelf } from './AssetShelf';
import { canReopenBlueprintPhase } from '../constants/projectStatus';

interface Props {
  project: ApiProject;
  isLoading: boolean;
  envLooks: Record<string, { id: string; url: string }[]>;
  envGenerating: Set<string>;
  onSetEnvLooks: React.Dispatch<React.SetStateAction<Record<string, { id: string; url: string }[]>>>;
  onSetEnvGenerating: React.Dispatch<React.SetStateAction<Set<string>>>;
  phaseTransition: Record<string, any>;
  onUnlockEnvironments?: () => void;
  onAdvanceEnvironments: () => void;
  onSetProject?: (project: ApiProject) => void;
  onOpenModal: (url: string) => void;
  onConfirmDestructive?: (opts: { title: string; description: string; confirmLabel?: string; run: () => any }) => void;
  showActionError: (input: string | unknown) => void;
}

export const EnvironmentsPhase: React.FC<Props> = ({
  project, isLoading, envLooks, envGenerating, onSetEnvLooks, onSetEnvGenerating, phaseTransition,
  onUnlockEnvironments, onAdvanceEnvironments, onSetProject, onOpenModal, onConfirmDestructive, showActionError,
}) => {
  const [activeEnvId, setActiveEnvId] = useState<string | null>(project.environments[0]?.id || null);
  const [envUploading, setEnvUploading] = useState<Set<string>>(new Set());
  const [pendingEnvRef, setPendingEnvRef] = useState<{ envId: string; file: File; previewUrl: string; note: string } | null>(null);
  const [envRefineImage, setEnvRefineImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [refreshingCandidateIds, setRefreshingCandidateIds] = useState<Set<string>>(new Set());
  // Slice B of button-feedback-audit: which env look candidate is being
  // locked. Per-look pending state for immediate Lock button feedback.
  const [lockingLookId, setLockingLookId] = useState<string | null>(null);
  // Slice E of button-feedback-audit (D2): which env row is currently being
  // deleted. Keyed by envId so siblings stay responsive. Spinner means
  // "backend in flight" — set only AFTER the destructive dialog confirms.
  const [deletingEnvIds, setDeletingEnvIds] = useState<Set<string>>(new Set());
  const runEnvDelete = async (envId: string) => {
    if (deletingEnvIds.has(envId)) return;
    setDeletingEnvIds(prev => new Set(prev).add(envId));
    try {
      await api.deleteEnvironment(project.id, envId);
      if (activeEnvId === envId) setActiveEnvId(project.environments.find(x => x.id !== envId)?.id || null);
      onSetProject?.({ ...project, environments: project.environments.filter(x => x.id !== envId) });
    } catch (err: any) {
      showActionError(`Delete failed: ${err.message}`);
    } finally {
      setDeletingEnvIds(prev => { const next = new Set(prev); next.delete(envId); return next; });
    }
  };
  const envGuideUploadRef = useRef<HTMLInputElement>(null);
  const envAsIsUploadRef = useRef<HTMLInputElement>(null);

  const activeEnv = project.environments.find(e => e.id === activeEnvId);
  const activeEnvLooks = activeEnvId ? (envLooks[activeEnvId] || []) : [];

  // ─── Handlers ──────────────────────────────────────────────

  const handleEnvGenerate = async (envId: string, refImage?: File, note?: string) => {
    onSetEnvGenerating(prev => new Set(prev).add(envId));
    try {
      const result = await api.generateEnvironmentLook(project.id, envId, undefined, refImage, note);
      onSetEnvLooks(prev => ({ ...prev, [envId]: result.looks || [] }));
      onSetProject?.(result.project);
    } catch (err: any) {
      showActionError(`Environment look generation failed: ${err.message}`);
    } finally {
      onSetEnvGenerating(prev => { const s = new Set(prev); s.delete(envId); return s; });
    }
  };

  const refreshEnvCandidates = async (envId: string) => {
    if (refreshingCandidateIds.has(envId)) return;
    setRefreshingCandidateIds(prev => new Set(prev).add(envId));
    try {
      const candidates = await api.getCandidates(project.id, 'environment', envId);
      onSetEnvLooks(prev => ({ ...prev, [envId]: candidates }));
      if (candidates.length === 0) showActionError('No generated candidates found for this environment yet.');
    } catch (err: any) {
      showActionError(`Refresh candidates failed: ${err.message}`);
    } finally {
      setRefreshingCandidateIds(prev => { const next = new Set(prev); next.delete(envId); return next; });
    }
  };

  const handleEnvLock = async (envId: string, assetId: string) => {
    try {
      await api.lockEnvironment(project.id, envId, assetId);
      const lockedUrl = envLooks[envId]?.find(l => l.id === assetId)?.url;
      onSetProject?.({
        ...project,
        environments: project.environments.map(e => e.id === envId ? { ...e, referenceImageUrl: lockedUrl || e.referenceImageUrl } : e),
      });
      onSetEnvLooks(prev => ({ ...prev, [envId]: [] }));
    } catch (err: any) {
      showActionError(`Environment lock failed: ${err.message}`);
    }
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
    handleEnvGenerate(envId, file, note.trim() || undefined);
  };
  const clearPendingEnvRef = () => {
    if (pendingEnvRef?.previewUrl) URL.revokeObjectURL(pendingEnvRef.previewUrl);
    setPendingEnvRef(null);
  };

  // EnvironmentsPhase registry surface (T10.7): generate-environment-looks
  // is a PER-ENVIRONMENT affordance (fires from the env detail panel,
  // parameterized by envId). Hide from AssetShelf so the registry
  // contract holds and the bespoke per-row UI stays the source of truth.
  // Wrapper stays so any future project-level env tool self-surfaces.
  return (
    <motion.div key="environments" {...phaseTransition} className="space-y-6">
      {onUnlockEnvironments && canReopenBlueprintPhase(project, 'environments') && (
        <div className="flex justify-end">
          <UnlockPill onClick={onUnlockEnvironments} disabled={isLoading} label="Unlock environments" />
        </div>
      )}
      <AssetShelf
        surface="asset:environments"
        project={project}
        onRunTool={() => {}}
        hideToolKeys={['generate-environment-looks']}
      />
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
                  const isDeleting = deletingEnvIds.has(env.id);
                  return (
                    <div
                      key={env.id}
                      className={`group relative rounded-lg transition-colors ${
                        isActive ? 'bg-white/[0.08] border-l-2 border-l-white/70' : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
                      } ${isDeleting ? 'opacity-50 pointer-events-none' : ''}`}
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
                              <><div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div> Generating…</>
                            ) : hasLook ? (
                              <><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-white flex-shrink-0" aria-hidden="true"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg> Look set</>
                            ) : 'No look'}
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // Destructive-dialog rule: pending state flips only
                          // after the user confirms the modal — spinner means
                          // "backend in flight", not "modal open".
                          const triggerDelete = () => { void runEnvDelete(env.id); };
                          if (onConfirmDestructive) {
                            onConfirmDestructive({
                              title: `Delete "${env.name}"?`,
                              description: 'Removes this environment. Shots that reference it will lose that environment ref until you re-add one.',
                              confirmLabel: 'Delete',
                              run: triggerDelete,
                            });
                          } else {
                            triggerDelete();
                          }
                        }}
                        disabled={isDeleting}
                        className="absolute top-1/2 right-2 -translate-y-1/2 text-zinc-400 hover:text-red-400 p-1 rounded transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-100"
                        aria-label={`Delete ${env.name}`}
                        title={isDeleting ? 'Deleting…' : 'Delete'}
                      >
                        {isDeleting ? (
                          <span className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        )}
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
                {/* Header bar */}
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
                      <span className="text-xs text-zinc-400 flex items-center gap-1.5 flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-white" aria-hidden="true"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                        Locked
                        <button
                          onClick={async () => {
                            try {
                              await api.unlockEnvironmentLook(project.id, activeEnv.id);
                              onSetProject?.({ ...project, environments: project.environments.map(e => e.id === activeEnv.id ? { ...e, referenceImageUrl: undefined } : e) });
                              const candidates = await api.getCandidates(project.id, 'environment', activeEnv.id);
                              if (candidates.length > 0) onSetEnvLooks(prev => ({ ...prev, [activeEnv.id]: candidates }));
                            } catch (err: any) { showActionError(`Unlock failed: ${err.message}`); }
                          }}
                          className="text-zinc-500 hover:text-amber-400/80 transition-colors"
                          title="Unlock and regenerate — pick a different look"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                        </button>
                      </span>
                    )}
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
                    <button
                      onClick={() => refreshEnvCandidates(activeEnv.id)}
                      disabled={refreshingCandidateIds.has(activeEnv.id)}
                      className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-300 hover:text-white rounded-md text-xs transition-colors disabled:opacity-50"
                      title="Refresh generated candidates from Mirage. Use after agent/Codex generation finishes."
                    >
                      {refreshingCandidateIds.has(activeEnv.id) ? 'Refreshing…' : 'Refresh candidates'}
                    </button>
                  </div>
                </div>

                {/* Pending "upload as guide" */}
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

                {/* Hero area */}
                {activeEnvLooks.length > 0 ? (
                  <div>
                    {activeEnv.referenceImageUrl && (
                      <div className="px-5 py-2.5 flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02]">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-[11px] uppercase tracking-wide text-zinc-400 flex-shrink-0">New candidates</span>
                          <span className="text-xs text-zinc-400">— pick one to replace the locked look, or</span>
                          <button
                            onClick={() => onSetEnvLooks(prev => ({ ...prev, [activeEnv.id]: [] }))}
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
                      {activeEnvLooks.map(look => {
                        const isLocking = lockingLookId === look.id;
                        const lockingOther = lockingLookId !== null && !isLocking;
                        const handleLock = async () => {
                          if (lockingOther || isLocking) return;
                          setLockingLookId(look.id);
                          try {
                            await Promise.resolve(handleEnvLock(activeEnv.id, look.id));
                          } finally {
                            setLockingLookId(null);
                          }
                        };
                        return (
                        <div key={look.id} className="relative group cursor-pointer bg-black/10">
                          <img src={look.url} alt={activeEnv.name} onClick={() => onOpenModal(look.url)} className="w-full h-auto object-contain" />
                          <div className={`absolute inset-0 bg-black/60 flex items-center justify-center transition-opacity pointer-events-none ${isLocking ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                            <button
                              onClick={handleLock}
                              disabled={lockingOther || isLocking}
                              className="pointer-events-auto bg-white/95 backdrop-blur text-black px-3 py-1.5 rounded-md text-xs font-medium hover:bg-white transition-colors flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                              aria-label="Lock this look"
                            >
                              {isLocking ? (
                                <span className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                              )}
                              {isLocking ? 'Locking…' : 'Lock'}
                            </button>
                          </div>
                        </div>
                        );
                      })}
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
                  <div className="relative cursor-zoom-in bg-black/20" onClick={() => onOpenModal(activeEnv.referenceImageUrl!)}>
                    <img src={activeEnv.referenceImageUrl} alt={activeEnv.name} className="w-full h-auto max-h-[500px] object-contain mx-auto" />
                  </div>
                ) : (
                  <div className="h-48 flex items-center justify-center bg-black/10">
                    <span className="text-sm text-zinc-400">No reference yet — generate looks above</span>
                  </div>
                )}

                {/* ═══ UNIFIED TOOLKIT ═══ */}
                <div className="px-5 py-4 space-y-3 border-t border-white/[0.06]">
                  {/* Description */}
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

                  {/* Ref chips */}
                  {project.styleAssetUrl && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] text-zinc-400 mr-1">Refs:</span>
                      <div className="group/ref relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border border-white/[0.08] text-zinc-300 bg-white/[0.02] cursor-pointer"
                        onClick={() => onOpenModal(project.styleAssetUrl!)}>
                        <img src={project.styleAssetUrl} className="w-4 h-4 rounded-sm object-cover flex-shrink-0" alt="" />
                        <span>Style</span>
                        <div className="hidden group-hover/ref:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[200] pointer-events-none">
                          <img src={project.styleAssetUrl} className="max-w-44 max-h-44 object-contain rounded-lg shadow-xl border border-white/[0.1]" alt="Style" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Prompt */}
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
                      <div className="text-xs text-zinc-500 italic">Built from description + style on first generate. Editable after.</div>
                    )}
                  </div>

                  {/* Generate button */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleEnvGenerate(activeEnv.id)}
                      disabled={envGenerating.has(activeEnv.id)}
                      className="px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                    >
                      {activeEnv.referenceImageUrl ? 'Regenerate looks' : 'Generate 3 looks'}
                    </button>
                  </div>

                  {/* Refine */}
                  <div className="h-px bg-white/[0.06]" />
                  <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-2">
                    Refine — describe what's wrong, Claude rewrites the prompt
                  </div>
                  {envRefineImage && (
                    <div className="flex items-center gap-2 mb-2">
                      <img src={envRefineImage.previewUrl} className="w-10 h-10 rounded object-cover border border-white/[0.08]" alt="Reference" />
                      <span className="text-[11px] text-zinc-400">Reference attached</span>
                      <button onClick={() => { URL.revokeObjectURL(envRefineImage.previewUrl); setEnvRefineImage(null); }} className="text-zinc-500 hover:text-red-400 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  )}
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
                          handleEnvGenerate(activeEnv.id, envRefineImage?.file, (e.target as HTMLTextAreaElement).value);
                          (e.target as HTMLTextAreaElement).value = '';
                          if (envRefineImage) { URL.revokeObjectURL(envRefineImage.previewUrl); setEnvRefineImage(null); }
                        }
                      }}
                    />
                    <label className="px-2 py-2 bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-white rounded-md transition-colors flex-shrink-0 self-start cursor-pointer flex items-center" title="Attach a reference image">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>
                      <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setEnvRefineImage({ file: f, previewUrl: URL.createObjectURL(f) }); e.target.value = ''; }} />
                    </label>
                    <button
                      onClick={() => {
                        const input = document.getElementById(`env-feedback-${activeEnv.id}`) as HTMLTextAreaElement;
                        if (input?.value.trim()) {
                          handleEnvGenerate(activeEnv.id, envRefineImage?.file, input.value);
                          input.value = '';
                          if (envRefineImage) { URL.revokeObjectURL(envRefineImage.previewUrl); setEnvRefineImage(null); }
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
  );
};
