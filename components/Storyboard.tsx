
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { VideoScene, VideoShot, ApiProject } from '../types';
import { ImageModal } from './ImageModal';
import { ShotCard } from './ShotCard';
import { StudioHeader } from './StudioHeader';
import { StudioShotNav } from './StudioShotNav';
import type { ShotRefInput, StoryboardRefineMode } from '../services/api';
import { getVideoModel } from '../constants/videoModels';

interface Props {
  scenes: VideoScene[];
  project: ApiProject | null;
  activeSceneIdx: number;
  onSceneChange: (idx: number) => void;
  onUpdateShot: (sceneId: string, shotId: string, updates: Partial<VideoShot>) => void;
  onGenerateImage: (sceneId: string, shotId: string, refs?: ShotRefInput[]) => void;
  onGenerateVideo: (sceneId: string, shotId: string, promptOverride?: string, refs?: ShotRefInput[]) => void;
  // Required — App.tsx always wires these. Keeping them optional would force
  // non-null asserts further down the tree (StoryboardPanel needs them).
  onWriteStoryboardPrompt: (shotId: string, feedback?: string) => void | Promise<void>;
  onGenerateStoryboard: (shotId: string) => void | Promise<void>;
  onRefineStoryboard: (shotId: string, feedback: string, previousVersionId?: string, refineMode?: StoryboardRefineMode, referenceImage?: File) => void | Promise<void>;
  onCancelStoryboard: (shotId: string) => void;
  onLockStoryboard: (shotId: string, versionId?: string) => void | Promise<void>;
  onUnlockStoryboard: (shotId: string) => void | Promise<void>;
  onUpdateStoryboardPlan: (shotId: string, cutPlanText: string, storyboardPrompt?: string) => Promise<void>;
  onLockShot: (sceneId: string, shotId: string) => void | Promise<void>;
  onRefinePrompt: (sceneId: string, shotId: string, feedback: string, referenceImage?: File) => void | Promise<void>;
  onUpdateProject?: (updates: Record<string, any>) => void;
  onRewriteShotPrompts?: (userNote?: string) => void;
  onCancelRewritePrompts?: () => void;
  onBulkGenerateFrames?: () => Promise<void> | void;
  onBulkGenerateVideos?: () => Promise<void> | void;
  onBulkWriteStoryboardPrompts?: () => Promise<void> | void;
  onBulkGenerateStoryboards?: () => Promise<void> | void;
  onCancelBulk?: () => void;
  bulkStopNotice?: string | null;
  onCancelShotImage?: (shotId: string) => void;
  onCancelShotVideo?: (shotId: string) => void;
  onUsePrevLastFrame?: (shotId: string) => void;
  onClearShotFrame?: (shotId: string) => void;
  onRevertVideo?: (shotId: string, assetId: string) => void | Promise<void>;
  onUseAsPrevEnd?: (shotId: string) => void | Promise<void>;
  onGenerateEndFrame?: (shotId: string, refs?: ShotRefInput[]) => void | Promise<void>;
  onClearEndFrame?: (shotId: string) => void | Promise<void>;
  onClearExtractedFrame?: (shotId: string) => void | Promise<void>;
  onUploadStartFrame?: (shotId: string, file: File) => void | Promise<void>;
  onUploadEndFrame?: (shotId: string, file: File) => void | Promise<void>;
  onUploadStoryboardImage?: (shotId: string, file: File) => void | Promise<void>;
  onRefineEndFramePrompt?: (shotId: string, feedback: string, referenceImage?: File) => void | Promise<void>;
  onRefineVideoPrompt?: (shotId: string, feedback: string, referenceImage?: File) => void | Promise<void>;
  onUploadShotRef?: (shotId: string, file: File) => void | Promise<void>;
  onDeleteShotRef?: (shotId: string, assetId: string) => void | Promise<void>;
  onSetProject?: (project: ApiProject) => void;
  /** T6.8: lipsync-blocked chip click on a ShotCard. AppShell routes back to
   *  Blueprint Audio phase. */
  onJumpToAudioPhase?: () => void;
  /** Opens the X-Ray panel scoped to one shot's generations. */
  onOpenShotXray?: (shotId: string, shotLabel: string) => void;
  frameQueue?: string[];
  videoQueue?: string[];
  storyboardPromptQueue?: string[];
  storyboardImageQueue?: string[];
  isLoading?: boolean;
}

