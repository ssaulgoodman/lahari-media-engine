import os from 'node:os';
import { unlink } from 'node:fs/promises';
import { renderTimeline } from './render';
import { track, trackError } from './posthog';
import type { TimelineRenderProps } from './Video';

// Inlined instead of imported as a value from ./Video so the server entrypoint
// doesn't transitively load Composition.tsx at boot. Composition.tsx imports
// @designcombo/transitions, whose package.json lacks "type": "module" — Node's
// strict ESM loader then parses its dist/index.es.js as CJS and crashes with
// "does not provide an export named 'TransitionSeries'". The package is meant
// to run inside the Remotion bundler (Vite), not through Node's loader.
const BENCHMARK_PROPS: TimelineRenderProps = {
  trackItemIds: [],
  trackItemsMap: {},
  transitionsMap: {},
  fps: 30,
  size: { width: 1920, height: 1080 },
  durationMs: 1000,
};

// One-shot render of a 1-second empty composition to measure the per-frame
// cost of the current container's hardware + Remotion config. Includes the
// first-bundle cost (~10s) which is the realistic cold-start figure.
export const runBootBenchmark = async (): Promise<void> => {
  const startedAt = Date.now();
  console.log('[benchmark] starting: 30 frames @ 1920x1080, empty comp');

  let outputPath: string | undefined;
  try {
    const result = await renderTimeline(BENCHMARK_PROPS);
    outputPath = result.outputPath;
    const elapsedMs = Date.now() - startedAt;
    const msPerFrame = elapsedMs / result.durationInFrames;
    const framesPerSecond = (result.durationInFrames / elapsedMs) * 1000;

    console.log(
      `[benchmark] done: ${result.durationInFrames} frames in ${elapsedMs}ms ` +
        `(${msPerFrame.toFixed(1)}ms/frame, ${framesPerSecond.toFixed(1)} fps)`,
    );

    track('renderer_benchmark', 'boot', {
      elapsedMs,
      durationInFrames: result.durationInFrames,
      msPerFrame,
      framesPerSecond,
      width: result.width,
      height: result.height,
      cpuCount: os.cpus().length,
      cpuModel: os.cpus()[0]?.model,
      totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
      nodeVersion: process.version,
      platform: `${os.platform()}-${os.arch()}`,
    });
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[benchmark] failed after ${Date.now() - startedAt}ms:`, message);
    trackError('boot', err, { stage: 'boot_benchmark' });
  } finally {
    if (outputPath) await unlink(outputPath).catch(() => {});
  }
};
