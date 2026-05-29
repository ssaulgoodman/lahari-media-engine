import { v4 as uuidv4 } from 'uuid';
import { insertRow, selectOne, supportsPlatformColumns } from '../../database.js';
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
  sourceAssetId?: string | null;
  directorBrief?: string | null;
  scriptText?: string | null;
  targetRuntime?: number | null;
  targetShotDuration?: number | null;
}) => {
  const requestedSeedKind = opts.seedKind || (opts.scriptText ? 'script' : 'brief');
  const { workflow, seedKind, preset } = resolveProjectIntake({
    workflowKey: opts.workflowKey,
    presetKey: opts.presetKey,
    seedKind: requestedSeedKind,
  });
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
  const sourceAsset = opts.sourceAssetId
    ? await selectOne('assets', { id: opts.sourceAssetId })
    : null;
  if (opts.sourceAssetId) {
    if (!sourceAsset) {
      const err = new Error(`Audio source asset not found: ${opts.sourceAssetId}`);
      (err as any).statusCode = 404;
      throw err;
    }
    const ownerProject = await selectOne('projects', { id: sourceAsset.project_id });
    if (!ownerProject || ownerProject.user_id !== userId) {
      const err = new Error('Access denied for sourceAssetId.');
      (err as any).statusCode = 403;
      throw err;
    }
    if (sourceAsset.category !== 'audio_source') {
      const err = new Error('sourceAssetId must reference an audio_source asset.');
      (err as any).statusCode = 400;
      throw err;
    }
  }
  const audioPath = seedKind === 'audio' && sourceAsset ? sourceAsset.file_path : null;

  await insertRow('projects', {
    id: projectId,
    title,
    status: 'uploaded',
    audio_path: audioPath,
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
      source_payload: {
        ...sourcePayload,
        ...(audioPath ? { sourceAssetId: opts.sourceAssetId, storageKey: audioPath } : {}),
      },
    }),
  });

  if (audioPath && sourceAsset) {
    await insertRow('assets', {
      id: uuidv4(),
      project_id: projectId,
      category: 'audio_source',
      file_path: audioPath,
      prompt: sourceAsset.prompt || 'Attached audio source',
      metadata: JSON.stringify({
        copiedFromAssetId: sourceAsset.id,
        attachedBy: 'create_project',
      }),
    });
  }

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
      sourceAssetId: opts.sourceAssetId || null,
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
      : seedKind === 'audio'
        ? (audioPath
            ? 'Audio source attached. Ask the artist whether this is soundtrack-only or source material; run analyze_audio_transcribe/analyze_audio_structure only if needed.'
            : 'Audio project shell created. Upload the audio file with /api/agent/uploads purpose=audio_source, then run analysis actions only if the audio should drive the work.')
      : 'Project shell created. Use apply_concept/apply_script and then write_project_notebook to materialize the workspace.',
  };
};
