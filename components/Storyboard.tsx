
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
  onGenerateVideo: (sceneId: string, shotId: string) => void;
  onLockShot: (sceneId: string, shotId: string) => void;
  onRefinePrompt: (sceneId: string, shotId: string, feedback: string) => void;
  onUpdateProject?: (updates: Record<string, any>) => void;
}

const VIDEO_MODELS = [
  { key: 'veo-3.1', label: 'Veo 3.1' },
  { key: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast' },
  { key: 'seedance-2.0', label: 'Seedance 2.0' },
];

export const Storyboard: React.FC<Props> = ({ scenes, project, activeSceneIdx, onSceneChange, onUpdateShot, onGenerateImage, onGenerateVideo, onLockShot, onRefinePrompt, onUpdateProject }) => {
  const [showFrames, setShowFrames] = useState<Record<string, boolean>>({});
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [promptTab, setPromptTab] = useState<Record<string, 'image' | 'motion' | 'compiled'>>({});

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
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-display font-medium text-white">Scene {activeSceneIdx + 1}</h2>
              <span className="text-xs text-zinc-600 font-mono">{activeScene.startTime}–{activeScene.endTime}</span>
              <span className="text-xs text-zinc-600">{activeScene.sectionLabel}</span>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[10px] text-zinc-600">Video model</span>
                <select
                  value={project?.videoModel || 'veo-3.1'}
                  onChange={(e) => onUpdateProject?.({ videoModel: e.target.value })}
                  className="surface-inset rounded-md px-2 py-1 text-[11px] text-zinc-300 outline-none focus-visible:ring-1 focus-visible:ring-white/20 bg-transparent cursor-pointer"
                >
                  {VIDEO_MODELS.map(m => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
              </div>
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
                      {shotIdx > 0 && (
                        <button
                          onClick={() => onUpdateShot(activeScene.id, shot.id, { continuityFrom: shot.continuityFrom === 'prev_shot' ? 'cut' : 'prev_shot' } as any)}
                          className={`text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border transition-colors ${
                            shot.continuityFrom === 'prev_shot'
                              ? 'text-amber-300 border-amber-500/30 hover:border-amber-400/50'
                              : 'text-zinc-600 border-white/[0.06] hover:border-white/20 hover:text-zinc-400'
                          }`}
                          title={shot.continuityFrom === 'prev_shot' ? 'Continues from previous shot (click to cut)' : 'Hard cut — independent (click to chain)'}
                        >
                          {shot.continuityFrom === 'prev_shot' ? '→ Continues' : 'Cut'}
                        </button>
                      )}
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
                            onClick={() => onGenerateVideo(activeScene.id, shot.id)}
                            disabled={!canGenerateVideo || !actionable}
                            className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 rounded-md text-xs font-medium disabled:opacity-30 transition-colors"
                          >
                            {hasVideo ? 'Regen Video' : 'Generate Video'}
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
                            onClick={() => onGenerateVideo(activeScene.id, shot.id)}
                            disabled={isGenerating}
                            className="px-5 py-1.5 bg-white text-black hover:bg-zinc-200 rounded-md text-xs font-semibold disabled:opacity-50 transition-colors"
                          >
                            Regenerate Video
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
                            <span className="text-[10px] bg-black/60 text-emerald-300/80 px-1.5 py-0.5 rounded-md uppercase font-medium">Last Frame (from video)</span>
                          </div>
                          {shot.extractedLastFrameUrl ? (
                            <img src={shot.extractedLastFrameUrl} alt={`Shot ${shotIdx + 1} extracted last frame`} onClick={() => setModalImage(shot.extractedLastFrameUrl!)} className="w-full h-auto cursor-zoom-in" />
                          ) : shot.endImageUrl ? (
                            // Legacy fallback for pre-migration shots that still have a predicted end frame
                            <img src={shot.endImageUrl} alt={`Shot ${shotIdx + 1} end frame`} onClick={() => setModalImage(shot.endImageUrl!)} className="w-full h-auto cursor-zoom-in opacity-70" />
                          ) : (
                            <div className="w-full min-h-[120px] flex items-center justify-center text-zinc-700 text-center px-4">
                              <span className="text-xs">{hasVideo ? 'Extracting…' : hasStartFrame ? 'Generate video to capture last frame' : '—'}</span>
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
                            : shot.videoStatus === GenerationStatus.LOADING ? 'Generating video + extracting last frame…'
                            : 'Processing…'}
                        </span>
                      </div>
                    )}

                    {/* Not actionable — only for continuity-linked shots waiting on prev video */}
                    {!actionable && !isGenerating && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
                        <span className="text-xs text-zinc-500">Waiting on previous shot's video (continuity)</span>
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

                      const promptText = activeTab === 'compiled' ? compiledText
                        : activeTab === 'image' ? shot.visualPrompt : shot.motionPrompt;

                      return (
                        <div className="space-y-3">
                          <div className="flex items-center gap-4">
                            <button
                              onClick={() => setPromptTab(prev => ({ ...prev, [shot.id]: 'image' }))}
                              className={`text-sm font-medium transition-colors ${activeTab === 'image' ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
                            >Image</button>
                            <button
                              onClick={() => setPromptTab(prev => ({ ...prev, [shot.id]: 'motion' }))}
                              className={`text-sm font-medium transition-colors ${activeTab === 'motion' ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
                            >Motion</button>
                            <button
                              onClick={() => setPromptTab(prev => ({ ...prev, [shot.id]: 'compiled' as any }))}
                              className={`text-sm font-medium transition-colors ${(activeTab as string) === 'compiled' ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
                            >Compiled</button>
                          </div>

                          {/* Reference chips — available @mentions for the image prompt */}
                          {activeTab === 'image' && !shot.locked && (() => {
                            const allRefs: { tag: string; label: string; url?: string }[] = [];
                            shotCast.forEach(c => {
                              if (c.referenceImageUrl) allRefs.push({ tag: `@${c.name}`, label: c.name, url: c.referenceImageUrl });
                            });
                            if (shotEnv?.referenceImageUrl) allRefs.push({ tag: `@${shotEnv.name}`, label: shotEnv.name, url: shotEnv.referenceImageUrl });
                            if (project?.styleAssetUrl) allRefs.push({ tag: '@style', label: 'Style', url: project.styleAssetUrl });

                            if (allRefs.length === 0) return null;

                            // Which @mentions are already in the prompt
                            const prompt = shot.visualPrompt.toLowerCase();
                            const activeRefs = allRefs.filter(r => prompt.includes(r.tag.toLowerCase()));

                            return (
                              <div className="space-y-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[10px] text-zinc-600 mr-1">Refs:</span>
                                  {allRefs.map(ref => {
                                    const isActive = prompt.includes(ref.tag.toLowerCase());
                                    return (
                                      <button
                                        key={ref.tag}
                                        onClick={() => {
                                          const ta = document.getElementById(`prompt-${shot.id}`) as HTMLTextAreaElement;
                                          if (!ta) return;
                                          const pos = ta.selectionStart || ta.value.length;
                                          const before = ta.value.slice(0, pos);
                                          const after = ta.value.slice(pos);
                                          const newVal = `${before}${ref.tag} ${after}`;
                                          onUpdateShot(activeScene.id, shot.id, { visualPrompt: newVal });
                                          setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = pos + ref.tag.length + 1; }, 0);
                                        }}
                                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors border ${
                                          isActive
                                            ? 'border-white/20 text-white bg-white/[0.06]'
                                            : 'border-white/[0.06] text-zinc-500 hover:text-zinc-300 hover:border-white/15'
                                        }`}
                                      >
                                        {ref.url && <img src={ref.url} className="w-4 h-4 rounded-sm object-cover" alt="" />}
                                        <span>{ref.tag}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                                {activeRefs.length > 0 && (
                                  <div className="flex gap-1.5">
                                    {activeRefs.map(ref => (
                                      <div key={ref.tag} className="relative">
                                        <img src={ref.url} className="w-10 h-10 rounded border border-white/[0.1] object-cover" alt={ref.label} />
                                        <div className="absolute inset-x-0 bottom-0 bg-black/80 text-[8px] text-zinc-400 text-center rounded-b">{ref.tag}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {activeTab === 'compiled' ? (
                            <div className="space-y-3">
                              <pre className="surface-inset rounded-md p-3 text-[11px] text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">{compiledText}</pre>
                              {compiledRefs.length > 0 && (
                                <div className="flex gap-2 flex-wrap">
                                  {compiledRefs.map((ref, i) => (
                                    <div key={i} className="relative">
                                      {ref.url ? (
                                        <img src={ref.url} className="w-14 h-14 object-cover rounded-md border border-white/[0.06]" alt={ref.label} />
                                      ) : (
                                        <div className="w-14 h-14 rounded-md border border-white/[0.06] bg-white/[0.02] flex items-center justify-center text-[9px] text-zinc-600">?</div>
                                      )}
                                      <div className="absolute inset-x-0 bottom-0 bg-black/80 text-[9px] text-zinc-400 px-1 py-0.5 rounded-b-md truncate text-center">{ref.label}</div>
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
