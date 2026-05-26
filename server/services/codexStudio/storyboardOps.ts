import { generateStoryboardVersion, lockStoryboardVersion, planStoryboardPrompt, unlockStoryboardVersion, writeStoryboardPrompt } from '../storyboard.js';
import type { ContextOverrides } from '../contextOverrides.js';
import { generateShotVideo } from '../videoGeneration.js';
import { eventResultPointers, recordDirectorEvent } from '../directorEvents.js';
import { getModelMinDuration } from '../segmind.js';
import type { StoryboardPromptVariant } from '../seedance-storyboard-rd.js';
import {
  applyProjectPreferences,
  applyProjectPromptOverride,
  revertProjectPromptOverride,
  writeProjectConfigDeskCopy,
  type ProjectPromptOverrideKind,
} from '../projectConfig.js';
import { getStoryboardProvider } from '../../../constants/storyboardProviders.js';
import { getVideoModel } from '../../../constants/videoModels.js';
import {
  appendSessionJournalEntry,
  compactText,
  defaultProjectWorkbenchDir,
  shotWorkflowMode,
  shotLabel,
  webStudioUrl,
  type Project,
  type ProjectShot,
} from './core.js';
import { buildNotebookConfigArtifacts, buildNotebookMirrorArtifacts } from './notebook.js';

const findProjectShot = (project: Project, shotId: string): { shot: ProjectShot; sceneIndex: number; shotIndex: number } | null => {
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    const shotIndex = scene.shots.findIndex((shot) => shot.id === shotId);
    if (shotIndex >= 0) return { shot: scene.shots[shotIndex], sceneIndex: sceneIndex + 1, shotIndex: shotIndex + 1 };
  }
  return null;
};

const roundCost = (cost: number): number => Number(cost.toFixed(3));

const allProjectShots = (project: Project) => {
  const items: { shot: ProjectShot; sceneIndex: number; shotIndex: number }[] = [];
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    for (const [shotIndex, shot] of scene.shots.entries()) {
      items.push({ shot, sceneIndex: sceneIndex + 1, shotIndex: shotIndex + 1 });
    }
  }
  return items;
};

const withShotPatch = (project: Project, shotId: string, patch: Partial<ProjectShot>): Project => ({
  ...project,
  scenes: project.scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((shot) => shot.id === shotId ? { ...shot, ...patch } : shot),
  })),
});

const filterShotTargets = (project: Project, shotIds?: string[]) => {
  const requested = new Set((shotIds || []).filter(Boolean));
  const targets = allProjectShots(project).filter((target) => !requested.size || requested.has(target.shot.id));
  if (requested.size && targets.length !== requested.size) {
    const found = new Set(targets.map((target) => target.shot.id));
    const missing = [...requested].filter((id) => !found.has(id));
    throw new Error(`Shot(s) not found in project: ${missing.join(', ')}`);
  }
  return targets;
};

const storyboardPromptCostEstimate = () => roundCost(Number(process.env.STORYBOARD_PROMPT_WRITE_COST_ESTIMATE || process.env.OPENAI_STORYBOARD_PLAN_COST_ESTIMATE || 0.02));

type ModelOverride = {
  storyboardProvider?: string;
  videoModel?: string;
};

