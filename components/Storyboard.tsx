
import React, { useState } from 'react';
import { VideoScene, VideoShot, GenerationStatus, ApiProject } from '../types';

interface Props {
  scenes: VideoScene[];
  project: ApiProject | null;
  onUpdateShot: (sceneId: string, shotId: string, updates: Partial<VideoShot>) => void;
  onGenerateImage: (sceneId: string, shotId: string) => void;
  onGenerateEndFrame: (sceneId: string, shotId: string) => void;
  onGenerateVideo: (sceneId: string, shotId: string) => void;
  onLockShot: (sceneId: string, shotId: string) => void;
}

export const Storyboard: React.FC<Props> = ({ scenes, project, onUpdateShot, onGenerateImage, onGenerateEndFrame, onGenerateVideo, onLockShot }) => {

  // Determine if a shot is actionable (sequential enforcement)
  const isShotActionable = (scene: VideoScene, shotIdx: number): boolean => {
    if (shotIdx === 0) return true; // First shot in scene always actionable
    const prevShot = scene.shots[shotIdx - 1];
    return !!prevShot?.locked;
  };

  return (
    <div className="space-y-12 pb-32">
      {/* Cast + Environment References */}
      <div className="flex justify-between items-end px-2">
        <div className="flex gap-4 flex-wrap">
          {project?.cast.filter(c => !!c.referenceImageUrl).map(member => (
            <div key={member.id} className="flex items-center gap-4 px-4 py-2 glass rounded-full w-fit border border-white/5">
              <div className="relative w-8 h-8 rounded-full overflow-hidden border border-accent-500/50">
                <img src={member.referenceImageUrl} className="w-full h-full object-cover" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-accent-400 font-bold uppercase">{member.name}</span>
                <span className="text-[9px] text-zinc-500">Character</span>
              </div>
            </div>
          ))}
          {project?.environments.filter(e => !!e.referenceImageUrl).map(env => (
            <div key={env.id} className="flex items-center gap-4 px-4 py-2 glass rounded-full w-fit border border-white/5">
              <div className="relative w-8 h-8 rounded overflow-hidden border border-emerald-500/50">
                <img src={env.referenceImageUrl} className="w-full h-full object-cover" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-emerald-400 font-bold uppercase">{env.name}</span>
                <span className="text-[9px] text-zinc-500">Environment</span>
              </div>
            </div>
          ))}
        </div>
        <div className="text-zinc-500 text-xs font-mono">Shift + Scroll to navigate timeline</div>
      </div>

      {scenes.map((scene, sceneIdx) => (
        <div key={scene.id} className="space-y-4">
          {/* Scene Header */}
          <div className="flex items-center gap-4 border-b border-white/5 pb-2 mx-4 mt-8">
            <div className="flex flex-col">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-display font-medium text-white">Scene {sceneIdx + 1}</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded border uppercase tracking-wider ${scene.sectionLabel.toLowerCase().includes('chorus') ? 'bg-gold-500/10 border-gold-500/30 text-gold-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
                  {scene.sectionLabel}
                </span>
              </div>
              <p className="text-zinc-500 italic text-sm max-w-2xl mt-1">"{scene.lyrics}"</p>
            </div>
            <div className="ml-auto text-right hidden md:block">
              <div className="text-xs font-mono text-zinc-600">{scene.startTime} - {scene.endTime}</div>
              <div className="text-xs text-zinc-500">{(scene.narrativeDescription || '').substring(0, 60)}...</div>
            </div>
          </div>

          {/* Horizontal Filmstrip */}
          <div className="overflow-x-auto custom-scrollbar pb-6 px-4">
            <div className="flex gap-6 w-max items-start">
              {scene.shots.map((shot, shotIdx) => {
                const actionable = isShotActionable(scene, shotIdx);
                const isGenerating = shot.imageStatus === GenerationStatus.LOADING || shot.endImageStatus === GenerationStatus.LOADING || shot.videoStatus === GenerationStatus.LOADING || shot.imageStatus === GenerationStatus.CRITIQUING;
                const isError = shot.imageStatus === GenerationStatus.ERROR || shot.videoStatus === GenerationStatus.ERROR || shot.endImageStatus === GenerationStatus.ERROR;
                const activeCastMembers = project?.cast.filter(c => shot.castIds?.includes(c.id)) || [];
                const canLock = !!shot.imageUrl && !!shot.endImageUrl && !shot.locked;
                const hasStartFrame = !!shot.imageUrl;
                const hasEndFrame = !!shot.endImageUrl;

                return (
                  <div key={shot.id} className="relative flex items-center">
                    <div className={`w-[420px] bg-zinc-900 border rounded-xl overflow-hidden shadow-2xl flex flex-col group transition-all duration-300 ${
                      shot.locked ? 'border-green-500/30 ring-1 ring-green-500/10' :
                      !actionable ? 'border-white/5 opacity-40' :
                      isError ? 'border-red-500/30' : 'border-white/5 hover:border-accent-500/30'
                    }`}>

                      {/* Dual Frame Display */}
                      <div className="relative flex border-b border-white/5">
                        {/* Start Frame */}
                        <div className="flex-1 relative aspect-video bg-black">
                          <div className="absolute top-1 left-1 z-20">
                            <span className="text-[8px] bg-black/70 text-zinc-400 px-1.5 py-0.5 rounded uppercase font-bold backdrop-blur-sm">Start</span>
                          </div>
                          {shot.imageUrl ? (
                            <img src={shot.imageUrl} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-700">
                              <span className="text-[10px]">No start frame</span>
                            </div>
                          )}
                        </div>

                        {/* Divider */}
                        <div className="w-[1px] bg-white/10 relative">
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] text-zinc-600 bg-zinc-900 px-1 py-0.5 rounded z-10">→</div>
                        </div>

                        {/* End Frame */}
                        <div className="flex-1 relative aspect-video bg-black">
                          <div className="absolute top-1 left-1 z-20">
                            <span className="text-[8px] bg-black/70 text-zinc-400 px-1.5 py-0.5 rounded uppercase font-bold backdrop-blur-sm">End</span>
                          </div>
                          {shot.endImageUrl ? (
                            <img src={shot.endImageUrl} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-700">
                              <span className="text-[10px]">{hasStartFrame ? 'Generate end frame' : '—'}</span>
                            </div>
                          )}
                        </div>

                        {/* Video overlay (plays over both frames) */}
                        {shot.videoUrl && (
                          <div className="absolute inset-0 z-20 bg-black">
                            <video src={shot.videoUrl} controls loop playsInline className="w-full h-full object-contain" />
                          </div>
                        )}

                        {/* Locked badge */}
                        {shot.locked && !isGenerating && (
                          <div className="absolute top-2 right-2 z-20 bg-green-500/20 border border-green-500/30 text-green-400 px-2 py-0.5 rounded-full text-[10px] font-bold backdrop-blur-md flex items-center gap-1">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                            Locked
                          </div>
                        )}

                        {/* Critique Badge */}
                        {shot.critique && !isGenerating && (
                          <div className="absolute top-2 left-2 z-20 group/score">
                            <div className={`px-2 py-1 rounded-full text-[10px] font-bold border backdrop-blur-md flex items-center gap-1 cursor-help ${
                              shot.critique.score >= 7 ? 'bg-green-500/20 text-green-300 border-green-500/30'
                                : shot.critique.score >= 5 ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
                                : 'bg-red-500/20 text-red-300 border-red-500/30'
                            }`}>
                              <span>★ {shot.critique.score}</span>
                              {shot.attemptCount && shot.attemptCount > 1 && (
                                <span className="text-[8px] opacity-70 border-l border-white/20 pl-1">R{shot.attemptCount}</span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Error State */}
                        {isError && !isGenerating && (
                          <div className="absolute bottom-2 left-2 right-2 bg-red-500/10 border border-red-500/30 rounded px-2 py-1.5 z-20">
                            <p className="text-[10px] text-red-300 font-medium">Generation failed</p>
                          </div>
                        )}

                        {/* Loading overlay */}
                        {isGenerating && (
                          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-30 backdrop-blur-sm">
                            <div className="w-8 h-8 border-t-2 border-accent-400 rounded-full animate-spin mb-3"></div>
                            <span className="text-[10px] text-accent-100 uppercase tracking-widest animate-pulse font-bold">
                              {shot.imageStatus === GenerationStatus.LOADING ? 'Generating Start Frame...'
                                : shot.endImageStatus === GenerationStatus.LOADING ? 'Generating End Frame...'
                                : shot.videoStatus === GenerationStatus.LOADING ? 'Generating Video...'
                                : 'Processing...'}
                            </span>
                          </div>
                        )}

                        {/* Not actionable overlay */}
                        {!actionable && !isGenerating && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
                            <span className="text-[10px] text-zinc-500 font-medium">Lock previous shot first</span>
                          </div>
                        )}

                        {/* Shot number + cast pills */}
                        {!isGenerating && (
                          <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1 z-20">
                            <div className="bg-black/60 px-2 py-1 rounded text-[10px] font-mono text-white border border-white/10 backdrop-blur-md">
                              <span className="font-bold">SHOT {shotIdx + 1}</span>
                              <span className="text-zinc-500 ml-1.5">{shot.duration}s</span>
                            </div>
                            {activeCastMembers.length > 0 && (
                              <div className="flex gap-1">
                                {activeCastMembers.map(c => (
                                  <div key={c.id} className="bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded text-[8px] text-zinc-300 border border-white/10">
                                    {c.name}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Prompts & Controls */}
                      <div className="p-4 space-y-3 flex-1 flex flex-col bg-zinc-900/50">
                        <div className="space-y-1">
                          <div className="flex justify-between items-baseline">
                            <label className="text-[10px] uppercase text-zinc-500 font-bold">Image Prompt</label>
                            <span className="text-[9px] text-zinc-600">Gemini 3 Pro</span>
                          </div>
                          <textarea
                            value={shot.visualPrompt}
                            onChange={(e) => onUpdateShot(scene.id, shot.id, { visualPrompt: e.target.value })}
                            disabled={!actionable || shot.locked}
                            className="w-full bg-black/30 border border-white/5 rounded p-2 text-xs text-zinc-300 focus:border-accent-500/50 outline-none resize-none h-14 disabled:opacity-50"
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between items-baseline">
                            <label className="text-[10px] uppercase text-zinc-500 font-bold">Video Motion</label>
                            <span className="text-[9px] text-zinc-600">Veo 3.1</span>
                          </div>
                          <textarea
                            value={shot.motionPrompt}
                            onChange={(e) => onUpdateShot(scene.id, shot.id, { motionPrompt: e.target.value })}
                            disabled={!actionable || shot.locked}
                            className="w-full bg-black/30 border border-white/5 rounded p-2 text-xs text-zinc-300 focus:border-accent-500/50 outline-none resize-none h-10 disabled:opacity-50"
                          />
                        </div>

                        {/* Feedback input */}
                        {actionable && !shot.locked && (
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase text-zinc-500 font-bold">Feedback</label>
                            <input
                              placeholder="e.g. 'make the sky redder', 'add more detail to the temple'"
                              defaultValue={shot.userFeedback || ''}
                              onBlur={(e) => onUpdateShot(scene.id, shot.id, { userFeedback: e.target.value } as any)}
                              className="w-full bg-black/30 border border-white/5 rounded p-2 text-xs text-zinc-300 focus:border-accent-500/50 outline-none"
                            />
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2 pt-1">
                          {!shot.locked ? (
                            <>
                              <button
                                onClick={() => onGenerateImage(scene.id, shot.id)}
                                disabled={isGenerating || !actionable}
                                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-2 rounded text-xs font-medium border border-white/5 disabled:opacity-30"
                              >
                                {hasStartFrame ? 'Regen Start' : 'Start Frame'}
                              </button>
                              <button
                                onClick={() => onGenerateEndFrame(scene.id, shot.id)}
                                disabled={isGenerating || !hasStartFrame || !actionable}
                                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-2 rounded text-xs font-medium border border-white/5 disabled:opacity-30"
                              >
                                {hasEndFrame ? 'Regen End' : 'End Frame'}
                              </button>
                              <button
                                onClick={() => onLockShot(scene.id, shot.id)}
                                disabled={!canLock || isGenerating}
                                className="px-3 bg-green-600/20 hover:bg-green-600 text-green-400 hover:text-white py-2 rounded text-xs font-bold border border-green-500/30 disabled:opacity-30 transition-all"
                              >
                                Lock
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => onGenerateVideo(scene.id, shot.id)}
                              disabled={isGenerating}
                              className="flex-1 bg-accent-600 hover:bg-accent-500 text-white py-2.5 rounded text-xs font-bold shadow-lg shadow-accent-500/20 disabled:opacity-50 disabled:shadow-none"
                            >
                              {shot.videoUrl ? 'Regenerate Video' : 'Generate Video'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {shotIdx < scene.shots.length - 1 && (
                      <div className="w-8 h-[1px] flex items-center justify-center relative -mx-2 z-0">
                        <div className={`w-full h-[1px] ${shot.locked ? 'bg-green-500/50' : 'bg-zinc-800'}`}></div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
