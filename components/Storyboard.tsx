
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
  onGenerateEndFrame: (sceneId: string, shotId: string) => void;
  onGenerateVideo: (sceneId: string, shotId: string) => void;
  onLockShot: (sceneId: string, shotId: string) => void;
}

export const Storyboard: React.FC<Props> = ({ scenes, project, activeSceneIdx, onSceneChange, onUpdateShot, onGenerateImage, onGenerateEndFrame, onGenerateVideo, onLockShot }) => {
  const [showFrames, setShowFrames] = useState<Record<string, boolean>>({});
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [promptTab, setPromptTab] = useState<Record<string, 'image' | 'motion'>>({});

  const isShotActionable = (scene: VideoScene, shotIdx: number): boolean => {
    if (shotIdx === 0) return true;
    const prevShot = scene.shots[shotIdx - 1];
    return !!prevShot?.locked;
  };

  const activeScene = scenes[activeSceneIdx];
  if (!activeScene) return null;

  return (
    <div className="max-w-5xl mx-auto pb-32 space-y-6">
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
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg font-display font-medium text-white">Scene {activeSceneIdx + 1}</h2>
              <span className="text-xs text-zinc-600 font-mono">{activeScene.startTime}–{activeScene.endTime}</span>
              <span className="text-xs text-zinc-600">{activeScene.sectionLabel}</span>
            </div>
            {activeScene.narrativeDescription && (
              <p className="text-sm text-zinc-400 max-w-3xl">{activeScene.narrativeDescription}</p>
            )}
          </div>

          {/* Vertical Shot List */}
          <div className="space-y-4">
            {activeScene.shots.map((shot, shotIdx) => {
              const actionable = isShotActionable(activeScene, shotIdx);
              const isGenerating = shot.imageStatus === GenerationStatus.LOADING || shot.endImageStatus === GenerationStatus.LOADING || shot.videoStatus === GenerationStatus.LOADING || shot.imageStatus === GenerationStatus.CRITIQUING;
              const isError = shot.imageStatus === GenerationStatus.ERROR || shot.videoStatus === GenerationStatus.ERROR || shot.endImageStatus === GenerationStatus.ERROR;
              const activeCastMembers = project?.cast.filter(c => shot.castIds?.includes(c.id)) || [];
              const canLock = !!shot.imageUrl && !!shot.endImageUrl && !shot.locked;
              const hasStartFrame = !!shot.imageUrl;
              const hasEndFrame = !!shot.endImageUrl;

              return (
                <motion.div
                  key={shot.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: shotIdx * 0.03 }}
                  className={`rounded-xl overflow-hidden transition-opacity ${
                    !actionable ? 'opacity-40' : ''
                  }`}
                >
                  {/* Header bar — shot info, toggles, actions */}
                  <div className="px-5 py-3 flex items-center justify-between border-b border-white/[0.06]">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-white">Shot {shotIdx + 1}</span>
                      <span className="text-xs text-zinc-600 font-mono">{shot.duration}s</span>
                      {activeCastMembers.map(c => (
                        <span key={c.id} className="text-xs text-zinc-500">{c.name}</span>
                      ))}
                      {shot.locked && (
                        <span className="text-xs text-zinc-400 flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-white" aria-hidden="true">
                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                          </svg>
                          Locked
                        </span>
                      )}
                      {shot.videoUrl && (
                        <div className="flex gap-px ml-1 bg-white/[0.04] rounded-md overflow-hidden">
                          <button
                            onClick={() => setShowFrames(prev => ({ ...prev, [shot.id]: false }))}
                            className={`text-xs px-3 py-1 font-medium transition-colors ${!showFrames[shot.id] ? 'bg-white/[0.1] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                          >Video</button>
                          <button
                            onClick={() => setShowFrames(prev => ({ ...prev, [shot.id]: true }))}
                            className={`text-xs px-3 py-1 font-medium transition-colors ${showFrames[shot.id] ? 'bg-white/[0.1] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                          >Frames</button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!shot.locked ? (
                        <>
                          <button
                            onClick={() => onGenerateImage(activeScene.id, shot.id)}
                            disabled={isGenerating || !actionable}
                            className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 rounded-md text-xs font-medium disabled:opacity-30 transition-colors"
                          >
                            {hasStartFrame ? 'Regen Start' : 'Start Frame'}
                          </button>
                          <button
                            onClick={() => onGenerateEndFrame(activeScene.id, shot.id)}
                            disabled={isGenerating || !hasStartFrame || !actionable}
                            className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 rounded-md text-xs font-medium disabled:opacity-30 transition-colors"
                          >
                            {hasEndFrame ? 'Regen End' : 'End Frame'}
                          </button>
                          <button
                            onClick={() => onLockShot(activeScene.id, shot.id)}
                            disabled={!canLock || isGenerating}
                            className="px-4 py-1.5 bg-white text-black rounded-md text-xs font-semibold disabled:opacity-30 hover:bg-zinc-200 transition-colors"
                          >
                            Lock Shot
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => onLockShot(activeScene.id, shot.id)}
                            disabled={isGenerating}
                            className="px-3 py-1.5 text-xs text-zinc-500 hover:text-amber-400 rounded-md border border-white/[0.06] hover:border-amber-500/20 transition-colors"
                          >
                            Unlock
                          </button>
                          <button
                            onClick={() => onGenerateImage(activeScene.id, shot.id)}
                            disabled={isGenerating}
                            className="px-3 py-1.5 text-xs text-zinc-500 hover:text-white rounded-md border border-white/[0.06] hover:border-white/20 transition-colors"
                          >
                            Regen Start
                          </button>
                          <button
                            onClick={() => onGenerateEndFrame(activeScene.id, shot.id)}
                            disabled={isGenerating}
                            className="px-3 py-1.5 text-xs text-zinc-500 hover:text-white rounded-md border border-white/[0.06] hover:border-white/20 transition-colors"
                          >
                            Regen End
                          </button>
                          <button
                            onClick={() => onGenerateVideo(activeScene.id, shot.id)}
                            disabled={isGenerating}
                            className="px-5 py-1.5 bg-white text-black hover:bg-zinc-200 rounded-md text-xs font-semibold disabled:opacity-50 transition-colors"
                          >
                            {shot.videoUrl ? 'Regenerate Video' : 'Generate Video'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Media: Video or Frames */}
                  <div className="relative">
                    {shot.videoUrl && !showFrames[shot.id] ? (
                      <div className="bg-black">
                        <video src={shot.videoUrl} controls loop playsInline className="w-full h-auto" />
                      </div>
                    ) : (
                      <div className="flex">
                        <div className="flex-1 relative bg-black min-h-[120px]">
                          <div className="absolute top-2 left-2 z-20">
                            <span className="text-[10px] bg-black/60 text-zinc-400 px-1.5 py-0.5 rounded-md uppercase font-medium">Start</span>
                          </div>
                          {shot.imageUrl ? (
                            <img src={shot.imageUrl} alt={`Shot ${shotIdx + 1} start frame`} onClick={() => setModalImage(shot.imageUrl!)} className="w-full h-auto cursor-zoom-in" />
                          ) : (
                            <div className="w-full min-h-[120px] flex items-center justify-center text-zinc-700">
                              <span className="text-xs">No start frame</span>
                            </div>
                          )}
                        </div>
                        <div className="w-px bg-white/[0.06] flex-shrink-0" />
                        <div className="flex-1 relative bg-black min-h-[120px]">
                          <div className="absolute top-2 left-2 z-20">
                            <span className="text-[10px] bg-black/60 text-zinc-400 px-1.5 py-0.5 rounded-md uppercase font-medium">End</span>
                          </div>
                          {shot.endImageUrl ? (
                            <img src={shot.endImageUrl} alt={`Shot ${shotIdx + 1} end frame`} onClick={() => setModalImage(shot.endImageUrl!)} className="w-full h-auto cursor-zoom-in" />
                          ) : (
                            <div className="w-full min-h-[120px] flex items-center justify-center text-zinc-700">
                              <span className="text-xs">{hasStartFrame ? 'Generate end frame' : '—'}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Critique score */}
                    {shot.critique && !isGenerating && (
                      <div className="absolute top-2 left-2 z-20">
                        <div className={`px-2 py-1 rounded-md text-[10px] font-medium border ${
                          shot.critique.score >= 7 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/20'
                            : shot.critique.score >= 5 ? 'bg-amber-500/20 text-amber-300 border-amber-500/20'
                            : 'bg-red-500/20 text-red-300 border-red-500/20'
                        }`}>
                          {shot.critique.score}/10
                          {shot.attemptCount && shot.attemptCount > 1 && (
                            <span className="text-[10px] opacity-60 ml-1">R{shot.attemptCount}</span>
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
                      <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-30">
                        <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin mb-2" />
                        <span className="text-xs text-zinc-400">
                          {shot.imageStatus === GenerationStatus.LOADING ? 'Generating start frame…'
                            : shot.endImageStatus === GenerationStatus.LOADING ? 'Generating end frame…'
                            : shot.videoStatus === GenerationStatus.LOADING ? 'Generating video…'
                            : 'Processing…'}
                        </span>
                      </div>
                    )}

                    {/* Not actionable */}
                    {!actionable && !isGenerating && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
                        <span className="text-xs text-zinc-500">Lock previous shot first</span>
                      </div>
                    )}
                  </div>

                  {/* Prompts — full width below media */}
                  <div className="px-5 py-4 space-y-4 border-t border-white/[0.06]">

                    {/* Prompts — toggle between Image / Motion, full width */}
                    {(shot.locked || actionable) && (() => {
                      const activeTab = promptTab[shot.id] || 'image';
                      const promptText = activeTab === 'image' ? shot.visualPrompt : shot.motionPrompt;
                      return (
                        <div className="space-y-3">
                          <div className="flex items-center gap-4">
                            <button
                              onClick={() => setPromptTab(prev => ({ ...prev, [shot.id]: 'image' }))}
                              className={`text-sm font-medium transition-colors ${activeTab === 'image' ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
                            >Image Prompt</button>
                            <button
                              onClick={() => setPromptTab(prev => ({ ...prev, [shot.id]: 'motion' }))}
                              className={`text-sm font-medium transition-colors ${activeTab === 'motion' ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
                            >Motion Prompt</button>
                          </div>
                          {shot.locked ? (
                            <p className="text-sm text-zinc-400 leading-relaxed">{promptText}</p>
                          ) : (
                            <>
                              <textarea
                                value={promptText}
                                onChange={(e) => onUpdateShot(activeScene.id, shot.id, activeTab === 'image' ? { visualPrompt: e.target.value } : { motionPrompt: e.target.value })}
                                className="w-full surface-inset rounded-md p-3 text-sm text-zinc-300 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 resize-none h-28"
                              />
                              <input
                                placeholder="Feedback — e.g. 'make sky redder'"
                                defaultValue={shot.userFeedback || ''}
                                onBlur={(e) => onUpdateShot(activeScene.id, shot.id, { userFeedback: e.target.value } as any)}
                                className="w-full surface-inset rounded-md px-3 py-2 text-sm text-zinc-300 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                              />
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
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
