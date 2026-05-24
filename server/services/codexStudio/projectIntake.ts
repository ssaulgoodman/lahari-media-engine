import { v4 as uuidv4 } from 'uuid';
import { insertRow, supportsPlatformColumns } from '../../database.js';
import { resolveProjectIntake, type SeedKind } from '../../presets.js';
import { recordDirectorEvent } from '../directorEvents.js';
import { webStudioUrl } from './core.js';

const platformProjectFields = (fields: Record<string, any>) =>
  supportsPlatformColumns() ? fields : {};

const cleanString = (value: unknown, fallback = ''): string => {
  const text = String(value || '').trim();
  return text || fallback;
};

export const createProjectForDirector = async (userId: string, opts: {
  title: string;
  workflowKey?: string | null;
  presetKey?: string | null;
  seedKind?: SeedKind | null;
  directorBrief?: string | null;
  scriptText?: string | null;
  targetRuntime?: number | null;
  targetShotDuration?: number | null;
}) => {
  const { workflow, seedKind, preset } = resolveProjectIntake({
    workflowKey: opts.workflowKey,
    presetKey: opts.presetKey,
    seedKind: opts.seedKind,
  });
  if (seedKind === 'audio') {
    const err = new Error('MCP project creation does not upload audio. Create audio-seed projects in the web studio, or create a brief/idea project here.');
    (err as any).statusCode = 400;
    throw err;
  }

  const projectId = uuidv4();
  const title = cleanString(opts.title, `Untitled ${workflow.label} Project`);
  const directorBrief = cleanString(opts.directorBrief);
  const scriptText = cleanString(opts.scriptText);
  const targetShotDuration = Number(opts.targetShotDuration || preset.defaults.pacing);
  const targetRuntime = opts.targetRuntime && Number.isFinite(Number(opts.targetRuntime))
    ? Number(opts.targetRuntime)
    : null;
  const sourcePayload = {
    kind: seedKind,
    title,
    ...(scriptText ? { scriptText } : {}),
    ...(directorBrief ? { directorBrief } : {}),
  };
  const projectBrief = {
    title,
    directorBrief,
    targetRuntime,
    targetShotDuration,
  };

  await insertRow('projects', {
    id: projectId,
    title,
    status: 'uploaded',
    lyrics: scriptText,
    meaning: directorBrief,
    musical_structure: JSON.stringify([]),
    image_model: preset.defaults.imageModel,
    storyboard_provider: preset.defaults.imageModel,
    video_model: preset.defaults.videoModel,
    aspect_ratio: preset.defaults.aspectRatio,
    target_duration: targetShotDuration,
    style_description: preset.style.presetBible || preset.style.rules,
    user_id: userId,
    ...platformProjectFields({
      preset_key: preset.key,
      workflow_key: workflow.key,
      seed_kind: seedKind,
      project_brief: projectBrief,
      source_payload: sourcePayload,
    }),
  });

  await recordDirectorEvent({
    projectId,
    source: 'codex',
    eventType: 'project_created',
    entityType: 'project',
    entityId: projectId,
    summary: `Created ${workflow.label} project "${title}" from ${seedKind} seed.`,
    payload: {
      workflowKey: workflow.key,
      presetKey: preset.key,
      seedKind,
      hasScriptText: !!scriptText,
    },
  });

  return {
    kind: 'mirage.project.created',
    projectId,
    title,
    workflowKey: workflow.key,
    presetKey: preset.key,
    seedKind,
    webUrl: webStudioUrl(projectId, { step: 'blueprint' }),
    next: scriptText
      ? 'Project shell created with scriptText saved in source_payload. Use apply_script or apply_script_markdown to persist scenes, shots, cast, and environments.'
      : 'Project shell created. Use apply_concept/apply_script and then write_project_notebook to materialize the workspace.',
  };
};
