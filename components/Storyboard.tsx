
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { VideoScene, VideoShot, GenerationStatus, ApiProject } from '../types';
import { ImageModal } from './ImageModal';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { ShotVideoPreview } from './ShotVideoPreview';
import { getShotHistory, revertShotFrame, revertShotEndFrame, lockAllSceneShots, unlockAllSceneShots } from '../services/api';
import type { VersionEntry } from '../services/api';
import { getVideoModel } from '../constants/videoModels';

type HistoryData = { firstFrame: VersionEntry[]; lastFrame: VersionEntry[]; video: VersionEntry[] };

// "0:32" / "00:32" / "1:23:45" → seconds. Guards against undefined / junk.
const parseTimeToSec = (t?: string): number => {
  if (!t) return 0;
  const parts = t.split(':').map(Number);
  if (parts.some(n => Number.isNaN(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] || 0;
};

const fmtTime = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

interface Props {
  scenes: VideoScene[];
  project: ApiProject | null;
  activeSceneIdx: number;
  onSceneChange: (idx: number) => void;
  onUpdateShot: (sceneId: string, shotId: string, updates: Partial<VideoShot>) => void;
  onGenerateImage: (sceneId: string, shotId: string) => void;
  onGenerateVideo: (sceneId: string, shotId: string, promptOverride?: string) => void;
  onLockShot: (sceneId: string, shotId: string) => void;
  onRefinePrompt: (sceneId: string, shotId: string, feedback: string, referenceImage?: File) => void;
  onUpdateProject?: (updates: Record<string, any>) => void;
  onRewriteShotPrompts?: (userNote?: string) => void;
  onBulkGenerateFrames?: () => Promise<void> | void;
  onBulkGenerateVideos?: () => Promise<void> | void;
  onCancelShotImage?: (shotId: string) => void;
  onCancelShotVideo?: (shotId: string) => void;
  onUsePrevLastFrame?: (shotId: string) => void;
  onClearShotFrame?: (shotId: string) => void;
  onRevertVideo?: (shotId: string, assetId: string) => void | Promise<void>;
  onUseAsPrevEnd?: (shotId: string) => void | Promise<void>;
  onGenerateEndFrame?: (shotId: string) => void | Promise<void>;
  onClearEndFrame?: (shotId: string) => void | Promise<void>;
  onClearExtractedFrame?: (shotId: string) => void | Promise<void>;
  onUploadEndFrame?: (shotId: string, file: File) => void | Promise<void>;
  onRefineEndFramePrompt?: (shotId: string, feedback: string) => void | Promise<void>;
  onRefineVideoPrompt?: (shotId: string, feedback: string) => void | Promise<void>;
  onUploadShotRef?: (shotId: string, file: File) => void | Promise<void>;
  onDeleteShotRef?: (shotId: string, assetId: string) => void | Promise<void>;
  onSetProject?: (project: ApiProject) => void;
  /** Shot IDs waiting for a bulk-frame worker (ordered — position = Nth in line). */
  frameQueue?: string[];
  /** Shot IDs waiting for a bulk-video worker (ordered). */
  videoQueue?: string[];
  isLoading?: boolean;
}

export const Storyboard: React.FC<Props> = ({ scenes, project, activeSceneIdx, onSceneChange, onUpdateShot, onGenerateImage, onGenerateVideo, onLockShot, onRefinePrompt, onUpdateProject, onRewriteShotPrompts, onBulkGenerateFrames, onBulkGenerateVideos, onCancelShotImage, onCancelShotVideo, onUsePrevLastFrame, onClearShotFrame, onRevertVideo, onUseAsPrevEnd, onGenerateEndFrame, onClearEndFrame, onClearExtractedFrame, onUploadEndFrame, onRefineEndFramePrompt, onRefineVideoPrompt, onUploadShotRef, onDeleteShotRef, onSetProject, frameQueue, videoQueue, isLoading }) => {
  const [showFrames, setShowFrames] = useState<Record<string, boolean>>({});
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [promptTab, setPromptTab] = useState<Record<string, 'image' | 'endframe' | 'video' | 'compiled'>>({});
  const [videoOverride, setVideoOverride] = useState<Record<string, string>>({});
  const [bulkNote, setBulkNote] = useState('');
  // Set of expanded shot ids so multiple shots can be open at once across
  // scenes. The artist often jumps between scenes (review a locked shot
  // while editing a new one) — auto-collapsing on tab switch killed context.
  const [expandedShotIds, setExpandedShotIds] = useState<Set<string>>(new Set());
  const [contextPopover, setContextPopover] = useState<'story' | 'prompts' | null>(null);
  const contextBarRef = React.useRef<HTMLDivElement>(null);
  const [historyOpenFor, setHistoryOpenFor] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<HistoryData>({ firstFrame: [], lastFrame: [], video: [] });
  const [historyTab, setHistoryTab] = useState<'firstFrame' | 'lastFrame' | 'video'>('firstFrame');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [mentionOpen, setMentionOpen] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const endFrameFileRef = React.useRef<HTMLInputElement>(null);
  const [endFrameUploadTarget, setEndFrameUploadTarget] = useState<string | null>(null);
  // Reference image attached to refine feedback (per shot)
  const [refineImage, setRefineImage] = useState<Record<string, File>>({});
  // Track if prompt was edited since last generate (per shot+tab)
  const [promptDirty, setPromptDirty] = useState<Record<string, boolean>>({});

  const modelSupportsLastFrame = getVideoModel(project?.videoModel).supportsLastFrame;

  // Solo-play: when any <video> on the page starts playing, pause every other
  // one. `play` does not bubble, so we listen in the capture phase.
  React.useEffect(() => {
    const onPlay = (e: Event) => {
      const target = e.target;
      if (!(target instanceof HTMLVideoElement)) return;
      document.querySelectorAll('video').forEach(v => {
        if (v !== target && !v.paused) v.pause();
      });
    };
    document.addEventListener('play', onPlay, true);
    return () => document.removeEventListener('play', onPlay, true);
  }, []);

  const openHistory = async (shotId: string) => {
    if (!project) return;
    if (historyOpenFor === shotId) { setHistoryOpenFor(null); return; }
    setHistoryOpenFor(shotId);
    setHistoryTab('firstFrame');
    setHistoryLoading(true);
    try {
      const data = await getShotHistory(project.id, shotId);
      setHistoryData(data);
    } catch {
      setHistoryData({ firstFrame: [], lastFrame: [], video: [] });
    } finally {
      setHistoryLoading(false);
    }
  };

  // Auto-expand the first actionable unlocked shot the first time a project
  // loads, so the Studio isn't a wall of closed cards.
  React.useEffect(() => {
    if (expandedShotIds.size > 0) return;
    const firstUnlocked = scenes.flatMap(s => s.shots).find(s => !s.locked);
    if (firstUnlocked) setExpandedShotIds(new Set([firstUnlocked.id]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes.length]);

  // Close popovers on outside click / Escape — same pattern as Blueprint.
  React.useEffect(() => {
    if (!contextPopover) return;
    const onDown = (e: MouseEvent) => {
      if (contextBarRef.current && !contextBarRef.current.contains(e.target as Node)) setContextPopover(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextPopover(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [contextPopover]);

  const toggleExpanded = (shotId: string) => {
    setExpandedShotIds(prev => {
      const next = new Set(prev);
      if (next.has(shotId)) next.delete(shotId); else next.add(shotId);
      return next;
    });
  };

  // A shot is actionable immediately if it's a hard cut (independent).
  // Only continuity-linked shots ('prev_shot') wait for the previous shot
  // to generate its video so we can extract the real last frame.
  const isShotActionable = (scene: VideoScene, shotIdx: number): boolean => {
    const shot = scene.shots[shotIdx];
    if (shotIdx === 0) return true;
    if (shot?.continuityFrom !== 'prev_shot') return true;
    const prevShot = scene.shots[shotIdx - 1];
    return !!prevShot?.videoUrl; // wait for video (so extracted frame exists)
  };

  if (scenes.length === 0) return null;

  const hasBulkPrompt = !!project?.lastWriteShotsPrompt;
  const totalShots = scenes.reduce((acc, s) => acc + s.shots.length, 0);
  const lockedShots = scenes.reduce((acc, s) => acc + s.shots.filter(x => x.locked).length, 0);
  const videoShots = scenes.reduce((acc, s) => acc + s.shots.filter(x => !!x.videoUrl).length, 0);
  const frameShots = scenes.reduce((acc, s) => acc + s.shots.filter(x => !!x.imageUrl).length, 0);
  const concept = project?.lockedConcept;

  // Counts for bulk actions — match the eligibility rules in App.tsx handlers.
  // Chain-waiting shots are queued (not counted) until their predecessor's
  // video lands and its extracted frame is available.
  const missingPromptCount = scenes.reduce(
    (acc, s) => acc + s.shots.filter(x => !x.visualPrompt || !x.visualPrompt.trim()).length,
    0
  );
  const framesToFire = scenes.reduce((acc, s) => {
    return acc + s.shots.filter((shot, idx) => {
      if (shot.imageUrl) return false;
      if (shot.imageStatus === GenerationStatus.LOADING) return false;
      if (shot.continuityFrom === 'prev_shot' && idx > 0) {
        const prev = s.shots[idx - 1];
        if (!prev?.videoUrl) return false;
      }
      return true;
    }).length;
  }, 0);
  const videosToFire = scenes.reduce((acc, s) => {
    return acc + s.shots.filter((shot, idx) => {
      if (!shot.imageUrl || shot.videoUrl) return false;
      if (shot.videoStatus === GenerationStatus.LOADING) return false;
      if (shot.continuityFrom === 'prev_shot' && idx > 0) {
        const prev = s.shots[idx - 1];
        if (!prev?.videoUrl) return false;
      }
      return true;
    }).length;
  }, 0);
  // Chain shots that are queued waiting on a predecessor's video —
  // surface this count so the artist knows the queue will drain on its own.
  const chainWaitingCount = scenes.reduce((acc, s) => {
    return acc + s.shots.filter((shot, idx) => {
      if (shot.imageUrl || idx === 0) return false;
      if (shot.continuityFrom !== 'prev_shot') return false;
      const prev = s.shots[idx - 1];
      return !prev?.videoUrl;
    }).length;
  }, 0);

  return (
    <div className="max-w-5xl mx-auto pb-32">
      {/* ─── Sticky context bar ─────────────────────────────────────
          Replaces the earlier three stacked surfaces (pipeline row,
          story summary, scene tabs, master-prompts). Consolidates the
          scene selector, progress, story popover, master-prompt popover,
          and the three bulk actions into one always-visible strip. */}
      <div ref={contextBarRef} className="sticky top-0 z-40 mb-6">
        <div className="surface rounded-xl border border-white/[0.06] bg-[#141418] shadow-md shadow-black/15 px-4 py-2.5 flex items-center gap-2 flex-wrap">
          {/* Scene pills — jump to anchor, keep all scenes visible. */}
          <div className="flex items-center gap-1 overflow-x-auto mr-auto">
            {scenes.map((s, i) => {
              const sceneVideoCount = s.shots.filter(x => !!x.videoUrl).length;
              const sceneFrameCount = s.shots.filter(x => !!x.imageUrl).length;
              const done = sceneVideoCount === s.shots.length && s.shots.length > 0;
              const inProgress = sceneVideoCount > 0 && !done;
              const isActive = i === activeSceneIdx;
              const dotClass = done ? 'bg-white' : inProgress ? 'bg-amber-400/80' : sceneFrameCount > 0 ? 'bg-white/50' : 'bg-white/15';
              const lockableShots = s.shots.filter(x => x.imageUrl && x.videoUrl);
              const lockedCount = s.shots.filter(x => x.locked).length;
              const allLocked = lockableShots.length > 0 && lockedCount === lockableShots.length;
              return (
                <div key={s.id} className="flex items-center gap-0 flex-shrink-0">
                  <button
                    onClick={() => {
                      onSceneChange(i);
                      const el = document.getElementById(`scene-${s.id}`);
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className={`px-2.5 py-1 rounded-l-md text-[11px] font-medium transition-colors flex items-center gap-1.5 border border-r-0 ${
                      isActive
                        ? 'bg-white/[0.08] text-white border-white/[0.12]'
                        : 'bg-transparent text-zinc-300 border-white/[0.04] hover:bg-white/[0.04]'
                    }`}
                    title={`Scene ${i + 1} · ${s.shots.length} shot${s.shots.length === 1 ? '' : 's'} · ${sceneVideoCount}/${s.shots.length} videos`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
                    <span className="font-mono">S{i + 1}</span>
                  </button>
                  {lockableShots.length > 0 && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!project) return;
                        try {
                          if (allLocked) {
                            await unlockAllSceneShots(project.id, s.id);
                            s.shots.forEach(sh => onUpdateShot(s.id, sh.id, { locked: false }));
                          } else {
                            const result = await lockAllSceneShots(project.id, s.id);
                            s.shots.forEach(sh => {
                              if (sh.imageUrl && sh.videoUrl) onUpdateShot(s.id, sh.id, { locked: true });
                            });
                          }
                        } catch (err: any) {
                          console.error('Scene lock/unlock failed:', err);
                        }
                      }}
                      className={`px-1.5 py-1 rounded-r-md text-[11px] transition-colors border ${
                        isActive ? 'border-white/[0.12]' : 'border-white/[0.04]'
                      } ${allLocked ? 'text-white/60 hover:text-amber-400/80 bg-white/[0.04]' : 'text-zinc-500 hover:text-white/60 bg-transparent hover:bg-white/[0.04]'}`}
                      title={allLocked ? `Unlock all ${lockedCount} shots in scene ${i + 1}` : `Lock ${lockableShots.length - lockedCount} ready shots in scene ${i + 1}`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        {allLocked ? (
                          <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>
                        ) : (
                          <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>
                        )}
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Compact progress — one glance, no decorative headers. */}
          <span className="text-[11px] text-zinc-400 font-mono tabular-nums">
            <span className="text-white">{frameShots}</span>/{totalShots}f · <span className="text-white">{videoShots}</span>/{totalShots}v
            {lockedShots > 0 && <> · <span className="text-white">{lockedShots}</span>/{totalShots} locked</>}
            {chainWaitingCount > 0 && <> · <span className="text-amber-400/80">{chainWaitingCount} wait</span></>}
          </span>

          {/* Story popover — concept context available on demand. */}
          {concept && (
            <div className="relative">
              <button
                onClick={() => setContextPopover(p => p === 'story' ? null : 'story')}
                className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${contextPopover === 'story' ? 'bg-white/[0.08] text-white border-white/[0.12]' : 'text-zinc-300 border-white/[0.04] hover:bg-white/[0.04]'}`}
                title="Concept summary"
              >
                Story
              </button>
              {contextPopover === 'story' && (
                <div className="absolute top-full right-0 mt-2 w-96 bg-zinc-900 border border-white/[0.08] rounded-xl p-4 shadow-2xl z-30 space-y-2">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-400">
                    <span>Story</span>
                    {concept.deity && <><span>·</span><span className="text-zinc-300 normal-case tracking-normal">{concept.deity}</span></>}
                    {concept.mood && <><span>·</span><span className="text-zinc-300 normal-case tracking-normal">{concept.mood}</span></>}
                  </div>
                  <p className="text-sm text-zinc-300 leading-relaxed">{concept.conceptDirection || concept.theme}</p>
                  {concept.conceptDirection && concept.theme && concept.theme !== concept.conceptDirection && (
                    <p className="text-sm text-zinc-400 leading-relaxed">{concept.theme}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Master shot-prompts popover — rewrite-all with note is tucked
              here so it doesn't dominate the Studio at rest. */}
          {onRewriteShotPrompts && hasBulkPrompt && (
            <div className="relative">
              <button
                onClick={() => setContextPopover(p => p === 'prompts' ? null : 'prompts')}
                className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${contextPopover === 'prompts' ? 'bg-white/[0.08] text-white border-white/[0.12]' : 'text-zinc-300 border-white/[0.04] hover:bg-white/[0.04]'}`}
                title="Master shot-prompts — view or rewrite with a note"
              >
                Prompts
              </button>
              {contextPopover === 'prompts' && (
                <div className="absolute top-full right-0 mt-2 w-[28rem] bg-zinc-900 border border-white/[0.08] rounded-xl p-4 shadow-2xl z-30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wide text-zinc-400">Rewrite all shot prompts</span>
                    <button
                      onClick={() => { onRewriteShotPrompts(bulkNote || undefined); setBulkNote(''); setContextPopover(null); }}
                      disabled={isLoading}
                      className="text-[11px] bg-white text-black rounded-md px-3 py-1.5 font-medium hover:bg-zinc-200 disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                      {isLoading && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>}
                      {isLoading ? 'Rewriting…' : 'Rewrite all'}
                    </button>
                  </div>
                  <AutoGrowTextarea
                    value={bulkNote}
                    onChange={e => setBulkNote(e.target.value)}
                    placeholder="Rewrite note — e.g. 'more deity close-ups', 'reduce camera motion'"
                    rows={1}
                    className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.metaKey && !e.shiftKey && bulkNote.trim() && !isLoading) {
                        e.preventDefault();
                        onRewriteShotPrompts(bulkNote); setBulkNote(''); setContextPopover(null);
                      }
                    }}
                  />
                  <details className="text-[11px] text-zinc-400">
                    <summary className="cursor-pointer hover:text-zinc-300">View current master prompt</summary>
                    <pre className="mt-2 surface-inset rounded-md p-3 text-[11px] text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed max-h-64 overflow-auto">{project?.lastWriteShotsPrompt}</pre>
                  </details>
                </div>
              )}
            </div>
          )}

          {/* Three bulk actions — the primary CTAs. */}
          <button
            onClick={() => onRewriteShotPrompts?.(undefined)}
            disabled={isLoading || !onRewriteShotPrompts || totalShots === 0}
            className="text-[11px] bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white border border-white/[0.06] rounded-md px-2.5 py-1 transition-colors disabled:opacity-40 flex items-center gap-1.5"
            title={missingPromptCount > 0 ? `${missingPromptCount} missing — also rewrites existing.` : 'Rewrite every shot prompt from scratch.'}
          >
            {isLoading && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>}
            Write prompts{missingPromptCount > 0 && <span className="text-zinc-400">({missingPromptCount})</span>}
          </button>
          <button
            onClick={() => onBulkGenerateFrames?.()}
            disabled={!onBulkGenerateFrames || framesToFire === 0}
            className="text-[11px] bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white border border-white/[0.06] rounded-md px-2.5 py-1 transition-colors disabled:opacity-40 flex items-center gap-1.5"
            title={framesToFire > 0 ? `Fire ${framesToFire} start frame${framesToFire === 1 ? '' : 's'} in parallel.` : 'All eligible frames generated.'}
          >
            Frames <span className="text-zinc-400">({framesToFire})</span>
          </button>
          <button
            onClick={() => onBulkGenerateVideos?.()}
            disabled={!onBulkGenerateVideos || videosToFire === 0}
            className="text-[11px] bg-white text-black hover:bg-zinc-100 rounded-md px-2.5 py-1 font-medium transition-colors disabled:opacity-40 flex items-center gap-1.5"
            title={videosToFire > 0 ? `Fire ${videosToFire} video${videosToFire === 1 ? '' : 's'} in parallel.` : 'Generate frames first.'}
          >
            Videos <span className="opacity-70">({videosToFire})</span>
          </button>
        </div>
      </div>

      {/* Stacked scene list — all scenes visible, each with its own header
          and shots. Switching tabs scrolls; nothing collapses. */}
      <div className="space-y-12">
      {scenes.map((scene, sceneIdx) => {
        // Preserve existing variable names inside the scene body so we don't
        // have to rename ~500 lines of JSX.
        const activeScene = scene;
        const activeSceneIdx = sceneIdx;
        return (
        <motion.div
          key={scene.id}
          id={`scene-${scene.id}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6 scroll-mt-20"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-display font-medium text-white">Scene {activeSceneIdx + 1}</h2>
              <span className="text-xs text-zinc-400 font-mono">{activeScene.startTime}–{activeScene.endTime}</span>
              <span className="text-xs text-zinc-400">{activeScene.sectionLabel}</span>
            </div>
            {activeScene.narrativeDescription && (
              <p className="text-sm text-zinc-400 max-w-3xl">{activeScene.narrativeDescription}</p>
            )}
          </div>

          {/* Vertical Shot List */}
          <div className="space-y-4">
            {activeScene.shots.map((shot, shotIdx) => {
              const actionable = isShotActionable(activeScene, shotIdx);
              const isGenerating = shot.imageStatus === GenerationStatus.LOADING || shot.videoStatus === GenerationStatus.LOADING || shot.imageStatus === GenerationStatus.CRITIQUING;
              const isError = shot.imageStatus === GenerationStatus.ERROR || shot.videoStatus === GenerationStatus.ERROR;
              const activeCastMembers = project?.cast.filter(c => shot.castIds?.includes(c.id)) || [];
              const hasStartFrame = !!shot.imageUrl;
              const hasVideo = !!shot.videoUrl;
              const canGenerateVideo = hasStartFrame && !isGenerating;
              const canLock = hasStartFrame && hasVideo && !shot.locked;

              // Progress dots: Frame → Video → Locked
              const progress = shot.locked ? 3 : hasVideo ? 2 : hasStartFrame ? 1 : 0;
              const isExpanded = expandedShotIds.has(shot.id);

              return (
                <motion.div
                  key={shot.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: shotIdx * 0.03 }}
                  className={`rounded-xl overflow-hidden border transition-all ${
                    !actionable ? 'opacity-40 border-white/[0.03]'
                      : shot.locked ? 'border-white/[0.08]'
                      : 'border-white/[0.05]'
                  }`}
                >
                  {/* Header — click to expand/collapse */}
                  <div
                    className={`px-4 py-2.5 flex items-center gap-3 bg-white/[0.01] ${isExpanded ? '' : 'hover:bg-white/[0.03] cursor-pointer'}`}
                    onClick={(e) => {
                      // Don't toggle when user clicks a button/input inside the header
                      const tag = (e.target as HTMLElement).closest('button, select, input, textarea, a');
                      if (tag) return;
                      toggleExpanded(shot.id);
                    }}
                  >
                    {/* Chevron */}
                    <svg
                      xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      className={`text-zinc-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      aria-hidden="true"
                    ><polyline points="9 18 15 12 9 6"/></svg>

                    {/* Left: shot info */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="text-sm font-medium text-white flex-shrink-0">{shotIdx + 1}</span>

                      {/* Timestamp — absolute position in the song */}
                      <span className="text-[11px] font-mono text-zinc-400 flex-shrink-0 tabular-nums">
                        {(() => {
                          const sceneStartSec = parseTimeToSec(activeScene.startTime);
                          const shotOffset = activeScene.shots.slice(0, shotIdx).reduce((a, s) => a + (s.duration || 0), 0);
                          return fmtTime(sceneStartSec + shotOffset);
                        })()}
                        <span className="text-zinc-500 ml-1">[{shot.duration}s]</span>
                      </span>

                      {/* Progress dots */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {[1, 2, 3].map(step => (
                          <div key={step} className={`w-1.5 h-1.5 rounded-full transition-colors ${
                            step <= progress ? 'bg-white' : 'bg-white/[0.1]'
                          }`} />
                        ))}
                      </div>

                      {activeCastMembers.length > 0 && (
                        <span className="text-sm text-zinc-300 truncate">{activeCastMembers.map(c => c.name).join(', ')}</span>
                      )}

                      {shotIdx > 0 && (
                        <button
                          onClick={() => onUpdateShot(activeScene.id, shot.id, { continuityFrom: shot.continuityFrom === 'prev_shot' ? 'cut' : 'prev_shot' } as any)}
                          className={`text-[11px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded transition-colors flex-shrink-0 ${
                            shot.continuityFrom === 'prev_shot'
                              ? 'text-amber-400/80 bg-amber-500/10'
                              : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                          }`}
                        >
                          {shot.continuityFrom === 'prev_shot' ? 'chain' : 'cut'}
                        </button>
                      )}

                      {shot.videoStatus === GenerationStatus.STALE && (
                        <span
                          className="text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 flex-shrink-0"
                          title="The previous video is out of sync with the end keyframe set by the next shot. Regenerate to land on that frame."
                        >
                          stale
                        </span>
                      )}

                      {shot.refinedFromPrevFrame && (
                        <span
                          className="text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-300 flex-shrink-0"
                          title="Prompt was auto-rewritten by Claude after seeing the previous shot's actual last frame — grounded continuity."
                        >
                          refined
                        </span>
                      )}

                      {/* Bulk-queue position — surfaces "Nth in line" while a
                          bulk gen worker hasn't picked this shot up yet. Frames
                          or video pulls whichever applies (exclusive because
                          the handler skips shots already generating the other). */}
                      {(() => {
                        const framePos = frameQueue?.indexOf(shot.id) ?? -1;
                        const videoPos = videoQueue?.indexOf(shot.id) ?? -1;
                        if (framePos < 0 && videoPos < 0) return null;
                        const kind = framePos >= 0 ? 'frame' : 'video';
                        const pos = framePos >= 0 ? framePos + 1 : videoPos + 1;
                        const ordinal = pos === 1 ? '1st' : pos === 2 ? '2nd' : pos === 3 ? '3rd' : `${pos}th`;
                        return (
                          <span
                            className="text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-300 flex-shrink-0 font-mono"
                            title={`Queued for bulk ${kind} generation — ${ordinal} in line.`}
                          >
                            queued · {ordinal}
                          </span>
                        );
                      })()}

                      {!actionable && !shot.imageUrl && (
                        <span
                          className="text-[11px] uppercase tracking-wide text-zinc-400 flex-shrink-0"
                          title="Waiting on previous shot's video (continuity chain)"
                        >
                          queued
                        </span>
                      )}
                    </div>

                    {/* Right: actions — one consistent toolbar, icons + tooltips */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* Video/Frames toggle — only when video exists */}
                      {shot.videoUrl && (
                        <div className="flex gap-px bg-white/[0.04] rounded overflow-hidden mr-2">
                          <button
                            onClick={() => setShowFrames(prev => ({ ...prev, [shot.id]: false }))}
                            className={`text-[11px] px-2 py-1 font-medium transition-colors ${!showFrames[shot.id] ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
                            title="Show video"
                          >Video</button>
                          <button
                            onClick={() => setShowFrames(prev => ({ ...prev, [shot.id]: true }))}
                            className={`text-[11px] px-2 py-1 font-medium transition-colors ${showFrames[shot.id] ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
                            title="Show start + end frames"
                          >Frames</button>
                        </div>
                      )}

                      {/* History — lets the artist revert to an earlier generation
                          after a regen they didn't like. */}
                      {shot.videoUrl && (
                        <button
                          onClick={() => openHistory(shot.id)}
                          className={`w-7 h-7 rounded-md transition-colors flex items-center justify-center ${historyOpenFor === shot.id ? 'text-white bg-white/[0.1]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`}
                          title="Version history — revert to an earlier generation"
                          aria-label="Version history"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>
                            <path d="M3 3v5h5"/>
                            <path d="M12 7v5l3 2"/>
                          </svg>
                        </button>
                      )}

                      {/* Sleek icon-only toolbar — tooltip carries the label.
                          Three 28px buttons, tight spacing, monochrome. */}
                      <button
                        onClick={() => onGenerateImage(activeScene.id, shot.id)}
                        disabled={isGenerating || (!actionable && !shot.locked)}
                        className="w-7 h-7 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-30 flex items-center justify-center"
                        title={hasStartFrame ? 'Regenerate start frame' : 'Generate start frame'}
                        aria-label={hasStartFrame ? 'Regenerate start frame' : 'Generate start frame'}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                          <circle cx="9" cy="9" r="2"/>
                          <path d="M21 15l-5-5L5 21"/>
                        </svg>
                      </button>

                      <button
                        onClick={() => onGenerateVideo(activeScene.id, shot.id)}
                        disabled={!canGenerateVideo && !shot.locked || isGenerating}
                        className="w-7 h-7 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-30 flex items-center justify-center"
                        title={hasVideo ? 'Regenerate video' : 'Generate video'}
                        aria-label={hasVideo ? 'Regenerate video' : 'Generate video'}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polygon points="23 7 16 12 23 17 23 7"/>
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                        </svg>
                      </button>

                      <button
                        onClick={() => onLockShot(activeScene.id, shot.id)}
                        disabled={isGenerating || (!shot.locked && !canLock)}
                        className={`w-7 h-7 rounded-md transition-all flex items-center justify-center ${
                          shot.locked
                            ? 'text-white bg-white/[0.08] hover:bg-white/[0.12]'
                            : canLock
                              ? 'text-white ring-1 ring-white/50 hover:ring-white hover:bg-white/[0.04]'
                              : 'text-zinc-400/60'
                        } disabled:opacity-30`}
                        title={shot.locked ? 'Unlock shot — allow edits' : canLock ? 'Lock shot' : 'Generate start frame + video first to lock'}
                        aria-label={shot.locked ? 'Unlock shot' : 'Lock shot'}
                      >
                        {shot.locked ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Body — collapses when not expanded */}
                  {isExpanded && <>
                  {/* Media: Video or Frames */}
                  <div className="relative">
                    {shot.videoUrl && !showFrames[shot.id] ? (
                      <div className="bg-black">
                        <ShotVideoPreview
                          videoUrl={shot.videoUrl}
                          audioUrl={project?.audioPath ? project.audioPath : undefined}
                          globalStartSec={
                            parseTimeToSec(activeScene.startTime) +
                            activeScene.shots.slice(0, shotIdx).reduce((acc, s) => acc + (s.duration || 0), 0)
                          }
                          durationSec={shot.duration}
                        />
                      </div>
                    ) : hasVideo && (shot.extractedLastFrameUrl || shot.endImageUrl) ? (
                      // Post-video: show start + extracted last frame side-by-side
                      <div className="flex bg-[#141418]">
                        <div className="flex-1 relative min-h-[120px] flex items-center justify-center group/start">
                          <div className="absolute top-2 left-2 z-20">
                            <span className="text-[10px] bg-black/70 backdrop-blur text-zinc-300 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">Start</span>
                          </div>
                          {shot.imageUrl && !shot.locked && onClearShotFrame && (
                            <button
                              onClick={() => onClearShotFrame(shot.id)}
                              className="absolute top-2 right-2 z-20 opacity-0 group-hover/start:opacity-100 w-6 h-6 rounded-full bg-black/70 backdrop-blur text-zinc-300 hover:text-white hover:bg-black/90 flex items-center justify-center transition-all"
                              title="Remove this start frame (keeps the video)"
                              aria-label="Remove start frame"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          )}
                          {shot.imageUrl && shotIdx > 0 && !activeScene.shots[shotIdx - 1]?.locked && onUseAsPrevEnd && modelSupportsLastFrame && (
                            <div className="absolute bottom-2 left-2 z-20 opacity-0 group-hover/start:opacity-100 transition-opacity">
                              <button
                                onClick={() => onUseAsPrevEnd(shot.id)}
                                className="text-[11px] bg-white/90 text-black px-2 py-1 rounded-md font-medium hover:bg-white transition-colors"
                                title="Use this start frame as the previous shot's end keyframe. Previous shot's video becomes stale — regen to land on this frame."
                              >
                                ← Use as prev shot's end
                              </button>
                            </div>
                          )}
                          {shot.imageUrl && (
                            <img src={shot.imageUrl} alt={`Shot ${shotIdx + 1} start frame`} onClick={() => setModalImage(shot.imageUrl!)} className="max-w-full max-h-[360px] h-auto w-auto cursor-zoom-in" />
                          )}
                        </div>
                        <div className="w-px bg-white/[0.06] flex-shrink-0" />
                        <div className="flex-1 relative min-h-[120px] flex items-center justify-center group/last">
                          {/* Show the latest last frame — extracted (from video) takes priority over target (artist-set).
                              Previous versions live in the version history panel. */}
                          {(() => {
                            const lastFrameUrl = shot.extractedLastFrameUrl || shot.endImageUrl;
                            const isExtracted = !!shot.extractedLastFrameUrl;
                            const clearFn = isExtracted ? onClearExtractedFrame : onClearEndFrame;
                            if (!lastFrameUrl) return <div className="text-xs text-zinc-400">No last frame yet</div>;
                            return (
                              <>
                                <div className="absolute top-2 left-2 z-20">
                                  <span className="text-[10px] bg-black/70 backdrop-blur text-zinc-300 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">
                                    Last frame
                                  </span>
                                </div>
                                {!shot.locked && clearFn && (
                                  <button
                                    onClick={() => clearFn(shot.id)}
                                    className="absolute top-2 right-2 z-20 opacity-0 group-hover/last:opacity-100 w-6 h-6 rounded-full bg-black/70 backdrop-blur text-zinc-300 hover:text-white hover:bg-black/90 flex items-center justify-center transition-all"
                                    title="Remove last frame"
                                    aria-label="Remove last frame"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                  </button>
                                )}
                                <img
                                  src={lastFrameUrl}
                                  alt={`Shot ${shotIdx + 1} last frame`}
                                  onClick={() => setModalImage(lastFrameUrl)}
                                  className="max-w-full max-h-[360px] h-auto w-auto cursor-zoom-in"
                                />
                              </>
                            );
                          })()}
                          {/* Action: use this frame as next shot's start */}
                          {activeScene.shots[shotIdx + 1] && shot.extractedLastFrameUrl && onUsePrevLastFrame && (
                            <div className="absolute bottom-2 right-2 z-20 opacity-0 group-hover/last:opacity-100 transition-opacity">
                              <button
                                onClick={() => onUsePrevLastFrame(activeScene.shots[shotIdx + 1].id)}
                                className="text-[11px] bg-white/90 text-black px-2 py-1 rounded-md font-medium hover:bg-white transition-colors"
                                title="Copy this frame as the next shot's start frame"
                              >
                                Use for next shot
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : modelSupportsLastFrame && shot.imageUrl ? (
                      // Pre-video with lastFrame support: side-by-side start + end frame slot
                      <><div className="flex bg-[#141418]">
                        <div className="flex-1 relative min-h-[120px] flex items-center justify-center group/start">
                          <div className="absolute top-2 left-2 z-20">
                            <span className="text-[10px] bg-black/70 backdrop-blur text-zinc-300 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">Start</span>
                          </div>
                          {!shot.locked && onClearShotFrame && (
                            <button
                              onClick={() => onClearShotFrame(shot.id)}
                              className="absolute top-2 right-2 z-20 opacity-0 group-hover/start:opacity-100 w-6 h-6 rounded-full bg-black/70 backdrop-blur text-zinc-300 hover:text-white hover:bg-black/90 flex items-center justify-center transition-all"
                              title="Remove this start frame"
                              aria-label="Remove start frame"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          )}
                          {shotIdx > 0 && !activeScene.shots[shotIdx - 1]?.locked && onUseAsPrevEnd && modelSupportsLastFrame && (
                            <div className="absolute bottom-2 left-2 z-20 opacity-0 group-hover/start:opacity-100 transition-opacity">
                              <button
                                onClick={() => onUseAsPrevEnd(shot.id)}
                                className="text-[11px] bg-white/90 text-black px-2 py-1 rounded-md font-medium hover:bg-white transition-colors"
                                title="Use this start frame as the previous shot's end keyframe."
                              >
                                Use as prev end
                              </button>
                            </div>
                          )}
                          <img src={shot.imageUrl} alt={`Shot ${shotIdx + 1} start frame`} onClick={() => setModalImage(shot.imageUrl!)} className="max-w-full max-h-[360px] h-auto w-auto cursor-zoom-in" />
                        </div>
                        <div className="w-px bg-white/[0.06] flex-shrink-0" />
                        <div className="flex-1 relative min-h-[120px] flex items-center justify-center group/end">
                          {shot.endImageUrl ? (
                            <>
                              <div className="absolute top-2 left-2 z-20">
                                <span className="text-[10px] bg-black/70 backdrop-blur text-zinc-300 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">Last frame</span>
                              </div>
                              {!shot.locked && onClearEndFrame && (
                                <button
                                  onClick={() => onClearEndFrame(shot.id)}
                                  className="absolute top-2 right-2 z-20 opacity-0 group-hover/end:opacity-100 w-6 h-6 rounded-full bg-black/70 backdrop-blur text-zinc-300 hover:text-white hover:bg-black/90 flex items-center justify-center transition-all"
                                  title="Remove target end frame"
                                  aria-label="Remove target end frame"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                              )}
                              <img src={shot.endImageUrl} alt={`Shot ${shotIdx + 1} target end frame`} onClick={() => setModalImage(shot.endImageUrl!)} className="max-w-full max-h-[360px] h-auto w-auto cursor-zoom-in opacity-70" />
                            </>
                          ) : (
                            <div className="w-full min-h-[120px] flex flex-col items-center justify-center gap-3">
                              <span className="text-xs text-zinc-400">No end frame -- optional</span>
                              <div className="flex items-center gap-2">
                                {onGenerateEndFrame && (
                                  <button
                                    onClick={() => onGenerateEndFrame(shot.id)}
                                    className="text-[11px] bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md px-2.5 py-1 transition-colors"
                                  >
                                    Generate
                                  </button>
                                )}
                                {onUploadEndFrame && (
                                  <button
                                    onClick={() => {
                                      setEndFrameUploadTarget(shot.id);
                                      endFrameFileRef.current?.click();
                                    }}
                                    className="text-[11px] bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md px-2.5 py-1 transition-colors"
                                  >
                                    Upload
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      {/* End frame prompt + generate now lives in the "Last frame" prompt tab */}
                      </>
                    ) : (
                      // Pre-video: just show the start frame full width (no confusing empty slot)
                      <div className="relative min-h-[160px] flex items-center justify-center bg-[#141418] group/start">
                        {shot.imageUrl ? (
                          <>
                            <div className="absolute top-2 left-2 z-20">
                              <span className="text-[10px] bg-black/70 backdrop-blur text-zinc-300 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">Start</span>
                            </div>
                            {!shot.locked && onClearShotFrame && (
                              <button
                                onClick={() => onClearShotFrame(shot.id)}
                                className="absolute top-2 right-2 z-20 opacity-0 group-hover/start:opacity-100 w-6 h-6 rounded-full bg-black/70 backdrop-blur text-zinc-300 hover:text-white hover:bg-black/90 flex items-center justify-center transition-all"
                                title="Remove this start frame"
                                aria-label="Remove start frame"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                              </button>
                            )}
                            {shotIdx > 0 && !activeScene.shots[shotIdx - 1]?.locked && onUseAsPrevEnd && modelSupportsLastFrame && (
                              <div className="absolute bottom-2 left-2 z-20 opacity-0 group-hover/start:opacity-100 transition-opacity">
                                <button
                                  onClick={() => onUseAsPrevEnd(shot.id)}
                                  className="text-[11px] bg-white/90 text-black px-2 py-1 rounded-md font-medium hover:bg-white transition-colors"
                                  title="Use this start frame as the previous shot's end keyframe. Previous shot's video becomes stale — regen to land on this frame."
                                >
                                  Use as prev shot's end
                                </button>
                              </div>
                            )}
                            <img src={shot.imageUrl} alt={`Shot ${shotIdx + 1} start frame`} onClick={() => setModalImage(shot.imageUrl!)} className="max-w-full max-h-[480px] h-auto w-auto cursor-zoom-in" />
                          </>
                        ) : (
                          <div className="w-full min-h-[160px] flex items-center justify-center text-zinc-400">
                            <span className="text-xs">No start frame -- click "Frame" to generate</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Critique score */}
                    {shot.critique && !isGenerating && (
                      <div className="absolute top-2 left-2 z-20">
                        <div className={`px-2 py-1 rounded-md text-[11px] font-medium border ${
                          shot.critique.score >= 7 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/20'
                            : shot.critique.score >= 5 ? 'bg-amber-500/20 text-amber-300 border-amber-500/20'
                            : 'bg-red-500/20 text-red-300 border-red-500/20'
                        }`}>
                          {shot.critique.score}/10
                          {shot.attemptCount && shot.attemptCount > 1 && (
                            <span className="text-[11px] opacity-60 ml-1">R{shot.attemptCount}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Error — only show if there's no successful content already */}
                    {isError && !isGenerating && !shot.videoUrl && (
                      <div className="px-4 py-2 border-t border-red-500/10 bg-red-500/[0.04] space-y-1">
                        <span className="text-xs text-red-300">Generation failed — click regen to retry</span>
                        {shot.lastError && (
                          <p className="text-[11px] text-red-300/60 font-mono leading-snug break-all">{shot.lastError.slice(0, 200)}</p>
                        )}
                      </div>
                    )}

                    {/* Loading overlay — clickable stop button so the artist
                        isn't stuck watching a 60-180s video gen. Cancelling
                        reverts the shot to idle; server call orphans but is
                        harmless (logged, no state corruption). */}
                    {isGenerating && (
                      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center z-30 gap-3">
                        <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
                        <span className="text-[11px] text-zinc-400 font-medium">
                          {shot.imageStatus === GenerationStatus.LOADING ? 'Generating frame'
                            : shot.videoStatus === GenerationStatus.LOADING ? 'Generating video'
                            : 'Processing'}
                        </span>
                        <div className="w-24 h-0.5 bg-white/[0.06] rounded-full overflow-hidden">
                          <div className="h-full bg-white/30 rounded-full animate-shimmer" style={{ width: '40%' }} />
                        </div>
                        {(shot.imageStatus === GenerationStatus.LOADING && onCancelShotImage) ||
                        (shot.videoStatus === GenerationStatus.LOADING && onCancelShotVideo) ? (
                          <button
                            onClick={() => {
                              if (shot.imageStatus === GenerationStatus.LOADING) onCancelShotImage?.(shot.id);
                              else if (shot.videoStatus === GenerationStatus.LOADING) onCancelShotVideo?.(shot.id);
                            }}
                            className="text-[11px] bg-white/[0.08] hover:bg-white/[0.14] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md px-3 py-1 transition-colors"
                          >
                            Stop
                          </button>
                        ) : null}
                      </div>
                    )}

                    {/* Not actionable — only for continuity-linked shots waiting on prev video */}
                    {!actionable && !isGenerating && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
                        <span className="text-xs text-zinc-400">Waiting on previous shot's video (continuity)</span>
                      </div>
                    )}
                  </div>

                  {/* Version history panel — tabbed: First frame | Last frame | Clip */}
                  {historyOpenFor === shot.id && (
                    <div className="px-5 py-3 border-t border-white/[0.06] bg-white/[0.02]">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] uppercase tracking-wider text-zinc-400">Version history</span>
                          <div className="flex items-center bg-white/[0.04] rounded-md overflow-hidden border border-white/[0.06]">
                            <button
                              onClick={() => setHistoryTab('firstFrame')}
                              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${historyTab === 'firstFrame' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
                            >First frame</button>
                            <button
                              onClick={() => setHistoryTab('lastFrame')}
                              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${historyTab === 'lastFrame' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
                            >Last frame</button>
                            <button
                              onClick={() => setHistoryTab('video')}
                              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${historyTab === 'video' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
                            >Clip</button>
                          </div>
                        </div>
                        <button
                          onClick={() => setHistoryOpenFor(null)}
                          className="text-[11px] text-zinc-400 hover:text-white"
                        >Close</button>
                      </div>
                      {historyLoading ? (
                        <div className="text-xs text-zinc-400 py-3">Loading…</div>
                      ) : (() => {
                        const versions = historyData[historyTab];
                        if (versions.length === 0) return (
                          <div className="text-xs text-zinc-400 py-3">No versions yet — generate to build history.</div>
                        );
                        return (
                          <div className="flex gap-2 overflow-x-auto pb-1">
                            {versions.map((v, idx) => (
                              <button
                                key={v.assetId}
                                disabled={v.isCurrent}
                                onClick={async () => {
                                  if (!project) return;
                                  if (historyTab === 'firstFrame') {
                                    await revertShotFrame(project.id, shot.id, v.assetId);
                                  } else if (historyTab === 'lastFrame') {
                                    await revertShotEndFrame(project.id, shot.id, v.assetId);
                                  } else {
                                    await onRevertVideo?.(shot.id, v.assetId);
                                  }
                                  // Refresh history + project
                                  const data = await getShotHistory(project.id, shot.id);
                                  setHistoryData(data);
                                  try {
                                    const p = await import('../services/api').then(m => m.getProject(project.id));
                                    onSetProject?.(p);
                                  } catch {}
                                }}
                                className={`flex-shrink-0 w-28 rounded-md overflow-hidden border transition-all text-left ${
                                  v.isCurrent
                                    ? 'border-white/40 ring-1 ring-white/30'
                                    : 'border-white/[0.08] hover:border-white/30 cursor-pointer'
                                }`}
                                title={v.isCurrent ? 'Current version' : 'Revert to this version'}
                              >
                                <div className={`${historyTab === 'video' ? 'aspect-video' : 'aspect-square'} bg-black flex items-center justify-center`}>
                                  {(historyTab === 'video' ? v.thumbnailUrl : v.url) ? (
                                    <img src={(historyTab === 'video' ? v.thumbnailUrl : v.url)!} alt={`v${versions.length - idx}`} className="w-full h-full object-cover" />
                                  ) : (
                                    <span className="text-[10px] text-zinc-500">no preview</span>
                                  )}
                                </div>
                                <div className="px-2 py-1.5">
                                  <div className="text-[11px] text-zinc-300 font-medium">
                                    {v.isCurrent ? 'Current' : 'Revert'}
                                  </div>
                                  <div className="text-[10px] text-zinc-500 font-mono">
                                    {new Date(v.createdAt + 'Z').toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Prompts — full width below media */}
                  <div className="px-5 py-4 space-y-4 border-t border-white/[0.06]">

                    {/* Prompts — toggle between Frame prompt / Motion prompt / Video prompt / Full chain */}
                    {(shot.locked || actionable) && (() => {
                      const activeTab = promptTab[shot.id] || 'image';

                      // Build compiled prompt preview from available data
                      const compiledRefs: { label: string; url?: string }[] = [];
                      const shotCast = project?.cast.filter(c => shot.castIds?.includes(c.id)) || [];
                      shotCast.forEach(c => {
                        if (c.referenceImageUrl) compiledRefs.push({ label: c.name, url: c.referenceImageUrl });
                      });
                      if (project?.styleAssetUrl) compiledRefs.push({ label: 'Style', url: project.styleAssetUrl });
                      const shotEnv = project?.environments.find(e => e.id === shot.environmentId);
                      if (shotEnv?.referenceImageUrl) compiledRefs.push({ label: shotEnv.name, url: shotEnv.referenceImageUrl });
                      if (shot.continuityFrom === 'prev_shot') {
                        const prevShot = activeScene.shots[shotIdx - 1];
                        if (prevShot?.extractedLastFrameUrl) compiledRefs.push({ label: 'Continuity', url: prevShot.extractedLastFrameUrl });
                        else if (prevShot?.endImageUrl) compiledRefs.push({ label: 'Continuity', url: prevShot.endImageUrl });
                      }
                      if (shot.userFeedback && shot.imageUrl) compiledRefs.push({ label: 'Failed attempt', url: shot.imageUrl });

                      // Mirror the exact prompt that generateShotStartFrame builds (server/services/imagen.ts)
                      const compiledLines = [`Scene: ${shot.visualPrompt}`, '', `Style: ${project?.styleDescription || '(none)'}`, '', `Preserve character identity from character references (face, costume, ornaments must match). Match environment from environment reference. ${shot.continuityFrom === 'prev_shot' ? 'Continue visual flow from previous shot. ' : ''}Render in the style of the style reference image.`];
                      if (shot.continuityFrom === 'prev_shot') {
                        compiledLines.push('', 'Previous shot ended with: [auto-described from extracted frame]', 'This shot should begin from that exact continuity state.');
                      }
                      if (shot.userFeedback) compiledLines.push('', `Director note: ${shot.userFeedback}`);
                      compiledLines.push('', 'Single cinematic frame. No text, no watermark.', 'Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy.');
                      const compiledText = compiledLines.join('\n');

                      // Mirror of the Veo prompt builder in generate.ts
                      const concept = project?.lockedConcept;
                      const castNamesStr = shotCast.map(c => c.name).join(', ');
                      const mood = concept?.mood || 'Cinematic';
                      const narrativeBrief = (activeScene.narrativeDescription || '').length > 120
                        ? activeScene.narrativeDescription.substring(0, 120) + '...'
                        : activeScene.narrativeDescription;
                      const veoParts = [shot.motionPrompt || 'Cinematic camera movement'];
                      if (narrativeBrief) veoParts.push(narrativeBrief);
                      if (castNamesStr) veoParts.push(`Characters: ${castNamesStr}`);
                      veoParts.push(`${mood} mood`);
                      if (shot.continuityFrom === 'prev_shot' && (shot as any).continuityDescription) {
                        veoParts.push(`Starting state (from previous shot): ${(shot as any).continuityDescription}`);
                      }
                      const autoVeoPrompt = veoParts.join('. ');

                      const promptText = activeTab === 'compiled' ? compiledText
                        : activeTab === 'image' ? shot.visualPrompt
                        : activeTab === 'endframe' ? (shot.endVisualPrompt || '')
                        : shot.motionPrompt;

                      return (
                        <div className="space-y-3">
                          <div className="flex items-center gap-4">
                            <button
                              onClick={() => setPromptTab(prev => ({ ...prev, [shot.id]: 'image' }))}
                              className={`text-sm font-medium transition-colors ${activeTab === 'image' ? 'text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
                            >First frame</button>
                            {modelSupportsLastFrame && (
                              <button
                                onClick={() => setPromptTab(prev => ({ ...prev, [shot.id]: 'endframe' }))}
                                className={`text-sm font-medium transition-colors ${activeTab === 'endframe' ? 'text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
                              >Last frame</button>
                            )}
                            <button
                              onClick={() => setPromptTab(prev => ({ ...prev, [shot.id]: 'video' }))}
                              className={`text-sm font-medium transition-colors ${activeTab === 'video' ? 'text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
                            >Video</button>
                            <button
                              onClick={() => setPromptTab(prev => ({ ...prev, [shot.id]: 'compiled' }))}
                              className={`text-sm font-medium transition-colors ${activeTab === 'compiled' ? 'text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
                            >Full chain</button>
                          </div>

                          {/* ═══ UNIFIED TOOLKIT — same pattern for all tabs ═══ */}

                          {/* 1. Ref chips — context-aware per tab */}
                          {!shot.locked && (() => {
                            const tabRefs: { label: string; url?: string }[] = [];
                            if (activeTab === 'image' || activeTab === 'endframe') {
                              shotCast.forEach(c => { if (c.referenceImageUrl) tabRefs.push({ label: c.name, url: c.referenceImageUrl }); });
                              if (shotEnv?.referenceImageUrl) tabRefs.push({ label: shotEnv.name, url: shotEnv.referenceImageUrl });
                              if (project?.styleAssetUrl) tabRefs.push({ label: 'Style', url: project.styleAssetUrl });
                              if (activeTab === 'endframe' && shot.imageUrl) tabRefs.push({ label: 'Start frame', url: shot.imageUrl });
                            } else if (activeTab === 'video') {
                              if (shot.imageUrl) tabRefs.push({ label: 'Start keyframe', url: shot.imageUrl });
                              if (shot.endImageUrl) tabRefs.push({ label: 'End keyframe', url: shot.endImageUrl });
                              shotCast.forEach(c => { if (c.referenceImageUrl) tabRefs.push({ label: c.name, url: c.referenceImageUrl }); });
                              if (shotEnv?.referenceImageUrl) tabRefs.push({ label: shotEnv.name, url: shotEnv.referenceImageUrl });
                            }
                            const shotRefs = shot.refImages || [];
                            const modelSpec = getVideoModel(project?.videoModel);
                            // Show upload for image tab (always) and video tab (only if model supports refs with frames)
                            const canUploadRef = activeTab === 'image' || activeTab === 'endframe' || (activeTab === 'video' && modelSpec.refsWithFrames);
                            if (tabRefs.length === 0 && shotRefs.length === 0 && !canUploadRef) return null;
                            return (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[11px] text-zinc-400 mr-1">Refs:</span>
                                {tabRefs.map((ref, i) => (
                                  <div key={i} className="group/ref relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border border-white/[0.08] text-zinc-300 bg-white/[0.02] cursor-pointer"
                                    onClick={() => ref.url && setModalImage(ref.url)}>
                                    {ref.url && <img src={ref.url} className="w-4 h-4 rounded-sm object-cover flex-shrink-0" alt="" />}
                                    <span>{ref.label}</span>
                                    {ref.url && (
                                      <div className="hidden group-hover/ref:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[200] pointer-events-none">
                                        <img src={ref.url} className="max-w-44 max-h-44 object-contain rounded-lg shadow-xl border border-white/[0.1]" alt={ref.label} />
                                      </div>
                                    )}
                                  </div>
                                ))}
                                {/* User-uploaded shot refs */}
                                {shotRefs.map((ref) => (
                                  <div key={ref.id} className="group/ref relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border border-amber-400/30 text-zinc-300 bg-amber-400/[0.04] cursor-pointer"
                                    onClick={() => setModalImage(ref.url)}>
                                    <img src={ref.url} className="w-4 h-4 rounded-sm object-cover flex-shrink-0" alt="" />
                                    <span>Ref</span>
                                    <button
                                      className="text-zinc-500 hover:text-red-400 transition-colors ml-0.5"
                                      title="Remove reference"
                                      onClick={(e) => { e.stopPropagation(); onDeleteShotRef?.(shot.id, ref.id); }}
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                    </button>
                                    <div className="hidden group-hover/ref:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[200] pointer-events-none">
                                      <img src={ref.url} className="max-w-44 max-h-44 object-contain rounded-lg shadow-xl border border-white/[0.1]" alt="Director ref" />
                                    </div>
                                  </div>
                                ))}
                                {/* Upload ref button */}
                                {canUploadRef && (
                                  <label className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border border-dashed border-white/[0.12] text-zinc-400 hover:text-zinc-300 hover:border-white/[0.2] bg-white/[0.01] cursor-pointer transition-colors" title="Upload a reference image for this shot">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                    <span>Ref</span>
                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) onUploadShotRef?.(shot.id, file);
                                      e.target.value = '';
                                    }} />
                                  </label>
                                )}
                              </div>
                            );
                          })()}

                          {/* 2. Prompt — editable, tab-specific */}
                          {activeTab === 'compiled' ? (
                            <div className="space-y-4">
                              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Inputs &rarr; Gemini 3 Pro Image</div>
                              {compiledRefs.length > 0 && (
                                <div className="flex gap-2.5 flex-wrap">
                                  {compiledRefs.map((ref, i) => (
                                    <div key={i} className="relative group/ref">
                                      {ref.url ? (
                                        <img src={ref.url} className="w-16 h-16 object-cover rounded-md border border-white/[0.06] cursor-zoom-in" alt={ref.label} onClick={() => ref.url && setModalImage(ref.url)} />
                                      ) : (
                                        <div className="w-16 h-16 rounded-md border border-white/[0.06] bg-white/[0.02] flex items-center justify-center text-[11px] text-zinc-400">?</div>
                                      )}
                                      <div className="absolute inset-x-0 bottom-0 bg-black/80 text-[10px] text-zinc-300 px-1 py-0.5 rounded-b-md truncate text-center font-mono">{ref.label}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <pre className="surface-inset rounded-md p-3 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{compiledText}</pre>
                              <div className="h-px bg-white/[0.06]" />
                              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Output &rarr; Start frame</div>
                              {shot.imageUrl ? (
                                <img src={shot.imageUrl} alt={`Shot ${shotIdx + 1} start frame`} onClick={() => setModalImage(shot.imageUrl!)} className="max-h-48 rounded-md border border-white/[0.06] cursor-zoom-in" />
                              ) : (
                                <div className="text-xs text-zinc-400">Not generated yet</div>
                              )}
                              <div className="h-px bg-white/[0.06] mt-2" />
                              <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                                Start frame + prompt &rarr; {project?.videoModel?.includes('seedance') ? 'Seedance' : 'Veo'} &rarr; Video
                              </div>
                              <pre className="surface-inset rounded-md p-3 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{autoVeoPrompt}</pre>
                              {shot.videoUrl && (
                                <>
                                  <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Output &rarr; Video</div>
                                  <video src={shot.videoUrl} className="max-h-48 rounded-md border border-white/[0.06]" controls muted />
                                </>
                              )}
                            </div>
                          ) : (() => {
                            // Shared editable prompt area for First frame / Last frame / Video
                            const isFirstFrame = activeTab === 'image';
                            const isEndFrame = activeTab === 'endframe';
                            const isVideo = activeTab === 'video';

                            const currentPrompt = isFirstFrame ? (shot.visualPrompt || '')
                              : isEndFrame ? (shot.endVisualPrompt || '')
                              : (videoOverride[shot.id] ?? autoVeoPrompt);

                            const promptPlaceholder = isFirstFrame ? 'Describe the visual scene…'
                              : isEndFrame ? 'Describe what this shot should end on…'
                              : 'Video prompt — camera, motion, scene context…';

                            const handlePromptChange = (val: string) => {
                              if (isFirstFrame) onUpdateShot(activeScene.id, shot.id, { visualPrompt: val });
                              else if (isEndFrame) onUpdateShot(activeScene.id, shot.id, { endVisualPrompt: val } as any);
                              else setVideoOverride(prev => ({ ...prev, [shot.id]: val }));
                            };

                            const handleGenerate = () => {
                              if (isFirstFrame) onGenerateImage(activeScene.id, shot.id);
                              else if (isEndFrame) onGenerateEndFrame?.(shot.id);
                              else {
                                const override = videoOverride[shot.id];
                                onGenerateVideo(activeScene.id, shot.id, override && override !== autoVeoPrompt ? override : undefined);
                              }
                            };

                            const canRefine = true;
                            const handleRefine = (feedback: string) => {
                              if (isFirstFrame) onRefinePrompt(activeScene.id, shot.id, feedback);
                              else if (isEndFrame) onRefineEndFramePrompt?.(shot.id, feedback);
                              else if (isVideo) onRefineVideoPrompt?.(shot.id, feedback);
                            };

                            const generateLabel = isFirstFrame
                              ? (hasStartFrame ? 'Regenerate frame' : 'Generate frame')
                              : isEndFrame
                                ? (shot.endImageUrl ? 'Regenerate end frame' : 'Generate end frame')
                                : (hasVideo ? 'Regenerate video' : 'Generate video');

                            const canGenerate = isFirstFrame ? (!isGenerating && (actionable || shot.locked))
                              : isEndFrame ? (!isGenerating && !!currentPrompt)
                              : (!isGenerating && hasStartFrame);

                            const hasResult = isFirstFrame ? hasStartFrame : isEndFrame ? !!shot.endImageUrl : hasVideo;

                            return (
                              <div className="space-y-3">
                                {/* Extracted-from-video note for last frame with no prompt */}
                                {isEndFrame && !shot.endVisualPrompt && shot.extractedLastFrameUrl && (
                                  <div className="surface-inset rounded-md p-3 text-sm text-zinc-400 italic">
                                    Extracted from video — no prompt. Write one below to generate a specific end frame.
                                  </div>
                                )}

                                {/* Prompt textarea with @mention support */}
                                {shot.locked ? (
                                  <pre className="surface-inset rounded-md p-3 text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{currentPrompt || '(empty)'}</pre>
                                ) : (
                                  <div className="relative">
                                    <textarea
                                      id={`prompt-${activeTab}-${shot.id}`}
                                      value={currentPrompt}
                                      onChange={e => {
                                        handlePromptChange(e.target.value);
                                        setPromptDirty(prev => ({ ...prev, [`${activeTab}:${shot.id}`]: true }));
                                        // @mention detection
                                        const val = e.target.value;
                                        const cursor = e.target.selectionStart;
                                        const before = val.slice(0, cursor);
                                        const atIdx = before.lastIndexOf('@');
                                        if (atIdx >= 0 && (atIdx === 0 || /\s/.test(before[atIdx - 1]))) {
                                          const query = before.slice(atIdx + 1);
                                          if (/\s/.test(query)) { setMentionOpen(null); setMentionQuery(''); }
                                          else { setMentionOpen(`prompt:${shot.id}`); setMentionQuery(query.toLowerCase()); }
                                        } else { setMentionOpen(null); setMentionQuery(''); }
                                      }}
                                      onKeyDown={e => {
                                        if (e.key === 'Escape' && mentionOpen === `prompt:${shot.id}`) {
                                          setMentionOpen(null); setMentionQuery('');
                                        }
                                      }}
                                      onBlur={() => { setTimeout(() => { if (mentionOpen === `prompt:${shot.id}`) { setMentionOpen(null); setMentionQuery(''); } }, 200); }}
                                      placeholder={promptPlaceholder}
                                      className="w-full surface-inset rounded-md p-3 text-sm text-zinc-300 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 resize-none min-h-[2.5rem]"
                                      style={{ height: 'auto', overflow: 'hidden' }}
                                      ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                                    />
                                    {/* @mention dropdown */}
                                    {mentionOpen === `prompt:${shot.id}` && (() => {
                                      const castItems = (project?.cast || []).filter(c => !mentionQuery || c.name.toLowerCase().includes(mentionQuery)).map(c => ({ name: c.name, thumb: c.referenceImageUrl, type: 'character' as const }));
                                      const envItems = (project?.environments || []).filter(e => !mentionQuery || e.name.toLowerCase().includes(mentionQuery)).map(e => ({ name: e.name, thumb: e.referenceImageUrl, type: 'environment' as const }));
                                      const styleItem = project?.styleAssetUrl && (!mentionQuery || 'style'.includes(mentionQuery))
                                        ? [{ name: 'Style', thumb: project.styleAssetUrl, type: 'style' as const }] : [];
                                      const items = [...styleItem, ...castItems, ...envItems];
                                      if (items.length === 0) return null;
                                      return (
                                        <div className="absolute left-0 bottom-full mb-1 z-[200] bg-zinc-900 border border-white/[0.08] rounded-lg shadow-xl max-h-[200px] overflow-y-auto w-64">
                                          {items.map((item, i) => (
                                            <button key={`${item.type}-${i}`} type="button"
                                              className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/[0.04] cursor-pointer text-left"
                                              onMouseDown={e => {
                                                e.preventDefault();
                                                const textarea = document.getElementById(`prompt-${activeTab}-${shot.id}`) as HTMLTextAreaElement;
                                                if (!textarea) return;
                                                const val = textarea.value;
                                                const cursor = textarea.selectionStart;
                                                const before = val.slice(0, cursor);
                                                const atIdx = before.lastIndexOf('@');
                                                if (atIdx < 0) return;
                                                const newVal = val.slice(0, atIdx) + '@' + item.name + ' ' + val.slice(cursor);
                                                handlePromptChange(newVal);
                                                setPromptDirty(prev => ({ ...prev, [`${activeTab}:${shot.id}`]: true }));
                                                setMentionOpen(null); setMentionQuery('');
                                                setTimeout(() => { textarea.focus(); const pos = atIdx + item.name.length + 2; textarea.setSelectionRange(pos, pos); }, 0);
                                              }}
                                            >
                                              {item.thumb ? <img src={item.thumb} className="w-6 h-6 rounded object-cover flex-shrink-0" alt="" /> : <div className="w-6 h-6 rounded bg-white/[0.06] flex-shrink-0" />}
                                              <span className="text-sm text-zinc-300 truncate">{item.name}</span>
                                              <span className="text-[10px] uppercase text-zinc-400 ml-auto flex-shrink-0">{item.type === 'character' ? 'char' : item.type === 'environment' ? 'env' : 'style'}</span>
                                            </button>
                                          ))}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                )}

                                {/* Video tab: reset to auto button */}
                                {isVideo && videoOverride[shot.id] && videoOverride[shot.id] !== autoVeoPrompt && (
                                  <button
                                    onClick={() => { setVideoOverride(prev => { const { [shot.id]: _, ...rest } = prev; return rest; }); setPromptDirty(prev => ({ ...prev, [`video:${shot.id}`]: true })); }}
                                    className="text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors"
                                  >Reset to auto-generated prompt</button>
                                )}

                                {/* 3. Generate button — only active when prompt was edited */}
                                {!shot.locked && (
                                  <div className="flex items-center gap-3">
                                    <button
                                      onClick={() => { handleGenerate(); setPromptDirty(prev => ({ ...prev, [`${activeTab}:${shot.id}`]: false })); }}
                                      disabled={!canGenerate}
                                      className="px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                                    >{hasResult && !promptDirty[`${activeTab}:${shot.id}`] ? 'Regenerate' : generateLabel}</button>
                                  </div>
                                )}

                                {/* 4. Refine — plain text feedback, Claude rewrites the prompt */}
                                {!shot.locked && canRefine && (
                                  <>
                                    <div className="h-px bg-white/[0.06] my-1" />
                                    <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-2">
                                      Refine — describe what's wrong, Claude rewrites the prompt
                                    </div>
                                    <div className="flex gap-2">
                                      <AutoGrowTextarea
                                        id={`refine-${activeTab}-${shot.id}`}
                                        placeholder={isFirstFrame ? "e.g. 'face not crisp, lighting too flat'" : isEndFrame ? "e.g. 'should end with a wider shot'" : "e.g. 'camera too shaky, slow it down'"}
                                        rows={1}
                                        className="flex-1 surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 outline-none focus-visible:ring-1 focus-visible:ring-white/20 leading-relaxed"
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLTextAreaElement).value.trim()) {
                                            e.preventDefault();
                                            handleRefine((e.target as HTMLTextAreaElement).value);
                                            (e.target as HTMLTextAreaElement).value = '';
                                          }
                                        }}
                                      />
                                      <button
                                        onClick={() => {
                                          const input = document.getElementById(`refine-${activeTab}-${shot.id}`) as HTMLTextAreaElement;
                                          if (input?.value.trim()) {
                                            handleRefine(input.value);
                                            input.value = '';
                                          }
                                        }}
                                        className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-400 hover:text-white rounded-md text-xs font-medium transition-colors flex-shrink-0 self-start"
                                      >Refine</button>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}
                  </div>
                  </>}
                </motion.div>
              );
            })}
          </div>
        </motion.div>
        );
      })}
      </div>

      {/* Hidden file input for end frame upload */}
      <input
        ref={endFrameFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && endFrameUploadTarget && onUploadEndFrame) {
            onUploadEndFrame(endFrameUploadTarget, file);
          }
          setEndFrameUploadTarget(null);
          if (endFrameFileRef.current) endFrameFileRef.current.value = '';
        }}
      />

      <AnimatePresence>
        {modalImage && <ImageModal src={modalImage} onClose={() => setModalImage(null)} />}
      </AnimatePresence>
    </div>
  );
};
