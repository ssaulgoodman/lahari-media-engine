
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ApiProject } from '../types';
import * as api from '../services/api';
import { Markdown } from './Markdown';
import { IMAGE_MODELS, getImageModel } from '../constants/imageModels';
import { VIDEO_MODELS, getVideoModel } from '../constants/videoModels';
import { Dropdown } from './Dropdown';

export type Phase = 'concept' | 'script' | 'style' | 'characters' | 'environments';

export const PHASE_ORDER: Phase[] = ['concept', 'script', 'style', 'characters', 'environments'];

export const phaseIndex = (p: Phase) => PHASE_ORDER.indexOf(p);

export const getActivePhase = (project: ApiProject): Phase => {
  let statusPhase: Phase;
  switch (project.status) {
    case 'uploaded':
    case 'analyzing':
    case 'analyzed':
    case 'error':
      statusPhase = 'concept'; break;
    case 'concept_locked':
      statusPhase = 'script'; break;
    case 'scripted':
      statusPhase = 'style'; break;
    case 'style_locked':
      statusPhase = 'characters'; break;
    case 'characters_locked':
    case 'environments_locked':
    case 'in_production':
    case 'rendered':
      statusPhase = 'environments'; break;
    default:
      statusPhase = 'concept';
  }

  let dataPhase: Phase = 'concept';
  if (project.lockedConcept) dataPhase = 'script';
  if ((project.scenes?.length ?? 0) > 0) dataPhase = 'style';
  if (project.styleAssetUrl) dataPhase = 'characters';
  if (project.cast?.some(c => !!c.referenceImageUrl)) dataPhase = 'environments';
  if (project.environments?.some(e => !!e.referenceImageUrl)) dataPhase = 'environments';

  return phaseIndex(dataPhase) > phaseIndex(statusPhase) ? dataPhase : statusPhase;
};

export const getStatusLockedPhase = (status: string): Phase => {
  switch (status) {
    case 'uploaded': case 'analyzing': case 'analyzed': case 'error': return 'concept';
    case 'concept_locked': return 'script';
    case 'scripted': return 'style';
    case 'style_locked': return 'characters';
    default: return 'environments';
  }
};

export const isLockedPhase = (phase: Phase, status: string): boolean => {
  const statusLocked = getStatusLockedPhase(status);
  if (phase !== 'environments') return phaseIndex(phase) < phaseIndex(statusLocked);
  return ['environments_locked', 'in_production', 'rendered', 'completed'].includes(status);
};

interface Props {
  project: ApiProject;
  isLoading: boolean;
  viewPhase: Phase;
  activePhase: Phase;
  showLaunch: boolean;
  actionError: string | null;
  onSetViewPhase: (phase: Phase) => void;
  onUpdateProject: (updates: Record<string, any>) => void;
  onLaunchStudio: () => void;
  onSetProject?: (project: ApiProject) => void;
  onClearActionError: () => void;
  showActionError: (msg: string) => void;
}

