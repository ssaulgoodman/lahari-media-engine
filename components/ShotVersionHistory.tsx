/**
 * ShotVersionHistory — extracted from Storyboard.tsx.
 * Tabbed version history panel (First frame / Last frame / Clip) with revert buttons.
 */
import React, { useState, useEffect } from 'react';
import { ApiProject } from '../types';
import { getShotHistory, revertShotFrame, revertShotEndFrame, getProject } from '../services/api';
import type { VersionEntry } from '../services/api';

type HistoryTab = 'firstFrame' | 'lastFrame' | 'video';
type HistoryData = { firstFrame: VersionEntry[]; lastFrame: VersionEntry[]; video: VersionEntry[] };

interface ShotVersionHistoryProps {
  projectId: string;
  shotId: string;
  onRevertVideo?: (shotId: string, assetId: string) => void | Promise<void>;
  onSetProject?: (project: ApiProject) => void;
  onClose: () => void;
}

export const ShotVersionHistory: React.FC<ShotVersionHistoryProps> = ({
  projectId, shotId, onRevertVideo, onSetProject, onClose,
}) => {
  const [tab, setTab] = useState<HistoryTab>('firstFrame');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<HistoryData>({ firstFrame: [], lastFrame: [], video: [] });

  // Load history on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setTab('firstFrame');
    getShotHistory(projectId, shotId)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData({ firstFrame: [], lastFrame: [], video: [] }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, shotId]);

  const handleRevert = async (v: VersionEntry) => {
    if (tab === 'firstFrame') {
      await revertShotFrame(projectId, shotId, v.assetId);
    } else if (tab === 'lastFrame') {
      await revertShotEndFrame(projectId, shotId, v.assetId);
    } else {
      await onRevertVideo?.(shotId, v.assetId);
    }
    // Refresh history + project
    const freshData = await getShotHistory(projectId, shotId);
    setData(freshData);
    try {
      const p = await getProject(projectId);
      onSetProject?.(p);
    } catch {}
  };

  const versions = data[tab];

  return (
    <div className="px-5 py-3 border-t border-white/[0.06] bg-white/[0.02]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-[11px] uppercase tracking-wider text-zinc-400">Version history</span>
          <div className="flex items-center bg-white/[0.04] rounded-md overflow-hidden border border-white/[0.06]">
            <button
              onClick={() => setTab('firstFrame')}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${tab === 'firstFrame' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
            >First frame</button>
            <button
              onClick={() => setTab('lastFrame')}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${tab === 'lastFrame' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
            >Last frame</button>
            <button
              onClick={() => setTab('video')}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${tab === 'video' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
            >Clip</button>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-[11px] text-zinc-400 hover:text-white"
        >Close</button>
      </div>
      {loading ? (
        <div className="text-xs text-zinc-400 py-3">Loading…</div>
      ) : versions.length === 0 ? (
        <div className="text-xs text-zinc-400 py-3">No versions yet — generate to build history.</div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {versions.map((v, idx) => (
            <button
              key={v.assetId}
              disabled={v.isCurrent}
              onClick={() => handleRevert(v)}
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
      )}
    </div>
  );
};