export const Storyboard: React.FC<Props> = ({ scenes, project, activeSceneIdx, onSceneChange, onUpdateShot, onGenerateImage, onGenerateVideo, onWriteStoryboardPrompt, onGenerateStoryboard, onRefineStoryboard, onCancelStoryboard, onLockStoryboard, onUnlockStoryboard, onUpdateStoryboardPlan, onLockShot, onRefinePrompt, onUpdateProject, onRewriteShotPrompts, onCancelRewritePrompts, onBulkGenerateFrames, onBulkGenerateVideos, onBulkWriteStoryboardPrompts, onBulkGenerateStoryboards, onCancelBulk, bulkStopNotice, onCancelShotImage, onCancelShotVideo, onUsePrevLastFrame, onClearShotFrame, onRevertVideo, onUseAsPrevEnd, onGenerateEndFrame, onClearEndFrame, onClearExtractedFrame, onUploadStartFrame, onUploadEndFrame, onUploadStoryboardImage, onRefineEndFramePrompt, onRefineVideoPrompt, onUploadShotRef, onDeleteShotRef, onSetProject, onJumpToAudioPhase, onOpenShotXray, frameQueue, videoQueue, storyboardPromptQueue, storyboardImageQueue, isLoading }) => {
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [promptTab, setPromptTab] = useState<Record<string, 'image' | 'endframe' | 'video'>>({});
  const [videoOverride, setVideoOverride] = useState<Record<string, string>>({});
  const [expandedShotIds, setExpandedShotIds] = useState<Set<string>>(new Set());
  const [historyOpenFor, setHistoryOpenFor] = useState<string | null>(null);
  const [refiningShots, setRefiningShots] = useState<Set<string>>(new Set());
  const [shotRefs, setShotRefs] = useState<Record<string, ShotRefInput[]>>({});
  const [activeShotId, setActiveShotId] = useState<string | null>(null);
  // Slice D of button-feedback-audit (L13): per-shot lock-in-flight indicator.
  // The lock icon already swaps optimistically in AppShell.handleLockShot, but
  // there's no signal that the network request itself is still working. This
  // keyed pending lets ShotCard overlay a small spinner on the row whose
  // lock/unlock is currently in flight — separate from isGenerating.
  const [lockingShotId, setLockingShotId] = useState<string | null>(null);
  const handleLockShotWithPending = React.useCallback(async (sceneId: string, shotId: string) => {
    if (lockingShotId === shotId) return;
    setLockingShotId(shotId);
    try { await Promise.resolve(onLockShot(sceneId, shotId)); }
    finally { setLockingShotId(prev => prev === shotId ? null : prev); }
  }, [lockingShotId, onLockShot]);

  const modelSpec = getVideoModel(project?.videoModel);
  const modelSupportsLastFrame = modelSpec.supportsLastFrame;
  const storyboardSupported = !!project?.videoModel?.startsWith('seedance');
  const [studioMode, setStudioMode] = useState<'storyboard' | 'keyframe'>(storyboardSupported ? 'storyboard' : 'keyframe');

  React.useEffect(() => {
    if (!storyboardSupported) setStudioMode('keyframe');
  }, [storyboardSupported, project?.id]);

  // Build default refs for a shot+tab combo
  const getDefaultRefs = (shot: VideoShot, tab: 'image' | 'endframe' | 'video'): ShotRefInput[] => {
    const refs: ShotRefInput[] = [];
    const shotCast = (project?.cast || []).filter(c => (shot.castIds || []).includes(c.id));
    const shotEnv = shot.environmentId ? project?.environments?.find(e => e.id === shot.environmentId) : null;
    if (tab === 'image') {
      shotCast.forEach(c => { if (c.referenceImageUrl) refs.push({ type: 'cast', id: c.id }); });
      if (shotEnv?.referenceImageUrl) refs.push({ type: 'env', id: shotEnv.id });
      if (project?.styleAssetUrl) refs.push({ type: 'style' });
      if (shot.continuityFrom === 'prev_shot') refs.push({ type: 'continuity' });
    } else if (tab === 'endframe') {
      if (shot.imageUrl) refs.push({ type: 'start-frame' });
      shotCast.forEach(c => { if (c.referenceImageUrl) refs.push({ type: 'cast', id: c.id }); });
      if (shotEnv?.referenceImageUrl) refs.push({ type: 'env', id: shotEnv.id });
      if (project?.styleAssetUrl) refs.push({ type: 'style' });
    } else if (tab === 'video') {
      shotCast.forEach(c => { if (c.referenceImageUrl) refs.push({ type: 'cast', id: c.id }); });
      if (shotEnv?.referenceImageUrl) refs.push({ type: 'env', id: shotEnv.id });
    }
    (shot.refImages || []).forEach(r => refs.push({ type: 'uploaded', id: r.id }));
    return refs;
  };

  const getActiveRefs = (shot: VideoShot, tab: 'image' | 'endframe' | 'video'): ShotRefInput[] => {
    const key = `${tab}:${shot.id}`;
    if (shotRefs[key]) return shotRefs[key];
    return getDefaultRefs(shot, tab);
  };

  const setActiveRefs = (shotId: string, tab: string, refs: ShotRefInput[]) => {
    setShotRefs(prev => ({ ...prev, [`${tab}:${shotId}`]: refs }));
  };

  const resolveRefDisplay = (ref: ShotRefInput, shot: VideoShot): { label: string; url?: string; removable: boolean } => {
    if (ref.type === 'cast') { const c = project?.cast?.find(m => m.id === ref.id); return { label: c?.name || 'Character', url: c?.referenceImageUrl, removable: true }; }
    if (ref.type === 'env') { const e = project?.environments?.find(en => en.id === ref.id); return { label: e?.name || 'Environment', url: e?.referenceImageUrl, removable: true }; }
    if (ref.type === 'style') return { label: 'Style', url: project?.styleAssetUrl, removable: true };
    if (ref.type === 'start-frame') return { label: 'Start frame', url: shot.imageUrl, removable: true };
    if (ref.type === 'end-frame') return { label: 'End frame', url: shot.endImageUrl || shot.extractedLastFrameUrl, removable: true };
    if (ref.type === 'continuity') return { label: 'Continuity', url: shot.extractedLastFrameUrl, removable: true };
    if (ref.type === 'uploaded') { const r = (shot.refImages || []).find(ri => ri.id === ref.id); return { label: 'Ref', url: r?.url, removable: true }; }
    return { label: '?', removable: false };
  };

  // Solo-play: pause other videos when one starts
  React.useEffect(() => {
    const onPlay = (e: Event) => {
      const target = e.target;
      if (!(target instanceof HTMLVideoElement)) return;
      document.querySelectorAll('video').forEach(v => { if (v !== target && !v.paused) v.pause(); });
    };
    document.addEventListener('play', onPlay, true);
    return () => document.removeEventListener('play', onPlay, true);
  }, []);

  // Auto-expand first unlocked shot on load
  React.useEffect(() => {
    if (expandedShotIds.size > 0) return;
    const firstUnlocked = scenes.flatMap(s => s.shots).find(s => !s.locked);
    if (firstUnlocked) setExpandedShotIds(new Set([firstUnlocked.id]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes.length]);

  const toggleExpanded = (shotId: string) => {
    setExpandedShotIds(prev => { const next = new Set(prev); if (next.has(shotId)) next.delete(shotId); else next.add(shotId); return next; });
  };

  // Track which shot is currently in view so the right-side StudioShotNav
  // can highlight it. Uses IntersectionObserver against each shot card's
  // outer wrapper (id="shot-<id>"). The observer rebuilds whenever the
  // shot list changes — cheap because there's at most a few dozen shots.
  React.useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    const allShotIds = scenes.flatMap(s => s.shots.map(sh => sh.id));
    if (allShotIds.length === 0) return;

    // Track each shot's ratio so we can pick the most-visible one as active.
    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.shotId;
          if (!id) continue;
          ratios.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        // Pick the shot with the highest visible ratio. Ties (e.g. two
        // small shots both at 0.5) resolve by document order via the
        // allShotIds traversal.
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const id of allShotIds) {
          const r = ratios.get(id) || 0;
          if (r > bestRatio) { bestRatio = r; bestId = id; }
        }
        if (bestRatio > 0) setActiveShotId(bestId);
      },
      // Bias toward the upper half of the viewport so "active" reflects
      // what the artist is reading rather than what's at the bottom edge.
      { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '-20% 0px -50% 0px' }
    );

    const elements: HTMLElement[] = [];
    for (const id of allShotIds) {
      const el = document.getElementById(`shot-${id}`);
      if (el) { observer.observe(el); elements.push(el); }
    }
    return () => {
      for (const el of elements) observer.unobserve(el);
      observer.disconnect();
    };
    // Re-observe on shot count or order change. Stringifying the id list
    // keeps the dep stable across reference-only changes.
  }, [scenes.map(s => s.shots.map(sh => sh.id).join(',')).join('|')]);

  const jumpToShot = (shotId: string) => {
    setExpandedShotIds(prev => prev.has(shotId) ? prev : new Set(prev).add(shotId));
    // Defer scroll until the (potentially newly-expanded) card has laid out.
    requestAnimationFrame(() => {
      const el = document.getElementById(`shot-${shotId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const jumpToScene = (sceneId: string) => {
    const el = document.getElementById(`scene-${sceneId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const idx = scenes.findIndex(s => s.id === sceneId);
    if (idx >= 0) onSceneChange(idx);
  };

  const isShotActionable = (scene: VideoScene, shotIdx: number): boolean => {
    const shot = scene.shots[shotIdx];
    const isStoryboardMode = storyboardSupported && studioMode === 'storyboard';
    if (isStoryboardMode) return true;
    if (shotIdx === 0) return true;
    if (shot?.continuityFrom !== 'prev_shot') return true;
    return !!scene.shots[shotIdx - 1]?.videoUrl;
  };

  // Empty state instead of null — phase nav no longer locks Studio, so an
  // artist can land here before a shot plan exists.
  if (scenes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center py-24">
        <p className="text-sm text-zinc-400">
          No shots yet — write a script in Blueprint to plan your scenes first.
        </p>
      </div>
    );
  }

  const isStoryboardModeActive = storyboardSupported && studioMode === 'storyboard';

  return (
    <div className="max-w-5xl xl:max-w-7xl mx-auto pb-32 xl:flex xl:items-start xl:gap-6">
      <div className="flex-1 min-w-0">
      <StudioHeader
        scenes={scenes}
        project={project}
        onRewriteShotPrompts={onRewriteShotPrompts}
        onCancelRewritePrompts={onCancelRewritePrompts}
        onBulkGenerateFrames={onBulkGenerateFrames}
        onBulkGenerateVideos={onBulkGenerateVideos}
        onBulkWriteStoryboardPrompts={onBulkWriteStoryboardPrompts}
        onBulkGenerateStoryboards={onBulkGenerateStoryboards}
        onCancelBulk={onCancelBulk}
        bulkStopNotice={bulkStopNotice}
        studioMode={studioMode}
        onStudioModeChange={setStudioMode}
        storyboardSupported={storyboardSupported}
        onUpdateProject={onUpdateProject}
        isLoading={isLoading}
      />

      <div className="space-y-12">
      {scenes.map((scene, sceneIdx) => (
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
              <h2 className="text-lg font-display font-medium text-white">Scene {sceneIdx + 1}</h2>
              <span className="text-xs text-zinc-400 font-mono">{scene.startTime}–{scene.endTime}</span>
              {scene.sectionLabel && (
                <span className="text-xs text-zinc-400 ml-auto">{scene.sectionLabel}</span>
              )}
            </div>
            {scene.narrativeDescription && (
              <p className="text-sm text-zinc-400 max-w-3xl">{scene.narrativeDescription}</p>
            )}
          </div>

          <div className="space-y-4">
            {scene.shots.map((shot, shotIdx) => {
              const activeTab = promptTab[shot.id] || 'image';
              const isStoryboardMode = storyboardSupported && studioMode === 'storyboard';
              const refineKey = isStoryboardMode ? `storyboard:${shot.id}` : `${activeTab}:${shot.id}`;
              return (
                <ShotCard
                  key={shot.id}
                  project={project!}
                  shot={shot}
                  scene={scene}
                  shotIdx={shotIdx}
                  isExpanded={expandedShotIds.has(shot.id)}
                  onToggleExpand={() => toggleExpanded(shot.id)}
                  actionable={isShotActionable(scene, shotIdx)}
                  modelSupportsLastFrame={modelSupportsLastFrame}
                  studioMode={studioMode}
                  storyboardSupported={storyboardSupported}
                  historyOpen={historyOpenFor === shot.id}
                  onToggleHistory={() => setHistoryOpenFor(prev => prev === shot.id ? null : shot.id)}
                  onCloseHistory={() => setHistoryOpenFor(null)}
                  activeTab={activeTab}
                  onTabChange={tab => setPromptTab(prev => ({ ...prev, [shot.id]: tab }))}
                  videoOverride={videoOverride[shot.id]}
                  onVideoOverrideChange={v => {
                    if (v === undefined) setVideoOverride(prev => { const { [shot.id]: _, ...rest } = prev; return rest; });
                    else setVideoOverride(prev => ({ ...prev, [shot.id]: v }));
                  }}
                  getActiveRefs={getActiveRefs}
                  setActiveRefs={setActiveRefs}
                  resolveRefDisplay={resolveRefDisplay}
                  isRefining={refiningShots.has(refineKey)}
                  onRefineStart={key => setRefiningShots(prev => new Set(prev).add(key))}
                  onRefineEnd={key => setRefiningShots(prev => { const next = new Set(prev); next.delete(key); return next; })}
                  frameQueue={frameQueue}
                  videoQueue={videoQueue}
                  storyboardPromptQueue={storyboardPromptQueue}
                  storyboardImageQueue={storyboardImageQueue}
                  onUpdateShot={onUpdateShot}
                  onGenerateImage={onGenerateImage}
                  onGenerateVideo={onGenerateVideo}
                  onWriteStoryboardPrompt={onWriteStoryboardPrompt}
                  onGenerateStoryboard={onGenerateStoryboard}
                  onRefineStoryboard={onRefineStoryboard}
                  onCancelStoryboard={onCancelStoryboard}
                  onLockStoryboard={onLockStoryboard}
                  onUnlockStoryboard={onUnlockStoryboard}
                  onUpdateStoryboardPlan={onUpdateStoryboardPlan}
                  onLockShot={handleLockShotWithPending}
                  isLockingShot={lockingShotId === shot.id}
                  onRefinePrompt={onRefinePrompt}
                  onGenerateEndFrame={onGenerateEndFrame}
                  onRefineEndFramePrompt={onRefineEndFramePrompt}
                  onRefineVideoPrompt={onRefineVideoPrompt}
                  onCancelShotImage={onCancelShotImage}
                  onCancelShotVideo={onCancelShotVideo}
                  onUsePrevLastFrame={onUsePrevLastFrame}
                  onClearShotFrame={onClearShotFrame}
                  onRevertVideo={onRevertVideo}
                  onUseAsPrevEnd={onUseAsPrevEnd}
                  onClearEndFrame={onClearEndFrame}
                  onClearExtractedFrame={onClearExtractedFrame}
                  onUploadStartFrame={onUploadStartFrame}
                  onUploadEndFrame={onUploadEndFrame}
                  onUploadStoryboardImage={onUploadStoryboardImage}
                  onUploadShotRef={onUploadShotRef}
                  onDeleteShotRef={onDeleteShotRef}
                  onSetProject={onSetProject}
                  onJumpToAudioPhase={onJumpToAudioPhase}
                  onOpenShotXray={onOpenShotXray}
                  setModalImage={setModalImage}
                />
              );
            })}
          </div>
        </motion.div>
      ))}
      </div>
      </div>

      <StudioShotNav
        scenes={scenes}
        isStoryboardMode={isStoryboardModeActive}
        storyboardSupported={storyboardSupported}
        activeShotId={activeShotId}
        frameQueue={frameQueue}
        videoQueue={videoQueue}
        storyboardPromptQueue={storyboardPromptQueue}
        storyboardImageQueue={storyboardImageQueue}
        onJumpToShot={jumpToShot}
        onJumpToScene={jumpToScene}
      />

      <AnimatePresence>
        {modalImage && <ImageModal src={modalImage} onClose={() => setModalImage(null)} />}
      </AnimatePresence>
    </div>
  );
};
