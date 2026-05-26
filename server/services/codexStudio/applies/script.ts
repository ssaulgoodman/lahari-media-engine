import { rpcVoid } from '../../../database.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import { scriptContentHash, usesStoryboardWorkflow, webStudioUrl, type Project } from '../core.js';
import { buildNotebookMirrorArtifacts } from '../notebook.js';
import { parseScriptMarkdownDraft } from '../scriptMarkdown.js';
import {
  appendApplyJournal,
  applyError,
  hasDownstreamVisualWork,
  isApplyError,
  normalizeScriptForApply,
  scriptCounts,
  scriptDraftHash,
  validateBaseHash,
} from './helpers.js';
import { parseTimestamp } from '../../script-validation.js';

const projectWithScript = (project: Project, normalized: ReturnType<typeof normalizeScriptForApply>): Project => ({
  ...project,
  cast: normalized.cast.map((member) => ({
    ...member,
    referenceImageUrl: null,
    promptsStale: false,
  })),
  environments: normalized.environments.map((environment) => ({
    ...environment,
    referenceImageUrl: null,
    promptsStale: false,
  })),
  scenes: normalized.scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((shot) => ({
      ...shot,
      isExtra: !!(shot as any).isExtra,
      visualPrompt: '',
      motionPrompt: '',
      storyboardPrompt: '',
      storyboardCutPlan: '',
      storyboardPromptStatus: 'idle',
      storyboardStatus: 'idle',
      storyboardUrl: null,
      storyboardLocked: false,
      videoUrl: null,
      videoStatus: 'idle',
      imageUrl: null,
      endImageUrl: null,
      extractedLastFrameUrl: null,
      locked: false,
      promptsStale: false,
    })),
  })),
} as Project);

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
  const notebookProject = projectWithScript(project, normalized);
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
    changedArtifacts: buildNotebookMirrorArtifacts(notebookProject, {
      script: true,
      scriptDraft: true,
      cast: true,
      environments: true,
      shotPrompts: true,
      storyboardShotIds: normalized.scenes.flatMap((scene) => scene.shots.map((shot) => shot.id)),
    }),
    notebookRefresh: {
      recommended: true,
      tool: 'write_project_notebook',
      reason: 'Script apply replaces the shot topology; rerun the notebook tool if old per-shot mirror files may still exist.',
    },
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    note: 'Applied full script atomically via Postgres RPC. Cast, environments, scenes, and shots were replaced.',
  };
};

const validateScriptDurationsForProject = (project: Project, script: ReturnType<typeof normalizeScriptForApply>) => {
  for (const scene of script.scenes) {
    const sceneDuration = parseTimestamp(scene.endTime) - parseTimestamp(scene.startTime);
    if (sceneDuration <= 0) continue;
    const total = scene.shots.reduce((sum: number, shot: any) => sum + Number(shot.duration || 0), 0);
    if (Math.abs(total - sceneDuration) > 0.01) {
      return applyError('validation_failed', `Scene "${scene.sectionLabel}" durations add to ${total}s but scene duration is ${sceneDuration}s.`, {
        field: 'duration',
        next: 'Edit drafts/script.md so shot durations in this scene add exactly to the scene timestamp range.',
      });
    }
    if (usesStoryboardWorkflow(project) || project.videoModel?.startsWith('seedance')) {
      for (const shot of scene.shots) {
        if (shot.duration > 15) {
          return applyError('validation_failed', `Shot ${shot.id} is ${shot.duration}s. Seedance/storyboard script drafts must split shots above 15s.`, {
            field: 'duration',
            shotId: shot.id,
            next: 'Split this beat into adjacent shots under 15s, usually preserving the same cast and environment.',
          });
        }
      }
    }
  }
  return null;
};

const validateScriptReferences = (script: any) => {
  const castIds = new Set((script.cast || []).map((member: any) => member.id));
  const environmentIds = new Set((script.environments || []).map((environment: any) => environment.id));
  for (const scene of script.scenes || []) {
    for (const shot of scene.shots || []) {
      for (const castId of shot.castIds || []) {
        if (!castIds.has(castId)) {
          return applyError('validation_failed', `Shot ${shot.id} references unknown cast ID ${castId}.`, {
            field: 'castIds',
            shotId: shot.id,
            next: 'Keep cast IDs exactly as written in drafts/script.md, or add the cast entry before referencing it.',
          });
        }
      }
      if (shot.environmentId && !environmentIds.has(shot.environmentId)) {
        return applyError('validation_failed', `Shot ${shot.id} references unknown environment ID ${shot.environmentId}.`, {
          field: 'environmentId',
          shotId: shot.id,
          next: 'Keep environment IDs exactly as written in drafts/script.md, or add the environment entry before referencing it.',
        });
      }
    }
  }
  return null;
};

export const applyScriptMarkdown = async (
  project: Project,
  markdown: string,
  opts: { baseFingerprint?: string; force?: boolean } = {},
) => {
  const parsed = parseScriptMarkdownDraft(markdown);
  if (isApplyError(parsed)) return parsed;
  if (parsed.projectId && parsed.projectId !== project.id) {
    return applyError('validation_failed', `Script draft projectId ${parsed.projectId} does not match target project ${project.id}.`, {
      field: 'projectId',
      next: 'Apply this draft to the matching project, or refresh the notebook for the current project.',
    });
  }
  if (parsed.baseFingerprint && opts.baseFingerprint && parsed.baseFingerprint !== opts.baseFingerprint && !opts.force) {
    return applyError('drift_detected', 'Script draft fingerprint and submitted baseFingerprint disagree.', {
      field: 'scriptFingerprint',
      currentHash: scriptContentHash(project),
      submittedBaseHash: opts.baseFingerprint,
      next: 'Use the scriptFingerprint from drafts/script.md, or refresh the notebook and reconcile the draft.',
    });
  }
  const baseFingerprint = opts.baseFingerprint || parsed.baseFingerprint || undefined;
  const referenceError = validateScriptReferences(parsed.script);
  if (referenceError) return referenceError;
  const normalized = normalizeScriptForApply(parsed.script);
  const durationError = validateScriptDurationsForProject(project, normalized);
  if (durationError) return durationError;
  return applyScript(project, parsed.script, { ...opts, baseFingerprint });
};
