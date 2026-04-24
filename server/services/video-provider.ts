import { generateSegmindVideo, SegmindModelKey } from './segmind.js';
import {
  generateVertexVideo,
  hasVertexVideoConfig,
  isVertexVeoModelKey,
} from './vertex-video.js';

type VideoProvider = 'segmind' | 'vertex';

export type VideoGenerationOptions = {
  endImagePath?: string;
  referenceImagePaths?: string[];
  resolution?: '720p' | '1080p';
  aspectRatio?: '16:9' | '9:16';
  durationSec?: number;
  modelKey?: SegmindModelKey;
};

export type VideoGenerationResult = {
  videoPath: string;
  modelId: string;
  durationSec: number;
  provider: VideoProvider;
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

  if (category === 'model_unavailable') return true;
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;

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
  ].some(needle => text.includes(needle));
};

const summarizeError = (err: any): string => {
  const message = String(err?.message || err || 'unknown error').replace(/\s+/g, ' ').trim();
  return message.length > 180 ? `${message.slice(0, 180)}...` : message;
};

export const generateVideoWithFallback = async (
  startImagePath: string,
  motionPrompt: string,
  opts?: VideoGenerationOptions
): Promise<VideoGenerationResult> => {
  try {
    const result = await generateSegmindVideo(startImagePath, motionPrompt, opts);
    return { ...result, provider: 'segmind' };
  } catch (segmindErr: any) {
    const modelKey = opts?.modelKey || 'veo-3.1-fast';
    const canUseVertexModel = isVertexVeoModelKey(modelKey);

    if (!canUseVertexModel || !shouldFallbackToVertex(segmindErr)) {
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
