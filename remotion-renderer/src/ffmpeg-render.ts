import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RenderResult } from './render';
import type { TimelineRenderProps } from './Video';

type TimelineItem = TimelineRenderProps['trackItemsMap'][string] & {
  playbackRate?: number;
  trim?: { from: number; to: number };
};

type Eligibility =
  | { ok: true }
  | { ok: false; reason: string };

type FfmpegInput =
  | { kind: 'video'; src: string; trimFromSec: number; durationSec: number }
  | { kind: 'image'; src: string; durationSec: number }
  | { kind: 'black'; durationSec: number };

type AudioInput = {
  src: string;
  trimFromSec: number;
  durationSec: number;
  delayMs: number;
  volume: number;
};

const EFFECT_DEFAULTS: Record<string, number> = {
  brightness: 100,
  blur: 0,
  opacity: 100,
  contrast: 100,
  saturate: 100,
  grayscale: 0,
  sepia: 0,
  hueRotate: 0,
  invert: 0,
};

const numberEnv = (name: string, fallback: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const ffmpegPreset = () => process.env.FFMPEG_PRESET || 'veryfast';
const ffmpegCrf = () => String(Math.round(numberEnv('FFMPEG_CRF', 23)));

const seconds = (ms: number) => Math.max(0, ms / 1000);
const frameMs = (fps: number) => 1000 / fps;

const itemDurationMs = (item: TimelineItem) => Math.max(0, item.display.to - item.display.from);

const hasNonDefaultEffects = (details: any) => {
  for (const [key, defaultValue] of Object.entries(EFFECT_DEFAULTS)) {
    if (details?.[key] !== undefined && Number(details[key]) !== defaultValue) return true;
  }
  return false;
};

const hasLayoutOverrides = (details: any) => {
  if (!details) return false;
  const layoutKeys = [
    'top',
    'left',
    'right',
    'bottom',
    'x',
    'y',
    'width',
    'height',
    'scale',
    'scaleX',
    'scaleY',
    'rotate',
    'rotation',
    'transform',
    'objectFit',
    'objectPosition',
    'crop',
  ];
  return layoutKeys.some((key) => details[key] !== undefined && details[key] !== null);
};

const itemSrc = (item: TimelineItem) => {
  const src = (item as any)?.details?.src;
  return typeof src === 'string' && src.trim().length > 0 ? src : undefined;
};

const orderedItems = (inputProps: TimelineRenderProps) =>
  inputProps.trackItemIds
    .map((id) => inputProps.trackItemsMap[id] as TimelineItem | undefined)
    .filter(Boolean) as TimelineItem[];

export const canRenderWithFfmpeg = (inputProps: TimelineRenderProps): Eligibility => {
  const items = orderedItems(inputProps);
  if (items.length === 0) return { ok: false, reason: 'timeline has no items' };

  const transitions = Object.values(inputProps.transitionsMap || {});
  if (transitions.some((transition: any) => transition?.kind && transition.kind !== 'none')) {
    return { ok: false, reason: 'timeline has transitions' };
  }

  const tolerance = frameMs(inputProps.fps) / 2;
  const visualItems = items
    .filter((item) => item.type === 'video' || item.type === 'image')
    .sort((a, b) => a.display.from - b.display.from);

  let previousEnd = 0;
  for (const item of items) {
    if (!['video', 'image', 'audio'].includes(String(item.type))) {
      return { ok: false, reason: `unsupported item type ${item.type}` };
    }
    if ((item.playbackRate ?? 1) !== 1) {
      return { ok: false, reason: 'timeline has playback-rate changes' };
    }
    if (!itemSrc(item)) {
      return { ok: false, reason: `${item.type} item is missing details.src` };
    }
    if (item.type === 'video' || item.type === 'image') {
      const details = (item as any).details || {};
      if (hasNonDefaultEffects(details)) {
        return { ok: false, reason: 'timeline has visual effects' };
      }
      if (hasLayoutOverrides(details)) {
        return { ok: false, reason: 'timeline has custom visual positioning' };
      }
    }
  }

  for (const item of visualItems) {
    if (item.display.from < previousEnd - tolerance) {
      return { ok: false, reason: 'timeline has overlapping visual clips' };
    }
    previousEnd = Math.max(previousEnd, item.display.to);
  }

  return { ok: true };
};

const buildVisualInputs = (inputProps: TimelineRenderProps): FfmpegInput[] => {
  const totalMs = inputProps.durationMs;
  const tolerance = frameMs(inputProps.fps) / 2;
  const visualItems = orderedItems(inputProps)
    .filter((item) => item.type === 'video' || item.type === 'image')
    .sort((a, b) => a.display.from - b.display.from);

  const inputs: FfmpegInput[] = [];
  let cursorMs = 0;

  const addBlack = (durationMs: number) => {
    if (durationMs > tolerance) inputs.push({ kind: 'black', durationSec: seconds(durationMs) });
  };

  for (const item of visualItems) {
    addBlack(item.display.from - cursorMs);
    const durationMs = Math.min(itemDurationMs(item), Math.max(0, totalMs - item.display.from));
    if (durationMs > tolerance) {
      const src = itemSrc(item)!;
      if (item.type === 'image') {
        inputs.push({ kind: 'image', src, durationSec: seconds(durationMs) });
      } else {
        const trim = item.trim || { from: 0, to: durationMs };
        inputs.push({
          kind: 'video',
          src,
          trimFromSec: seconds(trim.from || 0),
          durationSec: seconds(durationMs),
        });
      }
    }
    cursorMs = Math.max(cursorMs, item.display.to);
  }

  addBlack(totalMs - cursorMs);
  if (inputs.length === 0) inputs.push({ kind: 'black', durationSec: seconds(totalMs) });
  return inputs;
};

const buildAudioInputs = (inputProps: TimelineRenderProps): AudioInput[] =>
  orderedItems(inputProps)
    .filter((item) => item.type === 'audio')
    .map((item) => {
      const durationMs = itemDurationMs(item);
      const trim = item.trim || { from: 0, to: durationMs };
      const volume = Number((item as any).details?.volume ?? 100) / 100;
      return {
        src: itemSrc(item)!,
        trimFromSec: seconds(trim.from || 0),
        durationSec: seconds(durationMs),
        delayMs: Math.max(0, Math.round(item.display.from)),
        volume: Number.isFinite(volume) ? volume : 1,
      };
    });

const parseFfmpegTime = (line: string) => {
  const match = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const secs = Number(match[3]);
  if (![hours, minutes, secs].every(Number.isFinite)) return undefined;
  return hours * 3600 + minutes * 60 + secs;
};

const runFfmpeg = (
  args: string[],
  totalSec: number,
  onProgress?: (progress: number) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      const time = parseFfmpegTime(chunk);
      if (time !== undefined && totalSec > 0) {
        onProgress?.(Math.max(0, Math.min(0.99, time / totalSec)));
      }
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        onProgress?.(1);
        resolve();
      } else {
        const tail = stderr.trim().slice(-4000);
        reject(new Error(`ffmpeg render failed with exit ${code}. stderr tail:\n${tail}`));
      }
    });
  });

