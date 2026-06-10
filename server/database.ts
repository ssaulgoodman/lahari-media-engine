/**
 * Database adapter — replaces better-sqlite3 with Supabase Postgres via REST.
 *
 * Uses the same @supabase/supabase-js client already configured for the
 * queue/song catalog. Table names are mapped through a prefix so the same
 * code can point at the legacy Lahari workspace (`lahari_*`) or a clean
 * platform workspace (`studio_*`).
 *
 * Every function is async — callers must await.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _sb: SupabaseClient | null = null;
const getSB = (): SupabaseClient => {
  if (!_sb) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL + SUPABASE_SERVICE_KEY required');
    _sb = createClient(url, key);
  }
  return _sb;
};

const TABLE_PREFIX = process.env.DB_TABLE_PREFIX || 'lahari';
export const supportsPlatformColumns = (): boolean =>
  TABLE_PREFIX === 'studio' || process.env.DB_INCLUDE_PLATFORM_COLUMNS === '1';
export const usesLegacyQueueAdapter = (): boolean => TABLE_PREFIX !== 'studio';

// Table name mapping — keeps route code clean while DB uses prefixed names.
const T = {
  projects: `${TABLE_PREFIX}_projects`,
  scenes: `${TABLE_PREFIX}_scenes`,
  shots: `${TABLE_PREFIX}_shots`,
  cast_members: `${TABLE_PREFIX}_cast_members`,
  environments: `${TABLE_PREFIX}_environments`,
  assets: `${TABLE_PREFIX}_assets`,
  storyboard_versions: `${TABLE_PREFIX}_storyboard_versions`,
  director_events: `${TABLE_PREFIX}_director_events`,
  agent_operations: `${TABLE_PREFIX}_agent_operations`,
  mcp_audit_events: `${TABLE_PREFIX}_mcp_audit_events`,
  mcp_tokens: `${TABLE_PREFIX}_mcp_tokens`,
  project_config: `${TABLE_PREFIX}_project_config`,
  project_prompt_overrides: `${TABLE_PREFIX}_project_prompt_overrides`,
  tenant_api_keys: `${TABLE_PREFIX}_tenant_api_keys`,
  provider_usage_daily: `${TABLE_PREFIX}_provider_usage_daily`,
  generation_attempts: `${TABLE_PREFIX}_generation_attempts`,
  chat_messages: `${TABLE_PREFIX}_chat_messages`,
  ai_calls: `${TABLE_PREFIX}_ai_calls`,
  renders: `${TABLE_PREFIX}_renders`,
  project_timelines: `${TABLE_PREFIX}_project_timelines`,
  project_timeline_versions: `${TABLE_PREFIX}_project_timeline_versions`,
  personas: `${TABLE_PREFIX}_personas`,
  issues: `${TABLE_PREFIX}_issues`,
} as const;

type TableKey = keyof typeof T;

// ─── Generic helpers ─────────────────────────────────────────────────

/** Select rows. Returns array (possibly empty). */
export const selectAll = async (
  table: TableKey,
  filters: Record<string, any> = {},
  opts?: { orderBy?: string; ascending?: boolean; limit?: number }
): Promise<any[]> => {
  let q = getSB().from(T[table]).select('*');
  for (const [k, v] of Object.entries(filters)) {
    if (Array.isArray(v)) q = q.in(k, v);
    else q = q.eq(k, v);
  }
  if (opts?.orderBy) q = q.order(opts.orderBy, { ascending: opts.ascending ?? true });
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(`DB select ${table}: ${error.message}`);
  return data || [];
};

/** Select a single row by filters. Returns null if not found. */
export const selectOne = async (
  table: TableKey,
  filters: Record<string, any>
): Promise<any | null> => {
  let q = getSB().from(T[table]).select('*');
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw new Error(`DB selectOne ${table}: ${error.message}`);
  return data;
};

/** Insert one row. Returns nothing (fire-and-forget for speed). */
export const insertRow = async (table: TableKey, row: Record<string, any>): Promise<void> => {
  const { error } = await getSB().from(T[table]).insert(row);
  if (error) throw new Error(`DB insert ${table}: ${error.message}`);
};

