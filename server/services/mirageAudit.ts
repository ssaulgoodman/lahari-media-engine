import fs from 'fs';
import path from 'path';
import { getSB, insertRow, T } from '../database.js';
import { isPaidActionKey } from './actionRegistry.js';

type AuditPhase = 'start' | 'finish';
type IssueSeverity = 'low' | 'mid' | 'high';

const MAX_STRING = 500;
const MAX_ARRAY = 25;
const MAX_KEYS = 40;
const SENSITIVE_CONTENT_KEYS = [
  'body',
  'script',
  'concept',
  'prompt',
  'storyboardprompt',
  'storyboardcutplan',
  'motionprompt',
  'visualprompt',
  'direction',
  'feedback',
  'artistnote',
  'promptoverride',
  'recenttoolcalls',
  'lyrics',
  'narrativedescription',
  'description',
  'suggestedfix',
  'summary',
  'note',
];

const dayStamp = (date = new Date()) => date.toISOString().slice(0, 10);

const timestampSlug = () => new Date().toISOString().replace(/[:.]/g, '-');

const auditBaseDir = () => path.join(process.cwd(), '.mirage', 'audit');
const issuesDir = () => path.join(process.cwd(), '.mirage', 'issues');

const safeProjectScope = (projectId?: string | null) => {
  if (!projectId) return '_unscoped';
  return projectId.replace(/[^a-zA-Z0-9_-]/g, '_') || '_unscoped';
};

export const auditLogPath = (projectId?: string | null, date = new Date()) => {
  return path.join(auditBaseDir(), safeProjectScope(projectId), `${dayStamp(date)}-calls.jsonl`);
};

const redactKey = (key: string) => {
  const normalized = key.toLowerCase();
  return normalized.includes('key')
    || normalized.includes('secret')
    || normalized.includes('token')
    || normalized.includes('authorization')
    || normalized.includes('apikey')
    || normalized.includes('password');
};

const redactContentKey = (key: string) => {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_CONTENT_KEYS.some((candidate) => normalized.includes(candidate));
};

const summarizeSensitiveValue = (value: unknown) => {
  if (typeof value === 'string') {
    return `[redacted content ${value.length} chars]`;
  }
  if (Array.isArray(value)) {
    return `[redacted content array ${value.length} items]`;
  }
  if (value && typeof value === 'object') {
    return `[redacted content object ${Object.keys(value as Record<string, unknown>).length} keys]`;
  }
  return '[redacted content]';
};

export const redactAuditValue = (value: unknown, depth = 0): unknown => {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...[truncated ${value.length - MAX_STRING} chars]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 4) return '[max depth]';
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((item) => redactAuditValue(item, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`[truncated ${value.length - MAX_ARRAY} items]`);
    return out;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS);
    const out: Record<string, unknown> = {};
    for (const [key, inner] of entries) {
      out[key] = redactKey(key)
        ? '[redacted]'
        : redactContentKey(key)
          ? summarizeSensitiveValue(inner)
          : redactAuditValue(inner, depth + 1);
    }
    const extra = Object.keys(value as Record<string, unknown>).length - entries.length;
    if (extra > 0) out.__truncatedKeys = extra;
    return out;
  }
  return String(value);
};

const projectIdFromPath = (value: string) => {
  const normalized = value.replace(/\\/g, '/');
  return normalized.match(/\.mirage\/previews\/([^/]+)/)?.[1]
    || normalized.match(/\.mirage\/sessions\/([^/]+)/)?.[1]
    || normalized.match(/\.mirage\/projects\/([^/]+)/)?.[1]
    || null;
};

export const deriveAuditProjectId = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.projectId === 'string' && input.projectId.trim()) {
    return projectIdFromPath(input.projectId) || input.projectId.trim();
  }
  if (typeof input.previewJsonPath === 'string') return projectIdFromPath(input.previewJsonPath);
  if (typeof input.project_id === 'string' && input.project_id.trim()) return input.project_id.trim();
  if (input.input && typeof input.input === 'object') {
    return deriveAuditProjectId(input.input);
  }
  if (Array.isArray(input.actions)) {
    for (const action of input.actions) {
      const projectId = deriveAuditProjectId(action);
      if (projectId) return projectId;
    }
  }
  return null;
};

