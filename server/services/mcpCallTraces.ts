import { getSB, T } from '../database.js';

type TraceSource = 'mcp-remote' | 'director-api';
type TraceInput = {
  source: TraceSource;
  userId?: string | null;
  tokenId?: string | null;
  tool: string;
  args?: unknown;
  result?: unknown;
  error?: unknown;
  startedAt: string;
  durationMs: number;
  readOnly?: boolean;
  paid?: boolean;
};

const MAX_ERROR = 500;

const byteSize = (value: unknown): number => {
  if (value == null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Buffer.byteLength(String(value), 'utf8');
  }
};

const parseTextResult = (value: unknown): unknown => {
  const content = (value as any)?.content;
  const text = Array.isArray(content) && typeof content[0]?.text === 'string' ? content[0].text : null;
  if (!text) return value;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const projectIdFrom = (value: unknown): string | null => {
  const parsed = parseTextResult(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, any>;
  if (typeof obj.projectId === 'string' && obj.projectId.trim()) return obj.projectId.trim();
  if (obj.project && typeof obj.project.id === 'string' && obj.project.id.trim()) return obj.project.id.trim();
  if (obj.params && typeof obj.params.projectId === 'string' && obj.params.projectId.trim()) return obj.params.projectId.trim();
  if (obj.body && typeof obj.body.projectId === 'string' && obj.body.projectId.trim()) return obj.body.projectId.trim();
  return null;
};

const resultKindFrom = (value: unknown): string | null => {
  const parsed = parseTextResult(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return typeof parsed === 'string' ? 'text' : null;
  const obj = parsed as Record<string, any>;
  if (typeof obj.kind === 'string') return obj.kind;
  if (typeof obj.status === 'string') return `status:${obj.status}`;
  if (Array.isArray(obj.files)) return 'notebook_files';
  if (Array.isArray(obj.projects)) return 'project_list';
  if (Array.isArray(obj.results)) return 'results';
  return null;
};

const errorInfo = (error: unknown): { code: string | null; message: string | null } => {
  const raw = error instanceof Error ? error.message : error ? String(error) : '';
  if (!raw) return { code: null, message: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        code: typeof parsed.code === 'string' ? parsed.code : typeof parsed.error === 'string' ? parsed.error : null,
        message: typeof parsed.message === 'string' ? parsed.message.slice(0, MAX_ERROR) : raw.slice(0, MAX_ERROR),
      };
    }
  } catch {
    // Plain error string.
  }
  return { code: null, message: raw.slice(0, MAX_ERROR) };
};

const argsMetadata = (args: unknown) => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const obj = args as Record<string, any>;
  const body = obj.body && typeof obj.body === 'object' ? obj.body : null;
  const source = body || obj;
  return {
    argKeys: Object.keys(source).slice(0, 30),
    shotId: typeof source.shotId === 'string' ? source.shotId : undefined,
    sceneId: typeof source.sceneId === 'string' ? source.sceneId : undefined,
    notebookFilePath: typeof source.path === 'string' ? source.path : typeof source.filePath === 'string' ? source.filePath : undefined,
  };
};

const isMissingTraceTableError = (error: any) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42P01'
    || code === 'PGRST205'
    || message.includes('lahari_mcp_call_traces')
    || message.includes('mcp_call_traces');
};

export const recordMcpCallTrace = async (input: TraceInput) => {
  const finishedAt = new Date().toISOString();
  const err = input.error ? errorInfo(input.error) : { code: null, message: null };
  const projectId = projectIdFrom(input.args) || projectIdFrom(input.result);
  try {
    const { error } = await getSB().from(T.mcp_call_traces).insert({
      source: input.source,
      user_id: input.userId || null,
      token_id: input.tokenId || null,
      project_id: projectId,
      tool: input.tool,
      status: input.error ? 'error' : 'success',
      read_only: !!input.readOnly,
      paid: !!input.paid,
      started_at: input.startedAt,
      finished_at: finishedAt,
      duration_ms: Math.max(0, Math.round(input.durationMs || 0)),
      request_bytes: byteSize(input.args),
      response_bytes: input.error ? 0 : byteSize(input.result),
      error_code: err.code,
      error_message: err.message,
      result_kind: input.error ? null : resultKindFrom(input.result),
      metadata: argsMetadata(input.args),
    });
    if (error) throw error;
  } catch (error: any) {
    if (!isMissingTraceTableError(error)) {
      console.warn(`[mcp-trace] failed for ${input.tool}: ${error?.message || error}`);
    }
  }
};

export const listMcpCallTraces = async (opts: {
  projectId?: string;
  userId?: string;
  tokenId?: string;
  hours?: number;
  limit?: number;
} = {}) => {
  const hours = Math.min(Math.max(Number(opts.hours || 24) || 24, 1), 168);
  const limit = Math.min(Math.max(Number(opts.limit || 100) || 100, 1), 500);
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  let query = getSB()
    .from(T.mcp_call_traces)
    .select('id,source,user_id,token_id,project_id,tool,status,read_only,paid,started_at,finished_at,duration_ms,request_bytes,response_bytes,error_code,error_message,result_kind,metadata')
    .gte('started_at', sinceIso)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (opts.projectId) query = query.eq('project_id', opts.projectId);
  if (opts.userId) query = query.eq('user_id', opts.userId);
  if (opts.tokenId) query = query.eq('token_id', opts.tokenId);
  const { data, error } = await query;
  if (error) throw new Error(`DB select mcp traces: ${error.message}`);
  const rows = [...(data || [])].reverse();
  let prevFinishedAt: number | null = null;
  return rows.map((row: any) => {
    const started = new Date(row.started_at).getTime();
    const gapMs = prevFinishedAt === null ? null : Math.max(0, started - prevFinishedAt);
    prevFinishedAt = new Date(row.finished_at).getTime();
    return {
      ...row,
      gap_since_previous_ms: gapMs,
    };
  });
};
