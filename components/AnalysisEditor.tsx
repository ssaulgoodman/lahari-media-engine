
import React, { useState, useRef } from 'react';
import { ApiProject, ConceptOption, CastMember, Environment, VideoMode } from '../types';
import * as api from '../services/api';

interface Props {
  project: ApiProject;
  isLoading: boolean;
  lookCandidates: Record<string, { id: string; url: string }[]>;
  onLockConcept: (index: number) => void;
  onLockStyle: (assetId: string, styleDescription?: string) => void;
  onUnlockStyle: () => void;
  onGenerateLooks: (castMemberId: string, feedback?: string) => void;
  onLockCharacter: (castMemberId: string, assetId: string) => void;
  onAddCast: (name: string, description: string) => void;
  onUpdateCast: (memberId: string, updates: { name?: string; description?: string }) => void;
  onDeleteCast: (memberId: string) => void;
  onGenerateScript: () => void;
  onUpdateProject: (updates: Record<string, any>) => void;
  onLaunchStudio: () => void;
  onSetProject?: (project: ApiProject) => void;
}

type Phase = 'concept' | 'script' | 'style' | 'characters';

const PHASE_ORDER: Phase[] = ['concept', 'script', 'style', 'characters'];

const phaseIndex = (p: Phase) => PHASE_ORDER.indexOf(p);

