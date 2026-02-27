import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { projectsRouter } from './routes/projects.js';
import { generateRouter } from './routes/generate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve stored assets (images, videos, audio)
app.use('/storage', express.static(path.join(__dirname, '..', 'storage')));

// API Routes
app.use('/api/projects', projectsRouter);
app.use('/api/projects', generateRouter);

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
