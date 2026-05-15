import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Google Application Default Credentials bootstrap.
// Railway env vars can't hold a multi-line file, so we accept the service
// account JSON as GOOGLE_APPLICATION_CREDENTIALS_JSON, write it to a temp
// file on boot, and point GOOGLE_APPLICATION_CREDENTIALS at it. The
// @google/genai SDK then auto-picks it up when vertexai: true is set.
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const credsPath = path.join(os.tmpdir(), 'gcp-credentials.json');
  try {
    fs.writeFileSync(credsPath, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON, { mode: 0o600 });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credsPath;
    console.log(`[boot] Vertex creds materialized at ${credsPath}`);
  } catch (err: any) {
    console.error('[boot] Failed to write GCP creds:', err.message);
  }
}
import { projectsRouter } from './routes/projects.js';
import { generateRouter } from './routes/generate.js';
import { queueRouter } from './routes/queue.js';
import { adminRouter } from './routes/admin.js';
import { promptsRouter } from './routes/prompts.js';
import { renderRouter } from './routes/render.js';
import { renderCallbackRouter } from './routes/render-callback.js';
import { directorRouter } from './routes/director.js';
import { mcpTokensRouter } from './routes/mcp-tokens.js';
import { mcpRouter } from './routes/mcp.js';
import { requireAuth } from './middleware/auth.js';
import { startRenderWatchdog } from './render-watchdog.js';
import { startRenderReconciler } from './render-reconciler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();

// Middleware
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:3002', 'http://localhost:3000'];
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use('/mcp', express.json({ limit: process.env.MCP_JSON_LIMIT || '2mb' }), mcpRouter);
app.use('/api/director', express.json({ limit: process.env.DIRECTOR_API_JSON_LIMIT || '5mb' }), requireAuth, directorRouter);
app.use('/api/mcp-tokens', express.json({ limit: process.env.MCP_TOKENS_JSON_LIMIT || '32kb' }), requireAuth, mcpTokensRouter);
app.use(express.json({ limit: '50mb' }));

// Assets are served from Supabase Storage (public URLs).

// Auth middleware on all project/queue/prompt routes
app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/projects', requireAuth, generateRouter);
app.use('/api/projects', requireAuth, renderRouter);
app.use('/api/queue', requireAuth, queueRouter);
app.use('/api/prompts', requireAuth, promptsRouter);
// Admin routes use their own x-admin-secret auth
app.use('/api/admin', adminRouter);
// Renderer callback — auth via x-renderer-secret, not a user JWT
app.use('/api/renders', renderCallbackRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// In production, serve the built frontend
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Lahari Media Engine API`);
  console.log(`  ─────────────────────`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  API:     http://localhost:${PORT}/api`);
  console.log(`  Storage: http://localhost:${PORT}/storage\n`);
});

startRenderWatchdog();
startRenderReconciler();
