/**
 * One-shot admin endpoints for content migration. Protected by ADMIN_UPLOAD_SECRET.
 * Remove this file (and its mount in server/index.ts) after the migration is done.
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { STORAGE_ROOT_PATH } from '../storage.js';
import db from '../db.js';

const upload = multer({
  storage: multer.diskStorage({
    destination: '/tmp',
    filename: (_req, _file, cb) => cb(null, `upload-${Date.now()}.tar.gz`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB cap
});

const router = Router();

const auth = (req: Request, res: Response, next: NextFunction) => {
  const secret = process.env.ADMIN_UPLOAD_SECRET;
  if (!secret) return res.status(503).json({ error: 'Admin endpoints disabled (no ADMIN_UPLOAD_SECRET set)' });
  if (req.header('x-admin-secret') !== secret) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// POST /api/admin/restore — accepts a .tar.gz of storage/ contents and extracts
// over /app/storage. After a successful extract the process exits so Railway
// restarts the service with the new DB + files.
router.post('/restore', auth, upload.single('archive'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Missing archive file' });
  const archivePath = req.file.path;
  const target = STORAGE_ROOT_PATH;
  console.log(`[admin] restore: ${archivePath} (${req.file.size} bytes) -> ${target}`);

  // Extract; --overwrite replaces existing files in place
  const tar = spawn('tar', ['-xzf', archivePath, '-C', target, '--overwrite']);
  let stderr = '';
  tar.stderr.on('data', (d) => { stderr += d.toString(); });
  tar.on('close', (code) => {
    try { fs.unlinkSync(archivePath); } catch {}
    if (code !== 0) {
      console.error(`[admin] tar failed (${code}): ${stderr}`);
      return res.status(500).json({ error: 'Extraction failed', stderr });
    }
    console.log('[admin] extract ok, exiting to force restart with new DB');
    res.json({ ok: true, message: 'Restored. Service is restarting.' });
    // Give the response a tick to flush before exit
    setTimeout(() => process.exit(0), 250);
  });
});

// GET /api/admin/usage?hours=24 — aggregate ai_calls grouped by stage+model,
// including error counts. Lets us answer "why are we hitting Gemini quota"
// without ssh'ing into the container.
router.get('/usage', auth, (req, res) => {
  const hours = Math.min(Math.max(parseInt(String(req.query.hours || '24'), 10) || 24, 1), 168);
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  try {
    const rows = db.prepare(`
      SELECT
        COALESCE(model, 'unknown') as model,
        COALESCE(stage, 'unknown') as stage,
        COUNT(*) as calls,
        SUM(CASE WHEN error IS NULL OR error = '' THEN 0 ELSE 1 END) as errors,
        COALESCE(SUM(cost_estimate), 0) as cost_est,
        COALESCE(SUM(duration_ms), 0) as duration_ms_total
      FROM ai_calls
      WHERE created_at >= ?
      GROUP BY model, stage
      ORDER BY calls DESC
    `).all(sinceIso);
    const totals = db.prepare(`
      SELECT COUNT(*) as calls,
             SUM(CASE WHEN error IS NULL OR error = '' THEN 0 ELSE 1 END) as errors,
             COALESCE(SUM(cost_estimate), 0) as cost_est
      FROM ai_calls WHERE created_at >= ?
    `).get(sinceIso);
    res.json({ sinceIso, hours, totals, breakdown: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/env — report which env vars are populated (truthy),
// never the values. Useful for confirming a migration like Vertex swap.
router.get('/env', auth, (_req, res) => {
  const keys = [
    'GEMINI_API_KEY',
    'ANTHROPIC_API_KEY',
    'FAL_KEY',
    'GCP_PROJECT_ID',
    'GCP_LOCATION',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'CORS_ORIGINS',
    'PUBLIC_URL',
  ];
  const out: Record<string, string | boolean | number> = {};
  for (const k of keys) {
    const v = process.env[k];
    out[k] = !v ? false : k === 'GCP_PROJECT_ID' || k === 'GCP_LOCATION' ? v : `set (${v.length} chars)`;
  }
  // Confirm the creds file got materialized by the boot hook.
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  out.credsFileExists = !!credsPath && fs.existsSync(credsPath);
  if (out.credsFileExists) {
    try { out.credsFileSize = fs.statSync(credsPath!).size; } catch {}
  }
  res.json(out);
});

// GET /api/admin/errors?limit=10 — recent ai_calls error messages, newest
// first. Surfaces why Veo/Gemini/Claude calls are failing without log diving.
router.get('/errors', auth, (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '10'), 10) || 10, 1), 50);
  try {
    const rows = db.prepare(`
      SELECT stage, model, substr(error, 1, 500) as error, created_at
      FROM ai_calls
      WHERE error IS NOT NULL AND error != ''
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/ls — sanity check of what's on the volume
router.get('/ls', auth, (_req, res) => {
  const root = STORAGE_ROOT_PATH;
  try {
    const dirs = fs.readdirSync(root);
    const summary: Record<string, any> = {};
    for (const d of dirs) {
      const full = path.join(root, d);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        const files = fs.readdirSync(full);
        summary[d] = { count: files.length };
      } else {
        summary[d] = { size: stat.size };
      }
    }
    res.json({ root, summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as adminRouter };
