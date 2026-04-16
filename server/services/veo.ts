/**
 * Veo video generation service — runs server-side.
 * Uses Google's video generation model with keyframe support.
 */
import { GoogleGenAI } from '@google/genai';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { readAsBase64, saveBuffer, downloadToTmp, uploadFromTmp } from '../storage.js';

// Vertex AI only — no Developer API fallback. Requires GCP_PROJECT_ID +
// GOOGLE_APPLICATION_CREDENTIALS (or GOOGLE_APPLICATION_CREDENTIALS_JSON on Railway).
const getAI = () => {
  if (!process.env.GCP_PROJECT_ID) {
    throw new Error('GCP_PROJECT_ID is required for Veo. Set it in .env (local) or Railway env vars (prod).');
  }
  return new GoogleGenAI({
    vertexai: true,
    project: process.env.GCP_PROJECT_ID,
    location: process.env.GCP_LOCATION || 'us-central1',
  });
};

/**
 * Extract the last frame from a video file using ffmpeg.
 * Returns the storage-relative path of the saved frame (PNG).
 */
export const extractLastFrame = async (videoStoragePath: string): Promise<string> => {
  const localVideo = await downloadToTmp(videoStoragePath);

  const outputFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const outputLocal = path.join(os.tmpdir(), 'lahari-cache', outputFilename);
  fs.mkdirSync(path.dirname(outputLocal), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const args = [
      '-sseof', '-0.1',
      '-i', localVideo,
      '-vsync', '0',
      '-frames:v', '1',
      '-q:v', '2',
      '-y',
      outputLocal,
    ];
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
  });

  const storagePath = await uploadFromTmp(outputLocal, 'images', 'png');
  return storagePath;
};

/**
 * Generate a video clip from a start keyframe image + motion prompt.
 * Optionally accepts an end keyframe for cinematic morphing.
 * Returns the storage path of the generated video.
 */
// Developer API and Vertex AI use different model identifiers for the same
// underlying Veo models. Both transports are now on the GA 3.1 family
// (released Nov 2025) — 3.1 supports first+last frame conditioning; 3.0 did not.
export const VEO_MODELS = {
  'veo-3.0-fast': {
    modelId: 'veo-3.0-fast-generate-001',
    label: 'Veo 3.0 Fast',
    durations: [8],
    costPerSec: 0.10,
    supportsLastFrame: false,
  },
  'veo-3.0': {
    modelId: 'veo-3.0-generate-001',
    label: 'Veo 3.0',
    durations: [4, 6, 8],
    costPerSec: 0.20,
    supportsLastFrame: false,
  },
  'veo-3.1-fast': {
    modelId: 'veo-3.1-fast-generate-001',
    label: 'Veo 3.1 Fast (+ end frame)',
    durations: [8],
    costPerSec: 0.10,
    supportsLastFrame: true,
  },
  'veo-3.1': {
    modelId: 'veo-3.1-generate-001',
    label: 'Veo 3.1 (+ end frame)',
    durations: [4, 6, 8],
    costPerSec: 0.20,
    supportsLastFrame: true,
  },
} as const;

export type VeoModelKey = keyof typeof VEO_MODELS;

export const generateVideo = async (
  startImagePath: string,
  motionPrompt: string,
  endImagePath?: string,
  opts?: { resolution?: '720p' | '1080p'; aspectRatio?: '16:9' | '9:16'; durationSec?: number; modelKey?: VeoModelKey }
): Promise<{ videoPath: string; modelId: string; durationSec: number }> => {
  const ai = getAI();
  const startBase64 = await readAsBase64(startImagePath);

  const modelKey: VeoModelKey = opts?.modelKey || 'veo-3.1-fast';
  const model = VEO_MODELS[modelKey] || VEO_MODELS['veo-3.1-fast'];

  // Clamp the requested duration to one the selected Veo variant supports.
  const durations = [...model.durations] as number[];
  const requested = opts?.durationSec ?? durations[0];
  const durationSec = durations.reduce<number>(
    (best, d) => Math.abs(d - requested) < Math.abs(best - requested) ? d : best,
    durations[0]
  );

  const config: any = {
    numberOfVideos: 1,
    resolution: opts?.resolution || '720p',
    aspectRatio: opts?.aspectRatio || '16:9',
    durationSeconds: durationSec,
  };
  // Only Vertex AI accepts generateAudio. On Developer API the SDK throws.
  // Turning audio off drops Veo 3 Fast from ~$0.15/s to ~$0.10/s.
  config.generateAudio = false;

  if (endImagePath) {
    const endBase64 = await readAsBase64(endImagePath);
    config.lastFrame = {
      imageBytes: endBase64,
      mimeType: 'image/png'
    };
  }

  // Pick the right model identifier for the transport we're actually on.
  const modelId = model.modelId;
  console.log(`[veo] Generating video with model=${modelId}, prompt=${(motionPrompt || '').substring(0, 80)}...`);

  let operation = await ai.models.generateVideos({
    model: modelId,
    prompt: motionPrompt || 'Cinematic camera movement',
    image: { imageBytes: startBase64, mimeType: 'image/png' },
    config
  });

  // Poll until done
  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  const video: any = operation.response?.generatedVideos?.[0]?.video;
  if (!video) {
    const resp = operation.response;
    const genVideo = resp?.generatedVideos?.[0];
    const reason = (genVideo as any)?.finishReason || (genVideo as any)?.blockReason || 'unknown';
    console.error(`[veo] No video. Model=${modelId}, reason=${reason}, response=${JSON.stringify(resp || {}).substring(0, 500)}`);
    throw new Error(`Video generation returned no video (${reason}). Model: ${modelId}`);
  }

  // Two response shapes depending on transport:
  //  • Developer API returns a URI you fetch with ?key=<GEMINI_API_KEY>.
  //  • Vertex AI returns videoBytes inline (base64) for short clips, or a
  //    gs://  or https://storage.googleapis.com/ URI for GCS-hosted results.
  // On Vertex the user-supplied credentials are already attached to the SDK
  // client, so GCS fetches need an OAuth2 bearer token — we lean on the
  // google-auth-library shipped with @google/genai to mint one.
  let buffer: Buffer;
  if (video.videoBytes) {
    buffer = Buffer.from(video.videoBytes, 'base64');
  } else if (video.uri) {
    // Vertex returns GCS URIs — need a bearer token to download.
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    const res = await fetch(video.uri, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Video download failed: ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  } else {
    throw new Error('Video generation failed — neither videoBytes nor uri in response');
  }

  // Baked-in audio handling: on Vertex we turn it off at gen time via
  // generateAudio:false. On Developer API the track is still present but
  // never played: <video muted> in preview, `-map 0:v:0 -map 1:a:0` in the
  // final render. Saves us from an ffmpeg post-process pass.
  const videoPath = await saveBuffer(buffer, 'videos', 'mp4');
  return { videoPath, modelId, durationSec };
};
