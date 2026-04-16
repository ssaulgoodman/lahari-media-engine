/**
 * Music Video Queue routes — reads from Supabase, connects to Lahari projects.
 */
import { Router } from 'express';
import multer from 'multer';
import { listQueue, updateQueueItem, getSongFiles, getDeities, downloadFile, findQueueByProjectIds } from '../services/supabase.js';
import { saveBuffer, readAsBase64, mimeFromExt, storageUrl } from '../storage.js';
import { detectStructure } from '../services/gemini.js';
import { summarizeMeaning } from '../services/claude.js';
import { logCall } from '../xray.js';
import { selectOne, insertRow, updateRows } from '../database.js';
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
      const project = await getFullProject(item.lahari_project_id);
      if (project) return res.json({ project, queueItem: item });
    }

    // Get audio URL — prefer Supabase Storage, fall back to Google Drive
    const audioUrl = (item as any).audio_url;
    if (!audioUrl) return res.status(400).json({ error: 'No audio file available for this song. Upload audio first.' });

    // Download audio
    const audioBuffer = await downloadFile(audioUrl);
    const ext = audioUrl.includes('.wav') ? 'wav' : audioUrl.includes('.m4a') ? 'm4a' : 'wav';
    const audioPath = await saveBuffer(audioBuffer, 'audio', ext);

    // Get SRT for lyrics
    const files = await getSongFiles(item.song_id);
    const srtFile = files.find(f => f.file_type === 'srt_verified_san')
      || files.find(f => f.file_type.startsWith('srt_verified_'))
      || files.find(f => f.file_type === 'srt_turbo_scribe');

    let lyrics = '';
    if (srtFile) {
      try {
        const srtBuffer = await downloadFile(srtFile.storage_url);
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
    await insertRow('projects', {
      id: projectId,
      title: item.song_name || 'Untitled',
      status: 'analyzing',
      audio_path: audioPath,
      lyrics: lyrics || null,
    });

    // Link back to queue immediately (don't wait for analysis)
    await updateQueueItem(queueId, {
      status: 'in_progress',
      lahari_project_id: projectId,
    });

    // Run audio analysis: musical structure (Gemini) + meaning (Claude).
    const audioRef = [{ type: 'audio' as const, label: 'Queued audio', url: storageUrl(audioPath) }];
    try {
      const audioBase64 = await readAsBase64(audioPath);
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

      await logCall({
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
        await logCall({
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

      await updateRows('projects', { id: projectId }, {
        status: 'analyzed',
        musical_structure: JSON.stringify(musicalStructure),
        meaning,
        updated_at: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error(`[queue ${projectId}] analysis failed:`, err);
      await updateRows('projects', { id: projectId }, {
        status: 'analyzed',
        updated_at: new Date().toISOString(),
      });
    }

    const project = await getFullProject(projectId);
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
 * Supabase Storage, finds the originating queue row via fork-lineage walk,
 * and updates it with status='completed' + video_url.
 */
router.post('/publish/:projectId', upload.single('video'), async (req, res) => {
  const rawId = req.params.projectId;
  const projectId: string = Array.isArray(rawId) ? rawId[0] : rawId;
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!req.file) return res.status(400).json({ error: 'Video file required (multipart field: video)' });

  try {
    const videoPath = await saveBuffer(req.file.buffer, 'videos', 'mp4');
    const videoUrl = storageUrl(videoPath);

    const assetId = uuidv4();
    await insertRow('assets', { id: assetId, project_id: projectId, category: 'final_render', file_path: videoPath });

    // Walk up the fork chain so we can find whichever queue row started this project tree.
    const chain: string[] = [projectId];
    let cur = projectId;
    while (true) {
      const row = await selectOne('projects', { id: cur });
      if (!row?.parent_project_id) break;
      chain.push(row.parent_project_id);
      cur = row.parent_project_id;
    }

    const queueRow = await findQueueByProjectIds(chain);
    if (queueRow) {
      await updateQueueItem(queueRow.id, {
        status: 'completed',
        video_url: videoUrl,
        lahari_project_id: projectId,
      });
    }

    await updateRows('projects', { id: projectId }, {
      status: 'completed',
      updated_at: new Date().toISOString(),
    });

    res.json({
      videoUrl,
      videoPath,
      queueRowUpdated: !!queueRow,
      queueRowId: queueRow?.id || null,
      project: await getFullProject(projectId),
    });
  } catch (err: any) {
    console.error(`[queue/publish ${projectId}] failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

export { router as queueRouter };
