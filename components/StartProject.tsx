import React, { useRef, useState } from 'react';

export type IntakeMode = 'music_video' | 'anime_scripted';

export interface CreateIntakeOpts {
  workflowKey: IntakeMode;
  seedKind: 'audio' | 'script';
  presetKey: 'music_video_default' | 'anime_default';
  seedFile?: File;
  scriptText?: string;
  title?: string;
  context?: string;
  language?: string;
  directorBrief?: string;
  targetDuration?: number;
}

interface Props {
  onCreate: (opts: CreateIntakeOpts) => Promise<void> | void;
  creating: boolean;
  error: string | null;
}

const MODES: Array<{
  key: IntakeMode;
  label: string;
  presetKey: 'music_video_default' | 'anime_default';
  presetLabel: string;
  seedLabel: string;
  tagline: string;
  description: string;
}> = [
  {
    key: 'music_video',
    label: 'Music Video',
    presetKey: 'music_video_default',
    presetLabel: 'Music Video Default',
    seedLabel: 'Audio',
    tagline: 'Audio-first',
    description: 'Upload a track. Scenes are synced to the musical structure, then concept, style, cast, and shots come from there.',
  },
  {
    key: 'anime_scripted',
    label: 'Anime',
    presetKey: 'anime_default',
    presetLabel: 'Anime Default',
    seedLabel: 'Script',
    tagline: 'Script-first',
    description: 'Paste a scene or episode script. Cast, environments, scenes, and shots are parsed straight into Studio.',
  },
];

