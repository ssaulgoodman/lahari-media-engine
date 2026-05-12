/**
 * Pre-bundle the Remotion composition at Docker build time so cold containers
 * skip the ~15-30s bundle step on the first render. `src/render.ts` checks
 * for the output directory at runtime and uses it when present.
 *
 * Output goes to `<renderer>/bundle/` (next to `src/`, `dist/`, etc.). The
 * bundle directory is bake-able into the Docker image but git-ignored locally.
 */
import { bundle } from '@remotion/bundler';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY_POINT = path.resolve(__dirname, '..', 'src', 'entry.tsx');
const OUT_DIR = path.resolve(__dirname, '..', 'bundle');

const start = Date.now();
console.log(`[prebundle] entry: ${ENTRY_POINT}`);
console.log(`[prebundle] out:   ${OUT_DIR}`);

try {
  const result = await bundle({ entryPoint: ENTRY_POINT, outDir: OUT_DIR });
  const ms = Date.now() - start;
  console.log(`[prebundle] done in ${ms}ms → ${result}`);
} catch (err) {
  console.error('[prebundle] failed:', err);
  process.exit(1);
}
