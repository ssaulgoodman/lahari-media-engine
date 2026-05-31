#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadReleaseEnv, requireEnv, rootDir, run } from './release-env.mjs';

loadReleaseEnv();

const cliPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'packages', 'mirage-cli', 'package.json'), 'utf8'));
const cliPackage = `${cliPkg.name}@${cliPkg.version}`;
const railwayToken = process.env.RAILWAY_TOKEN_MIRAGE || process.env.RAILWAY_TOKEN || process.env.RAILWAY_TOKEN_LAHARI;
if (!railwayToken) {
  requireEnv('RAILWAY_TOKEN', 'Add it to .env.release.local from Railway project/account token settings, or expose RAILWAY_TOKEN_MIRAGE / RAILWAY_TOKEN_LAHARI.');
}
const env = { ...process.env, RAILWAY_TOKEN: railwayToken };

console.log(`Setting Railway MIRAGE_CLI_PACKAGE=${cliPackage}`);
run('railway', ['variable', 'set', `MIRAGE_CLI_PACKAGE=${cliPackage}`], { env });

console.log('Deploying Mirage to Railway...');
run('railway', ['up', '--detach'], { env });

const deadline = Date.now() + 10 * 60 * 1000;
let lastStatus = '';

while (Date.now() < deadline) {
  const result = run('railway', ['deployment', 'list'], { env, capture: true });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const firstLine = output.split('\n').find((line) => line.trim().match(/^[a-f0-9-]{36}\s+\|/));
  if (firstLine) {
    const parts = firstLine.split('|').map((part) => part.trim());
    const id = parts[0];
    const status = parts[1];
    if (`${id}:${status}` !== lastStatus) {
      console.log(`Deployment ${id}: ${status}`);
      lastStatus = `${id}:${status}`;
    }
    if (status === 'SUCCESS') {
      console.log(`Railway deployment ${id} succeeded.`);
      process.exit(0);
    }
    if (['FAILED', 'CRASHED', 'REMOVED'].includes(status)) {
      console.error(`Railway deployment ${id} ended with ${status}.`);
      process.exit(1);
    }
  } else if (output.trim()) {
    console.log(output.trim());
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

console.error('Timed out waiting for Railway deployment to finish.');
process.exit(1);
