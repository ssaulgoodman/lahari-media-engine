#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isolatedCacheDir, loadReleaseEnv, requireEnv, rootDir, run } from './release-env.mjs';

loadReleaseEnv();

const args = process.argv.slice(2);
const hasArg = (name) => args.includes(name);

if (hasArg('--help') || hasArg('-h')) {
  console.log(`Usage: npm run release:mirage-cli -- [--dry-run]

Publishes packages/mirage-cli to npm and verifies the exact version.

Required env for real publish:
  NPM_TOKEN  npm automation token with publish rights for @ssaulgoodman420/mirage-cli`);
  process.exit(0);
}

const dryRun = hasArg('--dry-run');
const cliDir = path.join(rootDir, 'packages', 'mirage-cli');
const pkgPath = path.join(cliDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const cacheDir = isolatedCacheDir('mirage-npm-cache');
const userConfigPath = path.join(cacheDir, 'mirage-publish.npmrc');

const npmToken = dryRun ? '' : requireEnv('NPM_TOKEN', 'Add it to .env.release.local from an npm automation token with publish rights.');

if (!dryRun) {
  fs.writeFileSync(userConfigPath, [
    '@ssaulgoodman420:registry=https://registry.npmjs.org/',
    '//registry.npmjs.org/:_authToken=${NPM_TOKEN}',
    'always-auth=true',
    '',
  ].join('\n'));
}

const npmEnv = {
  ...process.env,
  NPM_TOKEN: npmToken,
  NPM_CONFIG_CACHE: cacheDir,
  npm_config_cache: cacheDir,
};

if (!dryRun) {
  npmEnv.NPM_CONFIG_USERCONFIG = userConfigPath;
  npmEnv.npm_config_userconfig = userConfigPath;
}

const existing = run('npm', ['view', `${pkg.name}@${pkg.version}`, 'version'], {
  cwd: cliDir,
  env: npmEnv,
  capture: true,
});

if (existing.status === 0 && existing.stdout.trim() === pkg.version) {
  console.log(`${pkg.name}@${pkg.version} is already published.`);
  process.exit(0);
}

if (dryRun) {
  console.log(`Dry run: checking ${pkg.name}@${pkg.version} package contents with isolated npm cache...`);
  run('npm', ['publish', '--dry-run', '--access', 'public'], {
    cwd: cliDir,
    env: npmEnv,
  });
  process.exit(0);
}

const viewPublishedVersion = () => run('npm', ['view', `${pkg.name}@${pkg.version}`, 'version'], {
  cwd: cliDir,
  env: npmEnv,
  capture: true,
});

console.log(`Publishing ${pkg.name}@${pkg.version} with isolated npm cache...`);
run('npm', ['publish', '--access', 'public'], {
  cwd: cliDir,
  env: npmEnv,
});

let verify = viewPublishedVersion();
for (let attempt = 0; (verify.status !== 0 || verify.stdout.trim() !== pkg.version) && attempt < 5; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  verify = viewPublishedVersion();
}

if (verify.status !== 0 || verify.stdout.trim() !== pkg.version) {
  console.error(`Publish verification failed for ${pkg.name}@${pkg.version}.`);
  process.exit(1);
}

console.log(`Published ${pkg.name}@${pkg.version}.`);
