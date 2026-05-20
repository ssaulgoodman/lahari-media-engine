import React from 'react';
import { AppStep, ApiProject } from '../types';
import { getVideoModel } from '../constants/videoModels';
import type { AgentOperationRow, RealtimeNotice } from '../hooks/useRealtimePresence';

const PIPELINE_STEPS = [
  { id: AppStep.UPLOAD, label: 'Start' },
  { id: AppStep.BLUEPRINT, label: 'Blueprint' },
  { id: AppStep.STUDIO, label: 'Studio' },
  { id: AppStep.RENDER, label: 'Render' },
];

const WORKFLOW_LABEL: Record<string, string> = {
  music_video: 'Music Video',
  anime_scripted: 'Anime',
};

const SEED_LABEL: Record<string, string> = {
  audio: 'Audio',
  script: 'Script',
  brief: 'Brief',
  document: 'Document',
  idea: 'Idea',
};

const PRESET_LABEL: Record<string, string> = {
  music_video_default: 'Music Video Default',
  anime_default: 'Anime Default',
};

type AppHeaderProps = {
  activeAgentOperationList: AgentOperationRow[];
  currentStep: AppStep;
  project: ApiProject | null;
  realtimeBadge: RealtimeNotice | null;
  signOut: () => Promise<void>;
  user: { id: string; email?: string; user_metadata?: any };
  onOpenPrompts: () => void;
  onOpenSidebar: () => void;
  onOpenXray: () => void;
  onStepChange: (step: AppStep) => void;
};

