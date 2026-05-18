
import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ApiProject, StylePreset } from '../types';
import * as api from '../services/api';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { Markdown } from './Markdown';
import { UnlockPill } from './UnlockPill';
import { Phase, isLockedPhase } from './BlueprintContextBar';

// ─── Style Slot ────────────────────────────────────────────────
interface StyleSlot {
  title: string;
  description: string;
  imageUrl?: string;
  assetId?: string;
  isGenerating?: boolean;
  isRefining?: boolean;
}

// StyleRow at module scope — prevents unmount/remount flicker on parent re-renders.
interface StyleRowProps {
  slot: StyleSlot;
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

            <details className="group">
              <summary className="text-[11px] uppercase tracking-wide text-zinc-500 cursor-pointer hover:text-zinc-400 transition-colors">
                View generation prompt
              </summary>
              <pre className="mt-2 surface-inset rounded-md p-3 text-xs text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed">
{`Cinematic film still showcasing a specific visual style. ${slot.description}. The scene evokes the world of ${slot.title}. Focus entirely on lighting, atmosphere, color, texture, and visual style. High production value, no text, no watermark.

Avoid: overly AI/CGI look, excessive intricate details, generic fantasy aesthetic. Should feel like a real film frame.`}
              </pre>
            </details>

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

// ─── Props ────────────────────────────────────────────────────
interface Props {
  project: ApiProject;
  isLoading: boolean;
  phaseTransition: Record<string, any>;
  onLockStyle: (assetId: string, styleDescription?: string) => void;
  onUnlockStyle: () => void;
  onUpdateProject: (updates: Record<string, any>) => void;
  onSetProject?: (project: ApiProject) => void;
  onSetViewPhase: (phase: Phase) => void;
  onOpenModal: (url: string) => void;
  showActionError: (msg: string) => void;
}

export const StylePhase: React.FC<Props> = ({
  project, isLoading, phaseTransition,
  onLockStyle, onUnlockStyle, onUpdateProject, onSetProject, onSetViewPhase, onOpenModal, showActionError,
}) => {
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const styleDirectUploadRef = useRef<HTMLInputElement>(null);
  // Curated style presets — fetched once per project mount.
  // Flow: artist clicks "Use this style" on a preset → backend points a new
  // project-scoped asset row at the preset's curated file_path and locks
  // directly. No visualization step — the preset IS the style image, and
  // re-rendering it from description text just bled "warm hues" pollution
  // into every project (the old visualize path was generating fresh from
  // prose, never reading the curated file). Downstream-stale logic is
  // identical to onLockStyle.
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [presetLockingKey, setPresetLockingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getStylePresets(project.id)
      .then(r => { if (!cancelled) setPresets(r.presets || []); })
      .catch(() => { if (!cancelled) setPresets([]); });
    return () => { cancelled = true; };
  }, [project.id]);

  const handleLockPreset = async (preset: StylePreset) => {
    if (presetLockingKey) return;
    setPresetLockingKey(preset.key);
    try {
      // Locks the curated preset image directly — no description text is
      // stored on the project (the image carries everything downstream
      // needs; buildCharacterPrompt and friends only reference the image).
      const updated = await api.lockStylePreset(project.id, preset.key);
      if (onSetProject) onSetProject(updated);
    } catch (err: any) {
      showActionError(`Preset lock failed: ${err.message}`);
    } finally {
      setPresetLockingKey(null);
    }
  };