export const StartProject: React.FC<Props> = ({ onCreate, creating, error }) => {
  const [mode, setMode] = useState<IntakeMode>('music_video');

  // Music video state
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioTitle, setAudioTitle] = useState('');
  const [audioLanguage, setAudioLanguage] = useState('');
  const [audioContext, setAudioContext] = useState('');
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Anime state
  const [scriptTitle, setScriptTitle] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [scriptBrief, setScriptBrief] = useState('');
  const [scriptRuntime, setScriptRuntime] = useState('');

  const handleAudioPick = (file: File | null) => {
    if (!file) return;
    setAudioFile(file);
    if (!audioTitle) {
      // Pre-fill title from filename minus extension.
      setAudioTitle(file.name.replace(/\.[^.]+$/, ''));
    }
  };

  const canSubmit =
    mode === 'music_video' ? !!audioFile && !creating : !!scriptText.trim() && !creating;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (mode === 'music_video') {
      await onCreate({
        workflowKey: 'music_video',
        seedKind: 'audio',
        presetKey: 'music_video_default',
        seedFile: audioFile!,
        title: audioTitle.trim() || undefined,
        language: audioLanguage.trim() || undefined,
        context: audioContext.trim() || undefined,
      });
    } else {
      await onCreate({
        workflowKey: 'anime_scripted',
        seedKind: 'script',
        presetKey: 'anime_default',
        scriptText: scriptText.trim(),
        title: scriptTitle.trim() || undefined,
        directorBrief: scriptBrief.trim() || undefined,
        targetDuration: scriptRuntime.trim() ? Number(scriptRuntime) : undefined,
      });
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-32 space-y-8">
      <div>
        <h2 className="text-2xl font-display font-medium text-white">Start a project</h2>
        <p className="text-sm text-zinc-400 mt-1">Pick what you're making. Each mode brings its own seed and defaults.</p>
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {MODES.map((m) => {
          const active = mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`text-left p-5 rounded-xl border transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
                active
                  ? 'border-white/30 bg-white/[0.04]'
                  : 'border-white/[0.06] bg-white/[0.015] hover:border-white/[0.12] hover:bg-white/[0.025]'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-display text-white">{m.label}</h3>
                <span className={`text-[10px] uppercase tracking-wider font-mono ${active ? 'text-white' : 'text-zinc-400'}`}>
                  {active ? 'Selected' : m.tagline}
                </span>
              </div>
              <p className="text-sm text-zinc-300 mt-2 leading-relaxed">{m.description}</p>
              <div className="text-[11px] text-zinc-400 mt-4 flex items-center gap-3">
                <span>Seed: <span className="text-zinc-300">{m.seedLabel}</span></span>
                <span className="text-zinc-600">·</span>
                <span>Preset: <span className="text-zinc-300">{m.presetLabel}</span></span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Mode-specific form */}
      <div className="border border-white/[0.06] rounded-xl bg-white/[0.015] p-5">
        {mode === 'music_video' && (
          <div className="space-y-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-zinc-400 font-medium">Audio seed</p>
              <p className="text-xs text-zinc-400 mt-1">Drop an mp3/wav/m4a, or click to choose.</p>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleAudioPick(f);
              }}
              onClick={() => audioInputRef.current?.click()}
              className={`relative cursor-pointer rounded-lg border-2 border-dashed transition-colors p-8 text-center ${
                dragging
                  ? 'border-white/40 bg-white/[0.05]'
                  : audioFile
                    ? 'border-white/[0.12] bg-white/[0.02]'
                    : 'border-white/[0.08] hover:border-white/[0.16] bg-white/[0.01]'
              }`}
            >
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                onChange={(e) => handleAudioPick(e.target.files?.[0] || null)}
                className="hidden"
              />
              {audioFile ? (
                <div className="flex items-center justify-center gap-3 text-sm">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400"><path d="M20 6L9 17l-5-5"/></svg>
                  <span className="text-white truncate max-w-[420px]">{audioFile.name}</span>
                  <span className="text-zinc-400 text-xs">{(audioFile.size / 1024 / 1024).toFixed(1)} MB</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setAudioFile(null); }}
                    className="text-[11px] text-zinc-400 hover:text-white px-2 py-0.5 rounded hover:bg-white/[0.06] transition-colors"
                  >
                    Replace
                  </button>
                </div>
              ) : (
                <div className="text-sm text-zinc-300">
                  <span className="text-white">Drop audio file</span>
                  <span className="text-zinc-400"> or click to choose</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
              <input
                value={audioTitle}
                onChange={(e) => setAudioTitle(e.target.value)}
                placeholder="Project title (optional)"
                className="surface-inset rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
              />
              <input
                value={audioLanguage}
                onChange={(e) => setAudioLanguage(e.target.value)}
                placeholder="Language (optional)"
                className="surface-inset rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
              />
            </div>

            <textarea
              value={audioContext}
              onChange={(e) => setAudioContext(e.target.value)}
              placeholder="Brief, context, or director note (optional)"
              className="w-full h-20 surface-inset rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus-visible:ring-1 focus-visible:ring-white/20 resize-none"
            />
          </div>
        )}

        {mode === 'anime_scripted' && (
          <div className="space-y-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-zinc-400 font-medium">Script seed</p>
              <p className="text-xs text-zinc-400 mt-1">Paste a scene, episode beat, or full script. The parser will pull out cast, environments, scenes, and shots.</p>
            </div>

            <input
              value={scriptTitle}
              onChange={(e) => setScriptTitle(e.target.value)}
              placeholder="Project title (optional)"
              className="w-full surface-inset rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
            />

            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder={'INT. CLASSROOM - AFTERNOON\nMina pauses at the doorway. The room goes quiet.\n\nREN\n  You came back.'}
              className="w-full h-56 surface-inset rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus-visible:ring-1 focus-visible:ring-white/20 resize-y font-mono leading-relaxed"
            />

            <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
              <textarea
                value={scriptBrief}
                onChange={(e) => setScriptBrief(e.target.value)}
                placeholder="Director brief (optional)"
                className="surface-inset rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus-visible:ring-1 focus-visible:ring-white/20 resize-none h-20"
              />
              <input
                value={scriptRuntime}
                onChange={(e) => setScriptRuntime(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="Runtime (sec)"
                inputMode="numeric"
                className="surface-inset rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
              />
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400 mt-4">{error}</p>
        )}

        <div className="flex items-center justify-end mt-5">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-5 py-2 bg-white text-black rounded-md text-sm font-semibold hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {creating && <div className="w-3.5 h-3.5 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />}
            {creating
              ? (mode === 'music_video' ? 'Uploading…' : 'Parsing…')
              : (mode === 'music_video' ? 'Start Project' : 'Parse & Open Studio')}
          </button>
        </div>
      </div>
    </div>
  );
};
