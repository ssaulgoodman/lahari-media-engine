#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isolatedCacheDir, loadReleaseEnv, requireEnv, rootDir, run } from './release-env.mjs';

loadReleaseEnv();

const cliDir = path.join(rootDir, 'packages', 'mirage-cli');
const pkgPath = path.join(cliDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const npmToken = requireEnv('NPM_TOKEN', 'Add it to .env.release.local from an npm automation token with publish rights.');
const cacheDir = isolatedCacheDir('mirage-npm-cache');
const userConfigPath = path.join(cacheDir, 'mirage-publish.npmrc');

fs.writeFileSync(userConfigPath, [
  '@ssaulgoodman420:registry=https://registry.npmjs.org/',
  '//registry.npmjs.org/:_authToken=${NPM_TOKEN}',
  'always-auth=true',
  '',
].join('\n'));

const npmEnv = {
  ...process.env,
  NPM_TOKEN: npmToken,
  NPM_CONFIG_CACHE: cacheDir,
  npm_config_cache: cacheDir,
  NPM_CONFIG_USERCONFIG: userConfigPath,
  npm_config_userconfig: userConfigPath,
};

const existing = run('npm', ['view', `${pkg.name}@${pkg.version}`, 'version'], {
  cwd: cliDir,
  env: npmEnv,
  capture: true,
});

if (existing.status === 0 && existing.stdout.trim() === pkg.version) {
  console.log(`${pkg.name}@${pkg.version} is already published.`);
  process.exit(0);
}

console.log(`Publishing ${pkg.name}@${pkg.version} with isolated npm cache...`);
run('npm', ['publish', '--access', 'public'], {
  cwd: cliDir,
  env: npmEnv,
});

const verify = run('npm', ['view', `${pkg.name}@${pkg.version}`, 'version'], {
  cwd: cliDir,
  env: npmEnv,
  capture: true,
});

if (verify.status !== 0 || verify.stdout.trim() !== pkg.version) {
  console.error(`Publish verification failed for ${pkg.name}@${pkg.version}.`);
  process.exit(1);
}

console.log(`Published ${pkg.name}@${pkg.version}.`);

