
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { VideoScene, VideoShot, ApiProject } from '../types';
import { ImageModal } from './ImageModal';
import { ShotCard } from './ShotCard';
import { StudioHeader } from './StudioHeader';
import type { ShotRefInput } from '../services/api';
import { getVideoModel } from '../constants/videoModels';

interface Props {
  scenes: VideoScene[];
  project: ApiProject | null;
  activeSceneIdx: number;
  onSceneChange: (idx: number) => void;
  onUpdateShot: (sceneId: string, shotId: string, updates: Partial<VideoShot>) => void;
  onGenerateImage: (sceneId: string, shotId: string, refs?: ShotRefInput[]) => void;
  onGenerateVideo: (sceneId: string, shotId: string, promptOverride?: string, refs?: ShotRefInput[]) => void;
  onLockShot: (sceneId: string, shotId: string) => void;
  onRefinePrompt: (sceneId: string, shotId: string, feedback: string, referenceImage?: File) => void | Promise<void>;
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
  onGenerateEndFrame?: (shotId: string, refs?: ShotRefInput[]) => void | Promise<void>;
  onClearEndFrame?: (shotId: string) => void | Promise<void>;
  onClearExtractedFrame?: (shotId: string) => void | Promise<void>;
  onUploadEndFrame?: (shotId: string, file: File) => void | Promise<void>;
  onRefineEndFramePrompt?: (shotId: string, feedback: string) => void | Promise<void>;
  onRefineVideoPrompt?: (shotId: string, feedback: string) => void | Promise<void>;
  onUploadShotRef?: (shotId: string, file: File) => void | Promise<void>;
  onDeleteShotRef?: (shotId: string, assetId: string) => void | Promise<void>;
  onSetProject?: (project: ApiProject) => void;
  frameQueue?: string[];
  videoQueue?: string[];
  isLoading?: boolean;
}

export const Storyboard: React.FC<Props> = ({ scenes, project, activeSceneIdx, onSceneChange, onUpdateShot, onGenerateImage, onGenerateVideo, onLockShot, onRefinePrompt, onUpdateProject, onRewriteShotPrompts, onBulkGenerateFrames, onBulkGenerateVideos, onCancelShotImage, onCancelShotVideo, onUsePrevLastFrame, onClearShotFrame, onRevertVideo, onUseAsPrevEnd, onGenerateEndFrame, onClearEndFrame, onClearExtractedFrame, onUploadEndFrame, onRefineEndFramePrompt, onRefineVideoPrompt, onUploadShotRef, onDeleteShotRef, onSetProject, frameQueue, videoQueue, isLoading }) => {
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [promptTab, setPromptTab] = useState<Record<string, 'image' | 'endframe' | 'video' | 'compiled'>>({});
  const [videoOverride, setVideoOverride] = useState<Record<string, string>>({});
  const [expandedShotIds, setExpandedShotIds] = useState<Set<string>>(new Set());
  const [historyOpenFor, setHistoryOpenFor] = useState<string | null>(null);
  const [refiningShots, setRefiningShots] = useState<Set<string>>(new Set());
  const [shotRefs, setShotRefs] = useState<Record<string, ShotRefInput[]>>({});

  const modelSupportsLastFrame = getVideoModel(project?.videoModel).supportsLastFrame;

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

  const isShotActionable = (scene: VideoScene, shotIdx: number): boolean => {
    const shot = scene.shots[shotIdx];
    if (shotIdx === 0) return true;
    if (shot?.continuityFrom !== 'prev_shot') return true;
    return !!scene.shots[shotIdx - 1]?.videoUrl;
  };

  if (scenes.length === 0) return null;

  return (
    <div className="max-w-5xl mx-auto pb-32">
      <StudioHeader
        scenes={scenes}
        project={project}
        activeSceneIdx={activeSceneIdx}
        onSceneChange={onSceneChange}
        onUpdateShot={onUpdateShot}
        onRewriteShotPrompts={onRewriteShotPrompts}
        onBulkGenerateFrames={onBulkGenerateFrames}
        onBulkGenerateVideos={onBulkGenerateVideos}
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
              <span className="text-xs text-zinc-400">{scene.sectionLabel}</span>
            </div>
            {scene.narrativeDescription && (
              <p className="text-sm text-zinc-400 max-w-3xl">{scene.narrativeDescription}</p>
            )}
          </div>

          <div className="space-y-4">
            {scene.shots.map((shot, shotIdx) => {
              const activeTab = promptTab[shot.id] || 'image';
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
                  isRefining={refiningShots.has(`${activeTab}:${shot.id}`)}
                  onRefineStart={key => setRefiningShots(prev => new Set(prev).add(key))}
                  onRefineEnd={key => setRefiningShots(prev => { const next = new Set(prev); next.delete(key); return next; })}
                  frameQueue={frameQueue}
                  videoQueue={videoQueue}
                  onUpdateShot={onUpdateShot}
                  onGenerateImage={onGenerateImage}
                  onGenerateVideo={onGenerateVideo}
                  onLockShot={onLockShot}
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
                  onUploadEndFrame={onUploadEndFrame}
                  onUploadShotRef={onUploadShotRef}
                  onDeleteShotRef={onDeleteShotRef}
                  onSetProject={onSetProject}
                  setModalImage={setModalImage}
                />
              );
            })}
          </div>
        </motion.div>
      ))}
      </div>

      <AnimatePresence>
        {modalImage && <ImageModal src={modalImage} onClose={() => setModalImage(null)} />}
      </AnimatePresence>
    </div>
  );
};
