/**
 * MediaLibraryDrawer — bottom drawer in the render step that lets the artist
 * pull existing shot video versions onto the timeline. Critical for the
 * "I trimmed and now I'm short" case: instead of regenerating a whole shot,
 * the artist drops an older version or alternate take into the gap.
 *
 * v1 scope: SHOT VIDEO VERSIONS ONLY. No pickups, no stills, no style refs.
 * The Pickups tab is intentionally deferred to when we build the pickup
 * generator — the upload affordance without a generator is half a feature.
 *
 * Layout:
 *   Top bar          : closed-state handle + open-state header (Scenes + ×)
 *   Scene picker     : horizontal row of S1 S2 S3 ... chips
 *   Shot grid        : horizontal row of shots in the active scene; each
 *                      shot shows its active video version (ring) + older
 *                      versions as small chips beneath.
 *
 * Adding to timeline: click any version card → appends to the end of the
 * existing video track. No drag/drop in v1; click is good enough for the
 * dominant workflow ("place playhead, pick clip, click").
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ApiProject, VideoScene, VideoShot } from '../types';
import { getShotHistory, VersionEntry } from '../services/api';
import { addVideoClip } from './timeline-editor/TimelineEditor';

interface Props {
  project: ApiProject;
}

// Cache history per shot in component state so switching scenes doesn't
// re-fetch the same data on every tab change. Keyed by shotId; entry is
// the version[] array from getShotHistory.
type HistoryCache = Record<string, VersionEntry[]>;

export const MediaLibraryDrawer: React.FC<Props> = ({ project }) => {
  // Closed by default — the drawer is a deliberate-reach tool, not a panel
  // that's always present. The handle at the bottom is what's persistent.
  const [open, setOpen] = useState(false);
  const [activeSceneIdx, setActiveSceneIdx] = useState(0);
  const [historyByShot, setHistoryByShot] = useState<HistoryCache>({});
  const [loadingShots, setLoadingShots] = useState<Set<string>>(new Set());

  // Hide entirely when the project has no rendered material. Removes a dead
  // affordance from the artist's view during early render-phase entry.
  const hasAnyRendered = useMemo(
    () => project.scenes.some((s) => s.shots.some((sh) => !!sh.videoUrl)),
    [project.scenes],
  );

  const activeScene: VideoScene | undefined = project.scenes[activeSceneIdx];

  // Lazy-load history for every shot in the active scene when the drawer
  // opens or the scene changes. Concurrent fetches per shot — small N
  // (typically 2-3 shots per scene) and a single shared cache.
  useEffect(() => {
    if (!open || !activeScene) return;
    const toFetch = activeScene.shots.filter((sh) => !historyByShot[sh.id] && !loadingShots.has(sh.id));
    if (toFetch.length === 0) return;
    setLoadingShots((prev) => {
      const next = new Set(prev);
      toFetch.forEach((sh) => next.add(sh.id));
      return next;
    });
    let cancelled = false;
    Promise.all(
      toFetch.map(async (sh) => {
        try {
          const h = await getShotHistory(project.id, sh.id);
          return { shotId: sh.id, versions: h.video };
        } catch {
          return { shotId: sh.id, versions: [] };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setHistoryByShot((prev) => {
        const next = { ...prev };
        results.forEach((r) => { next[r.shotId] = r.versions; });
        return next;
      });
      setLoadingShots((prev) => {
        const next = new Set(prev);
        results.forEach((r) => next.delete(r.shotId));
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [open, activeScene?.id, project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasAnyRendered) return null;

  // ─── Closed state: just the handle ──────────────────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-t-md bg-[#1a1a1e] border border-white/[0.08] border-b-0 text-[11px] text-zinc-400 hover:text-white transition-colors flex items-center gap-1.5"
        title="Open media library"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <polyline points="3 8 21 8"/>
        </svg>
        Media Library
      </button>
    );
  }

  // ─── Open state: full drawer ────────────────────────────────────────────
  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 bg-[#1a1a1e]/95 border-t border-white/[0.08] backdrop-blur-sm flex flex-col" style={{ height: 280 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06] flex-none">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-white">Media Library</span>
          <span className="text-[10px] text-zinc-500">
            Versions of every rendered shot — click to append to the timeline.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-zinc-500 hover:text-white text-xs leading-none"
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Scene picker — horizontal chip row. Click a chip → only that scene's
          shots show below. Cuts vertical clutter for projects with many
          scenes (the whole point of the per-scene tab pattern). */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-white/[0.04] flex-none overflow-x-auto">
        {project.scenes.map((scene, idx) => {
          const isActive = idx === activeSceneIdx;
          const hasVideos = scene.shots.some((sh) => !!sh.videoUrl);
          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => setActiveSceneIdx(idx)}
              disabled={!hasVideos}
              className={`text-[11px] px-2.5 py-1 rounded transition-colors flex-shrink-0 ${
                isActive
                  ? 'bg-white text-black font-medium'
                  : hasVideos
                  ? 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                  : 'text-zinc-700 cursor-not-allowed'
              }`}
              title={scene.sectionLabel ? `S${idx + 1} · ${scene.sectionLabel}` : `Scene ${idx + 1}`}
            >
              S{idx + 1}
            </button>
          );
        })}
      </div>

      {/* Active scene's shot grid — horizontal row, vertical scroll if needed.
          Each shot column = active version (large) + older versions (small chips). */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {activeScene ? (
          <div className="flex items-start gap-4">
            {activeScene.shots.map((shot, idx) => (
              <ShotColumn
                key={shot.id}
                shot={shot}
                shotNumber={idx + 1}
                versions={historyByShot[shot.id]}
                loading={loadingShots.has(shot.id)}
              />
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-zinc-500 text-center py-8">No scenes.</div>
        )}
      </div>
    </div>
  );
};

// ─── Single shot column ────────────────────────────────────────────────────
//
// Shows the active version as the primary card and older versions as smaller
// chips below. The active version (isCurrent === true) is what's wired into
// the shot today — the drawer marks it with a ring so the artist can see
// which one is currently canonical. Clicking ANY version (active or older)
// appends a copy of that clip to the end of the timeline; the existing
// timeline clip pointing at the canonical asset is not modified.

interface ShotColumnProps {
  shot: VideoShot;
  shotNumber: number;
  versions?: VersionEntry[];
  loading: boolean;
}

const ShotColumn: React.FC<ShotColumnProps> = ({ shot, shotNumber, versions, loading }) => {
  // Loading / no-rendered-video state — explicit empty card so the column
  // layout stays consistent (don't shift other columns left).
  if (loading && !versions) {
    return (
      <div className="flex-shrink-0 w-[120px] space-y-1.5">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Shot {shotNumber}</div>
        <div className="aspect-video bg-white/[0.03] rounded animate-pulse" />
      </div>
    );
  }

  if (!shot.videoUrl) {
    return (
      <div className="flex-shrink-0 w-[120px] space-y-1.5 opacity-50">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Shot {shotNumber}</div>
        <div className="aspect-video bg-white/[0.02] rounded border border-dashed border-white/[0.06] flex items-center justify-center text-[10px] text-zinc-600">
          no video
        </div>
      </div>
    );
  }

  // Use the history list when loaded; fall back to the single live video on
  // the shot so the card paints immediately, before the lazy fetch lands.
  const list: VersionEntry[] = versions ?? [
    { assetId: 'live', url: shot.videoUrl, createdAt: '', isCurrent: true },
  ];
  const active = list.find((v) => v.isCurrent) || list[0];
  const others = list.filter((v) => v !== active);

  return (
    <div className="flex-shrink-0 w-[120px] space-y-1.5">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wide flex items-center justify-between">
        <span>Shot {shotNumber}</span>
        <span className="font-mono text-zinc-600">{list.length}v</span>
      </div>

      {/* Active version — larger card, ring outline. Drag handle = whole card. */}
      <VersionCard
        version={active}
        label={`Shot ${shotNumber}`}
        isActive
      />

      {/* Older versions — compact chips. Skipped entirely if only one version
          exists (the active one), so the column stays tight. */}
      {others.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {others.map((v, i) => (
            <VersionCard
              key={v.assetId}
              version={v}
              label={`Shot ${shotNumber} · v${list.length - 1 - i}`}
              compact
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Version card ──────────────────────────────────────────────────────────

const VersionCard: React.FC<{
  version: VersionEntry;
  label: string;
  isActive?: boolean;
  compact?: boolean;
}> = ({ version, label, isActive, compact }) => {
  const handleAdd = () => {
    // Cloning intent: the canonical shot stays untouched; we just append a
    // copy of this version's video URL to the timeline. The artist can then
    // trim, split, or move it independently.
    addVideoClip(version.url, label);
  };

  // No server-generated thumbnails today, so the <video> element has to paint
  // its own frame. preload="metadata" alone leaves Chrome/Safari blank on a
  // sliced inline player (you see the bg-black not a frame). The #t=0.1
  // media-fragment trick forces a seek-to-0.1s on load and reliably renders
  // the first real frame across browsers. Safari is the strictest about
  // this; Firefox/Chrome are more forgiving. Use this everywhere we want a
  // static thumbnail from a video URL.
  const previewUrl = version.thumbnailUrl ?? `${version.url}#t=0.1`;
  const isImage = !!version.thumbnailUrl;

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleAdd}
        className="relative aspect-video w-12 rounded overflow-hidden bg-black/30 border border-white/[0.06] hover:border-white/[0.2] transition-colors group"
        title={`Append ${label} to timeline`}
      >
        {isImage ? (
          <img src={previewUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <video src={previewUrl} className="w-full h-full object-cover" muted playsInline preload="metadata" />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      className={`relative aspect-video w-full rounded overflow-hidden bg-black/30 border transition-colors group ${
        isActive ? 'border-white/[0.3] ring-1 ring-white/40' : 'border-white/[0.06] hover:border-white/[0.2]'
      }`}
      title={`Append ${label} to timeline`}
    >
      {isImage ? (
        <img src={previewUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <video src={previewUrl} className="w-full h-full object-cover" muted playsInline preload="metadata" />
      )}
      {isActive && (
        <span className="absolute top-1 left-1 text-[9px] uppercase tracking-wider bg-black/60 text-white px-1 py-0.5 rounded font-mono">
          on timeline
        </span>
      )}
      {/* Hover overlay — subtle "+ Add" hint without crowding the resting state. */}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[11px] text-white font-medium">
        + Add
      </div>
    </button>
  );
};