/** Insert multiple rows. */
export const insertMany = async (table: TableKey, rows: Record<string, any>[]): Promise<void> => {
  if (rows.length === 0) return;
  const { error } = await getSB().from(T[table]).insert(rows);
  if (error) throw new Error(`DB insertMany ${table}: ${error.message}`);
};

/** Update rows matching filters. */
export const updateRows = async (
  table: TableKey,
  filters: Record<string, any>,
  updates: Record<string, any>
): Promise<void> => {
  let q = getSB().from(T[table]).update(updates);
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { error } = await q;
  if (error) throw new Error(`DB update ${table}: ${error.message}`);
};

/** Delete rows matching filters. */
export const deleteRows = async (
  table: TableKey,
  filters: Record<string, any>
): Promise<void> => {
  let q = getSB().from(T[table]).delete();
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { error } = await q;
  if (error) throw new Error(`DB delete ${table}: ${error.message}`);
};

// ─── Aggregate / special queries ─────────────────────────────────────

/** Count rows matching filters. */
export const countRows = async (
  table: TableKey,
  filters: Record<string, any> = {}
): Promise<number> => {
  let q = getSB().from(T[table]).select('*', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { count, error } = await q;
  if (error) throw new Error(`DB count ${table}: ${error.message}`);
  return count || 0;
};

/** Get the max value of a numeric column. */
export const maxVal = async (
  table: TableKey,
  column: string,
  filters: Record<string, any> = {}
): Promise<number> => {
  let q = getSB().from(T[table]).select(column);
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  q = q.order(column, { ascending: false }).limit(1);
  const { data, error } = await q;
  if (error) throw new Error(`DB max ${table}: ${error.message}`);
  return data?.[0]?.[column] ?? 0;
};

/** Find a shot by scene_id and sort_order with optional extra filters. */
export const findShot = async (
  sceneId: string,
  sortOrder: number,
  extraFilters?: Record<string, any>,
  opts?: { lt?: boolean; desc?: boolean }
): Promise<any | null> => {
  let q = getSB().from(T.shots).select('*').eq('scene_id', sceneId);
  if (opts?.lt) {
    q = q.lt('sort_order', sortOrder);
  } else {
    q = q.eq('sort_order', sortOrder);
  }
  if (extraFilters) {
    for (const [k, v] of Object.entries(extraFilters)) q = q.eq(k, v);
  }
  if (opts?.desc) q = q.order('sort_order', { ascending: false });
  q = q.limit(1);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`DB findShot: ${error.message}`);
  return data;
};

/** Raw RPC call for complex queries (ai_calls aggregation, etc). */
export const rpc = async (fnName: string, params: Record<string, any> = {}): Promise<any> => {
  const { data, error } = await getSB().rpc(fnName, params);
  if (error) throw new Error(`DB rpc ${fnName}: ${error.message}`);
  return data;
};

/** Raw RPC call for mutation helpers that should run inside Postgres transactions. */
export const rpcVoid = async (fnName: string, params: Record<string, any> = {}): Promise<void> => {
  const { error } = await getSB().rpc(fnName, params);
  if (error) throw new Error(`DB rpc ${fnName}: ${error.message}`);
};

// ─── Convenience: select with custom column list ─────────────────────

export const selectColumns = async (
  table: TableKey,
  columns: string,
  filters: Record<string, any> = {},
  opts?: { orderBy?: string; ascending?: boolean; limit?: number }
): Promise<any[]> => {
  let q = getSB().from(T[table]).select(columns);
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  if (opts?.orderBy) q = q.order(opts.orderBy, { ascending: opts.ascending ?? true });
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(`DB selectColumns ${table}: ${error.message}`);
  return data || [];
};

/** Increment a numeric column atomically-ish (read + update). */
export const incrementColumn = async (
  table: TableKey,
  filters: Record<string, any>,
  column: string,
  amount: number
): Promise<void> => {
  const row = await selectOne(table, filters);
  if (!row) return;
  const current = row[column] || 0;
  await updateRows(table, filters, { [column]: current + amount });
};

// Re-export table map for code that needs raw Supabase client access
export { T, getSB };
