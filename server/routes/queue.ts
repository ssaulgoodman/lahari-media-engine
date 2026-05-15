/**
 * Music Video Queue routes — reads from Supabase, connects to Lahari projects.
 */
import { Router } from 'express';
import multer from 'multer';
import { listQueue, updateQueueItem, getSongFiles, getDeities, downloadFile, findQueueByProjectIds } from '../services/supabase.js';
import { saveBuffer, readAsBase64, mimeFromExt, storageUrl } from '../storage.js';
import { transcribeLyrics, detectStructure } from '../services/gemini.js';
import { summarizeMeaning } from '../services/claude.js';
import { logCall } from '../xray.js';
import { selectOne, insertRow, updateRows, getSB, T, supportsPlatformColumns } from '../database.js';
import { v4 as uuidv4 } from 'uuid';
import { getFullProject } from './projects.js';
import { recordDirectorEvent } from '../services/directorEvents.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

/** Convert SRT subtitle format to timestamped lyrics matching Gemini's [M:SS] format */
function parseSrtToTimestamped(srt: string): string {
  const blocks = srt.trim().split(/\n\s*\n/);
  const lines: string[] = [];
  for (const block of blocks) {
    const parts = block.trim().split('\n');
    if (parts.length < 2) continue;
    // Find the timestamp line (contains "-->")
    const tsLine = parts.find(l => l.includes('-->'));
    if (!tsLine) continue;
    // Parse start time: "00:01:23,456 --> ..."
    const match = tsLine.match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (!match) continue;
    const hours = parseInt(match[1]);
    const mins = parseInt(match[2]);
    const secs = parseInt(match[3]);
    const totalMins = hours * 60 + mins;
    const timestamp = `[${totalMins}:${secs.toString().padStart(2, '0')}]`;
    // Text lines are everything after the timestamp line
    const tsIdx = parts.indexOf(tsLine);
    const text = parts.slice(tsIdx + 1).filter(l => l.trim()).join(' ');
    if (text) lines.push(`${timestamp} ${text}`);
  }
  return lines.join('\n');
}

const router = Router();