const parseTextResult = (result: unknown): unknown => {
  const content = (result as any)?.content;
  const text = Array.isArray(content) && typeof content[0]?.text === 'string' ? content[0].text : null;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const resultSummary = (result: unknown) => {
  const parsed = parseTextResult(result);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    return redactAuditValue({
      kind: obj.kind,
      projectId: obj.projectId,
      projectTitle: obj.projectTitle,
      checkpoint: obj.checkpoint,
      diagnosis: obj.diagnosis,
      artifacts: obj.artifacts || obj.workbenchArtifacts,
      note: obj.note,
    });
  }
  if (typeof parsed === 'string') return redactAuditValue(parsed);
  return redactAuditValue(parsed);
};

const projectIdFromResult = (result: unknown): string | null => {
  const parsed = parseTextResult(result);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.projectId === 'string') return obj.projectId;
    if (obj.project && typeof (obj.project as any).id === 'string') return (obj.project as any).id;
  }
  return null;
};

const appendJsonl = (filePath: string, value: Record<string, unknown>) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
};

const isMissingAuditTableError = (error: any) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42P01'
    || code === 'PGRST205'
    || message.includes('mcp_audit_events');
};

const durableAuditConfigured = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

const persistAuditEvent = async (event: Record<string, unknown>) => {
  if (!durableAuditConfigured()) return;
  try {
    await insertRow('mcp_audit_events', {
      project_id: event.projectId || null,
      source: event.source,
      phase: event.phase,
      tool: event.tool,
      ts: event.ts,
      started_at: event.startedAt || null,
      duration_ms: event.durationMs ?? null,
      ok: event.ok ?? null,
      error_message: event.errorMessage || null,
      result_size: event.resultSize ?? null,
      args: event.args || {},
      result_summary: event.resultSummary || {},
    });
  } catch (error: any) {
    if (!isMissingAuditTableError(error)) {
      console.warn(`[mcp-audit] durable persist failed for ${event.tool}: ${error?.message || error}`);
    }
  }
};

export const recordMcpAudit = (entry: {
  phase: AuditPhase;
  tool: string;
  source?: 'mcp' | 'mcp-remote';
  args?: unknown;
  result?: unknown;
  error?: unknown;
  durationMs?: number;
  startedAt?: string;
}) => {
  const projectId = deriveAuditProjectId(entry.args) || projectIdFromResult(entry.result);
  const resultSize = entry.result == null ? 0 : JSON.stringify(entry.result).length;
  const event = {
    ts: new Date().toISOString(),
    source: entry.source || 'mcp',
    phase: entry.phase,
    tool: entry.tool,
    projectId,
    args: entry.args == null ? undefined : redactAuditValue(entry.args),
    durationMs: entry.durationMs,
    ok: entry.phase === 'finish' ? !entry.error : undefined,
    errorMessage: entry.error instanceof Error ? entry.error.message : entry.error ? String(entry.error) : undefined,
    resultSize: entry.phase === 'finish' ? resultSize : undefined,
    resultSummary: entry.phase === 'finish' && !entry.error ? resultSummary(entry.result) : undefined,
    startedAt: entry.startedAt,
  };
  appendJsonl(auditLogPath(projectId), event);
  void persistAuditEvent(event);
  return event;
};

export const recordCliAudit = (entry: {
  phase: AuditPhase;
  command: string;
  args?: unknown;
  error?: unknown;
  durationMs?: number;
  startedAt?: string;
}) => {
  const projectId = deriveAuditProjectId(entry.args);
  const event = {
    ts: new Date().toISOString(),
    source: 'cli',
    phase: entry.phase,
    tool: entry.command,
    projectId,
    args: entry.args == null ? undefined : redactAuditValue(entry.args),
    durationMs: entry.durationMs,
    ok: entry.phase === 'finish' ? !entry.error : undefined,
    errorMessage: entry.error instanceof Error ? entry.error.message : entry.error ? String(entry.error) : undefined,
    startedAt: entry.startedAt,
  };
  appendJsonl(auditLogPath(projectId), event);
  void persistAuditEvent(event);
  return event;
};

