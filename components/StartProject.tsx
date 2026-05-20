import React, { useRef, useState } from 'react';
import { AutoGrowTextarea } from './AutoGrowTextarea';

export type IntakeMode = 'music_led' | 'scripted_narrative';

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
  targetRuntime?: number;
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
    key: 'music_led',
    label: 'Music Video',
    presetKey: 'music_video_default',
    presetLabel: 'Music Video Default',
    seedLabel: 'Audio',
    tagline: 'Audio-first',
    description: 'Upload a track. Scenes sync to musical structure; concept, style, cast, and shots come from there.',
  },
  {
    key: 'scripted_narrative',
    label: 'Anime',
    presetKey: 'anime_default',
    presetLabel: 'Anime Default',
    seedLabel: 'Script',
    tagline: 'Script-first',
    description: 'Paste a scene or episode script. Cast, environments, scenes, and shots parse straight into Studio.',
  },
];

// Shared input/textarea classes. Matches the dense surface-inset look used
// across BlueprintContextBar, ScriptPhase, CharactersPhase, etc.
const FIELD_BASE = 'surface-inset rounded-md px-2.5 py-1.5 text-sm text-white placeholder:text-zinc-500 outline-none focus-visible:ring-1 focus-visible:ring-white/20';

export const StartProject: React.FC<Props> = ({ onCreate, creating, error }) => {
  const [mode, setMode] = useState<IntakeMode>('music_led');

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
    if (!audioTitle) setAudioTitle(file.name.replace(/\.[^.]+$/, ''));
  };

  const canSubmit = mode === 'music_led'
    ? !!audioFile && !creating
    : !!scriptText.trim() && !creating;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (mode === 'music_led') {
      await onCreate({
        workflowKey: 'music_led',
        seedKind: 'audio',
        presetKey: 'music_video_default',
        seedFile: audioFile!,
        title: audioTitle.trim() || undefined,
        language: audioLanguage.trim() || undefined,
        context: audioContext.trim() || undefined,
      });
    } else {
      await onCreate({
        workflowKey: 'scripted_narrative',
        seedKind: 'script',
        presetKey: 'anime_default',
        scriptText: scriptText.trim(),
        title: scriptTitle.trim() || undefined,
        directorBrief: scriptBrief.trim() || undefined,
        targetRuntime: scriptRuntime.trim() ? Number(scriptRuntime) : undefined,
      });
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-32 space-y-6">
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
              className={`text-left p-4 rounded-lg border transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
                active
                  ? 'border-white/30 bg-white/[0.04]'
                  : 'border-white/[0.06] bg-white/[0.015] hover:border-white/[0.12] hover:bg-white/[0.025]'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-base font-display text-white">{m.label}</h3>
                <span className={`text-[10px] uppercase tracking-wider font-mono ${active ? 'text-white' : 'text-zinc-400'}`}>
                  {active ? 'Selected' : m.tagline}
                </span>
              </div>
              <p className="text-xs text-zinc-300 mt-1.5 leading-relaxed">{m.description}</p>
              <div className="text-[10px] uppercase tracking-wider text-zinc-400 mt-3 flex items-center gap-2 font-mono">
                <span>Seed · <span className="text-zinc-300">{m.seedLabel}</span></span>
                <span className="text-zinc-600">·</span>
                <span>Preset · <span className="text-zinc-300">{m.presetLabel}</span></span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Mode-specific form */}
      <div className="border border-white/[0.06] rounded-lg bg-white/[0.015] p-4 space-y-3">
        {mode === 'music_led' && (
          <>
            <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono">Audio seed</p>

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
              className={`relative cursor-pointer rounded-md border-2 border-dashed transition-colors p-6 text-center ${
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
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400"><path d="M20 6L9 17l-5-5"/></svg>
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

            <div className="grid grid-cols-1 md:grid-cols-[1fr_160px] gap-2">
              <input
                value={audioTitle}
                onChange={(e) => setAudioTitle(e.target.value)}
                placeholder="Project title (optional)"
                className={`w-full ${FIELD_BASE}`}
              />
              <input
                value={audioLanguage}
                onChange={(e) => setAudioLanguage(e.target.value)}
                placeholder="Language (optional)"
                className={`w-full ${FIELD_BASE}`}
              />
            </div>

            <AutoGrowTextarea
              value={audioContext}
              onChange={(e) => setAudioContext(e.target.value)}
              placeholder="Brief, context, or director note (optional)"
              rows={2}
              className={`w-full ${FIELD_BASE} leading-relaxed`}
            />
          </>
        )}

        {mode === 'scripted_narrative' && (
          <>
            <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono">Script seed</p>

            {/* Title + Runtime on one row — both single-line, so heights match.
                Pairing Runtime with a multiline textarea (old layout) is what
                made the runtime box look massive. */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_140px] gap-2">
              <input
                value={scriptTitle}
                onChange={(e) => setScriptTitle(e.target.value)}
                placeholder="Project title (optional)"
                className={`w-full ${FIELD_BASE}`}
              />
              <input
                value={scriptRuntime}
                onChange={(e) => setScriptRuntime(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="Total runtime · sec"
                inputMode="numeric"
                className={`w-full ${FIELD_BASE} font-mono tabular-nums`}
              />
            </div>

            {/* Script paste — AutoGrow so pasted content never traps in a
                scroll well. The parser pulls cast/environments/scenes/shots. */}
            <AutoGrowTextarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder={'INT. CLASSROOM — AFTERNOON\nMina pauses at the doorway. The room goes quiet.\n\nREN\n  You came back.'}
              rows={10}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className={`w-full ${FIELD_BASE} font-mono text-[13px] leading-relaxed min-h-[220px]`}
            />

            <AutoGrowTextarea
              value={scriptBrief}
              onChange={(e) => setScriptBrief(e.target.value)}
              placeholder="Director brief (optional) — tone, references, what NOT to do"
              rows={2}
              className={`w-full ${FIELD_BASE} leading-relaxed`}
            />
          </>
        )}

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        <div className="flex items-center justify-end pt-1">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-1.5 bg-white text-black rounded-md text-xs font-semibold hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {creating && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin" />}
            {creating
              ? (mode === 'music_led' ? 'Uploading…' : 'Parsing…')
              : (mode === 'music_led' ? 'Start project' : 'Parse & open Studio')}
          </button>
        </div>
      </div>
    </div>
  );
};