// Determine active phase from project status
// Flow: concept_locked → scripted → style_locked → characters_locked
const getActivePhase = (project: ApiProject): Phase => {
  switch (project.status) {
    case 'analyzed': return 'concept';
    case 'concept_locked': return 'script';
    case 'scripted': return 'style';
    case 'style_locked': return 'characters';
    case 'characters_locked':
    case 'in_production':
      return 'characters';
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

// ─── Environment Card (self-contained, calls API directly) ──────────

const EnvironmentCard: React.FC<{
  env: Environment;
  projectId: string;
  isLoading: boolean;
  onProjectUpdate: (p: ApiProject) => void;
}> = ({ env, projectId, isLoading, onProjectUpdate }) => {
  const [looks, setLooks] = useState<{ id: string; url: string }[]>([]);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await api.generateEnvironmentLook(projectId, env.id);
      setLooks(result.looks || []);
      onProjectUpdate(result.project);
    } catch (err: any) {
      console.error('Environment look gen failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleLock = async (assetId: string) => {
    try {
      const p = await api.lockEnvironment(projectId, env.id, assetId);
      onProjectUpdate(p);
      setLooks([]);
    } catch (err: any) {
      console.error('Environment lock failed:', err);
    }
  };

  return (
    <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
      <div className="p-4">
        <h4 className="text-sm font-display font-medium text-white mb-1">{env.name}</h4>
        <p className="text-xs text-zinc-400 leading-relaxed mb-3">{env.description}</p>

        {/* Locked reference */}
        {env.referenceImageUrl && (
          <div className="mb-3">
            <span className="text-[10px] uppercase font-bold text-green-400 mb-1 block">✓ Locked</span>
            <div className="aspect-video rounded-lg overflow-hidden border border-green-500/30">
              <img src={env.referenceImageUrl} className="w-full h-full object-cover" />
            </div>
          </div>
        )}

        {/* Generated looks */}
        {generating && looks.length === 0 && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="aspect-video rounded bg-zinc-800 animate-pulse border border-white/5 flex items-center justify-center">
                <div className="w-4 h-4 border-2 border-accent-400/30 border-t-accent-400 rounded-full animate-spin"></div>
              </div>
            ))}
          </div>
        )}

        {looks.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {looks.map(look => (
              <div
                key={look.id}
                onClick={() => handleLock(look.id)}
                className="cursor-pointer aspect-video rounded overflow-hidden border border-white/10 hover:border-accent-500 transition-all relative group"
              >
                <img src={look.url} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <span className="text-[8px] font-bold text-white bg-accent-600 px-2 py-0.5 rounded-full">Lock</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={generating || isLoading}
          className="w-full py-2 bg-accent-600/20 hover:bg-accent-600 text-accent-400 hover:text-white rounded text-xs font-bold border border-accent-500/30 transition-all disabled:opacity-30"
        >
          {generating ? 'Generating...' : env.referenceImageUrl ? 'Regenerate Looks' : 'Generate 3 Looks'}
        </button>
      </div>
    </div>
  );
};

export const AnalysisEditor: React.FC<Props> = ({
  project, isLoading, lookCandidates,
  onLockConcept, onLockStyle, onUnlockStyle,
  onGenerateLooks, onLockCharacter, onAddCast, onUpdateCast, onDeleteCast,
  onGenerateScript, onUpdateProject, onLaunchStudio, onSetProject,
}) => {
  const activePhase = getActivePhase(project);
  const [viewPhase, setViewPhase] = useState<Phase>(activePhase);
  const [activeCastId, setActiveCastId] = useState<string | null>(project.cast[0]?.id || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Style exploration state (ephemeral) ────────────────────────
  const [styleSlots, setStyleSlots] = useState<StyleSlot[]>([]);
  const [userSlot, setUserSlot] = useState<StyleSlot>({ title: 'Your Vision', description: '' });
  const [brainstormNotes, setBrainstormNotes] = useState('');
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  const [isBrainstorming, setIsBrainstorming] = useState(false);
  const [isLocking, setIsLocking] = useState(false);

  const canAccess = (phase: Phase) => phaseIndex(phase) <= phaseIndex(activePhase);
  const isLocked = (phase: Phase) => phaseIndex(phase) < phaseIndex(activePhase);
  const activeMember = project.cast.find(c => c.id === activeCastId);
  const activeLooks = activeCastId ? (lookCandidates[activeCastId] || []) : [];

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
        imageUrl: undefined, // clear old image since description changed
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

  // ─── Style Card Component ──────────────────────────────────────

  const StyleCard: React.FC<{
    slot: StyleSlot;
    index: number;
    isUserSlot?: boolean;
    onVisualize: () => void;
    onLock: () => void;
    onDescriptionChange?: (desc: string) => void;
  }> = ({ slot, index, isUserSlot, onVisualize, onLock, onDescriptionChange }) => {
    const [refineInput, setRefineInput] = useState('');

    return (
      <div className="glass rounded-2xl border border-white/5 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-display font-medium text-white">{slot.title || 'Untitled'}</h4>
            {!isUserSlot && (
              <span className="text-[10px] bg-zinc-800 px-2 py-0.5 rounded text-zinc-500">#{index + 1}</span>
            )}
          </div>

          {/* Description — editable for user slot, display for AI slots */}
          {isUserSlot ? (
            <textarea
              value={slot.description}
              onChange={(e) => onDescriptionChange?.(e.target.value)}
              placeholder="Describe your visual style... e.g. 'Mughal miniature painting meets soft candlelight, intricate botanical borders, earthy jewel tones'"
              className="w-full h-24 bg-black/40 border border-white/10 rounded-lg p-3 text-xs text-zinc-300 outline-none focus:border-accent-500/50 resize-none leading-relaxed"
            />
          ) : (
            <p className="text-xs text-zinc-400 leading-relaxed">{slot.description}</p>
          )}
        </div>

        {/* Image Area */}
        <div className="px-5 flex-1">
          {slot.isGenerating ? (
            <div className="aspect-video rounded-xl bg-zinc-800 animate-pulse border border-white/5 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-accent-400/30 border-t-accent-400 rounded-full animate-spin"></div>
                <span className="text-[10px] text-zinc-500">Generating...</span>
              </div>
            </div>
          ) : slot.imageUrl ? (
            <div className="aspect-video rounded-xl overflow-hidden border border-white/10 relative group">
              <img src={slot.imageUrl} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <button
                  onClick={onLock}
                  disabled={isLocking}
                  className="bg-white text-black px-4 py-2 rounded-full text-xs font-bold hover:bg-accent-400 transition-colors disabled:opacity-50"
                >
                  {isLocking ? 'Locking...' : 'Lock This Style'}
                </button>
              </div>
            </div>
          ) : (
            <div className="aspect-video rounded-xl border-2 border-dashed border-white/10 flex items-center justify-center">
              <span className="text-zinc-700 text-xs">No image yet</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 py-4 space-y-2">
          {/* Refine input (AI slots only) */}
          {!isUserSlot && slot.description && (
            <div className="flex gap-2">
              <input
                value={refineInput}
                onChange={(e) => setRefineInput(e.target.value)}
                placeholder="Refine: 'more golden', 'darker mood'..."
                className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-white outline-none focus:border-accent-500/50"
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
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs text-zinc-300 border border-white/5 disabled:opacity-30"
              >
                {slot.isRefining ? '...' : 'Refine'}
              </button>
            </div>
          )}

          {/* Visualize button */}
          <button
            onClick={onVisualize}
            disabled={!slot.description || slot.isGenerating}
            className="w-full py-2 bg-accent-600/20 hover:bg-accent-600 text-accent-400 hover:text-white rounded-lg text-xs font-bold border border-accent-500/30 transition-all disabled:opacity-30 disabled:hover:bg-accent-600/20 disabled:hover:text-accent-400"
          >
            {slot.isGenerating ? 'Generating...' : slot.imageUrl ? 'Re-visualize' : 'Visualize'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-slide-up p-8 pb-32">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end border-b border-white/10 pb-6 gap-6">
        <div>
          <h2 className="text-4xl font-display font-medium text-white">{project.title || 'Production Pipeline'}</h2>
          <p className="text-zinc-500 mt-2 font-light">
            Phase: {viewPhase === 'concept' ? '1. Choose Concept' : viewPhase === 'script' ? '2. Generate Script' : viewPhase === 'style' ? '3. Lock Art Style' : '4. Lock Characters'}
          </p>
        </div>
        {project.status === 'characters_locked' && (
          <button onClick={onLaunchStudio} className="bg-accent-600 hover:bg-accent-500 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-accent-500/20 transition-all hover:scale-105">
            Launch Studio →
          </button>
        )}
      </div>

      {/* Phase Progress Bar */}
      <div className="flex gap-1">
        {PHASE_ORDER.map((phase, idx) => (
          <button
            key={phase}
            disabled={!canAccess(phase)}
            onClick={() => canAccess(phase) && setViewPhase(phase)}
            className={`flex-1 h-10 rounded-lg flex items-center justify-center text-xs font-medium transition-all border ${
              viewPhase === phase
                ? 'bg-accent-600 border-accent-500 text-white'
                : isLocked(phase)
                  ? 'bg-green-500/10 border-green-500/30 text-green-400 cursor-pointer hover:bg-green-500/20'
                  : canAccess(phase)
                    ? 'bg-zinc-800 border-white/5 text-zinc-400 cursor-pointer hover:bg-zinc-700'
                    : 'bg-zinc-900 border-white/5 text-zinc-700 cursor-not-allowed'
            }`}
          >
            {isLocked(phase) && <span className="mr-1">✓</span>}
            {idx + 1}. {phase.charAt(0).toUpperCase() + phase.slice(1)}
          </button>
        ))}
      </div>

      {/* ═══════════════════ PHASE 1: CONCEPT ═══════════════════ */}
      {viewPhase === 'concept' && (
        <div className="space-y-8">
          {isLocked('concept') ? (
            <div className="glass p-8 rounded-2xl border border-green-500/20">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-green-400 text-lg">✓</span>
                <h3 className="text-lg font-display text-white">Locked Concept: {project.lockedConcept?.conceptDirection}</h3>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                <div><span className="text-zinc-500 text-xs block uppercase">Deity</span><span className="text-white">{project.lockedConcept?.deity}</span></div>
                <div><span className="text-zinc-500 text-xs block uppercase">Mood</span><span className="text-white">{project.lockedConcept?.mood}</span></div>
                <div><span className="text-zinc-500 text-xs block uppercase">Direction</span><span className="text-white">{project.lockedConcept?.conceptDirection}</span></div>
              </div>
              <p className="text-zinc-400 mt-4 text-sm">{project.lockedConcept?.theme}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-lg font-display text-white">Choose a Creative Direction</h3>
              <p className="text-zinc-500 text-sm">Gemini analyzed your song and proposed {project.conceptOptions.length} distinct concepts. Pick one to proceed.</p>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {project.conceptOptions.map((concept, idx) => (
                  <div key={idx} className="glass p-6 rounded-2xl space-y-4 hover:border-accent-500/50 border border-white/5 transition-all group cursor-pointer" onClick={() => !isLoading && onLockConcept(idx)}>
                    <div className="flex items-center justify-between">
                      <span className="text-accent-400 font-bold text-sm uppercase">{concept.conceptDirection}</span>
                      <span className="text-[10px] bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">Option {idx + 1}</span>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs"><span className="text-zinc-500">Deity:</span> <span className="text-white">{concept.deity}</span></div>
                      <div className="text-xs"><span className="text-zinc-500">Mood:</span> <span className="text-white">{concept.mood}</span></div>
                      <p className="text-zinc-300 text-sm leading-relaxed">{concept.theme}</p>
                    </div>
                    <button disabled={isLoading} className="w-full py-2 bg-accent-600/20 text-accent-400 rounded-lg text-xs font-bold border border-accent-500/30 group-hover:bg-accent-600 group-hover:text-white transition-all">
                      {isLoading ? 'Locking...' : 'Choose This Concept'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ PHASE 3: STYLE ═══════════════════ */}
      {viewPhase === 'style' && (
        <div className="space-y-8">
          {isLocked('style') ? (
            <div className="glass p-8 rounded-2xl border border-green-500/20">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-green-400 text-lg">✓</span>
                  <h3 className="text-lg font-display text-white">Locked Style</h3>
                </div>
                {project.status === 'style_locked' && (
                  <button
                    onClick={onUnlockStyle}
                    disabled={isLoading}
                    className="text-xs text-zinc-500 hover:text-red-400 border border-white/10 hover:border-red-500/30 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                  >
                    Unlock & Re-explore
                  </button>
                )}
              </div>
              <div className="flex gap-6 items-start">
                {project.styleAssetUrl && (
                  <img src={project.styleAssetUrl} className="w-64 rounded-xl border border-white/10" />
                )}
                <div className="flex-1">
                  <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">{project.styleDescription}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Brainstorm Controls */}
              <div className="glass p-6 rounded-2xl space-y-4">
                <div>
                  <h3 className="text-lg font-display text-white mb-1">Art Style Exploration</h3>
                  <p className="text-zinc-500 text-sm">
                    Gemini will brainstorm 4 distinct visual directions based on your song's mood, lyrics, and concept.
                    Then you choose which ones to visualize as images.
                  </p>
                </div>

                <div className="flex gap-3">
                  <input
                    value={brainstormNotes}
                    onChange={(e) => setBrainstormNotes(e.target.value)}
                    placeholder="Optional: style preferences... e.g. 'painterly', 'dark and moody', 'Ravi Varma inspired'"
                    className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white outline-none focus:border-accent-500/50"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleBrainstorm(); }}
                  />
                  <button
                    onClick={handleBrainstorm}
                    disabled={isBrainstorming}
                    className="px-6 py-2.5 bg-accent-600 hover:bg-accent-500 rounded-lg text-xs font-bold text-white shadow-lg disabled:opacity-50 whitespace-nowrap"
                  >
                    {isBrainstorming ? 'Thinking...' : styleSlots.length > 0 ? 'Regenerate All' : 'Brainstorm 4 Directions'}
                  </button>
                </div>
              </div>

              {/* Brainstorming spinner */}
              {isBrainstorming && styleSlots.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 space-y-4">
                  <div className="w-12 h-12 border-t-2 border-accent-400 rounded-full animate-spin"></div>
                  <p className="text-zinc-400 animate-pulse text-sm">Brainstorming visual directions...</p>
                </div>
              )}

              {/* Style Direction Cards */}
              {styleSlots.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {styleSlots.map((slot, idx) => (
                    <StyleCard
                      key={`ai-${idx}-${slot.title}`}
                      slot={slot}
                      index={idx}
                      onVisualize={() => handleVisualize(idx)}
                      onLock={() => handleLockSlot(slot)}
                    />
                  ))}

                  {/* User's own slot */}
                  <div className="glass rounded-2xl border border-dashed border-accent-500/30 overflow-hidden flex flex-col">
                    <div className="px-5 pt-5 pb-3">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-display font-medium text-accent-400">Your Vision</h4>
                        <input
                          type="file"
                          ref={fileInputRef}
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files?.[0]) handleUploadReference(e.target.files[0]);
                          }}
                        />
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="text-[10px] bg-zinc-800 hover:bg-zinc-700 px-2 py-0.5 rounded text-zinc-400 border border-white/5"
                        >
                          Upload Image
                        </button>
                      </div>
                      <textarea
                        value={userSlot.description}
                        onChange={(e) => setUserSlot(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Write your own style direction... or upload a reference image above."
                        className="w-full h-24 bg-black/40 border border-white/10 rounded-lg p-3 text-xs text-zinc-300 outline-none focus:border-accent-500/50 resize-none leading-relaxed"
                      />
                    </div>

                    {/* Image area */}
                    <div className="px-5 flex-1">
                      {userSlot.isGenerating ? (
                        <div className="aspect-video rounded-xl bg-zinc-800 animate-pulse border border-white/5 flex items-center justify-center">
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-6 h-6 border-2 border-accent-400/30 border-t-accent-400 rounded-full animate-spin"></div>
                            <span className="text-[10px] text-zinc-500">Generating...</span>
                          </div>
                        </div>
                      ) : userSlot.imageUrl ? (
                        <div className="aspect-video rounded-xl overflow-hidden border border-white/10 relative group">
                          <img src={userSlot.imageUrl} className="w-full h-full object-cover" />
                          {userSlot.assetId && (
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <button
                                onClick={() => handleLockSlot(userSlot)}
                                disabled={isLocking}
                                className="bg-white text-black px-4 py-2 rounded-full text-xs font-bold hover:bg-accent-400 transition-colors disabled:opacity-50"
                              >
                                {isLocking ? 'Locking...' : 'Lock This Style'}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="aspect-video rounded-xl border-2 border-dashed border-white/10 flex items-center justify-center">
                          <span className="text-zinc-700 text-xs">Write a description or upload an image</span>
                        </div>
                      )}
                    </div>

                    {/* Visualize button */}
                    <div className="px-5 py-4">
                      <button
                        onClick={() => handleVisualize(0, true)}
                        disabled={!userSlot.description || userSlot.isGenerating}
                        className="w-full py-2 bg-accent-600/20 hover:bg-accent-600 text-accent-400 hover:text-white rounded-lg text-xs font-bold border border-accent-500/30 transition-all disabled:opacity-30"
                      >
                        {userSlot.isGenerating ? 'Generating...' : userSlot.imageUrl ? 'Re-visualize' : 'Visualize'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Empty state — no brainstorm yet, no slots */}
              {!isBrainstorming && styleSlots.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 space-y-3 text-zinc-600">
                  <p className="text-sm">Hit "Brainstorm 4 Directions" to explore visual styles.</p>
                  <p className="text-xs">Or type your own style preferences first to guide the brainstorm.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ PHASE 4: CHARACTERS & ENVIRONMENTS ═══════════════════ */}
      {viewPhase === 'characters' && (
        <div className="space-y-8">
          {/* ─── Character Look Dev ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Cast List */}
            <div className="lg:col-span-3 space-y-4">
              <div className="glass p-6 rounded-2xl h-full flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-display text-white">Cast</h3>
                  <button onClick={() => onAddCast('New Character', 'Description...')} className="text-xs bg-accent-600 hover:bg-accent-500 text-white px-2 py-1 rounded">+ Add</button>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto custom-scrollbar pr-1">
                  {project.cast.map(member => (
                    <div
                      key={member.id}
                      onClick={() => setActiveCastId(member.id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all flex gap-3 items-center ${
                        activeCastId === member.id ? 'bg-white/10 border-accent-500/50' : 'bg-black/20 border-white/5 hover:bg-white/5'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full bg-zinc-800 overflow-hidden flex-shrink-0 border border-white/10">
                        {member.referenceImageUrl ? (
                          <img src={member.referenceImageUrl} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[10px]">?</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white truncate">{member.name}</div>
                        <div className="text-[10px] text-zinc-500 truncate">{member.referenceImageUrl ? '✓ Look Set' : 'No Look Set'}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* All characters locked? Show proceed button */}
                {project.cast.length > 0 && project.cast.every(c => c.referenceImageUrl) && (
                  <button
                    onClick={onLaunchStudio}
                    className="mt-4 w-full py-2.5 bg-green-600/20 text-green-400 border border-green-500/30 rounded-lg text-xs font-bold hover:bg-green-600 hover:text-white transition-all"
                  >
                    All Characters Locked → Launch Studio
                  </button>
                )}
              </div>
            </div>

            {/* Character Editor */}
            <div className="lg:col-span-9">
              {activeMember ? (
                <div key={activeMember.id} className="glass p-8 rounded-2xl flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-display text-white">Edit: {activeMember.name}</h3>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete "${activeMember.name}"? This cannot be undone.`)) {
                          onDeleteCast(activeMember.id);
                          setActiveCastId(project.cast.find(c => c.id !== activeMember.id)?.id || null);
                        }
                      }}
                      className="text-xs text-zinc-500 hover:text-red-400 border border-white/10 hover:border-red-500/30 px-3 py-1.5 rounded transition-colors"
                    >
                      Delete Character
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-zinc-500">Name</label>
                        <input
                          key={`name-${activeMember.id}`}
                          defaultValue={activeMember.name}
                          onBlur={(e) => onUpdateCast(activeMember.id, { name: e.target.value })}
                          className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white text-sm outline-none focus:border-accent-500/50"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-zinc-500">Visual Description</label>
                        <textarea
                          key={`desc-${activeMember.id}`}
                          defaultValue={activeMember.description}
                          onBlur={(e) => onUpdateCast(activeMember.id, { description: e.target.value })}
                          className="w-full h-28 bg-black/40 border border-white/10 rounded px-3 py-2 text-white text-sm outline-none focus:border-accent-500/50 resize-none"
                        />
                      </div>
                      {/* Feedback for regeneration */}
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-zinc-500">Feedback (optional)</label>
                        <input
                          key={`feedback-${activeMember.id}`}
                          placeholder="e.g. 'make the crown bigger', 'more golden jewelry'"
                          className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white text-xs outline-none focus:border-accent-500/50"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              onGenerateLooks(activeMember.id, (e.target as HTMLInputElement).value || undefined);
                            }
                          }}
                          id={`char-feedback-${activeMember.id}`}
                        />
                      </div>
                      <button
                        onClick={() => {
                          const feedbackEl = document.getElementById(`char-feedback-${activeMember.id}`) as HTMLInputElement;
                          onGenerateLooks(activeMember.id, feedbackEl?.value || undefined);
                        }}
                        disabled={isLoading}
                        className="w-full py-2.5 bg-accent-600 hover:bg-accent-500 text-white rounded text-xs font-bold shadow-lg disabled:opacity-50"
                      >
                        {isLoading ? 'Generating Looks...' : 'Generate 3 Looks'}
                      </button>
                    </div>

                    {/* Current locked look */}
                    {activeMember.referenceImageUrl && (
                      <div className="space-y-2">
                        <span className="text-[10px] uppercase font-bold text-green-400">✓ Locked Reference</span>
                        <div className="aspect-video rounded-xl overflow-hidden border-2 border-green-500/30">
                          <img src={activeMember.referenceImageUrl} className="w-full h-full object-cover" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Look Options */}
                  {isLoading && activeLooks.length === 0 && (
                    <div className="grid grid-cols-3 gap-4">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="aspect-video rounded-xl bg-zinc-800 animate-pulse border border-white/5 flex items-center justify-center">
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-6 h-6 border-2 border-accent-400/30 border-t-accent-400 rounded-full animate-spin"></div>
                            <span className="text-[10px] text-zinc-500">Look {i + 1}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeLooks.length > 0 && (
                    <div className="grid grid-cols-3 gap-4">
                      {activeLooks.map((look) => (
                        <div
                          key={look.id}
                          onClick={() => onLockCharacter(activeMember.id, look.id)}
                          className="cursor-pointer relative aspect-video rounded-xl overflow-hidden group border border-white/10 hover:border-accent-500 transition-all"
                        >
                          <img src={look.url} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <span className="bg-white text-black px-3 py-1 rounded-full text-xs font-bold">Lock This Look</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="glass p-8 rounded-2xl h-full flex items-center justify-center text-zinc-500">
                  Select a cast member to edit.
                </div>
              )}
            </div>
          </div>

          {/* ─── Environment Look Dev ─── */}
          {project.environments.length > 0 && (
            <div className="glass p-8 rounded-2xl">
              <h3 className="text-lg font-display text-white mb-6">Environments</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {project.environments.map(env => (
                  <EnvironmentCard
                    key={env.id}
                    env={env}
                    projectId={project.id}
                    isLoading={isLoading}
                    onProjectUpdate={(p: any) => onSetProject?.(p)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ PHASE 2: SCRIPT ═══════════════════ */}
      {viewPhase === 'script' && (
        <div className="space-y-8">
          {/* Director Settings */}
          <div className="glass p-6 rounded-2xl">
            <div className="flex gap-6 items-center">
              <div className="space-y-2 flex-1">
                <label className="text-[10px] uppercase font-bold text-zinc-500">Director Mode</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => onUpdateProject({ videoMode: 'montage' })}
                    className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all ${project.videoMode === 'montage' ? 'bg-accent-600 border-accent-500 text-white' : 'bg-black/20 border-white/10 text-zinc-400'}`}
                  >
                    Montage
                  </button>
                  <button
                    onClick={() => onUpdateProject({ videoMode: 'cinematic' })}
                    className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all ${project.videoMode === 'cinematic' ? 'bg-accent-600 border-accent-500 text-white' : 'bg-black/20 border-white/10 text-zinc-400'}`}
                  >
                    Cinematic
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold text-zinc-500">Base Pacing</label>
                <div className="flex gap-2">
                  {[5, 8, 10].map(d => (
                    <button
                      key={d}
                      onClick={() => onUpdateProject({ targetDuration: d })}
                      className={`px-4 py-2 rounded border text-xs font-mono ${project.targetDuration === d ? 'bg-accent-600 border-accent-500 text-white' : 'bg-black/40 border-white/10 text-zinc-400'}`}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={onGenerateScript}
                disabled={isLoading}
                className="bg-accent-600 hover:bg-accent-500 text-white px-8 py-3 rounded-lg font-bold shadow-lg disabled:opacity-50 flex items-center gap-3"
              >
                {isLoading && (
                  <div className="w-4 h-4 border-t-2 border-white rounded-full animate-spin"></div>
                )}
                {isLoading ? 'Writing Script...' : project.scenes.length > 0 ? 'Regenerate Script' : 'Generate Script'}
              </button>
            </div>
          </div>

          {/* First gen — no scenes yet */}
          {isLoading && project.scenes.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
              <div className="w-12 h-12 border-t-2 border-accent-400 rounded-full animate-spin"></div>
              <p className="text-zinc-400 animate-pulse">Writing your script...</p>
              <p className="text-zinc-500 text-xs">This takes 10-20 seconds</p>
            </div>
          )}

          {project.scenes.length > 0 && (
            <div className="glass p-8 rounded-2xl relative">
              {/* Regeneration overlay */}
              {isLoading && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm rounded-2xl z-10 flex flex-col items-center justify-center gap-4">
                  <div className="w-10 h-10 border-t-2 border-accent-400 rounded-full animate-spin"></div>
                  <p className="text-zinc-300 font-medium">Rewriting script...</p>
                  <p className="text-zinc-500 text-xs">This takes 10-20 seconds</p>
                </div>
              )}
              <h3 className="text-lg font-display text-white/90 mb-6 flex justify-between items-center">
                <span>Script Breakdown</span>
                <div className="flex items-center gap-4">
                  <button
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
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
                  <span className="text-xs font-mono text-zinc-500">
                    {project.scenes.length} Scenes / {project.scenes.reduce((acc, s) => acc + s.shots.length, 0)} Shots
                  </span>
                </div>
              </h3>
              <div className="space-y-4">
                {project.scenes.map((scene, idx) => {
                  const isExpanded = expandedScenes.has(scene.id);
                  return (
                    <div key={scene.id} className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                      <button
                        className="w-full text-left p-4 flex justify-between items-start hover:bg-white/[0.02] transition-colors"
                        onClick={() => {
                          const next = new Set(expandedScenes);
                          if (isExpanded) next.delete(scene.id); else next.add(scene.id);
                          setExpandedScenes(next);
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <span className="text-accent-400 font-bold font-display uppercase text-sm tracking-wider">Scene {idx + 1}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded border ${
                              scene.sectionLabel.toLowerCase().includes('chorus')
                                ? 'bg-gold-500/20 border-gold-500/50 text-gold-400'
                                : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                            }`}>
                              {scene.sectionLabel}
                            </span>
                            <span className="text-[10px] text-zinc-600">{scene.shots.length} shots</span>
                          </div>
                          <p className="text-zinc-400 text-sm truncate">{scene.narrativeDescription}</p>
                        </div>
                        <div className="flex items-center gap-3 ml-4 shrink-0">
                          <span className="text-xs font-mono text-zinc-600">{scene.startTime} - {scene.endTime}</span>
                          <span className={`text-zinc-500 text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-2 border-t border-white/5 pt-3">
                          {scene.lyrics && (
                            <p className="text-zinc-500 italic text-sm mb-3">"{scene.lyrics}"</p>
                          )}
                          {scene.shots.map((shot, sIdx) => (
                            <div key={shot.id} className="flex gap-4 p-3 bg-black/40 rounded border border-white/5">
                              <div className="text-xs font-mono text-zinc-600 w-6 pt-0.5 shrink-0">S{sIdx + 1}</div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm text-zinc-300 mb-1">{shot.visualPrompt || '—'}</div>
                                {shot.motionPrompt && (
                                  <div className="text-xs text-zinc-500 mb-1">{shot.motionPrompt}</div>
                                )}
                                <div className="text-xs text-zinc-600 flex gap-3">
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
            <div className="flex flex-col items-center justify-center h-64 space-y-4 text-zinc-500">
              <p>Hit "Generate Script" to create a cinematic shot list from your locked concept, style, and characters.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