export const planGenerateStoryboard = (project: Project, shotId: string, modelOverride: ModelOverride = {}) => {
  const target = findProjectShot(project, shotId);
  if (!target) throw new Error(`Shot not found in project: ${shotId}`);
  const provider = getStoryboardProvider(modelOverride.storyboardProvider || project.storyboardProvider);
  const shot = target.shot;
  const prerequisites = [
    shotWorkflowMode(project, shot) === 'storyboard' ? null : 'Shot workflow is keyframe; set workflow_mode=storyboard before generating a storyboard board.',
    shot.storyboardPrompt ? null : 'Saved storyboard_prompt is required.',
    shot.locked ? 'Shot is locked; unlock before generating a new storyboard board.' : null,
    shot.storyboardLocked ? 'Storyboard board is locked; unlock before generating a replacement board.' : null,
  ].filter(Boolean) as string[];
  const willOverwrite = !!shot.storyboardUrl;
  const willChange = [
    'Create a new shot_storyboard asset and storyboard_versions row.',
    'Set this shot storyboard_asset_id/storyboard_version_id to the new board.',
    'Set storyboard_status=success and storyboard_locked=false.',
    'Set video_status=stale so video is reviewed/regenerated against the new board.',
    willOverwrite ? 'Replace the active storyboard pointer; old board remains in version history.' : null,
  ].filter(Boolean) as string[];
  const costEstimate = roundCost(provider.provider === 'segmind'
    ? Number(process.env.SEGMIND_STORYBOARD_RENDER_COST_ESTIMATE || 0.03)
    : provider.provider === 'google'
    ? Number(process.env.GEMINI_STORYBOARD_RENDER_COST_ESTIMATE || 0.04)
    : Number(process.env.OPENAI_STORYBOARD_RENDER_COST_ESTIMATE || process.env.OPENAI_STORYBOARD_COST_ESTIMATE || 0.12));

  return {
    kind: 'mirage.generation_plan.storyboard',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      storyboardProvider: modelOverride.storyboardProvider || project.storyboardProvider,
      aspectRatio: project.aspectRatio,
    },
    shot: {
      id: shot.id,
      sceneIndex: target.sceneIndex,
      shotIndex: target.shotIndex,
      beat: compactText(shot.direction || shot.storyboardPrompt || shot.visualPrompt, 260),
      hasStoryboardPrompt: !!shot.storyboardPrompt,
      hasStoryboard: !!shot.storyboardUrl,
      storyboardLocked: !!shot.storyboardLocked,
      videoStatus: shot.videoStatus,
    },
    provider: {
      key: provider.key,
      model: provider.runtimeModel,
      provider: provider.provider,
    },
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'generate-storyboard' }),
    paid: true,
    estimatedCost: costEstimate,
    canRun: prerequisites.length === 0,
    prerequisites,
    willOverwrite,
    willChange,
    approval: `Generate a new storyboard board for ${project.title} ${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)} using ${provider.label}. Estimated cost: $${costEstimate.toFixed(3)}. ${willOverwrite ? 'This will replace the active board pointer and keep the old board in history.' : 'This will create the first active board for this shot.'}`,
  };
};

export const buildStoryboardStatus = (project: Project) => {
  const shots: any[] = [];
  const summary = {
    scenes: project.scenes.length,
    shots: 0,
    promptsReady: 0,
    promptsMissing: 0,
    promptsStale: 0,
    boardsReady: 0,
    boardsMissing: 0,
    boardsStale: 0,
    boardsLocked: 0,
    videosReady: 0,
    videosMissing: 0,
    videosStale: 0,
    shotsLocked: 0,
  };

  for (const [sceneIndex, scene] of project.scenes.entries()) {
    for (const [shotIndex, shot] of scene.shots.entries()) {
      summary.shots += 1;
      if (shot.storyboardPrompt) summary.promptsReady += 1;
      else summary.promptsMissing += 1;
      if (shot.promptsStale || shot.storyboardPromptStatus === 'stale') summary.promptsStale += 1;
      if (shot.storyboardUrl) summary.boardsReady += 1;
      else summary.boardsMissing += 1;
      if (shot.storyboardStatus === 'stale') summary.boardsStale += 1;
      if (shot.storyboardLocked) summary.boardsLocked += 1;
      if (shot.videoUrl) summary.videosReady += 1;
      else summary.videosMissing += 1;
      if (shot.videoStatus === 'stale') summary.videosStale += 1;
      if (shot.locked) summary.shotsLocked += 1;

      const readiness = [
        !shot.storyboardPrompt ? 'missing storyboard prompt' : null,
        shot.promptsStale || shot.storyboardPromptStatus === 'stale' ? 'prompt stale' : null,
        shot.storyboardPromptStatus === 'error' ? 'prompt writer error' : null,
        !shot.storyboardUrl ? 'missing board' : null,
        shot.storyboardStatus === 'stale' ? 'board stale' : null,
        shot.storyboardStatus === 'error' ? 'board generation error' : null,
        shot.storyboardUrl && !shot.storyboardLocked ? 'board needs review/lock' : null,
        project.videoModel?.startsWith('seedance') && shot.storyboardUrl && !shot.storyboardLocked ? 'video blocked until board lock' : null,
        shot.videoStatus === 'stale' ? 'video stale' : null,
        shot.lastError ? `last error: ${compactText(shot.lastError, 180)}` : null,
      ].filter(Boolean);

      const label = shotLabel(sceneIndex, shotIndex);
      const needsBoard = shot.storyboardPrompt && (!shot.storyboardUrl || shot.storyboardStatus === 'stale' || shot.storyboardStatus === 'error') && !shot.locked;
      const nextAction = needsBoard ? {
        kind: 'generate_storyboard',
        canRun: true,
        paid: true,
        mcpTool: 'apply_generate_storyboard',
        mcpInstruction: `Call apply_generate_storyboard with projectId=${project.id} and shotId=${shot.id}.`,
        webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'generate-storyboard' }),
      } : shot.storyboardUrl && !shot.storyboardLocked ? {
        kind: 'lock_storyboard',
        canRun: true,
        paid: false,
        mcpTool: 'lock_storyboard',
        mcpInstruction: `Call lock_storyboard with projectId=${project.id} and shotId=${shot.id}.`,
        webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'review-storyboard' }),
      } : null;

      shots.push({
        id: shot.id,
        label,
        scene: scene.sectionLabel,
        beat: compactText(shot.direction || shot.storyboardPrompt || shot.visualPrompt, 220),
        duration: shot.duration,
        prompt: {
          has: !!shot.storyboardPrompt,
          status: shot.storyboardPromptStatus,
          chars: (shot.storyboardPrompt || '').length,
          cutPlanChars: (shot.storyboardCutPlan || '').length,
          stale: !!shot.promptsStale || shot.storyboardPromptStatus === 'stale',
        },
        board: {
          has: !!shot.storyboardUrl,
          status: shot.storyboardStatus,
          locked: !!shot.storyboardLocked,
          assetId: shot.storyboardAssetId || null,
          versionId: shot.storyboardVersionId || null,
          url: shot.storyboardUrl || null,
        },
        video: {
          has: !!shot.videoUrl,
          status: shot.videoStatus,
          locked: !!shot.locked,
          url: shot.videoUrl || null,
        },
        readiness,
        nextAction,
        webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'review-storyboard' }),
      });
    }
  }

  return {
    kind: 'mirage.storyboard.status',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      storyboardProvider: project.storyboardProvider,
      videoModel: project.videoModel,
    },
    summary,
    shots,
  };
};

