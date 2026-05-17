import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';

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

type ProjectSidebarProps = {
  activeProjectId?: string;
  isOpen: boolean;
  projectList: ProjectSummary[];
  projectListLoading: boolean;
  renameDraft: string;
  renamingId: string | null;
  onCancelRename: () => void;
  onClose: () => void;
  onLoadProject: (id: string) => void;
  onRenameDraftChange: (value: string) => void;
  onRequestDelete: (project: ProjectSummary) => void;
  onSaveRename: () => void;
  onStartRename: (id: string, title: string) => void;
  onViewRenders: (projectId: string, title: string) => void;
};

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  activeProjectId,
  isOpen,
  projectList,
  projectListLoading,
  renameDraft,
  renamingId,
  onCancelRename,
  onClose,
  onLoadProject,
  onRenameDraftChange,
  onRequestDelete,
  onSaveRename,
  onStartRename,
  onViewRenders,
}) => (
  <AnimatePresence>
    {isOpen && (
      <>
        <motion.div
          key="sidebar-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 bg-black/60 z-[100]"
          onClick={onClose}
        />
        <motion.aside
          key="sidebar-panel"
          initial={{ x: -320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -320, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          className="fixed top-0 left-0 bottom-0 w-80 bg-obsidian-900 border-r border-white/[0.06] z-[101] flex flex-col"
        >
          <div className="h-14 px-5 flex items-center justify-between border-b border-white/[0.06] flex-shrink-0">
            <span className="text-sm font-medium text-white">Projects</span>
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-white transition-colors outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded-md p-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {projectListLoading ? (
              <div className="space-y-2 p-2">
                {[1, 2, 3].map(i => <div key={i} className="skeleton h-14 rounded-lg" />)}
              </div>
            ) : projectList.length === 0 ? (
              <p className="text-sm text-zinc-400 text-center py-8">No projects yet</p>
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
        </motion.aside>
      </>
    )}
  </AnimatePresence>
);

const ProjectTree: React.FC<Omit<ProjectSidebarProps, 'isOpen' | 'projectListLoading' | 'onClose'>> = ({
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
            className="flex-1 bg-white/[0.04] text-sm text-white border border-white/[0.12] rounded px-2 py-1 outline-none focus-visible:ring-1 focus-visible:ring-white/30"
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
