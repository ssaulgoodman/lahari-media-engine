import { v4 as uuidv4 } from 'uuid';
import { insertRow, selectAll, selectOne, updateRows } from '../../database.js';
import { storageUrl } from '../../storage.js';
import { buildCharacterPrompt, buildEnvironmentPrompt, buildStylePrompt } from '../imagePrompts.js';
import { refineFramePrompt } from '../claude.js';
import { getImageGenerationModelName, getImageService } from '../image-provider.js';
import { getProjectPromptOverride } from '../projectConfig.js';
import { recordDirectorEvent } from '../directorEvents.js';
import { logCall, buildContextChain } from '../../xray.js';
import { getFullProject } from '../../routes/projects.js';
import { compactText, webStudioUrl, type Project } from './core.js';

type ImageModelOverride = {
  imageModel?: string;
};

const projectImageModel = (project: Project, modelOverride?: ImageModelOverride) => (
  modelOverride?.imageModel || project.imageModel
);

const assertGeneratedLooks = (paths: string[], label: string) => {
  if (paths.length > 0) return;
  const err: any = new Error(`${label} generated zero image candidates. Try again or switch the Image model.`);
  err.statusCode = 502;
  throw err;
};

const requireAsset = async (projectId: string, assetId: string) => {
  const asset = await selectOne('assets', { id: assetId });
  if (!asset || asset.project_id !== projectId) throw new Error('Asset not found or does not belong to this project');
  return asset;
};

const requireCastMember = async (projectId: string, castMemberId: string) => {
  const member = await selectOne('cast_members', { id: castMemberId });
  if (!member || member.project_id !== projectId) throw new Error('Cast member not found or does not belong to this project');
  return member;
};

const requireEnvironment = async (projectId: string, environmentId: string) => {
  const environment = await selectOne('environments', { id: environmentId });
  if (!environment || environment.project_id !== projectId) throw new Error('Environment not found or does not belong to this project');
  return environment;
};

const markStyleDependentsStale = async (projectId: string) => {
  await updateRows('cast_members', { project_id: projectId }, { prompts_stale: true });
  await updateRows('environments', { project_id: projectId }, { prompts_stale: true });
  const scenes = await selectAll('scenes', { project_id: projectId });
  for (const scene of scenes) {
    await updateRows('shots', { scene_id: scene.id }, { prompts_stale: true });
  }
};

const markDependentShotsStale = async (projectId: string, type: 'cast' | 'env', entityId: string) => {
  const scenes = await selectAll('scenes', { project_id: projectId });
  for (const scene of scenes) {
    const shots = await selectAll('shots', { scene_id: scene.id });
    for (const shot of shots) {
      if (type === 'cast') {
        let castIds: string[] = [];
        try {
          castIds = JSON.parse(shot.cast_ids || '[]');
        } catch {
          castIds = [];
        }
        if (castIds.includes(entityId)) await updateRows('shots', { id: shot.id }, { prompts_stale: true });
      } else if (shot.environment_id === entityId) {
        await updateRows('shots', { id: shot.id }, { prompts_stale: true });
      }
    }
  }
};

const projectStyleImagePath = async (projectId: string) => {
  const row = await selectOne('projects', { id: projectId });
  if (!row?.style_asset_id) return undefined;
  const asset = await selectOne('assets', { id: row.style_asset_id });
  return asset?.file_path as string | undefined;
};

