import React, { useState, useEffect } from 'react';
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

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  queued: { bg: 'bg-zinc-500/10', text: 'text-zinc-400', label: 'Queued' },
  in_progress: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'In Progress' },
  review: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'Review' },
  completed: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Done' },
};

const formatDuration = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const Dashboard: React.FC<Props> = ({ onStartProduction, onOpenProject }) => {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [deities, setDeities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [deityFilter, setDeityFilter] = useState('');
  const [search, setSearch] = useState('');
  const [starting, setStarting] = useState<string | null>(null);

  const load = async () => {
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
  };

  useEffect(() => { load(); }, [statusFilter, deityFilter]);

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
    ? items.filter(i => i.song_name?.toLowerCase().includes(search.toLowerCase()) || i.isrc?.includes(search))
    : items;

  const counts = {
    all: items.length,
    queued: items.filter(i => i.status === 'queued').length,
    in_progress: items.filter(i => i.status === 'in_progress').length,
    review: items.filter(i => i.status === 'review').length,
    completed: items.filter(i => i.status === 'completed').length,
  };

  return (
    <div className="max-w-6xl mx-auto pb-32 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display font-medium text-white">Music Video Queue</h2>
          <p className="text-sm text-zinc-500 mt-0.5">{items.length} songs in production pipeline</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-[11px] text-zinc-500 hover:text-white px-3 py-1.5 rounded-md hover:bg-white/[0.06] transition-colors"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Status tabs */}
        <div className="flex items-center gap-1">
          {(['all', 'queued', 'in_progress', 'review', 'completed'] as const).map(s => {
            const count = counts[s];
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                  active ? 'bg-white/[0.08] text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {s === 'all' ? 'All' : s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
                {count > 0 && <span className="ml-1 text-zinc-600">{count}</span>}
              </button>
            );
          })}
        </div>

        {/* Deity filter */}
        {deities.length > 0 && (
          <select
            value={deityFilter}
            onChange={(e) => setDeityFilter(e.target.value)}
            className="surface-inset rounded-md px-2.5 py-1 text-[11px] text-zinc-300 outline-none bg-transparent cursor-pointer"
          >
            <option value="">All Deities</option>
            {deities.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}

        {/* Search */}
        <input
          type="text"
          placeholder="Search songs..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="surface-inset rounded-md px-3 py-1 text-[11px] text-zinc-300 placeholder:text-zinc-700 outline-none focus-visible:ring-1 focus-visible:ring-white/20 w-48 ml-auto"
        />
      </div>

      {/* Table */}
      <div className="border border-white/[0.06] rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[40px_1fr_100px_80px_80px_80px_100px_120px] px-4 py-2 text-[10px] text-zinc-600 uppercase tracking-wide border-b border-white/[0.04] bg-white/[0.01]">
          <span>#</span>
          <span>Song</span>
          <span>Deity</span>
          <span>Duration</span>
          <span>Audio</span>
          <span>SRT</span>
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
          const status = STATUS_STYLES[item.status] || STATUS_STYLES.queued;
          const hasProject = !!item.lahari_project_id;
          const canStart = item.audio_uploaded && item.status === 'queued';

          return (
            <div
              key={item.id}
              className={`grid grid-cols-[40px_1fr_100px_80px_80px_80px_100px_120px] px-4 py-2.5 items-center border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors ${
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

              <span className={`text-[10px] font-medium ${item.audio_uploaded ? 'text-emerald-400' : 'text-zinc-600'}`}>
                {item.audio_uploaded ? 'Ready' : 'Missing'}
              </span>

              <span className={`text-[10px] font-medium ${item.srts_ready ? 'text-emerald-400' : 'text-zinc-600'}`}>
                {item.srts_ready ? 'Ready' : 'Missing'}
              </span>

              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full inline-block w-fit ${status.bg} ${status.text}`}>
                {status.label}
              </span>

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
                    {starting === item.id ? 'Starting...' : 'Start'}
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
