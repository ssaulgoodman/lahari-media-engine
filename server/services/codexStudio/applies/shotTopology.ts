import { v4 as uuidv4 } from 'uuid';
import { countRows, deleteRows, insertRow, updateRows } from '../../../database.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import {
  scriptContentHash,
  shotLabel,
  usesStoryboardWorkflow,
  webStudioUrl,
  type Project,
  type ProjectShot,
} from '../core.js';
import { buildNotebookMirrorArtifacts } from '../notebook.js';
import {
  appendApplyJournal,
  applyError,
  ensureLength,
  findProjectShot,
  shotApplyLabel,
} from './helpers.js';

type SceneRef = Project['scenes'][number];

export type AddShotInput = {
  sceneId: string;
  afterShotId?: string | null;
  beforeShotId?: string | null;
  direction: string;
  durationSec?: number;
  castIds?: string[];
  environmentId?: string | null;
  continuityFrom?: 'cut' | 'prev_shot';
  workflowMode?: 'auto' | 'storyboard' | 'keyframe';
  visualPrompt?: string;
  motionPrompt?: string;
  storyboardPrompt?: string;
  storyboardCutPlan?: string;
};

export type DeleteShotInput = {
  shotId: string;
  force?: boolean;
  note?: string;
};

const findScene = (project: Project, sceneId: string): { scene: SceneRef; sceneIndex: number } | null => {
  const sceneIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
  if (sceneIndex < 0) return null;
  return { scene: project.scenes[sceneIndex], sceneIndex };
};

const projectWithScene = (project: Project, sceneId: string, scene: SceneRef): Project => ({
  ...project,
  scenes: project.scenes.map((candidate) => candidate.id === sceneId ? scene : candidate),
});

const staleNextContinuityShot = (shot: ProjectShot): ProjectShot => ({
  ...shot,
  promptsStale: true,
  ...(shot.storyboardUrl ? { storyboardStatus: 'stale' } : {}),
  ...(shot.videoUrl ? { videoStatus: 'stale' } : {}),
});

const shotDeletionRisks = async (shot: ProjectShot): Promise<string[]> => {
  const risks: string[] = [];
  if (shot.locked) risks.push('locked_video');
  if (shot.storyboardLocked) risks.push('locked_storyboard');
  if (shot.imageUrl) risks.push('start_frame');
  if (shot.endImageUrl) risks.push('end_frame');
  if (shot.extractedLastFrameUrl) risks.push('extracted_last_frame');
  if (shot.storyboardUrl || shot.storyboardAssetId || shot.storyboardVersionId) risks.push('storyboard');
  if (shot.videoUrl) risks.push('video');
  if (shot.audioPlan) risks.push('audio_plan');
  const [assetRows, storyboardRows] = await Promise.all([
    countRows('assets', { shot_id: shot.id }),
    countRows('storyboard_versions', { shot_id: shot.id }),
  ]);
  if (assetRows > 0) risks.push(`asset_rows:${assetRows}`);
  if (storyboardRows > 0) risks.push(`storyboard_versions:${storyboardRows}`);
  return risks;
};

const validateShotDuration = (project: Project, durationSec: number, shotId?: string) => {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 60) {
    return applyError('validation_failed', 'durationSec must be positive and <= 60 seconds.', { field: 'durationSec', shotId });
  }
  if ((usesStoryboardWorkflow(project) || project.videoModel?.startsWith('seedance')) && durationSec > 15) {
    return applyError('validation_failed', 'Storyboard/Seedance shots must stay <= 15 seconds. Split the beat into adjacent shots.', {
      field: 'durationSec',
      shotId,
    });
  }
  return null;
};

const validateReferences = (project: Project, castIds: string[], environmentId?: string | null) => {
  const cast = new Set(project.cast.map((member) => member.id));
  for (const castId of castIds) {
    if (!cast.has(castId)) {
      return applyError('validation_failed', `Unknown cast ID: ${castId}`, {
        field: 'castIds',
        next: 'Use cast IDs exactly as shown in script.md/state/cast.md, or add the cast member through apply_script before referencing it.',
      });
    }
  }
  if (environmentId && !project.environments.some((environment) => environment.id === environmentId)) {
    return applyError('validation_failed', `Unknown environment ID: ${environmentId}`, {
      field: 'environmentId',
      next: 'Use environment IDs exactly as shown in script.md/state/environments.md, or add the environment through apply_script before referencing it.',
    });
  }
  return null;
};

