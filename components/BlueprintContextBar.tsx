
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ApiProject } from '../types';
import * as api from '../services/api';
import { Markdown } from './Markdown';
import { IMAGE_MODELS } from '../constants/imageModels';
import { VIDEO_MODELS, getVideoModel } from '../constants/videoModels';
import { STORYBOARD_PROVIDERS } from '../constants/storyboardProviders';
import { TEXT_PROVIDERS } from '../constants/textProviders';
import {
  type Phase,
  getBlueprintPhases,
  getNavigablePhaseKeys,
  isPhaseComingSoon,
} from '../constants/blueprintPhases';
import { Dropdown } from './Dropdown';

export type { Phase };

/** Index within navigable phases for THIS project's workflow. Pass the project
 *  so workflows with different phase sets (e.g. anime's Audio tab) compute
 *  ordering against the right list. */
export const phaseIndex = (project: { workflowKey?: ApiProject['workflowKey'] }, phase: Phase): number =>
  getNavigablePhaseKeys(project).indexOf(phase);

export const getActivePhase = (project: ApiProject): Phase => {
  const navigable = getNavigablePhaseKeys(project);
  const lastPhase = navigable[navigable.length - 1] || 'concept';

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
      statusPhase = lastPhase; break;
    default:
      statusPhase = 'concept';
  }

  let dataPhase: Phase = 'concept';
  if (project.lockedConcept) dataPhase = 'script';
  if ((project.scenes?.length ?? 0) > 0) dataPhase = 'style';
  if (project.styleAssetUrl) dataPhase = 'characters';
  if (project.cast?.some(c => !!c.referenceImageUrl)) dataPhase = 'environments';
  if (project.environments?.some(e => !!e.referenceImageUrl)) dataPhase = lastPhase;

  // If the workflow doesn't navigate to a given phase (e.g. Audio is
  // coming-soon for v1 anime), clamp to the last navigable phase.
  const clamp = (p: Phase): Phase => (navigable.includes(p) ? p : lastPhase);
  statusPhase = clamp(statusPhase);
  dataPhase = clamp(dataPhase);

  return phaseIndex(project, dataPhase) > phaseIndex(project, statusPhase) ? dataPhase : statusPhase;
};

export const getStatusLockedPhase = (project: { workflowKey?: ApiProject['workflowKey'] }, status: string): Phase => {
  const navigable = getNavigablePhaseKeys(project);
  const lastPhase = navigable[navigable.length - 1] || 'concept';
  switch (status) {
    case 'uploaded': case 'analyzing': case 'analyzed': case 'error': return 'concept';
    case 'concept_locked': return 'script';
    case 'scripted': return 'style';
    case 'style_locked': return 'characters';
    default: return lastPhase;
  }
};

export const isLockedPhase = (project: { workflowKey?: ApiProject['workflowKey'] }, phase: Phase, status: string): boolean => {
  if (isPhaseComingSoon(project, phase)) return false;
  const statusLocked = getStatusLockedPhase(project, status);
  const navigable = getNavigablePhaseKeys(project);
  const lastPhase = navigable[navigable.length - 1] || 'concept';
  if (phase !== lastPhase) return phaseIndex(project, phase) < phaseIndex(project, statusLocked);
  return ['environments_locked', 'in_production', 'rendered', 'completed'].includes(status);
};

export type ActionErrorState = {
  message: string;
  action?: { label: string; href: string };
};

interface Props {
  project: ApiProject;
  isLoading: boolean;
  viewPhase: Phase;
  activePhase: Phase;
  showLaunch: boolean;
  actionError: ActionErrorState | null;
  onSetViewPhase: (phase: Phase) => void;
  onUpdateProject: (updates: Record<string, any>) => void;
  onLaunchStudio: () => void;
  onSetProject?: (project: ApiProject) => void;
  onClearActionError: () => void;
  showActionError: (input: string | unknown) => void;
}

