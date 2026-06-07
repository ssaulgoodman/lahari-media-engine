import { generateSegmindVideo, SEGMIND_MODELS, SegmindModelKey } from './segmind.js';
import { generateKieVideo, isKieModelKey, KIE_MODELS, type KieModelKey } from './kie-video.js';
import {
  generateVertexVideo,
  hasVertexVideoConfig,
  isVertexVeoModelKey,
} from './vertex-video.js';
import { supportsPlatformColumns } from '../database.js';
import { storageUrl } from '../storage.js';

type VideoProvider = 'segmind' | 'vertex' | 'kie';

export type VideoModelKey = SegmindModelKey | KieModelKey;

export type VideoGenerationOptions = {
  endImagePath?: string;
  referenceImagePaths?: string[];
  referenceAudioPaths?: string[];
  generateAudio?: boolean;
  resolution?: '720p' | '1080p';
  aspectRatio?: '16:9' | '9:16';
  durationSec?: number;
  modelKey?: VideoModelKey;
  generationAttemptId?: string;
};

export type VideoGenerationResult = {
  videoPath: string;
  modelId: string;
  durationSec: number;
  provider: VideoProvider;
  providerRequestId?: string | null;
};

// Provider-owned model spec resolution: returns the shape callers need
// (duration options, cost, family, owning provider) for any video model key,
// regardless of which provider owns it. Defaults to the stable Segmind Veo.
export const resolveVideoModelSpec = (modelKey?: string | null): {
  provider: VideoProvider;
  durations: readonly number[];
  costPerSec: number;
  family: string;
  supportsLastFrame: boolean;
  supportsRefs: boolean;
  refsWithFrames: boolean;
} => {
  if (modelKey && isKieModelKey(modelKey)) {
    const m = KIE_MODELS[modelKey];
    return {
      provider: 'kie',
      durations: m.durations,
      costPerSec: m.costPerSec,
      family: m.family,
      supportsLastFrame: m.supportsLastFrame,
      supportsRefs: m.supportsRefs,
      refsWithFrames: m.refsWithFrames,
    };
  }
  const key = (modelKey && modelKey in SEGMIND_MODELS ? modelKey : 'veo-3.1-fast') as SegmindModelKey;
  const m = SEGMIND_MODELS[key];
  return {
    provider: 'segmind',
    durations: m.durations,
    costPerSec: m.costPerSec,
    family: m.family,
    supportsLastFrame: m.supportsLastFrame,
    supportsRefs: m.supportsRefs,
    refsWithFrames: m.refsWithFrames,
  };
};

const shouldFallbackToVertex = (err: any): boolean => {
  const status = Number(err?.segmindStatus || err?.status || err?.code || 0);
  const category = String(err?.errorCategory || '').toLowerCase();
  const message = String(err?.message || err || '').toLowerCase();
  const raw = String(err?.segmindRaw || '').toLowerCase();
  const text = `${message} ${raw}`;

  if (category === 'safety' || text.includes('safety settings') || text.includes('blocked')) {
    return false;
  }

  if (category === 'model_unavailable' || category === 'insufficient_credits') return true;
  if ([402, 403, 408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;

  return [
    'fetch failed',
    'network',
    'timeout',
    'timed out',
    'temporarily unavailable',
    'unavailable',
    'overloaded',
    'bad gateway',
    'gateway timeout',
    'internal server error',
    'insufficient credits',
    'insufficient credit',
    'out of credits',
    'not enough credits',
    'payment required',
    'billing',
  ].some(needle => text.includes(needle));
};

const summarizeError = (err: any): string => {
  const message = String(err?.message || err || 'unknown error').replace(/\s+/g, ' ').trim();
  return message.length > 180 ? `${message.slice(0, 180)}...` : message;
};

const publicStorageUrl = (pathOrUrl?: string): string | undefined => {
  if (!pathOrUrl) return undefined;
  return /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : storageUrl(pathOrUrl);
};

export const generateVideoWithFallback = async (
  startImagePath: string | undefined,
  motionPrompt: string,
  opts?: VideoGenerationOptions
): Promise<VideoGenerationResult> => {
  const modelKey = opts?.modelKey || 'veo-3.1-fast';

  // Kie provider: routed by a kie-* model key. The Segmind/Vertex path below is
  // untouched, so Kie is purely additive and Segmind stays the default.
  if (isKieModelKey(modelKey)) {
    const result = await generateKieVideo(publicStorageUrl(startImagePath), motionPrompt, {
      modelKey,
      endImageUrl: publicStorageUrl(opts?.endImagePath),
      aspectRatio: opts?.aspectRatio,
      durationSec: opts?.durationSec,
      generationAttemptId: opts?.generationAttemptId,
    });
    return { ...result, provider: 'kie' };
  }

  // From here, modelKey is a Segmind/Vertex key.
  const segmindModelKey = modelKey as SegmindModelKey;
  const canUseVertexModel = isVertexVeoModelKey(segmindModelKey);
  const studioSchema = supportsPlatformColumns();

  // Env override: VIDEO_PROVIDER=vertex skips Segmind entirely for Veo models.
  // Useful when Segmind is out of credits or down. Seedance models still go to
  // Segmind (Vertex doesn't have them).
  if (!studioSchema && process.env.VIDEO_PROVIDER === 'vertex' && canUseVertexModel && hasVertexVideoConfig()) {
    console.log(`[video-provider] VIDEO_PROVIDER=vertex — going direct to Vertex for ${modelKey}`);
    return await generateVertexVideo(startImagePath, motionPrompt, { ...opts, modelKey: segmindModelKey });
  }

  try {
    const result = await generateSegmindVideo(startImagePath, motionPrompt, opts ? { ...opts, modelKey: segmindModelKey } : undefined);
    return { ...result, provider: 'segmind' };
  } catch (segmindErr: any) {

    if (studioSchema || !canUseVertexModel || !shouldFallbackToVertex(segmindErr)) {
      throw segmindErr;
    }

    if (!hasVertexVideoConfig()) {
      console.warn(`[video-provider] Segmind failed, but Vertex fallback is not configured: ${summarizeError(segmindErr)}`);
      throw segmindErr;
    }

    console.warn(`[video-provider] Segmind failed for ${modelKey}; trying Vertex fallback. Cause: ${summarizeError(segmindErr)}`);

    try {
      return await generateVertexVideo(startImagePath, motionPrompt, {
        ...opts,
        modelKey: segmindModelKey,
      });
    } catch (vertexErr: any) {
      const err = new Error(`Segmind failed (${summarizeError(segmindErr)}). Vertex fallback also failed (${summarizeError(vertexErr)}).`);
      (err as any).primaryError = segmindErr;
      (err as any).fallbackError = vertexErr;
      (err as any).errorCategory = vertexErr?.errorCategory || segmindErr?.errorCategory || 'unknown';
      throw err;
    }
  }
};