const applySceneOrderAndContinuityFlags = async (scene: SceneRef): Promise<SceneRef> => {
  const nextShots = scene.shots.map((shot, index) => ({
    ...shot,
    useNextAsEndFrame: scene.shots[index + 1]?.continuityFrom === 'prev_shot',
  }));
  for (const [index, shot] of nextShots.entries()) {
    await updateRows('shots', { id: shot.id }, {
      sort_order: index,
      use_next_as_end_frame: shot.useNextAsEndFrame ? 1 : 0,
    });
  }
  return { ...scene, shots: nextShots };
};

const affectedSceneArtifacts = (project: Project, scene: SceneRef) => buildNotebookMirrorArtifacts(project, {
  script: true,
  shotPrompts: true,
  audioPlan: true,
  storyboardSceneIds: [scene.id],
  storyboardShotIds: scene.shots.map((shot) => shot.id),
});

export const addShot = async (project: Project, input: AddShotInput) => {
  const directionValidation = ensureLength('direction', input.direction, 2000, { required: true })
    || ensureLength('visualPrompt', input.visualPrompt, 4000)
    || ensureLength('motionPrompt', input.motionPrompt, 2000)
    || ensureLength('storyboardPrompt', input.storyboardPrompt, 5000)
    || ensureLength('storyboardCutPlan', input.storyboardCutPlan, 3000);
  if (directionValidation) return directionValidation;
  if (input.afterShotId && input.beforeShotId) {
    return applyError('validation_failed', 'Provide afterShotId or beforeShotId, not both.', { field: 'afterShotId' });
  }
  const sceneTarget = findScene(project, input.sceneId);
  if (!sceneTarget) {
    return applyError('validation_failed', `Scene not found in project: ${input.sceneId}`, { field: 'sceneId' });
  }
  if (input.continuityFrom !== undefined && input.continuityFrom !== 'cut' && input.continuityFrom !== 'prev_shot') {
    return applyError('validation_failed', 'continuityFrom must be cut or prev_shot.', { field: 'continuityFrom' });
  }
  if (input.workflowMode !== undefined && !['auto', 'storyboard', 'keyframe'].includes(input.workflowMode)) {
    return applyError('validation_failed', 'workflowMode must be auto, storyboard, or keyframe.', { field: 'workflowMode' });
  }
  if (input.castIds !== undefined && !Array.isArray(input.castIds)) {
    return applyError('validation_failed', 'castIds must be an array of cast member IDs.', { field: 'castIds' });
  }

  const durationSec = Number(input.durationSec || 8);
  const durationError = validateShotDuration(project, durationSec);
  if (durationError) return durationError;
  const castIds = [...new Set(input.castIds || [])];
  const referenceError = validateReferences(project, castIds, input.environmentId);
  if (referenceError) return referenceError;

  let insertIndex = sceneTarget.scene.shots.length;
  if (input.afterShotId || input.beforeShotId) {
    const anchorId = input.afterShotId || input.beforeShotId;
    const anchorIndex = sceneTarget.scene.shots.findIndex((shot) => shot.id === anchorId);
    if (anchorIndex < 0) {
      return applyError('validation_failed', `Anchor shot is not in scene ${input.sceneId}: ${anchorId}`, {
        field: input.afterShotId ? 'afterShotId' : 'beforeShotId',
        next: 'Use an anchor shot from the same scene, or omit the anchor to append at the end.',
      });
    }
    insertIndex = input.afterShotId ? anchorIndex + 1 : anchorIndex;
  }

  const shotId = uuidv4();
  const continuityFrom = input.continuityFrom === 'prev_shot' && insertIndex > 0 ? 'prev_shot' : 'cut';
  const nextShotBase: ProjectShot = {
    id: shotId,
    workflowMode: input.workflowMode || 'auto',
    direction: input.direction.trim(),
    visualPrompt: input.visualPrompt?.trim() || '',
    motionPrompt: input.motionPrompt?.trim() || '',
    duration: durationSec,
    castIds,
    environmentId: input.environmentId || undefined,
    continuityFrom,
    useNextAsEndFrame: false,
    refinedFromPrevFrame: false,
    imageStatus: 'idle',
    videoStatus: 'idle',
    endImageStatus: 'idle',
    locked: false,
    storyboardStatus: 'idle',
    storyboardLocked: false,
    storyboardPrompt: input.storyboardPrompt?.trim() || undefined,
    storyboardCutPlan: input.storyboardCutPlan?.trim() || undefined,
    storyboardPromptStatus: input.storyboardPrompt?.trim() ? 'success' : 'idle',
    promptsStale: false,
    audioPlanStale: false,
    lipsyncEnabled: false,
    excludedRefs: { storyboard: [], video: [] },
    usePrevStoryboardRef: false,
    includePrevCutPlan: null,
  } as ProjectShot;

  const provisionalShots = [
    ...sceneTarget.scene.shots.slice(0, insertIndex),
    nextShotBase,
    ...sceneTarget.scene.shots.slice(insertIndex),
  ];
  const nextContinuityTarget = provisionalShots[insertIndex + 1];
  const continuityStaleShotIds: string[] = [];
  if (nextContinuityTarget?.continuityFrom === 'prev_shot') {
    provisionalShots[insertIndex + 1] = staleNextContinuityShot(nextContinuityTarget);
    continuityStaleShotIds.push(nextContinuityTarget.id);
    await updateRows('shots', { id: nextContinuityTarget.id }, {
      prompts_stale: true,
      ...(nextContinuityTarget.storyboardUrl ? { storyboard_status: 'stale' } : {}),
      ...(nextContinuityTarget.videoUrl ? { video_status: 'stale' } : {}),
    });
  }

  await insertRow('shots', {
    id: shotId,
    scene_id: sceneTarget.scene.id,
    direction: nextShotBase.direction,
    visual_prompt: nextShotBase.visualPrompt,
    motion_prompt: nextShotBase.motionPrompt,
    duration: durationSec,
    cast_ids: JSON.stringify(castIds),
    environment_id: input.environmentId || null,
    continuity_from: continuityFrom,
    prompts_stale: false,
    use_next_as_end_frame: 0,
    lipsync_enabled: false,
    use_prev_storyboard_ref: false,
    include_prev_cut_plan: null,
    excluded_refs: { storyboard: [], video: [] },
    workflow_mode: nextShotBase.workflowMode,
    storyboard_prompt: nextShotBase.storyboardPrompt || null,
    storyboard_cut_plan: nextShotBase.storyboardCutPlan || null,
    storyboard_prompt_status: nextShotBase.storyboardPrompt ? 'success' : 'idle',
    sort_order: insertIndex,
    image_status: 'idle',
    video_status: 'idle',
    end_image_status: 'idle',
  });

  const orderedScene = await applySceneOrderAndContinuityFlags({ ...sceneTarget.scene, shots: provisionalShots });
  await updateRows('projects', { id: project.id }, {
    status: project.status === 'created' ? 'scripted' : project.status,
    updated_at: new Date().toISOString(),
  });

  const notebookProject = projectWithScene(project, sceneTarget.scene.id, orderedScene);
  const newFingerprint = scriptContentHash(notebookProject);
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'shot_added',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex added ${shotLabel(sceneTarget.sceneIndex, insertIndex)} without rebuilding the script.`,
    payload: {
      sceneId: sceneTarget.scene.id,
      insertIndex,
      durationSec,
      castIds,
      environmentId: input.environmentId || null,
      continuityFrom,
      workflowMode: nextShotBase.workflowMode,
      continuityStaleShotIds,
      newFingerprint,
    },
  });
  appendApplyJournal(project, 'added shot', `${shotLabel(sceneTarget.sceneIndex, insertIndex)}\nShot ID: ${shotId}\nScene ID: ${sceneTarget.scene.id}\nDuration: ${durationSec}s\nContinuity: ${continuityFrom}\nStale neighbors: ${continuityStaleShotIds.join(', ') || 'none'}\nNew fingerprint: ${newFingerprint}\nWeb: ${webStudioUrl(project.id, { step: 'studio', shotId })}`);

  return {
    kind: 'mirage.apply.add_shot',
    projectId: project.id,
    sceneId: sceneTarget.scene.id,
    shotId,
    insertedAt: {
      sceneIndex: sceneTarget.sceneIndex + 1,
      shotIndex: insertIndex + 1,
    },
    newFingerprint,
    continuityStaleShotIds,
    changedArtifacts: affectedSceneArtifacts(notebookProject, orderedScene),
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId }),
    note: continuityStaleShotIds.length
      ? 'Added one shot without replacing topology. The following continuity-dependent neighbor shots were marked stale because their previous-shot context changed.'
      : 'Added one shot without replacing topology. Existing refs, boards, videos, and locks were preserved.',
  };
};

export const deleteShot = async (project: Project, input: DeleteShotInput) => {
  const target = findProjectShot(project, input.shotId);
  if (!target) return applyError('shot_not_found', `Shot not found in project: ${input.shotId}`, { shotId: input.shotId });

  const scene = project.scenes[target.sceneIndex - 1];
  if (!scene) return applyError('validation_failed', `Scene not found for shot: ${input.shotId}`, { shotId: input.shotId, field: 'sceneId' });
  if (scene.shots.length <= 1) {
    return applyError('validation_failed', 'delete_shot cannot leave a scene empty.', {
      shotId: input.shotId,
      next: 'If the whole scene should go away, use apply_script after explicit structural approval.',
    });
  }

  const risks = await shotDeletionRisks(target.shot);
  if (risks.length && !input.force) {
    return applyError('downstream_visual_work', 'Shot has downstream work. Pass force:true only after the artist approves deleting this shot and its generated rows.', {
      shotId: input.shotId,
      next: `Deletion risks: ${risks.join(', ')}.`,
    });
  }

  const nextShots = scene.shots.filter((shot) => shot.id !== input.shotId);
  const nextShotAtDeletedIndex = nextShots[target.shotIndex - 1];
  const continuityStaleShotIds: string[] = [];
  if (nextShotAtDeletedIndex?.continuityFrom === 'prev_shot') {
    const nextContinuity = target.shotIndex === 1 ? 'cut' : 'prev_shot';
    const nextShot = staleNextContinuityShot({ ...nextShotAtDeletedIndex, continuityFrom: nextContinuity });
    nextShots[target.shotIndex - 1] = nextShot;
    continuityStaleShotIds.push(nextShot.id);
    await updateRows('shots', { id: nextShot.id }, {
      continuity_from: nextContinuity,
      prompts_stale: true,
      ...(nextShotAtDeletedIndex.storyboardUrl ? { storyboard_status: 'stale' } : {}),
      ...(nextShotAtDeletedIndex.videoUrl ? { video_status: 'stale' } : {}),
    });
  }

  await deleteRows('storyboard_versions', { shot_id: input.shotId });
  await deleteRows('assets', { shot_id: input.shotId });
  await deleteRows('shots', { id: input.shotId });

  const orderedScene = await applySceneOrderAndContinuityFlags({ ...scene, shots: nextShots });
  await updateRows('projects', { id: project.id }, { updated_at: new Date().toISOString() });

  const notebookProject = projectWithScene(project, scene.id, orderedScene);
  const newFingerprint = scriptContentHash(notebookProject);
  const removedLocalPaths = [
    `mirage/projects/${project.id}/state/storyboards/${input.shotId}.md`,
  ];
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'shot_deleted',
    entityType: 'shot',
    entityId: input.shotId,
    summary: `Codex deleted ${shotApplyLabel(target)} without rebuilding the script.`,
    payload: {
      sceneId: scene.id,
      force: !!input.force,
      risks,
      note: input.note || null,
      continuityStaleShotIds,
      removedLocalPaths,
      newFingerprint,
    },
  });
  appendApplyJournal(project, 'deleted shot', `${shotApplyLabel(target)}\nShot ID: ${input.shotId}\nScene ID: ${scene.id}\nForce: ${!!input.force}\nDeleted downstream rows: ${risks.join(', ') || 'none'}\nStale neighbors: ${continuityStaleShotIds.join(', ') || 'none'}\nNew fingerprint: ${newFingerprint}\nWeb: ${webStudioUrl(project.id, { step: 'blueprint' })}`);

  return {
    kind: 'mirage.apply.delete_shot',
    projectId: project.id,
    sceneId: scene.id,
    shotId: input.shotId,
    forced: !!input.force,
    deletionRisks: risks,
    newFingerprint,
    continuityStaleShotIds,
    removedLocalPaths,
    changedArtifacts: affectedSceneArtifacts(notebookProject, orderedScene),
    webUrl: webStudioUrl(project.id, { step: 'studio' }),
    note: risks.length
      ? 'Deleted one shot and its generated rows after force approval. Refresh/sync the local notebook so removed shot files are pruned.'
      : 'Deleted one shot without replacing topology. Existing work on other shots was preserved.',
  };
};
