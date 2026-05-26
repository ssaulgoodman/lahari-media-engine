/**
 * Admin diagnostic endpoints. Protected by ADMIN_UPLOAD_SECRET.
 */
import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import { getSB, T } from '../database.js';
import { listMcpCallTraces } from '../services/mcpCallTraces.js';

const router = Router();

const auth = (req: Request, res: Response, next: NextFunction) => {
  const secret = process.env.ADMIN_UPLOAD_SECRET;
  if (!secret) return res.status(503).json({ error: 'Admin endpoints disabled (no ADMIN_UPLOAD_SECRET set)' });
  if (req.header('x-admin-secret') !== secret) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// GET /api/admin/usage?hours=24 — aggregate ai_calls grouped by stage+model
router.get('/usage', auth, async (req, res) => {
  const hours = Math.min(Math.max(parseInt(String(req.query.hours || '24'), 10) || 24, 1), 168);
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  try {
    const sb = getSB();
    const { data: rows, error } = await sb
      .from(T.ai_calls)
      .select('model, stage, cost_estimate, duration_ms, error, created_at')
      .gte('created_at', sinceIso);
    if (error) throw new Error(error.message);

    const groupMap = new Map<string, { model: string; stage: string; calls: number; errors: number; cost_est: number; duration_ms_total: number }>();
    let totalCalls = 0, totalErrors = 0, totalCost = 0;
    for (const r of (rows || [])) {
      const key = `${r.model || 'unknown'}|${r.stage || 'unknown'}`;
      const g = groupMap.get(key) || { model: r.model || 'unknown', stage: r.stage || 'unknown', calls: 0, errors: 0, cost_est: 0, duration_ms_total: 0 };
      g.calls++;
      if (r.error) g.errors++;
      g.cost_est += r.cost_estimate || 0;
      g.duration_ms_total += r.duration_ms || 0;
      groupMap.set(key, g);
      totalCalls++;
      if (r.error) totalErrors++;
      totalCost += r.cost_estimate || 0;
    }
    const breakdown = [...groupMap.values()].sort((a, b) => b.calls - a.calls);
    res.json({ sinceIso, hours, totals: { calls: totalCalls, errors: totalErrors, cost_est: totalCost }, breakdown });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/env — report which env vars are populated
router.get('/env', auth, (_req, res) => {
  const keys = [
    'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'SEGMIND_API_KEY', 'FAL_KEY',
    'GCP_PROJECT_ID', 'GCP_LOCATION',
    'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    'SUPABASE_URL', 'SUPABASE_SERVICE_KEY',
    'CORS_ORIGINS', 'PUBLIC_URL',
  ];
  const out: Record<string, string | boolean | number> = {};
  for (const k of keys) {
    const v = process.env[k];
    out[k] = !v ? false : k === 'GCP_PROJECT_ID' || k === 'GCP_LOCATION' ? v : `set (${v.length} chars)`;
  }
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  out.credsFileExists = !!credsPath && fs.existsSync(credsPath);
  if (out.credsFileExists) {
    try { out.credsFileSize = fs.statSync(credsPath!).size; } catch {}
  }
  res.json(out);
});

// GET /api/admin/errors?limit=10 — recent error messages
router.get('/errors', auth, async (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '10'), 10) || 10, 1), 50);
  try {
    const { data, error } = await getSB()
      .from(T.ai_calls)
      .select('stage, model, error, created_at')
      .not('error', 'is', null)
      .neq('error', '')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/active-renders — pre-deploy safety check. Returns the count
// and list of rows currently active. Use this before a Modal redeploy:
// any in-flight render gets SIGKILL'd when the container is replaced, so
// confirm count=0 before pushing.
router.get('/active-renders', auth, async (_req, res) => {
  try {
    const { data, error } = await getSB()
      .from(T.renders)
      .select('id, project_id, status, progress, stage, render_engine, ffmpeg_fallback_reason, last_heartbeat_at, modal_function_call_id, created_at, updated_at')
      .in('status', ['rendering', 'pending_finalize'])
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);

    const rows = (data || []).map((r: any) => {
      const ageMin = Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000);
      return {
        id: r.id,
        project_id: r.project_id,
        status: r.status,
        progress: r.progress === null || r.progress === undefined ? null : Number(r.progress),
        stage: r.stage || null,
        render_engine: r.render_engine || null,
        ffmpeg_fallback_reason: r.ffmpeg_fallback_reason || null,
        last_heartbeat_at: r.last_heartbeat_at || null,
        modal_function_call_id: r.modal_function_call_id || null,
        updated_at: r.updated_at,
        created_at: r.created_at,
        age_minutes: ageMin,
      };
    });

    res.json({
      count: rows.length,
      safe_to_redeploy: rows.length === 0,
      rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/mcp-traces?projectId=...&hours=24&limit=100
// Shows every remote MCP / Director API call, including read-only calls.
// The gap_since_previous_ms field is the important one: large gaps mean the
// delay happened in the agent/harness between Lahari calls, not inside Lahari.
router.get('/mcp-traces', auth, async (req, res) => {
  try {
    const rows = await listMcpCallTraces({
      projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
      userId: typeof req.query.userId === 'string' ? req.query.userId : undefined,
      tokenId: typeof req.query.tokenId === 'string' ? req.query.tokenId : undefined,
      hours: Number(req.query.hours || 24),
      limit: Number(req.query.limit || 100),
    });
    const totals = rows.reduce((acc, row: any) => {
      acc.calls += 1;
      acc.duration_ms += row.duration_ms || 0;
      acc.request_bytes += row.request_bytes || 0;
      acc.response_bytes += row.response_bytes || 0;
      if (row.status === 'error') acc.errors += 1;
      if (row.paid) acc.paid_calls += 1;
      if (row.gap_since_previous_ms !== null) acc.gap_ms += row.gap_since_previous_ms || 0;
      return acc;
    }, { calls: 0, errors: 0, paid_calls: 0, duration_ms: 0, gap_ms: 0, request_bytes: 0, response_bytes: 0 });
    res.json({ totals, rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Migration endpoint removed — was POST /migrate-to-supabase, used once on
// 2026-04-16. Depended on better-sqlite3. Migration is complete.

export { router as adminRouter };