export const generateStyleReference = async (
  project: Project,
  stylePrompt: string,
  modelOverride: ImageModelOverride = {},
) => {
  const prompt = stylePrompt?.trim();
  if (!prompt) throw new Error('prompt is required');

  const concept = project.lockedConcept || {};
  const deity = (concept as any).deity || project.title;
  const genPrompt = buildStylePrompt(prompt, deity);
  const imageModel = projectImageModel(project, modelOverride);
  const imageService = getImageService(imageModel);
  const modelName = getImageGenerationModelName(imageModel);
  const started = Date.now();

  const assetPath = await imageService.generateSingleStyleImage(prompt, deity, genPrompt);
  const assetId = uuidv4();
  await insertRow('assets', {
    id: assetId,
    project_id: project.id,
    category: 'style',
    file_path: assetPath,
    prompt,
  });

  await logCall({
    projectId: project.id,
    stage: 'visualize-style',
    model: modelName,
    prompt: genPrompt,
    contextChain: await buildContextChain(project.id),
    responseSummary: 'Generated style image from director prompt.',
    outputAssetIds: [assetId],
    durationMs: Date.now() - started,
    costEstimate: 0.01,
  });
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'style_visualized',
    entityType: 'asset',
    entityId: assetId,
    summary: 'Codex generated a style reference image.',
    payload: { assetId, model: modelName },
  });

  return {
    kind: 'lahari.generate.style_reference',
    projectId: project.id,
    asset: { id: assetId, url: storageUrl(assetPath), prompt: compactText(prompt, 1200) },
    model: modelName,
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
  };
};

export const lockStyleReference = async (
  project: Project,
  assetId: string,
  styleDescription?: string | null,
) => {
  if (!assetId) throw new Error('assetId is required');
  await requireAsset(project.id, assetId);

  await updateRows('projects', { id: project.id }, {
    status: 'style_locked',
    style_asset_id: assetId,
    style_description: styleDescription || project.styleDescription || '',
    updated_at: new Date().toISOString(),
  });
  await markStyleDependentsStale(project.id);
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'style_locked',
    entityType: 'asset',
    entityId: assetId,
    summary: 'Codex locked the project style reference; downstream prompts were marked stale.',
    payload: { assetId, hasDescription: !!styleDescription },
  });

  return {
    kind: 'lahari.lock.style_reference',
    projectId: project.id,
    assetId,
    project: await getFullProject(project.id),
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
  };
};

export const generateCharacterLook = async (
  project: Project,
  castMemberId: string,
  opts: { feedback?: string; modelOverride?: ImageModelOverride } = {},
) => {
  if (!castMemberId) throw new Error('castMemberId is required');
  const member = await requireCastMember(project.id, castMemberId);
  const styleImagePath = await projectStyleImagePath(project.id);
  const imageModel = projectImageModel(project, opts.modelOverride);
  const modelName = getImageGenerationModelName(imageModel);

  let genPrompt = member.generation_prompt as string | null;
  if (!genPrompt || member.prompts_stale) {
    genPrompt = buildCharacterPrompt(
      { name: member.name, description: member.description || '' },
      { styleIdx: styleImagePath ? 1 : undefined },
    );
    if (member.prompts_stale) await updateRows('cast_members', { id: member.id }, { prompts_stale: false });
  }

  const recipe = await getProjectPromptOverride(project.id, 'character_looks');
  const withRecipe = (value: string) => recipe && !value.includes('Project character-look recipe:')
    ? `${value}\n\nProject character-look recipe:\n${recipe}`
    : value;

  const feedback = opts.feedback?.trim();
  if (feedback) {
    try {
      const rewritten = await refineFramePrompt({
        currentPrompt: withRecipe(genPrompt),
        feedback: `[CHARACTER LOOK for ${member.name}] ${feedback}`,
        textProvider: project.textProvider,
      });
      genPrompt = rewritten.visualPrompt;
    } catch {
      genPrompt += `\n\nDirector note: ${feedback}`;
    }
  }

  await updateRows('cast_members', { id: member.id }, { generation_prompt: genPrompt, prompts_stale: false });
  const renderPrompt = withRecipe(genPrompt);
  const imageService = getImageService(imageModel);
  const started = Date.now();
  const imagePaths = await imageService.generateCharacterLooks(
    { name: member.name, description: member.description || '' },
    styleImagePath,
    undefined,
    project.aspectRatio || '16:9',
    undefined,
    renderPrompt,
    modelName,
  );
  assertGeneratedLooks(imagePaths, `Character look generation for ${member.name}`);

  const looks: { id: string; url: string }[] = [];
  for (let i = 0; i < imagePaths.length; i += 1) {
    const assetId = uuidv4();
    await insertRow('assets', {
      id: assetId,
      project_id: project.id,
      category: 'character_candidate',
      file_path: imagePaths[i],
      prompt: `Look ${i + 1} for ${member.name}`,
      metadata: JSON.stringify({ castMemberId: member.id }),
    });
    looks.push({ id: assetId, url: storageUrl(imagePaths[i]) });
  }

  await logCall({
    projectId: project.id,
    stage: 'generate-looks',
    model: modelName,
    prompt: `Generate looks for "${member.name}" | Prompt: ${compactText(renderPrompt, 1500)}`,
    referenceInputs: styleImagePath ? [{ type: 'image', label: 'Style reference', url: storageUrl(styleImagePath) }] : [],
    contextChain: await buildContextChain(project.id),
    responseSummary: `Generated ${looks.length} looks for ${member.name}`,
    outputAssetIds: looks.map((look) => look.id),
    durationMs: Date.now() - started,
    costEstimate: 0.04,
  });
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'character_looks_generated',
    entityType: 'cast_member',
    entityId: member.id,
    summary: `Codex generated ${looks.length} looks for character "${member.name}".`,
    payload: { castMemberId: member.id, assetIds: looks.map((look) => look.id), feedback: feedback || null, model: modelName },
  });

  return {
    kind: 'lahari.generate.character_look',
    projectId: project.id,
    castMember: { id: member.id, name: member.name },
    looks,
    generationPrompt: genPrompt,
    model: modelName,
    project: await getFullProject(project.id),
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
  };
};

