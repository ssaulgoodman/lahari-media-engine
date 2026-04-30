#!/usr/bin/env node
import 'dotenv/config';
import { prepareCodexReadEnv } from '../server/services/codexReadEnv.js';

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

const loadStudio = async () => {
  const env = await prepareCodexReadEnv();
  if (env.warning) console.error(`[lahari] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('No valid Supabase key available for Lahari CLI.');

  const [{ getFullProject }, studio] = await Promise.all([
    import('../server/routes/projects.js'),
    import('../server/services/codexStudio.js'),
  ]);

  return { getFullProject, ...studio };
};

const main = async () => {
  const [domain, action, projectId, arg4] = process.argv.slice(2);

  if (!domain || domain === 'help' || domain === '--help' || domain === '-h') {
    usage();
    return;
  }

  const studio = await loadStudio();

  if (domain === 'project' && action === 'list') {
    console.log(JSON.stringify(await studio.listProjects(projectId), null, 2));
    return;
  }

  if (domain === 'project' && action === 'packet' && projectId) {
    const project = await studio.getFullProject(projectId);
    console.log(JSON.stringify(studio.buildProjectPacket(project), null, 2));
    return;
  }

  if (domain === 'project' && action === 'report' && projectId) {
    const project = await studio.getFullProject(projectId);
    const outPath = arg4 || studio.defaultArtifactPath(project, 'director-report.md');
    const written = studio.writeArtifact(outPath, studio.buildProjectReport(project));
    console.log(JSON.stringify({ kind: 'lahari.artifact', type: 'director-report', path: written }, null, 2));
    return;
  }

  if (domain === 'project' && action === 'contact-sheet' && projectId) {
    const project = await studio.getFullProject(projectId);
    const outPath = arg4 || studio.defaultArtifactPath(project, 'contact-sheet.html');
    const written = studio.writeArtifact(outPath, studio.buildProjectContactSheet(project));
    console.log(JSON.stringify({ kind: 'lahari.artifact', type: 'contact-sheet', path: written }, null, 2));
    return;
  }

  if (domain === 'shot' && action === 'packet' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    console.log(JSON.stringify(studio.buildShotPacket(project, arg4), null, 2));
    return;
  }

  usage();
  process.exitCode = 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
