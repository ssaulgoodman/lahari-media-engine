/**
 * Segmind video generation service — unified provider for all video models.
 * Simple REST API: POST JSON, get video binary back. No polling.
 *
 * Models: Veo 3.1 Fast, Veo 3.1, Seedance 2.0 Fast, Seedance 2.0
 */
import { saveBuffer, storageUrl } from '../storage.js';

const SEGMIND_BASE = 'https://api.segmind.com/v1';
type SegmindResolution = '480p' | '720p' | '1080p';

const getApiKey = () => {
  const key = process.env.SEGMIND_API_KEY;
  if (!key) throw new Error('SEGMIND_API_KEY not set in .env');
  return key;
};

// ─── Model registry ──────────────────────────────────────────────

export const SEGMIND_MODELS = {
  'veo-3.1-fast': {
    endpoint: `${SEGMIND_BASE}/veo-3.1-fast`,
    label: 'Veo 3.1 Fast',
    family: 'veo',
    durations: [8],
    costPerSec: 0.10,
    supportsLastFrame: true,
    supportsRefs: true, // reference_images[] for consistency
  },
  'veo-3.1': {
    endpoint: `${SEGMIND_BASE}/veo-3.1`,
    label: 'Veo 3.1',
    family: 'veo',
    durations: [4, 6, 8],
    costPerSec: 0.20,
    supportsLastFrame: true,
    supportsRefs: true, // reference_images[] for consistency
  },
  'seedance-2.0-fast': {
    endpoint: `${SEGMIND_BASE}/seedance-2.0-fast`,
    label: 'Seedance 2.0 Fast',
    family: 'seedance',
    durations: [4, 5, 6, 8, 10, 12, 15],
    costPerSec: 0.146,
    supportsLastFrame: true,
    supportsRefs: true, // up to 9 reference images
  },
  'seedance-2.0': {
    endpoint: `${SEGMIND_BASE}/seedance-2.0`,
    label: 'Seedance 2.0',
    family: 'seedance',
    durations: [4, 5, 6, 8, 10, 12, 15],
    costPerSec: 0.182,
    supportsLastFrame: true,
    supportsRefs: true,
  },
} as const;

export type SegmindModelKey = keyof typeof SEGMIND_MODELS;

/** Smallest valid duration for a given model (or default model). */
export const getModelMinDuration = (modelKey?: string): number => {
  // Default aligned with constants/videoModels.ts first entry — Seedance
  // 2.0 Fast is the storyboard-mode default. Was veo-3.1-fast.
  const model = SEGMIND_MODELS[(modelKey || 'seedance-2.0-fast') as SegmindModelKey];
  if (!model) return 4;
  return Math.min(...model.durations);
};

// ─── Generate Video ──────────────────────────────────────────────

