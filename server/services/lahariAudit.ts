import fs from 'fs';
import path from 'path';

type AuditPhase = 'start' | 'finish';
type IssueSeverity = 'low' | 'mid' | 'high';

const MAX_STRING = 500;
const MAX_ARRAY = 25;
const MAX_KEYS = 40;

const dayStamp = (date = new Date()) => date.toISOString().slice(0, 10);

const timestampSlug = () => new Date().toISOString().replace(/[:.]/g, '-');

const auditBaseDir = () => path.join(process.cwd(), '.lahari', 'audit');
const issuesDir = () => path.join(process.cwd(), '.lahari', 'issues');

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
      out[key] = redactKey(key) ? '[redacted]' : redactAuditValue(inner, depth + 1);
    }
    const extra = Object.keys(value as Record<string, unknown>).length - entries.length;
    if (extra > 0) out.__truncatedKeys = extra;
    return out;
  }
  return String(value);
};

const projectIdFromPath = (value: string) => {
  const normalized = value.replace(/\\/g, '/');
  return normalized.match(/\.lahari\/previews\/([^/]+)/)?.[1]
    || normalized.match(/\.lahari\/sessions\/([^/]+)/)?.[1]
    || normalized.match(/\.lahari\/projects\/([^/]+)/)?.[1]
    || null;
};

export const deriveAuditProjectId = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.projectId === 'string' && input.projectId.trim()) return input.projectId.trim();
  if (typeof input.previewJsonPath === 'string') return projectIdFromPath(input.previewJsonPath);
  if (typeof input.project_id === 'string' && input.project_id.trim()) return input.project_id.trim();
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

export const recordMcpAudit = (entry: {
  phase: AuditPhase;
  tool: string;
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
    source: 'mcp',
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

export const captureLahariIssue = (input: {
  projectId?: string | null;
  severity: IssueSeverity;
  summary: string;
  suggestedFix?: string | null;
  recentToolCalls?: unknown;
}) => {
  const issue = {
    kind: 'lahari.issue',
    capturedAt: new Date().toISOString(),
    projectId: input.projectId || null,
    severity: input.severity,
    summary: input.summary,
    suggestedFix: input.suggestedFix || null,
    recentToolCalls: input.recentToolCalls
      ? redactAuditValue(input.recentToolCalls)
      : readAuditTail(input.projectId, 20),
  };
  const filePath = path.join(issuesDir(), `${timestampSlug()}-${input.severity}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(issue, null, 2)}\n`);
  return {
    ...issue,
    path: filePath,
    note: 'Local issue capture only. Read this from an engine session to debug director-session friction.',
  };
};
