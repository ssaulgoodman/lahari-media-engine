import { updateRows } from '../../../database.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import { usesStoryboardWorkflow, videoPromptHash, webStudioUrl, type Project } from '../core.js';
import { buildNotebookMirrorArtifacts } from '../notebook.js';
import {
  appendApplyJournal,
  applyError,
  ensureLength,
  findProjectShot,
  shotApplyLabel,
  validateBaseHash,
} from './helpers.js';

export const applyVideoPrompt = async (
  project: Project,
  shotId: string,
  motionPrompt: string,
  opts: { baseHash?: string; force?: boolean } = {},
) => {
  if (usesStoryboardWorkflow(project)) {
    return applyError('wrong_workflow', 'This project is in storyboard mode. Use apply_storyboard_prompt instead; Seedance reads the board and cut plan.', {
      shotId,
      next: 'Use apply_storyboard_prompt for storyboard-mode video direction.',
    });
  }
  const target = findProjectShot(project, shotId);
  if (!target) return applyError('shot_not_found', `Shot not found in project: ${shotId}`, { shotId });
  if (target.shot.locked) return applyError('locked', 'Shot is locked. Unlock before applying video prompt changes.', { shotId });

  const validation = ensureLength('motionPrompt', motionPrompt, 2000, { required: true, shotId })
    || validateBaseHash(videoPromptHash(target.shot), opts.baseHash, opts.force, shotId);
  if (validation) return validation;

  const nextMotionPrompt = motionPrompt.trim();
  await updateRows('shots', { id: shotId }, {
    motion_prompt: nextMotionPrompt,
    prompts_stale: false,
    ...(target.shot.videoUrl ? { video_status: 'stale' } : {}),
  });

  const newHash = videoPromptHash({ motionPrompt: nextMotionPrompt });
  const notebookProject = {
    ...project,
    scenes: project.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => shot.id === shotId
        ? {
          ...shot,
          motionPrompt: nextMotionPrompt,
          promptsStale: false,
          ...(target.shot.videoUrl ? { videoStatus: 'stale' } : {}),
        }
        : shot),
    })),
  };
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'video_prompt_applied',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex applied video prompt for ${shotApplyLabel(target)}.`,
    payload: {
      newHash,
      sourceCharCount: nextMotionPrompt.length,
      markedVideoStale: !!target.shot.videoUrl,
    },
  });
  appendApplyJournal(project, 'applied video prompt', `${shotApplyLabel(target)}\nShot ID: ${shotId}\nMotion prompt chars: ${nextMotionPrompt.length}\nNew hash: ${newHash}\nWeb: ${webStudioUrl(project.id, { step: 'studio', shotId, action: 'generate-video' })}`);

  return {
    kind: 'mirage.apply.video_prompt',
    projectId: project.id,
    shotId,
    newHash,
    markedVideoStale: !!target.shot.videoUrl,
    changedArtifacts: buildNotebookMirrorArtifacts(notebookProject, { shotPrompts: true }),
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'generate-video' }),
    note: 'Applied keyframe-mode video prompt. No image, storyboard, video, or lock rows were changed.',
  };
};
