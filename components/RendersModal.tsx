import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listRenders, deleteRender, type RenderHistoryItem } from '../services/api';

interface Props {
  projectId: string;
  projectTitle?: string;
  onClose: () => void;
}

export const RendersModal: React.FC<Props> = ({ projectId, projectTitle, onClose }) => {
  const [renders, setRenders] = useState<RenderHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { renders } = await listRenders(projectId);
      setRenders(renders);
    } catch (err: any) {
      setError(err?.message || 'Failed to load renders');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleDelete = async (item: RenderHistoryItem) => {
    if (!confirm(item.isCurrent
      ? 'Delete the CURRENT render? The queue row will lose its video link.'
      : 'Delete this render permanently?')) return;
    try {
      await deleteRender(projectId, item.assetId);
      setRenders((cur) => cur.filter((r) => r.assetId !== item.assetId));
    } catch (err: any) {
      alert(err?.message || 'Delete failed');
    }
  };

  const handleDownload = async (videoUrl: string) => {
    try {
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      const safeTitle = (projectTitle || 'render').replace(/[^a-z0-9-_]+/gi, '_');
      a.download = `${safeTitle}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (err) {
      console.error('[download]', err);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="renders-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          key="renders-panel"
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="relative w-full max-w-2xl max-h-[85vh] bg-[#1a1a1e] border border-white/[0.08] rounded-xl shadow-2xl flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] flex-none">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-white truncate">
                Renders{projectTitle ? ` — ${projectTitle}` : ''}
              </h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                {loading ? 'Loading…' : `${renders.length} render${renders.length === 1 ? '' : 's'}`}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-none">
              <button
                onClick={refresh}
                disabled={loading}
                className="text-[11px] text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-white/[0.06] transition-colors"
              >
                Refresh
              </button>
              <button
                onClick={onClose}
                className="text-zinc-500 hover:text-white text-sm leading-none p-1 rounded hover:bg-white/[0.06] transition-colors"
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {error && (
              <div className="text-[11px] text-red-300 bg-red-900/30 border border-red-500/30 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            {!loading && !error && renders.length === 0 && (
              <div className="text-[11px] text-zinc-400 px-2 py-8 text-center">
                No renders yet.
              </div>
            )}

            {renders.map((item) => (
              <div
                key={item.assetId}
                className={`rounded-md border p-3 space-y-2 ${
                  item.isCurrent
                    ? 'border-white/[0.18] bg-white/[0.04]'
                    : 'border-white/[0.06] bg-black/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-zinc-300 font-mono">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                  {item.isCurrent && (
                    <span className="text-[10px] text-emerald-400 font-mono uppercase tracking-wide">
                      current
                    </span>
                  )}
                </div>
                <video src={item.videoUrl} controls preload="none" className="w-full rounded" />
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={item.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-zinc-400 hover:text-white underline truncate"
                  >
                    open ↗
                  </a>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDownload(item.videoUrl)}
                      className="text-[11px] text-zinc-300 hover:text-white px-2 py-1 rounded hover:bg-white/[0.06] transition-colors"
                    >
                      Download
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
                      className="text-[11px] text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
