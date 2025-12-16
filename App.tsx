
import React, { useState, useEffect } from 'react';
import { AppStep, ProjectState, VideoScene, VideoShot, GenerationStatus, ProjectAnalysis, ChatMessage } from './types';
import { StepUpload } from './components/StepUpload';
import { AnalysisEditor } from './components/AnalysisEditor';
import { Storyboard } from './components/Storyboard';
import { ChatAssistant } from './components/ChatAssistant';
import { analyzeAudioConcepts, planScenes, generateShotImage, generateShotVideo, chatWithDirector } from './services/geminiService';

const PIPELINE_STEPS = [
  { id: AppStep.UPLOAD, label: 'Import', icon: '💿' },
  { id: AppStep.ANALYSIS, label: 'Blueprint', icon: '📐' },
  { id: AppStep.STORYBOARD, label: 'Studio', icon: '🎬' },
  { id: AppStep.EXPORT, label: 'Render', icon: '💾' },
];

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.UPLOAD);
  const [apiKeyVerified, setApiKeyVerified] = useState(false);
  const [state, setState] = useState<ProjectState>({
    audioFile: null,
    audioUrl: null,
    analysis: null,
    scenes: [],
    chatHistory: [],
  });

  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio && window.aistudio.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setApiKeyVerified(hasKey);
      } else {
        setApiKeyVerified(true); 
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio && window.aistudio.openSelectKey) {
      await window.aistudio.openSelectKey();
      setApiKeyVerified(true);
    }
  };

  const resetProject = () => {
    if (window.confirm("Start a new project? Unsaved progress will be lost.")) {
       setState({
         audioFile: null,
         audioUrl: null,
         analysis: null,
         scenes: [],
         chatHistory: [],
       });
       setCurrentStep(AppStep.UPLOAD);
    }
  };

  const handleFileUpload = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const audioUrl = URL.createObjectURL(file);
      setState(prev => ({ ...prev, audioFile: file, audioUrl }));

      // STAGE 1: Extract Concepts & Visual Suggestions
      const concept = await analyzeAudioConcepts(file);
      
      const initialAnalysis: ProjectAnalysis = {
          concept,
          visualIdentity: {
              // Use AI suggestions or fallback to high-quality defaults
              styleDescription: concept.visualSuggestions?.artStyle || "Hyper-realistic, cinematic lighting, shot on 35mm film.",
              characterSheet: concept.visualSuggestions?.physicalDescription || `Divine appearance of ${concept.deity}, traditional attire, ethereal aura.`,
              colorPalette: concept.visualSuggestions?.colorPalette || "Gold, Deep Blue, Warm Orange",
              videoMode: "montage"
          },
          targetDuration: 8
      };

      setState(prev => ({ ...prev, analysis: initialAnalysis, scenes: [] }));
      setCurrentStep(AppStep.ANALYSIS);
    } catch (err: any) {
      setError(err.message || "Failed to analyze audio.");
    } finally {
      setLoading(false);
    }
  };

  // STAGE 3: Plan/Regenerate Script
  const handleRegenerateStructure = async (updatedAnalysis: ProjectAnalysis) => {
    if (!state.audioFile) return;
    setLoading(true);
    setError(null);
    try {
        const scenes = await planScenes(state.audioFile, updatedAnalysis);
        setState(prev => ({
            ...prev,
            analysis: updatedAnalysis, 
            scenes: scenes 
        }));
    } catch (err: any) {
        setError("Failed to regenerate structure: " + err.message);
    } finally {
        setLoading(false);
    }
  };

  const handleAnalysisConfirmed = (updatedAnalysis: ProjectAnalysis) => {
    setState(prev => ({ ...prev, analysis: updatedAnalysis }));
    setCurrentStep(AppStep.STORYBOARD);
  };

  const updateShot = (sceneId: string, shotId: string, updates: Partial<VideoShot>) => {
    setState(prev => ({
      ...prev,
      scenes: prev.scenes.map(scene => {
          if (scene.id !== sceneId) return scene;
          return {
              ...scene,
              shots: scene.shots.map(shot => shot.id === shotId ? { ...shot, ...updates } : shot)
          };
      })
    }));
  };

  const findShot = (sceneId: string, shotId: string) => {
      const scene = state.scenes.find(s => s.id === sceneId);
      return scene?.shots.find(s => s.id === shotId);
  };

  const getPreviousShot = (sceneId: string, shotId: string) => {
      // Logic to find the physically previous shot in the entire timeline
      let allShots: VideoShot[] = [];
      state.scenes.forEach(s => allShots.push(...s.shots));
      const idx = allShots.findIndex(s => s.id === shotId);
      if (idx > 0) return allShots[idx - 1];
      return null;
  };

  const getNextShot = (sceneId: string, shotId: string) => {
      let allShots: VideoShot[] = [];
      state.scenes.forEach(s => allShots.push(...s.shots));
      const idx = allShots.findIndex(s => s.id === shotId);
      if (idx !== -1 && idx < allShots.length - 1) return allShots[idx + 1];
      return null;
  };

  const handleGenerateImage = async (sceneId: string, shotId: string) => {
    const shot = findShot(sceneId, shotId);
    if (!shot || !state.analysis) return;
    
    // Find the parent scene to get context (lyrics, narrative)
    const scene = state.scenes.find(s => s.id === sceneId);
    if (!scene) return;

    updateShot(sceneId, shotId, { imageStatus: GenerationStatus.LOADING, error: undefined });

    try {
      // Logic: Pass previous shot image if in Cinematic mode for continuity
      let prevShotUrl = undefined;
      const prevShot = getPreviousShot(sceneId, shotId);
      
      if (state.analysis.visualIdentity.videoMode === 'cinematic' && prevShot?.imageUrl) {
          prevShotUrl = prevShot.imageUrl;
      }
      
      const sceneContext = {
          lyrics: scene.lyrics,
          narrative: scene.narrativeDescription
      };

      const imageUrl = await generateShotImage(shot, state.analysis, sceneContext, prevShotUrl);
      updateShot(sceneId, shotId, { imageUrl, imageStatus: GenerationStatus.SUCCESS });
    } catch (err: any) {
      console.error(err);
      updateShot(sceneId, shotId, { imageStatus: GenerationStatus.ERROR });
      setError(`Image generation failed for shot ${shotId}`);
    }
  };

  const handleGenerateVideo = async (sceneId: string, shotId: string) => {
    const shot = findShot(sceneId, shotId);
    if (!shot || !shot.imageUrl) return;

    if (!apiKeyVerified) {
       await handleSelectKey();
    }

    updateShot(sceneId, shotId, { videoStatus: GenerationStatus.LOADING, error: undefined });

    try {
      // Check for next frame continuity (morphing)
      let nextImageBase64 = undefined;
      if (shot.useNextAsEndFrame) {
         const nextShot = getNextShot(sceneId, shotId);
         if (nextShot && nextShot.imageUrl) {
            nextImageBase64 = nextShot.imageUrl;
         }
      }

      const videoUrl = await generateShotVideo(shot, shot.imageUrl, nextImageBase64);
      updateShot(sceneId, shotId, { videoUrl, videoStatus: GenerationStatus.SUCCESS });
    } catch (err: any) {
      console.error(err);
      if (err.message?.includes('Requested entity was not found') || err.message?.includes('404')) {
         setApiKeyVerified(false);
         await handleSelectKey();
         updateShot(sceneId, shotId, { videoStatus: GenerationStatus.ERROR });
         setError("Key verification lost. Please try again.");
      } else {
         updateShot(sceneId, shotId, { videoStatus: GenerationStatus.ERROR });
         setError(`Video generation failed: ${err.message}`);
      }
    }
  };

  const handleChatMessage = async (text: string) => {
     if (!state.analysis) return;
     
     const newMsg: ChatMessage = { role: 'user', text };
     const newHistory = [...state.chatHistory, newMsg];
     
     setState(prev => ({ ...prev, chatHistory: newHistory }));
     setChatLoading(true);
     
     try {
       const response = await chatWithDirector(state.analysis, state.scenes, text, newHistory);
       setState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, { role: 'model', text: response.text }] }));
     } catch (err) {
       console.error(err);
       setState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, { role: 'model', text: "Error connecting to AI." }] }));
     } finally {
       setChatLoading(false);
     }
  };

  const isStoryboard = currentStep === AppStep.STORYBOARD;

  return (
    <div className="min-h-screen bg-obsidian-950 text-zinc-100 font-sans flex flex-col h-screen overflow-hidden">
      
      {/* Top Bar */}
      <header className="h-16 border-b border-white/5 bg-obsidian-900/80 backdrop-blur-md flex-shrink-0 z-50">
        <div className="h-full px-6 flex items-center justify-between">
           <div className="flex items-center gap-6">
              <div className="flex items-center gap-4">
                  <div className="w-8 h-8 bg-gradient-to-tr from-accent-600 to-accent-400 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-accent-500/20">
                    L
                  </div>
                  <h1 className="text-lg font-display font-medium text-white tracking-wide hidden md:block">
                    Lahari Music <span className="text-zinc-500 mx-2">/</span> <span className="text-accent-400">Video Engine</span>
                  </h1>
              </div>

              {/* PIPELINE NAVIGATION */}
              <div className="hidden md:flex items-center bg-zinc-900/50 rounded-full p-1 border border-white/5">
                {PIPELINE_STEPS.map((step) => {
                    const isActive = currentStep === step.id;
                    const isAccessible = 
                        step.id === AppStep.UPLOAD || 
                        (step.id === AppStep.ANALYSIS && !!state.audioFile) ||
                        (step.id === AppStep.STORYBOARD && state.scenes.length > 0) ||
                        (step.id === AppStep.EXPORT && state.scenes.length > 0);

                    return (
                        <button
                            key={step.id}
                            disabled={!isAccessible}
                            onClick={() => {
                                if (step.id === AppStep.UPLOAD) {
                                    resetProject();
                                } else {
                                    setCurrentStep(step.id);
                                }
                            }}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                                isActive 
                                ? 'bg-zinc-800 text-white shadow-md' 
                                : isAccessible 
                                    ? 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5' 
                                    : 'text-zinc-700 opacity-50 cursor-not-allowed'
                            }`}
                        >
                            <span>{step.icon}</span>
                            <span>{step.label}</span>
                        </button>
                    );
                })}
              </div>
           </div>
           
           <div className="flex gap-4 items-center">
              {!apiKeyVerified && (
                 <button onClick={handleSelectKey} className="text-xs text-accent-400 border border-accent-500/30 px-3 py-1.5 rounded hover:bg-accent-500/10 transition-colors">
                    Connect Billing
                 </button>
              )}
              {state.audioUrl && (
                <div className="flex items-center gap-3 bg-white/5 px-4 py-1.5 rounded-full border border-white/10">
                   <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                   <audio src={state.audioUrl} controls className="h-6 w-24 md:w-32 opacity-70 invert" />
                </div>
              )}
           </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left/Main Content Area */}
        <main className={`flex-1 overflow-y-auto relative ${isStoryboard ? 'bg-zinc-900/20' : ''}`}>
           <div className="fixed inset-0 pointer-events-none z-0 opacity-20 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-accent-900/40 via-obsidian-950 to-obsidian-950"></div>
           
           <div className="relative z-10 w-full p-6">
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-200 p-4 rounded-lg mb-8 flex justify-between items-center max-w-4xl mx-auto">
                  <span>{error}</span>
                  <button onClick={() => setError(null)} className="hover:text-white px-2">✕</button>
                </div>
              )}

              {currentStep === AppStep.UPLOAD && (
                 <StepUpload onFileSelect={handleFileUpload} isAnalyzing={loading} />
              )}

              {currentStep === AppStep.ANALYSIS && state.analysis && (
                 <AnalysisEditor 
                    analysis={state.analysis} 
                    scenes={state.scenes}
                    onConfirm={handleAnalysisConfirmed}
                    onRegenerateStructure={handleRegenerateStructure}
                    isRegenerating={loading}
                 />
              )}

              {currentStep === AppStep.STORYBOARD && (
                 <Storyboard 
                   scenes={state.scenes} 
                   analysis={state.analysis}
                   onUpdateShot={updateShot}
                   onGenerateImage={handleGenerateImage}
                   onGenerateVideo={handleGenerateVideo}
                 />
              )}

              {currentStep === AppStep.EXPORT && (
                  <div className="max-w-4xl mx-auto space-y-8 animate-slide-up">
                      <div className="text-center space-y-2 mb-12">
                          <h2 className="text-4xl font-display font-medium text-white">Final Render</h2>
                          <p className="text-zinc-500">Review your compiled timeline and export the master file.</p>
                      </div>

                      <div className="glass p-8 rounded-2xl space-y-6">
                          <div className="flex items-center justify-between border-b border-white/5 pb-4">
                             <h3 className="text-lg font-display text-white">Clip Manifest</h3>
                          </div>

                          <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                              {state.scenes.flatMap(s => s.shots).map((shot, idx) => (
                                  <div key={shot.id} className="flex items-center gap-4 p-3 bg-white/5 rounded-lg border border-white/5">
                                      <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs text-zinc-500 font-mono">
                                          {idx + 1}
                                      </div>
                                      <div className="w-16 h-9 bg-black rounded overflow-hidden flex-shrink-0">
                                          {shot.videoUrl ? (
                                              <video src={shot.videoUrl} className="w-full h-full object-cover" />
                                          ) : shot.imageUrl ? (
                                              <img src={shot.imageUrl} className="w-full h-full object-cover opacity-50 grayscale" />
                                          ) : (
                                              <div className="w-full h-full flex items-center justify-center text-[8px] text-zinc-700">Empty</div>
                                          )}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                          <div className="text-sm text-zinc-300 truncate">{shot.visualPrompt}</div>
                                      </div>
                                      <div className="text-xs">
                                          {shot.videoUrl ? (
                                              <span className="text-green-400 flex items-center gap-1">
                                                  <span>✓</span> Ready
                                              </span>
                                          ) : (
                                              <span className="text-zinc-600">Pending</span>
                                          )}
                                      </div>
                                  </div>
                              ))}
                          </div>

                          <div className="pt-6 border-t border-white/5 flex justify-end gap-4">
                              <button 
                                onClick={() => setCurrentStep(AppStep.STORYBOARD)}
                                className="px-6 py-3 rounded-lg text-sm font-medium text-zinc-400 hover:text-white transition-colors"
                              >
                                  Back to Studio
                              </button>
                              <button 
                                className="bg-white text-black px-8 py-3 rounded-lg font-bold hover:bg-accent-100 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={state.scenes.flatMap(s => s.shots).filter(s => s.videoUrl).length === 0}
                                onClick={() => alert("Rendering full video... (This would trigger backend FFMPEG job)")}
                              >
                                  Render Full Video (FFMPEG)
                              </button>
                          </div>
                      </div>
                  </div>
              )}
           </div>
        </main>

        {/* Right Sidebar: Chat Assistant */}
        {isStoryboard && (
           <aside className="w-80 lg:w-96 flex-shrink-0 z-20 shadow-2xl bg-obsidian-900 border-l border-white/5">
              <ChatAssistant 
                 messages={state.chatHistory} 
                 onSendMessage={handleChatMessage} 
                 isLoading={chatLoading} 
              />
           </aside>
        )}
      </div>
      
    </div>
  );
};

export default App;
