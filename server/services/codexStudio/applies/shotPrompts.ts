import { updateRows } from '../../../database.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import {
  appendApplyJournal,
  applyError,
  ensureLength,
  findProjectShot,
  shotApplyLabel,
  validateBaseHash,
  type ApplyError,
} from './helpers.js';
import { shotPromptHash, webStudioUrl, type Project } from '../core.js';

export type ShotPromptApplyInput = {
  shotId: string;
  visualPrompt?: string;
  motionPrompt?: string;
  direction?: string;
  continuityFrom?: 'cut' | 'prev_shot';
  baseHash?: string;
};

export const applyShotPrompts = async (project: Project, shots: ShotPromptApplyInput[], opts: { force?: boolean } = {}) => {
  if (!Array.isArray(shots) || shots.length === 0) {
    return applyError('validation_failed', 'shots must contain at least one shot update.', { field: 'shots' });
  }

  const updates: Array<{ shotId: string; fieldsChanged: string[]; newHash: string }> = [];
  const rejected: ApplyError[] = [];

  for (const input of shots) {
    const target = findProjectShot(project, input.shotId);
    if (!target) {
      rejected.push(applyError('shot_not_found', `Shot not found in project: ${input.shotId}`, { shotId: input.shotId }));
      continue;
    }
    if (target.shot.locked) {
      rejected.push(applyError('locked', 'Shot is locked. Unlock before applying prompt changes.', { shotId: input.shotId }));
      continue;
    }

    const provided = [
      input.visualPrompt !== undefined ? 'visualPrompt' : null,
      input.motionPrompt !== undefined ? 'motionPrompt' : null,
      input.direction !== undefined ? 'direction' : null,
      input.continuityFrom !== undefined ? 'continuityFrom' : null,
    ].filter(Boolean) as string[];
    if (!provided.length) {
      rejected.push(applyError('validation_failed', 'At least one prompt field is required.', { shotId: input.shotId }));
      continue;
    }

    const validation = ensureLength('visualPrompt', input.visualPrompt, 4000, { shotId: input.shotId, required: input.visualPrompt !== undefined })
      || ensureLength('motionPrompt', input.motionPrompt, 2000, { shotId: input.shotId, required: input.motionPrompt !== undefined })
      || ensureLength('direction', input.direction, 500, { shotId: input.shotId })
      || (input.continuityFrom && input.continuityFrom !== 'cut' && input.continuityFrom !== 'prev_shot'
        ? applyError('validation_failed', 'continuityFrom must be cut or prev_shot.', { field: 'continuityFrom', shotId: input.shotId })
        : null)
      || validateBaseHash(shotPromptHash(target.shot), input.baseHash, opts.force, input.shotId);
    if (validation) {
      rejected.push(validation);
      continue;
    }

    const nextShot = {
      ...target.shot,
      ...(input.visualPrompt !== undefined ? { visualPrompt: input.visualPrompt.trim() } : {}),
      ...(input.motionPrompt !== undefined ? { motionPrompt: input.motionPrompt.trim() } : {}),
      ...(input.direction !== undefined ? { direction: input.direction.trim() } : {}),
      ...(input.continuityFrom !== undefined ? { continuityFrom: input.continuityFrom } : {}),
    };
    const fieldsChanged = provided.filter((field) => (nextShot as any)[field] !== (target.shot as any)[field]);
    const dbUpdate: Record<string, unknown> = {
      prompts_stale: false,
    };
    if (input.visualPrompt !== undefined) {
      dbUpdate.visual_prompt = input.visualPrompt.trim();
      dbUpdate.refined_from_prev_frame = 0;
    }
    if (input.motionPrompt !== undefined) {
      dbUpdate.motion_prompt = input.motionPrompt.trim();
      dbUpdate.refined_from_prev_frame = 0;
    }
    if (input.direction !== undefined) dbUpdate.direction = input.direction.trim();
    if (input.continuityFrom !== undefined) dbUpdate.continuity_from = input.continuityFrom;

    await updateRows('shots', { id: input.shotId }, dbUpdate);
    const newHash = shotPromptHash(nextShot);
    updates.push({ shotId: input.shotId, fieldsChanged, newHash });
    await recordDirectorEvent({
      projectId: project.id,
      source: 'codex',
      eventType: 'shot_prompts_applied',
      entityType: 'shot',
      entityId: input.shotId,
      summary: `Codex applied shot prompts for ${shotApplyLabel(target)}.`,
      payload: {
        fieldsChanged,
        newHash,
        sourceCharCount: provided.reduce((sum, field) => sum + String((input as any)[field] || '').length, 0),
      },
    });
    appendApplyJournal(project, 'applied shot prompts', `${shotApplyLabel(target)}\nShot ID: ${input.shotId}\nFields: ${fieldsChanged.join(', ') || 'metadata only'}\nNew hash: ${newHash}\nWeb: ${webStudioUrl(project.id, { step: 'studio', shotId: input.shotId })}`);
  }

  return {
    kind: 'lahari.apply.shot_prompts',
    projectId: project.id,
    shotsUpdated: updates.length,
    updates,
    rejected,
    webUrl: webStudioUrl(project.id, { step: 'studio' }),
    note: rejected.length
      ? 'Applied valid shot prompt updates and rejected invalid/drifted rows. Fix rejected rows and retry them.'
      : 'Applied shot prompt updates. No assets, videos, or locks were changed.',
  };
};