export const writeStoryboardPromptForShot = async (project: Project, shotId: string, opts: {
  artistNote?: string;
  variant?: StoryboardPromptVariant;
  artistReferenceImagePath?: string;
} = {}) => {
  const target = findProjectShot(project, shotId);
  if (!target) throw new Error(`Shot not found in project: ${shotId}`);
  if (target.shot.locked) throw new Error('Cannot write storyboard prompt: shot is locked.');

  const result = await writeStoryboardPrompt({
    projectId: project.id,
    shotId,
    variant: opts.variant,
    artistNote: opts.artistNote,
    artistReferenceImagePath: opts.artistReferenceImagePath,
  });
  const estimatedCost = storyboardPromptCostEstimate();
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: opts.artistNote ? 'storyboard_prompt_refined' : 'storyboard_prompt_written',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex ${opts.artistNote ? 'refined' : 'wrote'} storyboard prompt and cut plan for ${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)}.`,
    payload: {
      artistNote: opts.artistNote || null,
      variant: opts.variant || 'adaptive_numbered_storyboard',
      estimatedCost,
      promptChars: result.storyboardPrompt.length,
      cutPlanChars: result.cutPlanText.length,
    },
  });
  appendSessionJournalEntry(
    project,
    opts.artistNote ? 'refined storyboard prompt' : 'wrote storyboard prompt',
    `${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)}\nShot ID: ${shotId}\nPrompt chars: ${result.storyboardPrompt.length}\nCut plan chars: ${result.cutPlanText.length}\nWeb: ${webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard-prompt' })}`,
  );
  const notebookProject = withShotPatch(project, shotId, {
    storyboardPrompt: result.storyboardPrompt,
    storyboardCutPlan: result.cutPlanText,
    storyboardPromptStatus: 'success',
    promptsStale: false,
  });

  return {
    kind: 'mirage.apply.write_storyboard_prompt',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    shot: {
      id: shotId,
      label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
      beat: compactText(target.shot.direction || target.shot.visualPrompt, 220),
    },
    paid: true,
    estimatedCost,
    result: {
      storyboardPromptChars: result.storyboardPrompt.length,
      cutPlanChars: result.cutPlanText.length,
      storyboardPrompt: compactText(result.storyboardPrompt, 900),
      cutPlanText: compactText(result.cutPlanText, 700),
    },
    changedArtifacts: buildNotebookMirrorArtifacts(notebookProject, {
      shotPrompts: true,
      storyboardShotIds: [shotId],
    }),
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard-prompt' }),
    note: 'Saved storyboard_prompt and storyboard_cut_plan on the shot.',
  };
};

