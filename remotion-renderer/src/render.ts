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
    // Supabase is still us-east — fetching OffthreadVideo segments from Asia-hosted
    // Chromium regularly exceeds the 28s default. Bumped until Supabase moves to ap-south-1.
    timeoutInMilliseconds: 120000,
    // concurrency:1 — parallel workers race inside the Rust compositor's frame
    // cache and trigger Option::unwrap() panics (frame_cache.rs:257). Serial
    // rendering is slower but deterministic.
    concurrency: 1,
    chromiumOptions: { gl: 'swiftshader' },
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
