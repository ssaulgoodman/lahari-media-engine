import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../services/api';

type WindowKey = '7' | '30' | '90' | 'all';

type AggRow = {
  calls: number;
  errors: number;
  cost: number;
  durationMs: number;
  [key: string]: any;
};

type BudgetData = {
  account: { userId: string; email: string | null };
  window: { days: WindowKey | 'all'; sinceIso: string | null; generatedAt: string };
  totals: { cost: number; calls: number; errors: number; durationMs: number; projects: number; songs: number };
  daily: AggRow[];
  weekly: AggRow[];
  byModel: AggRow[];
  byStage: AggRow[];
  bySongType: AggRow[];
  bySong: AggRow[];
  note: string;
};

const money = (value: number) => `$${Number(value || 0).toFixed(2)}`;
const seconds = (ms: number) => `${Math.round(Number(ms || 0) / 1000).toLocaleString()}s`;

const StatCard: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div className="surface-inset rounded-lg px-4 py-3">
    <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
    <div className="text-2xl font-display text-white mt-1">{value}</div>
    {sub && <div className="text-[11px] text-zinc-500 mt-1">{sub}</div>}
  </div>
);

const SimpleTable: React.FC<{
  title: string;
  rows: AggRow[];
  primaryKeyName: string;
  primaryLabel: string;
  limit?: number;
}> = ({ title, rows, primaryKeyName, primaryLabel, limit = 10 }) => {
  const shown = rows.slice(0, limit);
  return (
    <section className="rounded-xl border border-white/[0.06] overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
        <h2 className="text-sm font-medium text-white">{title}</h2>
        <span className="text-[11px] text-zinc-500">{rows.length} rows</span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        <div className="grid grid-cols-[1fr_90px_80px_80px_80px] px-4 py-2 text-[11px] uppercase tracking-wide text-zinc-500 bg-white/[0.01]">
          <span>{primaryLabel}</span>
          <span className="text-right">Spend</span>
          <span className="text-right">Calls</span>
          <span className="text-right">Errors</span>
          <span className="text-right">Time</span>
        </div>
        {shown.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-500">No calls in this window</div>
        ) : shown.map((row) => (
          <div key={`${title}-${row[primaryKeyName]}`} className="grid grid-cols-[1fr_90px_80px_80px_80px] px-4 py-2.5 text-xs items-center hover:bg-white/[0.02]">
            <span className="text-zinc-300 truncate" title={String(row[primaryKeyName] || '')}>
              {row[primaryKeyName] || 'unknown'}
            </span>
            <span className="text-right font-mono text-zinc-200">{money(row.cost)}</span>
            <span className="text-right font-mono text-zinc-400">{row.calls}</span>
            <span className={`text-right font-mono ${row.errors > 0 ? 'text-amber-300' : 'text-zinc-500'}`}>{row.errors}</span>
            <span className="text-right font-mono text-zinc-500">{seconds(row.durationMs)}</span>
          </div>
        ))}
      </div>
    </section>
  );
};

const SongTable: React.FC<{ rows: AggRow[] }> = ({ rows }) => (
  <section className="rounded-xl border border-white/[0.06] overflow-hidden">
    <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
      <h2 className="text-sm font-medium text-white">Top Songs</h2>
      <span className="text-[11px] text-zinc-500">{rows.length} songs</span>
    </div>
    <div className="divide-y divide-white/[0.04]">
      <div className="grid grid-cols-[1fr_100px_90px_80px_80px] px-4 py-2 text-[11px] uppercase tracking-wide text-zinc-500 bg-white/[0.01]">
        <span>Song</span>
        <span>Type</span>
        <span className="text-right">Spend</span>
        <span className="text-right">Calls</span>
        <span className="text-right">Errors</span>
      </div>
      {rows.slice(0, 20).map((row) => (
        <div key={row.projectId} className="grid grid-cols-[1fr_100px_90px_80px_80px] px-4 py-2.5 text-xs items-center hover:bg-white/[0.02]">
          <div className="min-w-0">
            <div className="text-zinc-300 truncate" title={row.title}>{row.title}</div>
            <div className="text-[11px] text-zinc-600 truncate">{[row.album, row.isrc, row.deity].filter(Boolean).join(' · ')}</div>
          </div>
          <span className="text-zinc-500 truncate">{row.songType || 'unknown'}</span>
          <span className="text-right font-mono text-zinc-200">{money(row.cost)}</span>
          <span className="text-right font-mono text-zinc-400">{row.calls}</span>
          <span className={`text-right font-mono ${row.errors > 0 ? 'text-amber-300' : 'text-zinc-500'}`}>{row.errors}</span>
        </div>
      ))}
    </div>
  </section>
);