export const bulkWriteStoryboardPrompts = async (project: Project, opts: {
  shotIds?: string[];
  force?: boolean;
  artistNote?: string;
  variant?: StoryboardPromptVariant;
  artistReferenceImagePath?: string;
} = {}) => {
  const targets = filterShotTargets(project, opts.shotIds);
  const selected = targets.filter(({ shot }) => {
    if (shot.locked) return false;
    if (opts.force) return true;
    return !shot.storyboardPrompt || shot.storyboardPromptStatus === 'error';
  });
  const skipped = targets
    .filter((target) => !selected.some((item) => item.shot.id === target.shot.id))
    .map(({ shot, sceneIndex, shotIndex }) => ({
      shotId: shot.id,
      label: shotLabel(sceneIndex - 1, shotIndex - 1),
      reason: shot.locked ? 'shot locked' : opts.force ? 'not selected' : 'prompt already present',
    }));
  const estimatedCost = roundCost(selected.length * storyboardPromptCostEstimate());
  const results: any[] = [];

  for (const target of selected) {
    try {
      const result = await writeStoryboardPromptForShot(project, target.shot.id, opts);
      results.push({
        shotId: target.shot.id,
        label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
        ok: true,
        result: result.result,
        changedArtifacts: result.changedArtifacts,
      });
    } catch (error) {
      results.push({
        shotId: target.shot.id,
        label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboard_prompts_bulk_written',
    entityType: 'project',
    entityId: project.id,
    summary: `Codex bulk wrote storyboard prompts for ${results.filter((row) => row.ok).length} shot(s).`,
    payload: {
      requestedShotIds: opts.shotIds || null,
      force: !!opts.force,
      estimatedCost,
      results: results.map((row) => ({ shotId: row.shotId, label: row.label, ok: row.ok, error: row.error || null })),
      skipped,
    },
  });
  appendSessionJournalEntry(
    project,
    'bulk wrote storyboard prompts',
    `Succeeded: ${results.filter((row) => row.ok).length}\nFailed: ${results.filter((row) => !row.ok).length}\nSkipped: ${skipped.length}\nForce: ${!!opts.force}`,
  );

  return {
    kind: 'mirage.apply.bulk_write_storyboard_prompts',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    paid: true,
    estimatedCost,
    counts: {
      requested: targets.length,
      selected: selected.length,
      succeeded: results.filter((row) => row.ok).length,
      failed: results.filter((row) => !row.ok).length,
      skipped: skipped.length,
    },
    results,
    skipped,
    changedArtifacts: results
      .filter((row) => row.ok)
      .flatMap((row) => row.changedArtifacts || [])
      .filter((file, index, files) => files.findIndex((candidate) => candidate.path === file.path) === index),
    note: opts.force
      ? 'Force mode rewrote selected unlocked storyboard prompts.'
      : 'Default mode wrote only missing/error storyboard prompts and skipped locked or already-ready shots.',
  };
};

export const planGenerateVideo = (project: Project, shotId: string, modelOverride: ModelOverride = {}) => {
  const target = findProjectShot(project, shotId);
  if (!target) throw new Error(`Shot not found in project: ${shotId}`);
  const shot = target.shot;
  const videoModel = modelOverride.videoModel || project.videoModel;
  const model = getVideoModel(videoModel);
  const workflowMode = shotWorkflowMode({ ...project, videoModel } as Project, shot);
  const storyboardMode = workflowMode === 'storyboard' && model.key.startsWith('seedance') && !!shot.storyboardLocked && !!shot.storyboardUrl;
  const prerequisites = [
    storyboardMode || shot.imageUrl ? null : model.key.startsWith('seedance')
      ? 'Locked storyboard board or start frame is required.'
      : 'Start frame is required.',
    model.key.startsWith('seedance') && shot.storyboardUrl && !shot.storyboardLocked ? 'Storyboard board exists but is not locked.' : null,
    shot.locked ? 'Shot is locked; unlock before regenerating video.' : null,
  ].filter(Boolean) as string[];
  const duration = Number(shot.duration || model.durations[0] || 5);
  const estimatedCost = roundCost(duration * model.costPerSec);
  const willOverwrite = !!shot.videoUrl;
  const willChange = [
    'Create a new shot_video asset.',
    'Set this shot video_asset_id to the new video.',
    'Attempt to extract and store the real last frame.',
    'Set video_status=success on completion.',
    storyboardMode ? 'Use locked storyboard board as the primary Seedance reference.' : 'Use start keyframe as the primary video reference.',
    willOverwrite ? 'Replace the active video pointer; old video remains in asset history.' : null,
  ].filter(Boolean) as string[];

  return {
    kind: 'mirage.generation_plan.video',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      videoModel,
      aspectRatio: project.aspectRatio,
      videoResolution: project.videoResolution,
    },
    shot: {
      id: shot.id,
      sceneIndex: target.sceneIndex,
      shotIndex: target.shotIndex,
      beat: compactText(shot.direction || shot.storyboardPrompt || shot.visualPrompt, 260),
      duration,
      hasStartFrame: !!shot.imageUrl,
      hasStoryboard: !!shot.storyboardUrl,
      storyboardLocked: !!shot.storyboardLocked,
      hasVideo: !!shot.videoUrl,
      locked: !!shot.locked,
      videoStatus: shot.videoStatus,
    },
    mode: storyboardMode ? 'storyboard' : 'keyframe',
    model: {
      key: model.key,
      label: model.label,
      costPerSec: model.costPerSec,
      supportsRefs: model.supportsRefs,
      supportsLastFrame: model.supportsLastFrame,
    },
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'generate-video' }),
    paid: true,
    estimatedCost,
    canRun: prerequisites.length === 0,
    prerequisites,
    willOverwrite,
    willChange,
    approval: `Generate a ${duration}s ${model.label} video for ${project.title} ${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)} in ${storyboardMode ? 'storyboard' : 'keyframe'} mode. Estimated cost: $${estimatedCost.toFixed(3)}. ${willOverwrite ? 'This will replace the active video pointer and keep the old video in history.' : 'This will create the first active video for this shot.'}`,
  };
};

