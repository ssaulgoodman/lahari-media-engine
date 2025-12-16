
import React, { useState, useRef } from 'react';
import { ProjectAnalysis, VideoScene, VideoMode } from '../types';
import { analyzeImageStyle, generateHeroPreviews } from '../services/geminiService';

interface Props {
  analysis: ProjectAnalysis;
  scenes: VideoScene[];
  onConfirm: (updatedAnalysis: ProjectAnalysis) => void;
  onRegenerateStructure: (updatedAnalysis: ProjectAnalysis) => void;
  isRegenerating: boolean;
}

const STYLE_PRESETS = [
  "Indian Cinema Masterpiece (Santosh Sivan style, Backlit, Golden Hour, Anamorphic)",
  "Tumbbad Aesthetic (Moody, Earthy, Overcast, Rain texture, High Contrast)",
  "Prestige Drama (Natural Light, Roger Deakins style, 35mm Kodak 5219, Clean Composition)",
  "Folk Mysticism (Kantara style, Firelight, Forest Atmosphere, Raw texture)",
  "Vintage Devotional (16mm Film Grain, Soft Focus, Light Leaks, Nostalgic)",
  "Modern Commercial (Crisp, High Key, Slow Motion, Sony Venice Color Science)",
  "Divine Ethereal (Soft Gold, Bloom, Heavenly, Ravi Varma Lighting)",
  "Dark Chiaroscuro (Deep Shadows, Oil Lamp lighting, Temple Interior)"
];

const DURATION_OPTIONS = [5, 8, 10];

