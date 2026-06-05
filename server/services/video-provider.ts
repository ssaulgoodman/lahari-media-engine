import { generateSegmindVideo, SegmindModelKey } from './segmind.js';

type VideoProvider = 'segmind';

export type VideoGenerationOptions = {
  endImagePath?: string;
  referenceImagePaths?: string[];
  referenceAudioPaths?: string[];
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

export const generateVideoWithFallback = async (
  startImagePath: string | undefined,
  motionPrompt: string,
  opts?: VideoGenerationOptions
): Promise<VideoGenerationResult> => {
  const result = await generateSegmindVideo(startImagePath, motionPrompt, opts);
  return { ...result, provider: 'segmind' };
};
