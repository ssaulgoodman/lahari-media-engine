#!/usr/bin/env node
// Copy the render-authoritative timeline files from the main repo into this
// service so the Remotion composition stays in lockstep with the in-app
// editor's preview. Run after editing components/timeline-editor/*.
//
// Why a copy instead of a relative import: the renderer ships as its own
// Docker image and installs only its own deps. A copy keeps the build context
// local and avoids npm-workspace gymnastics.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const srcDir = resolve(repoRoot, 'components', 'timeline-editor');
const destDir = resolve(__dirname, '..', 'src', 'timeline');

const banner = (filename) =>
  `// SYNCED FROM components/timeline-editor/${filename} — re-run\n` +
  `// \`npm run sync-timeline\` after editing the upstream file.\n`;

// Plain copy with banner.
const copyPlain = (filename) => {
  const src = readFileSync(resolve(srcDir, filename), 'utf8');
  writeFileSync(resolve(destDir, filename), banner(filename) + src);
  console.log(`  ✓ ${filename}`);
};

// Composition needs the zustand wrapper stripped — the SSR renderer has no
// store. Replace the './store' import and the StoreComposition default export.
const copyComposition = () => {
  const filename = 'Composition.tsx';
  let src = readFileSync(resolve(srcDir, filename), 'utf8');

  src = src.replace(/^import useStore from '\.\/store';\n/m, '');

  src = src.replace(
    /\/\/ Thin wrapper that pulls render-authoritative state[\s\S]*?export default StoreComposition;\s*$/m,
    'export default Composition;\n',
  );

  writeFileSync(resolve(destDir, filename), banner(filename) + src);
  console.log(`  ✓ ${filename} (zustand wrapper stripped)`);
};

console.log('Syncing timeline files into remotion-renderer/src/timeline/');
copyPlain('effects.ts');
copyPlain('track-items-utils.ts');
copyComposition();
console.log('Done.');
