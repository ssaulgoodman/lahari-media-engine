
import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { ApiProject, CastMember } from '../types';
import * as api from '../services/api';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { UnlockPill } from './UnlockPill';
import { Phase } from './BlueprintContextBar';
import { findPhase } from '../constants/blueprintPhases';
import { AssetShelf } from './AssetShelf';
import { canReopenBlueprintPhase } from '../constants/projectStatus';

interface Props {
  project: ApiProject;
  isLoading: boolean;
  looksLoading: Set<string>;
  lookCandidates: Record<string, { id: string; url: string }[]>;
  phaseTransition: Record<string, any>;
  onSetLookCandidates?: (castMemberId: string, candidates: { id: string; url: string }[]) => void;
  onDiscardLookCandidates?: (castMemberId: string) => void;
  onGenerateLooks: (castMemberId: string, feedback?: string, refImage?: File) => void | Promise<void>;
  onLockCharacter: (castMemberId: string, assetId: string) => void;
  onAddCast: (name: string, description: string) => void;
  onUpdateCast: (memberId: string, updates: { name?: string; description?: string; generationPrompt?: string }) => void;
  onDeleteCast: (memberId: string) => void;
  onUnlockCharacters?: () => void;
  onAdvanceCharacters: () => void;
  onSetProject?: (project: ApiProject) => void;
  onSetViewPhase: (phase: Phase) => void;
  onOpenModal: (url: string) => void;
  onConfirmDestructive?: (opts: { title: string; description: string; confirmLabel?: string; run: () => any }) => void;
  showActionError: (input: string | unknown) => void;
}