export const renderTimelineWithFfmpeg = async (
  inputProps: TimelineRenderProps,
  onProgress?: (progress: number) => void,
): Promise<RenderResult> => {
  const { width, height } = inputProps.size;
  const fps = inputProps.fps;
  const totalSec = seconds(inputProps.durationMs);
  const visualInputs = buildVisualInputs(inputProps);
  const audioInputs = buildAudioInputs(inputProps);
  const args = ['-hide_banner', '-loglevel', 'warning', '-stats', '-y'];
  const visualLabels: string[] = [];
  const audioLabels: string[] = [];
  let inputIndex = 0;
  let filter = '';

  for (const input of visualInputs) {
    const currentIndex = inputIndex;
    if (input.kind === 'black') {
      args.push('-f', 'lavfi', '-t', String(input.durationSec), '-i', `color=c=black:s=${width}x${height}:r=${fps}`);
    } else if (input.kind === 'image') {
      args.push('-loop', '1', '-t', String(input.durationSec), '-i', input.src);
    } else {
      args.push('-ss', String(input.trimFromSec), '-t', String(input.durationSec), '-i', input.src);
    }

    const label = `v${visualLabels.length}`;
    filter += `[${currentIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[${label}];`;
    visualLabels.push(label);
    inputIndex += 1;
  }

  for (const input of audioInputs) {
    const currentIndex = inputIndex;
    args.push('-ss', String(input.trimFromSec), '-t', String(input.durationSec), '-i', input.src);
    const label = `a${audioLabels.length}`;
    const delay = Math.max(0, input.delayMs);
    filter += `[${currentIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
      `asetpts=PTS-STARTPTS,adelay=${delay}|${delay},volume=${input.volume}[${label}];`;
    audioLabels.push(label);
    inputIndex += 1;
  }

  if (visualLabels.length === 1) {
    filter += `[${visualLabels[0]}]trim=0:${totalSec},setpts=PTS-STARTPTS[vout];`;
  } else {
    filter += visualLabels.map((label) => `[${label}]`).join('') +
      `concat=n=${visualLabels.length}:v=1:a=0,trim=0:${totalSec},setpts=PTS-STARTPTS[vout];`;
  }

  if (audioLabels.length === 1) {
    filter += `[${audioLabels[0]}]atrim=0:${totalSec},asetpts=PTS-STARTPTS[aout];`;
  } else if (audioLabels.length > 1) {
    filter += audioLabels.map((label) => `[${label}]`).join('') +
      `amix=inputs=${audioLabels.length}:duration=longest:normalize=0,atrim=0:${totalSec},asetpts=PTS-STARTPTS[aout];`;
  }

  const outputPath = path.join(tmpdir(), `lahari-ffmpeg-render-${randomUUID()}.mp4`);
  const filterComplex = filter.replace(/;+$/, '');
  args.push('-filter_complex', filterComplex, '-map', '[vout]');
  if (audioLabels.length > 0) args.push('-map', '[aout]');
  args.push(
    '-t', String(totalSec),
    '-r', String(fps),
    '-c:v', 'libx264',
    '-preset', ffmpegPreset(),
    '-crf', ffmpegCrf(),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
  );
  if (audioLabels.length > 0) args.push('-c:a', 'aac', '-b:a', process.env.FFMPEG_AUDIO_BITRATE || '192k');
  args.push(outputPath);

  await runFfmpeg(args, totalSec, onProgress);
  return {
    outputPath,
    durationInFrames: Math.max(1, Math.round(totalSec * fps)),
    width,
    height,
  };
};
