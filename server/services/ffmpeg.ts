/**
 * ffmpeg utilities — extract frames from video files.
 * Provider-independent: works with any video regardless of how it was generated.
 */
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { downloadToTmp, uploadFromTmp } from '../storage.js';

const runProcess = async (command: 'ffmpeg' | 'ffprobe', args: string[]): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => reject(new Error(`${command} spawn failed: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-400)}`));
    });
  });
};

const cacheOutputPath = (ext: string): string => {
  const outputFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const outputLocal = path.join(os.tmpdir(), 'lahari-cache', outputFilename);
  fs.mkdirSync(path.dirname(outputLocal), { recursive: true });
  return outputLocal;
};

export const probeMediaDurationSec = async (storagePath: string): Promise<number> => {
  const localMedia = await downloadToTmp(storagePath);
  const stdout = await runProcess('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    localMedia,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not read media duration for ${storagePath}.`);
  }
  return duration;
};

/**
 * Extract the last frame from a video file using ffmpeg.
 * Downloads from Supabase Storage, runs ffmpeg, uploads result back.
 * Returns the storage-relative path of the saved frame (PNG).
 */
export const extractLastFrame = async (videoStoragePath: string): Promise<string> => {
  const localVideo = await downloadToTmp(videoStoragePath);

  const outputLocal = cacheOutputPath('png');

  await runProcess('ffmpeg', [
    '-sseof', '-0.1',
    '-i', localVideo,
    '-vsync', '0',
    '-frames:v', '1',
    '-q:v', '2',
    '-y',
    outputLocal,
  ]);

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

  const outputLocal = cacheOutputPath('mp3');

  await runProcess('ffmpeg', [
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
  ]);

  return uploadFromTmp(outputLocal, 'audio', 'mp3');
};

export const extractVideoAudioSegment = async (
  videoStoragePath: string,
  startSec: number,
  durationSec: number,
): Promise<string> => {
  const localVideo = await downloadToTmp(videoStoragePath);
  const safeStart = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
  const safeDuration = Math.max(0.25, Number.isFinite(durationSec) ? durationSec : 0.25);
  const outputLocal = cacheOutputPath('mp3');

  await runProcess('ffmpeg', [
    '-ss', String(safeStart),
    '-t', String(safeDuration),
    '-i', localVideo,
    '-vn',
    '-ac', '1',
    '-ar', '44100',
    '-c:a', 'libmp3lame',
    '-b:a', '160k',
    '-y',
    outputLocal,
  ]);

  return uploadFromTmp(outputLocal, 'audio', 'mp3');
};

export const replaceVideoAudioWithSegments = async (
  videoStoragePath: string,
  segments: Array<{ audioStoragePath: string; startSec: number; durationSec: number }>,
  totalDurationSec?: number,
): Promise<string> => {
  if (!segments.length) throw new Error('At least one audio segment is required.');
  const localVideo = await downloadToTmp(videoStoragePath);
  const localAudios = await Promise.all(segments.map((segment) => downloadToTmp(segment.audioStoragePath)));
  const totalSec = Math.max(0.25, totalDurationSec || await probeMediaDurationSec(videoStoragePath));
  const outputLocal = cacheOutputPath('mp4');

  const inputArgs = localAudios.flatMap((input) => ['-i', input]);
  const segmentFilters = segments.map((segment, index) => {
    const inputIndex = index + 1;
    const delayMs = Math.max(0, Math.round(segment.startSec * 1000));
    const durationSecSafe = Math.max(0.25, Math.min(segment.durationSec, totalSec));
    return `[${inputIndex}:a]atrim=0:${durationSecSafe.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs},apad,atrim=0:${totalSec.toFixed(3)}[a${index}]`;
  });
  const outputFilter = segments.length === 1
    ? '[a0]anull[aout]'
    : `${segments.map((_, index) => `[a${index}]`).join('')}amix=inputs=${segments.length}:duration=longest:normalize=0,atrim=0:${totalSec.toFixed(3)},asetpts=PTS-STARTPTS[aout]`;
  const filter = [...segmentFilters, outputFilter].join(';');

  await runProcess('ffmpeg', [
    '-i', localVideo,
    ...inputArgs,
    '-filter_complex', filter,
    '-map', '0:v:0',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', process.env.FFMPEG_AUDIO_BITRATE || '192k',
    '-t', totalSec.toFixed(3),
    '-y',
    outputLocal,
  ]);

  return uploadFromTmp(outputLocal, 'videos', 'mp4');
};

/**
 * Concatenate short dialogue clips into one shot-level MP3 reference.
 * Seedance accepts a single reference audio today, so lipsync shots with
 * multiple generated TTS lines need one compact audio asset.
 */
export const concatenateAudioFiles = async (audioStoragePaths: string[]): Promise<string> => {
  const paths = audioStoragePaths.filter(Boolean);
  if (paths.length === 0) throw new Error('No audio files provided for concat.');
  if (paths.length === 1) return paths[0];

  const localInputs = await Promise.all(paths.map((p) => downloadToTmp(p)));
  const outputLocal = cacheOutputPath('mp3');

  const inputArgs = localInputs.flatMap((input) => ['-i', input]);
  const concatInputs = localInputs.map((_, index) => `[${index}:a]`).join('');
  await runProcess('ffmpeg', [
    ...inputArgs,
    '-filter_complex',
    `${concatInputs}concat=n=${localInputs.length}:v=0:a=1[aout]`,
    '-map',
    '[aout]',
    '-ac',
    '2',
    '-ar',
    '44100',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '160k',
    '-y',
    outputLocal,
  ]);

  return uploadFromTmp(outputLocal, 'audio', 'mp3');
};
