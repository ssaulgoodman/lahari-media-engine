/**
 * ShotVersionHistory — extracted from Storyboard.tsx.
 * Tabbed version history panel (First frame / Last frame / Storyboard / Clip)
 * with revert buttons.
 */
import React, { useState, useEffect } from 'react';
import { ApiProject } from '../types';
import {
  getShotHistory,
  revertShotFrame,
  revertShotEndFrame,
  getProject,
  getStoryboardHistory,
  lockStoryboard,
} from '../services/api';
import type { VersionEntry, StoryboardVersionEntry } from '../services/api';

type HistoryTab = 'firstFrame' | 'lastFrame' | 'storyboard' | 'video';
type HistoryData = {
  firstFrame: VersionEntry[];
  lastFrame: VersionEntry[];
  video: VersionEntry[];
  storyboard: StoryboardVersionEntry[];
};

interface ShotVersionHistoryProps {
  projectId: string;
  shotId: string;
  storyboardSupported?: boolean;
  activeStoryboardVersionId?: string;
  onRevertVideo?: (shotId: string, assetId: string) => void | Promise<void>;
  onSetProject?: (project: ApiProject) => void;
  onClose: () => void;
}

export const ShotVersionHistory: React.FC<ShotVersionHistoryProps> = ({
  projectId, shotId, storyboardSupported, activeStoryboardVersionId, onRevertVideo, onSetProject, onClose,
}) => {
  const [tab, setTab] = useState<HistoryTab>('firstFrame');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<HistoryData>({ firstFrame: [], lastFrame: [], storyboard: [], video: [] });

  // Load history on mount — fetch frame/video and storyboard in parallel.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setTab('firstFrame');
    const frames = getShotHistory(projectId, shotId).catch(() => ({ firstFrame: [], lastFrame: [], video: [] }));
    const story = storyboardSupported
      ? getStoryboardHistory(projectId, shotId).catch(() => ({ versions: [] }))
      : Promise.resolve({ versions: [] as StoryboardVersionEntry[] });
    Promise.all([frames, story])
      .then(([f, s]) => {
        if (cancelled) return;
        setData({ ...f, storyboard: s.versions });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, shotId, storyboardSupported]);

  const refreshHistory = async () => {
    const [f, s] = await Promise.all([
      getShotHistory(projectId, shotId).catch(() => ({ firstFrame: [], lastFrame: [], video: [] })),
      storyboardSupported
        ? getStoryboardHistory(projectId, shotId).catch(() => ({ versions: [] }))
        : Promise.resolve({ versions: [] as StoryboardVersionEntry[] }),
    ]);
    setData({ ...f, storyboard: s.versions });
  };

  const handleRevertFrame = async (v: VersionEntry) => {
    if (tab === 'firstFrame') {
      await revertShotFrame(projectId, shotId, v.assetId);
    } else if (tab === 'lastFrame') {
      await revertShotEndFrame(projectId, shotId, v.assetId);
    } else if (tab === 'video') {
      await onRevertVideo?.(shotId, v.assetId);
    }
    await refreshHistory();
    try {
      const p = await getProject(projectId);
      onSetProject?.(p);
    } catch {}
  };

  const handleRevertStoryboard = async (v: StoryboardVersionEntry) => {
    // Locking a specific version makes it the active version too.
    await lockStoryboard(projectId, shotId, v.id);
    await refreshHistory();
    try {
      const p = await getProject(projectId);
      onSetProject?.(p);
    } catch {}
  };

  const tabBtn = (key: HistoryTab, label: string) => (
    <button
      onClick={() => setTab(key)}
      className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${tab === key ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
    >{label}</button>
  );

  return (
    <div className="px-5 py-3 border-t border-white/[0.06] bg-white/[0.02]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-[11px] uppercase tracking-wider text-zinc-400">Version history</span>
          <div className="flex items-center bg-white/[0.04] rounded-md overflow-hidden border border-white/[0.06]">
            {tabBtn('firstFrame', 'First frame')}
            {tabBtn('lastFrame', 'Last frame')}
            {storyboardSupported && tabBtn('storyboard', 'Storyboard')}
            {tabBtn('video', 'Clip')}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-[11px] text-zinc-400 hover:text-white"
        >Close</button>
      </div>

      {loading ? (
        <div className="text-xs text-zinc-400 py-3">Loading…</div>
      ) : tab === 'storyboard' ? (
        data.storyboard.length === 0 ? (
          <div className="text-xs text-zinc-400 py-3">No storyboards yet — generate to build history.</div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {data.storyboard.map((v, idx) => {
              const isCurrent = !!activeStoryboardVersionId && v.id === activeStoryboardVersionId;
              return (
                <button
                  key={v.id}
                  disabled={isCurrent}
                  onClick={() => handleRevertStoryboard(v)}
                  className={`flex-shrink-0 w-32 rounded-md overflow-hidden border transition-all text-left ${
                    isCurrent
                      ? 'border-white/40 ring-1 ring-white/30'
                      : 'border-white/[0.08] hover:border-white/30 cursor-pointer'
                  }`}
                  title={isCurrent ? 'Current version' : v.locked ? 'Switch to this locked version' : 'Make this the active storyboard'}
                >
                  <div className="aspect-[4/3] bg-black flex items-center justify-center">
                    {v.imageUrl ? (
                      <img src={v.imageUrl} alt={`v${data.storyboard.length - idx}`} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[10px] text-zinc-500">no preview</span>
                    )}
                  </div>
                  <div className="px-2 py-1.5 space-y-0.5">
                    <div className="text-[11px] text-zinc-300 font-medium flex items-center gap-1.5">
                      {isCurrent ? 'Current' : 'Switch'}
                      {v.locked && !isCurrent && (
                        <span className="text-[9px] uppercase tracking-wider text-emerald-400/70">locked</span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono">
                      {new Date(v.createdAt + 'Z').toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : (() => {
        const versions = data[tab as 'firstFrame' | 'lastFrame' | 'video'];
        if (versions.length === 0) {
          return <div className="text-xs text-zinc-400 py-3">No versions yet — generate to build history.</div>;
        }
        return (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {versions.map((v, idx) => (
              <button
                key={v.assetId}
                disabled={v.isCurrent}
                onClick={() => handleRevertFrame(v)}
                className={`flex-shrink-0 w-28 rounded-md overflow-hidden border transition-all text-left ${
                  v.isCurrent
                    ? 'border-white/40 ring-1 ring-white/30'
                    : 'border-white/[0.08] hover:border-white/30 cursor-pointer'
                }`}
                title={v.isCurrent ? 'Current version' : 'Revert to this version'}
              >
                <div className={`${tab === 'video' ? 'aspect-video' : 'aspect-square'} bg-black flex items-center justify-center`}>
                  {(tab === 'video' ? v.thumbnailUrl : v.url) ? (
                    <img src={(tab === 'video' ? v.thumbnailUrl : v.url)!} alt={`v${versions.length - idx}`} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-zinc-500">no preview</span>
                  )}
                </div>
                <div className="px-2 py-1.5">
                  <div className="text-[11px] text-zinc-300 font-medium">
                    {v.isCurrent ? 'Current' : 'Revert'}
                  </div>
                  <div className="text-[10px] text-zinc-500 font-mono">
                    {new Date(v.createdAt + 'Z').toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </button>
            ))}
          </div>
        );
      })()}
    </div>
  );
};
