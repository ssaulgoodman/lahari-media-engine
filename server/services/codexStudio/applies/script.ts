import { rpcVoid } from '../../../database.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import { scriptContentHash, webStudioUrl, type Project } from '../core.js';
import {
  appendApplyJournal,
  applyError,
  hasDownstreamVisualWork,
  normalizeScriptForApply,
  scriptCounts,
  scriptDraftHash,
  validateBaseHash,
} from './helpers.js';

export const applyScript = async (
  project: Project,
  script: unknown,
  opts: { baseFingerprint?: string; force?: boolean } = {},
) => {
  const normalized = normalizeScriptForApply(script);
  const counts = scriptCounts(normalized);
  if (counts.scenes < 1 || counts.shots < 1) {
    return applyError('schema_invalid', 'Script must include at least one scene and one shot.', {
      field: 'script',
      next: 'Rewrite the script with scenes[].shots[] populated and retry.',
    });
  }
  for (const scene of normalized.scenes) {
    if (!scene.shots.length) {
      return applyError('schema_invalid', `Scene "${scene.sectionLabel}" has no shots.`, { field: 'scenes' });
    }
    for (const shot of scene.shots) {
      if (!shot.direction.trim()) return applyError('validation_failed', 'Every shot needs a direction.', { field: 'direction', shotId: shot.id });
      if (!Number.isFinite(shot.duration) || shot.duration <= 0 || shot.duration > 60) {
        return applyError('validation_failed', `Shot duration ${shot.duration} must be positive and <= 60 seconds.`, { field: 'duration', shotId: shot.id });
      }
    }
  }

  const drift = validateBaseHash(scriptContentHash(project), opts.baseFingerprint, opts.force);
  if (drift) return drift;
  if (hasDownstreamVisualWork(project) && !opts.force) {
    return applyError('downstream_visual_work', 'Project has generated references, boards, videos, or locks. Fork before applying a new script, or pass force: true after explicit approval.', {
      next: `Fork first, or explicitly approve force: true to wipe downstream work for ${project.id}.`,
    });
  }

  await rpcVoid('lahari_apply_script', {
    p_project_id: project.id,
    p_script: normalized,
  });

  const newFingerprint = scriptDraftHash(normalized);
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'script_applied',
    entityType: 'project',
    entityId: project.id,
    summary: `Codex applied script with ${counts.scenes} scenes and ${counts.shots} shots.`,
    payload: {
      newFingerprint,
      counts,
      forced: !!opts.force,
    },
  });
  appendApplyJournal(project, 'applied script', `Scenes: ${counts.scenes}\nShots: ${counts.shots}\nNew fingerprint: ${newFingerprint}\nForce: ${!!opts.force}\nWeb: ${webStudioUrl(project.id, { step: 'blueprint' })}`);

  return {
    kind: 'lahari.apply.script',
    projectId: project.id,
    counts,
    newFingerprint,
    forced: !!opts.force,
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    note: 'Applied full script atomically via Postgres RPC. Cast, environments, scenes, and shots were replaced.',
  };
};
