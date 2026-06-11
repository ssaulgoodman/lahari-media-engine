import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AppStep, ApiProject } from '../types';

export type ProjectSummary = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt?: string;
  parentProjectId?: string;
  renderCount?: number;
};

// Workspace tier — reserved for C2. Only a static identity chip renders today;
// the real switcher replaces WorkspaceSlot in place without reshaping the rail.
export type WorkspaceSummary = {
  id: string;
  name: string;
};

type ProjectSidebarProps = {
  activeProjectId?: string;
  currentStep: AppStep;
  mobileOpen: boolean;
  project: ApiProject | null;
  projectList: ProjectSummary[];
  projectListLoading: boolean;
  renameDraft: string;
  renamingId: string | null;
  user: { email?: string; user_metadata?: any };
  workspace: WorkspaceSummary;
  signOut: () => Promise<void>;
  onCancelRename: () => void;
  onCloseMobile: () => void;
  onLoadProject: (id: string) => void;
  onNewProject: () => void;
  onOpenPrompts: () => void;
  onRenameDraftChange: (value: string) => void;
  onRequestDelete: (project: ProjectSummary) => void;
  onSaveRename: () => void;
  onStartRename: (id: string, title: string) => void;
  onStepChange: (step: AppStep) => void;
  onViewRenders: (projectId: string, title: string) => void;
};

