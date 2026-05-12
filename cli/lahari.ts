#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import { prepareCodexReadEnv, prepareCodexWriteEnv } from '../server/services/codexReadEnv.js';

const usage = () => {
  console.log(`Lahari CLI

Codex-native studio helpers.

Usage:
  npm run lahari -- project list [limit]
  npm run lahari -- project packet <projectId>
  npm run lahari -- project actions <projectId>
  npm run lahari -- project hydrate <projectId> [outputDir]
  npm run lahari -- project storyboard-review <projectId>
  npm run lahari -- project report <projectId> [out.md]
  npm run lahari -- project sheet <projectId> <overview|style|references|storyboard|renders> [out.html]
  npm run lahari -- project contact-sheet <projectId> [out.html]
  npm run lahari -- shot packet <projectId> <shotId>
  npm run lahari -- session attach <projectId> [note...]
  npm run lahari -- session state <projectId>
  npm run lahari -- session note <projectId> <note...>
  npm run lahari -- session journal <projectId>
  npm run lahari -- preview rewrite-script <projectId> [note...]
  npm run lahari -- preview rewrite-shot-prompts <projectId> [note...]
  npm run lahari -- preview rewrite-storyboard-prompt <projectId> <shotId> [note...]
  npm run lahari -- plan generate-storyboard <projectId> <shotId>
  npm run lahari -- plan generate-video <projectId> <shotId>
  npm run lahari -- apply-plan rewrite-shot-prompts <preview.json>
  npm run lahari -- apply-plan rewrite-storyboard-prompt <preview.json>
  npm run lahari -- apply-plan rewrite-script <preview.json>
  npm run lahari -- apply rewrite-shot-prompts <preview.json>
  npm run lahari -- apply rewrite-storyboard-prompt <preview.json>
  npm run lahari -- apply rewrite-script <preview.json>
  npm run lahari -- apply generate-storyboard <projectId> <shotId> [artist note...]
  npm run lahari -- apply generate-video <projectId> <shotId> [prompt override...]

Output:
  JSON packets and local review artifacts designed for Codex inspection and future MCP wrapping.
`);
};

