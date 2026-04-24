import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TimelineRenderProps } from './Video';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let bundlePromise: Promise<string> | null = null;

// Bundle once per process; subsequent renders reuse the served bundle.
const getServeUrl = (): Promise<string> => {
  if (bundlePromise) return bundlePromise;
  bundlePromise = bundle({
    entryPoint: path.resolve(__dirname, 'entry.tsx'),
  });
  return bundlePromise;
};

export interface RenderResult {
  outputPath: string;
  durationInFrames: number;
  width: number;
  height: number;
}

export const renderTimeline = async (
  inputProps: TimelineRenderProps,
  onProgress?: (p: number) => void,
): Promise<RenderResult> => {
  const serveUrl = await getServeUrl();

  const composition = await selectComposition({
    serveUrl,
    id: 'LahariTimeline',
    inputProps: inputProps as unknown as Record<string, unknown>,
    timeoutInMilliseconds: 120000,
  });

  const outputPath = path.join(tmpdir(), `lahari-render-${randomUUID()}.mp4`);

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps: inputProps as unknown as Record<string, unknown>,
    // Supabase is still us-east — frame fetches from Asia-hosted Chromium
    // regularly exceed the 28s default. Bumped until Supabase moves to ap-south-1.
    timeoutInMilliseconds: 120000,
    // '100%' uses every CPU thread. The earlier frame_cache.rs:257 panic no
    // longer reproduces on 4.0.449 (verified via `npm run benchmark` with
    // concurrency=8). If it returns, drop to a literal number like 2 or 4.
    concurrency: '100%',
    chromiumOptions: { gl: 'swiftshader' },
    // Encoder tuning. `veryfast` preset + crf 26 is ~3× faster than the default
    // `medium` + crf 23 with visually-negligible quality loss for review renders.
    x264Preset: 'veryfast',
    crf: 26,
    // Intermediate frame capture quality. Default is 80; 70 shaves disk I/O on
    // long renders with no perceptible impact on the final H.264 output.
    jpegQuality: 70,
    // 'warn' silences Remotion's per-frame and stitching chatter while still
    // surfacing real problems. Bump to 'verbose' temporarily when profiling.
    logLevel: 'warn',
    onProgress: onProgress
      ? ({ progress }) => onProgress(progress)
      : undefined,
  });

  return {
    outputPath,
    durationInFrames: composition.durationInFrames,
    width: composition.width,
    height: composition.height,
  };
};
