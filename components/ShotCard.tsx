/**
 * ShotCard — extracted from Storyboard.tsx.
 * Single shot: expandable header, media display (video/frames), overlays,
 * version history, and prompt toolkit wiring.
 */
import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { VideoScene, VideoShot, GenerationStatus, ApiProject } from '../types';
import { ShotVideoPreview } from './ShotVideoPreview';
import { PromptToolkit } from './PromptToolkit';
import { StoryboardPanel, type StoryboardSubTab } from './StoryboardPanel';
import { ShotVersionHistory } from './ShotVersionHistory';
import type { ShotRefInput, StoryboardRefineMode } from '../services/api';

// "0:32" / "00:32" / "1:23:45" → seconds.
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

interface ShotCardProps {
  project: ApiProject;
  shot: VideoShot;
  scene: VideoScene;
  shotIdx: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  actionable: boolean;
  modelSupportsLastFrame: boolean;
  studioMode: 'storyboard' | 'keyframe';
  storyboardSupported: boolean;

  // History
  historyOpen: boolean;
  onToggleHistory: () => void;
  onCloseHistory: () => void;

  // Prompt toolkit state (parent-owned)
  activeTab: 'image' | 'endframe' | 'video';
  onTabChange: (tab: 'image' | 'endframe' | 'video') => void;
  videoOverride?: string;
  onVideoOverrideChange: (v: string | undefined) => void;
  getActiveRefs: (shot: VideoShot, tab: 'image' | 'endframe' | 'video') => ShotRefInput[];
  setActiveRefs: (shotId: string, tab: string, refs: ShotRefInput[]) => void;
  resolveRefDisplay: (ref: ShotRefInput, shot: VideoShot) => { label: string; url?: string; removable: boolean };
  isRefining: boolean;
  onRefineStart: (key: string) => void;
  onRefineEnd: (key: string) => void;

  // Queue position
  frameQueue?: string[];
  videoQueue?: string[];
  storyboardPromptQueue?: string[];
  storyboardImageQueue?: string[];

  // Callbacks
  onUpdateShot: (sceneId: string, shotId: string, updates: Partial<VideoShot>) => void;
  onGenerateImage: (sceneId: string, shotId: string, refs?: ShotRefInput[]) => void;
  onGenerateVideo: (sceneId: string, shotId: string, promptOverride?: string, refs?: ShotRefInput[]) => void;
  // Required at this boundary — Storyboard.tsx always wires these. Optionality
  // here would force `!` non-null asserts inside StoryboardPanel.
  onWriteStoryboardPrompt: (shotId: string, feedback?: string) => void | Promise<void>;
  onGenerateStoryboard: (shotId: string) => void | Promise<void>;
  onRefineStoryboard: (shotId: string, feedback: string, previousVersionId?: string, refineMode?: StoryboardRefineMode, referenceImage?: File) => void | Promise<void>;
  onCancelStoryboard: (shotId: string) => void;
  onLockStoryboard: (shotId: string, versionId?: string) => void | Promise<void>;
  onUnlockStoryboard: (shotId: string) => void | Promise<void>;
  onUpdateStoryboardPlan: (shotId: string, cutPlanText: string, storyboardPrompt?: string) => Promise<void>;
  onLockShot: (sceneId: string, shotId: string) => void;
  onRefinePrompt: (sceneId: string, shotId: string, feedback: string) => void | Promise<void>;
  onGenerateEndFrame?: (shotId: string, refs?: ShotRefInput[]) => void | Promise<void>;
  onRefineEndFramePrompt?: (shotId: string, feedback: string, referenceImage?: File) => void | Promise<void>;
  onRefineVideoPrompt?: (shotId: string, feedback: string, referenceImage?: File) => void | Promise<void>;
  onCancelShotImage?: (shotId: string) => void;
  onCancelShotVideo?: (shotId: string) => void;
  onUsePrevLastFrame?: (shotId: string) => void;
  onClearShotFrame?: (shotId: string) => void;
  onRevertVideo?: (shotId: string, assetId: string) => void | Promise<void>;
  onUseAsPrevEnd?: (shotId: string) => void | Promise<void>;
  onClearEndFrame?: (shotId: string) => void | Promise<void>;
  onClearExtractedFrame?: (shotId: string) => void | Promise<void>;
  onUploadEndFrame?: (shotId: string, file: File) => void | Promise<void>;
  onUploadShotRef?: (shotId: string, file: File) => void | Promise<void>;
  onDeleteShotRef?: (shotId: string, assetId: string) => void | Promise<void>;
  onSetProject?: (project: ApiProject) => void;
  setModalImage: (url: string | null) => void;
}