export const ProjectSidebar: React.FC<ProjectSidebarProps> = (props) => (
  <>
    {/* Persistent rail — always visible at desktop widths */}
    <aside className="hidden md:flex w-64 flex-shrink-0 flex-col bg-obsidian-900 border-r border-white/[0.06]">
      <RailContent {...props} />
    </aside>

    {/* Narrow viewports: the same rail as an overlay drawer, opened from the header */}
    <AnimatePresence>
      {props.mobileOpen && (
        <>
          <motion.div
            key="rail-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/60 z-[100] md:hidden"
            onClick={props.onCloseMobile}
          />
          <motion.aside
            key="rail-panel"
            initial={{ x: -280, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -280, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="fixed top-0 left-0 bottom-0 w-64 bg-obsidian-900 border-r border-white/[0.06] z-[101] flex flex-col md:hidden"
          >
            <RailContent {...props} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  </>
);

const PHASES = [
  { id: AppStep.BLUEPRINT, label: 'Blueprint' },
  { id: AppStep.STUDIO, label: 'Studio' },
  { id: AppStep.RENDER, label: 'Render' },
];

const RailContent: React.FC<ProjectSidebarProps> = ({
  activeProjectId,
  currentStep,
  project,
  projectList,
  projectListLoading,
  renameDraft,
  renamingId,
  user,
  workspace,
  signOut,
  onCancelRename,
  onCloseMobile,
  onLoadProject,
  onNewProject,
  onOpenPrompts,
  onRenameDraftChange,
  onRequestDelete,
  onSaveRename,
  onStartRename,
  onStepChange,
  onViewRenders,
}) => {
  // Phases never lock once a project is loaded. Each phase owns its own
  // empty state (Studio shows a "write a script first" notice; Render's
  // button gates on the timeline containing a visual clip), so nav gating
  // would only hide capability — e.g. uploading clips to render before any
  // shot video exists.
  const phaseAccessible = (_step: AppStep) => !!project;

  return (
    <>
      <WorkspaceSlot workspace={workspace} />

      {/* Current project + switcher */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-4 pt-3 pb-1.5 flex items-center justify-between flex-shrink-0">
          <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">Projects</span>
          <button
            onClick={onNewProject}
            title="New project"
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          {projectListLoading && projectList.length === 0 ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3].map(i => <div key={i} className="skeleton h-10 rounded-lg" />)}
            </div>
          ) : projectList.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-6">No projects yet</p>
          ) : (
            <ProjectTree
              activeProjectId={activeProjectId}
              projectList={projectList}
              renameDraft={renameDraft}
              renamingId={renamingId}
              onCancelRename={onCancelRename}
              onLoadProject={onLoadProject}
              onRenameDraftChange={onRenameDraftChange}
              onRequestDelete={onRequestDelete}
              onSaveRename={onSaveRename}
              onStartRename={onStartRename}
              onViewRenders={onViewRenders}
            />
          )}
        </div>
      </div>

      {/* Phase navigation — steps persist to the URL via usePersistedProject */}
      <nav className="px-2 py-2 border-t border-white/[0.06] space-y-px flex-shrink-0">
        {PHASES.map((phase) => {
          const isActive = currentStep === phase.id;
          const isAccessible = phaseAccessible(phase.id);
          return (
            <button
              key={phase.id}
              disabled={!isAccessible}
              onClick={() => { onStepChange(phase.id); onCloseMobile(); }}
              className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 ${
                isActive
                  ? 'bg-white/[0.08] text-white'
                  : isAccessible
                    ? 'text-zinc-300 hover:text-white hover:bg-white/[0.03]'
                    : 'text-zinc-400/40 cursor-not-allowed'
              }`}
            >
              {phase.label}
            </button>
          );
        })}
      </nav>

      {/* Account / settings / BYOK */}
      <div className="px-2 py-2 border-t border-white/[0.06] space-y-px flex-shrink-0">
        <a
          href="/account/keys"
          title="Your API keys for paid providers (BYOK). Required before generation."
          className="flex items-center gap-2.5 px-3 py-2 rounded-md text-xs text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          API Keys
        </a>
        <button
          onClick={() => { onOpenPrompts(); onCloseMobile(); }}
          title="Prompts - the templates that drive every AI call"
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Prompts
        </button>
        <button
          onClick={signOut}
          title={`Signed in as ${user.email || 'user'} - click to sign out`}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-white/[0.06] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 group"
        >
          {user.user_metadata?.avatar_url ? (
            <img src={user.user_metadata.avatar_url} alt="" className="w-5 h-5 rounded-full flex-shrink-0" />
          ) : (
            <div className="w-5 h-5 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] text-zinc-300 font-medium flex-shrink-0">
              {(user.email || '?')[0].toUpperCase()}
            </div>
          )}
          <span className="text-xs text-zinc-400 group-hover:text-white transition-colors truncate">{user.email?.split('@')[0]}</span>
          <span className="ml-auto text-[11px] text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">Sign out</span>
        </button>
      </div>
    </>
  );
};

// C2 slot: render-only workspace identity. Swap this component for the real
// switcher when workspaces exist — the rail layout around it stays put.
const WorkspaceSlot: React.FC<{ workspace: WorkspaceSummary }> = ({ workspace }) => (
  <div className="px-3 pt-3 pb-2.5 border-b border-white/[0.06] flex-shrink-0">
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md surface-inset">
      <div className="w-5 h-5 rounded bg-zinc-700 flex items-center justify-center text-[10px] text-zinc-300 font-medium flex-shrink-0">
        {workspace.name[0]?.toUpperCase() || 'W'}
      </div>
      <span className="text-xs text-zinc-300 truncate">{workspace.name}</span>
    </div>
  </div>
);

type ProjectTreeProps = {
  activeProjectId?: string;
  projectList: ProjectSummary[];
  renameDraft: string;
  renamingId: string | null;
  onCancelRename: () => void;
  onLoadProject: (id: string) => void;
  onRenameDraftChange: (value: string) => void;
  onRequestDelete: (project: ProjectSummary) => void;
  onSaveRename: () => void;
  onStartRename: (id: string, title: string) => void;
  onViewRenders: (projectId: string, title: string) => void;
};

const ProjectTree: React.FC<ProjectTreeProps> = ({
  activeProjectId,
  projectList,
  renameDraft,
  renamingId,
  onCancelRename,
  onLoadProject,
  onRenameDraftChange,
  onRequestDelete,
  onSaveRename,
  onStartRename,
  onViewRenders,
}) => {
  const childrenOf = new Map<string, ProjectSummary[]>();
  projectList.forEach(p => {
    if (p.parentProjectId) {
      const arr = childrenOf.get(p.parentProjectId) || [];
      arr.push(p);
      childrenOf.set(p.parentProjectId, arr);
    }
  });
  const byId = new Map(projectList.map(p => [p.id, p]));
  const roots = projectList.filter(p => !p.parentProjectId || !byId.has(p.parentProjectId));
  const flat: { project: ProjectSummary; depth: number }[] = [];
  const activityMs = (p: ProjectSummary) => new Date(p.lastActivityAt || p.updatedAt || p.createdAt).getTime();
  const subtreeActivityMs = (p: ProjectSummary): number => Math.max(
    activityMs(p),
    ...(childrenOf.get(p.id) || []).map(subtreeActivityMs)
  );
  const sortByActivity = (a: ProjectSummary, b: ProjectSummary) => subtreeActivityMs(b) - subtreeActivityMs(a);
  const walk = (p: ProjectSummary, depth: number) => {
    flat.push({ project: p, depth });
    const kids = (childrenOf.get(p.id) || []).sort(sortByActivity);
    kids.forEach(k => walk(k, depth + 1));
  };
  roots.sort(sortByActivity).forEach(r => walk(r, 0));

  return (
    <div className="space-y-px">
      {flat.map(({ project, depth }) => (
        <ProjectRow
          key={project.id}
          activeProjectId={activeProjectId}
          byId={byId}
          depth={depth}
          project={project}
          renameDraft={renameDraft}
          renamingId={renamingId}
          onCancelRename={onCancelRename}
          onLoadProject={onLoadProject}
          onRenameDraftChange={onRenameDraftChange}
          onRequestDelete={onRequestDelete}
          onSaveRename={onSaveRename}
          onStartRename={onStartRename}
          onViewRenders={onViewRenders}
        />
      ))}
    </div>
  );
};

type ProjectRowProps = {
  activeProjectId?: string;
  byId: Map<string, ProjectSummary>;
  depth: number;
  project: ProjectSummary;
  renameDraft: string;
  renamingId: string | null;
  onCancelRename: () => void;
  onLoadProject: (id: string) => void;
  onRenameDraftChange: (value: string) => void;
  onRequestDelete: (project: ProjectSummary) => void;
  onSaveRename: () => void;
  onStartRename: (id: string, title: string) => void;
  onViewRenders: (projectId: string, title: string) => void;
};

const ProjectRow: React.FC<ProjectRowProps> = ({
  activeProjectId,
  byId,
  depth,
  project,
  renameDraft,
  renamingId,
  onCancelRename,
  onLoadProject,
  onRenameDraftChange,
  onRequestDelete,
  onSaveRename,
  onStartRename,
  onViewRenders,
}) => {
  const isActive = activeProjectId === project.id;
  const isFork = !!project.parentProjectId && byId.has(project.parentProjectId);
  const lastActivityAt = project.lastActivityAt || project.updatedAt || project.createdAt;
  const lastActivityDate = new Date(lastActivityAt.includes('T') || lastActivityAt.includes('Z') ? lastActivityAt : lastActivityAt.replace(' ', 'T') + 'Z');

  return (
    <div
      className={`group relative rounded-md transition-colors ${
        isActive
          ? 'bg-white/[0.08]'
          : 'hover:bg-white/[0.03]'
      }`}
      style={{ paddingLeft: depth * 14 }}
    >
      {depth > 0 && (
        <span
          aria-hidden="true"
          className="absolute left-3 top-0 bottom-0 w-px bg-white/[0.08]"
          style={{ left: (depth - 1) * 14 + 14 }}
        />
      )}
      {renamingId === project.id ? (
        <div className="w-full px-3 py-2 flex items-center gap-2">
          {isFork && <ForkIcon />}
          <input
            autoFocus
            value={renameDraft}
            onChange={e => onRenameDraftChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); onSaveRename(); }
              if (e.key === 'Escape') { e.preventDefault(); onCancelRename(); }
            }}
            onBlur={onSaveRename}
            className="flex-1 min-w-0 bg-white/[0.04] text-sm text-white border border-white/[0.12] rounded px-2 py-1 outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          />
        </div>
      ) : (
        <button
          onClick={() => onLoadProject(project.id)}
          className="w-full text-left px-3 py-2.5 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
        >
          <div className="flex items-center gap-2 min-w-0">
            {isFork && <ForkIcon />}
            <span className={`text-sm truncate ${isActive ? 'text-white font-medium' : 'text-zinc-300 group-hover:text-white'}`}>
              {project.title}
            </span>
            <span className="text-[11px] text-zinc-400 flex-shrink-0 ml-auto group-hover:invisible" title={`Last activity ${lastActivityDate.toLocaleString()}`}>
              {relativeTime(lastActivityAt)}
            </span>
          </div>
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRequestDelete(project);
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-zinc-400 hover:text-red-300 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Delete project"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
      {renamingId !== project.id && (
        <button
          onClick={(e) => { e.stopPropagation(); onStartRename(project.id, project.title); }}
          className="absolute right-9 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] opacity-0 group-hover:opacity-100 transition-opacity"
          title="Rename project"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
          </svg>
        </button>
      )}
      {renamingId !== project.id && (project.renderCount ?? 0) > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onViewRenders(project.id, project.title); }}
          className="absolute right-16 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] opacity-0 group-hover:opacity-100 transition-opacity"
          title="View renders"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>
          </svg>
        </button>
      )}
    </div>
  );
};

const ForkIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 flex-shrink-0" aria-hidden="true">
    <circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9v1a4 4 0 0 1-4 4H8"/><path d="M6 8v7"/>
  </svg>
);

const relativeTime = (iso?: string): string => {
  if (!iso) return '';
  const then = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
