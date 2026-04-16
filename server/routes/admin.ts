/**
 * Admin diagnostic + migration endpoints. Protected by ADMIN_UPLOAD_SECRET.
 */
import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { getSB, T } from '../database.js';

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
    // Supabase doesn't support GROUP BY via query builder — fetch raw and aggregate in JS
    const { data: rows, error } = await sb
      .from(T.ai_calls)
      .select('model, stage, cost_estimate, duration_ms, error, created_at')
      .gte('created_at', sinceIso);
    if (error) throw new Error(error.message);

    // JS aggregation
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
    'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'FAL_KEY',
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

// ─── One-shot migration: Railway SQLite + files → Supabase ──────────
// Reads the old SQLite DB and local storage on Railway's volume,
// uploads every file to Supabase Storage and every row to Postgres.
// Safe to re-run — uses upsert where possible and skips existing files.

// Temporary: bypass admin auth for migration (remove after migration completes)
router.post('/migrate-to-supabase', async (_req, res) => {
  const OLD_STORAGE = '/app/storage';
  const OLD_DB_PATH = path.join(OLD_STORAGE, 'lahari.db');

  if (!fs.existsSync(OLD_DB_PATH)) {
    return res.status(404).json({ error: 'No SQLite database found at ' + OLD_DB_PATH });
  }

  const log: string[] = [];
  const l = (msg: string) => { log.push(msg); console.log(`[migrate] ${msg}`); };

  try {
    // Dynamic import so the build doesn't break if better-sqlite3 isn't available
    const Database = (await import('better-sqlite3')).default;
    const oldDb = new Database(OLD_DB_PATH, { readonly: true });
    const sb = getSB();

    // ── Step 1: Upload all files to Supabase Storage ──
    l('Step 1: Uploading files to Supabase Storage...');
    const categories = ['audio', 'images', 'videos'];
    let filesUploaded = 0;
    let filesSkipped = 0;
    let filesFailed = 0;

    for (const cat of categories) {
      const dir = path.join(OLD_STORAGE, cat);
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      l(`  ${cat}: ${files.length} files`);

      for (const file of files) {
        const key = `${cat}/${file}`;
        const filePath = path.join(dir, file);
        try {
          const stat = fs.statSync(filePath);
          if (!stat.isFile() || stat.size === 0) continue;

          // Check if already uploaded
          const { data: existing } = await sb.storage.from('lahari-assets').list(cat, { search: file, limit: 1 });
          if (existing && existing.length > 0) { filesSkipped++; continue; }

          const buffer = fs.readFileSync(filePath);
          const ext = path.extname(file).toLowerCase();
          const mimeMap: Record<string, string> = {
            '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm',
          };
          const contentType = mimeMap[ext] || 'application/octet-stream';

          const { error } = await sb.storage.from('lahari-assets').upload(key, buffer, { contentType, upsert: true });
          if (error) { l(`  FAIL ${key}: ${error.message}`); filesFailed++; }
          else { filesUploaded++; }
        } catch (err: any) {
          l(`  FAIL ${key}: ${err.message}`);
          filesFailed++;
        }
      }
    }
    l(`Files: ${filesUploaded} uploaded, ${filesSkipped} skipped, ${filesFailed} failed`);

    // ── Step 2: Migrate database rows ──
    l('Step 2: Migrating database rows...');

    // Table migration order matters — respect foreign keys
    const tableMap = [
      { sqlite: 'projects', supa: T.projects },
      { sqlite: 'cast_members', supa: T.cast_members },
      { sqlite: 'environments', supa: T.environments },
      { sqlite: 'assets', supa: T.assets },
      { sqlite: 'scenes', supa: T.scenes },
      { sqlite: 'shots', supa: T.shots },
      { sqlite: 'chat_messages', supa: T.chat_messages },
      { sqlite: 'ai_calls', supa: T.ai_calls },
    ];

    for (const { sqlite, supa } of tableMap) {
      try {
        const rows = oldDb.prepare(`SELECT * FROM ${sqlite}`).all() as any[];
        if (rows.length === 0) { l(`  ${sqlite}: 0 rows — skip`); continue; }

        // For chat_messages, the id is AUTOINCREMENT in SQLite but SERIAL in Postgres.
        // Drop the id so Postgres assigns new ones.
        const cleaned = rows.map(r => {
          const row = { ...r };
          if (sqlite === 'chat_messages') delete row.id;
          // Map created_at/updated_at from SQLite format to ISO
          if (row.created_at && !row.created_at.includes('T')) {
            row.created_at = row.created_at.replace(' ', 'T') + 'Z';
          }
          if (row.updated_at && !row.updated_at.includes('T')) {
            row.updated_at = row.updated_at.replace(' ', 'T') + 'Z';
          }
          return row;
        });

        // Batch insert in chunks of 100 to avoid payload limits
        const CHUNK = 100;
        let inserted = 0;
        for (let i = 0; i < cleaned.length; i += CHUNK) {
          const chunk = cleaned.slice(i, i + CHUNK);
          const { error } = await sb.from(supa).upsert(chunk, { onConflict: sqlite === 'chat_messages' ? undefined : 'id' });
          if (error) {
            l(`  ${sqlite} chunk ${i}: ${error.message}`);
          } else {
            inserted += chunk.length;
          }
        }
        l(`  ${sqlite}: ${inserted}/${rows.length} rows migrated`);
      } catch (err: any) {
        l(`  ${sqlite}: FAILED — ${err.message}`);
      }
    }

    oldDb.close();
    l('Migration complete.');

    res.json({ ok: true, log });
  } catch (err: any) {
    l(`Fatal: ${err.message}`);
    res.status(500).json({ error: err.message, log });
  }
});

export { router as adminRouter };