export const applyGenerateStoryboard = async (
  project: Project,
  shotId: string,
  artistNote?: string,
  modelOverride: ModelOverride = {},
  contextOverrides?: ContextOverrides,
) => {
  const plan = planGenerateStoryboard(project, shotId, modelOverride);
  if (!plan.canRun) {
    throw new Error(`Cannot generate storyboard: ${plan.prerequisites.join(' ')}`);
  }

  const result = await generateStoryboardVersion({
    projectId: project.id,
    shotId,
    artistNote,
    contextOverrides,
    modelOverride: { storyboardProvider: modelOverride.storyboardProvider },
  });
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboard_generated',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex generated a storyboard board for ${shotLabel(plan.shot.sceneIndex - 1, plan.shot.shotIndex - 1)}.`,
    payload: {
      artistNote: artistNote || null,
      provider: plan.provider,
      modelOverride: modelOverride.storyboardProvider ? { storyboardProvider: modelOverride.storyboardProvider } : null,
      contextOverrides: contextOverrides || null,
      estimatedCost: plan.estimatedCost,
      result: eventResultPointers(result),
    },
  });
  appendSessionJournalEntry(
    project,
    'generated storyboard board',
    `${shotLabel(plan.shot.sceneIndex - 1, plan.shot.shotIndex - 1)}\nShot ID: ${shotId}\nProvider: ${plan.provider.key}\nEstimated cost: $${plan.estimatedCost.toFixed(3)}\nWeb: ${webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' })}`,
  );
  const notebookProject = withShotPatch(project, shotId, {
    storyboardUrl: result.imageUrl,
    storyboardVersionId: result.versionId,
    storyboardStatus: 'success',
    storyboardLocked: false,
    videoStatus: 'stale',
  });

  return {
    kind: 'mirage.generation_result.storyboard',
    generatedAt: new Date().toISOString(),
    project: plan.project,
    shot: plan.shot,
    provider: plan.provider,
    estimatedCost: plan.estimatedCost,
    appliedPlan: {
      willOverwrite: plan.willOverwrite,
      willChange: plan.willChange,
    },
    result,
    changedArtifacts: buildNotebookMirrorArtifacts(notebookProject, {
      shotPrompts: true,
      storyboardShotIds: [shotId],
    }),
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' }),
    note: 'Generated storyboard board, updated the active storyboard pointer, unlocked the board for review, and marked video stale.',
  };
};