const readJsonlFile = (filePath: string) => {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { ts: '', phase: 'parse_error', message: line };
      }
    });
};

export const readAuditTail = (projectId?: string | null, limit = 20) => {
  const scope = safeProjectScope(projectId);
  const dir = path.join(auditBaseDir(), scope);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir)
    .filter((file) => file.endsWith('-calls.jsonl'))
    .sort()
    .reverse();
  const rows: any[] = [];
  for (const file of files) {
    rows.push(...readJsonlFile(path.join(dir, file)).reverse());
    if (rows.length >= limit) break;
  }
  return rows.slice(0, limit).reverse();
};

export const formatAuditTail = (projectId?: string | null, limit = 20) => {
  const rows = readAuditTail(projectId, limit);
  if (!rows.length) return `No audit entries found for ${projectId || '_unscoped'}.`;
  return rows.map((row) => {
    const status = row.phase === 'finish' ? (row.ok ? 'ok' : 'fail') : row.phase;
    const duration = row.durationMs == null ? '' : ` ${row.durationMs}ms`;
    const error = row.errorMessage ? ` error="${row.errorMessage}"` : '';
    return `${row.ts} ${row.tool} ${status}${duration}${error}`;
  }).join('\n');
};

const percentile = (values: number[], pct: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
};

const mean = (values: number[]) => {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const readAuditRows = (opts: {
  projectId?: string | null;
  sinceHours?: number;
  source?: string | null;
}) => {
  const sinceMs = Date.now() - Math.max(1, Math.min(24 * 14, opts.sinceHours || 24)) * 60 * 60 * 1000;
  const scopes = opts.projectId
    ? [safeProjectScope(opts.projectId)]
    : fs.existsSync(auditBaseDir())
      ? fs.readdirSync(auditBaseDir()).filter((entry) => fs.statSync(path.join(auditBaseDir(), entry)).isDirectory())
      : [];
  const rows: any[] = [];
  for (const scope of scopes) {
    const dir = path.join(auditBaseDir(), scope);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter((file) => file.endsWith('-calls.jsonl'))
      .sort();
    for (const file of files) {
      for (const row of readJsonlFile(path.join(dir, file))) {
        const ts = Date.parse(row.ts || '');
        if (!Number.isFinite(ts) || ts < sinceMs) continue;
        if (opts.source && row.source !== opts.source) continue;
        rows.push({ ...row, scope });
      }
    }
  }
  return rows.sort((a, b) => Date.parse(a.ts || '') - Date.parse(b.ts || ''));
};

const readDurableAuditRows = async (opts: {
  projectId?: string | null;
  sinceHours?: number;
  source?: string | null;
}) => {
  if (!durableAuditConfigured()) return null;
  const sinceIso = new Date(
    Date.now() - Math.max(1, Math.min(24 * 14, opts.sinceHours || 24)) * 60 * 60 * 1000,
  ).toISOString();
  try {
    let q = getSB()
      .from(T.mcp_audit_events)
      .select('*')
      .gte('ts', sinceIso)
      .order('ts', { ascending: true })
      .limit(5000);
    if (opts.projectId) q = q.eq('project_id', opts.projectId);
    if (opts.source) q = q.eq('source', opts.source);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map((row: any) => ({
      ts: row.ts,
      source: row.source,
      phase: row.phase,
      tool: row.tool,
      projectId: row.project_id,
      args: row.args,
      durationMs: row.duration_ms,
      ok: row.ok,
      errorMessage: row.error_message,
      resultSize: row.result_size,
      resultSummary: row.result_summary,
      startedAt: row.started_at,
      scope: row.project_id ? safeProjectScope(row.project_id) : '_unscoped',
      storage: 'db',
    }));
  } catch (error: any) {
    if (!isMissingAuditTableError(error)) {
      console.warn(`[mcp-audit] durable read failed: ${error?.message || error}`);
    }
    return null;
  }
};

const paidToolLike = (tool: string) => (
  !tool.startsWith('plan_')
  && !tool.startsWith('apply_plan_')
  && (
    tool.startsWith('generate_')
    || tool.startsWith('bulk_generate_')
    || tool.startsWith('apply_generate_')
    || tool.includes('refine_storyboard')
    || tool.includes('dialogue_audio')
  )
);

const rowHasPaidAction = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  if (typeof input.actionKey === 'string' && isPaidActionKey(input.actionKey)) return true;
  if (Array.isArray(input.actions)) return input.actions.some(rowHasPaidAction);
  return false;
};