export const generateSegmindVideo = async (
  startImagePath: string | undefined,
  motionPrompt: string,
  opts?: {
    endImagePath?: string;
    referenceImagePaths?: string[];
    resolution?: SegmindResolution;
    referenceAudioPaths?: string[];
    aspectRatio?: '16:9' | '9:16';
    durationSec?: number;
    modelKey?: SegmindModelKey;
  }
): Promise<{ videoPath: string; modelId: string; durationSec: number }> => {
  // Default aligned with constants/videoModels.ts first entry. Was veo-3.1-fast.
  const modelKey: SegmindModelKey = opts?.modelKey || 'seedance-2.0-fast';
  const model = SEGMIND_MODELS[modelKey];
  if (!model) throw new Error(`Unknown Segmind model: ${modelKey}`);

  // Pick the smallest model duration >= shot duration. If shot exceeds all
  // model durations, use the largest. The render timeline handles trimming.
  const durations = [...model.durations].sort((a, b) => a - b);
  const requested = opts?.durationSec ?? durations[0];
  const durationSec = durations.find(d => d >= requested) ?? durations[durations.length - 1];

  // Convert storage paths to public Supabase URLs
  const startUrl = startImagePath ? storageUrl(startImagePath) : undefined;
  const endUrl = opts?.endImagePath ? storageUrl(opts.endImagePath) : undefined;
  const refUrls = (opts?.referenceImagePaths || []).map(p => storageUrl(p));
  const refAudioUrls = (opts?.referenceAudioPaths || []).map(p => storageUrl(p));
  const requestedResolution = opts?.resolution || '720p';
  const resolution = model.family === 'seedance'
    // Segmind Seedance currently accepts 480p/720p only. Lahari exposes
    // 720p/1080p, so clamp Seedance to 720p instead of sending a 400.
    ? (requestedResolution === '480p' ? '480p' : '720p')
    : (requestedResolution === '1080p' ? '1080p' : '720p');

  // Build request body — different param names for Veo vs Seedance
  let body: Record<string, any>;

  if (model.family === 'veo') {
    body = {
      prompt: motionPrompt || 'Cinematic camera movement',
      image: startUrl,
      duration: durationSec,
      resolution,
      aspect_ratio: opts?.aspectRatio || '16:9',
      generate_audio: false,
      seed: Math.floor(Math.random() * 1000000),
    };
    if (endUrl && model.supportsLastFrame) {
      body.last_frame = endUrl;
    }
    if (refUrls.length && model.supportsRefs) {
      body.reference_images = refUrls;
    }
  } else {
    // Seedance family
    // NOTE: Seedance frame URLs (first_frame_url/last_frame_url) and
    // reference_images are mutually exclusive. When we have a start frame,
    // we prioritize frame control and skip reference_images.
    const useFrameMode = !!startUrl;
    body = {
      prompt: motionPrompt || 'Cinematic camera movement',
      duration: durationSec,
      resolution,
      aspect_ratio: opts?.aspectRatio || '16:9',
      generate_audio: false,
      seed: Math.floor(Math.random() * 1000000),
    };
    if (useFrameMode) {
      body.first_frame_url = startUrl;
      if (endUrl && model.supportsLastFrame) {
        body.last_frame_url = endUrl;
      }
    }
    if (!useFrameMode && refUrls.length && model.supportsRefs) {
      body.reference_images = refUrls.slice(0, 9);
    }
    if (refAudioUrls.length) {
      body.reference_audios = refAudioUrls.slice(0, 1);
    }
  }

  const bodyKeys = Object.keys(body).sort().join(',');
  console.log(`[segmind] model=${modelKey}, endpoint=${model.endpoint}, duration=${durationSec}s, resolution=${resolution}, refs=${refUrls.length}, audioRefs=${refAudioUrls.length}, keys=${bodyKeys}, prompt=${(motionPrompt || '').substring(0, 80)}...`);

  const res = await fetch(model.endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': getApiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[segmind] ${res.status} ${res.statusText}: ${errText.slice(0, 4000)}`);
    console.error(`[segmind] request body: ${JSON.stringify(body).slice(0, 2000)}`);
    const errDetails = (() => {
      try {
        const parsed = JSON.parse(errText);
        return typeof parsed?.error === 'string' ? parsed.error : errText;
      } catch {
        return errText;
      }
    })();
    // Classify errors so the artist sees actionable messages
    const lower = errDetails.toLowerCase();
    let userMessage: string;
    const isCreditsError =
      res.status === 402 ||
      lower.includes('insufficient credit') ||
      lower.includes('out of credits') ||
      lower.includes('not enough credits') ||
      lower.includes('payment required') ||
      (res.status === 403 && lower.includes('billing'));
    if (lower.includes('safety settings') || lower.includes('blocked') || lower.includes('person/face')) {
      userMessage = `Safety filter blocked this image — the AI flagged faces/people in the start frame. Try regenerating the start frame first, or switch to Seedance which has a different safety policy.`;
    } else if (isCreditsError) {
      userMessage = `Segmind credits exhausted — top up Segmind credits before retrying.`;
    } else if (res.status === 404 || lower.includes('not_found') || lower.includes('not found')) {
      userMessage = `Model ${modelKey} is temporarily unavailable on Segmind (404). This usually resolves in a few minutes — try again shortly.`;
    } else if (res.status === 429 || lower.includes('rate limit') || lower.includes('quota')) {
      userMessage = `Rate limited — too many requests. Wait a minute and retry.`;
    } else if (lower.includes('mutually exclusive')) {
      userMessage = `Seedance can't use reference images when a start frame is set. Refs are skipped automatically — this shouldn't happen. Report this bug.`;
    } else if (lower.includes('resolution')) {
      userMessage = `${modelKey} rejected the requested resolution. Seedance supports 720p in Lahari; retry after saving the project render settings.`;
    } else if (lower.includes('duration')) {
      userMessage = `${modelKey} rejected the requested duration. Valid Seedance durations are 4, 5, 6, 8, 10, 12, or 15 seconds.`;
    } else {
      userMessage = `${modelKey} failed (${res.status}). ${errDetails.slice(0, 220)}`;
    }
    const err = new Error(userMessage);
    (err as any).segmindStatus = res.status;
    (err as any).segmindRaw = errText.slice(0, 4000);
    (err as any).errorCategory = lower.includes('safety') || lower.includes('blocked')
      ? 'safety'
      : isCreditsError
        ? 'insufficient_credits'
        : res.status === 404
          ? 'model_unavailable'
          : 'unknown';
    throw err;
  }

  // Segmind returns video binary directly
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 1000) {
    // Suspiciously small — might be an error JSON
    const text = buffer.toString('utf-8');
    if (text.startsWith('{')) {
      console.error(`[segmind] Got JSON instead of video: ${text.slice(0, 500)}`);
      throw new Error(`Segmind ${modelKey} returned error: ${text.slice(0, 200)}`);
    }
  }

  const videoPath = await saveBuffer(buffer, 'videos', 'mp4');
  console.log(`[segmind] Video saved: ${videoPath} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);

  return { videoPath, modelId: modelKey, durationSec };
};
