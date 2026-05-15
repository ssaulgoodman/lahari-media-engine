/**
 * ffmpeg utilities — extract frames from video files.
 * Provider-independent: works with any video regardless of how it was generated.
 */
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { downloadToTmp, uploadFromTmp } from '../storage.js';

/**
 * Extract the last frame from a video file using ffmpeg.
 * Downloads from Supabase Storage, runs ffmpeg, uploads result back.
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
 * Extract an audio segment from the source song for model reference input.
 * Returns the storage-relative path of a short MP3 clip.
 */
export const extractAudioSegment = async (
  audioStoragePath: string,
  startSec: number,
  durationSec: number,
): Promise<string> => {
  const localAudio = await downloadToTmp(audioStoragePath);
  const safeStart = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
  const safeDuration = Math.max(1, Number.isFinite(durationSec) ? durationSec : 1);

  const outputFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
  const outputLocal = path.join(os.tmpdir(), 'lahari-cache', outputFilename);
  fs.mkdirSync(path.dirname(outputLocal), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const args = [
      '-ss', String(safeStart),
      '-t', String(safeDuration),
      '-i', localAudio,
      '-vn',
      '-ac', '2',
      '-ar', '44100',
      '-c:a', 'libmp3lame',
      '-b:a', '160k',
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

  return uploadFromTmp(outputLocal, 'audio', 'mp3');
};
