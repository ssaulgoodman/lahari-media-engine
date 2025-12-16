import React, { useRef } from 'react';

interface Props {
  onFileSelect: (file: File) => void;
  isAnalyzing: boolean;
}

export const StepUpload: React.FC<Props> = ({ onFileSelect, isAnalyzing }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center p-8 animate-fade-in">
      <input
        type="file"
        ref={fileInputRef}
        accept="audio/*"
        className="hidden"
        onChange={handleFileChange}
      />
      
      {isAnalyzing ? (
        <div className="flex flex-col items-center gap-8 z-10">
          <div className="relative w-32 h-32">
            <div className="absolute inset-0 border-t-2 border-accent-400 rounded-full animate-spin"></div>
            <div className="absolute inset-2 border-r-2 border-accent-600/50 rounded-full animate-spin [animation-duration:1.5s]"></div>
            <div className="absolute inset-4 border-b-2 border-accent-100/30 rounded-full animate-spin [animation-duration:2s]"></div>
            <div className="absolute inset-0 flex items-center justify-center">
               <span className="text-4xl animate-pulse">✨</span>
            </div>
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-2xl font-display text-white">Analyzing Composition</h3>
            <p className="text-zinc-500 font-light tracking-wide">Aligning Beats • Detecting Couplets • Structuring Scenes</p>
          </div>
        </div>
      ) : (
        <div className="glass p-12 rounded-3xl text-center max-w-xl w-full hover:bg-white/5 transition-all duration-500 group border border-white/5 shadow-2xl shadow-black/50">
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer space-y-10"
          >
            <div className="w-24 h-24 mx-auto bg-accent-500/10 rounded-2xl flex items-center justify-center border border-accent-500/20 group-hover:scale-110 group-hover:border-accent-400 group-hover:rotate-3 transition-all duration-300">
               <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-10 h-10 text-accent-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
               </svg>
            </div>
            
            <div className="space-y-4">
              <h2 className="text-5xl font-display font-medium text-white tracking-tight">New Project</h2>
              <p className="text-zinc-400 font-light leading-relaxed">
                Import your master track.<br/>
                <span className="text-zinc-600 text-sm">AI will create a scene-by-scene storyboard plan.</span>
              </p>
            </div>
            
            <button
              className="px-12 py-4 bg-white text-black font-semibold rounded-xl hover:bg-accent-400 hover:text-white transition-all tracking-wide shadow-lg hover:shadow-accent-500/25"
            >
              Select Audio File
            </button>
          </div>
        </div>
      )}
    </div>
  );
};