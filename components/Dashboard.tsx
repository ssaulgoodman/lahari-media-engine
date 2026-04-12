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
}

interface Props {
  onStartProduction: (queueId: string) => void;
  onOpenProject: (projectId: string) => void;
}

const FILTER_KEY = 'lahari-queue-filters';

const formatDuration = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const Dashboard: React.FC<Props> = ({ onStartProduction, onOpenProject }) => {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [deities, setDeities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);

  // Persisted filters
  const [statusFilter, setStatusFilter] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}').status || 'all'; } catch { return 'all'; }
  });
  const [deityFilter, setDeityFilter] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}').deity || ''; } catch { return ''; }
  });
  const [search, setSearch] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}').search || ''; } catch { return ''; }
  });

  // Persist filters
  useEffect(() => {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify({ status: statusFilter, deity: deityFilter, search }));
  }, [statusFilter, deityFilter, search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [q, d] = await Promise.all([
        api.listQueue({ status: statusFilter !== 'all' ? statusFilter : undefined, deity: deityFilter || undefined }),
        api.getQueueDeities(),
      ]);
      setItems(q);
      setDeities(d);
    } catch (err) {
      console.error('Failed to load queue:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, deityFilter]);

  useEffect(() => { load(); }, [load]);

  const handleStart = async (item: QueueItem) => {
    if (!item.audio_uploaded) return;
    setStarting(item.id);
    try {
      onStartProduction(item.id);
    } finally {
      setStarting(null);
    }
  };

  const filtered = search
    ? items.filter(i =>
        i.song_name?.toLowerCase().includes(search.toLowerCase())
        || i.isrc?.toLowerCase().includes(search.toLowerCase())
        || i.album?.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  // Stats from full list (before search filter)
  const stats = {
    total: items.length,
    queued: items.filter(i => i.status === 'queued').length,
    in_progress: items.filter(i => i.status === 'in_progress').length,
    review: items.filter(i => i.status === 'review').length,
    completed: items.filter(i => i.status === 'completed').length,
    hasAudio: items.filter(i => i.audio_uploaded).length,
    hasSrt: items.filter(i => i.srts_ready).length,
  };

  const hasFilters = statusFilter !== 'all' || deityFilter || search;

  return (
    <div className="max-w-6xl mx-auto pb-32 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-display font-medium text-white">Music Video Queue</h2>
        <p className="text-sm text-zinc-500 mt-0.5">
          {filtered.length === stats.total
            ? `${stats.total} songs`
            : `${filtered.length} of ${stats.total} songs`}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { key: 'queued', label: 'Queued', count: stats.queued, color: 'text-zinc-400', ring: 'ring-zinc-500' },
          { key: 'in_progress', label: 'In Progress', count: stats.in_progress, color: 'text-blue-400', ring: 'ring-blue-500' },
          { key: 'review', label: 'Review', count: stats.review, color: 'text-amber-400', ring: 'ring-amber-500' },
          { key: 'completed', label: 'Complete', count: stats.completed, color: 'text-emerald-400', ring: 'ring-emerald-500' },
        ].map(card => {
          const isActive = statusFilter === card.key;
          return (
            <button
              key={card.key}
              onClick={() => setStatusFilter(isActive ? 'all' : card.key)}
              className={`surface rounded-xl px-4 py-3 text-left transition-all hover:bg-white/[0.04] ${
                isActive ? `ring-1 ${card.ring}` : ''
              }`}
            >
              <p className={`text-xl font-semibold font-mono ${card.color}`}>{card.count}</p>
              <p className="text-[11px] text-zinc-600 mt-0.5">{card.label}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input
            type="text"
            placeholder="Search by name, ISRC, album..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full surface-inset rounded-md pl-9 pr-3 py-1.5 text-[12px] text-zinc-300 placeholder:text-zinc-700 outline-none focus-visible:ring-1 focus-visible:ring-white/20"
          />
        </div>

        {deities.length > 0 && (
          <select
            value={deityFilter}
            onChange={(e) => setDeityFilter(e.target.value)}
            className="surface-inset rounded-md px-3 py-1.5 text-[12px] text-zinc-300 outline-none bg-transparent cursor-pointer"
          >
            <option value="">All Deities</option>
            {deities.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}

        {hasFilters && (
          <button
            onClick={() => { setStatusFilter('all'); setDeityFilter(''); setSearch(''); }}
            className="text-[11px] text-zinc-500 hover:text-white px-2 py-1 rounded hover:bg-white/[0.06] transition-colors flex items-center gap-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            Clear
          </button>
        )}

        <button
          onClick={load}
          disabled={loading}
          className="ml-auto text-[11px] text-zinc-500 hover:text-white px-2 py-1 rounded hover:bg-white/[0.06] transition-colors"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Table */}
      <div className="border border-white/[0.06] rounded-xl overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[36px_1fr_90px_70px_120px_100px_110px] px-4 py-2 text-[10px] text-zinc-600 uppercase tracking-wide border-b border-white/[0.04] bg-white/[0.01]">
          <span>#</span>
          <span>Song</span>
          <span>Deity</span>
          <span>Dur.</span>
          <span>Pipeline</span>
          <span>Status</span>
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
          <div className="flex items-center justify-center h-32 text-zinc-600 text-xs">
            No songs match filters
          </div>
        )}

        {/* Rows */}
        {filtered.map((item, idx) => {
          const hasProject = !!item.lahari_project_id;
          const canStart = item.audio_uploaded && item.status === 'queued';

          return (
            <div
              key={item.id}
              className={`grid grid-cols-[36px_1fr_90px_70px_120px_100px_110px] px-4 py-2.5 items-center border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors group ${
                idx % 2 === 0 ? '' : 'bg-white/[0.01]'
              }`}
            >
              <span className="text-[11px] text-zinc-600 font-mono">{item.priority}</span>

              <div className="min-w-0">
                <div className="text-[12px] text-zinc-200 truncate">{item.song_name}</div>
                <div className="text-[10px] text-zinc-600 truncate">{item.album} · {item.isrc}</div>
              </div>

              <span className="text-[11px] text-zinc-400">{item.deity}</span>
              <span className="text-[11px] text-zinc-500 font-mono">{formatDuration(item.duration_seconds)}</span>

              {/* Pipeline pills — inspired by echo dashboard */}
              <div className="flex items-center gap-1">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                  item.audio_uploaded ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/[0.04] text-zinc-600'
                }`}>Audio</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                  item.srts_ready ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/[0.04] text-zinc-600'
                }`}>SRT</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                  item.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/[0.04] text-zinc-600'
                }`}>Video</span>
              </div>

              {/* Status */}
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full w-fit ${
                item.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400'
                  : item.status === 'in_progress' ? 'bg-blue-500/10 text-blue-400'
                  : item.status === 'review' ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-white/[0.04] text-zinc-500'
              }`}>
                {item.status === 'in_progress' ? 'In Progress'
                  : item.status === 'completed' ? 'Done'
                  : item.status.charAt(0).toUpperCase() + item.status.slice(1)}
              </span>

              {/* Action */}
              <div className="flex justify-end">
                {hasProject ? (
                  <button
                    onClick={() => onOpenProject(item.lahari_project_id!)}
                    className="text-[11px] text-zinc-400 hover:text-white px-3 py-1 rounded hover:bg-white/[0.06] transition-colors"
                  >
                    Open
                  </button>
                ) : canStart ? (
                  <button
                    onClick={() => handleStart(item)}
                    disabled={starting === item.id}
                    className="text-[11px] bg-white text-black px-3 py-1 rounded font-medium hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                  >
                    {starting === item.id ? '...' : 'Start'}
                  </button>
                ) : !item.audio_uploaded ? (
                  <span className="text-[10px] text-zinc-600">Needs audio</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