export const lockCharacterLook = async (project: Project, castMemberId: string, assetId: string) => {
  if (!castMemberId || !assetId) throw new Error('castMemberId and assetId are required');
  await requireCastMember(project.id, castMemberId);
  await requireAsset(project.id, assetId);
  await updateRows('cast_members', { id: castMemberId }, { reference_asset_id: assetId });
  await markDependentShotsStale(project.id, 'cast', castMemberId);
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'character_locked',
    entityType: 'cast_member',
    entityId: castMemberId,
    summary: 'Codex locked a character reference; dependent shots were marked stale.',
    payload: { castMemberId, assetId },
  });
  return { kind: 'lahari.lock.character_look', projectId: project.id, castMemberId, assetId, project: await getFullProject(project.id) };
};

export const unlockCharacterLook = async (project: Project, castMemberId: string) => {
  if (!castMemberId) throw new Error('castMemberId is required');
  await requireCastMember(project.id, castMemberId);
  await updateRows('cast_members', { id: castMemberId }, { reference_asset_id: null });
  await markDependentShotsStale(project.id, 'cast', castMemberId);
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'character_unlocked',
    entityType: 'cast_member',
    entityId: castMemberId,
    summary: 'Codex unlocked a character reference; dependent shots were marked stale.',
    payload: { castMemberId },
  });
  return { kind: 'lahari.unlock.character_look', projectId: project.id, castMemberId, project: await getFullProject(project.id) };
};