export const AppHeader: React.FC<AppHeaderProps> = ({
  activeAgentOperationList,
  currentStep,
  project,
  realtimeBadge,
  signOut,
  user,
  onOpenPrompts,
  onOpenSidebar,
  onOpenXray,
  onStepChange,
}) => (
  <header className="h-14 bg-[#141418]/90 backdrop-blur-xl border-b border-white/[0.06] flex-shrink-0 z-50">
    <div className="h-full px-6 flex items-center gap-8">
      <button
        onClick={onOpenSidebar}
        className="flex items-center gap-2.5 group outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md flex-shrink-0"
      >
        <span className="text-sm font-display font-semibold text-white tracking-tight">Mirage</span>
        {project && (
          <>
            <span className="text-zinc-400/60 text-sm">/</span>
            <span className="text-sm text-zinc-300 group-hover:text-white transition-colors truncate max-w-[200px]">{project.title}</span>
            {WORKFLOW_LABEL[project.workflowKey] && (
              <span
                className="text-[10px] uppercase tracking-wider font-mono text-zinc-400 px-1.5 py-0.5 rounded surface-inset"
                title={`${WORKFLOW_LABEL[project.workflowKey]} · ${SEED_LABEL[project.seedKind] || project.seedKind} seed · ${PRESET_LABEL[project.presetKey] || project.presetKey}`}
              >
                {WORKFLOW_LABEL[project.workflowKey]}
              </span>
            )}
          </>
        )}
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400/60 group-hover:text-zinc-300 transition-colors flex-shrink-0"><path d="M6 9l6 6 6-6"/></svg>
      </button>

      <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
        {PIPELINE_STEPS.map((step) => {
          const isActive = currentStep === step.id;
          const hasRenderableContent = !!project && project.scenes.some(s => s.shots.some(sh => !!sh.videoUrl));
          const isAccessible =
            step.id === AppStep.UPLOAD ||
            (project && step.id === AppStep.BLUEPRINT) ||
            (project && step.id === AppStep.STUDIO && project.scenes.length > 0 && ['characters_locked', 'environments_locked', 'in_production', 'completed'].includes(project.status)) ||
            (project && step.id === AppStep.RENDER && hasRenderableContent);

          return (
            <button
              key={step.id}
              disabled={!isAccessible}
              onClick={() => onStepChange(step.id)}
              className={`relative px-3.5 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md ${
                isActive
                  ? 'text-white'
                  : isAccessible
                    ? 'text-zinc-400 hover:text-white'
                    : 'text-zinc-400/40 cursor-not-allowed'
              }`}
            >
              {step.label}
              {isActive && <span aria-hidden="true" className="absolute left-3.5 right-3.5 -bottom-[12px] h-px bg-white/70" />}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-1 flex-shrink-0">
        {project && realtimeBadge && (
          <div
            className="hidden lg:flex items-center gap-2 max-w-[260px] px-2.5 py-1 rounded-md surface-inset text-[11px] text-zinc-300"
            title={activeAgentOperationList.length > 1
              ? activeAgentOperationList.map(op => op.label).join(' · ')
              : realtimeBadge.message}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                realtimeBadge.tone === 'working' ? 'bg-amber-400 animate-pulse'
                  : realtimeBadge.tone === 'error' ? 'bg-red-400'
                    : 'bg-emerald-400'
              }`}
            />
            <span className="truncate">
              {realtimeBadge.message}
              {activeAgentOperationList.length > 1 ? ` +${activeAgentOperationList.length - 1}` : ''}
            </span>
          </div>
        )}
        <a
          href="/account/keys"
          className="text-[11px] text-zinc-400 hover:text-white px-2.5 py-1 rounded-md hover:bg-white/[0.06] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 font-mono uppercase tracking-wider"
          title="Your API keys for paid providers (BYOK). Required before generation."
        >
          API Keys
        </a>
        <button
          onClick={onOpenPrompts}
          className="text-[11px] text-zinc-400 hover:text-white px-2.5 py-1 rounded-md hover:bg-white/[0.06] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 font-mono uppercase tracking-wider"
          title="Prompts - the templates that drive every AI call"
        >
          Prompts
        </button>
        <div className="w-px h-4 bg-white/[0.06]" />
        <button
          onClick={signOut}
          className="flex items-center gap-2 px-2.5 py-1 rounded-md hover:bg-white/[0.06] transition-colors outline-none group"
          title={`Signed in as ${user.email || 'user'} - click to sign out`}
        >
          {user.user_metadata?.avatar_url ? (
            <img src={user.user_metadata.avatar_url} alt="" className="w-5 h-5 rounded-full" />
          ) : (
            <div className="w-5 h-5 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] text-zinc-300 font-medium">
              {(user.email || '?')[0].toUpperCase()}
            </div>
          )}
          <span className="text-[11px] text-zinc-400 group-hover:text-white transition-colors hidden lg:inline">{user.email?.split('@')[0]}</span>
        </button>
        {project && <div className="w-px h-4 bg-white/[0.06]" />}
        {project && (
          <>
            <span
              className="text-[11px] font-mono text-zinc-400 tabular-nums px-2"
              title="Actual spend so far (logged per AI call)"
            >${project.costEstimate.toFixed(2)}</span>
            <ProjectedCost project={project} />
            <div className="w-px h-4 bg-white/[0.06]" />
            <button
              onClick={onOpenXray}
              className="text-[11px] text-zinc-400 hover:text-white px-2.5 py-1 rounded-md hover:bg-white/[0.06] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 font-mono uppercase tracking-wider"
            >
              X-Ray
            </button>
          </>
        )}
      </div>
    </div>
  </header>
);

const ProjectedCost: React.FC<{ project: ApiProject }> = ({ project }) => {
  const model = getVideoModel(project.videoModel);
  let framesRemaining = 0;
  let videoCostRemaining = 0;
  let chainRefreshesRemaining = 0;

  for (const scene of project.scenes || []) {
    for (const shot of scene.shots) {
      if (!shot.imageUrl) framesRemaining += 1;
      if (!shot.videoUrl) videoCostRemaining += (shot.duration || model.durations[0]) * model.costPerSec;
      if (shot.continuityFrom === 'prev_shot' && !shot.refinedFromPrevFrame) chainRefreshesRemaining += 1;
    }
  }

  const frameCost = framesRemaining * 0.04;
  const chainCost = chainRefreshesRemaining * 0.01;
  const projected = frameCost + videoCostRemaining + chainCost;
  if (projected < 0.01) return null;

  return (
    <span
      className="text-[11px] font-mono text-zinc-400 tabular-nums px-2"
      title={`Projected remaining at current model (${model.label}): ${framesRemaining} frame${framesRemaining === 1 ? '' : 's'} x $0.04 + videos (${videoCostRemaining.toFixed(2)}) + chain refreshes (${chainCost.toFixed(2)}).`}
    >
      + <span className="text-zinc-300">~${projected.toFixed(2)}</span>
    </span>
  );
};
