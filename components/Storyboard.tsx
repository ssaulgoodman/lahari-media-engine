
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { VideoScene, VideoShot, GenerationStatus, ApiProject } from '../types';
import { ImageModal } from './ImageModal';

interface Props {
  scenes: VideoScene[];
  project: ApiProject | null;
  activeSceneIdx: number;
  onSceneChange: (idx: number) => void;
  onUpdateShot: (sceneId: string, shotId: string, updates: Partial<VideoShot>) => void;
  onGenerateImage: (sceneId: string, shotId: string) => void;
  onGenerateVideo: (sceneId: string, shotId: string, promptOverride?: string) => void;
  onLockShot: (sceneId: string, shotId: string) => void;
  onRefinePrompt: (sceneId: string, shotId: string, feedback: string) => void;
  onUpdateProject?: (updates: Record<string, any>) => void;
  onRewriteShotPrompts?: (userNote?: string) => void;
  onUsePrevLastFrame?: (shotId: string) => void;
  isLoading?: boolean;
}

export const Storyboard: React.FC<Props> = ({ scenes, project, activeSceneIdx, onSceneChange, onUpdateShot, onGenerateImage, onGenerateVideo, onLockShot, onRefinePrompt, onUpdateProject, onRewriteShotPrompts, onUsePrevLastFrame, isLoading }) => {
  const [showFrames, setShowFrames] = useState<Record<string, boolean>>({});
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [promptTab, setPromptTab] = useState<Record<string, 'image' | 'motion' | 'video' | 'compiled'>>({});
  const [videoOverride, setVideoOverride] = useState<Record<string, string>>({});
  const [showBulkPrompt, setShowBulkPrompt] = useState(false);
  const [bulkNote, setBulkNote] = useState('');
  const [expandedShotId, setExpandedShotId] = useState<string | null>(null);

  // Auto-expand the first actionable unlocked shot when switching scenes
  React.useEffect(() => {
    const scene = scenes[activeSceneIdx];
    if (!scene) return;
    const firstUnlocked = scene.shots.find(s => !s.locked) || scene.shots[0];
    setExpandedShotId(firstUnlocked?.id || null);
  }, [activeSceneIdx, scenes]);

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

  const activeScene = scenes[activeSceneIdx];
  if (!activeScene) return null;

  const hasBulkPrompt = !!project?.lastWriteShotsPrompt;
  const totalShots = scenes.reduce((acc, s) => acc + s.shots.length, 0);
  const lockedShots = scenes.reduce((acc, s) => acc + s.shots.filter(x => x.locked).length, 0);
  const videoShots = scenes.reduce((acc, s) => acc + s.shots.filter(x => !!x.videoUrl).length, 0);
  const frameShots = scenes.reduce((acc, s) => acc + s.shots.filter(x => !!x.imageUrl).length, 0);
  const concept = project?.lockedConcept;

  return (
    <div className="max-w-5xl mx-auto pb-32 space-y-6">
      {/* Story & Shots overview — concept, scene list, progress, bulk prompt */}
      <div className="surface rounded-xl overflow-hidden">
        {/* Concept summary */}
        {concept && (
          <div className="px-5 py-4 border-b border-white/[0.04]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-400 mb-1">
                  <span>Story</span>
                  {concept.deity && <><span>·</span><span className="text-zinc-300 normal-case tracking-normal">{concept.deity}</span></>}
                  {concept.mood && <><span>·</span><span className="text-zinc-300 normal-case tracking-normal">{concept.mood}</span></>}
                </div>
                <p className="text-sm text-zinc-300 leading-relaxed">{concept.conceptDirection || concept.theme}</p>
                {concept.conceptDirection && concept.theme && concept.theme !== concept.conceptDirection && (
                  <p className="text-xs text-zinc-400 leading-relaxed mt-1">{concept.theme}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Progress row */}
        <div className="px-5 py-3 border-b border-white/[0.04] flex items-center gap-6 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-zinc-400">Scenes</span>
            <span className="text-white font-medium">{scenes.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-400">Shots</span>
            <span className="text-white font-medium">{totalShots}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-400">Frames</span>
            <span className="text-white font-medium">{frameShots}/{totalShots}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-400">Videos</span>
            <span className="text-white font-medium">{videoShots}/{totalShots}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-400">Locked</span>
            <span className="text-white font-medium">{lockedShots}/{totalShots}</span>
          </div>
        </div>

        {/* Scene tabs — navigate + see at-a-glance status */}
        <div className="px-5 py-3 border-b border-white/[0.04] flex flex-wrap gap-2">
          {scenes.map((s, i) => {
            const isActive = i === activeSceneIdx;
            const sceneVideoCount = s.shots.filter(x => !!x.videoUrl).length;
            const sceneDone = sceneVideoCount === s.shots.length && s.shots.length > 0;
            return (
              <button
                key={s.id}
                onClick={() => onSceneChange(i)}
                className={`px-3 py-1.5 rounded-md text-[11px] transition-colors border ${
                  isActive
                    ? 'bg-white text-black border-white'
                    : sceneDone
                      ? 'bg-white/[0.04] text-zinc-300 border-white/[0.08] hover:bg-white/[0.08]'
                      : 'bg-transparent text-zinc-400 border-white/[0.06] hover:text-zinc-300 hover:border-white/[0.12]'
                }`}
              >
                <span className="font-medium">S{i + 1}</span>
                <span className="mx-1.5 opacity-60">·</span>
                <span className="font-mono opacity-80">{s.startTime}</span>
                <span className="mx-1.5 opacity-60">·</span>
                <span>{s.shots.length} shots</span>
                {sceneVideoCount > 0 && !isActive && (
                  <span className="ml-1.5 opacity-60">({sceneVideoCount} done)</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Master prompt (collapsible, secondary) */}
        {onRewriteShotPrompts && hasBulkPrompt && (
          <div className="px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] uppercase tracking-wide text-zinc-400">Master shot-prompts</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowBulkPrompt(s => !s)}
                  className="text-[11px] text-zinc-400 hover:text-white transition-colors px-2 py-1"
                >
                  {showBulkPrompt ? 'Hide' : 'View'}
                </button>
                <button
                  onClick={() => { onRewriteShotPrompts(bulkNote || undefined); setBulkNote(''); }}
                  disabled={isLoading}
                  className="text-[11px] bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md px-3 py-1.5 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isLoading && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>}
                  {isLoading ? 'Rewriting...' : 'Rewrite all'}
                </button>
              </div>
            </div>
            {showBulkPrompt && (
              <div className="mt-3 space-y-3">
                <input
                  value={bulkNote}
                  onChange={e => setBulkNote(e.target.value)}
                  placeholder="Rewrite note — e.g. 'more deity close-ups', 'reduce camera motion'"
                  className="w-full surface-inset rounded-md px-3 py-2 text-xs text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && bulkNote.trim() && !isLoading) {
                      onRewriteShotPrompts(bulkNote);
                      setBulkNote('');
                    }
                  }}
                />
                {/* Formatted scene → shot breakdown instead of raw concatenated text */}
                <div className="surface-inset rounded-md p-4 max-h-96 overflow-y-auto space-y-4">
                  {scenes.map((s, sIdx) => (
                    <div key={s.id} className="space-y-2">
                      <div className="flex items-baseline gap-2 pb-1 border-b border-white/[0.04]">
                        <span className="text-[11px] uppercase tracking-wide text-zinc-400">Scene {sIdx + 1}</span>
                        <span className="text-[11px] text-zinc-400 font-mono">{s.startTime}–{s.endTime}</span>
                        <span className="text-[11px] text-zinc-400">{s.sectionLabel}</span>
                      </div>
                      {s.narrativeDescription && (
                        <p className="text-xs text-zinc-400 italic">{s.narrativeDescription}</p>
                      )}
                      <div className="space-y-2">
                        {s.shots.map((shot, shIdx) => (
                          <div key={shot.id} className="pl-3 border-l-2 border-white/[0.05] space-y-1">
                            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                              <span className="font-medium text-zinc-300">Shot {shIdx + 1}</span>
                              <span className="font-mono">{shot.duration}s</span>
                              <span className={`uppercase tracking-wide ${shot.continuityFrom === 'prev_shot' ? 'text-accent-400' : 'text-zinc-400'}`}>
                                {shot.continuityFrom === 'prev_shot' ? '· continues' : '· cut'}
                              </span>
                            </div>
                            <div className="text-xs text-zinc-300 leading-relaxed"><span className="text-zinc-400">Visual:</span> {shot.visualPrompt}</div>
                            {shot.motionPrompt && (
                              <div className="text-xs text-zinc-300 leading-relaxed"><span className="text-zinc-400">Motion:</span> {shot.motionPrompt}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <details className="text-[11px] text-zinc-400">
                  <summary className="cursor-pointer hover:text-zinc-300">Raw master prompt (what Claude saw)</summary>
                  <pre className="mt-2 surface-inset rounded-md p-3 text-[11px] text-zinc-400 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">{project?.lastWriteShotsPrompt}</pre>
                </details>
                <p className="text-[11px] text-zinc-400">Rewriting replaces every shot's prompt. Existing frames and videos stay as-is — regenerate per-shot to apply new prompts.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scene Header */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeScene.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
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
              const isExpanded = expandedShotId === shot.id;

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
                      setExpandedShotId(isExpanded ? null : shot.id);
                    }}
                  >
                    {/* Chevron */}
                    <svg
                      xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      className={`text-zinc-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      aria-hidden="true"
                    ><polyline points="9 18 15 12 9 6"/></svg>

                    {/* Left: shot info */}
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-xs font-medium text-white flex-shrink-0">{shotIdx + 1}</span>

                      {/* Progress dots */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {[1, 2, 3].map(step => (
                          <div key={step} className={`w-1.5 h-1.5 rounded-full transition-colors ${
                            step <= progress ? 'bg-white' : 'bg-white/[0.1]'
                          }`} />
                        ))}
                      </div>

                      <span className="text-[11px] text-zinc-400 font-mono flex-shrink-0">{shot.duration}s</span>

                      {activeCastMembers.length > 0 && (
                        <span className="text-[11px] text-zinc-400 truncate">{activeCastMembers.map(c => c.name).join(', ')}</span>
                      )}

                      {shotIdx > 0 && (
                        <button
                          onClick={() => onUpdateShot(activeScene.id, shot.id, { continuityFrom: shot.continuityFrom === 'prev_shot' ? 'cut' : 'prev_shot' } as any)}
                          className={`text-[11px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded transition-colors flex-shrink-0 ${
                            shot.continuityFrom === 'prev_shot'
                              ? 'text-amber-400/80 bg-amber-500/10'
                              : 'text-zinc-400 hover:text-zinc-400'
                          }`}
                        >
                          {shot.continuityFrom === 'prev_shot' ? 'chain' : 'cut'}
                        </button>
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

                      {/* Regen frame */}
                      <button
                        onClick={() => onGenerateImage(activeScene.id, shot.id)}
                        disabled={isGenerating || (!actionable && !shot.locked)}
                        className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-30 flex items-center gap-1"
                        title={hasStartFrame ? 'Regenerate start frame' : 'Generate start frame'}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                          <circle cx="9" cy="9" r="2"/>
                          <path d="M21 15l-5-5L5 21"/>
                        </svg>
                        <span className="text-[11px] hidden sm:inline">{hasStartFrame ? 'Regen' : 'Frame'}</span>
                      </button>

                      {/* Regen video */}
                      <button
                        onClick={() => onGenerateVideo(activeScene.id, shot.id)}
                        disabled={!canGenerateVideo && !shot.locked || isGenerating}
                        className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-30 flex items-center gap-1"
                        title={hasVideo ? 'Regenerate video' : 'Generate video'}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polygon points="23 7 16 12 23 17 23 7"/>
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                        </svg>
                        <span className="text-[11px] hidden sm:inline">{hasVideo ? 'Regen' : 'Video'}</span>
                      </button>

                      {/* Lock / Unlock — standard place, standard icon */}
                      <button
                        onClick={() => onLockShot(activeScene.id, shot.id)}
                        disabled={isGenerating || (!shot.locked && !canLock)}
                        className={`p-1.5 rounded transition-colors flex items-center gap-1 ${
                          shot.locked
                            ? 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
                            : canLock
                              ? 'bg-white text-black hover:bg-zinc-200'
                              : 'text-zinc-400'
                        } disabled:opacity-30`}
                        title={shot.locked ? 'Unlock shot — allow edits' : canLock ? 'Lock shot' : 'Generate start frame + video first to lock'}
                      >
                        {shot.locked ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                          </svg>
                        )}
                        <span className="text-[11px] hidden sm:inline">{shot.locked ? 'Unlock' : 'Lock'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Body — collapses when not expanded */}
                  {isExpanded && <>
                  {/* Media: Video or Frames */}
                  <div className="relative">
                    {shot.videoUrl && !showFrames[shot.id] ? (
                      <div className="bg-black">
                        <video src={shot.videoUrl} controls loop playsInline className="w-full h-auto" />
                      </div>
                    ) : hasVideo && (shot.extractedLastFrameUrl || shot.endImageUrl) ? (
                      // Post-video: show start + extracted last frame side-by-side
                      <div className="flex">
                        <div className="flex-1 relative bg-black min-h-[120px]">
                          <div className="absolute top-2 left-2 z-20">
                            <span className="text-[11px] bg-black/60 text-zinc-400 px-1.5 py-0.5 rounded-md uppercase font-medium">Start</span>
                          </div>
                          {shot.imageUrl && (
                            <img src={shot.imageUrl} alt={`Shot ${shotIdx + 1} start frame`} onClick={() => setModalImage(shot.imageUrl!)} className="w-full h-auto cursor-zoom-in" />
                          )}
                        </div>
                        <div className="w-px bg-white/[0.06] flex-shrink-0" />
                        <div className="flex-1 relative bg-black min-h-[120px] group/last">
                          <div className="absolute top-2 left-2 z-20">
                            <span className="text-[11px] bg-black/60 text-emerald-300/80 px-1.5 py-0.5 rounded-md uppercase font-medium">End (from video)</span>
                          </div>
                          <img
                            src={shot.extractedLastFrameUrl || shot.endImageUrl!}
                            alt={`Shot ${shotIdx + 1} last frame`}
                            onClick={() => setModalImage((shot.extractedLastFrameUrl || shot.endImageUrl)!)}
                            className={`w-full h-auto cursor-zoom-in ${!shot.extractedLastFrameUrl ? 'opacity-70' : ''}`}
                          />
                          {/* Action: use this frame as next shot's start */}
                          {activeScene.shots[shotIdx + 1] && shot.extractedLastFrameUrl && onUsePrevLastFrame && (
                            <div className="absolute bottom-2 right-2 z-20 opacity-0 group-hover/last:opacity-100 transition-opacity">
                              <button
                                onClick={() => {
                                  // Silent replace — easy to regen the frame if user regrets it.
                                  onUsePrevLastFrame(activeScene.shots[shotIdx + 1].id);
                                }}
                                className="text-[11px] bg-white/90 text-black px-2 py-1 rounded-md font-medium hover:bg-white transition-colors"
                                title="Copy this frame directly as the next shot's start frame — skips image generation for seamless continuity"
                              >
                                → Use for next shot
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      // Pre-video: just show the start frame full width (no confusing empty slot)
                      <div className="relative bg-black min-h-[160px]">
                        {shot.imageUrl ? (
                          <>
                            <div className="absolute top-2 left-2 z-20">
                              <span className="text-[11px] bg-black/60 text-zinc-400 px-1.5 py-0.5 rounded-md uppercase font-medium">Start Frame</span>
                            </div>
                            <img src={shot.imageUrl} alt={`Shot ${shotIdx + 1} start frame`} onClick={() => setModalImage(shot.imageUrl!)} className="w-full h-auto cursor-zoom-in mx-auto max-h-[400px] object-contain" />
                          </>
                        ) : (
                          <div className="w-full min-h-[160px] flex items-center justify-center text-zinc-400">
                            <span className="text-xs">No start frame — click &quot;Frame&quot; to generate</span>
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

                    {/* Error */}
                    {isError && !isGenerating && (
                      <div className="absolute bottom-2 left-2 right-2 bg-red-500/10 border border-red-500/20 rounded-md px-2 py-1 z-20">
                        <p className="text-xs text-red-300">Generation failed</p>
                      </div>
                    )}

                    {/* Loading overlay */}
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
                      </div>
                    )}

                    {/* Not actionable — only for continuity-linked shots waiting on prev video */}
                    {!actionable && !isGenerating && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
                        <span className="text-xs text-zinc-400">Waiting on previous shot's video (continuity)</span>
                      </div>
                    )}
                  </div>

                  {/* Prompts — full width below media */}
                  <div className="px-5 py-4 space-y-4 border-t border-white/[0.06]">

                    {/* Prompts — toggle between Image / Motion / Compiled */}
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

                      const compiledText = [
                        `Scene: ${shot.visualPrompt}`,
                        `\nStyle: ${project?.styleDescription || '(none)'}`,
                        shot.continuityFrom === 'prev_shot' ? '\nContinue visual flow from previous shot.' : '',
                        shot.userFeedback ? `\nDirector note: ${shot.userFeedback}` : '',
                      ].filter(Boolean).join('\n');

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
                        : activeTab === 'image' ? shot.visualPrompt : shot.motionPrompt;

                      return (
                        <div className="space-y-3">
                          <div className="flex items-center gap-4">
                            <button
                              onClick={() => setPromptTab(prev => ({ ...prev, [shot.id]: 'image' }))}
                              className={`text-sm font-medium transition-colors ${activeTab === 'image' ? 'text-white' : 'text-zinc-400 hover:text-zinc-400'}`}
                            >Image</button>
                            <button
                              onClick={() => setPromptTab(prev => ({ ...prev, [shot.id]: 'motion' }))}
                              className={`text-sm font-medium transition-colors ${activeTab === 'motion' ? 'text-white' : 'text-zinc-400 hover:text-zinc-400'}`}
                            >Motion</button>
                            <button
                              onClick={() => setPromptTab(prev => ({ ...prev, [shot.id]: 'video' }))}
                              className={`text-sm font-medium transition-colors ${activeTab === 'video' ? 'text-white' : 'text-zinc-400 hover:text-zinc-400'}`}
                            >Video</button>
                            <button
                              onClick={() => setPromptTab(prev => ({ ...prev, [shot.id]: 'compiled' }))}
                              className={`text-sm font-medium transition-colors ${activeTab === 'compiled' ? 'text-white' : 'text-zinc-400 hover:text-zinc-400'}`}
                            >Compiled</button>
                          </div>

                          {/* Reference chips — informational: these refs are attached to this call */}
                          {activeTab === 'image' && !shot.locked && (() => {
                            const allRefs: { label: string; url?: string }[] = [];
                            shotCast.forEach(c => {
                              if (c.referenceImageUrl) allRefs.push({ label: c.name, url: c.referenceImageUrl });
                            });
                            if (shotEnv?.referenceImageUrl) allRefs.push({ label: shotEnv.name, url: shotEnv.referenceImageUrl });
                            if (project?.styleAssetUrl) allRefs.push({ label: 'Style', url: project.styleAssetUrl });

                            if (allRefs.length === 0) return null;

                            return (
                              <div className="space-y-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[11px] text-zinc-400 mr-1">Attached refs:</span>
                                  {allRefs.map((ref, i) => (
                                    <div
                                      key={i}
                                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border border-white/[0.08] text-zinc-300 bg-white/[0.02]"
                                      title={`${ref.label} — sent as a reference image to the model`}
                                    >
                                      {ref.url && <img src={ref.url} className="w-4 h-4 rounded-sm object-cover" alt="" />}
                                      <span>{ref.label}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}

                          {activeTab === 'video' ? (
                            <div className="space-y-3">
                              <div className="text-[11px] text-zinc-400">
                                This is the full prompt sent to {project?.videoModel?.includes('seedance') ? 'Seedance' : 'Veo'} with the start frame. Edit to override.
                              </div>
                              <textarea
                                value={videoOverride[shot.id] ?? autoVeoPrompt}
                                onChange={e => setVideoOverride(prev => ({ ...prev, [shot.id]: e.target.value }))}
                                className="w-full surface-inset rounded-md p-3 text-xs text-zinc-300 font-mono leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 resize-none h-32"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    const override = videoOverride[shot.id];
                                    onGenerateVideo(activeScene.id, shot.id, override && override !== autoVeoPrompt ? override : undefined);
                                  }}
                                  disabled={!hasStartFrame || isGenerating}
                                  className="px-3 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-30 transition-colors"
                                >
                                  Regenerate with this custom prompt
                                </button>
                                {videoOverride[shot.id] && videoOverride[shot.id] !== autoVeoPrompt && (
                                  <button
                                    onClick={() => setVideoOverride(prev => { const { [shot.id]: _, ...rest } = prev; return rest; })}
                                    className="text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors"
                                  >
                                    Reset to auto
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : activeTab === 'compiled' ? (
                            <div className="space-y-3">
                              <pre className="surface-inset rounded-md p-3 text-[11px] text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">{compiledText}</pre>
                              {compiledRefs.length > 0 && (
                                <div className="flex gap-2 flex-wrap">
                                  {compiledRefs.map((ref, i) => (
                                    <div key={i} className="relative">
                                      {ref.url ? (
                                        <img src={ref.url} className="w-14 h-14 object-cover rounded-md border border-white/[0.06]" alt={ref.label} />
                                      ) : (
                                        <div className="w-14 h-14 rounded-md border border-white/[0.06] bg-white/[0.02] flex items-center justify-center text-[11px] text-zinc-400">?</div>
                                      )}
                                      <div className="absolute inset-x-0 bottom-0 bg-black/80 text-[11px] text-zinc-400 px-1 py-0.5 rounded-b-md truncate text-center">{ref.label}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : shot.locked ? (
                            <p className="text-sm text-zinc-400 leading-relaxed">{promptText}</p>
                          ) : (
                            <>
                              <textarea
                                id={activeTab === 'image' ? `prompt-${shot.id}` : undefined}
                                value={promptText}
                                onChange={(e) => onUpdateShot(activeScene.id, shot.id, activeTab === 'image' ? { visualPrompt: e.target.value } : { motionPrompt: e.target.value })}
                                className="w-full surface-inset rounded-md p-3 text-sm text-zinc-300 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 resize-none h-28"
                              />
                              {hasStartFrame && (
                                <div className="flex gap-2">
                                  <input
                                    id={`refine-${shot.id}`}
                                    placeholder="What's wrong? e.g. 'face not crisp, lighting too flat'"
                                    className="flex-1 surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                                        onRefinePrompt(activeScene.id, shot.id, (e.target as HTMLInputElement).value);
                                        (e.target as HTMLInputElement).value = '';
                                      }
                                    }}
                                  />
                                  <button
                                    onClick={() => {
                                      const input = document.getElementById(`refine-${shot.id}`) as HTMLInputElement;
                                      if (input?.value.trim()) {
                                        onRefinePrompt(activeScene.id, shot.id, input.value);
                                        input.value = '';
                                      }
                                    }}
                                    className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-400 hover:text-white rounded-md text-xs font-medium transition-colors flex-shrink-0"
                                  >
                                    Refine
                                  </button>
                                </div>
                              )}
                            </>
                          )}
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
      </AnimatePresence>

      <AnimatePresence>
        {modalImage && <ImageModal src={modalImage} onClose={() => setModalImage(null)} />}
      </AnimatePresence>
    </div>
  );
};