  // Auto-persist style exploration to DB
  const styleExplorationInitRef = useRef(true);
  useEffect(() => {
    if (styleExplorationInitRef.current) {
      styleExplorationInitRef.current = false;
      return;
    }
    if (styleSlots.length === 0 && !userSlot.description) return;
    const timer = setTimeout(() => {
      // presetSlots is intentionally NOT persisted here anymore — presets no
      // longer have a per-project visualize cache (lock is direct from the
      // curated file). Legacy presetSlots data on existing projects is
      // preserved by the server-side merge in PATCH /projects/:id.
      const payload = {
        slots: styleSlots.filter(s => !s.isGenerating && !s.isRefining).map(s => ({ title: s.title, description: s.description, imageUrl: s.imageUrl, assetId: s.assetId })),
        userSlot: userSlot.description ? { title: userSlot.title, description: userSlot.description, imageUrl: userSlot.imageUrl, assetId: userSlot.assetId } : undefined,
      };
      api.updateProject(project.id, { styleExploration: payload }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [styleSlots, userSlot, project.id]);

  // ─── Handlers ─────────────────────────────────────────────

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

  // Preset grid — shared between the fully-unlocked branch and the
  // locked-Explorer view so the artist can swap to another preset
  // without first issuing a real /unlock-style. One-click lock: the
  // curated preset image IS the style image; we don't re-render it.
  const presetGridSection = presets.length > 0 ? (
    <div className="surface rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-sm font-medium text-white mb-1">Curated Styles</h3>
        <p className="text-zinc-400 text-xs">
          Pick a curated style frame. Click "Use this style" to lock it as your project style — the image becomes the visual ground truth for every shot, character, and environment.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {presets.map(preset => {
          const isLocking = presetLockingKey === preset.key;
          const anyBusy = !!presetLockingKey || isLocking;
          return (
            <div
              key={preset.key}
              className="surface-inset rounded-lg overflow-hidden border border-transparent hover:border-white/[0.08] transition-colors"
            >
              {/* Image — clickable to zoom. Curated anchor; never per-project. */}
              <div
                className="relative aspect-video bg-black/30 cursor-zoom-in group"
                onClick={() => preset.previewImageUrl && onOpenModal(preset.previewImageUrl)}
              >
                {preset.previewImageUrl ? (
                  <img
                    src={preset.previewImageUrl}
                    alt={preset.title}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[11px] text-zinc-500">
                    No preview
                  </div>
                )}
                {isLocking && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />
                  </div>
                )}
              </div>

              {/* Title + description. Description is for the artist's
                  selection — it is NOT stored on the project or sent to any
                  downstream model. */}
              <div className="px-4 py-3 space-y-1.5">
                <div className="text-sm font-medium text-white">{preset.title}</div>
                <p className="text-xs text-zinc-400 leading-relaxed">{preset.description}</p>
              </div>

              {/* Action — single button, locks immediately. */}
              <div className="px-4 pb-4">
                <button
                  type="button"
                  onClick={() => handleLockPreset(preset)}
                  disabled={anyBusy}
                  className="w-full px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {isLocking && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />}
                  {isLocking ? 'Locking…' : 'Use this style'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <motion.div key="style" {...phaseTransition} className="space-y-6">
      {isLockedPhase(project, 'style', project.status) ? (
        <div className="space-y-5">
          {!showExploredStyles ? (
            /* ── Locked style overview ── */
            <div className="rounded-xl overflow-hidden border border-white/[0.06]">
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

              <div className="flex flex-col md:flex-row">
                {project.styleAssetUrl && (
                  <div className="md:w-2/5 flex-shrink-0 bg-black/20 cursor-zoom-in" onClick={() => onOpenModal(project.styleAssetUrl!)}>
                    <img src={project.styleAssetUrl} alt="Locked style" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex-1 px-5 py-4 space-y-4">
                  <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Style DNA</h4>
                  <Markdown>{project.styleDescription || ''}</Markdown>
                  {project.status === 'style_locked' && (
                    <button
                      onClick={() => onSetViewPhase('characters')}
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
            /* ── Explorer view ── */
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

              {project.styleAssetUrl && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-white/[0.06]">
                  <img src={project.styleAssetUrl} alt="Current style" className="w-16 h-16 rounded-md object-cover cursor-zoom-in" onClick={() => onOpenModal(project.styleAssetUrl!)} />
                  <div>
                    <span className="text-xs text-zinc-400">Current locked style</span>
                    <p className="text-sm text-zinc-300 line-clamp-1 mt-0.5">{project.styleDescription?.slice(0, 80)}…</p>
                  </div>
                </div>
              )}

              {presetGridSection}

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
                      onOpenModal={onOpenModal}
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
          {presetGridSection}

          <div className="surface rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-medium text-white mb-1">Art Style Exploration</h3>
              <p className="text-zinc-400 text-xs">
                Or brainstorm 4 custom visual directions and pick one to visualize.
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
                  onOpenModal={onOpenModal}
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
                          <img src={userSlot.imageUrl} className="w-full h-auto max-h-[400px] object-contain mx-auto cursor-zoom-in" onClick={() => onOpenModal(userSlot.imageUrl!)} />
                          <button
                            onClick={(e) => { e.stopPropagation(); onOpenModal(userSlot.imageUrl!); }}
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
  );
};
