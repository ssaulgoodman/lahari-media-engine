import { generateSegmindVideo, SegmindModelKey } from './segmind.js';
import {
  generateVertexVideo,
  hasVertexVideoConfig,
  isVertexVeoModelKey,
} from './vertex-video.js';
import { supportsPlatformColumns } from '../database.js';

type VideoProvider = 'segmind' | 'vertex';

export type VideoGenerationOptions = {
  endImagePath?: string;
  referenceImagePaths?: string[];
  referenceAudioPaths?: string[];
  generateAudio?: boolean;
  resolution?: '720p' | '1080p';
  aspectRatio?: '16:9' | '9:16';
  durationSec?: number;
  modelKey?: SegmindModelKey;
  generationAttemptId?: string;
  apiMode?: 'v1_sync' | 'v2_async';
  transportFallbackFrom?: {
    mode: 'v2_async';
    providerRequestId?: string | null;
    reason: string;
    chargeStatus?: string | null;
  };
};

export type VideoGenerationResult = {
  videoPath: string;
  modelId: string;
  durationSec: number;
  provider: VideoProvider;
  providerRequestId?: string | null;
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

const shouldFallbackToSegmindV1 = (err: any, modelKey: SegmindModelKey): boolean => {
  if (!isVertexVeoModelKey(modelKey)) return false;
  const message = String(err?.message || err || '').toLowerCase();
  const raw = String(err?.segmindRaw || '').toLowerCase();
  const chargeStatus = String(err?.chargeStatus || '').toLowerCase();
  const requestStatus = String(err?.providerRequestStatus || '').toLowerCase();
  const text = `${message} ${raw}`;

  return chargeStatus === 'provider_failed_no_output'
    && requestStatus === 'failed'
    && text.includes('failed to get the token');
};

export const generateVideoWithFallback = async (
  startImagePath: string | undefined,
  motionPrompt: string,
  opts?: VideoGenerationOptions
): Promise<VideoGenerationResult> => {
  const modelKey = opts?.modelKey || 'veo-3.1-fast';
  const canUseVertexModel = isVertexVeoModelKey(modelKey);
  const studioSchema = supportsPlatformColumns();

  // Env override: VIDEO_PROVIDER=vertex skips Segmind entirely for Veo models.
  // Useful when Segmind is out of credits or down. Seedance models still go to
  // Segmind (Vertex doesn't have them).
  if (!studioSchema && process.env.VIDEO_PROVIDER === 'vertex' && canUseVertexModel && hasVertexVideoConfig()) {
    console.log(`[video-provider] VIDEO_PROVIDER=vertex — going direct to Vertex for ${modelKey}`);
    return await generateVertexVideo(startImagePath, motionPrompt, { ...opts, modelKey });
  }

  try {
    const result = await generateSegmindVideo(startImagePath, motionPrompt, opts);
    return { ...result, provider: 'segmind' };
  } catch (segmindErr: any) {
    if (shouldFallbackToSegmindV1(segmindErr, modelKey)) {
      console.warn(`[video-provider] Segmind async token failure for ${modelKey}; retrying once through v1 sync. Cause: ${summarizeError(segmindErr)}`);
      try {
        const result = await generateSegmindVideo(startImagePath, motionPrompt, {
          ...opts,
          apiMode: 'v1_sync',
          transportFallbackFrom: {
            mode: 'v2_async',
            providerRequestId: segmindErr?.providerRequestId || null,
            reason: 'segmind_async_token_failure',
            chargeStatus: segmindErr?.chargeStatus || null,
          },
        });
        return { ...result, provider: 'segmind' };
      } catch (v1Err: any) {
        const err = new Error(`Segmind async failed (${summarizeError(segmindErr)}). Segmind v1 fallback also failed (${summarizeError(v1Err)}).`);
        (err as any).primaryError = segmindErr;
        (err as any).fallbackError = v1Err;
        (err as any).errorCategory = v1Err?.errorCategory || segmindErr?.errorCategory || 'unknown';
        throw err;
      }
    }

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
        modelKey,
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
