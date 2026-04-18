// Bundle entry point. `bundle()` in render.ts points here, and
// `npx remotion studio src/entry.tsx` uses the same file for local preview.
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