export const AnalysisEditor: React.FC<Props> = ({ analysis, scenes, onConfirm, onRegenerateStructure, isRegenerating }) => {
  const [data, setData] = useState(analysis);
  const [activeTab, setActiveTab] = useState<'concept' | 'visuals' | 'script'>('concept');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isStyleAnalyzing, setIsStyleAnalyzing] = useState(false);
  const [isGeneratingLooks, setIsGeneratingLooks] = useState(false);
  const [heroCandidates, setHeroCandidates] = useState<string[]>([]);

  // Helpers to deep update state
  const updateConcept = (key: keyof typeof data.concept, value: any) => {
      setData(prev => ({ ...prev, concept: { ...prev.concept, [key]: value } }));
  };
  const updateVisuals = (key: keyof typeof data.visualIdentity, value: any) => {
      setData(prev => ({ ...prev, visualIdentity: { ...prev.visualIdentity, [key]: value } }));
  };

  const handleStyleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setIsStyleAnalyzing(true);
      try {
        const styleDesc = await analyzeImageStyle(file);
        updateVisuals('styleDescription', styleDesc);
      } catch (err) {
        console.error("Style analysis failed", err);
      } finally {
        setIsStyleAnalyzing(false);
      }
    }
  };

  const handleGenerateLooks = async () => {
      setIsGeneratingLooks(true);
      try {
          const looks = await generateHeroPreviews(data.concept, data.visualIdentity);
          setHeroCandidates(looks);
      } catch (e) {
          console.error(e);
      } finally {
          setIsGeneratingLooks(false);
      }
  };

  const parseTime = (t: string) => {
    const [m, s] = t.split(':').map(Number);
    return m * 60 + s;
  };
  
  const totalDuration = data.concept.musicalStructure.length > 0 
      ? parseTime(data.concept.musicalStructure[data.concept.musicalStructure.length - 1].endTime) 
      : 60;

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-slide-up p-8 pb-32">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end border-b border-white/10 pb-6 gap-6">
        <div>
          <h2 className="text-4xl font-display font-medium text-white">Production Pipeline</h2>
          <p className="text-zinc-500 mt-2 font-light">Stage: {activeTab === 'concept' ? '1. Concept & Structure' : activeTab === 'visuals' ? '2. Visual Identity (LookDev)' : '3. Storyboard Script'}</p>
        </div>
        
        <div className="flex gap-4">
            {activeTab === 'script' && (
                 <button 
                    onClick={() => onRegenerateStructure(data)}
                    disabled={isRegenerating}
                    className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-6 py-3 rounded-lg font-medium transition-colors border border-white/5 disabled:opacity-50"
                 >
                   {isRegenerating ? "Writing Script..." : scenes.length > 0 ? "Regenerate Script" : "Generate Script"}
                 </button>
            )}
            
            <button 
                onClick={() => {
                    if (activeTab === 'concept') setActiveTab('visuals');
                    else if (activeTab === 'visuals') setActiveTab('script');
                    else onConfirm(data);
                }}
                disabled={activeTab === 'visuals' && !data.visualIdentity.heroImage}
                className="bg-accent-600 hover:bg-accent-500 text-white px-8 py-3 rounded-lg font-bold shadow-lg shadow-accent-500/20 transition-all hover:scale-105 disabled:opacity-50 disabled:shadow-none"
            >
                {activeTab === 'script' ? 'Confirm & Launch Studio' : 'Next Stage →'}
            </button>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex gap-2 mb-8">
          {['concept', 'visuals', 'script'].map((step, idx) => (
              <div key={step} className={`h-1 flex-1 rounded-full transition-all ${
                  ['concept', 'visuals', 'script'].indexOf(activeTab) >= idx ? 'bg-accent-500' : 'bg-zinc-800'
              }`}></div>
          ))}
      </div>

      {/* TABS CONTENT */}
      
      {/* TAB 1: CONCEPT */}
      {activeTab === 'concept' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                  <div className="glass p-8 rounded-2xl space-y-4">
                     <h3 className="text-lg font-display text-white/90">Core Concepts (Extracted)</h3>
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs text-zinc-500 uppercase font-bold">Project Title</label>
                            <input value={data.concept.title} onChange={e => updateConcept('title', e.target.value)} className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white outline-none focus:border-accent-500/50" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs text-zinc-500 uppercase font-bold">Language</label>
                            <input value={data.concept.language} onChange={e => updateConcept('language', e.target.value)} className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white outline-none focus:border-accent-500/50" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs text-zinc-500 uppercase font-bold">Deity / Subject</label>
                            <input value={data.concept.deity} onChange={e => updateConcept('deity', e.target.value)} className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white outline-none focus:border-accent-500/50" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs text-zinc-500 uppercase font-bold">Mood</label>
                            <input value={data.concept.mood} onChange={e => updateConcept('mood', e.target.value)} className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white outline-none focus:border-accent-500/50" />
                        </div>
                     </div>
                     <div className="space-y-2 pt-2">
                        <label className="text-xs text-zinc-500 uppercase font-bold">Thematic Overview</label>
                        <textarea value={data.concept.theme} onChange={e => updateConcept('theme', e.target.value)} className="w-full h-24 bg-black/40 border border-white/10 rounded px-3 py-2 text-white outline-none focus:border-accent-500/50 resize-none" />
                     </div>
                  </div>

                  {/* Timeline */}
                  <div className="glass p-6 rounded-2xl space-y-4">
                     <div className="flex justify-between items-center">
                        <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                            <span className="text-accent-400">♬</span> Audio DNA Structure
                        </h3>
                     </div>
                     <div className="relative h-16 w-full bg-black/50 rounded-lg flex overflow-hidden border border-white/5">
                        {data.concept.musicalStructure.map((section, idx) => {
                           const start = parseTime(section.startTime);
                           const end = parseTime(section.endTime);
                           const width = ((end - start) / totalDuration) * 100;
                           let bgClass = 'bg-zinc-800';
                           if (section.label.toLowerCase().includes('chorus')) bgClass = 'bg-gold-500/80';
                           else if (section.label.toLowerCase().includes('verse')) bgClass = 'bg-accent-500/40';
                           
                           return (
                             <div key={idx} style={{ width: `${width}%` }} className={`h-full ${bgClass} border-r border-black/20 relative group flex items-center justify-center`}>
                               <span className="text-[10px] font-bold text-white uppercase truncate px-1">{section.label}</span>
                             </div>
                           );
                        })}
                     </div>
                  </div>
              </div>

              {/* Right Col: Settings */}
              <div className="space-y-6">
                 <div className="glass p-6 rounded-2xl space-y-4">
                     <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Base Pacing</h3>
                     <div className="flex gap-2">
                        {DURATION_OPTIONS.map(d => (
                            <button key={d} onClick={() => setData(prev => ({ ...prev, targetDuration: d }))}
                              className={`flex-1 py-2 rounded border text-sm font-mono ${data.targetDuration === d ? 'bg-accent-600 border-accent-500 text-white' : 'bg-black/40 border-white/10 text-zinc-400'}`}>
                                {d}s
                            </button>
                        ))}
                     </div>
                     <p className="text-xs text-zinc-500">Note: Actual shot duration will vary based on scene energy.</p>
                 </div>
              </div>
          </div>
      )}

      {/* TAB 2: VISUALS */}
      {activeTab === 'visuals' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-6">
                  <div className="glass p-8 rounded-2xl space-y-6">
                       <div className="flex justify-between items-center">
                          <h3 className="text-lg font-display text-white">Visual Style Guide</h3>
                          <div className="flex items-center gap-2">
                              <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleStyleImageSelect} />
                              <button onClick={() => fileInputRef.current?.click()} className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded text-zinc-300">
                                 {isStyleAnalyzing ? 'Analyzing...' : '📷 Import Style'}
                              </button>
                          </div>
                       </div>
                       
                       <div className="flex flex-wrap gap-2">
                          {STYLE_PRESETS.map(style => (
                              <button key={style} onClick={() => updateVisuals('styleDescription', style)} className="px-3 py-1 rounded-full border border-white/10 bg-black/20 text-xs text-zinc-400 hover:bg-white/5 hover:text-white transition-colors text-left">
                                {style.split(' (')[0]}
                              </button>
                          ))}
                       </div>

                       <textarea value={data.visualIdentity.styleDescription} onChange={(e) => updateVisuals('styleDescription', e.target.value)} className="w-full h-32 bg-black/40 border border-white/10 rounded-xl p-4 text-white focus:border-accent-500/50 outline-none resize-none leading-relaxed" placeholder="Describe the art style..." />
                  </div>

                  <div className="glass p-8 rounded-2xl space-y-4">
                     <h3 className="text-lg font-display text-white">Character Sheet</h3>
                     <textarea value={data.visualIdentity.characterSheet} onChange={(e) => updateVisuals('characterSheet', e.target.value)} className="w-full h-32 bg-black/40 border border-white/10 rounded-xl p-4 text-white focus:border-accent-500/50 outline-none resize-none leading-relaxed" placeholder="Describe the main character strictly (Age, costume, features)..." />
                  </div>
                  
                   <div className="glass p-6 rounded-2xl space-y-4">
                        <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Director Mode</h3>
                        <div className="flex gap-2">
                            <button onClick={() => updateVisuals('videoMode', 'montage')} className={`flex-1 py-3 rounded-lg border text-sm font-medium transition-all ${data.visualIdentity.videoMode === 'montage' ? 'bg-accent-600 border-accent-500 text-white' : 'bg-black/20 border-white/10 text-zinc-400'}`}>Montage</button>
                            <button onClick={() => updateVisuals('videoMode', 'cinematic')} className={`flex-1 py-3 rounded-lg border text-sm font-medium transition-all ${data.visualIdentity.videoMode === 'cinematic' ? 'bg-accent-600 border-accent-500 text-white' : 'bg-black/20 border-white/10 text-zinc-400'}`}>Cinematic</button>
                        </div>
                        <p className="text-xs text-zinc-500">{data.visualIdentity.videoMode === 'montage' ? 'Fast cuts, distinct scenes.' : 'Continuity focus: Shot A flows into Shot B using keyframes.'}</p>
                   </div>
              </div>

              <div className="glass p-8 rounded-2xl flex flex-col min-h-[500px]">
                  <h3 className="text-lg font-display text-white mb-4">Hero Look Development</h3>
                  <p className="text-zinc-400 text-sm mb-6">Generate and select a "Master Reference". All subsequent scenes will be anchored to this image.</p>
                  
                  {heroCandidates.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-xl">
                          <button onClick={handleGenerateLooks} disabled={isGeneratingLooks} className="bg-accent-600 hover:bg-accent-500 text-white px-8 py-3 rounded-full font-bold shadow-lg transition-all hover:scale-105 disabled:opacity-50">
                              {isGeneratingLooks ? "Dreaming..." : "Generate Hero Concepts"}
                          </button>
                      </div>
                  ) : (
                      <div className="grid grid-cols-1 gap-4 overflow-y-auto custom-scrollbar pr-2">
                          {heroCandidates.map((img, idx) => (
                              <div key={idx} onClick={() => updateVisuals('heroImage', img)} className={`relative aspect-video rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${data.visualIdentity.heroImage === img ? 'border-accent-500 ring-2 ring-accent-500/50' : 'border-transparent hover:border-white/30'}`}>
                                  <img src={img} className="w-full h-full object-cover" />
                                  <div className={`absolute inset-0 bg-black/60 flex items-center justify-center transition-opacity ${data.visualIdentity.heroImage === img ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}>
                                      <span className="bg-accent-600 text-white px-4 py-2 rounded-full font-bold text-sm">
                                          {data.visualIdentity.heroImage === img ? 'Selected Hero' : 'Select This Look'}
                                      </span>
                                  </div>
                              </div>
                          ))}
                          <button onClick={handleGenerateLooks} className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium text-zinc-300">Generate New Variations</button>
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* TAB 3: SCRIPT (Hierarchical View) */}
      {activeTab === 'script' && (
        <div className="glass p-8 rounded-2xl min-h-[400px]">
             {scenes.length === 0 && !isRegenerating ? (
                 <div className="flex flex-col items-center justify-center h-64 space-y-4">
                     <div className="text-zinc-500 text-lg">No script generated yet.</div>
                     <button onClick={() => onRegenerateStructure(data)} className="bg-accent-600 text-white px-6 py-2 rounded-lg font-medium">Generate First Draft</button>
                 </div>
             ) : (
                 <>
                    <h3 className="text-lg font-display text-white/90 mb-6 flex justify-between">
                        <span>Script Breakdown</span>
                        <span className="text-xs font-mono text-zinc-500">{scenes.length} Scenes / {scenes.reduce((acc, s) => acc + s.shots.length, 0)} Shots</span>
                    </h3>
                    
                    <div className="space-y-6">
                        {scenes.map((scene, idx) => (
                            <div key={scene.id} className="bg-white/5 rounded-xl p-4 border border-white/10">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <div className="flex items-center gap-3 mb-1">
                                            <span className="text-accent-400 font-bold font-display uppercase text-sm tracking-wider">Scene {idx + 1}</span>
                                            <span className={`text-[10px] px-2 py-0.5 rounded border ${scene.sectionLabel.toLowerCase().includes('chorus') ? 'bg-gold-500/20 border-gold-500/50 text-gold-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
                                                {scene.sectionLabel}
                                            </span>
                                        </div>
                                        <p className="text-zinc-500 italic text-sm">"{scene.lyrics}"</p>
                                        <p className="text-zinc-400 text-xs mt-1">{scene.narrativeDescription}</p>
                                    </div>
                                    <div className="text-xs font-mono text-zinc-600">{scene.startTime} - {scene.endTime}</div>
                                </div>
                                
                                <div className="space-y-2">
                                    {scene.shots.map((shot, sIdx) => (
                                        <div key={shot.id} className="flex gap-4 p-3 bg-black/40 rounded border border-white/5 items-center">
                                            <div className="text-xs font-mono text-zinc-600 w-6">S{sIdx+1}</div>
                                            <div className="flex-1">
                                                <div className="text-sm text-zinc-300 mb-0.5">{shot.visualPrompt.substring(0, 80)}...</div>
                                                <div className="text-xs text-zinc-500 flex gap-4">
                                                    <span>🎥 {shot.motionPrompt.substring(0, 50)}...</span>
                                                    <span>⏱ {shot.duration}s</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                 </>
             )}
        </div>
      )}
    </div>
  );
};