export const generateEnvironmentLook = async (
  project: Project,
  environmentId: string,
  opts: { note?: string; modelOverride?: ImageModelOverride } = {},
) => {
  if (!environmentId) throw new Error('environmentId is required');
  const environment = await requireEnvironment(project.id, environmentId);
  const styleImagePath = await projectStyleImagePath(project.id);
  const imageModel = projectImageModel(project, opts.modelOverride);
  const modelName = getImageGenerationModelName(imageModel);

  let genPrompt = environment.generation_prompt as string | null;
  if (!genPrompt || environment.prompts_stale) {
    genPrompt = buildEnvironmentPrompt(
      { name: environment.name, description: environment.description || '' },
      { styleIdx: styleImagePath ? 1 : undefined },
    );
    if (environment.prompts_stale) await updateRows('environments', { id: environment.id }, { prompts_stale: false });
  }

  const recipe = await getProjectPromptOverride(project.id, 'environment_looks');
  const withRecipe = (value: string) => recipe && !value.includes('Project environment-look recipe:')
    ? `${value}\n\nProject environment-look recipe:\n${recipe}`
    : value;

  const note = opts.note?.trim();
  if (note) {
    try {
      const rewritten = await refineFramePrompt({
        currentPrompt: withRecipe(genPrompt),
        feedback: `[ENVIRONMENT LOOK for ${environment.name}] ${note}`,
        textProvider: project.textProvider,
      });
      genPrompt = rewritten.visualPrompt;
    } catch {
      genPrompt += `\n\nDirector note: ${note}`;
    }
  }

  await updateRows('environments', { id: environment.id }, { generation_prompt: genPrompt, prompts_stale: false });
  const renderPrompt = withRecipe(genPrompt);
  const imageService = getImageService(imageModel);
  const started = Date.now();
  const imagePaths = await imageService.generateEnvironmentLooks(
    { name: environment.name, description: environment.description || '' },
    styleImagePath,
    project.aspectRatio || '16:9',
    undefined,
    undefined,
    renderPrompt,
    modelName,
  );
  assertGeneratedLooks(imagePaths, `Environment look generation for ${environment.name}`);

  const looks: { id: string; url: string }[] = [];
  for (let i = 0; i < imagePaths.length; i += 1) {
    const assetId = uuidv4();
    await insertRow('assets', {
      id: assetId,
      project_id: project.id,
      category: 'environment_candidate',
      file_path: imagePaths[i],
      prompt: `Environment look ${i + 1} for ${environment.name}`,
      metadata: JSON.stringify({ environmentId: environment.id }),
    });
    looks.push({ id: assetId, url: storageUrl(imagePaths[i]) });
  }

  await logCall({
    projectId: project.id,
    stage: 'generate-environment-look',
    model: modelName,
    prompt: `Generate environment looks for "${environment.name}" | Prompt: ${compactText(renderPrompt, 1500)}`,
    referenceInputs: styleImagePath ? [{ type: 'image', label: 'Style reference', url: storageUrl(styleImagePath) }] : [],
    contextChain: await buildContextChain(project.id),
    responseSummary: `Generated ${looks.length} looks for ${environment.name}`,
    outputAssetIds: looks.map((look) => look.id),
    durationMs: Date.now() - started,
    costEstimate: 0.04,
  });
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'environment_looks_generated',
    entityType: 'environment',
    entityId: environment.id,
    summary: `Codex generated ${looks.length} looks for environment "${environment.name}".`,
    payload: { environmentId: environment.id, assetIds: looks.map((look) => look.id), note: note || null, model: modelName },
  });

  return {
    kind: 'lahari.generate.environment_look',
    projectId: project.id,
    environment: { id: environment.id, name: environment.name },
    looks,
    generationPrompt: genPrompt,
    model: modelName,
    project: await getFullProject(project.id),
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
  };
};

export const lockEnvironmentLook = async (project: Project, environmentId: string, assetId: string) => {
  if (!environmentId || !assetId) throw new Error('environmentId and assetId are required');
  await requireEnvironment(project.id, environmentId);
  await requireAsset(project.id, assetId);
  await updateRows('environments', { id: environmentId }, { reference_asset_id: assetId });
  await markDependentShotsStale(project.id, 'env', environmentId);
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'environment_locked',
    entityType: 'environment',
    entityId: environmentId,
    summary: 'Codex locked an environment reference; dependent shots were marked stale.',
    payload: { environmentId, assetId },
  });
  return { kind: 'lahari.lock.environment_look', projectId: project.id, environmentId, assetId, project: await getFullProject(project.id) };
};

export const unlockEnvironmentLook = async (project: Project, environmentId: string) => {
  if (!environmentId) throw new Error('environmentId is required');
  await requireEnvironment(project.id, environmentId);
  await updateRows('environments', { id: environmentId }, { reference_asset_id: null });
  await markDependentShotsStale(project.id, 'env', environmentId);
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'environment_unlocked',
    entityType: 'environment',
    entityId: environmentId,
    summary: 'Codex unlocked an environment reference; dependent shots were marked stale.',
    payload: { environmentId },
  });
  return { kind: 'lahari.unlock.environment_look', projectId: project.id, environmentId, project: await getFullProject(project.id) };
};
