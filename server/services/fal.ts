/**
 * fal.ai video generation service.
 * Handles Seedance 2.0 and any future fal-hosted models (Kling, Runway, etc).
 * Images are uploaded to fal storage first since the API needs public URLs.
 */
import { fal } from '@fal-ai/client';
import { readFileSync } from 'fs';
import path from 'path';
import { saveBuffer, STORAGE_ROOT_PATH } from '../storage.js';

// ─── Available models ──────────────────────────────────────────────

export const FAL_VIDEO_MODELS: Record<string, { id: string; label: string; costPerSec: number; durations: number[]; supportsLastFrame: boolean }> = {
  'seedance-2.0-fast': {
    id: 'bytedance/seedance-2.0/fast/image-to-video',
    label: 'Seedance 2.0 Fast',
    costPerSec: 0.24,
    durations: [5, 10],
    supportsLastFrame: false,
  },
  'seedance-2.0': {
    id: 'bytedance/seedance-2.0/image-to-video',
    label: 'Seedance 2.0',
    costPerSec: 0.30,
    durations: [5, 10],
    supportsLastFrame: false,
  },
};

// ─── Helpers ───────────────────────────────────────────────────────

const ensureConfigured = () => {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY not set in .env');
  fal.config({ credentials: key });
};

/** Upload a local storage-relative image to fal's CDN, return the public URL. */
const uploadImage = async (storagePath: string): Promise<string> => {
  const absPath = path.join(STORAGE_ROOT_PATH, storagePath);
  const buffer = readFileSync(absPath);
  const ext = path.extname(absPath).slice(1) || 'png';
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const file = new File([buffer], `frame.${ext}`, { type: mime });
  const url = await fal.storage.upload(file);
  return url;
};

// ─── Generate Video ───────────────────────────────────────────────

/**
 * Generate a video via fal.ai from a start keyframe + motion prompt.
 * Returns the local storage path of the downloaded video.
 */
export const generateFalVideo = async (
  startImagePath: string,
  motionPrompt: string,
  modelKey = 'seedance-2.0-fast',
  opts?: { duration?: string; resolution?: string; aspectRatio?: string; generateAudio?: boolean }
): Promise<{ videoPath: string; durationSec: number }> => {
  ensureConfigured();

  const model = FAL_VIDEO_MODELS[modelKey];
  if (!model) throw new Error(`Unknown fal video model: ${modelKey}`);

  console.log(`[fal] Uploading start frame to fal storage...`);
  const imageUrl = await uploadImage(startImagePath);

  console.log(`[fal] Generating video with ${model.label}...`);
  const result = await fal.subscribe(model.id, {
    input: {
      prompt: motionPrompt || 'Cinematic camera movement',
      image_url: imageUrl,
      resolution: opts?.resolution || '720p',
      duration: opts?.duration || '10',
      aspect_ratio: opts?.aspectRatio || '16:9',
      generate_audio: opts?.generateAudio ?? false,
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === 'IN_PROGRESS') {
        const logs = (update as any).logs;
        if (logs?.length) console.log(`  [fal] ${logs[logs.length - 1].message}`);
      }
    },
  }) as any;

  const videoUrl = result.data?.video?.url || result.video?.url;
  if (!videoUrl) throw new Error('fal returned no video URL');

  // Download and save locally
  console.log(`[fal] Downloading video...`);
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`Failed to download fal video: ${videoRes.status}`);
  const buffer = Buffer.from(await videoRes.arrayBuffer());
  const videoPath = saveBuffer(buffer, 'videos', 'mp4');

  const durationSec = parseInt(opts?.duration || '10', 10) || 10;
  return { videoPath, durationSec };
};