const paidRowLike = (row: any) => (
  paidToolLike(row.tool)
  || rowHasPaidAction(row.args)
);

export const summarizeAgentTiming = async (opts: {
  projectId?: string | null;
  sinceHours?: number;
  source?: string | null;
  limit?: number;
}) => {
  const durableRows = await readDurableAuditRows(opts);
  const rows = durableRows || readAuditRows(opts).map((row) => ({ ...row, storage: 'filesystem' }));
  const finishes = rows
    .filter((row) => row.phase === 'finish')
    .map((row) => ({
      ...row,
      startedMs: Date.parse(row.startedAt || row.ts || ''),
      finishedMs: Date.parse(row.ts || ''),
      durationMs: Number(row.durationMs || 0),
      resultSize: Number(row.resultSize || 0),
      ok: row.ok !== false,
      errorMessage: row.errorMessage || null,
    }))
    .filter((row) => Number.isFinite(row.startedMs) && Number.isFinite(row.finishedMs));

  const byTool = new Map<string, any[]>();
  for (const row of finishes) {
    if (!byTool.has(row.tool)) byTool.set(row.tool, []);
    byTool.get(row.tool)!.push(row);
  }

  const tools = [...byTool.entries()]
    .map(([tool, toolRows]) => {
      const durations = toolRows.map((row) => row.durationMs).filter(Number.isFinite);
      const sizes = toolRows.map((row) => row.resultSize).filter(Number.isFinite);
      const errorMessages: Record<string, number> = {};
      for (const row of toolRows) {
        if (!row.errorMessage) continue;
        const key = String(row.errorMessage).slice(0, 220);
        errorMessages[key] = (errorMessages[key] || 0) + 1;
      }
      return {
        tool,
        count: toolRows.length,
        success: toolRows.filter((row) => row.ok).length,
        errors: toolRows.filter((row) => !row.ok).length,
        durationMs: {
          mean: mean(durations),
          p50: percentile(durations, 50),
          p90: percentile(durations, 90),
          max: durations.length ? Math.max(...durations) : null,
        },
        resultSize: {
          mean: mean(sizes),
          p50: percentile(sizes, 50),
          p90: percentile(sizes, 90),
          max: sizes.length ? Math.max(...sizes) : null,
        },
        errorMessages,
      };
    })
    .sort((a, b) => (b.durationMs.p90 || 0) - (a.durationMs.p90 || 0));

  const gaps = [];
  for (let i = 1; i < finishes.length; i += 1) {
    const previous = finishes[i - 1];
    const current = finishes[i];
    if (previous.scope !== current.scope) continue;
    const gapMs = current.startedMs - previous.finishedMs;
    if (!Number.isFinite(gapMs) || gapMs < 0) continue;
    gaps.push({
      gapMs,
      afterTool: previous.tool,
      beforeTool: current.tool,
      startedAt: new Date(current.startedMs).toISOString(),
      projectId: current.projectId || (current.scope === '_unscoped' ? null : current.scope),
    });
  }
  const gapValues = gaps.map((gap) => gap.gapMs);
  const durations = finishes.map((row) => row.durationMs).filter(Number.isFinite);
  const firstStart = finishes.length ? Math.min(...finishes.map((row) => row.startedMs)) : null;
  const lastFinish = finishes.length ? Math.max(...finishes.map((row) => row.finishedMs)) : null;
  const limit = Math.max(1, Math.min(100, opts.limit || 20));

  return {
    kind: 'mirage.agent_timing_summary',
    generatedAt: new Date().toISOString(),
    filters: {
      projectId: opts.projectId || null,
      sinceHours: Math.max(1, Math.min(24 * 14, opts.sinceHours || 24)),
      source: opts.source || null,
    },
    storage: durableRows ? 'database' : 'filesystem',
    caveats: durableRows
      ? ['wallClockMs spans the selected window; use a tight sinceHours immediately after a baseline run for session-like numbers.']
      : ['filesystem audit is ephemeral on hosted deployments; apply the mcp_audit_events migration for durable baseline data.'],
    totals: {
      rows: rows.length,
      finishEvents: finishes.length,
      tools: tools.length,
      successes: finishes.filter((row) => row.ok).length,
      errors: finishes.filter((row) => !row.ok).length,
      wallClockMs: firstStart != null && lastFinish != null ? lastFinish - firstStart : null,
      totalToolMs: durations.reduce((sum, value) => sum + value, 0),
      totalInterToolGapMs: gapValues.reduce((sum, value) => sum + value, 0),
    },
    interToolGaps: {
      count: gaps.length,
      mean: mean(gapValues),
      p50: percentile(gapValues, 50),
      p90: percentile(gapValues, 90),
      max: gapValues.length ? Math.max(...gapValues) : null,
      top: [...gaps].sort((a, b) => b.gapMs - a.gapMs).slice(0, limit),
    },
    measurementNote: 'For attribution, run the same task once through legacy get_project_packet/list_reference_candidates/apply_* tools and once through open_project/get_project_state/list_actions/run_action/list_results before comparing.',
    tools,
    topSlowCalls: [...finishes]
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, limit)
      .map((row) => ({
        tool: row.tool,
        projectId: row.projectId || (row.scope === '_unscoped' ? null : row.scope),
        startedAt: new Date(row.startedMs).toISOString(),
        finishedAt: new Date(row.finishedMs).toISOString(),
        durationMs: row.durationMs,
        resultSize: row.resultSize,
        ok: row.ok,
        errorMessage: row.errorMessage,
      })),
    paidLikeCalls: finishes
      .filter((row) => paidRowLike(row))
      .map((row) => ({
        tool: row.tool,
        projectId: row.projectId || (row.scope === '_unscoped' ? null : row.scope),
        startedAt: new Date(row.startedMs).toISOString(),
        durationMs: row.durationMs,
        ok: row.ok,
        errorMessage: row.errorMessage,
      })),
  };
};

export const captureMirageIssue = (input: {
  projectId?: string | null;
  severity: IssueSeverity;
  summary: string;
  suggestedFix?: string | null;
  recentToolCalls?: unknown;
}) => {
  const issue = {
    kind: 'mirage.issue',
    capturedAt: new Date().toISOString(),
    projectId: input.projectId || null,
    severity: input.severity,
    summary: input.summary,
    suggestedFix: input.suggestedFix || null,
    recentToolCalls: input.recentToolCalls
      ? redactAuditValue(input.recentToolCalls)
      : readAuditTail(input.projectId, 20),
  };
  const issueFile = `${timestampSlug()}-${input.severity}.json`;
  const filePath = path.join(issuesDir(), issueFile);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(issue, null, 2)}\n`);
  const result: Record<string, unknown> = {
    ...issue,
    issueRef: issueFile.replace(/\.json$/, ''),
    note: 'Issue captured for Mirage engine debugging. Server filesystem paths are intentionally not exposed.',
  };
  if (process.env.NODE_ENV !== 'production') {
    result.path = filePath;
  }
  return result;
};

export const captureLahariIssue = captureMirageIssue;
