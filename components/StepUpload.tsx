
import React, { useRef, useState } from 'react';
import { ApiProject } from '../types';

interface Props {
  project: ApiProject | null;
  onFileSelect: (file: File, metadata?: { title?: string; context?: string; language?: string }) => void;
  onGenerateConcepts: (opts?: { lyrics?: string; context?: string; language?: string }) => void;
  isAnalyzing: boolean;
  isGeneratingConcepts: boolean;
}

const parseTime = (t: string | undefined) => {
  if (!t || !t.includes(':')) return 0;
  const [m, s] = t.split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
};

export const StepUpload: React.FC<Props> = ({ project, onFileSelect, onGenerateConcepts, isAnalyzing, isGeneratingConcepts }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [language, setLanguage] = useState('');

  // Editable lyrics (initialized from project when analysis completes)
  const [editedLyrics, setEditedLyrics] = useState<string | null>(null);
  const [editedContext, setEditedContext] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0], { title, context, language });
    }
  };

  // Analysis complete — show results
  const hasAnalysis = project && project.status !== 'uploaded' && project.status !== 'analyzing' && project.lyrics;
  const hasConcepts = project && project.conceptOptions.length > 0;

  // If analysis is done but no concepts yet, show the review page
  if (hasAnalysis && !hasConcepts) {
    const lyrics = editedLyrics ?? project.lyrics ?? '';
    const totalDuration = project.musicalStructure.length > 0
      ? parseTime(project.musicalStructure[project.musicalStructure.length - 1]?.endTime)
      : 60;

    return (
      <div className="max-w-5xl mx-auto space-y-6 animate-slide-up p-6 pb-32">
        {/* Header */}
        <div className="border-b border-white/10 pb-6">
          <h2 className="text-4xl font-display font-medium text-white">{project.title}</h2>
          <p className="text-zinc-500 mt-2 font-light">Review the analysis, then generate creative concepts.</p>
        </div>

        {/* Audio player */}
        {project.audioPath && (
          <div className="glass p-4 rounded-2xl flex items-center gap-4">
            <audio controls src={`/storage/${project.audioPath}`} className="flex-1 h-10" />
          </div>
        )}

        {/* Song Structure Timeline */}
        {project.musicalStructure.length > 0 && (
          <div className="glass p-6 rounded-2xl space-y-3">
            <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              Song Structure
              <span className="text-[10px] font-normal text-zinc-600 lowercase tracking-normal">
                {project.musicalStructure.length} sections detected
              </span>
            </h3>
            <div className="relative h-16 w-full bg-black/50 rounded-xl flex overflow-hidden border border-white/5">
              {project.musicalStructure.map((section, idx) => {
                const start = parseTime(section.startTime);
                const end = parseTime(section.endTime);
                const width = Math.max(((end - start) / totalDuration) * 100, 2);
                let bgClass = 'bg-zinc-800';
                const label = (section.label || '').toLowerCase();
                if (label.includes('chorus')) bgClass = 'bg-amber-500/70';
                else if (label.includes('verse')) bgClass = 'bg-accent-500/40';
                else if (label.includes('bridge')) bgClass = 'bg-violet-500/40';
                else if (label.includes('intro') || label.includes('outro')) bgClass = 'bg-zinc-700';
                else if (label.includes('interlude')) bgClass = 'bg-cyan-500/30';
                return (
                  <div
                    key={idx}
                    style={{ width: `${width}%` }}
                    className={`h-full ${bgClass} border-r border-black/30 flex flex-col items-center justify-center group relative`}
                  >
                    <span className="text-[9px] font-bold text-white uppercase truncate px-1">{section.label}</span>
                    <span className="text-[8px] text-white/50 font-mono">{section.startTime}-{section.endTime}</span>
                  </div>
                );
              })}
            </div>
            {/* Section detail list */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-2">
              {project.musicalStructure.map((section, idx) => (
                <div key={idx} className="bg-black/30 rounded-lg p-2 border border-white/5 text-[11px]">
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="font-semibold text-zinc-300">{section.label}</span>
                    <span className="font-mono text-zinc-600">{section.startTime}–{section.endTime}</span>
                  </div>
                  {section.description && <div className="text-zinc-500 truncate">{section.description}</div>}
                  {section.energyLevel && (
                    <span className={`text-[9px] font-mono mt-0.5 inline-block px-1.5 py-0.5 rounded ${
                      section.energyLevel === 'High' ? 'bg-red-500/15 text-red-400' :
                      section.energyLevel === 'Medium' ? 'bg-amber-500/15 text-amber-400' :
                      'bg-blue-500/15 text-blue-400'
                    }`}>{section.energyLevel}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lyrics — editable */}
        <div className="glass p-6 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Transcribed Lyrics</h3>
            <span className="text-[10px] text-zinc-600">Editable — fix any transcription errors before generating concepts</span>
          </div>
          <textarea
            value={lyrics}
            onChange={(e) => setEditedLyrics(e.target.value)}
            className="w-full h-56 bg-black/40 border border-white/10 rounded-xl p-4 text-sm text-zinc-300 font-mono leading-relaxed focus:border-accent-500/50 outline-none resize-none custom-scrollbar"
          />
        </div>

        {/* Meaning / Summary */}
        {project.meaning && (
          <div className="glass p-6 rounded-2xl space-y-3">
            <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Song Meaning</h3>
            <p className="text-sm text-zinc-300 leading-relaxed">{project.meaning}</p>
          </div>
        )}

        {/* Additional context for concept generation */}
        <div className="glass p-6 rounded-2xl space-y-3">
          <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Additional Context</h3>
          <p className="text-zinc-600 text-xs">Add any notes to guide concept generation — deity, narrative ideas, visual references, etc.</p>
          <textarea
            value={editedContext}
            onChange={(e) => setEditedContext(e.target.value)}
            placeholder="e.g. This is a devotional song for Lord Shiva. I want a dramatic, cinematic visual style with dark tones..."
            className="w-full h-24 bg-black/40 border border-white/10 rounded-xl p-4 text-sm text-white focus:border-accent-500/50 outline-none resize-none"
          />
        </div>

        {/* Generate Concepts CTA */}
        <div className="flex justify-center pt-4">
          <button
            onClick={() => onGenerateConcepts({
              lyrics: editedLyrics ?? project.lyrics ?? undefined,
              context: editedContext || undefined,
              language: language || undefined,
            })}
            disabled={isGeneratingConcepts}
            className="px-12 py-4 bg-gradient-to-r from-accent-600 to-violet-600 hover:from-accent-500 hover:to-violet-500 text-white font-bold rounded-xl shadow-lg shadow-accent-500/20 transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 text-sm tracking-wide"
          >
            {isGeneratingConcepts ? (
              <span className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating 3 Creative Directions...
              </span>
            ) : (
              'Generate Creative Concepts'
            )}
          </button>
        </div>
      </div>
    );
  }

  // Analyzing spinner
  if (isAnalyzing) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 animate-fade-in">
        <style>{`
          @keyframes ellipsis {
            0% { content: ''; }
            25% { content: '.'; }
            50% { content: '..'; }
            75% { content: '...'; }
          }
          .dots::after {
            content: '';
            animation: ellipsis 1.5s infinite;
          }
        `}</style>
        <div className="flex flex-col items-center gap-8 z-10">
          <div className="relative w-32 h-32">
            <div className="absolute inset-0 border-t-2 border-accent-400 rounded-full animate-spin"></div>
            <div className="absolute inset-2 border-r-2 border-accent-600/50 rounded-full animate-spin [animation-duration:1.5s]"></div>
            <div className="absolute inset-4 border-b-2 border-accent-100/30 rounded-full animate-spin [animation-duration:2s]"></div>
            <div className="absolute inset-0 flex items-center justify-center">
               <span className="text-4xl animate-pulse">~</span>
            </div>
          </div>
          <div className="text-center space-y-3">
            <h3 className="text-2xl font-display text-white">Analyzing Audio</h3>
            <div className="space-y-1">
              <p className="text-zinc-400 font-light tracking-wide">Transcribing Lyrics<span className="dots"></span></p>
              <p className="text-zinc-400 font-light tracking-wide">Detecting Song Structure<span className="dots" style={{ animationDelay: '0.5s' }}></span></p>
              <p className="text-zinc-400 font-light tracking-wide">Extracting Meaning<span className="dots" style={{ animationDelay: '1s' }}></span></p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default: upload form
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 animate-fade-in">
      <input
        type="file"
        ref={fileInputRef}
        accept="audio/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="glass p-12 rounded-3xl text-center max-w-xl w-full hover:bg-white/5 transition-all duration-500 group border border-white/5 shadow-2xl shadow-black/50">
        <div className="space-y-10">
          <div className="w-24 h-24 mx-auto bg-accent-500/10 rounded-2xl flex items-center justify-center border border-accent-500/20 group-hover:scale-110 group-hover:border-accent-400 group-hover:rotate-3 transition-all duration-300">
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-10 h-10 text-accent-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
             </svg>
          </div>

          <div className="space-y-4">
            <h2 className="text-5xl font-display font-medium text-white tracking-tight">New Project</h2>
            <p className="text-zinc-400 font-light leading-relaxed">
              Import your master track.
            </p>
          </div>

          {/* Metadata Inputs */}
          <div className="space-y-3 text-left">
              <div className="space-y-1">
                  <label className="text-xs text-zinc-500 uppercase font-bold pl-1">Song Title (Optional)</label>
                  <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Pranathosmi"
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-accent-500/50 outline-none"
                  />
              </div>
              <div className="space-y-1">
                  <label className="text-xs text-zinc-500 uppercase font-bold pl-1">Language (Optional)</label>
                  <input
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      placeholder="e.g. Sanskrit, Kannada"
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-accent-500/50 outline-none"
                  />
              </div>
              <div className="space-y-1">
                  <label className="text-xs text-zinc-500 uppercase font-bold pl-1">Context / Deity (Optional)</label>
                  <input
                      value={context}
                      onChange={(e) => setContext(e.target.value)}
                      placeholder="e.g. Lord Murugan, Carnatic Classical"
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-accent-500/50 outline-none"
                  />
              </div>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-12 py-4 bg-white text-black font-semibold rounded-xl hover:bg-accent-400 hover:text-white transition-all tracking-wide shadow-lg hover:shadow-accent-500/25"
          >
            Select Audio File
          </button>
        </div>
      </div>
    </div>
  );
};
