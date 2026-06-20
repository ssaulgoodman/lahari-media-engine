import React from 'react';
import { ApiProject } from '../types';
import { getVideoModel } from '../constants/videoModels';
import type { AgentOperationRow, RealtimeNotice } from '../hooks/useRealtimePresence';

const WORKFLOW_LABEL: Record<string, string> = {
  music_led: 'Music-led',
  scripted_narrative: 'Scripted',
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
  project: ApiProject | null;
  realtimeBadge: RealtimeNotice | null;
  onOpenMobileSidebar: () => void;
  onOpenXray: () => void;
};

export const AppHeader: React.FC<AppHeaderProps> = ({
  activeAgentOperationList,
  project,
  realtimeBadge,
  onOpenMobileSidebar,
  onOpenXray,
}) => (
  <header className="h-14 bg-[#141418]/90 backdrop-blur-xl border-b border-white/[0.06] flex-shrink-0 z-50">
    <div className="h-full px-6 flex items-center gap-8">
      {/* Narrow viewports: the rail collapses, this reopens it as an overlay */}
      <button
        onClick={onOpenMobileSidebar}
        aria-label="Open navigation"
        className="md:hidden p-1.5 -ml-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 flex-shrink-0"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </button>

      <div className="flex items-center gap-2.5 flex-shrink-0 min-w-0">
        <span className="text-sm font-display font-semibold text-white tracking-tight">Mirage</span>
        {project && (
          <>
            <span className="text-zinc-400/60 text-sm">/</span>
            <span className="text-sm text-zinc-300 truncate max-w-[200px]">{project.title}</span>
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
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1 flex-shrink-0">
        {project && realtimeBadge && (
          <ActivityPill
            activeAgentOperationList={activeAgentOperationList}
            realtimeBadge={realtimeBadge}
          />
        )}
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

const ActivityPill: React.FC<{
  activeAgentOperationList: AgentOperationRow[];
  realtimeBadge: RealtimeNotice;
}> = ({ activeAgentOperationList, realtimeBadge }) => {
  const title = activeAgentOperationList.length > 1
    ? activeAgentOperationList.map(op => op.label).join(' · ')
    : realtimeBadge.message;
  const statusLabel = realtimeBadge.tone === 'working'
    ? activeAgentOperationList.length > 1
      ? `${activeAgentOperationList.length} running`
      : 'Working'
    : realtimeBadge.tone === 'error'
      ? 'Needs attention'
      : 'Updated';
  const toneClass = realtimeBadge.tone === 'error'
    ? 'border-red-300/20 text-red-100/90 bg-red-500/[0.035]'
    : realtimeBadge.tone === 'updated'
      ? 'border-emerald-300/15 text-zinc-300 bg-white/[0.035]'
      : 'border-white/[0.1] text-zinc-200 bg-white/[0.045]';

  return (
    <div
      className={`hidden lg:flex items-center gap-2 max-w-[340px] px-2.5 py-1 rounded-full border shadow-sm shadow-black/10 transition-colors duration-200 ${toneClass}`}
      title={title}
      role="status"
      aria-live="polite"
    >
      <ActivityGlyph tone={realtimeBadge.tone} />
      <span className="text-[10px] uppercase tracking-wide text-zinc-500 flex-shrink-0">{statusLabel}</span>
      <span className="truncate text-[11px] text-zinc-300">
        {realtimeBadge.message}
      </span>
    </div>
  );
};

const ActivityGlyph: React.FC<{ tone: RealtimeNotice['tone'] }> = ({ tone }) => {
  if (tone === 'working') {
    return (
      <span
        className="w-3 h-3 rounded-full border border-zinc-600 border-t-zinc-100 animate-spin flex-shrink-0"
        aria-hidden="true"
      />
    );
  }
  if (tone === 'error') {
    return (
      <span className="w-3 h-3 rounded-full border border-red-300/35 bg-red-400/10 flex items-center justify-center flex-shrink-0" aria-hidden="true">
        <span className="w-1 h-1 rounded-full bg-red-300" />
      </span>
    );
  }
  return (
    <span className="w-3 h-3 rounded-full border border-emerald-300/25 bg-emerald-300/[0.08] flex items-center justify-center flex-shrink-0" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-200/90">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
};

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