export const BlueprintContextBar: React.FC<Props> = ({
  project, isLoading, viewPhase, activePhase, showLaunch, actionError,
  onSetViewPhase, onUpdateProject, onLaunchStudio, onSetProject, onClearActionError, showActionError,
}) => {
  const [contextPopover, setContextPopover] = useState<'render' | 'analysis' | null>(null);
  const contextBarRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState(false);

  useEffect(() => {
    if (!contextPopover) return;
    const onDown = (e: MouseEvent) => {
      if (contextBarRef.current && !contextBarRef.current.contains(e.target as Node)) setContextPopover(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextPopover(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [contextPopover]);

  const handleRerunAnalysis = async () => {
    setIsAnalyzingAudio(true);
    try {
      const updated = await api.analyzeAudio(project.id);
      onSetProject?.(updated);
    } catch (err: any) {
      showActionError(`Analysis failed: ${err.message}`);
    } finally {
      setIsAnalyzingAudio(false);
    }
  };

  const canAccess = (phase: Phase) => phaseIndex(phase) <= phaseIndex(activePhase);
  const hasGeneratedMedia = !!project.styleAssetUrl
    || project.cast.some(c => c.referenceImageUrl)
    || project.environments.some(e => e.referenceImageUrl);

  const aspectLabel = project.aspectRatio || '16:9';
  const resLabel = project.videoResolution || '720p';
  const imageLabel = getImageModel(project.imageModel || IMAGE_MODELS[0].key).label;
  const modelLabel = getVideoModel(project.videoModel || VIDEO_MODELS[0].key).label;
  const renderSummary = `${aspectLabel} · ${resLabel} · ${imageLabel} · ${modelLabel}`;
  const songTypeLabel = project.songType && project.songType !== 'unknown'
    ? project.songType.charAt(0).toUpperCase() + project.songType.slice(1)
      + (project.isMeditative ? ' · Meditative' : '')
      + (project.isNarrative ? ' · Narrative' : '')
    : null;
  const analysisItems = [
    { label: 'Lyrics', present: !!project.lyrics },
    { label: 'Structure', present: project.musicalStructure?.length > 0 },
    { label: 'Meaning', present: !!project.meaning },
    ...(songTypeLabel ? [{ label: songTypeLabel, present: true }] : []),
  ];
  const hasAnalysis = !!(project.meaning || project.musicalStructure?.length > 0 || project.lyrics);
  const needsAnalysis = !project.lyrics || !project.meaning || !(project.musicalStructure?.length > 0);

  return (
    <>
      <div ref={contextBarRef} className="sticky top-0 z-40 mb-6">
        <div className="surface rounded-xl border border-white/[0.06] bg-[#141418] shadow-md shadow-black/15">
          {/* Row 1: Title + chips + Launch */}
          <div className="flex items-center gap-3 h-12 px-4">
            <h2 className="text-base font-display font-medium text-white tracking-tight truncate flex-shrink-0 max-w-[180px]">{project.title || 'Blueprint'}</h2>

            {/* Audio mini player */}
            {project.audioPath && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <audio
                  ref={audioRef}
                  src={project.audioPath}
                  onEnded={() => setAudioPlaying(false)}
                  onPause={() => setAudioPlaying(false)}
                  onPlay={() => setAudioPlaying(true)}
                  onLoadedMetadata={() => setAudioDuration(audioRef.current?.duration || 0)}
                  onTimeUpdate={() => {
                    const el = audioRef.current;
                    if (!el || !el.duration) return;
                    setAudioCurrentTime(el.currentTime);
                    setAudioProgress(el.currentTime / el.duration);
                  }}
                />
                <button
                  onClick={() => {
                    const el = audioRef.current;
                    if (!el) return;
                    if (el.paused) el.play().catch(() => {});
                    else el.pause();
                  }}
                  className={`w-6 h-6 rounded flex items-center justify-center transition-colors flex-shrink-0 ${audioPlaying ? 'text-white' : 'text-zinc-400 hover:text-white'}`}
                  title={audioPlaying ? 'Pause' : 'Play song'}
                >
                  {audioPlaying ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  )}
                </button>
                <div
                  className="relative w-28 h-5 flex items-center cursor-pointer group"
                  onClick={(e) => {
                    const el = audioRef.current;
                    if (!el || !el.duration) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    el.currentTime = pct * el.duration;
                  }}
                >
                  <div className="absolute inset-x-0 h-1 rounded-full bg-white/[0.08]">
                    <div className="h-full rounded-full bg-white/40 group-hover:bg-white/60 transition-colors" style={{ width: `${audioProgress * 100}%` }} />
                  </div>
                </div>
                <span className="text-[10px] font-mono text-zinc-400 tabular-nums w-[70px] text-right flex-shrink-0">
                  {Math.floor(audioCurrentTime / 60)}:{String(Math.floor(audioCurrentTime % 60)).padStart(2, '0')}
                  {audioDuration > 0 && <span className="text-zinc-500"> / {Math.floor(audioDuration / 60)}:{String(Math.floor(audioDuration % 60)).padStart(2, '0')}</span>}
                </span>
              </div>
            )}

            <div className="w-px h-5 bg-white/[0.06] flex-shrink-0" />

            {/* Render chip */}
            <button
              onClick={() => setContextPopover(p => p === 'render' ? null : 'render')}
              className={`flex items-center gap-2 px-2.5 py-1 rounded-md transition-colors ${contextPopover === 'render' ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'}`}
              aria-expanded={contextPopover === 'render'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400" aria-hidden="true">
                <circle cx="12" cy="12" r="3"/><path d="M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24"/>
              </svg>
              <span className="text-[11px] uppercase tracking-wide text-zinc-400">Render</span>
              <span className="text-xs text-zinc-300 truncate max-w-[260px]">{renderSummary}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-zinc-400 transition-transform ${contextPopover === 'render' ? 'rotate-180' : ''}`} aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>

            <div className="flex-1" />

            {/* Analysis chip */}
            {hasAnalysis && (
              <button
                onClick={() => setContextPopover(p => p === 'analysis' ? null : 'analysis')}
                className={`flex items-center gap-2 px-2.5 py-1 rounded-md transition-colors ${contextPopover === 'analysis' ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'}`}
                aria-expanded={contextPopover === 'analysis'}
              >
                <span className="flex items-center gap-1.5">
                  {analysisItems.map(it => (
                    <span key={it.label} className={`text-[11px] ${it.present ? 'text-zinc-300' : 'text-amber-300/80'}`}>
                      {it.present ? '✓' : '—'} {it.label}
                    </span>
                  ))}
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-zinc-400 transition-transform ${contextPopover === 'analysis' ? 'rotate-180' : ''}`} aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
            )}

            {/* Launch Studio */}
            {showLaunch && (
              <button onClick={onLaunchStudio} disabled={isLoading} className="bg-white text-black px-4 py-1.5 rounded-md font-semibold text-xs hover:bg-zinc-200 transition-colors disabled:opacity-50 flex items-center gap-2 flex-shrink-0">
                {isLoading && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin"></div>}
                {isLoading ? 'Writing prompts…' : 'Launch Studio'}
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            )}
          </div>

          {/* Row 2: Phase tabs */}
          <div className="flex items-center justify-center gap-0 px-4 py-2.5 border-t border-white/[0.04]">
            {PHASE_ORDER.map((phase, idx) => {
              const locked = isLockedPhase(phase, project.status);
              const active = viewPhase === phase;
              const accessible = canAccess(phase);
              return (
                <React.Fragment key={phase}>
                  <button
                    disabled={!accessible}
                    onClick={() => accessible && onSetViewPhase(phase)}
                    className={`relative px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'text-white'
                        : locked
                          ? 'text-zinc-300 hover:text-white'
                          : accessible
                            ? 'text-zinc-400 hover:text-zinc-300'
                            : 'text-zinc-400/40 cursor-not-allowed'
                    }`}
                  >
                    {locked && (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-2.5 h-2.5 mr-1 inline" aria-hidden="true">
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                      </svg>
                    )}
                    {phase.charAt(0).toUpperCase() + phase.slice(1)}
                    {active && <span aria-hidden="true" className="absolute left-3 right-3 -bottom-0.5 h-px bg-white/60" />}
                  </button>
                  {idx < PHASE_ORDER.length - 1 && <div className={`w-6 h-px ${locked ? 'bg-white/20' : 'bg-white/[0.06]'}`} />}
                </React.Fragment>
              );
            })}
          </div>

          {/* Popover panels */}
          <AnimatePresence initial={false}>
            {contextPopover === 'render' && (
              <motion.div
                key="render-pop"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto', overflow: 'visible' }}
                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                transition={{ duration: 0.18 }}
                className="border-t border-white/[0.06]"
              >
                <div className="flex items-stretch divide-x divide-white/[0.06]">
                  <div className="flex-1 px-5 py-3 space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-400">Aspect</div>
                    <Dropdown
                      value={project.aspectRatio || '16:9'}
                      onChange={v => onUpdateProject({ aspectRatio: v })}
                      disabled={hasGeneratedMedia}
                      title={hasGeneratedMedia ? 'Aspect is locked once images are generated — unlock phases and regenerate to change' : undefined}
                      options={[
                        { value: '16:9', label: '16:9 — landscape' },
                        { value: '9:16', label: '9:16 — portrait' },
                        { value: '1:1', label: '1:1 — square' },
                      ]}
                    />
                  </div>
                  <div className="flex-1 px-5 py-3 space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-400">Resolution</div>
                    <Dropdown
                      value={project.videoResolution || '720p'}
                      onChange={v => onUpdateProject({ videoResolution: v })}
                      options={[
                        { value: '720p', label: '720p (HD)' },
                        { value: '1080p', label: '1080p (Full HD)' },
                      ]}
                    />
                  </div>
                  <div className="flex-[1.25] px-5 py-3 space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-400">Image model</div>
                    <Dropdown
                      value={project.imageModel || IMAGE_MODELS[0].key}
                      onChange={v => onUpdateProject({ imageModel: v })}
                      options={IMAGE_MODELS.map(m => ({
                        value: m.key,
                        label: m.note ? `${m.label} · ${m.note}` : m.label,
                      }))}
                    />
                  </div>
                  <div className="flex-[1.5] px-5 py-3 space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-400">Video model</div>
                    <Dropdown
                      value={project.videoModel || VIDEO_MODELS[0].key}
                      onChange={v => {
                        const newModel = getVideoModel(v);
                        const currentModel = getVideoModel(project.videoModel);
                        const shotCount = project.scenes.reduce((acc, s) => acc + s.shots.length, 0);
                        const hasVideos = project.scenes.some(s => s.shots.some((sh: any) => sh.videoUrl));
                        const durationMismatch = shotCount > 0 && !newModel.durations.some(d => currentModel.durations.includes(d));

                        if (hasVideos && durationMismatch) {
                          const ok = window.confirm(
                            `Switching from ${currentModel.label} (${currentModel.durations.join('/')}s) to ${newModel.label} (${newModel.durations.join('/')}s).\n\nExisting shot durations will be clamped to the nearest supported value. Already-generated videos won't change, but new generations will use the new durations.\n\nContinue?`
                          );
                          if (!ok) return;
                        }

                        const updates: Record<string, any> = { videoModel: v };
                        if (!newModel.durations.includes(project.targetDuration)) updates.targetDuration = newModel.durations[0];
                        onUpdateProject(updates);
                      }}
                      options={VIDEO_MODELS.map(m => ({ value: m.key, label: `${m.label} · ${m.durations.join('/')}s · $${m.costPerSec.toFixed(2)}/s` }))}
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {contextPopover === 'analysis' && (
              <motion.div
                key="analysis-pop"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden border-t border-white/[0.06]"
              >
                <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                  {needsAnalysis && (
                    <div className="flex justify-end">
                      <button
                        onClick={handleRerunAnalysis}
                        disabled={isAnalyzingAudio}
                        className="text-[11px] bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-300 hover:text-white px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {isAnalyzingAudio && <div className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>}
                        {isAnalyzingAudio ? 'Analyzing…' : `Fill missing (${analysisItems.filter(i => !i.present).map(i => i.label).join(', ')})`}
                      </button>
                    </div>
                  )}
                  {project.meaning && (
                    <div>
                      <h4 className="text-[11px] uppercase tracking-wide text-zinc-400 mb-2">Meaning</h4>
                      <Markdown>{project.meaning}</Markdown>
                    </div>
                  )}
                  {project.musicalStructure?.length > 0 && (
                    <div>
                      <h4 className="text-[11px] uppercase tracking-wide text-zinc-400 mb-2">Musical structure</h4>
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                        {project.musicalStructure.map((section, idx) => (
                          <div key={idx} className="surface-inset rounded-md px-3 py-2 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-white font-medium truncate">{section.label}</span>
                              <span className="text-[11px] text-zinc-400 font-mono flex-shrink-0">{section.startTime}–{section.endTime}</span>
                            </div>
                            {section.description && <p className="text-sm text-zinc-300 mt-1 leading-relaxed">{section.description}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {project.lyrics && (
                    <div>
                      <h4 className="text-[11px] uppercase tracking-wide text-zinc-400 mb-2">Lyrics</h4>
                      <pre className="surface-inset rounded-md p-3 text-sm text-zinc-300 font-sans whitespace-pre-wrap leading-relaxed">{project.lyrics}</pre>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border border-red-500/20 bg-red-500/[0.06] flex items-start gap-2 text-sm text-red-400 cursor-pointer" onClick={onClearActionError}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 mt-0.5 flex-shrink-0">
            <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
          </svg>
          <span>{actionError}</span>
        </div>
      )}
    </>
  );
};