export const bulkGenerateStoryboards = async (project: Project, opts: {
  shotIds?: string[];
  force?: boolean;
  artistNote?: string;
  modelOverride?: ModelOverride;
  contextOverrides?: ContextOverrides;
} = {}) => {
  const targets = filterShotTargets(project, opts.shotIds);
  const candidates = targets.map((target) => {
    const shot = target.shot;
    const plan = shot.storyboardPrompt ? planGenerateStoryboard(project, shot.id, opts.modelOverride || {}) : null;
    const shouldRun = !!plan
      && plan.canRun
      && !shot.storyboardLocked
      && (opts.force || !shot.storyboardUrl || shot.storyboardStatus === 'stale' || shot.storyboardStatus === 'error');
    const skipReason = shot.locked ? 'shot locked'
      : shot.storyboardLocked ? 'storyboard locked'
      : !shot.storyboardPrompt ? 'missing storyboard prompt'
      : !plan?.canRun ? plan?.prerequisites.join('; ') || 'not runnable'
      : !opts.force && shot.storyboardUrl && shot.storyboardStatus !== 'stale' && shot.storyboardStatus !== 'error' ? 'board already present'
      : null;
    return { ...target, plan, shouldRun, skipReason };
  });
  const selected = candidates.filter((target) => target.shouldRun && target.plan);
  const skipped = candidates
    .filter((target) => !target.shouldRun)
    .map((target) => ({
      shotId: target.shot.id,
      label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
      reason: target.skipReason || 'not selected',
    }));
  const estimatedCost = roundCost(selected.reduce((sum, target) => sum + Number(target.plan?.estimatedCost || 0), 0));
  const results: any[] = [];

  for (const target of selected) {
    try {
      const result = await applyGenerateStoryboard(project, target.shot.id, opts.artistNote, opts.modelOverride || {}, opts.contextOverrides);
      results.push({
        shotId: target.shot.id,
        label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
        ok: true,
        estimatedCost: result.estimatedCost,
        result: eventResultPointers(result.result),
        changedArtifacts: result.changedArtifacts,
        webUrl: result.webUrl,
      });
    } catch (error) {
      results.push({
        shotId: target.shot.id,
        label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboards_bulk_generated',
    entityType: 'project',
    entityId: project.id,
    summary: `Codex bulk generated storyboard boards for ${results.filter((row) => row.ok).length} shot(s).`,
    payload: {
      requestedShotIds: opts.shotIds || null,
      force: !!opts.force,
      artistNote: opts.artistNote || null,
      modelOverride: opts.modelOverride || null,
      estimatedCost,
      results: results.map((row) => ({ shotId: row.shotId, label: row.label, ok: row.ok, error: row.error || null, result: row.result || null })),
      skipped,
    },
  });
  appendSessionJournalEntry(
    project,
    'bulk generated storyboard boards',
    `Succeeded: ${results.filter((row) => row.ok).length}\nFailed: ${results.filter((row) => !row.ok).length}\nSkipped: ${skipped.length}\nEstimated cost: $${estimatedCost.toFixed(3)}\nForce: ${!!opts.force}`,
  );

  return {
    kind: 'mirage.generation_result.bulk_storyboards',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title, storyboardProvider: project.storyboardProvider },
    paid: true,
    estimatedCost,
    counts: {
      requested: targets.length,
      selected: selected.length,
      succeeded: results.filter((row) => row.ok).length,
      failed: results.filter((row) => !row.ok).length,
      skipped: skipped.length,
    },
    results,
    skipped,
    changedArtifacts: results
      .filter((row) => row.ok)
      .flatMap((row) => row.changedArtifacts || [])
      .filter((file, index, files) => files.findIndex((candidate) => candidate.path === file.path) === index),
    note: opts.force
      ? 'Force mode generated storyboard boards for selected unlocked shots with saved prompts.'
      : 'Default mode generated only missing/stale/error unlocked storyboard boards with saved prompts.',
  };
};

export const refineStoryboardImage = async (project: Project, shotId: string, opts: {
  feedback: string;
  previousVersionId?: string;
  artistReferenceImagePath?: string;
  modelOverride?: ModelOverride;
}) => {
  const target = findProjectShot(project, shotId);
  if (!target) throw new Error(`Shot not found in project: ${shotId}`);
  if (target.shot.locked) throw new Error('Cannot refine storyboard image: shot is locked.');
  if (!target.shot.storyboardUrl && !opts.previousVersionId) {
    throw new Error('Cannot refine storyboard image: generate a storyboard board first.');
  }
  const plan = planGenerateStoryboard(project, shotId, opts.modelOverride || {});
  const result = await generateStoryboardVersion({
    projectId: project.id,
    shotId,
    artistNote: opts.feedback,
    previousVersionId: opts.previousVersionId,
    refineMode: 'edit_image',
    artistReferenceImagePath: opts.artistReferenceImagePath,
    modelOverride: { storyboardProvider: opts.modelOverride?.storyboardProvider },
  });
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboard_refined',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex refined the storyboard image for ${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)}.`,
    payload: {
      feedback: opts.feedback,
      previousVersionId: opts.previousVersionId || target.shot.storyboardVersionId || null,
      provider: plan.provider,
      modelOverride: opts.modelOverride?.storyboardProvider ? { storyboardProvider: opts.modelOverride.storyboardProvider } : null,
      estimatedCost: plan.estimatedCost,
      result: eventResultPointers(result),
    },
  });
  appendSessionJournalEntry(
    project,
    'refined storyboard image',
    `${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)}\nShot ID: ${shotId}\nPrevious version: ${opts.previousVersionId || target.shot.storyboardVersionId || 'active'}\nFeedback: ${compactText(opts.feedback, 500)}\nEstimated cost: $${plan.estimatedCost.toFixed(3)}\nWeb: ${webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' })}`,
  );
  const notebookProject = withShotPatch(project, shotId, {
    storyboardUrl: result.imageUrl,
    storyboardVersionId: result.versionId,
    storyboardStatus: 'success',
    storyboardLocked: false,
    videoStatus: 'stale',
  });

  return {
    kind: 'mirage.generation_result.refine_storyboard_image',
    generatedAt: new Date().toISOString(),
    project: plan.project,
    shot: plan.shot,
    provider: plan.provider,
    paid: true,
    estimatedCost: plan.estimatedCost,
    result,
    changedArtifacts: buildNotebookMirrorArtifacts(notebookProject, {
      shotPrompts: true,
      storyboardShotIds: [shotId],
    }),
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' }),
    note: 'Refined storyboard image in edit-image mode, updated active storyboard pointer, unlocked board for review, and marked video stale.',
  };
};