export const CharactersPhase: React.FC<Props> = ({
  project, isLoading, looksLoading, lookCandidates, phaseTransition,
  onSetLookCandidates, onDiscardLookCandidates,
  onGenerateLooks, onLockCharacter, onAddCast, onUpdateCast, onDeleteCast,
  onUnlockCharacters, onAdvanceCharacters, onSetProject, onSetViewPhase, onOpenModal, onConfirmDestructive, showActionError,
}) => {
  const [activeCastId, setActiveCastId] = useState<string | null>(project.cast[0]?.id || null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [castUploading, setCastUploading] = useState<Set<string>>(new Set());
  const [pendingCastRef, setPendingCastRef] = useState<{ memberId: string; file: File; previewUrl: string; note: string } | null>(null);
  const [charRefineImage, setCharRefineImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [savingVoice, setSavingVoice] = useState<Set<string>>(new Set());
  const castGuideUploadRef = useRef<HTMLInputElement>(null);
  const castAsIsUploadRef = useRef<HTMLInputElement>(null);

  const activeMember = project.cast.find(c => c.id === activeCastId);
  const activeLooks = activeCastId ? (lookCandidates[activeCastId] || []) : [];

  // Voice editor is workflow-config driven. Anime exposes voice fields (even
  // when Audio phase is coming-soon); music_video does not. Same gate as the
  // dialogue UI in ScriptPhase so the two surfaces stay coherent.
  const voiceFieldsVisible = !!findPhase(project, 'audio')?.visible;

  const saveVoice = async (
    memberId: string,
    voice: { voiceProvider: 'elevenlabs'; voiceId: string; voiceName?: string },
  ) => {
    setSavingVoice(prev => new Set(prev).add(memberId));
    try {
      const updated = await api.updateCastVoice(project.id, memberId, voice);
      if (updated?.id) onSetProject?.(updated);
      setSavedFlash(`voice-${memberId}`);
      setTimeout(() => setSavedFlash(null), 1500);
    } catch (err) {
      // Pass raw error so missing_key (ElevenLabs) surfaces a setup link.
      showActionError(err);
    } finally {
      setSavingVoice(prev => {
        const next = new Set(prev);
        next.delete(memberId);
        return next;
      });
    }
  };

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

  // CharactersPhase registry surface (T10.6): both registered tools
  // (generate-character-looks, assign-cast-voice) are PER-CAST-MEMBER
  // affordances — they fire from the per-character sidebar / detail
  // panel, not as project-level shelf buttons. Hide them from
  // AssetShelf so the registry contract holds (parameterized tools
  // don't double-surface) and the bespoke per-row UI stays the source
  // of truth. The wrapper stays so any FUTURE project-level character
  // tool (e.g. "bulk-generate-all-looks") would self-surface.
  return (
    <motion.div key="characters" {...phaseTransition} className="space-y-6">
      {onUnlockCharacters && canReopenBlueprintPhase(project, 'characters') && (
        <div className="flex justify-end">
          <UnlockPill onClick={onUnlockCharacters} disabled={isLoading} label="Unlock characters" />
        </div>
      )}
      <AssetShelf
        surface="asset:characters"
        project={project}
        onRunTool={() => {}}
        hideToolKeys={['generate-character-looks', 'assign-cast-voice']}
      />
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
                        <div className="text-xs text-zinc-400 truncate flex items-center gap-1.5">
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
                onClick={() => { onAdvanceCharacters(); onSetViewPhase('environments'); }}
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
              {/* Header bar */}
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
                    <span className="text-xs text-zinc-400 flex items-center gap-1.5 flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-white" aria-hidden="true"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                      Locked
                      <button
                        onClick={async () => {
                          try {
                            await api.unlockCharacterLook(project.id, activeMember.id);
                            onSetProject?.({ ...project, cast: project.cast.map(c => c.id === activeMember.id ? { ...c, referenceImageUrl: undefined } : c) });
                            const candidates = await api.getCandidates(project.id, 'character', activeMember.id);
                            if (candidates.length > 0) onSetLookCandidates?.(activeMember.id, candidates);
                          } catch (err: any) { showActionError(`Unlock failed: ${err.message}`); }
                        }}
                        className="text-zinc-500 hover:text-amber-400/80 transition-colors"
                        title="Unlock — browse previous candidates"
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

              {/* Pending "upload as guide" */}
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

              {/* Hero area */}
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
                        <img src={look.url} alt={activeMember.name} onClick={() => onOpenModal(look.url)} className="w-full h-auto object-contain" />
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
                <div className="relative cursor-zoom-in bg-black/20" onClick={() => onOpenModal(activeMember.referenceImageUrl!)}>
                  <img src={activeMember.referenceImageUrl} alt={activeMember.name} className="w-full h-auto max-h-[500px] object-contain mx-auto" />
                </div>
              ) : (
                <div className="h-48 flex items-center justify-center bg-black/10">
                  <span className="text-sm text-zinc-400">No reference yet — generate looks below</span>
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
                    key={`desc-${activeMember.id}`}
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => onUpdateCast(activeMember.id, { description: e.currentTarget.textContent || '' })}
                    className="mt-1 text-sm text-zinc-400 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded px-1 -mx-1"
                  >
                    {activeMember.description}
                  </div>
                </details>

                {/* Voice (anime workflow only) */}
                {voiceFieldsVisible && (
                  <VoiceEditor
                    member={activeMember}
                    saving={savingVoice.has(activeMember.id)}
                    saved={savedFlash === `voice-${activeMember.id}`}
                    onSave={(voice) => saveVoice(activeMember.id, voice)}
                  />
                )}

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
                    <div className="text-xs text-zinc-500 italic">Built from description + style on first generate. Editable after.</div>
                  )}
                </div>

                {/* Generate button */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onGenerateLooks(activeMember.id)}
                    disabled={looksLoading.has(activeMember.id)}
                    className="px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                  >
                    {activeMember.referenceImageUrl ? 'Regenerate looks' : 'Generate 3 looks'}
                  </button>
                </div>

                {/* Refine */}
                <div className="h-px bg-white/[0.06]" />
                <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-2">
                  Refine — describe what's wrong, Claude rewrites the prompt
                </div>
                {charRefineImage && (
                  <div className="flex items-center gap-2 mb-2">
                    <img src={charRefineImage.previewUrl} className="w-10 h-10 rounded object-cover border border-white/[0.08]" alt="Reference" />
                    <span className="text-[11px] text-zinc-400">Reference attached</span>
                    <button onClick={() => { URL.revokeObjectURL(charRefineImage.previewUrl); setCharRefineImage(null); }} className="text-zinc-500 hover:text-red-400 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                )}
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
                        onGenerateLooks(activeMember.id, (e.target as HTMLTextAreaElement).value, charRefineImage?.file);
                        (e.target as HTMLTextAreaElement).value = '';
                        if (charRefineImage) { URL.revokeObjectURL(charRefineImage.previewUrl); setCharRefineImage(null); }
                      }
                    }}
                  />
                  <label className="px-2 py-2 bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-white rounded-md transition-colors flex-shrink-0 self-start cursor-pointer flex items-center" title="Attach a reference image">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>
                    <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setCharRefineImage({ file: f, previewUrl: URL.createObjectURL(f) }); e.target.value = ''; }} />
                  </label>
                  <button
                    onClick={() => {
                      const input = document.getElementById(`char-feedback-${activeMember.id}`) as HTMLTextAreaElement;
                      if (input?.value.trim()) {
                        onGenerateLooks(activeMember.id, input.value, charRefineImage?.file);
                        input.value = '';
                        if (charRefineImage) { URL.revokeObjectURL(charRefineImage.previewUrl); setCharRefineImage(null); }
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
  );
};

// ─── Voice editor (anime workflow only) ─────────────────────────────
// One row per cast member: provider dropdown (just 'elevenlabs' for v1),
// voice_id input (paste raw ID from provider), optional voice_name label.
// v1 ships paste-voice-ID; voice library is v1.5 (ledger §1 out of scope).

interface VoiceEditorProps {
  member: CastMember;
  saving: boolean;
  saved: boolean;
  onSave: (voice: { voiceProvider: 'elevenlabs'; voiceId: string; voiceName?: string }) => void;
}

const VoiceEditor: React.FC<VoiceEditorProps> = ({ member, saving, saved, onSave }) => {
  const [voiceId, setVoiceId] = useState(member.voiceId || '');
  const [voiceName, setVoiceName] = useState(member.voiceName || '');
  const [expanded, setExpanded] = useState(false);

  // Reset local edit state when switching to a different cast member.
  React.useEffect(() => {
    setVoiceId(member.voiceId || '');
    setVoiceName(member.voiceName || '');
  }, [member.id, member.voiceId, member.voiceName]);

  const isSet = !!member.voiceId;
  const dirty = voiceId.trim() !== (member.voiceId || '') || voiceName.trim() !== (member.voiceName || '');
  const canSave = voiceId.trim().length > 0 && dirty && !saving;

  return (
    <details
      className="group"
      open={expanded || !isSet}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary className="text-[11px] uppercase tracking-wide text-zinc-500 cursor-pointer hover:text-zinc-400 flex items-center gap-1">
        <svg className="w-3 h-3 transition-transform group-open:rotate-90" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
        Voice
        {isSet ? (
          <span className="ml-2 text-[10px] normal-case tracking-normal text-emerald-300/80 bg-emerald-500/[0.06] rounded px-1.5 py-0.5">
            {member.voiceName || member.voiceId?.slice(0, 8) + '…'}
          </span>
        ) : (
          <span className="ml-2 text-[10px] normal-case tracking-normal text-amber-300/80 bg-amber-500/[0.08] rounded px-1.5 py-0.5">
            not set
          </span>
        )}
        {saved && <span className="ml-1 text-[10px] text-emerald-400/70 normal-case">Saved</span>}
      </summary>
      <div className="mt-2 space-y-2.5">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Provider</label>
          <div className="text-xs text-zinc-300 px-3 py-2 surface-inset rounded-md inline-block">
            ElevenLabs
            <span className="text-zinc-500 ml-2 text-[10px]">v1</span>
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Voice ID</label>
          <input
            type="text"
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            placeholder="paste from elevenlabs.io/voice-library"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full font-mono text-xs text-zinc-200 surface-inset rounded-md px-3 py-2 outline-none focus-visible:ring-1 focus-visible:ring-white/20 placeholder:text-zinc-600"
          />
          <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed">
            Find or clone a voice at{' '}
            <a
              href="https://elevenlabs.io/app/voice-library"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-400 hover:text-white underline underline-offset-2 transition-colors"
            >
              elevenlabs.io/voice-library
            </a>
            , then copy its Voice ID.
          </p>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">
            Label <span className="text-zinc-600 normal-case tracking-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            placeholder={`e.g. "Mina narrator"`}
            className="w-full text-xs text-zinc-200 surface-inset rounded-md px-3 py-2 outline-none focus-visible:ring-1 focus-visible:ring-white/20 placeholder:text-zinc-600"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSave({
              voiceProvider: 'elevenlabs',
              voiceId: voiceId.trim(),
              voiceName: voiceName.trim() || undefined,
            })}
            disabled={!canSave}
            className="px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors inline-flex items-center gap-1.5"
          >
            {saving && <span className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />}
            {saving ? 'Saving…' : isSet ? 'Update voice' : 'Set voice'}
          </button>
          {dirty && !saving && (
            <button
              onClick={() => {
                setVoiceId(member.voiceId || '');
                setVoiceName(member.voiceName || '');
              }}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </details>
  );
};
