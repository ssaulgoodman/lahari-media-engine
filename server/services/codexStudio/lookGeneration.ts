import { v4 as uuidv4 } from 'uuid';
import { insertRow, selectOne, updateRows } from '../../database.js';
import { storageUrl, readAsBase64, mimeFromExt } from '../../storage.js';
import { buildContextChain, logCall } from '../../xray.js';
import { getPipelinePreset } from '../../presets.js';
import { buildCharacterPrompt, buildEnvironmentPrompt } from '../imagen.js';
import { refineFramePrompt } from '../claude.js';
import { getImageGenerationModelName, getImageService } from '../image-provider.js';
import { recordDirectorEvent } from '../directorEvents.js';
import { getProjectPreferencesState, getProjectPromptOverride } from '../projectConfig.js';
import { isLegacyLookPrompt } from '../../prompts/lookPrompts.js';
import {
  contextTracePreview,
  emptyContextTrace,
  shouldIncludeGuideAsset,
  shouldIncludeProjectStyleDescription,
  shouldIncludeStyleImage,
  type ContextOverrides,
} from '../contextOverrides.js';
import { compactText, webStudioUrl, type Project } from './core.js';
import { buildNotebookMirrorArtifacts } from './notebook.js';

type GenerateLooksOptions = {
  note?: string;
  promptOverride?: string;
  guideAssetId?: string;
  contextOverrides?: ContextOverrides;
};

const styleImagePathForProject = async (project: Project, overrides?: ContextOverrides): Promise<{ path?: string; trace: ReturnType<typeof emptyContextTrace> }> => {
  const trace = emptyContextTrace(overrides);
  if (!shouldIncludeStyleImage(overrides)) {
    trace.excluded.push('style:image');
    return { trace };
  }

  const styleAssetId = overrides?.styleAssetId !== undefined ? overrides.styleAssetId : project.styleAssetId;
  if (!styleAssetId) return { trace };

  const asset = await selectOne('assets', { id: styleAssetId });
  if (!asset || asset.project_id !== project.id) throw new Error('contextOverrides.styleAssetId was not found in this project.');
  if (styleAssetId !== project.styleAssetId) trace.replaced.push('style:image');
  trace.included.push('style:image');
  return { path: asset.file_path, trace };
};

const guideImagePathForProject = async (project: Project, guideAssetId?: string): Promise<string | undefined> => {
  if (!guideAssetId) return undefined;
  const asset = await selectOne('assets', { id: guideAssetId });
  if (!asset || asset.project_id !== project.id) throw new Error('guideAssetId was not found in this project.');
  return asset.file_path;
};

const withRecipe = (prompt: string, label: string, recipe?: string | null) => {
  if (!recipe || prompt.includes(label)) return prompt;
  return `${prompt}\n\n${label}\n${recipe}`;
};

const shouldUseSavedPrompt = (prompt?: string | null, stale?: boolean) => Boolean(prompt && !stale && !isLegacyLookPrompt(prompt));

const candidateMetadata = (base: Record<string, unknown>, opts: {
  model: string;
  imageModel: string;
  promptSource: string;
  generatedBy: string;
  promptOverride?: string;
  note?: string;
  guideAssetId?: string;
  contextOverrides?: unknown;
}) => JSON.stringify({
  ...base,
  model: opts.model,
  imageModel: opts.imageModel,
  provider: opts.imageModel,
  promptSource: opts.promptSource,
  generatedBy: opts.generatedBy,
  hasPromptOverride: !!opts.promptOverride,
  note: opts.note || null,
  guideAssetId: opts.guideAssetId || null,
  contextOverrides: opts.contextOverrides || null,
});

