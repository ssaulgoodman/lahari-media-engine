import React, { useState, useEffect, useCallback } from 'react';
import * as api from '../services/api';

interface QueueItem {
  id: string;
  song_id: string;
  priority: number;
  status: string;
  lahari_project_id: string | null;
  song_name: string;
  deity: string;
  original_language: string;
  duration_seconds: number;
  isrc: string;
  album: string;
  audio_uploaded: boolean;
  srts_ready: boolean;
  render_count: number;
  // Per-user fork stats from listQueue() — see server/services/supabase.ts.
  others_done: number;
  others_wip: number;
  has_active_fork: boolean;
  has_done_fork: boolean;
}

interface Props {
  onStartProduction: (queueId: string) => Promise<void> | void;
  onOpenProject: (projectId: string) => void;
  onViewRenders?: (projectId: string, title: string) => void;
}

type ActionKey = 'start' | 'continue' | 'open' | 'needs-audio';

/** Action button vocabulary — one verb per row, derived from per-user fork
 *  state. Filter chips at the top filter by this same vocabulary so what an
 *  artist sees on a row matches what the filter promises.
 *
 *  Priority: active beats done. If the user somehow has both an active fork
 *  AND a completed fork for the same queue row (edge case — e.g. they
 *  published once, then started a new variation), "Continue" wins because
 *  that's the work they care about right now. Past renders are reachable via
 *  the Renders button. */
const getAction = (item: QueueItem): ActionKey => {
  if (item.has_active_fork) return 'continue';
  if (item.has_done_fork) return 'open';
  if (!item.audio_uploaded) return 'needs-audio';
  return 'start';
};

const FILTER_KEY = 'lahari-queue-filters';