const loadStudio = async (mode: 'read' | 'write' = 'read') => {
  const env = mode === 'write' ? await prepareCodexWriteEnv() : await prepareCodexReadEnv();
  if (env.warning) console.error(`[lahari] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error(mode === 'write'
    ? 'No valid Supabase service key available for Lahari write tools.'
    : 'No valid Supabase key available for Lahari CLI.');

  const [{ getFullProject }, studio] = await Promise.all([
    import('../server/routes/projects.js'),
    import('../server/services/codexStudio.js'),
  ]);

  return { getFullProject, ...studio };
};

const main = async () => {
  const [domain, action, projectId, arg4, ...rest] = process.argv.slice(2);

  if (!domain || domain === 'help' || domain === '--help' || domain === '-h') {
    usage();
    return;
  }

  const wantsWrite = domain === 'apply' && (action === 'rewrite-shot-prompts' || action === 'rewrite-storyboard-prompt' || action === 'rewrite-script' || action === 'generate-storyboard' || action === 'generate-video');
  const studio = await loadStudio(wantsWrite ? 'write' : 'read');

  if (domain === 'project' && action === 'list') {
    console.log(JSON.stringify(await studio.listProjects(projectId), null, 2));
    return;
  }

  if (domain === 'project' && action === 'packet' && projectId) {
    const project = await studio.getFullProject(projectId);
    console.log(JSON.stringify(await studio.buildProjectPacket(project), null, 2));
    return;
  }

  if (domain === 'project' && action === 'actions' && projectId) {
    const project = await studio.getFullProject(projectId);
    console.log(JSON.stringify(studio.buildProjectActionList(project), null, 2));
    return;
  }

  if (domain === 'project' && action === 'hydrate' && projectId) {
    const project = await studio.getFullProject(projectId);
    console.log(JSON.stringify(await studio.hydrateProjectWorkbench(project, arg4), null, 2));
    return;
  }

  if (domain === 'project' && action === 'storyboard-review' && projectId) {
    const project = await studio.getFullProject(projectId);
    console.log(JSON.stringify(studio.buildStoryboardPromptReview(project), null, 2));
    return;
  }

  if (domain === 'project' && action === 'report' && projectId) {
    const project = await studio.getFullProject(projectId);
    const outPath = arg4 || studio.defaultArtifactPath(project, 'director-report.md');
    const written = studio.writeArtifact(outPath, studio.buildProjectReport(project));
    console.log(JSON.stringify({ kind: 'lahari.artifact', type: 'director-report', path: written }, null, 2));
    return;
  }

  if (domain === 'project' && action === 'sheet' && projectId) {
    const project = await studio.getFullProject(projectId);
    const sheetType = studio.normalizeProjectSheetType(arg4);
    const outPath = rest[0] || studio.defaultProjectSheetPath(project, sheetType);
    const written = studio.writeArtifact(outPath, await studio.buildProjectSheet(project, sheetType));
    console.log(JSON.stringify({ kind: 'lahari.artifact', type: `${sheetType}-sheet`, path: written }, null, 2));
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

  if (domain === 'session' && action === 'attach' && projectId) {
    const project = await studio.getFullProject(projectId);
    const note = [arg4, ...rest].filter(Boolean).join(' ') || undefined;
    console.log(JSON.stringify(studio.attachDirectorSession(project, note), null, 2));
    return;
  }

  if (domain === 'session' && action === 'state' && projectId) {
    const project = await studio.getFullProject(projectId);
    console.log(JSON.stringify(studio.getDirectorSession(project), null, 2));
    return;
  }

  if (domain === 'session' && action === 'note' && projectId) {
    const project = await studio.getFullProject(projectId);
    const note = [arg4, ...rest].filter(Boolean).join(' ');
    console.log(JSON.stringify(studio.addDirectorSessionNote(project, note), null, 2));
    return;
  }

  if (domain === 'session' && action === 'journal' && projectId) {
    const project = await studio.getFullProject(projectId);
    const session = studio.getDirectorSession(project);
    console.log(session.journal || 'No director journal exists yet. Run: npm run lahari -- session attach <projectId>');
    return;
  }

  if (domain === 'preview' && action === 'rewrite-shot-prompts' && projectId) {
    const project = await studio.getFullProject(projectId);
    const note = [arg4, ...rest].filter(Boolean).join(' ') || undefined;
    console.log(JSON.stringify(await studio.previewRewriteShotPrompts(project, note), null, 2));
    return;
  }

  if (domain === 'preview' && action === 'rewrite-script' && projectId) {
    const project = await studio.getFullProject(projectId);
    const note = [arg4, ...rest].filter(Boolean).join(' ') || undefined;
    console.log(JSON.stringify(await studio.previewRewriteScript(project, note), null, 2));
    return;
  }

  if (domain === 'preview' && action === 'rewrite-storyboard-prompt' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const note = rest.filter(Boolean).join(' ') || undefined;
    console.log(JSON.stringify(await studio.previewRewriteStoryboardPrompt(project, arg4, note), null, 2));
    return;
  }

  if (domain === 'plan' && action === 'generate-storyboard' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    console.log(JSON.stringify(studio.planGenerateStoryboard(project, arg4), null, 2));
    return;
  }

  if (domain === 'plan' && action === 'generate-video' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    console.log(JSON.stringify(studio.planGenerateVideo(project, arg4), null, 2));
    return;
  }

  if (domain === 'apply-plan' && action === 'rewrite-shot-prompts' && projectId) {
    const preview = JSON.parse(fs.readFileSync(projectId, 'utf8'));
    const project = await studio.getFullProject(preview.project.id);
    console.log(JSON.stringify(await studio.getRewriteShotPromptsApplyPlan(projectId, project), null, 2));
    return;
  }

  if (domain === 'apply-plan' && action === 'rewrite-storyboard-prompt' && projectId) {
    const preview = JSON.parse(fs.readFileSync(projectId, 'utf8'));
    const project = await studio.getFullProject(preview.project.id);
    console.log(JSON.stringify(await studio.getRewriteStoryboardPromptApplyPlan(projectId, project), null, 2));
    return;
  }

  if (domain === 'apply-plan' && action === 'rewrite-script' && projectId) {
    const preview = JSON.parse(fs.readFileSync(projectId, 'utf8'));
    const project = await studio.getFullProject(preview.project.id);
    console.log(JSON.stringify(await studio.getRewriteScriptApplyPlan(projectId, project), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'rewrite-shot-prompts' && projectId) {
    const preview = JSON.parse(fs.readFileSync(projectId, 'utf8'));
    const project = await studio.getFullProject(preview.project.id);
    console.log(JSON.stringify(await studio.applyRewriteShotPromptsPreview(projectId, project), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'rewrite-storyboard-prompt' && projectId) {
    const preview = JSON.parse(fs.readFileSync(projectId, 'utf8'));
    const project = await studio.getFullProject(preview.project.id);
    console.log(JSON.stringify(await studio.applyRewriteStoryboardPromptPreview(projectId, project), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'rewrite-script' && projectId) {
    const preview = JSON.parse(fs.readFileSync(projectId, 'utf8'));
    const project = await studio.getFullProject(preview.project.id);
    console.log(JSON.stringify(await studio.applyRewriteScriptPreview(projectId, project), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'generate-storyboard' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const note = rest.filter(Boolean).join(' ') || undefined;
    console.log(JSON.stringify(await studio.applyGenerateStoryboard(project, arg4, note), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'generate-video' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const promptOverride = rest.filter(Boolean).join(' ') || undefined;
    console.log(JSON.stringify(await studio.applyGenerateVideo(project, arg4, promptOverride), null, 2));
    return;
  }

  usage();
  process.exitCode = 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