export const generateCharacterLooksForDirector = async (
  project: Project,
  castMemberIds: string[],
  opts: GenerateLooksOptions = {},
) => {
  const ids = castMemberIds.length
    ? castMemberIds
    : project.cast.filter((member) => !member.referenceAssetId && !member.referenceImageUrl).map((member) => member.id);
  if (!ids.length) {
    return {
      kind: 'mirage.generate.character_looks',
      projectId: project.id,
      results: [],
      note: 'No target cast members. Pass castMemberIds or add cast without references.',
    };
  }
  if (opts.promptOverride && ids.length !== 1) {
    throw new Error('promptOverride can only target one cast member. Pass exactly one castMemberId.');
  }

  const { path: styleImagePath, trace: contextTrace } = await styleImagePathForProject(project, opts.contextOverrides);
  const guideImagePath = shouldIncludeGuideAsset(opts.contextOverrides)
    ? await guideImagePathForProject(project, opts.guideAssetId)
    : undefined;
  if (opts.guideAssetId && guideImagePath) contextTrace.included.push('guide:image');
  if (opts.guideAssetId && !guideImagePath) contextTrace.excluded.push('guide:image');
  const preset = getPipelinePreset(project.presetKey);
  const projectPreferences = await getProjectPreferencesState(project as any);
  const imageModel = projectPreferences.preferences.imageModel;
  const characterLooksRecipe = await getProjectPromptOverride(project.id, 'character_looks');
  const imageService = getImageService(imageModel);
  const model = getImageGenerationModelName(imageModel);
  const results: any[] = [];

  for (const castMemberId of ids) {
    const member = project.cast.find((item) => item.id === castMemberId);
    if (!member) throw new Error(`Cast member not found in project: ${castMemberId}`);

    let genPrompt = opts.promptOverride?.trim() || member.generationPrompt || null;
    const promptSource = opts.promptOverride?.trim() ? 'override' : opts.note ? 'note' : shouldUseSavedPrompt(member.generationPrompt, member.promptsStale) ? 'saved' : 'rebuilt';
    const shouldRebuildPrompt = !opts.promptOverride && (!genPrompt || member.promptsStale || isLegacyLookPrompt(genPrompt));
    if (shouldRebuildPrompt) {
      genPrompt = buildCharacterPrompt(
        { name: member.name, description: member.description || '' },
        {
          styleIdx: styleImagePath ? 1 : undefined,
          preset,
          styleDescription: shouldIncludeProjectStyleDescription(opts.contextOverrides) ? project.styleDescription : undefined,
        },
      );
    }

    if (opts.note && !opts.promptOverride) {
      try {
        let refBase64 = '';
        let refMime = 'image/png';
        if (member.referenceAssetId) {
          const refAsset = await selectOne('assets', { id: member.referenceAssetId });
          if (refAsset?.project_id === project.id) {
            refBase64 = await readAsBase64(refAsset.file_path);
            refMime = mimeFromExt(refAsset.file_path);
          }
        }
        const rewritten = await refineFramePrompt({
          currentPrompt: withRecipe(genPrompt, 'Project character-look recipe:', characterLooksRecipe),
          feedback: `[CHARACTER LOOK for ${member.name}] ${opts.note}`,
          failedImageBase64: refBase64,
          failedImageMime: refMime,
          textProvider: project.textProvider,
        });
        genPrompt = rewritten.visualPrompt;
      } catch (err: any) {
        console.warn(`[${project.id}] MCP character look prompt rewrite failed for ${member.name}: ${err?.message || err}`);
        genPrompt += `\n\nDirector note: ${opts.note}`;
      }
    }

    await updateRows('cast_members', { id: member.id }, { generation_prompt: genPrompt, prompts_stale: false });

    const renderPrompt = opts.promptOverride ? genPrompt : withRecipe(genPrompt, 'Project character-look recipe:', characterLooksRecipe);
    const t0 = Date.now();
    const imagePaths = await imageService.generateCharacterLooks(
      { name: member.name, description: member.description || '' },
      styleImagePath,
      undefined,
      project.aspectRatio || '16:9',
      guideImagePath,
      renderPrompt,
      model,
      preset,
    );
    const durationMs = Date.now() - t0;

    const looks: { id: string; url: string }[] = [];
    for (let i = 0; i < imagePaths.length; i += 1) {
      const assetId = uuidv4();
      await insertRow('assets', {
        id: assetId,
        project_id: project.id,
        category: 'character_candidate',
        file_path: imagePaths[i],
        prompt: `Look ${i + 1} for ${member.name}`,
        metadata: candidateMetadata({ castMemberId: member.id }, {
          model,
          imageModel,
          promptSource,
          generatedBy: 'mcp',
          promptOverride: opts.promptOverride,
          note: opts.note,
          guideAssetId: opts.guideAssetId,
          contextOverrides: contextTrace,
        }),
      });
      looks.push({ id: assetId, url: storageUrl(imagePaths[i]) });
    }

    await logCall({
      projectId: project.id,
      stage: 'generate-looks',
      model,
      prompt: `MCP generate ${looks.length} character looks for "${member.name}" | ${compactText(renderPrompt, 500)}`,
      referenceInputs: [
        ...(styleImagePath ? [{ type: 'image' as const, label: 'Style reference', url: storageUrl(styleImagePath) }] : []),
        ...(guideImagePath ? [{ type: 'image' as const, label: `${member.name} guide`, url: storageUrl(guideImagePath) }] : []),
        ...(contextTrace.requested ? [{ type: 'text' as const, label: 'Context overrides', preview: contextTracePreview(contextTrace) }] : []),
      ],
      contextChain: await buildContextChain(project.id),
      responseSummary: `Generated ${looks.length} looks for ${member.name} via MCP`,
      outputAssetIds: looks.map((look) => look.id),
      durationMs,
      costEstimate: 0.04,
    });
    await recordDirectorEvent({
      projectId: project.id,
      source: 'codex',
      eventType: 'character_looks_generated',
      entityType: 'cast_member',
      entityId: member.id,
      summary: `Codex generated ${looks.length} looks for character "${member.name}".`,
      payload: { castMemberId: member.id, assetIds: looks.map((look) => look.id), note: opts.note || null, promptSource, guideAssetId: opts.guideAssetId || null, contextOverrides: contextTrace },
    });

    results.push({ castMemberId: member.id, castMemberName: member.name, prompt: genPrompt, promptSource, looks });
  }

  return {
    kind: 'mirage.generate.character_looks',
    projectId: project.id,
    model,
    results,
    changedArtifacts: buildNotebookMirrorArtifacts(project, { cast: true }),
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    note: 'Generated candidate character looks. Lock one with apply_cast_reference using the returned asset id.',
  };
};

