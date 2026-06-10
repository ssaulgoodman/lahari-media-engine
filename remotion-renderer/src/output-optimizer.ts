import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_MAX_UPLOAD_BYTES = 240 * 1024 * 1024;

const numberEnv = (name: string, fallback: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const maxUploadBytes = () => Math.round(numberEnv('RENDER_MAX_UPLOAD_BYTES', DEFAULT_MAX_UPLOAD_BYTES));

const runFfmpeg = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg compress failed with exit ${code}. stderr tail:\n${stderr.trim().slice(-4000)}`));
    });
  });

export interface UploadableOutput {
  outputPath: string;
  sizeBytes: number;
  compressed: boolean;
  originalSizeBytes: number;
  maxBytes: number;
}

export const ensureUploadableMp4 = async (
  inputPath: string,
  durationSec: number,
): Promise<UploadableOutput> => {
  const maxBytes = maxUploadBytes();
  const originalSizeBytes = (await stat(inputPath)).size;
  if (originalSizeBytes <= maxBytes) {
    return { outputPath: inputPath, sizeBytes: originalSizeBytes, compressed: false, originalSizeBytes, maxBytes };
  }

  const safeDurationSec = Math.max(1, durationSec);
  const targetBytes = Math.floor(maxBytes * 0.88);
  const audioKbps = Math.min(160, Math.max(96, Math.round(numberEnv('RENDER_COMPRESS_AUDIO_KBPS', 128))));
  const totalKbps = Math.max(800, Math.floor((targetBytes * 8) / safeDurationSec / 1000));
  const videoKbps = Math.max(650, totalKbps - audioKbps);
  const outputPath = path.join(tmpdir(), `lahari-render-compressed-${randomUUID()}.mp4`);

  await runFfmpeg([
    '-hide_banner',
    '-loglevel', 'warning',
    '-y',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', process.env.RENDER_COMPRESS_PRESET || 'veryfast',
    '-b:v', `${videoKbps}k`,
    '-maxrate', `${Math.round(videoKbps * 1.25)}k`,
    '-bufsize', `${Math.round(videoKbps * 2)}k`,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', `${audioKbps}k`,
    '-movflags', '+faststart',
    outputPath,
  ]);

  const compressedSize = (await stat(outputPath)).size;
  if (compressedSize > maxBytes) {
    await unlink(outputPath).catch(() => {});
    throw new Error(
      `Render output too large after compression (${compressedSize} bytes, max ${maxBytes}). ` +
      `Try a shorter render or lower resolution.`,
    );
  }

  return {
    outputPath,
    sizeBytes: compressedSize,
    compressed: true,
    originalSizeBytes,
    maxBytes,
  };
};
