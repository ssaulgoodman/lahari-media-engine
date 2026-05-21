import { updateRows } from '../../../database.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import { storyboardPromptHash, webStudioUrl, type Project, type ProjectShot } from '../core.js';
import { buildNotebookMirrorArtifacts } from '../notebook.js';
import { parseStoryboardSceneMarkdownDraft } from '../storyboardMarkdown.js';
import {
  appendApplyJournal,
  applyError,
  ensureLength,
  findProjectShot,
  shotApplyLabel,
  validateBaseHash,
  type ApplyError,
} from './helpers.js';

export type StoryboardPromptApplyInput = {
  shotId: string;
  storyboardPrompt: string;
  storyboardCutPlan: string;
  baseHash?: string;
};

export const applyStoryboardPrompt = async (
  project: Project,
  shotId: string,
  storyboardPrompt: string,
  storyboardCutPlan = '',
  opts: { baseHash?: string; force?: boolean } = {},
) => {
  const result = await applyStoryboardPromptsBulk(project, {
    shots: [{ shotId, storyboardPrompt, storyboardCutPlan, baseHash: opts.baseHash }],
    force: opts.force,
    single: true,
  });
  return result;
};

export const applyStoryboardPromptsBulk = async (
  project: Project,
  input: { shots: StoryboardPromptApplyInput[]; force?: boolean; single?: boolean },
) => {
  if (!Array.isArray(input.shots) || input.shots.length === 0) {
    return applyError('validation_failed', 'shots must contain at least one storyboard prompt update.', { field: 'shots' });
  }

  const applied: Array<{ shotId: string; newHash: string }> = [];
  const skipped: Array<{ shotId: string; reason: string }> = [];
  const rejected: ApplyError[] = [];
  const nextShotsById = new Map<string, ProjectShot>();

  for (const row of input.shots) {
    const target = findProjectShot(project, row.shotId);
    if (!target) {
      rejected.push(applyError('shot_not_found', `Shot not found in project: ${row.shotId}`, { shotId: row.shotId }));
      continue;
    }
    if (target.shot.locked) {
      skipped.push({ shotId: row.shotId, reason: 'locked' });
      continue;
    }

    const validation = ensureLength('storyboardPrompt', row.storyboardPrompt, 5000, { required: true, shotId: row.shotId })
      || ensureLength('storyboardCutPlan', row.storyboardCutPlan, 3000, { shotId: row.shotId })
      || validateBaseHash(storyboardPromptHash(target.shot), row.baseHash, input.force, row.shotId);
    if (validation) {
      rejected.push(validation);
      continue;
    }

    const nextShot = {
      ...target.shot,
      storyboardPrompt: row.storyboardPrompt.trim(),
      storyboardCutPlan: row.storyboardCutPlan?.trim() || '',
    };
    const newHash = storyboardPromptHash(nextShot);
    await updateRows('shots', { id: row.shotId }, {
      storyboard_prompt: nextShot.storyboardPrompt,
      storyboard_cut_plan: nextShot.storyboardCutPlan,
      storyboard_prompt_status: 'success',
      prompts_stale: false,
      ...(target.shot.storyboardUrl ? { storyboard_status: 'stale' } : {}),
      ...(target.shot.videoUrl ? { video_status: 'stale' } : {}),
      last_error: null,
    });

    applied.push({ shotId: row.shotId, newHash });
    nextShotsById.set(row.shotId, nextShot);
    await recordDirectorEvent({
      projectId: project.id,
      source: 'codex',
      eventType: 'storyboard_prompt_applied',
      entityType: 'shot',
      entityId: row.shotId,
      summary: `Codex applied storyboard prompt for ${shotApplyLabel(target)}.`,
      payload: {
        newHash,
        sourceCharCount: row.storyboardPrompt.length + (row.storyboardCutPlan?.length || 0),
        markedStoryboardStale: !!target.shot.storyboardUrl,
        markedVideoStale: !!target.shot.videoUrl,
      },
    });
    appendApplyJournal(project, 'applied storyboard prompt', `${shotApplyLabel(target)}\nShot ID: ${row.shotId}\nPrompt chars: ${nextShot.storyboardPrompt.length}\nCut plan chars: ${nextShot.storyboardCutPlan.length}\nNew hash: ${newHash}\nWeb: ${webStudioUrl(project.id, { step: 'studio', shotId: row.shotId, action: 'review-storyboard-prompt' })}`);
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

  return {
    kind: input.single ? 'lahari.apply.storyboard_prompt' : 'lahari.apply.storyboard_prompts_bulk',
    projectId: project.id,
    applied,
    skipped,
    rejected,
    changedArtifacts: applied.length
      ? buildNotebookMirrorArtifacts(notebookProject, {
        shotPrompts: true,
        storyboardShotIds: applied.map((row) => row.shotId),
        storyboardSceneIds: [...new Set(applied.flatMap((row) => (
          project.scenes
            .filter((scene) => scene.shots.some((shot) => shot.id === row.shotId))
            .map((scene) => scene.id)
        )))],
      })
      : [],
    webUrl: webStudioUrl(project.id, { step: 'studio' }),
    note: rejected.length || skipped.length
      ? 'Applied valid storyboard prompt updates. Review skipped/rejected rows before continuing.'
      : 'Applied storyboard prompt updates. Existing boards/videos were marked stale where present.',
  };
};

export const applyStoryboardSceneMarkdown = async (
  project: Project,
  markdown: string,
  opts: { force?: boolean } = {},
) => {
  const parsed = parseStoryboardSceneMarkdownDraft(markdown);
  if ('error' in parsed) return parsed;
  if (parsed.projectId && parsed.projectId !== project.id) {
    return applyError('validation_failed', `Storyboard scene draft belongs to project ${parsed.projectId}, not ${project.id}.`, { field: 'projectId' });
  }
  const scene = project.scenes.find((candidate) => candidate.id === parsed.sceneId);
  if (!scene) {
    return applyError('validation_failed', `Storyboard scene draft references unknown scene: ${parsed.sceneId || '(missing)'}.`, { field: 'sceneId' });
  }
  const sceneShotIds = new Set(scene.shots.map((shot) => shot.id));
  const outsideScene = parsed.shots.find((shot) => !sceneShotIds.has(shot.shotId));
  if (outsideScene) {
    return applyError('validation_failed', `Shot ${outsideScene.shotId} is not part of scene ${scene.id}.`, { shotId: outsideScene.shotId, field: 'shotId' });
  }

  const result = await applyStoryboardPromptsBulk(project, {
    shots: parsed.shots,
    force: opts.force,
  });
  if ('error' in result) return result;
  const appliedShotIds = new Set((result.applied || []).map((shot) => shot.shotId));
  const nextShotsById = new Map(parsed.shots.filter((shot) => appliedShotIds.has(shot.shotId)).map((shot) => [shot.shotId, shot]));
  const notebookProject = {
    ...project,
    scenes: project.scenes.map((projectScene) => ({
      ...projectScene,
      shots: projectScene.shots.map((shot) => {
        const next = nextShotsById.get(shot.id);
        return next
          ? { ...shot, storyboardPrompt: next.storyboardPrompt.trim(), storyboardCutPlan: next.storyboardCutPlan?.trim() || '' }
          : shot;
      }),
    })),
  };
  return {
    ...result,
    kind: 'mirage.apply.storyboard_scene_markdown',
    scene: {
      id: scene.id,
      label: scene.sectionLabel || `Scene ${project.scenes.findIndex((candidate) => candidate.id === scene.id) + 1}`,
    },
    changedArtifacts: result.changedArtifacts?.length
      ? result.changedArtifacts
      : buildNotebookMirrorArtifacts(notebookProject, { storyboardSceneIds: [scene.id] }),
    note: 'Applied storyboard scene markdown. Review rejected rows before continuing; valid rows were persisted and existing boards/videos marked stale where present.',
  };
};
