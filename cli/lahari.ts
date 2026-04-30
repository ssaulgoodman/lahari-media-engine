#!/usr/bin/env node
import 'dotenv/config';
import { getFullProject } from '../server/routes/projects.js';
import {
  buildProjectContactSheet,
  buildProjectPacket,
  buildProjectReport,
  buildShotPacket,
  defaultArtifactPath,
  listProjects,
  writeArtifact,
} from '../server/services/codexStudio.js';

const usage = () => {
  console.log(`Lahari CLI

Read-only Codex-native studio helpers.

Usage:
  npm run lahari -- project list [limit]
  npm run lahari -- project packet <projectId>
  npm run lahari -- project report <projectId> [out.md]
  npm run lahari -- project contact-sheet <projectId> [out.html]
  npm run lahari -- shot packet <projectId> <shotId>

Output:
  JSON packets and local review artifacts designed for Codex inspection and future MCP wrapping.
`);
};

const main = async () => {
  const [domain, action, projectId, arg4] = process.argv.slice(2);

  if (!domain || domain === 'help' || domain === '--help' || domain === '-h') {
    usage();
    return;
  }

  if (domain === 'project' && action === 'list') {
    console.log(JSON.stringify(await listProjects(projectId), null, 2));
    return;
  }

  if (domain === 'project' && action === 'packet' && projectId) {
    const project = await getFullProject(projectId);
    console.log(JSON.stringify(buildProjectPacket(project), null, 2));
    return;
  }

  if (domain === 'project' && action === 'report' && projectId) {
    const project = await getFullProject(projectId);
    const outPath = arg4 || defaultArtifactPath(project, 'director-report.md');
    const written = writeArtifact(outPath, buildProjectReport(project));
    console.log(JSON.stringify({ kind: 'lahari.artifact', type: 'director-report', path: written }, null, 2));
    return;
  }

  if (domain === 'project' && action === 'contact-sheet' && projectId) {
    const project = await getFullProject(projectId);
    const outPath = arg4 || defaultArtifactPath(project, 'contact-sheet.html');
    const written = writeArtifact(outPath, buildProjectContactSheet(project));
    console.log(JSON.stringify({ kind: 'lahari.artifact', type: 'contact-sheet', path: written }, null, 2));
    return;
  }

  if (domain === 'shot' && action === 'packet' && projectId && arg4) {
    const project = await getFullProject(projectId);
    console.log(JSON.stringify(buildShotPacket(project, arg4), null, 2));
    return;
  }

  usage();
  process.exitCode = 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