// List queue with optional filters
router.get('/', async (req, res) => {
  try {
    const { status, deity, search } = req.query as any;
    const items = await listQueue({ status, deity, search, currentUserId: req.userId });
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Per-user, per-song mnemonic note. Empty/whitespace → DELETE the row so
// the dashboard re-shows the bare song name. Non-empty → UPSERT. 200-char
// cap matches the table CHECK constraint; we return 400 rather than letting
// Postgres reject it so the frontend gets a clean message.
router.put('/notes/:songId', async (req, res) => {
  const songId = req.params.songId;
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Auth required' });
  if (!songId) return res.status(400).json({ error: 'songId required' });

  const raw = String(req.body?.note ?? '');
  const trimmed = raw.trim();

  if (trimmed && trimmed.length > 200) {
    return res.status(400).json({ error: 'Note must be 200 characters or fewer' });
  }

  try {
    const sb = getSB();
    if (!trimmed) {
      await sb.from('lahari_song_notes')
        .delete()
        .eq('user_id', userId)
        .eq('song_id', songId);
      return res.json({ note: null });
    }
    const { error } = await sb.from('lahari_song_notes')
      .upsert({
        user_id: userId,
        song_id: songId,
        note: trimmed,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,song_id' });
    if (error) throw new Error(error.message);
    res.json({ note: trimmed });
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

// Start production — pull audio from Supabase, create Lahari project.
// Multi-user: each user gets their own project for the same queued song.
// Analysis is cached on the songs table to avoid duplicate AI calls.
router.post('/:queueId/start', async (req, res) => {
  try {
    const queueId = req.params.queueId;

    // Get queue item
    const items = await listQueue();
    const item = items.find(i => i.id === queueId);
    if (!item) return res.status(404).json({ error: 'Queue item not found' });

    // Check if THIS user already has a project for this queue item.
    // Prefer non-completed projects so the action button's promise matches:
    // "Continue" on the dashboard should hit the active fork, not the
    // archived completed one if both exist for this user.
    const { data: existingProjects } = await getSB()
      .from(T.projects)
      .select('id, status')
      .eq('source_queue_id', queueId)
      .eq('user_id', req.userId);
    if (existingProjects?.length) {
      const active = existingProjects.find((p: any) => p.status !== 'completed');
      const pick = active || existingProjects[0];
      const project = await getFullProject(pick.id);
      if (project) return res.json({ project, queueItem: item });
    }

    // Also check the legacy link (projects created before source_queue_id existed)
    // — only honour it if it's YOUR project. If another user's project sits in
    // lahari_project_id we deliberately ignore it and fall through to create a
    // fresh project for this user. Forking from someone else mid-queue is
    // unclear when multiple artists are working in parallel — defer that path
    // until we have an explicit "fork from X" affordance.
    if (item.lahari_project_id) {
      const existing = await selectOne('projects', { id: item.lahari_project_id });
      if (existing && existing.user_id === req.userId) {
        const project = await getFullProject(item.lahari_project_id);
        if (project) return res.json({ project, queueItem: item });
      }
    }

    // Get audio URL — prefer Supabase Storage, fall back to Google Drive
    const audioUrl = (item as any).audio_url;
    if (!audioUrl) return res.status(400).json({ error: 'No audio file available for this song. Upload audio first.' });

    // ─── Check for cached analysis on songs table ───
    const { data: songRow } = await getSB()
      .from('songs')
      .select('cached_lyrics, cached_structure, cached_meaning, cached_song_type, cached_is_narrative, cached_is_meditative')
      .eq('id', item.song_id)
      .single();
    const cached = songRow || {} as any;
    const hasCachedAnalysis = cached.cached_lyrics && cached.cached_structure && cached.cached_meaning;

    // Create project immediately — artist navigates to Blueprint right away.
    // Always start as 'analyzing' — background block promotes to 'analyzed'
    // once audio is downloaded (cached) or full analysis completes (non-cached).
    // This ensures the client poll loop fires and picks up audio_path.
    const projectId = uuidv4();
    await insertRow('projects', {
      id: projectId,
      title: item.song_name || 'Untitled',
      status: 'analyzing',
      lyrics: cached.cached_lyrics || null,
      musical_structure: cached.cached_structure || null,
      meaning: cached.cached_meaning || '',
      song_type: cached.cached_song_type || null,
      is_narrative: cached.cached_is_narrative ?? null,
      is_meditative: cached.cached_is_meditative ?? null,
      // Defaults aligned with constants/*.ts first-entry conventions.
      // Image: Nano Banana Pro (gemini-3-pro) — strongest ref-image
      // conditioning. Storyboard: Nano Banana 2 — cheapest board renderer.
      // Video: Seedance 2.0 Fast — storyboard-mode workhorse. Pacing:
      // 15s — matches Seedance's typical clip length so the script
      // planner generates one storyboard-controlled shot per scene
      // segment instead of fragmenting into short cuts.
      image_model: 'gemini-3-pro',
      storyboard_provider: 'nano-banana-2',
      video_model: 'seedance-2.0-fast',
      target_duration: 15,
      user_id: req.userId,
      source_queue_id: queueId,
      ...(supportsPlatformColumns() ? {
        preset_key: 'music_video_default',
        workflow_key: 'music_video',
        seed_kind: 'audio',
        project_brief: { title: item.song_name || 'Untitled', source: 'legacy_queue' },
        source_payload: { kind: 'queue', queueId, songId: item.song_id },
      } : {}),
    });

    // Link back to queue (first user sets the pointer; subsequent users don't overwrite)
    if (!item.lahari_project_id) {
      await updateQueueItem(queueId, {
        status: 'in_progress',
        lahari_project_id: projectId,
      });
    }

    // If analysis is cached, we still need audio in background but can skip AI calls
    const project = await getFullProject(projectId);
    res.json({ project, queueItem: { ...item, status: 'in_progress', lahari_project_id: item.lahari_project_id || projectId } });

    // ─── Background: audio download + SRT + transcription + analysis ───
    (async () => {
      const setStep = (step: string) => updateRows('projects', { id: projectId }, { analysis_step: step });

      // Download audio first — needed for analysis and playback.
      // If this fails, the project is unusable — set error status.
      let audioPath: string;
      try {
        await setStep('Downloading audio');
        const audioBuffer = await downloadFile(audioUrl);
        const ext = audioUrl.includes('.wav') ? 'wav' : audioUrl.includes('.m4a') ? 'm4a' : 'wav';
        audioPath = await saveBuffer(audioBuffer, 'audio', ext);
        await updateRows('projects', { id: projectId }, { audio_path: audioPath, analysis_step: 'Audio ready' });
      } catch (err: any) {
        console.error(`[queue ${projectId}] audio download failed:`, err);
        await updateRows('projects', { id: projectId }, {
          status: 'error',
          analysis_step: 'Audio download failed',
          updated_at: new Date().toISOString(),
        });
        return;
      }

      // If analysis is fully cached, promote to analyzed now that audio is attached
      if (hasCachedAnalysis) {
        await updateRows('projects', { id: projectId }, { status: 'analyzed', analysis_step: null, updated_at: new Date().toISOString() });
        console.log(`[queue] Using cached analysis for ${item.song_name}, audio downloaded in background`);
        return;
      }

      try {
        // Get lyrics: SRT → audio transcription
        let lyrics = '';
        const files = await getSongFiles(item.song_id);
        const srtFile = files.find(f => f.file_type === 'srt_verified_san')
          || files.find(f => f.file_type.startsWith('srt_verified_'))
          || files.find(f => f.file_type === 'srt_turbo_scribe');

        if (srtFile) {
          await setStep('Reading lyrics from SRT');
          try {
            const srtBuffer = await downloadFile(srtFile.storage_url);
            lyrics = parseSrtToTimestamped(srtBuffer.toString('utf-8'));
          } catch (e) {
            console.warn(`[queue] Failed to download SRT for ${item.song_name}:`, e);
          }
        }
        if (!lyrics) {
          await setStep('Transcribing lyrics from audio');
          try {
            const audioBase64 = await readAsBase64(audioPath);
            const audioMime = mimeFromExt(audioPath);
            lyrics = await transcribeLyrics(audioBase64, audioMime, item.original_language);
            console.log(`[queue] Transcribed lyrics from audio for ${item.song_name}`);
          } catch (e) {
            console.warn(`[queue] Lyrics transcription failed for ${item.song_name}:`, e);
          }
        }

        // Save lyrics immediately so analysis can use them
        if (lyrics) {
          await updateRows('projects', { id: projectId }, { lyrics });
        }

        await setStep('Detecting structure + summarizing meaning');
        const audioBase64 = await readAsBase64(audioPath);
        const audioMime = mimeFromExt(audioPath);
        const audioRef = [{ type: 'audio' as const, label: 'Queued audio', url: storageUrl(audioPath) }];

        const t0 = Date.now();
        const [structureResult, meaningResult] = await Promise.allSettled([
          detectStructure(audioBase64, audioMime),
          lyrics ? summarizeMeaning(item.song_name || 'Untitled', item.original_language || 'Unknown', lyrics, '') : Promise.resolve(''),
        ]);
        const analysisMs = Date.now() - t0;

        const structureData = structureResult.status === 'fulfilled' ? structureResult.value : { sections: [], songType: 'unknown', isNarrative: false, isMeditative: false };
        const musicalStructure = Array.isArray(structureData) ? structureData : structureData.sections;
        const songType = Array.isArray(structureData) ? 'unknown' : (structureData.songType || 'unknown');
        const isNarrative = Array.isArray(structureData) ? false : (structureData.isNarrative ?? false);
        const isMeditative = Array.isArray(structureData) ? false : (structureData.isMeditative ?? false);
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

        const structureJson = JSON.stringify(musicalStructure);
        await updateRows('projects', { id: projectId }, {
          status: 'analyzed',
          analysis_step: null,
          lyrics: lyrics || null,
          musical_structure: structureJson,
          song_type: songType,
          is_narrative: isNarrative,
          is_meditative: isMeditative,
          meaning,
          updated_at: new Date().toISOString(),
        });

        // Cache analysis on songs table for future users
        if (lyrics || musicalStructure.length || meaning) {
          await getSB().from('songs').update({
            cached_lyrics: lyrics || null,
            cached_structure: structureJson || null,
            cached_song_type: songType !== 'unknown' ? songType : null,
            cached_is_narrative: isNarrative,
            cached_is_meditative: isMeditative,
            cached_meaning: meaning || null,
          }).eq('id', item.song_id);
          console.log(`[queue] Cached analysis on song ${item.song_id} for future use`);
        }
      } catch (err: any) {
        console.error(`[queue ${projectId}] background analysis failed:`, err);
        await updateRows('projects', { id: projectId }, {
          status: 'analyzed',
          analysis_step: null,
          updated_at: new Date().toISOString(),
        });
      }
    })();
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
 * Shared writeback for both publish variants. Inserts the assets row, walks
 * the fork chain to find the originating queue row, and marks everything
 * completed. Returns the full project so the client can refresh.
 */
export const finalizePublish = async (
  projectId: string,
  videoPath: string,
  videoUrl: string,
) => {
  const assetId = uuidv4();
  await insertRow('assets', {
    id: assetId,
    project_id: projectId,
    category: 'final_render',
    file_path: videoPath,
  });

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

  return {
    videoUrl,
    videoPath,
    queueRowUpdated: !!queueRow,
    queueRowId: queueRow?.id || null,
    project: await getFullProject(projectId),
  };
};

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
  if (project.user_id !== req.userId) return res.status(403).json({ error: 'Access denied' });
  if (!req.file) return res.status(400).json({ error: 'Video file required (multipart field: video)' });

  try {
    const videoPath = await saveBuffer(req.file.buffer, 'videos', 'mp4');
    const videoUrl = storageUrl(videoPath);
    const result = await finalizePublish(projectId, videoPath, videoUrl);
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'queue_published',
      entityType: 'project',
      entityId: projectId,
      summary: 'Artist published the final render to the queue.',
      payload: { queueRowId: result.queueRowId, videoPath },
    });
    res.json(result);
  } catch (err: any) {
    console.error(`[queue/publish ${projectId}] failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Publish a render that's already in Supabase Storage (e.g. uploaded by the
 * remotion-renderer service). Skips the buffer-upload hop — client just
 * passes the storage key + public URL.
 */
router.post('/publish-url/:projectId', async (req, res) => {
  const rawId = req.params.projectId;
  const projectId: string = Array.isArray(rawId) ? rawId[0] : rawId;
  const project = await selectOne('projects', { id: projectId });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.user_id !== req.userId) return res.status(403).json({ error: 'Access denied' });

  const { videoUrl, storagePath } = req.body ?? {};
  if (!videoUrl || typeof videoUrl !== 'string') {
    return res.status(400).json({ error: 'videoUrl is required' });
  }
  if (!storagePath || typeof storagePath !== 'string') {
    return res.status(400).json({ error: 'storagePath is required' });
  }

  try {
    const result = await finalizePublish(projectId, storagePath, videoUrl);
    await recordDirectorEvent({
      projectId,
      userId: req.userId,
      source: 'web',
      eventType: 'queue_published',
      entityType: 'project',
      entityId: projectId,
      summary: 'Artist published an existing render URL to the queue.',
      payload: { queueRowId: result.queueRowId, storagePath },
    });
    res.json(result);
  } catch (err: any) {
    console.error(`[queue/publish-url ${projectId}] failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

export { router as queueRouter };
