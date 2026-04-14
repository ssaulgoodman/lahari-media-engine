/**
 * Music Video Queue routes — reads from Supabase, connects to Lahari projects.
 */
import { Router } from 'express';
import { listQueue, updateQueueItem, getSongFiles, getDeities, downloadFile } from '../services/supabase.js';
import { saveBuffer, readAsBase64, mimeFromExt } from '../storage.js';
import { detectStructure } from '../services/gemini.js';
import { summarizeMeaning } from '../services/claude.js';
import { logCall } from '../xray.js';
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

export { router as queueRouter };
