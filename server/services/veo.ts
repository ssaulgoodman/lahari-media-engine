/**
 * Veo video generation service — runs server-side.
 * Uses Google's video generation model with keyframe support.
 */
import { GoogleGenAI } from '@google/genai';
import { spawn } from 'child_process';
import path from 'path';
import { readAsBase64, saveBuffer, STORAGE_ROOT_PATH } from '../storage.js';

const getAI = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

/**
 * Extract the last frame from a video file using ffmpeg.
 * Returns the storage-relative path of the saved frame (PNG).
 */
export const extractLastFrame = async (videoStoragePath: string): Promise<string> => {
  const absoluteVideoPath = path.join(STORAGE_ROOT_PATH, videoStoragePath);

  // Generate output path via saveBuffer pattern — pre-allocate an empty PNG path
  // We'll write directly to disk via ffmpeg.
  const outputFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const outputStoragePath = path.join('images', outputFilename);
  const outputAbsolutePath = path.join(STORAGE_ROOT_PATH, outputStoragePath);

  // ffmpeg: seek to end, grab one frame. -sseof -0.1 seeks to ~100ms before end.
  await new Promise<void>((resolve, reject) => {
    const args = [
      '-sseof', '-0.1',
      '-i', absoluteVideoPath,
      '-vsync', '0',
      '-frames:v', '1',
      '-q:v', '2',
      '-y',
      outputAbsolutePath,
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

  return outputStoragePath;
};

/**
 * Generate a video clip from a start keyframe image + motion prompt.
 * Optionally accepts an end keyframe for cinematic morphing.
 * Returns the storage path of the generated video.
 */
export const generateVideo = async (
  startImagePath: string,
  motionPrompt: string,
  endImagePath?: string
): Promise<string> => {
  const ai = getAI();
  const startBase64 = readAsBase64(startImagePath);

  const config: any = {
    numberOfVideos: 1,
    resolution: '720p',
    aspectRatio: '16:9'
  };

  if (endImagePath) {
    const endBase64 = readAsBase64(endImagePath);
    config.lastFrame = {
      imageBytes: endBase64,
      mimeType: 'image/png'
    };
  }

  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: motionPrompt || 'Cinematic camera movement',
    image: {
      imageBytes: startBase64,
      mimeType: 'image/png'
    },
    config
  });

  // Poll until done
  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!videoUri) throw new Error('Video generation failed — no URI returned');

  // Download the video and save locally
  const videoRes = await fetch(`${videoUri}&key=${process.env.GEMINI_API_KEY}`);
  if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.status}`);

  const buffer = Buffer.from(await videoRes.arrayBuffer());
  const path = saveBuffer(buffer, 'videos', 'mp4');
  return path;
};
