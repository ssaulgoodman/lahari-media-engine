#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import { prepareCodexReadEnv, prepareCodexWriteEnv } from '../server/services/codexReadEnv.js';
import { formatAuditTail, recordCliAudit } from '../server/services/lahariAudit.js';
import { runLahariSetup } from '../server/services/lahariSetup.js';
import { IMAGE_MODELS, getImageModel } from '../constants/imageModels.js';
import { STORYBOARD_PROVIDERS, getStoryboardProvider } from '../constants/storyboardProviders.js';
import { TEXT_PROVIDERS, getTextProvider } from '../constants/textProviders.js';
import { VIDEO_MODELS, getVideoModel } from '../constants/videoModels.js';
import { getImageGenerationModelName, getStyleOptionsModelName } from '../server/services/image-provider.js';

const PROJECT_PROMPT_OVERRIDE_KINDS = ['concept', 'script', 'shot_prompts', 'storyboard', 'video', 'character_looks', 'environment_looks'] as const;

const usage = () => {
  console.log(`Lahari CLI

Codex-native studio helpers.

Usage:
  npm run lahari -- setup [--check]
  npm run lahari -- audit tail [projectId|_unscoped] [n]
  npm run lahari -- doctor providers [projectId]
  npm run lahari -- project list [limit]
  npm run lahari -- project packet <projectId>
  npm run lahari -- project actions <projectId>
  npm run lahari -- project hydrate <projectId> [outputDir]
  npm run lahari -- project storyboard-review <projectId>
  npm run lahari -- project storyboard-status <projectId>
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
  npm run lahari -- rollback rewrite-shot-prompts <preview.json>
  npm run lahari -- rollback rewrite-storyboard-prompt <preview.json>
  npm run lahari -- rollback rewrite-script <preview.json>
  npm run lahari -- apply write-storyboard-prompt <projectId> <shotId> [artist note...]
  npm run lahari -- apply bulk-write-storyboard-prompts <projectId> [artist note...]
  npm run lahari -- apply refine-storyboard-image <projectId> <shotId> <feedback...>
  npm run lahari -- apply bulk-generate-storyboards <projectId> [artist note...]
  npm run lahari -- apply lock-storyboard <projectId> <shotId> [versionId]
  npm run lahari -- apply unlock-storyboard <projectId> <shotId>
  npm run lahari -- apply project-preferences <projectId> <preferences.json> [baseHash]
  npm run lahari -- apply project-prompt-override <projectId> <concept|script|shot_prompts|storyboard|video|character_looks|environment_looks> <body.md> [baseHash]
  npm run lahari -- apply shot-workflow-modes <projectId> <shots.json>
  npm run lahari -- apply shot-prompts <projectId> <shots.json> [force]
  npm run lahari -- apply storyboard-prompt <projectId> <shotId> <prompt.md> [cut-plan.md] [baseHash]
  npm run lahari -- apply storyboard-prompts-bulk <projectId> <shots.json> [force]
  npm run lahari -- apply storyboard-scene-markdown <projectId> <scene.md> [force]
  npm run lahari -- apply concept <projectId> <concept.json> [baseHash]
  npm run lahari -- apply style-direction <projectId> <style.json> [baseHash]
  npm run lahari -- apply video-prompt <projectId> <shotId> <motion-prompt.md> [baseHash]
  npm run lahari -- apply script <projectId> <script.json> [baseFingerprint|force]
  npm run lahari -- apply script-markdown <projectId> <draft.md> [baseFingerprint|force]
  npm run lahari -- rollback project-prompt-override <projectId> <concept|script|shot_prompts|storyboard|video|character_looks|environment_looks> [baseHash]
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

const providerDoctor = async (projectId?: string) => {
  const snapshot: Record<string, any> = {
    kind: 'lahari.doctor.providers',
    generatedAt: new Date().toISOString(),
    defaults: {
      textProvider: TEXT_PROVIDERS[0].key,
      imageModel: IMAGE_MODELS[0].key,
      storyboardProvider: STORYBOARD_PROVIDERS[0].key,
      videoModel: VIDEO_MODELS[0].key,
    },
    registries: {
      textProviders: TEXT_PROVIDERS.map(provider => ({
        key: provider.key,
        label: provider.label,
        provider: provider.provider,
        runtimeModel: provider.runtimeModel,
        refineModel: provider.refineModel || provider.runtimeModel,
        note: provider.note,
      })),
      imageModels: IMAGE_MODELS.map(model => ({
        key: model.key,
        label: model.label,
        provider: model.provider,
        runtimeModel: model.runtimeModel,
        imageGenerationRuntime: getImageGenerationModelName(model.key),
        styleOptionsRuntime: getStyleOptionsModelName(model.key),
        supportsRefs: model.supportsRefs,
        maxRefs: model.maxRefs,
        note: model.note,
      })),
      storyboardProviders: STORYBOARD_PROVIDERS.map(provider => ({
        key: provider.key,
        label: provider.label,
        provider: provider.provider,
        runtimeModel: provider.runtimeModel,
        note: provider.note,
      })),
      videoModels: VIDEO_MODELS.map(model => ({
        key: model.key,
        label: model.label,
        provider: model.provider,
        durations: model.durations,
        defaultDuration: model.durations[0],
        costPerSec: model.costPerSec,
        supportsLastFrame: model.supportsLastFrame,
        supportsRefs: model.supportsRefs,
        refsWithFrames: model.refsWithFrames,
        resolutions: model.resolutions,
        note: model.note,
      })),
    },
    warnings: [
      ...IMAGE_MODELS
        .filter(model => /while Segmind credits are out|TEMP routing/i.test(model.note || ''))
        .map(model => `${model.key} image model is currently routed to ${model.provider}/${model.runtimeModel}.`),
      ...STORYBOARD_PROVIDERS
        .filter(provider => /while Segmind credits are out|TEMP routing/i.test(provider.note || ''))
        .map(provider => `${provider.key} storyboard provider is currently routed to ${provider.provider}/${provider.runtimeModel}.`),
    ],
  };

  if (projectId) {
    const studio = await loadStudio('read');
    const project = await studio.getFullProject(projectId);
    const text = getTextProvider(project.textProvider);
    const image = getImageModel(project.imageModel);
    const storyboard = getStoryboardProvider(project.storyboardProvider);
    const video = getVideoModel(project.videoModel);
    snapshot.project = {
      id: project.id,
      title: project.title,
      selections: {
        textProvider: {
          key: text.key,
          provider: text.provider,
          runtimeModel: text.runtimeModel,
          refineModel: text.refineModel || text.runtimeModel,
        },
        imageModel: {
          key: image.key,
          provider: image.provider,
          runtimeModel: image.runtimeModel,
          imageGenerationRuntime: getImageGenerationModelName(image.key),
          styleOptionsRuntime: getStyleOptionsModelName(image.key),
        },
        storyboardProvider: {
          key: storyboard.key,
          provider: storyboard.provider,
          runtimeModel: storyboard.runtimeModel,
        },
        videoModel: {
          key: video.key,
          provider: video.provider,
          durations: video.durations,
          defaultDuration: video.durations[0],
          costPerSec: video.costPerSec,
        },
      },
    };
  }

  return snapshot;
};

const main = async () => {
  const [domain, action, projectId, arg4, ...rest] = process.argv.slice(2);

  if (!domain || domain === 'help' || domain === '--help' || domain === '-h') {
    usage();
    return;
  }

  if (domain === 'setup') {
    await runLahariSetup({ skipRegister: action === '--check' });
    return;
  }

  if (domain === 'audit' && action === 'tail') {
    const projectScope = projectId === '_unscoped' ? null : projectId;
    const limit = Number(arg4 || 20);
    console.log(formatAuditTail(projectScope, Number.isFinite(limit) ? limit : 20));
    return;
  }

  if (domain === 'doctor' && action === 'providers') {
    console.log(JSON.stringify(await providerDoctor(projectId), null, 2));
    return;
  }

  const wantsWrite = (domain === 'apply' && (action === 'rewrite-shot-prompts' || action === 'rewrite-storyboard-prompt' || action === 'rewrite-script' || action === 'generate-storyboard' || action === 'generate-video' || action === 'lock-storyboard' || action === 'unlock-storyboard' || action === 'write-storyboard-prompt' || action === 'bulk-write-storyboard-prompts' || action === 'refine-storyboard-image' || action === 'bulk-generate-storyboards' || action === 'project-preferences' || action === 'project-prompt-override' || action === 'shot-prompts' || action === 'shot-workflow-modes' || action === 'storyboard-prompt' || action === 'storyboard-prompts-bulk' || action === 'storyboard-scene-markdown' || action === 'concept' || action === 'style-direction' || action === 'video-prompt' || action === 'script' || action === 'script-markdown'))
    || (domain === 'rollback' && (action === 'rewrite-shot-prompts' || action === 'rewrite-storyboard-prompt' || action === 'rewrite-script' || action === 'project-prompt-override'));
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

  if (domain === 'project' && action === 'storyboard-status' && projectId) {
    const project = await studio.getFullProject(projectId);
    console.log(JSON.stringify(studio.buildStoryboardStatus(project), null, 2));
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
    console.log(JSON.stringify(await studio.attachDirectorSession(project, note), null, 2));
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

  if (domain === 'rollback' && action === 'rewrite-shot-prompts' && projectId) {
    const preview = JSON.parse(fs.readFileSync(projectId, 'utf8'));
    const project = await studio.getFullProject(preview.project.id);
    console.log(JSON.stringify(await studio.rollbackRewriteShotPromptsPreview(projectId, project), null, 2));
    return;
  }

  if (domain === 'rollback' && action === 'rewrite-storyboard-prompt' && projectId) {
    const preview = JSON.parse(fs.readFileSync(projectId, 'utf8'));
    const project = await studio.getFullProject(preview.project.id);
    console.log(JSON.stringify(await studio.rollbackRewriteStoryboardPromptPreview(projectId, project), null, 2));
    return;
  }

  if (domain === 'rollback' && action === 'rewrite-script' && projectId) {
    const preview = JSON.parse(fs.readFileSync(projectId, 'utf8'));
    const project = await studio.getFullProject(preview.project.id);
    console.log(JSON.stringify(await studio.rollbackRewriteScriptPreview(projectId, project), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'generate-storyboard' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const note = rest.filter(Boolean).join(' ') || undefined;
    console.log(JSON.stringify(await studio.applyGenerateStoryboard(project, arg4, note), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'write-storyboard-prompt' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const note = rest.filter(Boolean).join(' ') || undefined;
    console.log(JSON.stringify(await studio.writeStoryboardPromptForShot(project, arg4, { artistNote: note }), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'bulk-write-storyboard-prompts' && projectId) {
    const project = await studio.getFullProject(projectId);
    const note = [arg4, ...rest].filter(Boolean).join(' ') || undefined;
    console.log(JSON.stringify(await studio.bulkWriteStoryboardPrompts(project, { artistNote: note }), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'refine-storyboard-image' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const feedback = rest.filter(Boolean).join(' ');
    if (!feedback) throw new Error('Feedback is required: npm run lahari -- apply refine-storyboard-image <projectId> <shotId> <feedback...>');
    console.log(JSON.stringify(await studio.refineStoryboardImage(project, arg4, { feedback }), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'bulk-generate-storyboards' && projectId) {
    const project = await studio.getFullProject(projectId);
    const note = [arg4, ...rest].filter(Boolean).join(' ') || undefined;
    console.log(JSON.stringify(await studio.bulkGenerateStoryboards(project, { artistNote: note }), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'lock-storyboard' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    console.log(JSON.stringify(await studio.lockStoryboardBoard(project, arg4, rest[0]), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'unlock-storyboard' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    console.log(JSON.stringify(await studio.unlockStoryboardBoard(project, arg4), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'project-preferences' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const preferences = JSON.parse(fs.readFileSync(arg4, 'utf8'));
    console.log(JSON.stringify(await studio.applyProjectPreferencesConfig(project, preferences, rest[0]), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'project-prompt-override' && projectId && arg4 && rest[0]) {
    const project = await studio.getFullProject(projectId);
    const kind = arg4;
    if (!PROJECT_PROMPT_OVERRIDE_KINDS.includes(kind as any)) throw new Error(`kind must be one of: ${PROJECT_PROMPT_OVERRIDE_KINDS.join(', ')}.`);
    const bodyPath = rest[0];
    const baseHash = rest[1];
    const body = fs.readFileSync(bodyPath, 'utf8');
    console.log(JSON.stringify(await studio.applyProjectPromptOverrideConfig(project, kind as any, body, baseHash), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'shot-prompts' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const shots = JSON.parse(fs.readFileSync(arg4, 'utf8'));
    console.log(JSON.stringify(await studio.applyShotPrompts(project, Array.isArray(shots) ? shots : shots.shots, { force: rest.includes('force') || rest.includes('--force') }), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'shot-workflow-modes' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const payload = JSON.parse(fs.readFileSync(arg4, 'utf8'));
    console.log(JSON.stringify(await studio.applyShotWorkflowModes(project, Array.isArray(payload) ? payload : payload.shots), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'storyboard-prompt' && projectId && arg4 && rest[0]) {
    const project = await studio.getFullProject(projectId);
    const promptPath = rest[0];
    const maybeCutPlanPath = rest[1];
    const maybeBaseHash = rest[2] || (maybeCutPlanPath && fs.existsSync(maybeCutPlanPath) ? undefined : maybeCutPlanPath);
    const cutPlanPath = maybeCutPlanPath && fs.existsSync(maybeCutPlanPath) ? maybeCutPlanPath : undefined;
    console.log(JSON.stringify(await studio.applyStoryboardPrompt(
      project,
      arg4,
      fs.readFileSync(promptPath, 'utf8'),
      cutPlanPath ? fs.readFileSync(cutPlanPath, 'utf8') : '',
      { baseHash: maybeBaseHash, force: rest.includes('force') || rest.includes('--force') },
    ), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'storyboard-prompts-bulk' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const payload = JSON.parse(fs.readFileSync(arg4, 'utf8'));
    console.log(JSON.stringify(await studio.applyStoryboardPromptsBulk(project, {
      shots: Array.isArray(payload) ? payload : payload.shots,
      force: rest.includes('force') || rest.includes('--force') || !!payload.force,
    }), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'storyboard-scene-markdown' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const markdown = fs.readFileSync(arg4, 'utf8');
    console.log(JSON.stringify(await studio.applyStoryboardSceneMarkdown(project, markdown, {
      force: rest.includes('force') || rest.includes('--force'),
    }), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'concept' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const payload = JSON.parse(fs.readFileSync(arg4, 'utf8'));
    console.log(JSON.stringify(await studio.applyConcept(project, payload.concept || payload, {
      baseHash: rest[0] || payload.baseHash,
      force: rest.includes('force') || rest.includes('--force') || !!payload.force,
    }), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'style-direction' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const payload = JSON.parse(fs.readFileSync(arg4, 'utf8'));
    console.log(JSON.stringify(await studio.applyStyleDirection(project, payload.style || payload, {
      baseHash: rest[0] || payload.baseHash,
      force: rest.includes('force') || rest.includes('--force') || !!payload.force,
    }), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'video-prompt' && projectId && arg4 && rest[0]) {
    const project = await studio.getFullProject(projectId);
    const promptPath = rest[0];
    console.log(JSON.stringify(await studio.applyVideoPrompt(project, arg4, fs.readFileSync(promptPath, 'utf8'), {
      baseHash: rest[1],
      force: rest.includes('force') || rest.includes('--force'),
    }), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'script' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const payload = JSON.parse(fs.readFileSync(arg4, 'utf8'));
    const force = rest.includes('force') || rest.includes('--force') || !!payload.force;
    const baseFingerprint = force ? undefined : (rest[0] || payload.baseFingerprint);
    console.log(JSON.stringify(await studio.applyScript(project, payload.script || payload, { baseFingerprint, force }), null, 2));
    return;
  }

  if (domain === 'apply' && action === 'script-markdown' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const markdown = fs.readFileSync(arg4, 'utf8');
    const force = rest.includes('force') || rest.includes('--force');
    const baseFingerprint = force ? undefined : rest.find(value => value !== 'force' && value !== '--force');
    console.log(JSON.stringify(await studio.applyScriptMarkdown(project, markdown, { baseFingerprint, force }), null, 2));
    return;
  }

  if (domain === 'rollback' && action === 'project-prompt-override' && projectId && arg4) {
    const project = await studio.getFullProject(projectId);
    const kind = arg4;
    if (!PROJECT_PROMPT_OVERRIDE_KINDS.includes(kind as any)) throw new Error(`kind must be one of: ${PROJECT_PROMPT_OVERRIDE_KINDS.join(', ')}.`);
    console.log(JSON.stringify(await studio.revertProjectPromptOverrideConfig(project, kind as any, rest[0]), null, 2));
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

const cliAuditArgs = () => {
  const [domain, action, projectId, arg4, ...rest] = process.argv.slice(2);
  return { domain, action, projectId, arg4, rest };
};

const startedAt = new Date().toISOString();
const start = Date.now();
recordCliAudit({
  phase: 'start',
  command: 'npm run lahari',
  args: cliAuditArgs(),
  startedAt,
});

(async () => {
  let caughtError: unknown = null;
  try {
    await main();
  } catch (error) {
    caughtError = error;
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    const exitError = caughtError || (process.exitCode && process.exitCode !== 0 ? `process exited with code ${process.exitCode}` : null);
    recordCliAudit({
      phase: 'finish',
      command: 'npm run lahari',
      args: cliAuditArgs(),
      error: exitError || undefined,
      durationMs: Date.now() - start,
      startedAt,
    });
  }
})();
