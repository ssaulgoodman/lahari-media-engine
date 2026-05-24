import { v4 as uuidv4 } from 'uuid';
import { insertRow, selectAll, selectOne, updateRows } from '../../../database.js';
import { saveBase64, storageUrl } from '../../../storage.js';
import { buildContextChain, logCall } from '../../../xray.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import { webStudioUrl, type Project } from '../core.js';
import { buildNotebookMirrorArtifacts } from '../notebook.js';
import { appendApplyJournal, applyError } from './helpers.js';

type ReferenceSource = {
  assetId?: string;
  useProjectStyleAsset?: boolean;
};

type UploadReferenceInput = {
  filename?: string;
  mimeType?: string;
  base64: string;
  note?: string;
};

const imageExtFromMime = (mimeType?: string, filename?: string) => {
  const lowerMime = String(mimeType || '').toLowerCase();
  const lowerName = String(filename || '').toLowerCase();
  if (lowerMime.includes('webp') || lowerName.endsWith('.webp')) return 'webp';
  if (lowerMime.includes('jpeg') || lowerMime.includes('jpg') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'jpg';
  return 'png';
};

const stripDataUrl = (input: string) => input.replace(/^data:[^;]+;base64,/i, '').trim();

const candidateMetadata = (asset: any) => {
  try {
    return JSON.parse(asset.metadata || '{}');
  } catch {
    return {};
  }
};

const createdTime = (asset: any) => {
  const raw = asset.created_at || asset.createdAt || asset.updated_at || asset.updatedAt || '';
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
};

export const listReferenceCandidates = async (
  project: Project,
  input: { entityType: 'character' | 'environment'; entityId: string },
) => {
  const isCharacter = input.entityType === 'character';
  const entity = isCharacter
    ? project.cast.find((item) => item.id === input.entityId)
    : project.environments.find((item) => item.id === input.entityId);
  if (!entity) {
    return applyError('validation_failed', `${isCharacter ? 'Cast member' : 'Environment'} was not found in this project.`, { field: 'entityId' });
  }

  const category = isCharacter ? 'character_candidate' : 'environment_candidate';
  const metaKey = isCharacter ? 'castMemberId' : 'environmentId';
  const assets = await selectAll('assets', { project_id: project.id, category });
  const candidates = assets
    .filter((asset: any) => candidateMetadata(asset)[metaKey] === input.entityId)
    .sort((a: any, b: any) => createdTime(b) - createdTime(a))
    .map((asset: any) => {
      const metadata = candidateMetadata(asset);
      return {
        id: asset.id,
        assetId: asset.id,
        url: storageUrl(asset.file_path),
        createdAt: asset.created_at || asset.createdAt || null,
        prompt: asset.prompt || null,
        model: metadata.model || null,
        imageModel: metadata.imageModel || null,
        provider: metadata.provider || metadata.imageModel || null,
        promptSource: metadata.promptSource || null,
        generatedBy: metadata.generatedBy || null,
        hasPromptOverride: !!metadata.hasPromptOverride,
        metadata,
      };
    });

  return {
    kind: 'mirage.reference.candidates',
    projectId: project.id,
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: entity.name,
    candidates,
    count: candidates.length,
    note: candidates.length
      ? `Lock one with ${isCharacter ? 'apply_cast_reference' : 'apply_environment_reference'} using assetId.`
      : 'No generated candidates found for this entity yet.',
  };
};

const resolveReferenceAsset = async (project: Project, source: ReferenceSource) => {
  const assetId = source.useProjectStyleAsset ? project.styleAssetId : source.assetId;
  if (!assetId) {
    return applyError('validation_failed', 'assetId is required unless useProjectStyleAsset is true.', { field: 'assetId' });
  }

  const asset = await selectOne('assets', { id: assetId });
  if (!asset || asset.project_id !== project.id) {
    return applyError('validation_failed', 'Reference asset was not found in this project.', { field: 'assetId' });
  }

  return asset;
};

const markDependentShotsStale = async (projectId: string, type: 'cast' | 'env', entityId: string) => {
  const scenes = await selectAll('scenes', { project_id: projectId });
  let count = 0;

  for (const scene of scenes) {
    const shots = await selectAll('shots', { scene_id: scene.id });
    for (const shot of shots) {
      const depends = type === 'cast'
        ? (() => {
          try {
            return JSON.parse(shot.cast_ids || '[]').includes(entityId);
          } catch {
            return false;
          }
        })()
        : shot.environment_id === entityId;

      if (!depends) continue;
      await updateRows('shots', { id: shot.id }, { prompts_stale: true });
      count += 1;
    }
  }

  return count;
};

export const applyCastReference = async (
  project: Project,
  input: { castMemberId: string } & ReferenceSource,
) => {
  const member = project.cast.find((item) => item.id === input.castMemberId);
  if (!member) {
    return applyError('validation_failed', 'Cast member was not found in this project.', { field: 'castMemberId' });
  }

  const asset = await resolveReferenceAsset(project, input);
  if ('error' in asset) return asset;

  await updateRows('cast_members', { id: member.id }, { reference_asset_id: asset.id });
  const staleShotCount = await markDependentShotsStale(project.id, 'cast', member.id);

  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'character_locked',
    entityType: 'cast_member',
    entityId: member.id,
    summary: `Codex set "${member.name}" reference from an existing project asset; dependent shots were marked stale.`,
    payload: {
      castMemberId: member.id,
      assetId: asset.id,
      usedProjectStyleAsset: !!input.useProjectStyleAsset,
      staleShotCount,
    },
  });

  const nextProject = {
    ...project,
    cast: project.cast.map((item) => item.id === member.id
      ? { ...item, referenceAssetId: asset.id, referenceImageUrl: storageUrl(asset.file_path) }
      : item),
    scenes: project.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => (shot.castIds || []).includes(member.id)
        ? { ...shot, promptsStale: true }
        : shot),
    })),
  };

  appendApplyJournal(project, 'applied cast reference', `Character: ${member.name}\nAsset: ${asset.id}\nMarked stale shots: ${staleShotCount}\nWeb: ${webStudioUrl(project.id, { step: 'blueprint' })}`);

  return {
    kind: 'mirage.apply.cast_reference',
    projectId: project.id,
    castMemberId: member.id,
    castMemberName: member.name,
    assetId: asset.id,
    assetUrl: storageUrl(asset.file_path),
    usedProjectStyleAsset: !!input.useProjectStyleAsset,
    staleShotCount,
    changedArtifacts: buildNotebookMirrorArtifacts(nextProject, { cast: true, shotPrompts: staleShotCount > 0 }),
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    note: 'Applied character reference from an existing project asset.',
  };
};