export const BlueprintContextBar: React.FC<Props> = ({
  project, isLoading, viewPhase, activePhase, showLaunch, actionError,
  onSetViewPhase, onUpdateProject, onLaunchStudio, onSetProject, onClearActionError, showActionError,
}) => {
  const [contextPopover, setContextPopover] = useState<'analysis' | null>(null);
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
      // Pass the raw error so missing_key (Gemini audio analysis) surfaces
      // a setup link to /account/keys instead of just a flat string.
      showActionError(err);
    } finally {
      setIsAnalyzingAudio(false);
    }
  };

  const canAccess = (phase: Phase) =>
    !isPhaseComingSoon(project, phase) && phaseIndex(project, phase) <= phaseIndex(project, activePhase);
  const visiblePhases = getBlueprintPhases(project).filter((p) => p.visible);
  const hasGeneratedMedia = !!project.styleAssetUrl
    || project.cast.some(c => c.referenceImageUrl)
    || project.environments.some(e => e.referenceImageUrl);

  const selectedVideoModel = getVideoModel(project.videoModel || VIDEO_MODELS[0].key);
  const effectiveResolution = selectedVideoModel.resolutions.includes(project.videoResolution)
    ? project.videoResolution
    : selectedVideoModel.resolutions[0];
  const resolutionOptions = selectedVideoModel.resolutions.map(res => ({
    value: res,
    label: res === '1080p' ? '1080p (Full HD)' : '720p (HD)',
  }));
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

            {/* Analysis chip */}
            {hasAnalysis && (
              <>
                <div className="w-px h-5 bg-white/[0.06] flex-shrink-0" />
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
              </>
            )}

            <div className="flex-1" />

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
            {visiblePhases.map((phaseDef, idx) => {
              const phase = phaseDef.key;
              const comingSoon = !!phaseDef.comingSoon;
              const locked = isLockedPhase(project, phase, project.status);
              const active = viewPhase === phase;
              const accessible = canAccess(phase);
              return (
                <React.Fragment key={phase}>
                  <button
                    disabled={!accessible}
                    onClick={() => accessible && onSetViewPhase(phase)}
                    title={comingSoon ? 'Coming soon' : undefined}
                    className={`relative px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'text-white'
                        : comingSoon
                          ? 'text-zinc-500 cursor-not-allowed'
                          : locked
                            ? 'text-zinc-300 hover:text-white'
                            : accessible
                              ? 'text-zinc-400 hover:text-zinc-300'
                              : 'text-zinc-400/40 cursor-not-allowed'
                    }`}
                  >
                    {locked && !comingSoon && (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-2.5 h-2.5 mr-1 inline" aria-hidden="true">
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                      </svg>
                    )}
                    {phaseDef.label}
                    {comingSoon && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-wider text-zinc-500/80 bg-white/[0.04] rounded px-1 py-0.5 align-middle">
                        soon
                      </span>
                    )}
                    {active && <span aria-hidden="true" className="absolute left-3 right-3 -bottom-0.5 h-px bg-white/60" />}
                  </button>
                  {idx < visiblePhases.length - 1 && <div className={`w-6 h-px ${locked && !comingSoon ? 'bg-white/20' : 'bg-white/[0.06]'}`} />}
                </React.Fragment>
              );
            })}
          </div>

          {/* Render params — always visible, no popover */}
          <div className="flex items-stretch divide-x divide-white/[0.06] border-t border-white/[0.06]">
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
                value={effectiveResolution}
                onChange={v => onUpdateProject({ videoResolution: v })}
                options={resolutionOptions}
              />
            </div>
            <div className="flex-1 px-5 py-3 space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-zinc-400">Image model</div>
              <Dropdown
                value={project.imageModel || IMAGE_MODELS[0].key}
                onChange={v => onUpdateProject({ imageModel: v })}
                options={IMAGE_MODELS.map(m => ({
                  value: m.key,
                  label: m.label,
                }))}
              />
            </div>
            <div className="flex-1 px-5 py-3 space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-zinc-400">Storyboard image</div>
              <Dropdown
                value={project.storyboardProvider || STORYBOARD_PROVIDERS[0].key}
                onChange={v => onUpdateProject({ storyboardProvider: v })}
                options={STORYBOARD_PROVIDERS.map(p => ({ value: p.key, label: p.label }))}
              />
            </div>
            {/* Text model — controls concept, style, refines (frame, motion,
                chained-shot, char/env look, style refine, concept refine),
                meaning summary, image-style analyzer, and storyboard prompt
                writer. Script writer is intentionally NOT routed here — it
                uses Claude Opus's extended thinking + a validation loop
                that doesn't port cleanly to other vendors yet. The label
                makes that gap explicit so the artist isn't surprised. */}
            <div className="flex-1 px-5 py-3 space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-zinc-400">Text model</div>
              <Dropdown
                value={project.textProvider || TEXT_PROVIDERS[0].key}
                onChange={v => onUpdateProject({ textProvider: v })}
                options={TEXT_PROVIDERS.map(p => ({ value: p.key, label: p.label }))}
              />
              <div className="text-[10px] text-zinc-500 leading-tight">Used for concept, style, refines, storyboard. Script writer: Claude + GPT-5.5 only — picking Gemini falls back to Claude for script.</div>
            </div>
            <div className="flex-[1.4] px-5 py-3 space-y-1">
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
                  if (!newModel.resolutions.includes(project.videoResolution)) updates.videoResolution = newModel.resolutions[0];
                  onUpdateProject(updates);
                }}
                options={VIDEO_MODELS.map(m => ({ value: m.key, label: m.label }))}
              />
            </div>
          </div>

          {/* Popover panels */}
          <AnimatePresence initial={false}>
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
                  {songTypeLabel && (
                    <div>
                      <h4 className="text-[11px] uppercase tracking-wide text-zinc-400 mb-2">Song classification</h4>
                      <span className="text-sm text-white">{songTypeLabel}</span>
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

      {/* Action error banner. Banner has two click targets: the body
          dismisses; the action link routes to setup (e.g. /account/keys for
          missing_key errors). Stopping propagation on the link prevents
          the dismiss handler from swallowing the navigation. */}
      {actionError && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border border-red-500/20 bg-red-500/[0.06] flex items-start gap-2 text-sm text-red-400 cursor-pointer" onClick={onClearActionError}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 mt-0.5 flex-shrink-0">
            <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
          </svg>
          <span className="flex-1">{actionError.message}</span>
          {actionError.action && (
            <a
              href={actionError.action.href}
              onClick={(e) => e.stopPropagation()}
              className="flex-shrink-0 text-xs text-red-200 hover:text-white bg-red-500/[0.15] hover:bg-red-500/[0.25] rounded px-2 py-1 transition-colors"
            >
              {actionError.action.label} →
            </a>
          )}
        </div>
      )}
    </>
  );
};
