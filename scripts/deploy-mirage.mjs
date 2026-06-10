#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadReleaseEnv, requireEnv, rootDir, run } from './release-env.mjs';

loadReleaseEnv();

const args = process.argv.slice(2);
const hasArg = (name) => args.includes(name);

if (hasArg('--help') || hasArg('-h')) {
  console.log(`Usage: npm run deploy:mirage -- [--dry-run]

Deploys the Mirage Railway service only.

Required env:
  RAILWAY_TOKEN_MIRAGE  Railway token scoped to the mirage-platform project

Guards:
  - ignores generic RAILWAY_TOKEN
  - verifies Railway project/service names before mutating anything`);
  process.exit(0);
}

const dryRun = hasArg('--dry-run');
const cliPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'packages', 'mirage-cli', 'package.json'), 'utf8'));
const cliPackage = `${cliPkg.name}@${cliPkg.version}`;

const railwayToken = requireEnv(
  'RAILWAY_TOKEN_MIRAGE',
  'Add a Mirage-scoped Railway token to .env.release.local. Do not use generic Railway tokens for Mirage deploys.',
);

if (process.env.RAILWAY_TOKEN && process.env.RAILWAY_TOKEN !== railwayToken) {
  console.warn('Ignoring generic RAILWAY_TOKEN. Mirage deploys require RAILWAY_TOKEN_MIRAGE.');
}
const env = { ...process.env, RAILWAY_TOKEN: railwayToken };

const status = run('railway', ['status', '--json'], { env, capture: true });
if (status.status !== 0) {
  console.error(status.stderr || status.stdout || 'Failed to read Railway status.');
  process.exit(status.status || 1);
}

let project;
try {
  project = JSON.parse(status.stdout);
} catch (error) {
  console.error('Could not parse Railway status JSON.');
  console.error(status.stdout);
  process.exit(1);
}

const serviceNames = (project.environments?.edges || [])
  .flatMap((edge) => edge.node?.serviceInstances?.edges || [])
  .map((edge) => edge.node?.serviceName)
  .filter(Boolean);

if (project.name !== 'mirage-platform' || !serviceNames.includes('mirage-platform')) {
  console.error(`Refusing to deploy: Railway target is project=${project.name || 'unknown'} services=${serviceNames.join(',') || 'none'}.`);
  console.error('Expected project=mirage-platform with service=mirage-platform.');
  process.exit(1);
}

if (dryRun) {
  console.log(`Dry run OK: Railway target is ${project.name}/mirage-platform; would set MIRAGE_CLI_PACKAGE=${cliPackage} and deploy.`);
  process.exit(0);
}

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