export const uploadCastReference = async (
  project: Project,
  input: { castMemberId: string } & UploadReferenceInput,
) => {
  const member = project.cast.find((item) => item.id === input.castMemberId);
  if (!member) {
    return applyError('validation_failed', 'Cast member was not found in this project.', { field: 'castMemberId' });
  }
  if (!input.base64?.trim()) {
    return applyError('validation_failed', 'base64 image data is required.', { field: 'base64' });
  }

  const ext = imageExtFromMime(input.mimeType, input.filename);
  const filePath = await saveBase64(stripDataUrl(input.base64), 'images', ext);
  const assetId = uuidv4();
  await insertRow('assets', {
    id: assetId,
    project_id: project.id,
    category: 'character',
    file_path: filePath,
    prompt: input.note || `Uploaded locked reference for ${member.name}`,
    metadata: JSON.stringify({
      castMemberId: member.id,
      filename: input.filename || null,
      mimeType: input.mimeType || null,
      source: 'mcp_upload',
      lockedReference: true,
    }),
  });

  await updateRows('cast_members', { id: member.id }, { reference_asset_id: assetId });
  const staleShotCount = await markDependentShotsStale(project.id, 'cast', member.id);

  await logCall({
    projectId: project.id,
    stage: 'upload-cast-reference',
    model: 'upload',
    prompt: input.note || `MCP uploaded locked character reference for "${member.name}"`,
    referenceInputs: [{ type: 'image', label: `${member.name} uploaded reference`, url: storageUrl(filePath) }],
    contextChain: await buildContextChain(project.id),
    responseSummary: `Locked uploaded image as ${member.name}'s reference`,
    outputAssetIds: [assetId],
    durationMs: 0,
    costEstimate: 0,
  });
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'character_reference_uploaded',
    entityType: 'cast_member',
    entityId: member.id,
    summary: `Codex uploaded and locked a reference for character "${member.name}".`,
    payload: { castMemberId: member.id, assetId, assetUrl: storageUrl(filePath), staleShotCount, note: input.note || null },
  });

  const nextProject = {
    ...project,
    cast: project.cast.map((item) => item.id === member.id
      ? { ...item, referenceAssetId: assetId, referenceImageUrl: storageUrl(filePath) }
      : item),
    scenes: project.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => (shot.castIds || []).includes(member.id)
        ? { ...shot, promptsStale: true }
        : shot),
    })),
  };

  appendApplyJournal(project, 'uploaded cast reference', `Character: ${member.name}\nAsset: ${assetId}\nMarked stale shots: ${staleShotCount}\nWeb: ${webStudioUrl(project.id, { step: 'blueprint' })}`);

  return {
    kind: 'mirage.upload.cast_reference',
    projectId: project.id,
    castMemberId: member.id,
    castMemberName: member.name,
    assetId,
    assetUrl: storageUrl(filePath),
    staleShotCount,
    changedArtifacts: buildNotebookMirrorArtifacts(nextProject, { cast: true, shotPrompts: staleShotCount > 0 }),
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    note: 'Uploaded and locked character reference.',
  };
};

