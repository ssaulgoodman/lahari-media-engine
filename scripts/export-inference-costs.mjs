import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const OUT_ROOT = 'docs/cost-reports';
const DEFAULT_PROVIDERS = ['vertex', 'segmind'];

const arg = (name, fallback = undefined) => {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
};

const flag = (name) => process.argv.includes(`--${name}`);

const todayIso = () => new Date().toISOString().slice(0, 10);

const csvEscape = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const writeCsv = (filePath, rows, columns) => {
  const body = [
    columns.join(','),
    ...rows.map((row) => columns.map((col) => csvEscape(row[col])).join(',')),
  ].join('\n');
  fs.writeFileSync(filePath, `${body}\n`);
};

const money = (value) => Number(Number(value || 0).toFixed(4));

const weekStartUtc = (iso) => {
  const d = new Date(iso);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

const monthStartUtc = (iso) => iso.slice(0, 7);

const classifyProvider = (row) => {
  const model = String(row.model || '').toLowerCase();
  const stage = String(row.stage || '').toLowerCase();
  const text = `${model} ${row.response_summary || ''} ${row.error || ''}`.toLowerCase();

  if (model.startsWith('vertex:')) return 'vertex';
  if (
    model.startsWith('seedance') ||
    model === 'veo-3.1' ||
    model === 'veo-3.1-fast' ||
    model === 'nano-banana-2' ||
    text.includes('segmind')
  ) return 'segmind';
  if (text.includes('video generated via vertex') || text.includes('vertex veo')) return 'vertex';
  if (model.includes('gemini') || model.includes('imagen')) return 'google';
  if (model.includes('gpt') || model.includes('openai')) return 'openai';
  if (model.includes('claude')) return 'anthropic';
  if (stage.includes('video') && /veo|seedance/.test(model)) return 'segmind';
  return 'other';
};

const groupBy = (rows, keys) => {
  const map = new Map();
  for (const row of rows) {
    const key = keys.map((k) => row[k] ?? '').join('\u0001');
    const existing = map.get(key) || Object.fromEntries(keys.map((k) => [k, row[k] ?? '']));
    existing.calls = (existing.calls || 0) + 1;
    existing.errors = (existing.errors || 0) + (row.error ? 1 : 0);
    existing.cost_usd = money((existing.cost_usd || 0) + Number(row.cost_estimate || 0));
    existing.first_call_at = !existing.first_call_at || row.created_at < existing.first_call_at ? row.created_at : existing.first_call_at;
    existing.last_call_at = !existing.last_call_at || row.created_at > existing.last_call_at ? row.created_at : existing.last_call_at;
    map.set(key, existing);
  }
  return [...map.values()].sort((a, b) => (b.cost_usd - a.cost_usd) || (b.calls - a.calls));
};

const fetchAllAiCalls = async (sb, since, until) => {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await sb
      .from('lahari_ai_calls')
      .select('id, project_id, stage, model, cost_estimate, duration_ms, created_at, error, response_summary')
      .gte('created_at', since)
      .lt('created_at', until)
      .order('created_at', { ascending: true })
      .range(from, to);
    if (error) throw new Error(`AI call fetch failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
};

const main = async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');

  const since = arg('since', '2026-01-01T00:00:00Z');
  const until = arg('until', new Date(Date.now() + 24 * 3600 * 1000).toISOString());
  const reportDate = arg('date', todayIso());
  const providers = (arg('providers', DEFAULT_PROVIDERS.join(',')) || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const sb = createClient(supabaseUrl, supabaseKey);
  const calls = await fetchAllAiCalls(sb, since, until);

  const projectIds = [...new Set((calls || []).map((row) => row.project_id).filter(Boolean))];
  const titles = new Map();
  if (projectIds.length) {
    const { data: projects, error: projectError } = await sb
      .from('lahari_projects')
      .select('id, title')
      .in('id', projectIds);
    if (projectError) throw new Error(`Project fetch failed: ${projectError.message}`);
    for (const project of projects || []) titles.set(project.id, project.title);
  }

  const rows = (calls || [])
    .map((row) => ({
      ...row,
      provider: classifyProvider(row),
      song: titles.get(row.project_id) || '(unknown project)',
      week_start_utc: weekStartUtc(row.created_at),
      month_utc: monthStartUtc(row.created_at),
      cost_estimate: money(row.cost_estimate),
      error: row.error || '',
    }))
    .filter((row) => providers.includes(row.provider));

  const datedDir = path.join(OUT_ROOT, reportDate);
  const latestDir = path.join(OUT_ROOT, 'latest');
  fs.mkdirSync(datedDir, { recursive: true });
  fs.mkdirSync(latestDir, { recursive: true });

  const sheets = [
    {
      name: 'weekly_by_provider',
      rows: groupBy(rows, ['week_start_utc', 'provider']),
      columns: ['week_start_utc', 'provider', 'calls', 'errors', 'cost_usd', 'first_call_at', 'last_call_at'],
    },
    {
      name: 'weekly_by_provider_model',
      rows: groupBy(rows, ['week_start_utc', 'provider', 'model']),
      columns: ['week_start_utc', 'provider', 'model', 'calls', 'errors', 'cost_usd', 'first_call_at', 'last_call_at'],
    },
    {
      name: 'monthly_by_provider',
      rows: groupBy(rows, ['month_utc', 'provider']),
      columns: ['month_utc', 'provider', 'calls', 'errors', 'cost_usd', 'first_call_at', 'last_call_at'],
    },
    {
      name: 'monthly_by_provider_model',
      rows: groupBy(rows, ['month_utc', 'provider', 'model']),
      columns: ['month_utc', 'provider', 'model', 'calls', 'errors', 'cost_usd', 'first_call_at', 'last_call_at'],
    },
    {
      name: 'song_by_provider',
      rows: groupBy(rows, ['song', 'project_id', 'provider']),
      columns: ['song', 'project_id', 'provider', 'calls', 'errors', 'cost_usd', 'first_call_at', 'last_call_at'],
    },
    {
      name: 'song_by_provider_model',
      rows: groupBy(rows, ['song', 'project_id', 'provider', 'model']),
      columns: ['song', 'project_id', 'provider', 'model', 'calls', 'errors', 'cost_usd', 'first_call_at', 'last_call_at'],
    },
    {
      name: 'call_detail',
      rows: rows.map((row) => ({
        created_at: row.created_at,
        week_start_utc: row.week_start_utc,
        month_utc: row.month_utc,
        song: row.song,
        project_id: row.project_id,
        provider: row.provider,
        stage: row.stage,
        model: row.model,
        cost_usd: row.cost_estimate,
        duration_ms: row.duration_ms || '',
        error: row.error,
      })),
      columns: ['created_at', 'week_start_utc', 'month_utc', 'song', 'project_id', 'provider', 'stage', 'model', 'cost_usd', 'duration_ms', 'error'],
    },
  ];

  for (const sheet of sheets) {
    writeCsv(path.join(datedDir, `${sheet.name}.csv`), sheet.rows, sheet.columns);
    writeCsv(path.join(latestDir, `${sheet.name}.csv`), sheet.rows, sheet.columns);
  }

  const totals = groupBy(rows, ['provider']);
  const modelTotals = groupBy(rows, ['provider', 'model']);
  const readme = `# Lahari Inference Cost Report

Generated: ${new Date().toISOString()}

Range: ${since} to ${until}

Providers included: ${providers.join(', ')}

Source: Supabase \`lahari_ai_calls.cost_estimate\` joined with \`lahari_projects.title\`.

Note: this is the app-side inference ledger. Google/Segmind invoices can differ if provider-side billing includes retries, taxes, minimums, manual console calls, or calls outside this app.

## Totals

${totals.map((r) => `- ${r.provider}: ${r.calls} calls, ${r.errors} errors, $${r.cost_usd.toFixed(2)}`).join('\n')}

## Model Totals

${modelTotals.map((r) => `- ${r.provider} / ${r.model}: ${r.calls} calls, ${r.errors} errors, $${r.cost_usd.toFixed(2)}`).join('\n')}

## Sheets

- \`weekly_by_provider.csv\`
- \`weekly_by_provider_model.csv\`
- \`monthly_by_provider.csv\`
- \`monthly_by_provider_model.csv\`
- \`song_by_provider.csv\`
- \`song_by_provider_model.csv\`
- \`call_detail.csv\`
`;
  fs.writeFileSync(path.join(datedDir, 'README.md'), readme);
  fs.writeFileSync(path.join(latestDir, 'README.md'), readme);

  console.log(`Wrote ${sheets.length} sheets to ${datedDir} and ${latestDir}`);
  console.table(totals);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
