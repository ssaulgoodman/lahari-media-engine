/**
 * Music Video Queue routes — reads from Supabase, connects to Lahari projects.
 */
import { Router } from 'express';
import { listQueue, updateQueueItem, getSongFiles, getDeities, downloadFile } from '../services/supabase.js';
import { saveBuffer } from '../storage.js';
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import { getFullProject } from './projects.js';

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
      VALUES (?, ?, 'uploaded', ?, ?)
    `).run(projectId, item.song_name || 'Untitled', audioPath, lyrics || null);

    // Link back to queue
    await updateQueueItem(queueId, {
      status: 'in_progress',
      lahari_project_id: projectId,
    });

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

export { router as queueRouter };
