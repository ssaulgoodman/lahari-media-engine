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