export const lockStoryboardBoard = async (project: Project, shotId: string, versionId?: string) => {
  const target = findProjectShot(project, shotId);
  if (!target) throw new Error(`Shot not found in project: ${shotId}`);
  if (!target.shot.storyboardUrl && !versionId) {
    throw new Error('Cannot lock storyboard: this shot has no active storyboard board.');
  }

  const targetVersionId = versionId || target.shot.storyboardVersionId || null;
  await lockStoryboardVersion(project.id, shotId, targetVersionId || undefined);
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboard_locked',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex locked the storyboard board for ${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)}.`,
    payload: {
      versionId: targetVersionId,
      webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' }),
    },
  });
  appendSessionJournalEntry(
    project,
    'locked storyboard board',
    `${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)}\nShot ID: ${shotId}\nVersion ID: ${targetVersionId || 'active'}\nWeb: ${webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' })}`,
  );
  const notebookProject = withShotPatch(project, shotId, {
    storyboardLocked: true,
    storyboardStatus: 'success',
    ...(targetVersionId ? { storyboardVersionId: targetVersionId } : {}),
  });

  return {
    kind: 'mirage.apply.lock_storyboard',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    shot: {
      id: shotId,
      label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
      versionId: targetVersionId,
    },
    changedArtifacts: buildNotebookMirrorArtifacts(notebookProject, { storyboardShotIds: [shotId] }),
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' }),
    note: 'Locked the active storyboard board. Video generation can now use this board as a trusted reference.',
  };
};

export const unlockStoryboardBoard = async (project: Project, shotId: string) => {
  const target = findProjectShot(project, shotId);
  if (!target) throw new Error(`Shot not found in project: ${shotId}`);

  await unlockStoryboardVersion(project.id, shotId);
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboard_unlocked',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex unlocked the storyboard board for ${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)}.`,
    payload: {
      previousVersionId: target.shot.storyboardVersionId || null,
      webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' }),
    },
  });
  appendSessionJournalEntry(
    project,
    'unlocked storyboard board',
    `${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)}\nShot ID: ${shotId}\nPrevious version: ${target.shot.storyboardVersionId || 'none'}\nWeb: ${webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' })}`,
  );
  const notebookProject = withShotPatch(project, shotId, { storyboardLocked: false });

  return {
    kind: 'mirage.apply.unlock_storyboard',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    shot: {
      id: shotId,
      label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
      previousVersionId: target.shot.storyboardVersionId || null,
    },
    changedArtifacts: buildNotebookMirrorArtifacts(notebookProject, { storyboardShotIds: [shotId] }),
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' }),
    note: 'Unlocked the storyboard board for further review or regeneration.',
  };
};

export const applyProjectPreferencesConfig = async (
  project: Project,
  preferences: unknown,
  baseHash?: string | null,
) => {
  const result = await applyProjectPreferences(project, preferences, baseHash);
  const configCopy = await writeProjectConfigDeskCopy(project, defaultProjectWorkbenchDir(project));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'project_preferences_applied',
    entityType: 'project',
    entityId: project.id,
    summary: 'Codex applied project-level generation preferences.',
    payload: {
      baseHash: baseHash || null,
      newHash: result.hash,
      preferences: result.preferences,
      configPath: configCopy.preferencesPath,
    },
  });
  appendSessionJournalEntry(
    project,
    'applied project preferences',
    `New hash: ${result.hash}\nLocal preferences: ${configCopy.preferencesPath}\nLocal hashes: ${configCopy.hashesPath}`,
  );

  return {
    kind: 'mirage.apply.project_preferences',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    preferences: result.preferences,
    hash: result.hash,
    warnings: result.warnings,
    localFiles: {
      preferences: configCopy.preferencesPath,
      hashes: configCopy.hashesPath,
    },
    changedArtifacts: await buildNotebookConfigArtifacts(project, { preferences: true, hashes: true }),
    note: 'Applied project preferences. Supabase is canonical; local config hashes were refreshed.',
  };
};