export const ShotCard: React.FC<ShotCardProps> = ({
  project, shot, scene, shotIdx, isExpanded, onToggleExpand, actionable, modelSupportsLastFrame, studioMode, storyboardSupported,
  historyOpen, onToggleHistory, onCloseHistory,
  activeTab, onTabChange, videoOverride, onVideoOverrideChange,
  getActiveRefs, setActiveRefs, resolveRefDisplay,
  isRefining, onRefineStart, onRefineEnd,
  frameQueue, videoQueue, storyboardPromptQueue, storyboardImageQueue,
  onUpdateShot, onGenerateImage, onGenerateVideo, onLockShot, onRefinePrompt,
  onWriteStoryboardPrompt, onGenerateStoryboard, onRefineStoryboard, onCancelStoryboard, onLockStoryboard, onUnlockStoryboard, onUpdateStoryboardPlan,
  onGenerateEndFrame, onRefineEndFramePrompt, onRefineVideoPrompt,
  onCancelShotImage, onCancelShotVideo, onUsePrevLastFrame, onClearShotFrame,
  onRevertVideo, onUseAsPrevEnd, onClearEndFrame, onClearExtractedFrame,
  onUploadEndFrame, onUploadShotRef, onDeleteShotRef, onSetProject, setModalImage,
}) => {
  // Local state
  const [showFrames, setShowFrames] = useState(false);
  // Single source of truth for which storyboard sub-tab is active. Owned here
  // (not in StoryboardPanel) so the media area above and the controls below
  // switch together. Click "Video" → media swaps to the generated clip; click
  // "Storyboard" → media swaps back to the board image. Only meaningful when
  // isStoryboardMode is true; ignored otherwise.
  //
  // Initial default: if a video already exists, the artist is likely
  // reviewing the finished result, so land on Video. Otherwise start on
  // Storyboard where the planning/generation happens. State persists from
  // that point — no auto-switching mid-workflow.
  const [storyboardSubTab, setStoryboardSubTab] = useState<StoryboardSubTab>(
    shot.videoUrl ? 'video' : 'storyboard',
  );
  const endFrameFileRef = useRef<HTMLInputElement>(null);

  const isStoryboardMode = storyboardSupported && studioMode === 'storyboard';
  const isGenerating = shot.imageStatus === GenerationStatus.LOADING || shot.videoStatus === GenerationStatus.LOADING || shot.endImageStatus === GenerationStatus.LOADING || shot.storyboardStatus === GenerationStatus.LOADING || shot.storyboardPromptStatus === GenerationStatus.LOADING || shot.imageStatus === GenerationStatus.CRITIQUING;
  const isError = shot.imageStatus === GenerationStatus.ERROR || shot.videoStatus === GenerationStatus.ERROR || shot.storyboardStatus === GenerationStatus.ERROR || shot.storyboardPromptStatus === GenerationStatus.ERROR;
  const activeCastMembers = project.cast.filter(c => shot.castIds?.includes(c.id)) || [];
  const hasStartFrame = !!shot.imageUrl;
  const hasVideo = !!shot.videoUrl;
  const hasStoryboard = !!shot.storyboardUrl;
  const canGenerateVideo = isStoryboardMode ? !!shot.storyboardLocked && hasStoryboard && !isGenerating : hasStartFrame && !isGenerating;
  const canLock = isStoryboardMode ? !!shot.storyboardLocked && hasVideo && !shot.locked : hasStartFrame && hasVideo && !shot.locked;
  // In storyboard mode the storyboard image stands in for the start frame —
  // show it as soon as it exists, alongside any video that gets generated.
  const showMediaSection = isStoryboardMode ? (hasStoryboard || hasVideo || shot.storyboardStatus === GenerationStatus.LOADING || shot.videoStatus === GenerationStatus.LOADING) : true;

  // Build auto video prompt for display (mirrors server-side generate-video.ts logic)
  const buildAutoVeoPrompt = () => {
    const shotCast = project.cast.filter(c => shot.castIds?.includes(c.id)) || [];
    const shotEnv = project.environments.find(e => e.id === shot.environmentId);
    const veoParts: string[] = [];
    if (shot.motionPrompt && shot.motionPrompt !== 'Cinematic camera movement') veoParts.push(shot.motionPrompt);
    const refLabels: string[] = [];
    shotCast.filter(c => c.referenceImageUrl).forEach(c => refLabels.push(`Maintain ${c.name}'s appearance from reference`));
    if (shotEnv?.referenceImageUrl) refLabels.push(`Maintain ${shotEnv.name} setting from reference`);
    if (refLabels.length) veoParts.push(refLabels.join('. '));
    return veoParts.join('. ');
  };

  return (
    <motion.div
      id={`shot-${shot.id}`}
      data-shot-id={shot.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: shotIdx * 0.03 }}
      className={`rounded-xl overflow-hidden border transition-all scroll-mt-20 ${
        !actionable ? 'opacity-40 border-white/[0.03]'
          : shot.locked ? 'border-white/[0.08]'
          : 'border-white/[0.05]'
      }`}
    >
      {/* Header — click to expand/collapse */}
      <div
        className={`px-4 py-2.5 flex items-center gap-3 bg-white/[0.01] ${isExpanded ? '' : 'hover:bg-white/[0.03] cursor-pointer'}`}
        onClick={(e) => {
          const tag = (e.target as HTMLElement).closest('button, select, input, textarea, a');
          if (tag) return;
          onToggleExpand();
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
          <span className="text-[11px] font-mono text-zinc-400 flex-shrink-0 tabular-nums">
            {fmtTime(parseTimeToSec(scene.startTime) + scene.shots.slice(0, shotIdx).reduce((a, s) => a + (s.duration || 0), 0))}
            <span className="text-zinc-500 ml-1">[{shot.duration}s]</span>
          </span>
          {activeCastMembers.length > 0 && (
            <span className="text-sm text-zinc-300 truncate">{activeCastMembers.map(c => c.name).join(', ')}</span>
          )}
          {shotIdx > 0 && !isStoryboardMode && (
            <button
              onClick={() => onUpdateShot(scene.id, shot.id, { continuityFrom: shot.continuityFrom === 'prev_shot' ? 'cut' : 'prev_shot' } as any)}
              className={`text-[11px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded transition-colors flex-shrink-0 ${
                shot.continuityFrom === 'prev_shot' ? 'text-amber-400/80 bg-amber-500/10' : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {shot.continuityFrom === 'prev_shot' ? 'chain' : 'cut'}
            </button>
          )}
          {shot.videoStatus === GenerationStatus.STALE && (
            <span className="text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 flex-shrink-0" title="The previous video is out of sync with the end keyframe set by the next shot.">stale</span>
          )}
          {shot.refinedFromPrevFrame && (
            <span className="text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-300 flex-shrink-0" title="Prompt was auto-rewritten by Claude after seeing the previous shot's actual last frame.">refined</span>
          )}
          {(() => {
            const storyboardPromptPos = storyboardPromptQueue?.indexOf(shot.id) ?? -1;
            const storyboardImagePos = storyboardImageQueue?.indexOf(shot.id) ?? -1;
            const framePos = frameQueue?.indexOf(shot.id) ?? -1;
            const videoPos = videoQueue?.indexOf(shot.id) ?? -1;
            if (storyboardPromptPos < 0 && storyboardImagePos < 0 && framePos < 0 && videoPos < 0) return null;
            const kind = storyboardPromptPos >= 0 ? 'board prompt' : storyboardImagePos >= 0 ? 'board image' : framePos >= 0 ? 'frame' : 'video';
            const pos = storyboardPromptPos >= 0 ? storyboardPromptPos + 1 : storyboardImagePos >= 0 ? storyboardImagePos + 1 : framePos >= 0 ? framePos + 1 : videoPos + 1;
            const ordinal = pos === 1 ? '1st' : pos === 2 ? '2nd' : pos === 3 ? '3rd' : `${pos}th`;
            return <span className="text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-300 flex-shrink-0 font-mono" title={`Queued for bulk ${kind} generation — ${ordinal} in line.`}>queued · {ordinal}</span>;
          })()}
          {!isStoryboardMode && !actionable && !shot.imageUrl && (
            <span className="text-[11px] uppercase tracking-wide text-zinc-400 flex-shrink-0" title="Waiting on previous shot's video (continuity chain)">queued</span>
          )}
        </div>

        {/* Right: actions toolbar */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {shot.videoUrl && (
            <div className="flex gap-px bg-white/[0.04] rounded overflow-hidden mr-2">
              <button onClick={() => setShowFrames(false)} className={`text-[11px] px-2 py-1 font-medium transition-colors ${!showFrames ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`} title="Show video">Video</button>
              <button
                onClick={() => setShowFrames(true)}
                className={`text-[11px] px-2 py-1 font-medium transition-colors ${showFrames ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
                title={isStoryboardMode ? 'Show ordered storyboard' : 'Show start + end frames'}
              >
                {isStoryboardMode ? 'Storyboard' : 'Frames'}
              </button>
            </div>
          )}
          {(shot.videoUrl || shot.imageUrl || shot.storyboardUrl) && (
            <button onClick={onToggleHistory} className={`w-7 h-7 rounded-md transition-colors flex items-center justify-center ${historyOpen ? 'text-white bg-white/[0.1]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`} title="Version history" aria-label="Version history">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
            </button>
          )}
          <button
            onClick={() => {
              if (isStoryboardMode) {
                if (!shot.storyboardPrompt?.trim() || !shot.storyboardCutPlan?.trim()) onWriteStoryboardPrompt(shot.id);
                else onGenerateStoryboard(shot.id);
                return;
              }
              onGenerateImage(scene.id, shot.id, getActiveRefs(shot, 'image'));
            }}
            disabled={isGenerating || (!actionable && !shot.locked)}
            className="w-7 h-7 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-30 flex items-center justify-center"
            title={isStoryboardMode
              ? (!shot.storyboardPrompt?.trim() || !shot.storyboardCutPlan?.trim()
                ? 'Write storyboard prompt'
                : hasStoryboard ? 'Regenerate storyboard image' : 'Generate storyboard image')
              : hasStartFrame ? 'Regenerate start frame' : 'Generate start frame'}
            aria-label={isStoryboardMode
              ? (!shot.storyboardPrompt?.trim() || !shot.storyboardCutPlan?.trim()
                ? 'Write storyboard prompt'
                : hasStoryboard ? 'Regenerate storyboard image' : 'Generate storyboard image')
              : hasStartFrame ? 'Regenerate start frame' : 'Generate start frame'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>
          </button>
          <button onClick={() => onGenerateVideo(scene.id, shot.id, undefined, getActiveRefs(shot, 'video'))} disabled={!canGenerateVideo && !shot.locked || isGenerating} className="w-7 h-7 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-30 flex items-center justify-center" title={isStoryboardMode && !shot.storyboardLocked ? 'Lock the storyboard first' : hasVideo ? 'Regenerate video' : 'Generate video'} aria-label={hasVideo ? 'Regenerate video' : 'Generate video'}>
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </button>
          <button onClick={() => onLockShot(scene.id, shot.id)} disabled={isGenerating || (!shot.locked && !canLock)} className={`w-7 h-7 rounded-md transition-all flex items-center justify-center ${shot.locked ? 'text-white bg-white/[0.08] hover:bg-white/[0.12]' : canLock ? 'text-white ring-1 ring-white/50 hover:ring-white hover:bg-white/[0.04]' : 'text-zinc-400/60'} disabled:opacity-30`} title={shot.locked ? 'Unlock shot' : canLock ? 'Lock shot' : isStoryboardMode ? 'Lock storyboard + generate video first to lock' : 'Generate start frame + video first to lock'} aria-label={shot.locked ? 'Unlock shot' : 'Lock shot'}>
            {shot.locked ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
            )}
          </button>
        </div>
      </div>

      {/* Body — collapses when not expanded */}
      {isExpanded && <>
      {/* Shot intent — the creative beat from script gen */}
      {shot.direction && shot.direction !== shot.visualPrompt && (
        <div className="px-4 py-1.5 border-t border-white/[0.04] bg-white/[0.01]">
          <span className="text-[11px] text-zinc-500 uppercase tracking-wide mr-2">Beat:</span>
          <span className="text-xs text-zinc-400 italic">{shot.direction}</span>
        </div>
      )}
      {/* Media: Video or Frames */}
      {showMediaSection && <div className="relative">
        {/* Storyboard mode: explicit sub-tab control. Click Storyboard → show
            the board image; click Video → show the generated clip. No more
            "video silently wins if it exists" — the artist drives. */}
        {isStoryboardMode ? (
          storyboardSubTab === 'video' ? (
            shot.videoUrl ? (
              <div className="bg-black">
                <ShotVideoPreview
                  videoUrl={shot.videoUrl}
                  audioUrl={project.audioPath ? project.audioPath : undefined}
                  globalStartSec={parseTimeToSec(scene.startTime) + scene.shots.slice(0, shotIdx).reduce((acc, s) => acc + (s.duration || 0), 0)}
                  durationSec={shot.duration}
                />
              </div>
            ) : (
              <div className="relative min-h-[160px] flex items-center justify-center bg-[#141418]">
                {shot.videoStatus === GenerationStatus.LOADING ? (
                  <div className="text-xs text-zinc-400">Generating video…</div>
                ) : (
                  <div className="text-xs text-zinc-500">No video yet — generate from the controls below.</div>
                )}
              </div>
            )
          ) : (
            <div className="relative min-h-[160px] flex items-center justify-center bg-[#141418] group/sb">
              {shot.storyboardUrl ? (
                <>
                  <div className="absolute top-2 left-2 z-20">
                    <span className="text-[10px] bg-black/70 backdrop-blur text-zinc-300 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">
                      {shot.storyboardLocked ? 'Storyboard · Locked' : 'Storyboard'}
                    </span>
                  </div>
                  <img
                    src={shot.storyboardUrl}
                    alt={`Shot ${shotIdx + 1} storyboard`}
                    onClick={() => setModalImage(shot.storyboardUrl!)}
                    className="max-w-full max-h-[480px] h-auto w-auto cursor-zoom-in"
                  />
                </>
              ) : shot.storyboardStatus === GenerationStatus.LOADING ? (
                <div className="text-xs text-zinc-400">Generating storyboard…</div>
              ) : (
                <div className="w-full min-h-[160px] flex items-center justify-center text-zinc-400">
                  <span className="text-xs">No storyboard yet — generate below to draft one.</span>
                </div>
              )}
            </div>
          )
        ) : shot.videoUrl && !showFrames ? (
          <div className="bg-black">
            <ShotVideoPreview
              videoUrl={shot.videoUrl}
              audioUrl={project.audioPath ? project.audioPath : undefined}
              globalStartSec={parseTimeToSec(scene.startTime) + scene.shots.slice(0, shotIdx).reduce((acc, s) => acc + (s.duration || 0), 0)}
              durationSec={shot.duration}
            />
          </div>
        ) : hasVideo && (shot.extractedLastFrameUrl || shot.endImageUrl) ? (
          <div className="flex bg-[#141418]">
            <div className="flex-1 relative min-h-[120px] flex items-center justify-center group/start">
              <div className="absolute top-2 left-2 z-20"><span className="text-[10px] bg-black/70 backdrop-blur text-zinc-300 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">Start</span></div>
              {shot.imageUrl && !shot.locked && onClearShotFrame && (
                <button onClick={() => onClearShotFrame(shot.id)} className="absolute top-2 right-2 z-20 opacity-0 group-hover/start:opacity-100 w-6 h-6 rounded-full bg-black/70 backdrop-blur text-zinc-300 hover:text-white hover:bg-black/90 flex items-center justify-center transition-all" title="Remove this start frame" aria-label="Remove start frame">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
              {shot.imageUrl && shotIdx > 0 && !scene.shots[shotIdx - 1]?.locked && onUseAsPrevEnd && modelSupportsLastFrame && (
                <div className="absolute bottom-2 left-2 z-20 opacity-0 group-hover/start:opacity-100 transition-opacity">
                  <button onClick={() => onUseAsPrevEnd(shot.id)} className="text-[11px] bg-white/90 text-black px-2 py-1 rounded-md font-medium hover:bg-white transition-colors" title="Use this start frame as the previous shot's end keyframe.">← Use as prev shot's end</button>
                </div>
              )}
              {shot.imageUrl && <img src={shot.imageUrl} alt={`Shot ${shotIdx + 1} start frame`} onClick={() => setModalImage(shot.imageUrl!)} className="max-w-full max-h-[360px] h-auto w-auto cursor-zoom-in" />}
            </div>
            <div className="w-px bg-white/[0.06] flex-shrink-0" />
            <div className="flex-1 relative min-h-[120px] flex items-center justify-center group/last">
              {(() => {
                const lastFrameUrl = shot.extractedLastFrameUrl || shot.endImageUrl;
                const isExtracted = !!shot.extractedLastFrameUrl;
                const clearFn = isExtracted ? onClearExtractedFrame : onClearEndFrame;
                if (!lastFrameUrl) return <div className="text-xs text-zinc-400">No last frame yet</div>;
                return (
                  <>
                    <div className="absolute top-2 left-2 z-20"><span className="text-[10px] bg-black/70 backdrop-blur text-zinc-300 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">Last frame</span></div>
                    {!shot.locked && clearFn && (
                      <button onClick={() => clearFn(shot.id)} className="absolute top-2 right-2 z-20 opacity-0 group-hover/last:opacity-100 w-6 h-6 rounded-full bg-black/70 backdrop-blur text-zinc-300 hover:text-white hover:bg-black/90 flex items-center justify-center transition-all" title="Remove last frame" aria-label="Remove last frame">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                    <img src={lastFrameUrl} alt={`Shot ${shotIdx + 1} last frame`} onClick={() => setModalImage(lastFrameUrl)} className="max-w-full max-h-[360px] h-auto w-auto cursor-zoom-in" />
                  </>
                );
              })()}
              {scene.shots[shotIdx + 1] && shot.extractedLastFrameUrl && onUsePrevLastFrame && (
                <div className="absolute bottom-2 right-2 z-20 opacity-0 group-hover/last:opacity-100 transition-opacity">
                  <button onClick={() => onUsePrevLastFrame(scene.shots[shotIdx + 1].id)} className="text-[11px] bg-white/90 text-black px-2 py-1 rounded-md font-medium hover:bg-white transition-colors" title="Copy this frame as the next shot's start frame">Use for next shot</button>
                </div>
              )}
            </div>
          </div>
        ) : modelSupportsLastFrame && shot.imageUrl ? (
          <><div className="flex bg-[#141418]">
            <div className="flex-1 relative min-h-[120px] flex items-center justify-center group/start">
              <div className="absolute top-2 left-2 z-20"><span className="text-[10px] bg-black/70 backdrop-blur text-zinc-300 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">Start</span></div>
              {!shot.locked && onClearShotFrame && (
                <button onClick={() => onClearShotFrame(shot.id)} className="absolute top-2 right-2 z-20 opacity-0 group-hover/start:opacity-100 w-6 h-6 rounded-full bg-black/70 backdrop-blur text-zinc-300 hover:text-white hover:bg-black/90 flex items-center justify-center transition-all" title="Remove this start frame" aria-label="Remove start frame">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
              {shotIdx > 0 && !scene.shots[shotIdx - 1]?.locked && onUseAsPrevEnd && modelSupportsLastFrame && (
                <div className="absolute bottom-2 left-2 z-20 opacity-0 group-hover/start:opacity-100 transition-opacity">
                  <button onClick={() => onUseAsPrevEnd(shot.id)} className="text-[11px] bg-white/90 text-black px-2 py-1 rounded-md font-medium hover:bg-white transition-colors" title="Use this start frame as the previous shot's end keyframe.">Use as prev end</button>
                </div>
              )}
              <img src={shot.imageUrl} alt={`Shot ${shotIdx + 1} start frame`} onClick={() => setModalImage(shot.imageUrl!)} className="max-w-full max-h-[360px] h-auto w-auto cursor-zoom-in" />
            </div>
            <div className="w-px bg-white/[0.06] flex-shrink-0" />
            <div className="flex-1 relative min-h-[120px] flex items-center justify-center group/end">
              {shot.endImageUrl ? (
                <>
                  <div className="absolute top-2 left-2 z-20"><span className="text-[10px] bg-black/70 backdrop-blur text-zinc-300 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">Last frame</span></div>
                  {!shot.locked && onClearEndFrame && (
                    <button onClick={() => onClearEndFrame(shot.id)} className="absolute top-2 right-2 z-20 opacity-0 group-hover/end:opacity-100 w-6 h-6 rounded-full bg-black/70 backdrop-blur text-zinc-300 hover:text-white hover:bg-black/90 flex items-center justify-center transition-all" title="Remove target end frame" aria-label="Remove target end frame">
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
                      <button onClick={() => onGenerateEndFrame(shot.id)} disabled={shot.endImageStatus === 'loading'} className="text-[11px] bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md px-2.5 py-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5">
                        {shot.endImageStatus === 'loading' && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />}
                        {shot.endImageStatus === 'loading' ? 'Generating…' : 'Generate'}
                      </button>
                    )}
                    {onUploadEndFrame && (
                      <button onClick={() => endFrameFileRef.current?.click()} className="text-[11px] bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md px-2.5 py-1 transition-colors">Upload</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div></>
        ) : (
          <div className="relative min-h-[160px] flex items-center justify-center bg-[#141418] group/start">
            {shot.imageUrl ? (
              <>
                <div className="absolute top-2 left-2 z-20"><span className="text-[10px] bg-black/70 backdrop-blur text-zinc-300 px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">Start</span></div>
                {!shot.locked && onClearShotFrame && (
                  <button onClick={() => onClearShotFrame(shot.id)} className="absolute top-2 right-2 z-20 opacity-0 group-hover/start:opacity-100 w-6 h-6 rounded-full bg-black/70 backdrop-blur text-zinc-300 hover:text-white hover:bg-black/90 flex items-center justify-center transition-all" title="Remove this start frame" aria-label="Remove start frame">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                )}
                {shotIdx > 0 && !scene.shots[shotIdx - 1]?.locked && onUseAsPrevEnd && modelSupportsLastFrame && (
                  <div className="absolute bottom-2 left-2 z-20 opacity-0 group-hover/start:opacity-100 transition-opacity">
                    <button onClick={() => onUseAsPrevEnd(shot.id)} className="text-[11px] bg-white/90 text-black px-2 py-1 rounded-md font-medium hover:bg-white transition-colors" title="Use this start frame as the previous shot's end keyframe.">Use as prev shot's end</button>
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
            <div className={`px-2 py-1 rounded-md text-[11px] font-medium border ${shot.critique.score >= 7 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/20' : shot.critique.score >= 5 ? 'bg-amber-500/20 text-amber-300 border-amber-500/20' : 'bg-red-500/20 text-red-300 border-red-500/20'}`}>
              {shot.critique.score}/10
              {shot.attemptCount && shot.attemptCount > 1 && <span className="text-[11px] opacity-60 ml-1">R{shot.attemptCount}</span>}
            </div>
          </div>
        )}

        {/* Error */}
        {isError && !isGenerating && !shot.videoUrl && !isStoryboardMode && (
          <div className="px-4 py-2 border-t border-red-500/10 bg-red-500/[0.04] space-y-1">
            <span className="text-xs text-red-300">Generation failed — click regen to retry</span>
            {shot.lastError && <p className="text-[11px] text-red-300/60 font-mono leading-snug break-all">{shot.lastError.slice(0, 200)}</p>}
          </div>
        )}

        {/* Loading overlay */}
        {isGenerating && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center z-30 gap-3">
            <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
            <span className="text-[11px] text-zinc-400 font-medium">
              {shot.storyboardStatus === GenerationStatus.LOADING ? 'Generating storyboard' : shot.imageStatus === GenerationStatus.LOADING ? 'Generating frame' : shot.videoStatus === GenerationStatus.LOADING ? 'Generating video' : 'Processing'}
            </span>
            <div className="w-24 h-0.5 bg-white/[0.06] rounded-full overflow-hidden"><div className="h-full bg-white/30 rounded-full animate-shimmer" style={{ width: '40%' }} /></div>
            {(shot.imageStatus === GenerationStatus.LOADING && onCancelShotImage) || (shot.videoStatus === GenerationStatus.LOADING && onCancelShotVideo) ? (
              <button
                onClick={() => { if (shot.imageStatus === GenerationStatus.LOADING) onCancelShotImage?.(shot.id); else if (shot.videoStatus === GenerationStatus.LOADING) onCancelShotVideo?.(shot.id); }}
                title="Stops waiting in this browser. Active provider generations may still finish."
                className="text-[11px] bg-white/[0.08] hover:bg-white/[0.14] text-zinc-300 hover:text-white border border-white/[0.08] rounded-md px-3 py-1 transition-colors"
              >
                Stop waiting
              </button>
            ) : null}
          </div>
        )}

        {/* Not actionable overlay */}
        {!isStoryboardMode && !actionable && !isGenerating && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
            <span className="text-xs text-zinc-400">Waiting on previous shot's video (continuity)</span>
          </div>
        )}
      </div>}

      {/* Version history panel */}
      {historyOpen && (
        <ShotVersionHistory
          projectId={project.id}
          shotId={shot.id}
          storyboardSupported={storyboardSupported}
          defaultTab={isStoryboardMode ? 'storyboard' : 'firstFrame'}
          activeStoryboardVersionId={shot.storyboardVersionId}
          onRevertVideo={onRevertVideo}
          onSetProject={onSetProject}
          onClose={onCloseHistory}
        />
      )}

      {/* Prompts */}
      <div className="px-5 py-4 space-y-4 border-t border-white/[0.06]">
        {(shot.locked || actionable) && (
          isStoryboardMode ? (
            <StoryboardPanel
              project={project}
              shot={shot}
              scene={scene}
              resolveRefDisplay={resolveRefDisplay}
              isRefining={isRefining}
              onRefineStart={onRefineStart}
              onRefineEnd={onRefineEnd}
              onWriteStoryboardPrompt={onWriteStoryboardPrompt}
              onGenerateStoryboard={onGenerateStoryboard}
              onRefineStoryboard={onRefineStoryboard}
              onCancelStoryboard={onCancelStoryboard}
              onLockStoryboard={onLockStoryboard}
              onUnlockStoryboard={onUnlockStoryboard}
              onUpdateStoryboardPlan={onUpdateStoryboardPlan}
              onUpdateShot={onUpdateShot}
              onGenerateVideo={onGenerateVideo}
              setModalImage={setModalImage}
              subTab={storyboardSubTab}
              onSubTabChange={setStoryboardSubTab}
            />
          ) : (() => {
            const autoVeoPrompt = buildAutoVeoPrompt();
            return (
              <PromptToolkit
                project={project}
                shot={shot}
                scene={scene}
                shotIdx={shotIdx}
                activeTab={activeTab}
                onTabChange={onTabChange}
                videoOverride={videoOverride}
                onVideoOverrideChange={onVideoOverrideChange}
                getActiveRefs={getActiveRefs}
                setActiveRefs={setActiveRefs}
                resolveRefDisplay={resolveRefDisplay}
                isRefining={isRefining}
                onRefineStart={onRefineStart}
                onRefineEnd={onRefineEnd}
                isGenerating={isGenerating}
                hasStartFrame={hasStartFrame}
                hasVideo={hasVideo}
                actionable={actionable}
                modelSupportsLastFrame={modelSupportsLastFrame}
                autoVeoPrompt={autoVeoPrompt}
                onGenerateImage={onGenerateImage}
                onGenerateVideo={onGenerateVideo}
                onGenerateEndFrame={onGenerateEndFrame}
                onRefinePrompt={onRefinePrompt}
                onRefineEndFramePrompt={onRefineEndFramePrompt}
                onRefineVideoPrompt={onRefineVideoPrompt}
                onUploadShotRef={onUploadShotRef}
                onDeleteShotRef={onDeleteShotRef}
                onUpdateShot={onUpdateShot}
                setModalImage={setModalImage}
              />
            );
          })()
        )}
      </div>
      </>}

      {/* Hidden file input for end frame upload */}
      <input ref={endFrameFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
        const file = e.target.files?.[0];
        if (file && onUploadEndFrame) onUploadEndFrame(shot.id, file);
        if (endFrameFileRef.current) endFrameFileRef.current.value = '';
      }} />
    </motion.div>
  );
};
