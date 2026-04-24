import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiProject } from '../types';
import TimelineEditor, { InitialClip } from './timeline-editor/TimelineEditor';
import useStore from './timeline-editor/store';
import { loadSnapshot } from './timeline-editor/persistence';
import {
  startRender,
  getRenderStatus,
  listRenders,
  deleteRender,
  type RenderHistoryItem,
} from '../services/api';

interface Props {
  project: ApiProject;
  onBack: () => void;
}

// Backend is authoritative for render state — the frontend just reflects what
// /render-status reports. Polling while the job is 'rendering' lets the user
// navigate away, come back, and still see progress/result.
type RenderPhase =
  | { kind: 'idle' }
  | { kind: 'rendering' }
  | { kind: 'done'; videoUrl: string }
  | { kind: 'error'; message: string };

const POLL_MS = 4000;

export const StepRender: React.FC<Props> = ({ project, onBack }) => {
  const [phase, setPhase] = useState<RenderPhase>({ kind: 'idle' });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<RenderHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Seed lastSavedAt from disk on mount so the Header's "Saved" pill appears
  // immediately after page reload (TimelineEditor's seed effect sets it too
  // a moment later, but this avoids a flash of empty state).
  useEffect(() => {
    const snap = loadSnapshot(project.id);
    if (snap) useStore.getState().setLastSavedAt(snap.savedAt);
  }, [project.id]);

  // Load render history lazily when the panel opens, and again after a render
  // completes so the newest entry appears without a manual refresh.
  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { renders } = await listRenders(project.id);
      setHistory(renders);
    } catch (err) {
      console.error('[renders]', err);
    } finally {
      setHistoryLoading(false);
    }
  }, [project.id]);

  // Preload count once on mount so the header button shows "History (N)"
  // before the panel is ever opened.
  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (historyOpen) refreshHistory();
  }, [historyOpen, refreshHistory]);

  const handleDeleteRender = async (item: RenderHistoryItem) => {
    if (!confirm(item.isCurrent
      ? 'Delete the CURRENT render? The queue row will lose its video link.'
      : 'Delete this render permanently?')) return;
    try {
      await deleteRender(project.id, item.assetId);
      setHistory((cur) => cur.filter((r) => r.assetId !== item.assetId));
    } catch (err: any) {
      alert(err?.message || 'Delete failed');
    }
  };

  // Shot videos that the timeline preview should seed with. Derived once from
  // the project; kept stable so the editor only auto-populates on mount.
  const previewClips = useMemo<InitialClip[]>(
    () =>
      project.scenes
        .flatMap((s) => s.shots)
        .filter((s) => !!s.videoUrl)
        .map((s, i) => ({ src: s.videoUrl!, name: `v_${i + 1}` })),
    // Only re-seed if the set of video URLs actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.scenes.flatMap((s) => s.shots).map((s) => s.videoUrl).join('|')],
  );

  // Song audio lives on the editor's audio track. The renderer used to inject
  // this server-side; now it travels through trackItemsMap like any other clip
  // so the artist can trim, fade, or mute it in the preview.
  const previewAudioClips = useMemo<InitialClip[]>(
    () => (project.audioPath ? [{ src: project.audioPath, name: 'song' }] : []),
    [project.audioPath],
  );

  // Poll render-status while a job is running. Cleared on unmount or when the
  // job finishes. Declared at the component scope so both the initial
  // status-check effect and handleRender can share one pollRef.
  const pollRef = useRef<number | null>(null);
  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Force-download a cross-origin video: fetch the bytes, wrap in an object
  // URL, and synthesize an <a download>. Using the raw Supabase URL with
  // `download` attribute doesn't trigger a save because the response isn't
  // same-origin and lacks `Content-Disposition: attachment`.
  const triggerDownload = useCallback(async (videoUrl: string) => {
    try {
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      const safeTitle = (project.title || 'render').replace(/[^a-z0-9-_]+/gi, '_');
      a.download = `${safeTitle}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (err) {
      console.error('[auto-download]', err);
    }
  }, [project.title]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const s = await getRenderStatus(project.id);
        if (s.status === 'completed' && s.videoUrl) {
          stopPolling();
          setPhase({ kind: 'done', videoUrl: s.videoUrl });
          refreshHistory();
          triggerDownload(s.videoUrl);
        } else if (s.status === 'failed') {
          stopPolling();
          setPhase({ kind: 'error', message: s.error || 'Render failed' });
        }
        // 'rendering' / 'idle' → keep waiting
      } catch (err: any) {
        console.error('[render-status]', err);
      }
    }, POLL_MS);
  }, [project.id, refreshHistory, stopPolling, triggerDownload]);

  // On mount, check whether a render is already in-flight (user might have
  // navigated away and come back) or recently completed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getRenderStatus(project.id);
        if (cancelled) return;
        if (s.status === 'rendering') {
          setPhase({ kind: 'rendering' });
          startPolling();
        }
        // Skip 'completed' / 'failed' on mount — those are terminal states
        // from a past session. The done/error banner should only surface for
        // renders the user kicked off (or was polling through) in the current
        // session. Past renders still show up in the History panel.
      } catch {
        // Silent — if the status probe fails we just stay in idle and let
        // the user kick off a render normally.
      }
    })();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [project.id, startPolling, stopPolling]);

  const handleRender = async () => {
    // Snapshot the render-authoritative subset of the timeline store. Anything
    // not in this object (scale, scroll, activeIds, stateManager, playerRef,
    // timeline, tracks, transitionIds) is UI-only and the renderer ignores it.
    const s = useStore.getState();
    if (s.trackItemIds.length === 0) {
      setPhase({ kind: 'error', message: 'Timeline is empty — add clips first.' });
      return;
    }

    setPhase({ kind: 'rendering' });
    try {
      await startRender(project.id, {
        trackItemIds: s.trackItemIds,
        trackItemsMap: s.trackItemsMap,
        transitionsMap: s.transitionsMap,
        fps: s.fps,
        size: s.size,
        durationMs: s.duration,
      });
      startPolling();
    } catch (e: any) {
      console.error('[render]', e);
      setPhase({ kind: 'error', message: e?.message || 'Render failed' });
    }
  };

  const isBusy = phase.kind === 'rendering';

  // Neutralize the App-level <main>'s p-8 with -m-8 so this view can claim the
  // full viewport below the header. h-[calc(100vh-3.5rem)] = 100vh minus the
  // 56px global header so nothing else scrolls. The layout inside is a fixed
  // compact top bar, a flex-1 editor body, and the timeline already nested
  // inside TimelineEditor.
  return (
    <div className="-m-8 h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden bg-[#141418]">
      {/* Compact top bar: Back + title on left, render button + status on right */}
      <div className="flex items-center justify-between px-4 h-10 border-b border-white/[0.06] flex-none">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            disabled={isBusy}
            className="text-xs text-zinc-400 hover:text-white disabled:opacity-40 transition-colors"
          >
            ← Back
          </button>
          <div className="w-px h-4 bg-white/[0.06]" />
          <span className="text-sm font-medium text-white whitespace-nowrap">Final Render</span>
          <span className="text-[11px] text-zinc-500 truncate hidden md:inline">
            Arrange, trim, preview. Hit Render to stitch to mp4.
          </span>
        </div>
        <div className="flex items-center gap-3 flex-none">
          {phase.kind === 'rendering' && (
            <span className="text-[11px] text-zinc-400 font-mono">rendering…</span>
          )}
          <button
            onClick={() => setHistoryOpen((o) => !o)}
            className={`text-[11px] px-2 py-1 rounded-md transition-colors ${
              historyOpen
                ? 'bg-white/[0.1] text-white'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
            }`}
            title="Past renders"
          >
            History{history.length > 0 ? ` (${history.length})` : ''}
          </button>
          <button
            onClick={handleRender}
            disabled={isBusy || previewClips.length === 0}
            className="px-3 py-1 rounded-md bg-white text-black text-xs font-medium hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {phase.kind === 'done' ? 'Render again' : 'Render'}
          </button>
        </div>
      </div>

      {/* Editor body: takes the rest of the viewport. Done/error banners
          overlay at the bottom-right so they never push layout. */}
      <div className="flex-1 min-h-0 relative">
        {previewClips.length > 0 ? (
          <TimelineEditor
            embedded
            initialClips={previewClips}
            initialAudioClips={previewAudioClips}
            projectId={project.id}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-zinc-400 text-sm">
              No shot videos available yet. Generate videos in the Studio first.
            </p>
          </div>
        )}

        {historyOpen && (
          <div className="absolute top-3 right-3 w-80 max-h-[calc(100%-1.5rem)] bg-[#1a1a1e]/95 border border-white/[0.08] rounded-lg shadow-xl backdrop-blur-sm flex flex-col overflow-hidden z-10">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] flex-none">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white">Past renders</span>
                {historyLoading && (
                  <span className="text-[10px] text-zinc-500 font-mono">loading…</span>
                )}
              </div>
              <button
                onClick={() => setHistoryOpen(false)}
                className="text-zinc-500 hover:text-white text-xs leading-none"
                title="Close"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {history.length === 0 && !historyLoading && (
                <div className="text-[11px] text-zinc-500 px-2 py-4 text-center">
                  No renders yet. Hit Render to make one.
                </div>
              )}
              {history.map((item) => (
                <div
                  key={item.assetId}
                  className={`rounded-md border p-2 space-y-1.5 ${
                    item.isCurrent
                      ? 'border-white/[0.18] bg-white/[0.04]'
                      : 'border-white/[0.06] bg-black/20'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-zinc-400 font-mono">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                    {item.isCurrent && (
                      <span className="text-[9px] text-emerald-400 font-mono uppercase tracking-wide">
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
                      className="text-[10px] text-zinc-400 hover:text-white underline truncate flex-1"
                    >
                      open ↗
                    </a>
                    <button
                      onClick={() => handleDeleteRender(item)}
                      className="text-[10px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {phase.kind === 'done' && (
          <div className="absolute bottom-4 right-4 max-w-sm bg-[#1a1a1e]/95 border border-white/[0.08] rounded-lg shadow-xl p-3 space-y-2 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="text-xs text-white">
                Render complete.
              </div>
              <button
                onClick={() => setPhase({ kind: 'idle' })}
                className="text-zinc-500 hover:text-white text-xs leading-none"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
            <video src={phase.videoUrl} controls className="w-full rounded" />
            <a
              href={phase.videoUrl}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-zinc-300 hover:text-white text-[10px] font-mono underline"
            >
              {phase.videoUrl}
            </a>
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="absolute bottom-4 right-4 max-w-sm bg-red-900/40 border border-red-500/40 rounded-lg shadow-xl px-3 py-2 text-xs text-red-200 flex items-start justify-between gap-3">
            <span>{phase.message}</span>
            <button
              onClick={() => setPhase({ kind: 'idle' })}
              className="text-red-300 hover:text-white leading-none"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