export const applyProjectPromptOverrideConfig = async (
  project: Project,
  kind: ProjectPromptOverrideKind,
  body: string,
  baseHash?: string | null,
) => {
  const result = await applyProjectPromptOverride(project.id, kind, body, baseHash);
  const configCopy = await writeProjectConfigDeskCopy(project, defaultProjectWorkbenchDir(project));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'project_prompt_override_applied',
    entityType: 'project',
    entityId: project.id,
    summary: `Codex applied the project ${kind} prompt override.`,
    payload: {
      kind,
      baseHash: baseHash || null,
      newHash: result.hash,
      overrideId: result.overrideId,
      configPath: configCopy.promptPaths[kind],
    },
  });
  appendSessionJournalEntry(
    project,
    'applied project prompt override',
    `Kind: ${kind}\nOverride ID: ${result.overrideId}\nNew hash: ${result.hash}\nLocal prompt: ${configCopy.promptPaths[kind]}`,
  );

  return {
    kind: 'mirage.apply.project_prompt_override',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    promptOverride: result,
    localFiles: {
      prompt: configCopy.promptPaths[kind],
      hashes: configCopy.hashesPath,
    },
    changedArtifacts: await buildNotebookConfigArtifacts(project, { promptKinds: [kind], hashes: true }),
    note: 'Applied project prompt override. There is no preview tool by design: Codex writes the recipe, this tool validates drift and persists it.',
  };
};

export const revertProjectPromptOverrideConfig = async (
  project: Project,
  kind: ProjectPromptOverrideKind,
  baseHash?: string | null,
) => {
  const result = await revertProjectPromptOverride(project.id, kind, baseHash);
  const configCopy = await writeProjectConfigDeskCopy(project, defaultProjectWorkbenchDir(project));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'project_prompt_override_reverted',
    entityType: 'project',
    entityId: project.id,
    summary: result.active
      ? `Codex reverted the project ${kind} prompt override to the previous active recipe.`
      : `Codex reverted the project ${kind} prompt override to the global default.`,
    payload: {
      kind,
      baseHash: baseHash || null,
      newHash: result.hash,
      overrideId: result.overrideId,
      source: result.source,
      configPath: configCopy.promptPaths[kind],
    },
  });
  appendSessionJournalEntry(
    project,
    'reverted project prompt override',
    `Kind: ${kind}\nSource: ${result.source}\nOverride ID: ${result.overrideId || 'none'}\nNew hash: ${result.hash}\nLocal prompt: ${configCopy.promptPaths[kind]}`,
  );

  return {
    kind: 'mirage.apply.revert_project_prompt_override',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    promptOverride: result,
    localFiles: {
      prompt: configCopy.promptPaths[kind],
      hashes: configCopy.hashesPath,
    },
    changedArtifacts: await buildNotebookConfigArtifacts(project, { promptKinds: [kind], hashes: true }),
    note: result.active
      ? 'Reverted to the previous project override and refreshed local config hashes.'
      : 'No previous override remained active; reverted to the global default and refreshed local config hashes.',
  };
};

export const applyGenerateVideo = async (project: Project, shotId: string, promptOverride?: string, modelOverride: ModelOverride = {}) => {
  const plan = planGenerateVideo(project, shotId, modelOverride);
  if (!plan.canRun) {
    throw new Error(`Cannot generate video: ${plan.prerequisites.join(' ')}`);
  }

  const result = await generateShotVideo(project.id, shotId, { promptOverride, modelOverride: { videoModel: modelOverride.videoModel } });
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'video_generated',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex generated a video for ${shotLabel(plan.shot.sceneIndex - 1, plan.shot.shotIndex - 1)}.`,
    payload: {
      promptOverride: promptOverride || null,
      mode: plan.mode,
      model: plan.model,
      modelOverride: modelOverride.videoModel ? { videoModel: modelOverride.videoModel } : null,
      estimatedCost: plan.estimatedCost,
      result: eventResultPointers(result),
    },
  });
  appendSessionJournalEntry(
    project,
    'generated video',
    `${shotLabel(plan.shot.sceneIndex - 1, plan.shot.shotIndex - 1)}\nShot ID: ${shotId}\nMode: ${plan.mode}\nModel: ${plan.model.key}\nEstimated cost: $${plan.estimatedCost.toFixed(3)}\nWeb: ${webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-video' })}`,
  );
  const notebookProject = withShotPatch(project, shotId, {
    videoUrl: result.videoUrl,
    videoStatus: 'success',
    extractedLastFrameUrl: result.extractedLastFrameUrl,
  });

  return {
    kind: 'mirage.generation_result.video',
    generatedAt: new Date().toISOString(),
    project: plan.project,
    shot: plan.shot,
    mode: plan.mode,
    model: plan.model,
    estimatedCost: plan.estimatedCost,
    appliedPlan: {
      willOverwrite: plan.willOverwrite,
      willChange: plan.willChange,
    },
    result,
    changedArtifacts: buildNotebookMirrorArtifacts(notebookProject, { shotPrompts: true }),
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-video' }),
    note: 'Generated shot video, updated the active video pointer, and attempted last-frame extraction.',
  };
};
