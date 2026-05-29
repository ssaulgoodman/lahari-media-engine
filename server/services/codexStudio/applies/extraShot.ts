import { v4 as uuidv4 } from 'uuid';
import { deleteRows, insertRow, selectAll, updateRows } from '../../../database.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import { buildNotebookMirrorArtifacts } from '../notebook.js';
import { webStudioUrl, type Project } from '../core.js';
import { appendApplyJournal, applyError } from './helpers.js';

const EXTRA_SCENE_LABEL = 'Extra Shots';

export type AddExtraShotInput = {
  title?: string;
  direction: string;
  durationSec: number;
  castIds?: string[];
  environmentId?: string | null;
  continuityFrom?: 'cut' | 'prev_shot';
  workflowMode?: 'auto' | 'storyboard' | 'keyframe';
  placementNote?: string;
};

export type DeleteExtraShotInput = {
  shotId: string;
  force?: boolean;
  reason?: string;
};

const lastSceneEndTime = (project: Project): string => {
  const last = project.scenes[project.scenes.length - 1];
  return last?.endTime || '00:00';
};

export const addExtraShot = async (project: Project, input: AddExtraShotInput) => {
  const direction = input.direction?.trim() || '';
  if (!direction) {
    return applyError('validation_failed', 'direction is required for an extra shot.', {
      field: 'direction',
      next: 'Write a concrete visual beat that fits the existing story, then retry.',
    });
  }

  const duration = Number(input.durationSec);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 15) {
    return applyError('validation_failed', 'Extra shot duration must be positive and <= 15 seconds.', {
      field: 'durationSec',
      next: 'Use a short insert/B-roll duration. If the idea needs more than 15 seconds, split it into multiple extra shots.',
    });
  }

  const castIds = Array.isArray(input.castIds) ? input.castIds.filter(Boolean) : [];
  const knownCast = new Set(project.cast.map((member) => member.id));
  const unknownCast = castIds.find((id) => !knownCast.has(id));
  if (unknownCast) {
    return applyError('validation_failed', `Unknown cast ID for extra shot: ${unknownCast}.`, {
      field: 'castIds',
      next: 'Use existing cast IDs from the notebook, or add the new character through the script/config flow first.',
    });
  }

  const environmentId = input.environmentId || null;
  if (environmentId && !project.environments.some((environment) => environment.id === environmentId)) {
    return applyError('validation_failed', `Unknown environment ID for extra shot: ${environmentId}.`, {
      field: 'environmentId',
      next: 'Use an existing environment ID from the notebook, or add the new environment through the script/config flow first.',
    });
  }

  const extraScene = project.scenes.find((scene) => scene.sectionLabel === EXTRA_SCENE_LABEL);
  const sceneId = extraScene?.id || uuidv4();
  const sceneSortOrder = extraScene ? project.scenes.findIndex((scene) => scene.id === extraScene.id) : project.scenes.length;
  const shotId = `extra_${uuidv4().slice(0, 8)}`;
  const shotSortOrder = extraScene ? extraScene.shots.length : 0;
  const anchorTime = lastSceneEndTime(project);
  const placementNote = input.placementNote?.trim() || '';

  if (!extraScene) {
    await insertRow('scenes', {
      id: sceneId,
      project_id: project.id,
      section_label: EXTRA_SCENE_LABEL,
      start_time: anchorTime,
      end_time: anchorTime,
      lyrics: '',
      narrative_description: 'Out-of-band insert shots for render/media-library use. These do not rebalance the song script.',
      sort_order: sceneSortOrder,
    });
  }

  await insertRow('shots', {
    id: shotId,
    scene_id: sceneId,
    direction: placementNote ? `${direction}\n\nPlacement note: ${placementNote}` : direction,
    visual_prompt: '',
    motion_prompt: '',
    duration,
    cast_ids: JSON.stringify(castIds),
    environment_id: environmentId,
    continuity_from: input.continuityFrom === 'prev_shot' ? 'prev_shot' : 'cut',
    prompts_stale: false,
    use_next_as_end_frame: 0,
    lipsync_enabled: false,
    use_prev_storyboard_ref: false,
    include_prev_cut_plan: null,
    excluded_refs: { storyboard: [], video: [] },
    workflow_mode: input.workflowMode || 'auto',
    sort_order: shotSortOrder,
    image_status: 'idle',
    video_status: 'idle',
    storyboard_status: 'idle',
    storyboard_prompt_status: 'idle',
    is_extra: true,
    last_error: null,
  });

  await updateRows('projects', { id: project.id }, { updated_at: new Date().toISOString() });

  const newShot = {
    id: shotId,
    isExtra: true,
    workflowMode: input.workflowMode || 'auto',
    direction: placementNote ? `${direction}\n\nPlacement note: ${placementNote}` : direction,
    visualPrompt: '',
    motionPrompt: 'Cinematic camera movement',
    duration,
    castIds,
    imageStatus: 'idle',
    endImageStatus: 'idle',
    continuityFrom: input.continuityFrom === 'prev_shot' ? 'prev_shot' as const : 'cut' as const,
    locked: false,
    environmentId: environmentId || undefined,
    promptsStale: false,
    videoStatus: 'idle',
    storyboardStatus: 'idle',
    storyboardPromptStatus: 'idle',
    excludedRefs: { storyboard: [], video: [] },
    usePrevStoryboardRef: false,
    includePrevCutPlan: null,
    useNextAsEndFrame: false,
  };
  const nextScene = extraScene
    ? { ...extraScene, shots: [...extraScene.shots, newShot] }
    : {
      id: sceneId,
      sectionLabel: EXTRA_SCENE_LABEL,
      startTime: anchorTime,
      endTime: anchorTime,
      lyrics: '',
      narrativeDescription: 'Out-of-band insert shots for render/media-library use. These do not rebalance the song script.',
      shots: [newShot],
    };
  const notebookProject = {
    ...project,
    updatedAt: new Date().toISOString(),
    scenes: extraScene
      ? project.scenes.map((scene) => (scene.id === extraScene.id ? nextScene : scene))
      : [...project.scenes, nextScene],
  };

  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'extra_shot_added',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex added an extra shot${input.title ? `: ${input.title}` : ''}.`,
    payload: {
      shotId,
      sceneId,
      durationSec: duration,
      castIds,
      environmentId,
      placementNote: placementNote || null,
    },
  });
  appendApplyJournal(project, 'added extra shot', `Shot ID: ${shotId}\nDuration: ${duration}s\nDirection: ${direction}\nPlacement: ${placementNote || 'manual timeline placement'}\nWeb: ${webStudioUrl(project.id, { step: 'studio', shotId })}`);

  return {
    kind: 'lahari.apply.extra_shot',
    projectId: project.id,
    scene: {
      id: sceneId,
      label: EXTRA_SCENE_LABEL,
      created: !extraScene,
    },
    shot: {
      id: shotId,
      title: input.title || null,
      direction,
      durationSec: duration,
      castIds,
      environmentId,
      isExtra: true,
    },
    changedArtifacts: buildNotebookMirrorArtifacts(notebookProject as Project, {
      script: true,
      scriptDraft: true,
      storyboardSceneIds: [sceneId],
    }),
    notebookRefresh: {
      recommended: true,
      reason: 'An extra shot changes the notebook topology. Refresh/sync before writing storyboard drafts for the new shot.',
    },
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId }),
    note: 'Added an out-of-band extra shot. Generate storyboard/video through the normal shot workflow; its video will appear in the Media Library for manual timeline placement.',
  };
};

export const deleteExtraShot = async (project: Project, input: DeleteExtraShotInput) => {
  const shotId = input.shotId?.trim();
  if (!shotId) {
    return applyError('validation_failed', 'shotId is required to delete an extra shot.', {
      field: 'shotId',
      next: 'Pass the exact extra shot ID, for example extra_ab12cd34.',
    });
  }

  const scene = project.scenes.find((candidate) => candidate.shots.some((shot) => shot.id === shotId));
  const shot = scene?.shots.find((candidate) => candidate.id === shotId);
  if (!scene || !shot) {
    return applyError('shot_not_found', `Shot not found in this project: ${shotId}.`, {
      field: 'shotId',
      next: 'Refresh the notebook/project packet and retry with a current shot ID.',
    });
  }

  if (!shot.isExtra) {
    return applyError('validation_failed', `Refusing to delete non-extra shot: ${shotId}.`, {
      field: 'shotId',
      next: 'Use script editing for canonical script topology changes. This tool is only for out-of-band Extra Shots.',
    });
  }

  const assets = await selectAll('assets', { project_id: project.id, shot_id: shotId });
  const hasPointers = Boolean((shot as any).storyboardUrl || (shot as any).videoUrl || (shot as any).imageUrl || (shot as any).endImageUrl);
  const hasAssets = assets.length > 0;
  if ((hasPointers || hasAssets) && !input.force) {
    const categories = Array.from(new Set(assets.map((asset) => asset.category))).sort();
    return applyError('downstream_visual_work', `Extra shot ${shotId} has generated assets; refusing to delete without force.`, {
      field: 'force',
      next: `If the artist explicitly wants to remove the shot from the project, retry with force:true. Paid asset rows will remain in the asset library; only the shot pointer is removed. Asset rows: ${assets.length}${categories.length ? ` (${categories.join(', ')})` : ''}.`,
    });
  }

  await deleteRows('shots', { id: shotId });

  const remainingExtraShots = scene.shots.filter((candidate) => candidate.id !== shotId);
  const sceneDeleted = scene.sectionLabel === EXTRA_SCENE_LABEL && remainingExtraShots.length === 0;
  if (sceneDeleted) {
    await deleteRows('scenes', { id: scene.id });
  }

  await updateRows('projects', { id: project.id }, { updated_at: new Date().toISOString() });

  const nextScenes = sceneDeleted
    ? project.scenes.filter((candidate) => candidate.id !== scene.id)
    : project.scenes.map((candidate) => (
      candidate.id === scene.id
        ? { ...candidate, shots: candidate.shots.filter((existingShot) => existingShot.id !== shotId) }
        : candidate
    ));
  const notebookProject = {
    ...project,
    updatedAt: new Date().toISOString(),
    scenes: nextScenes,
  };

  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'extra_shot_deleted',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex deleted extra shot ${shotId}.`,
    payload: {
      shotId,
      sceneId: scene.id,
      force: !!input.force,
      reason: input.reason?.trim() || null,
      preservedAssetCount: assets.length,
      preservedAssetCategories: Array.from(new Set(assets.map((asset) => asset.category))).sort(),
    },
  });
  appendApplyJournal(project, 'deleted extra shot', `Shot ID: ${shotId}\nReason: ${input.reason?.trim() || 'not specified'}\nPreserved asset rows: ${assets.length}`);

  return {
    kind: 'lahari.apply.extra_shot_delete',
    projectId: project.id,
    deletedShotId: shotId,
    scene: {
      id: scene.id,
      label: scene.sectionLabel,
      deleted: sceneDeleted,
    },
    preservedAssets: assets.map((asset) => ({
      id: asset.id,
      category: asset.category,
      filePath: asset.file_path,
    })),
    changedArtifacts: buildNotebookMirrorArtifacts(notebookProject as Project, {
      script: true,
      scriptDraft: true,
      storyboardSceneIds: [scene.id],
    }),
    notebookRefresh: {
      recommended: true,
      reason: 'Deleting an extra shot changes notebook topology. Refresh/sync before editing storyboard drafts.',
    },
    webUrl: webStudioUrl(project.id, { step: 'studio' }),
    note: 'Deleted only the extra shot row. Existing paid/generated asset rows were preserved.',
  };
};