export const BudgetDashboard: React.FC<{ user: { email?: string | null }; signOut: () => Promise<void> }> = ({ user, signOut }) => {
  const [days, setDays] = useState<WindowKey>('30');
  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getDevBudget(days));
    } catch (err: any) {
      setError(err?.message || 'Failed to load budget dashboard');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const avgCost = useMemo(() => {
    if (!data || data.totals.calls === 0) return 0;
    return data.totals.cost / data.totals.calls;
  }, [data]);

  return (
    <div className="min-h-screen bg-[#141418] text-zinc-300">
      <header className="h-14 border-b border-white/[0.06] px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/" className="text-sm font-display font-semibold text-white">Lahari</a>
          <span className="text-zinc-600">/</span>
          <span className="text-sm text-zinc-300">Dev budget</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-zinc-500">{user.email || data?.account.email}</span>
          <button onClick={signOut} className="text-[11px] text-zinc-400 hover:text-white px-2 py-1 rounded-md hover:bg-white/[0.06]">
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-7 space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display text-white">Dev Account Budget</h1>
            <p className="text-sm text-zinc-500 mt-1">Estimated spend from logged Lahari AI calls. Not the provider invoice.</p>
          </div>
          <div className="flex items-center gap-2">
            {(['7', '30', '90', 'all'] as const).map((key) => (
              <button
                key={key}
                onClick={() => setDays(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium ${days === key ? 'bg-white text-black' : 'surface-inset text-zinc-300 hover:text-white'}`}
              >
                {key === 'all' ? 'All time' : `${key}d`}
              </button>
            ))}
            <button onClick={load} disabled={loading} className="px-3 py-1.5 rounded-md text-xs surface-inset text-zinc-300 hover:text-white disabled:opacity-50">
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatCard label="Spend" value={money(data.totals.cost)} sub={`${data.window.days === 'all' ? 'all time' : `last ${data.window.days} days`}`} />
              <StatCard label="Calls" value={data.totals.calls.toLocaleString()} sub={`${data.totals.errors} errors`} />
              <StatCard label="Avg / call" value={money(avgCost)} sub="logged estimate" />
              <StatCard label="Projects" value={String(data.totals.projects)} sub={`${data.totals.songs} queue songs`} />
              <StatCard label="Model time" value={seconds(data.totals.durationMs)} sub="provider latency total" />
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <SimpleTable title="Daily" rows={data.daily} primaryKeyName="date" primaryLabel="Date" />
              <SimpleTable title="Weekly" rows={data.weekly} primaryKeyName="week" primaryLabel="Week" />
              <SimpleTable title="By Model" rows={data.byModel} primaryKeyName="model" primaryLabel="Model" />
              <SimpleTable title="By Song Type" rows={data.bySongType} primaryKeyName="songType" primaryLabel="Song Type" />
            </div>

            <SongTable rows={data.bySong} />
            <SimpleTable title="By Stage" rows={data.byStage} primaryKeyName="stage" primaryLabel="Stage" limit={25} />
          </>
        )}
      </main>
    </div>
  );
};
