import { selectAll, selectOne, updateRows } from '../../../database.js';
import { storageUrl } from '../../../storage.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import { webStudioUrl, type Project } from '../core.js';
import { buildNotebookMirrorArtifacts } from '../notebook.js';
import { appendApplyJournal, applyError } from './helpers.js';

type ReferenceSource = {
  assetId?: string;
  useProjectStyleAsset?: boolean;
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
