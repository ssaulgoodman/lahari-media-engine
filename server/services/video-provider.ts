import { generateSegmindVideo, SegmindModelKey } from './segmind.js';
import { generateOpenRouterSeedanceVideo } from './openrouter-video.js';

type VideoProvider = 'segmind' | 'openrouter';

export type VideoGenerationOptions = {
  endImagePath?: string;
  referenceImagePaths?: string[];
  referenceAudioPaths?: string[];
  resolution?: '720p' | '1080p';
  aspectRatio?: '16:9' | '9:16';
  durationSec?: number;
  modelKey?: string;
};

export type VideoGenerationResult = {
  videoPath: string;
  modelId: string;
  durationSec: number;
  provider: VideoProvider;
};

export const generateVideoWithFallback = async (
  startImagePath: string | undefined,
  motionPrompt: string,
  opts?: VideoGenerationOptions
): Promise<VideoGenerationResult> => {
  if (opts?.modelKey === 'seedance-2.0-fast-openrouter') {
    const result = await generateOpenRouterSeedanceVideo(startImagePath, motionPrompt, opts);
    return { ...result, provider: 'openrouter' };
  }

  const result = await generateSegmindVideo(startImagePath, motionPrompt, {
    ...opts,
    modelKey: opts?.modelKey as SegmindModelKey | undefined,
  });
  return { ...result, provider: 'segmind' };
};
