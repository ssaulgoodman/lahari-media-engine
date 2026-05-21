import { updateRows } from '../../../database.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import { webStudioUrl, type Project, type ProjectShot } from '../core.js';
import { buildNotebookMirrorArtifacts } from '../notebook.js';
import { appendApplyJournal, applyError, findProjectShot } from './helpers.js';

export type ShotWorkflowMode = 'auto' | 'storyboard' | 'keyframe';

export type ShotWorkflowApplyInput = {
  shotId: string;
  workflowMode: ShotWorkflowMode;
  note?: string;
};

export const applyShotWorkflowModes = async (
  project: Project,
  shots: ShotWorkflowApplyInput[],
) => {
  if (!Array.isArray(shots) || shots.length === 0) {
    return applyError('validation_failed', 'shots must contain at least one workflow update.', { field: 'shots' });
  }

  const allowed = new Set<ShotWorkflowMode>(['auto', 'storyboard', 'keyframe']);
  const applied: Array<{ shotId: string; workflowMode: ShotWorkflowMode }> = [];
  const rejected: Array<{ shotId?: string; reason: string }> = [];
  const nextShotsById = new Map<string, ProjectShot>();

  for (const row of shots) {
    if (!allowed.has(row.workflowMode)) {
      rejected.push({ shotId: row.shotId, reason: `Invalid workflowMode: ${row.workflowMode}` });
      continue;
    }
    const target = findProjectShot(project, row.shotId);
    if (!target) {
      rejected.push({ shotId: row.shotId, reason: 'shot_not_found' });
      continue;
    }
    await updateRows('shots', { id: row.shotId }, {
      workflow_mode: row.workflowMode,
    });
    const nextShot = { ...target.shot, workflowMode: row.workflowMode };
    nextShotsById.set(row.shotId, nextShot);
    applied.push({ shotId: row.shotId, workflowMode: row.workflowMode });
    await recordDirectorEvent({
      projectId: project.id,
      source: 'codex',
      eventType: 'shot_workflow_mode_applied',
      entityType: 'shot',
      entityId: row.shotId,
      summary: `Codex set ${row.workflowMode} workflow for ${target.sceneIndex}.${target.shotIndex}.`,
      payload: {
        workflowMode: row.workflowMode,
        note: row.note || null,
      },
    });
  }

  const notebookProject = nextShotsById.size
    ? {
      ...project,
      scenes: project.scenes.map((scene) => ({
        ...scene,
        shots: scene.shots.map((shot) => nextShotsById.get(shot.id) || shot),
      })),
    }
    : project;

  if (applied.length) {
    appendApplyJournal(
      project,
      'applied shot workflow modes',
      applied.map((row) => `- ${row.shotId}: ${row.workflowMode}`).join('\n'),
    );
  }

  return {
    kind: 'mirage.apply.shot_workflow_modes',
    projectId: project.id,
    applied,
    rejected,
    changedArtifacts: applied.length ? buildNotebookMirrorArtifacts(notebookProject, {
      shotPrompts: true,
      storyboardSceneIds: [...new Set(project.scenes
        .filter((scene) => scene.shots.some((shot) => nextShotsById.has(shot.id)))
        .map((scene) => scene.id))],
    }) : [],
    webUrl: webStudioUrl(project.id, { step: 'studio' }),
    note: 'Applied per-shot workflow modes. auto follows project/model defaults; storyboard/keyframe force the shot path for agent-led work.',
  };
};
