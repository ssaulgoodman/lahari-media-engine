/**
 * Music Video Queue routes — reads from Supabase, connects to Lahari projects.
 */
import { Router } from 'express';
import multer from 'multer';
import { listQueue, updateQueueItem, getSongFiles, getDeities, downloadFile, findQueueByProjectIds } from '../services/supabase.js';
import { saveBuffer, readAsBase64, mimeFromExt } from '../storage.js';
import { detectStructure } from '../services/gemini.js';
import { summarizeMeaning } from '../services/claude.js';
import { logCall } from '../xray.js';
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import { getFullProject } from './projects.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

const router = Router();

// List queue with optional filters
router.get('/', async (_req, res) => {
  try {
    const { status, deity, search } = _req.query as any;
    const items = await listQueue({ status, deity, search });
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get available deity filters
router.get('/deities', async (_req, res) => {
  try {
    const deities = await getDeities();
    res.json(deities);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Start production — pull audio from Supabase, create Lahari project
router.post('/:queueId/start', async (req, res) => {
  try {
    const queueId = req.params.queueId;

    // Get queue item
    const items = await listQueue();
    const item = items.find(i => i.id === queueId);
    if (!item) return res.status(404).json({ error: 'Queue item not found' });
    if (item.lahari_project_id) {
      // Already started — return existing project
      const project = getFullProject(item.lahari_project_id);
      if (project) return res.json({ project, queueItem: item });
    }

    // Get audio URL — prefer Supabase Storage, fall back to Google Drive
    const audioUrl = (item as any).audio_url;
    if (!audioUrl) return res.status(400).json({ error: 'No audio file available for this song. Upload audio first.' });

    // Download audio
    const audioBuffer = await downloadFile(audioUrl);
    const ext = audioUrl.includes('.wav') ? 'wav' : audioUrl.includes('.m4a') ? 'm4a' : 'wav';
    const audioPath = saveBuffer(audioBuffer, 'audio', ext);

    // Get SRT for lyrics
    const files = await getSongFiles(item.song_id);
    const srtFile = files.find(f => f.file_type === 'srt_verified_san')
      || files.find(f => f.file_type.startsWith('srt_verified_'))
      || files.find(f => f.file_type === 'srt_turbo_scribe');

    let lyrics = '';
    if (srtFile) {
      try {
        const srtBuffer = await downloadFile(srtFile.storage_url);
        // Parse SRT to plain text (strip timestamps and numbers)
        const srtText = srtBuffer.toString('utf-8');
        lyrics = srtText
          .split('\n')
          .filter(line => line.trim() && !/^\d+$/.test(line.trim()) && !/-->/.test(line))
          .join('\n')
          .trim();
      } catch (e) {
        console.warn(`[queue] Failed to download SRT for ${item.song_name}:`, e);
      }
    }

    // Create Lahari project
    const projectId = uuidv4();
    db.prepare(`
      INSERT INTO projects (id, title, status, audio_path, lyrics)
      VALUES (?, ?, 'analyzing', ?, ?)
    `).run(projectId, item.song_name || 'Untitled', audioPath, lyrics || null);

    // Link back to queue immediately (don't wait for analysis)
    await updateQueueItem(queueId, {
      status: 'in_progress',
      lahari_project_id: projectId,
    });

    // Run audio analysis: musical structure (Gemini) + meaning (Claude).
    // Lyrics come from SRT so no transcription needed.
    const audioRef = [{ type: 'audio' as const, label: 'Queued audio', url: `/storage/${audioPath}` }];
    try {
      const audioBase64 = readAsBase64(audioPath);
      const audioMime = mimeFromExt(audioPath);

      const t0 = Date.now();
      const [structureResult, meaningResult] = await Promise.allSettled([
        detectStructure(audioBase64, audioMime),
        lyrics ? summarizeMeaning(item.song_name || 'Untitled', 'Unknown', lyrics, '') : Promise.resolve(''),
      ]);
      const analysisMs = Date.now() - t0;

      const musicalStructure = structureResult.status === 'fulfilled' ? structureResult.value : [];
      const meaning = meaningResult.status === 'fulfilled' ? meaningResult.value : '';

      if (structureResult.status === 'rejected') console.warn(`[queue ${projectId}] structure failed:`, structureResult.reason);
      if (meaningResult.status === 'rejected') console.warn(`[queue ${projectId}] meaning failed:`, meaningResult.reason);

      logCall({
        projectId,
        stage: 'detect-structure',
        model: 'gemini-3-pro-preview',
        prompt: 'Identify musical sections: label, startTime, endTime, energy level, description. Max 10 sections.',
        referenceInputs: audioRef,
        responseSummary: structureResult.status === 'fulfilled'
          ? musicalStructure.map((s: any) => `${s.label} [${s.startTime}–${s.endTime}]`).join('\n')
          : 'FAILED',
        durationMs: analysisMs,
        costEstimate: 0.01,
        error: structureResult.status === 'rejected' ? String(structureResult.reason) : undefined,
      });

      if (lyrics) {
        logCall({
          projectId,
          stage: 'summarize-meaning',
          model: 'claude-sonnet-4-6',
          prompt: `Summarize the meaning of "${item.song_name}": what it's about, who it addresses, emotional arc, cultural context.`,
          responseSummary: meaning || 'FAILED',
          durationMs: analysisMs,
          costEstimate: 0.005,
          error: meaningResult.status === 'rejected' ? String(meaningResult.reason) : undefined,
        });
      }

      db.prepare(`UPDATE projects SET status = 'analyzed', musical_structure = ?, meaning = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(JSON.stringify(musicalStructure), meaning, projectId);
    } catch (err: any) {
      console.error(`[queue ${projectId}] analysis failed:`, err);
      // Don't fail the whole request — project is still usable, user can regenerate concepts manually.
      db.prepare(`UPDATE projects SET status = 'analyzed', updated_at = datetime('now') WHERE id = ?`).run(projectId);
    }

    const project = getFullProject(projectId);
    res.json({ project, queueItem: { ...item, status: 'in_progress', lahari_project_id: projectId } });
  } catch (err: any) {
    console.error('[queue] Start production failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update queue item (status, notes, etc.)
router.patch('/:queueId', async (req, res) => {
  try {
    const { status, notes, assigned_to, video_url } = req.body;
    await updateQueueItem(req.params.queueId, { status, notes, assigned_to, video_url });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Publish a completed render — uploads the final video, saves it to
 * /storage/videos, finds the originating queue row via fork-lineage walk,
 * and updates it with status='completed' + video_url.
 *
 * Latest-completed-wins: the queue row flips lahari_project_id to point
 * at whichever fork was most recently published.
 */
router.post('/publish/:projectId', upload.single('video'), async (req, res) => {
  const rawId = req.params.projectId;
  const projectId: string = Array.isArray(rawId) ? rawId[0] : rawId;
  const project: any = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!req.file) return res.status(400).json({ error: 'Video file required (multipart field: video)' });

  try {
    // Save final to /storage/videos for a durable URL.
    const videoPath = saveBuffer(req.file.buffer, 'videos', 'mp4');
    const publicBase = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3003}`;
    const videoUrl = `${publicBase}/storage/${videoPath}`;

    // Register the asset locally so we can find it later.
    const assetId = uuidv4();
    db.prepare(`INSERT INTO assets (id, project_id, category, file_path) VALUES (?, ?, 'final_render', ?)`).run(assetId, projectId, videoPath);

    // Walk up the fork chain so we can find whichever queue row started this project tree.
    const chain: string[] = [projectId];
    let cur = projectId;
    while (true) {
      const row: any = db.prepare('SELECT parent_project_id FROM projects WHERE id = ?').get(cur);
      if (!row?.parent_project_id) break;
      chain.push(row.parent_project_id);
      cur = row.parent_project_id;
    }

    const queueRow = await findQueueByProjectIds(chain);
    if (queueRow) {
      await updateQueueItem(queueRow.id, {
        status: 'completed',
        video_url: videoUrl,
        // Latest-completed wins: point the queue at the actual finished fork.
        lahari_project_id: projectId,
      });
    }

    // Mark the Lahari project itself as completed so the Dashboard pipeline
    // pill can reflect it independently of the queue.
    db.prepare(`UPDATE projects SET status = 'completed', updated_at = datetime('now') WHERE id = ?`).run(projectId);

    res.json({
      videoUrl,
      videoPath,
      queueRowUpdated: !!queueRow,
      queueRowId: queueRow?.id || null,
      project: getFullProject(projectId),
    });
  } catch (err: any) {
    console.error(`[queue/publish ${projectId}] failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

export { router as queueRouter };
