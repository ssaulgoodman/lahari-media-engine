
import React, { useState } from 'react';
import { VideoScene, VideoShot, GenerationStatus, ProjectAnalysis } from '../types';

interface Props {
  scenes: VideoScene[];
  analysis: ProjectAnalysis | null;
  onUpdateShot: (sceneId: string, shotId: string, updates: Partial<VideoShot>) => void;
  onGenerateImage: (sceneId: string, shotId: string) => void;
  onGenerateVideo: (sceneId: string, shotId: string) => void;
}

export const Storyboard: React.FC<Props> = ({ scenes, analysis, onUpdateShot, onGenerateImage, onGenerateVideo }) => {
  const [inspectedShotId, setInspectedShotId] = useState<string | null>(null);

  // Helper to find relative shots for visualization
  const getRelativeShots = (sceneIdx: number, shotIdx: number) => {
    let prevShot = scenes[sceneIdx].shots[shotIdx - 1];
    if (!prevShot && sceneIdx > 0) {
        const prevScene = scenes[sceneIdx - 1];
        prevShot = prevScene.shots[prevScene.shots.length - 1];
    }

    let nextShot = scenes[sceneIdx].shots[shotIdx + 1];
    if (!nextShot && scenes[sceneIdx + 1]?.shots[0]) {
        nextShot = scenes[sceneIdx + 1].shots[0];
    }

    return { prevShot, nextShot };
  };

  return (
    <div className="space-y-12 pb-32">
      
      {/* Header Info */}
      <div className="flex justify-between items-end px-2">
          {analysis?.visualIdentity.heroImage && (
            <div className="flex items-center gap-4 px-6 py-3 glass rounded-full w-fit border border-white/5">
                <div className="relative w-12 h-8 rounded overflow-hidden border border-accent-500 shadow-[0_0_10px_rgba(99,102,241,0.3)]">
                    <img src={analysis.visualIdentity.heroImage} className="w-full h-full object-cover" />
                </div>
                <div className="flex flex-col">
                    <span className="text-xs text-accent-400 tracking-wide uppercase font-bold flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse"></span>
                        Visual Anchor Active
                    </span>
                    <span className="text-[10px] text-zinc-500">
                        {analysis.visualIdentity.videoMode === 'cinematic' ? 'Sequential Continuity (A → B)' : 'Thematic Cohesion Only'}
                    </span>
                </div>
            </div>
          )}
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
                    <div className="text-xs text-zinc-500">{scene.narrativeDescription.substring(0, 60)}...</div>
                </div>
            </div>

            {/* Horizontal Filmstrip */}
            <div className="overflow-x-auto custom-scrollbar pb-6 px-4">
                <div className="flex gap-6 w-max items-start">
                    {scene.shots.map((shot, shotIdx) => {
                        const { prevShot, nextShot } = getRelativeShots(sceneIdx, shotIdx);
                        const isGenerating = shot.imageStatus === GenerationStatus.LOADING || shot.videoStatus === GenerationStatus.LOADING;
                        const canChain = !!nextShot?.imageUrl;

                        return (
                            <div key={shot.id} className="relative flex items-center">
                                {/* The Shot Card */}
                                <div className="w-[420px] bg-zinc-900 border border-white/5 rounded-xl overflow-hidden shadow-2xl flex flex-col group hover:border-accent-500/30 transition-all duration-300">
                                    
                                    {/* Main Media Area */}
                                    <div className="relative aspect-video bg-black group-hover:bg-zinc-950 transition-colors border-b border-white/5">
                                        {shot.videoUrl ? (
                                            <video src={shot.videoUrl} controls loop playsInline className="w-full h-full object-contain" />
                                        ) : shot.imageUrl ? (
                                            <img src={shot.imageUrl} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-700 gap-2">
                                                <svg className="w-8 h-8 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                                <div className="text-xs font-light">Generate Image First</div>
                                            </div>
                                        )}

                                        {isGenerating && (
                                            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-10 backdrop-blur-sm">
                                                <div className="w-8 h-8 border-t-2 border-accent-400 rounded-full animate-spin mb-3"></div>
                                                <span className="text-[10px] text-accent-100 uppercase tracking-widest animate-pulse font-bold">
                                                    {shot.imageStatus === GenerationStatus.LOADING ? 'Dreaming Scene...' : 'Rendering Video...'}
                                                </span>
                                            </div>
                                        )}
                                        
                                        <div className="absolute top-2 left-2 bg-black/60 px-2 py-1 rounded text-[10px] font-mono text-white border border-white/10 flex items-center gap-2 backdrop-blur-md">
                                            <span className="font-bold">SHOT {shotIdx + 1}</span>
                                        </div>

                                        <button 
                                            onClick={() => setInspectedShotId(inspectedShotId === shot.id ? null : shot.id)}
                                            className={`absolute top-2 right-2 p-1.5 rounded transition-all backdrop-blur-md border ${inspectedShotId === shot.id ? 'bg-accent-600 text-white border-accent-500' : 'bg-black/40 text-zinc-400 border-white/10 hover:text-white'}`}
                                            title="Inspect Deep Context"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                                            </svg>
                                        </button>

                                        {/* INSPECTOR OVERLAY */}
                                        {inspectedShotId === shot.id && analysis && (
                                            <div className="absolute inset-0 bg-zinc-900/95 p-5 z-20 flex flex-col text-xs overflow-y-auto animate-fade-in backdrop-blur-xl">
                                                <h4 className="text-white font-display font-medium mb-4 flex items-center gap-2">
                                                    <span className="text-accent-400">⚡</span> Prompt Engine Inputs
                                                </h4>
                                                
                                                <div className="space-y-4">
                                                    {/* Visual Inputs Section */}
                                                    <div className="space-y-2">
                                                        <span className="text-zinc-500 text-[9px] uppercase font-bold tracking-wider">Visual References (Injected)</span>
                                                        <div className="flex gap-2">
                                                            {analysis.visualIdentity.heroImage && (
                                                                <div className="space-y-1">
                                                                    <div className="w-16 h-10 rounded border border-accent-500/50 overflow-hidden">
                                                                        <img src={analysis.visualIdentity.heroImage} className="w-full h-full object-cover" />
                                                                    </div>
                                                                    <span className="text-[9px] text-accent-400 block text-center">Hero</span>
                                                                </div>
                                                            )}
                                                            {analysis.visualIdentity.videoMode === 'cinematic' && prevShot?.imageUrl ? (
                                                                <div className="space-y-1">
                                                                    <div className="w-16 h-10 rounded border border-white/20 overflow-hidden">
                                                                        <img src={prevShot.imageUrl} className="w-full h-full object-cover" />
                                                                    </div>
                                                                    <span className="text-[9px] text-zinc-400 block text-center">Prev Shot</span>
                                                                </div>
                                                            ) : (
                                                                analysis.visualIdentity.videoMode === 'cinematic' && (
                                                                    <div className="w-16 h-10 rounded border border-white/10 bg-white/5 flex items-center justify-center">
                                                                        <span className="text-[9px] text-zinc-600">No Prev</span>
                                                                    </div>
                                                                )
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="space-y-1">
                                                        <span className="text-zinc-500 block text-[9px] uppercase font-bold">Text Context</span>
                                                        <div className="grid grid-cols-2 gap-2 text-zinc-300">
                                                            <div className="bg-white/5 p-1.5 rounded">
                                                                <span className="text-zinc-500 block text-[8px]">DEITY</span>
                                                                {analysis.concept.deity}
                                                            </div>
                                                            <div className="bg-white/5 p-1.5 rounded">
                                                                <span className="text-zinc-500 block text-[8px]">MOOD</span>
                                                                {analysis.concept.mood}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <span className="text-zinc-500 block text-[9px] uppercase font-bold">Lyrical Meaning</span>
                                                        <p className="text-zinc-300 italic leading-relaxed">"{scene.narrativeDescription}"</p>
                                                    </div>
                                                </div>
                                                <button onClick={() => setInspectedShotId(null)} className="mt-auto self-end text-zinc-400 hover:text-white px-3 py-1 bg-white/10 rounded-full text-[10px]">Close Inspector</button>
                                            </div>
                                        )}
                                    </div>

                                    {/* MORPH PREVIEW STRIP (The "First Frame/Last Frame" UI) */}
                                    <div className="bg-zinc-950/50 border-b border-white/5 p-2 flex items-center gap-3 relative">
                                        <div className="absolute inset-x-0 top-1/2 h-[1px] bg-white/5 -z-10"></div>
                                        
                                        {/* Start Frame */}
                                        <div className="flex flex-col gap-1 w-1/4">
                                            <span className="text-[8px] text-zinc-500 uppercase font-bold pl-0.5">Start Frame</span>
                                            <div className="aspect-video bg-black rounded border border-white/10 overflow-hidden relative">
                                                {shot.imageUrl ? <img src={shot.imageUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-zinc-900" />}
                                            </div>
                                        </div>

                                        {/* Flow Indicator */}
                                        <div className="flex-1 flex justify-center">
                                            {shot.useNextAsEndFrame ? (
                                                <div className="flex flex-col items-center">
                                                     <div className="text-[8px] text-accent-500 font-mono tracking-tighter mb-0.5">MORPH</div>
                                                     <div className="h-[1px] w-full bg-accent-500/50 relative">
                                                         <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-1 bg-accent-500 rounded-full"></div>
                                                     </div>
                                                </div>
                                            ) : (
                                                <div className="h-[1px] w-full border-t border-dashed border-zinc-700"></div>
                                            )}
                                        </div>

                                        {/* End Frame */}
                                        <div className="flex flex-col gap-1 w-1/4 items-end">
                                            <span className="text-[8px] text-zinc-500 uppercase font-bold pr-0.5">End Frame</span>
                                            <div className={`aspect-video bg-black rounded border overflow-hidden relative w-full ${shot.useNextAsEndFrame ? 'border-accent-500/30' : 'border-white/10'}`}>
                                                {shot.useNextAsEndFrame && nextShot?.imageUrl ? (
                                                    <img src={nextShot.imageUrl} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
                                                        {shot.useNextAsEndFrame ? <span className="text-[6px] text-zinc-600 text-center px-1">WAITING FOR NEXT SHOT</span> : <span className="text-[6px] text-zinc-700">AI GENERATED</span>}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Prompts & Controls */}
                                    <div className="p-4 space-y-4 flex-1 flex flex-col bg-zinc-900/50">
                                        <div className="space-y-1">
                                            <div className="flex justify-between items-baseline">
                                                <label className="text-[10px] uppercase text-zinc-500 font-bold">Image Prompt</label>
                                                <span className="text-[9px] text-zinc-600">Gemini 3 Pro</span>
                                            </div>
                                            <textarea 
                                                value={shot.visualPrompt}
                                                onChange={(e) => onUpdateShot(scene.id, shot.id, { visualPrompt: e.target.value })}
                                                className="w-full bg-black/30 border border-white/5 rounded p-2 text-xs text-zinc-300 focus:border-accent-500/50 outline-none resize-none h-14"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <div className="flex justify-between items-baseline">
                                                <label className="text-[10px] uppercase text-zinc-500 font-bold">Video Motion</label>
                                                <span className="text-[9px] text-zinc-600">Veo</span>
                                            </div>
                                            <textarea 
                                                value={shot.motionPrompt}
                                                onChange={(e) => onUpdateShot(scene.id, shot.id, { motionPrompt: e.target.value })}
                                                className="w-full bg-black/30 border border-white/5 rounded p-2 text-xs text-zinc-300 focus:border-accent-500/50 outline-none resize-none h-10"
                                            />
                                        </div>

                                        {/* Continuity Toggle */}
                                        <div className="flex items-center justify-between pt-2 border-t border-white/5">
                                             <label className="flex items-center gap-2 cursor-pointer group">
                                                <div className={`w-3 h-3 border rounded transition-colors ${shot.useNextAsEndFrame ? 'bg-accent-500 border-accent-500' : 'border-zinc-600 group-hover:border-zinc-500'}`}>
                                                    {shot.useNextAsEndFrame && <svg className="w-3 h-3 text-white" viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
                                                </div>
                                                <input type="checkbox" className="hidden" checked={shot.useNextAsEndFrame} onChange={(e) => onUpdateShot(scene.id, shot.id, { useNextAsEndFrame: e.target.checked })} />
                                                <span className={`text-[10px] transition-colors ${shot.useNextAsEndFrame ? 'text-accent-400 font-medium' : 'text-zinc-500'}`}>Morph to Next Shot</span>
                                             </label>
                                        </div>

                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => onGenerateImage(scene.id, shot.id)}
                                                disabled={isGenerating}
                                                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-2.5 rounded text-xs font-medium border border-white/5"
                                            >
                                                {shot.imageUrl ? 'Regenerate Img' : 'Generate Img'}
                                            </button>
                                            <button 
                                                onClick={() => onGenerateVideo(scene.id, shot.id)}
                                                disabled={!shot.imageUrl || isGenerating}
                                                className="flex-1 bg-accent-600 hover:bg-accent-500 text-white py-2.5 rounded text-xs font-bold shadow-lg shadow-accent-500/20 disabled:opacity-50 disabled:shadow-none"
                                            >
                                                Generate Video
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Chain Link Visualization between cards */}
                                {shotIdx < scene.shots.length - 1 && (
                                    <div className="w-8 h-[1px] flex items-center justify-center relative -mx-2 z-0">
                                        <div className={`w-full h-[1px] ${shot.useNextAsEndFrame ? 'bg-accent-500' : 'bg-zinc-800'}`}></div>
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
