/**
 * Vertex AI Veo fallback provider.
 *
 * Segmind stays the primary video provider because it accepts Lahari's
 * reference-image chain. Vertex is a continuity-preserving backup for provider
 * outages: start frame + optional end frame + motion prompt.
 */
import { GoogleGenAI } from '@google/genai';
import { mimeFromExt, readAsBase64, saveBuffer } from '../storage.js';

export const VERTEX_VEO_MODELS = {
  'veo-3.1-fast': {
    modelId: 'veo-3.1-fast-generate-001',
    label: 'Vertex Veo 3.1 Fast',
    durations: [4, 6, 8],
    costPerSec: 0.10,
  },
  'veo-3.1': {
    modelId: 'veo-3.1-generate-001',
    label: 'Vertex Veo 3.1',
    durations: [4, 6, 8],
    costPerSec: 0.20,
  },
} as const;

export type VertexVeoModelKey = keyof typeof VERTEX_VEO_MODELS;

export const isVertexVeoModelKey = (modelKey: string): modelKey is VertexVeoModelKey =>
  modelKey === 'veo-3.1-fast' || modelKey === 'veo-3.1';

export const hasVertexVideoConfig = (): boolean => !!process.env.GCP_PROJECT_ID;

const getAI = () => {
  if (!process.env.GCP_PROJECT_ID) {
    throw new Error('GCP_PROJECT_ID is required for Vertex Veo fallback.');
  }

  return new GoogleGenAI({
    vertexai: true,
    project: process.env.GCP_PROJECT_ID,
    location: process.env.GCP_LOCATION || 'us-central1',
  });
};

const imageMime = (storagePath: string, base64: string): string => {
  const fromExt = mimeFromExt(storagePath);
  if (fromExt !== 'application/octet-stream') return fromExt;
  return base64.startsWith('/9j/') || base64.startsWith('/9j+') ? 'image/jpeg' : 'image/png';
};

const pickDuration = (durations: readonly number[], requested?: number): number => {
  const sorted = [...durations].sort((a, b) => a - b);
  const target = requested ?? sorted[0];
  return sorted.find(d => d >= target) ?? sorted[sorted.length - 1];
};

const downloadVertexVideo = async (video: any): Promise<Buffer> => {
  if (video?.videoBytes) {
    return Buffer.from(video.videoBytes, 'base64');
  }

  if (!video?.uri) {
    throw new Error('Vertex Veo returned no video bytes or URI.');
  }

  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();

  const url = String(video.uri).startsWith('gs://')
    ? `https://storage.googleapis.com/${String(video.uri).slice('gs://'.length)}`
    : String(video.uri);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Vertex video download failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
};

export const generateVertexVideo = async (
  startImagePath: string,
  motionPrompt: string,
  opts?: {
    endImagePath?: string;
    referenceImagePaths?: string[];
    resolution?: '720p' | '1080p';
    aspectRatio?: '16:9' | '9:16';
    durationSec?: number;
    modelKey?: VertexVeoModelKey;
  }
): Promise<{ videoPath: string; modelId: string; durationSec: number; provider: 'vertex' }> => {
  const ai = getAI();
  const modelKey = opts?.modelKey || 'veo-3.1-fast';
  const model = VERTEX_VEO_MODELS[modelKey];
  const durationSec = pickDuration(model.durations, opts?.durationSec);

  const startBase64 = await readAsBase64(startImagePath);
  const startMime = imageMime(startImagePath, startBase64);

  const config: any = {
    numberOfVideos: 1,
    resolution: opts?.resolution || '720p',
    aspectRatio: opts?.aspectRatio || '16:9',
    durationSeconds: durationSec,
    generateAudio: false,
    personGeneration: 'allow_adult',
  };

  if (opts?.endImagePath) {
    const endBase64 = await readAsBase64(opts.endImagePath);
    config.lastFrame = {
      imageBytes: endBase64,
      mimeType: imageMime(opts.endImagePath, endBase64),
    };
  }

  if (opts?.referenceImagePaths?.length) {
    console.warn(`[vertex-video] Skipping ${opts.referenceImagePaths.length} ref image(s): Vertex fallback uses image-to-video mode.`);
  }

  console.log(`[vertex-video] model=${model.modelId}, duration=${durationSec}s, prompt=${(motionPrompt || '').substring(0, 80)}...`);

  let operation = await ai.models.generateVideos({
    model: model.modelId,
    prompt: motionPrompt || 'Cinematic camera movement',
    image: { imageBytes: startBase64, mimeType: startMime },
    config,
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  if (operation.error) {
    throw new Error(`Vertex Veo failed: ${JSON.stringify(operation.error).slice(0, 500)}`);
  }

  const response: any = operation.response || {};
  const video = response.generatedVideos?.[0]?.video;
  if (!video) {
    const raiReason = response.raiMediaFilteredReasons?.[0];
    const reason = raiReason || response.generatedVideos?.[0]?.finishReason || response.generatedVideos?.[0]?.blockReason || 'unknown';
    const err = new Error(`Vertex Veo returned no video (${reason}).`);
    (err as any).errorCategory = raiReason ? 'safety' : 'unknown';
    throw err;
  }

  const buffer = await downloadVertexVideo(video);
  const videoPath = await saveBuffer(buffer, 'videos', 'mp4');
  console.log(`[vertex-video] Video saved: ${videoPath} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);

  return { videoPath, modelId: `vertex:${model.modelId}`, durationSec, provider: 'vertex' };
};