export const applyEnvironmentReference = async (
  project: Project,
  input: { environmentId: string } & ReferenceSource,
) => {
  const environment = project.environments.find((item) => item.id === input.environmentId);
  if (!environment) {
    return applyError('validation_failed', 'Environment was not found in this project.', { field: 'environmentId' });
  }

  const asset = await resolveReferenceAsset(project, input);
  if ('error' in asset) return asset;

  await updateRows('environments', { id: environment.id }, { reference_asset_id: asset.id });
  const staleShotCount = await markDependentShotsStale(project.id, 'env', environment.id);

  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'environment_locked',
    entityType: 'environment',
    entityId: environment.id,
    summary: `Codex set "${environment.name}" reference from an existing project asset; dependent shots were marked stale.`,
    payload: {
      environmentId: environment.id,
      assetId: asset.id,
      usedProjectStyleAsset: !!input.useProjectStyleAsset,
      staleShotCount,
    },
  });

  const nextProject = {
    ...project,
    environments: project.environments.map((item) => item.id === environment.id
      ? { ...item, referenceAssetId: asset.id, referenceImageUrl: storageUrl(asset.file_path) }
      : item),
    scenes: project.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => shot.environmentId === environment.id
        ? { ...shot, promptsStale: true }
        : shot),
    })),
  };

  appendApplyJournal(project, 'applied environment reference', `Environment: ${environment.name}\nAsset: ${asset.id}\nMarked stale shots: ${staleShotCount}\nWeb: ${webStudioUrl(project.id, { step: 'blueprint' })}`);

  return {
    kind: 'mirage.apply.environment_reference',
    projectId: project.id,
    environmentId: environment.id,
    environmentName: environment.name,
    assetId: asset.id,
    assetUrl: storageUrl(asset.file_path),
    usedProjectStyleAsset: !!input.useProjectStyleAsset,
    staleShotCount,
    changedArtifacts: buildNotebookMirrorArtifacts(nextProject, { environments: true, shotPrompts: staleShotCount > 0 }),
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    note: 'Applied environment reference from an existing project asset.',
  };
};

export const uploadEnvironmentReference = async (
  project: Project,
  input: { environmentId: string } & UploadReferenceInput,
) => {
  const environment = project.environments.find((item) => item.id === input.environmentId);
  if (!environment) {
    return applyError('validation_failed', 'Environment was not found in this project.', { field: 'environmentId' });
  }
  if (!input.base64?.trim()) {
    return applyError('validation_failed', 'base64 image data is required.', { field: 'base64' });
  }

  const ext = imageExtFromMime(input.mimeType, input.filename);
  const filePath = await saveBase64(stripDataUrl(input.base64), 'images', ext);
  const assetId = uuidv4();
  await insertRow('assets', {
    id: assetId,
    project_id: project.id,
    category: 'environment',
    file_path: filePath,
    prompt: input.note || `Uploaded locked reference for ${environment.name}`,
    metadata: JSON.stringify({
      environmentId: environment.id,
      filename: input.filename || null,
      mimeType: input.mimeType || null,
      source: 'mcp_upload',
      lockedReference: true,
    }),
  });

  await updateRows('environments', { id: environment.id }, { reference_asset_id: assetId });
  const staleShotCount = await markDependentShotsStale(project.id, 'env', environment.id);

  await logCall({
    projectId: project.id,
    stage: 'upload-environment-reference',
    model: 'upload',
    prompt: input.note || `MCP uploaded locked environment reference for "${environment.name}"`,
    referenceInputs: [{ type: 'image', label: `${environment.name} uploaded reference`, url: storageUrl(filePath) }],
    contextChain: await buildContextChain(project.id),
    responseSummary: `Locked uploaded image as ${environment.name}'s reference`,
    outputAssetIds: [assetId],
    durationMs: 0,
    costEstimate: 0,
  });
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'environment_reference_uploaded',
    entityType: 'environment',
    entityId: environment.id,
    summary: `Codex uploaded and locked a reference for environment "${environment.name}".`,
    payload: { environmentId: environment.id, assetId, assetUrl: storageUrl(filePath), staleShotCount, note: input.note || null },
  });

  const nextProject = {
    ...project,
    environments: project.environments.map((item) => item.id === environment.id
      ? { ...item, referenceAssetId: assetId, referenceImageUrl: storageUrl(filePath) }
      : item),
    scenes: project.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => shot.environmentId === environment.id
        ? { ...shot, promptsStale: true }
        : shot),
    })),
  };

  appendApplyJournal(project, 'uploaded environment reference', `Environment: ${environment.name}\nAsset: ${assetId}\nMarked stale shots: ${staleShotCount}\nWeb: ${webStudioUrl(project.id, { step: 'blueprint' })}`);

  return {
    kind: 'mirage.upload.environment_reference',
    projectId: project.id,
    environmentId: environment.id,
    environmentName: environment.name,
    assetId,
    assetUrl: storageUrl(filePath),
    staleShotCount,
    changedArtifacts: buildNotebookMirrorArtifacts(nextProject, { environments: true, shotPrompts: staleShotCount > 0 }),
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    note: 'Uploaded and locked environment reference.',
  };
};
