
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

  const [editedLyrics, setEditedLyrics] = useState<string | null>(null);
  const [editedContext, setEditedContext] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0], { title, context, language });
    }
  };

  const hasAnalysis = project && project.status !== 'uploaded' && project.status !== 'analyzing' && project.lyrics;
  const hasConcepts = project && project.conceptOptions.length > 0;

  // ─── Analysis review ───────────────────────────────────────────
  if (hasAnalysis && !hasConcepts) {
    const lyrics = editedLyrics ?? project.lyrics ?? '';
    const totalDuration = project.musicalStructure.length > 0
      ? parseTime(project.musicalStructure[project.musicalStructure.length - 1]?.endTime)
      : 60;

    return (
      <div className="max-w-4xl mx-auto space-y-8 animate-slide-up pb-32">
        {/* Header */}
        <div className="border-b border-white/[0.06] pb-5">
          <h2 className="text-2xl font-display font-medium text-white tracking-tight">{project.title}</h2>
          <p className="text-zinc-400 mt-1 text-sm">Review the analysis, then generate creative concepts.</p>
        </div>

        {/* Audio player */}
        {project.audioPath && (
          <div className="surface rounded-xl p-4 flex items-center gap-4">
            <audio controls src={`/storage/${project.audioPath}`} className="flex-1 h-10" />
          </div>
        )}

        {/* Song Structure Timeline */}
        {project.musicalStructure.length > 0 && (
          <div className="surface rounded-xl p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Song Structure</h3>
              <span className="text-[11px] text-zinc-400">{project.musicalStructure.length} sections</span>
            </div>
            <div className="relative h-14 w-full bg-black/40 rounded-lg flex overflow-hidden border border-white/[0.04]">
              {project.musicalStructure.map((section, idx) => {
                const start = parseTime(section.startTime);
                const end = parseTime(section.endTime);
                const width = Math.max(((end - start) / totalDuration) * 100, 2);
                let bgClass = 'bg-zinc-800';
                const label = (section.label || '').toLowerCase();
                if (label.includes('chorus')) bgClass = 'bg-amber-500/60';
                else if (label.includes('verse')) bgClass = 'bg-accent-500/30';
                else if (label.includes('bridge')) bgClass = 'bg-violet-500/30';
                else if (label.includes('intro') || label.includes('outro')) bgClass = 'bg-zinc-700';
                else if (label.includes('interlude')) bgClass = 'bg-cyan-500/20';
                return (
                  <div
                    key={idx}
                    style={{ width: `${width}%` }}
                    className={`h-full ${bgClass} border-r border-black/30 flex flex-col items-center justify-center`}
                  >
                    <span className="text-[11px] font-medium text-white/80 uppercase truncate px-1">{section.label}</span>
                    <span className="text-[11px] text-white/40 font-mono">{section.startTime}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Lyrics */}
        <div className="surface rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Transcribed Lyrics</h3>
            <span className="text-[11px] text-zinc-400">Editable</span>
          </div>
          <textarea
            value={lyrics}
            onChange={(e) => setEditedLyrics(e.target.value)}
            className="w-full h-48 surface-inset rounded-lg p-4 text-sm text-zinc-300 font-mono leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-white/20 resize-none"
          />
        </div>

        {/* Meaning */}
        {project.meaning && (
          <div className="surface rounded-xl p-6 space-y-3">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Song Meaning</h3>
            <p className="text-sm text-zinc-300 leading-relaxed">{project.meaning}</p>
          </div>
        )}

        {/* Additional context */}
        <div className="surface rounded-xl p-6 space-y-3">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Additional Context</h3>
          <p className="text-zinc-400 text-[11px]">Add notes to guide concept generation — deity, narrative ideas, visual references.</p>
          <textarea
            value={editedContext}
            onChange={(e) => setEditedContext(e.target.value)}
            placeholder="e.g. This is a devotional song for Lord Shiva…"
            className="w-full h-20 surface-inset rounded-lg p-4 text-sm text-white outline-none focus-visible:ring-1 focus-visible:ring-white/20 resize-none"
          />
        </div>

        {/* CTA */}
        <div className="flex justify-center pt-4">
          <button
            onClick={() => onGenerateConcepts({
              lyrics: editedLyrics ?? project.lyrics ?? undefined,
              context: editedContext || undefined,
              language: language || undefined,
            })}
            disabled={isGeneratingConcepts}
            className="px-10 py-3 bg-white text-black font-semibold rounded-md hover:bg-zinc-200 transition-colors disabled:opacity-50 text-sm outline-none focus-visible:ring-1 focus-visible:ring-white/20"
          >
            {isGeneratingConcepts ? (
              <span className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />
                Generating Concepts...
              </span>
            ) : (
              'Generate Creative Concepts'
            )}
          </button>
        </div>
      </div>
    );
  }

  // ─── Analyzing spinner ──────────────────────────────────────────
  if (isAnalyzing) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <div className="flex flex-col items-center gap-6">
          <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
          <div className="text-center space-y-2">
            <h3 className="text-lg font-display text-white">Analyzing audio</h3>
            <p className="text-sm text-zinc-400">Transcribing, detecting structure, extracting meaning</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Upload form ────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <input
        type="file"
        ref={fileInputRef}
        accept="audio/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="gradient-border rounded-2xl p-10 text-center max-w-md w-full">
        <div className="space-y-8">
          <div className="w-16 h-16 mx-auto bg-gradient-to-br from-accent-500/10 to-purple-500/10 rounded-2xl flex items-center justify-center">
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-8 h-8 text-zinc-400" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
             </svg>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-display font-semibold tracking-tight gradient-text">New Project</h2>
            <p className="text-zinc-400 text-sm">Import your master track.</p>
          </div>

          <div className="space-y-3 text-left">
              <div className="space-y-1">
                  <label htmlFor="song-title" className="text-[11px] text-zinc-400 uppercase font-medium pl-1">Song Title</label>
                  <input
                      id="song-title"
                      name="title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Pranathosmi"
                      autoComplete="off"
                      className="w-full surface-inset rounded-md px-4 py-2.5 text-sm text-white outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                  />
              </div>
              <div className="space-y-1">
                  <label htmlFor="song-language" className="text-[11px] text-zinc-400 uppercase font-medium pl-1">Language</label>
                  <input
                      id="song-language"
                      name="language"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      placeholder="e.g. Sanskrit, Kannada"
                      autoComplete="off"
                      className="w-full surface-inset rounded-md px-4 py-2.5 text-sm text-white outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                  />
              </div>
              <div className="space-y-1">
                  <label htmlFor="song-context" className="text-[11px] text-zinc-400 uppercase font-medium pl-1">Context / Deity</label>
                  <input
                      id="song-context"
                      name="context"
                      value={context}
                      onChange={(e) => setContext(e.target.value)}
                      placeholder="e.g. Lord Murugan, Carnatic Classical"
                      autoComplete="off"
                      className="w-full surface-inset rounded-md px-4 py-2.5 text-sm text-white outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                  />
              </div>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-8 py-3 bg-white text-black font-semibold rounded-md hover:bg-zinc-200 transition-colors text-sm outline-none focus-visible:ring-1 focus-visible:ring-white/20"
          >
            Select Audio File
          </button>
        </div>
      </div>
    </div>
  );
};
