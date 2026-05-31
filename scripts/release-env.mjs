import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const rootDir = path.resolve(new URL('..', import.meta.url).pathname);

export const loadReleaseEnv = () => {
  const envPath = path.join(rootDir, '.env.release.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
};

export const isolatedCacheDir = (name) => {
  const base = process.env.TMPDIR || os.tmpdir();
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

export const run = (command, args, opts = {}) => {
  const result = spawnSync(command, args, {
    cwd: opts.cwd || rootDir,
    env: opts.env || process.env,
    encoding: 'utf8',
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (opts.capture) return result;
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  return result;
};

export const requireEnv = (key, hint) => {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing ${key}. ${hint}`);
    process.exit(2);
  }
  return value;
};