export const generateEnvironmentLooksForDirector = async (
  project: Project,
  environmentIds: string[],
  opts: GenerateLooksOptions = {},
) => {
  const ids = environmentIds.length
    ? environmentIds
    : project.environments.filter((environment) => !environment.referenceAssetId && !environment.referenceImageUrl).map((environment) => environment.id);
  if (!ids.length) {
    return {
      kind: 'mirage.generate.environment_looks',
      projectId: project.id,
      results: [],
      note: 'No target environments. Pass environmentIds or add environments without references.',
    };
  }
  if (opts.promptOverride && ids.length !== 1) {
    throw new Error('promptOverride can only target one environment. Pass exactly one environmentId.');
  }

  const { path: styleImagePath, trace: contextTrace } = await styleImagePathForProject(project, opts.contextOverrides);
  const guideImagePath = shouldIncludeGuideAsset(opts.contextOverrides)
    ? await guideImagePathForProject(project, opts.guideAssetId)
    : undefined;
  if (opts.guideAssetId && guideImagePath) contextTrace.included.push('guide:image');
  if (opts.guideAssetId && !guideImagePath) contextTrace.excluded.push('guide:image');
  const preset = getPipelinePreset(project.presetKey);
  const projectPreferences = await getProjectPreferencesState(project as any);
  const imageModel = projectPreferences.preferences.imageModel;
  const environmentLooksRecipe = await getProjectPromptOverride(project.id, 'environment_looks');
  const imageService = getImageService(imageModel);
  const model = getImageGenerationModelName(imageModel);
  const results: any[] = [];

  for (const environmentId of ids) {
    const environment = project.environments.find((item) => item.id === environmentId);
    if (!environment) throw new Error(`Environment not found in project: ${environmentId}`);

    let genPrompt = opts.promptOverride?.trim() || environment.generationPrompt || null;
    const promptSource = opts.promptOverride?.trim() ? 'override' : opts.note ? 'note' : shouldUseSavedPrompt(environment.generationPrompt, environment.promptsStale) ? 'saved' : 'rebuilt';
    const shouldRebuildPrompt = !opts.promptOverride && (!genPrompt || environment.promptsStale || isLegacyLookPrompt(genPrompt));
    if (shouldRebuildPrompt) {
      genPrompt = buildEnvironmentPrompt(
        { name: environment.name, description: environment.description || '' },
        {
          styleIdx: styleImagePath ? 1 : undefined,
          preset,
          styleDescription: shouldIncludeProjectStyleDescription(opts.contextOverrides) ? project.styleDescription : undefined,
        },
      );
    }

    if (opts.note && !opts.promptOverride) {
      try {
        let refBase64 = '';
        let refMime = 'image/png';
        if (environment.referenceAssetId) {
          const refAsset = await selectOne('assets', { id: environment.referenceAssetId });
          if (refAsset?.project_id === project.id) {
            refBase64 = await readAsBase64(refAsset.file_path);
            refMime = mimeFromExt(refAsset.file_path);
          }
        }
        const rewritten = await refineFramePrompt({
          currentPrompt: withRecipe(genPrompt, 'Project environment-look recipe:', environmentLooksRecipe),
          feedback: `[ENVIRONMENT LOOK for ${environment.name}] ${opts.note}`,
          failedImageBase64: refBase64,
          failedImageMime: refMime,
          textProvider: project.textProvider,
        });
        genPrompt = rewritten.visualPrompt;
      } catch (err: any) {
        console.warn(`[${project.id}] MCP environment look prompt rewrite failed for ${environment.name}: ${err?.message || err}`);
        genPrompt += `\n\nDirector note: ${opts.note}`;
      }
    }

    await updateRows('environments', { id: environment.id }, { generation_prompt: genPrompt, prompts_stale: false });

    const renderPrompt = opts.promptOverride ? genPrompt : withRecipe(genPrompt, 'Project environment-look recipe:', environmentLooksRecipe);
    const t0 = Date.now();
    const imagePaths = await imageService.generateEnvironmentLooks(
      { name: environment.name, description: environment.description || '' },
      styleImagePath,
      project.aspectRatio || '16:9',
      guideImagePath,
      undefined,
      renderPrompt,
      model,
      preset,
    );
    const durationMs = Date.now() - t0;

    const looks: { id: string; url: string }[] = [];
    for (let i = 0; i < imagePaths.length; i += 1) {
      const assetId = uuidv4();
      await insertRow('assets', {
        id: assetId,
        project_id: project.id,
        category: 'environment_candidate',
        file_path: imagePaths[i],
        prompt: `Environment look ${i + 1} for ${environment.name}`,
        metadata: candidateMetadata({ environmentId: environment.id }, {
          model,
          imageModel,
          promptSource,
          generatedBy: 'mcp',
          promptOverride: opts.promptOverride,
          note: opts.note,
          guideAssetId: opts.guideAssetId,
          contextOverrides: contextTrace,
        }),
      });
      looks.push({ id: assetId, url: storageUrl(imagePaths[i]) });
    }

    await logCall({
      projectId: project.id,
      stage: 'generate-environment-look',
      model,
      prompt: `MCP generate ${looks.length} environment looks for "${environment.name}" | ${compactText(renderPrompt, 500)}`,
      referenceInputs: [
        ...(styleImagePath ? [{ type: 'image' as const, label: 'Style reference', url: storageUrl(styleImagePath) }] : []),
        ...(guideImagePath ? [{ type: 'image' as const, label: `${environment.name} guide`, url: storageUrl(guideImagePath) }] : []),
        ...(contextTrace.requested ? [{ type: 'text' as const, label: 'Context overrides', preview: contextTracePreview(contextTrace) }] : []),
      ],
      contextChain: await buildContextChain(project.id),
      responseSummary: `Generated ${looks.length} environment looks for ${environment.name} via MCP`,
      outputAssetIds: looks.map((look) => look.id),
      durationMs,
      costEstimate: 0.04,
    });
    await recordDirectorEvent({
      projectId: project.id,
      source: 'codex',
      eventType: 'environment_looks_generated',
      entityType: 'environment',
      entityId: environment.id,
      summary: `Codex generated ${looks.length} looks for environment "${environment.name}".`,
      payload: { environmentId: environment.id, assetIds: looks.map((look) => look.id), note: opts.note || null, promptSource, guideAssetId: opts.guideAssetId || null, contextOverrides: contextTrace },
    });

    results.push({ environmentId: environment.id, environmentName: environment.name, prompt: genPrompt, promptSource, looks });
  }

  return {
    kind: 'mirage.generate.environment_looks',
    projectId: project.id,
    model,
    results,
    changedArtifacts: buildNotebookMirrorArtifacts(project, { environments: true }),
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    note: 'Generated candidate environment looks. Lock one with apply_environment_reference using the returned asset id.',
  };
};