const formatDuration = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const Dashboard: React.FC<Props> = ({ onStartProduction, onOpenProject, onViewRenders }) => {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [deities, setDeities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'priority' | 'duration_asc' | 'duration_desc'>('priority');

  // Persisted filters — actionFilter replaces the old statusFilter so the
  // chip vocabulary matches the action button on each row.
  const [actionFilter, setActionFilter] = useState<'all' | ActionKey>(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}').action;
      return v === 'start' || v === 'continue' || v === 'open' || v === 'needs-audio' ? v : 'all';
    } catch { return 'all'; }
  });
  const [deityFilter, setDeityFilter] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}').deity || ''; } catch { return ''; }
  });
  const [search, setSearch] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}').search || ''; } catch { return ''; }
  });

  useEffect(() => {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify({ action: actionFilter, deity: deityFilter, search }));
  }, [actionFilter, deityFilter, search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Action filtering happens client-side — server returns full list so we
      // can compute per-user actions without re-fetching when chips change.
      const [q, d] = await Promise.all([
        api.listQueue({ deity: deityFilter || undefined }),
        api.getQueueDeities(),
      ]);
      setItems(q);
      setDeities(d);
    } catch (err) {
      console.error('Failed to load queue:', err);
    } finally {
      setLoading(false);
    }
  }, [deityFilter]);

  useEffect(() => { load(); }, [load]);

  const handleStart = async (item: QueueItem) => {
    if (!item.audio_uploaded) return;
    setStarting(item.id);
    try {
      await onStartProduction(item.id);
    } finally {
      setStarting(null);
    }
  };

  // Compute action per item once; reuse for filter + render.
  const itemsWithAction = items.map(i => ({ item: i, action: getAction(i) }));

  const counts = {
    all: itemsWithAction.length,
    start: itemsWithAction.filter(x => x.action === 'start').length,
    continue: itemsWithAction.filter(x => x.action === 'continue').length,
    open: itemsWithAction.filter(x => x.action === 'open').length,
  };

  const filtered = (search
    ? itemsWithAction.filter(x =>
        x.item.song_name?.toLowerCase().includes(search.toLowerCase())
        || x.item.isrc?.toLowerCase().includes(search.toLowerCase())
        || x.item.album?.toLowerCase().includes(search.toLowerCase())
      )
    : itemsWithAction
  )
    .filter(x => actionFilter === 'all' || x.action === actionFilter)
    .sort((a, b) => {
      if (sortBy === 'duration_asc') return a.item.duration_seconds - b.item.duration_seconds;
      if (sortBy === 'duration_desc') return b.item.duration_seconds - a.item.duration_seconds;
      return a.item.priority - b.item.priority;
    });

  const hasFilters = actionFilter !== 'all' || deityFilter || search;

  return (
    <div className="max-w-6xl mx-auto pb-32 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-display font-medium text-white">Music Video Queue</h2>
        <p className="text-sm text-zinc-400 mt-0.5">
          {filtered.length === counts.all
            ? `${counts.all} songs`
            : `${filtered.length} of ${counts.all} songs`}
        </p>
      </div>

      {/* Action filter chips — vocabulary matches the action button per row. */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: 'all',      label: 'All',      count: counts.all },
          { key: 'start',    label: 'Start',    count: counts.start },
          { key: 'continue', label: 'Continue', count: counts.continue },
          { key: 'open',     label: 'Open',     count: counts.open },
        ] as const).map(chip => {
          const isActive = actionFilter === chip.key;
          return (
            <button
              key={chip.key}
              onClick={() => setActionFilter(chip.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                isActive
                  ? 'bg-white text-black'
                  : 'surface-inset text-zinc-300 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <span>{chip.label}</span>
              <span className={`text-[11px] font-mono ${isActive ? 'text-zinc-600' : 'text-zinc-500'}`}>
                {chip.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input
            type="text"
            placeholder="Search by name, ISRC, album..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full surface-inset rounded-md pl-9 pr-3 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-400 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
          />
        </div>

        {deities.length > 0 && (
          <select
            value={deityFilter}
            onChange={(e) => setDeityFilter(e.target.value)}
            className="surface-inset rounded-md px-3 py-1.5 text-xs text-zinc-300 outline-none bg-transparent cursor-pointer"
          >
            <option value="">All Deities</option>
            {deities.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}

        {hasFilters && (
          <button
            onClick={() => { setActionFilter('all'); setDeityFilter(''); setSearch(''); }}
            className="text-[11px] text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-white/[0.06] transition-colors flex items-center gap-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            Clear
          </button>
        )}

        <button
          onClick={load}
          disabled={loading}
          className="ml-auto text-[11px] text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-white/[0.06] transition-colors"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Table */}
      <div className="border border-white/[0.06] rounded-xl overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[36px_1fr_90px_70px_180px_180px] px-4 py-2.5 text-[11px] text-zinc-400 uppercase tracking-wide border-b border-white/[0.04] bg-white/[0.01]">
          <span>#</span>
          <span>Song</span>
          <span>Deity</span>
          <button
            onClick={() => setSortBy(s => s === 'duration_asc' ? 'duration_desc' : s === 'duration_desc' ? 'priority' : 'duration_asc')}
            className={`text-left hover:text-zinc-300 transition-colors ${sortBy.startsWith('duration') ? 'text-zinc-300' : ''}`}
          >
            Dur. {sortBy === 'duration_asc' ? '↑' : sortBy === 'duration_desc' ? '↓' : ''}
          </button>
          <span>Pipeline</span>
          <span></span>
        </div>

        {/* Loading */}
        {loading && filtered.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Empty */}
        {!loading && filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-zinc-400 text-xs">
            No songs match filters
          </div>
        )}

        {/* Rows */}
        {filtered.map(({ item, action }, idx) => {
          const showRenders = onViewRenders && item.render_count > 0 && item.lahari_project_id;
          const hasOthers = item.others_done > 0 || item.others_wip > 0;
          return (
            <div
              key={item.id}
              className={`grid grid-cols-[36px_1fr_90px_70px_180px_180px] px-4 py-2.5 items-center border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors group ${
                idx % 2 === 0 ? '' : 'bg-white/[0.01]'
              }`}
            >
              <span className="text-xs text-zinc-400 font-mono">{item.priority}</span>

              <div className="min-w-0">
                <div className="text-xs text-white truncate">{item.song_name}</div>
                <div className="text-[11px] text-zinc-400 truncate">{item.album} · {item.isrc}</div>
              </div>

              <span className="text-xs text-zinc-300">{item.deity}</span>
              <span className="text-xs text-zinc-400 font-mono">{formatDuration(item.duration_seconds)}</span>

              {/* Pipeline pills + Others dots */}
              <div className="flex items-center gap-1.5">
                <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                  item.audio_uploaded ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/[0.04] text-zinc-400'
                }`}>Audio</span>
                <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                  item.srts_ready ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/[0.04] text-zinc-400'
                }`}>SRT</span>
                <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                  item.render_count > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/[0.04] text-zinc-400'
                }`}>Video</span>
                {hasOthers && (
                  <span
                    className="flex items-center gap-1 ml-1 text-[11px]"
                    title={`${item.others_done} other artist${item.others_done === 1 ? '' : 's'} published · ${item.others_wip} still WIP`}
                  >
                    {item.others_done > 0 && (
                      <span className="flex items-center gap-0.5 text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span className="font-mono tabular-nums">{item.others_done}</span>
                      </span>
                    )}
                    {item.others_wip > 0 && (
                      <span className="flex items-center gap-0.5 text-amber-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        <span className="font-mono tabular-nums">{item.others_wip}</span>
                      </span>
                    )}
                  </span>
                )}
              </div>

              {/* Action — Start / Continue / Open / Needs audio */}
              <div className="flex justify-end items-center gap-1">
                {showRenders && (
                  <button
                    onClick={() => onViewRenders!(item.lahari_project_id!, item.song_name)}
                    className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-white/[0.06] transition-colors"
                    title="View renders"
                  >
                    Renders
                  </button>
                )}
                {action === 'open' && (
                  <button
                    onClick={() => handleStart(item)}
                    disabled={starting === item.id}
                    className="text-xs text-zinc-300 hover:text-white px-3 py-1 rounded hover:bg-white/[0.06] transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {starting === item.id && <div className="w-3 h-3 border-2 border-zinc-400 border-t-white rounded-full animate-spin"></div>}
                    {starting === item.id ? 'Opening…' : 'Open'}
                  </button>
                )}
                {action === 'continue' && (
                  <button
                    onClick={() => handleStart(item)}
                    disabled={starting === item.id}
                    className="text-xs bg-white text-black px-3 py-1.5 rounded font-medium hover:bg-zinc-200 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    {starting === item.id && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin"></div>}
                    {starting === item.id ? 'Opening…' : 'Continue'}
                  </button>
                )}
                {action === 'start' && (
                  <button
                    onClick={() => handleStart(item)}
                    disabled={starting === item.id}
                    className="text-xs bg-white text-black px-3 py-1.5 rounded font-medium hover:bg-zinc-200 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    {starting === item.id && <div className="w-3 h-3 border-2 border-zinc-400 border-t-black rounded-full animate-spin"></div>}
                    {starting === item.id ? 'Starting…' : 'Start'}
                  </button>
                )}
                {action === 'needs-audio' && (
                  <span className="text-[11px] text-zinc-400">Needs audio</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
