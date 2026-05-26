import { v4 as uuidv4 } from 'uuid';
import { insertRow, selectAll, selectOne, updateRows } from '../../../database.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import { readAsBase64, storageUrl, mimeFromExt } from '../../../storage.js';
import { analyzeImageStyle } from '../../claude.js';
import { getImageGenerationModelName, getImageService, getStyleOptionsModelName } from '../../image-provider.js';
import { getProjectRuntimePreset, presetSubject } from '../../../presets.js';
import { buildContextChain, logCall } from '../../../xray.js';
import {
  contextTracePreview,
  emptyContextTrace,
  shouldIncludeConcept,
  shouldIncludeGuideAsset,
  shouldIncludeProjectStyleDescription,
  type ContextOverrides,
} from '../../contextOverrides.js';
import { styleDirectionHash, webStudioUrl, type Project } from '../core.js';
import { buildNotebookMirrorArtifacts } from '../notebook.js';
import { appendApplyJournal, applyError, ensureLength, validateBaseHash } from './helpers.js';

export type StyleDirectionApplyInput = {
  styleDescription?: string;
  styleGenerationPrompt?: string;
  colorPalette?: string;
  sourceAssetId?: string;
};

const findProjectStyleAsset = async (project: Project, assetId?: string | null) => {
  if (!assetId) return null;
  const asset = await selectOne('assets', { id: assetId });
  if (!asset || asset.project_id !== project.id) return null;
  if (!String(asset.file_path || '').trim()) return null;
  return asset;
};

export const markStyleDependentsStale = async (projectId: string) => {
  await updateRows('cast_members', { project_id: projectId }, { prompts_stale: true });
  await updateRows('environments', { project_id: projectId }, { prompts_stale: true });
  const scenes = await selectAll('scenes', { project_id: projectId });
  for (const scene of scenes) {
    await updateRows('shots', { scene_id: scene.id }, { prompts_stale: true });
  }
};

export const applyStyleDirection = async (
  project: Project,
  input: StyleDirectionApplyInput,
  opts: { baseHash?: string; force?: boolean } = {},
) => {
  const hasTextUpdate = input?.styleDescription !== undefined
    || input?.styleGenerationPrompt !== undefined
    || input?.colorPalette !== undefined;
  if (!hasTextUpdate && !input?.sourceAssetId) {
    return applyError('validation_failed', 'Provide styleDescription and/or sourceAssetId.', { field: 'style' });
  }

  const validation = ensureLength('styleDescription', input?.styleDescription, 3000, { required: input?.styleDescription !== undefined })
    || ensureLength('styleGenerationPrompt', input?.styleGenerationPrompt, 4000)
    || ensureLength('colorPalette', input?.colorPalette, 500)
    || validateBaseHash(styleDirectionHash(project), opts.baseHash, opts.force);
  if (validation) return validation;

  const sourceAsset = input.sourceAssetId
    ? await findProjectStyleAsset(project, input.sourceAssetId)
    : null;
  if (input.sourceAssetId && !sourceAsset) {
    return applyError('validation_failed', 'sourceAssetId must be an image asset in this project.', { field: 'sourceAssetId' });
  }

  const nextProject = {
    ...project,
    styleDescription: input.styleDescription !== undefined
      ? input.styleDescription.trim()
      : project.styleDescription || '',
    styleGenerationPrompt: input.styleGenerationPrompt !== undefined
      ? input.styleGenerationPrompt?.trim() || undefined
      : project.styleGenerationPrompt,
    colorPalette: input.colorPalette?.trim() || project.colorPalette,
    styleAssetId: sourceAsset?.id || project.styleAssetId,
    styleAssetUrl: sourceAsset ? storageUrl(sourceAsset.file_path) : project.styleAssetUrl,
  };
  await updateRows('projects', { id: project.id }, {
    style_description: nextProject.styleDescription,
    style_generation_prompt: nextProject.styleGenerationPrompt || null,
    ...(sourceAsset ? { status: 'style_locked', style_asset_id: sourceAsset.id } : {}),
    ...(input.colorPalette !== undefined ? { color_palette: input.colorPalette?.trim() || null } : {}),
    updated_at: new Date().toISOString(),
  });
  if (sourceAsset) await markStyleDependentsStale(project.id);

  const newHash = styleDirectionHash(nextProject);
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: sourceAsset ? 'style_locked' : 'style_direction_applied',
    entityType: sourceAsset ? 'asset' : 'project',
    entityId: sourceAsset?.id || project.id,
    summary: sourceAsset
      ? 'Codex locked a project style reference; downstream prompts were marked stale.'
      : 'Codex applied a project style direction.',
    payload: {
      newHash,
      assetId: sourceAsset?.id || null,
      descriptionChars: nextProject.styleDescription.length,
      generationPromptChars: nextProject.styleGenerationPrompt?.length || 0,
      colorPaletteChanged: input.colorPalette !== undefined,
    },
  });
  appendApplyJournal(project, 'applied style direction', `New hash: ${newHash}\nDescription chars: ${nextProject.styleDescription.length}\nGeneration prompt chars: ${nextProject.styleGenerationPrompt?.length || 0}\nWeb: ${webStudioUrl(project.id, { step: 'blueprint' })}`);

  return {
    kind: 'mirage.apply.style_direction',
    projectId: project.id,
    style: {
      styleDescription: nextProject.styleDescription,
      styleGenerationPrompt: nextProject.styleGenerationPrompt || null,
      colorPalette: nextProject.colorPalette || null,
      sourceAssetId: sourceAsset?.id || null,
      sourceAssetUrl: sourceAsset ? storageUrl(sourceAsset.file_path) : null,
    },
    newHash,
    changedArtifacts: buildNotebookMirrorArtifacts(nextProject, { style: true }),
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    note: sourceAsset
      ? 'Locked style reference and applied style text. Downstream references and prompts were marked stale.'
      : 'Applied style direction text. No style image was generated or locked.',
  };
};

export const identifyStyle = async (project: Project, input: { assetId?: string; apply?: boolean } = {}) => {
  const assetId = input.assetId || project.styleAssetId;
  const asset = await findProjectStyleAsset(project, assetId);
  if (!asset) return applyError('validation_failed', 'No style asset found to identify.', { field: 'assetId' });

  const t0 = Date.now();
  const base64 = await readAsBase64(asset.file_path);
  const mimeType = mimeFromExt(asset.file_path);
  const styleDescription = await analyzeImageStyle(base64, mimeType, project.textProvider);
  const durationMs = Date.now() - t0;

  await logCall({
    projectId: project.id,
    stage: 'identify-style',
    model: project.textProvider || 'claude-sonnet-4-6',
    prompt: 'Analyze locked style reference image for a concise style description.',
    referenceInputs: [{ type: 'image', label: 'Style reference', url: storageUrl(asset.file_path) }],
    contextChain: await buildContextChain(project.id),
    responseSummary: styleDescription.slice(0, 200),
    durationMs,
    costEstimate: 0.01,
  });
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'style_identified',
    entityType: 'asset',
    entityId: asset.id,
    summary: 'Codex identified the locked style reference.',
    payload: { assetId: asset.id, descriptionChars: styleDescription.length, applied: !!input.apply },
  });

  if (input.apply) {
    const applied = await applyStyleDirection(project, { styleDescription }, {});
    return {
      kind: 'mirage.style.identified',
      projectId: project.id,
      assetId: asset.id,
      styleDescription,
      applied,
      webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    };
  }

  return {
    kind: 'mirage.style.identified',
    projectId: project.id,
    assetId: asset.id,
    styleDescription,
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
    note: 'Suggested style description only. Apply with apply_style_direction after artist confirmation.',
  };
};

export const generateStyleCandidates = async (
  project: Project,
  input: { note?: string; promptOverride?: string; guideAssetId?: string; count?: number; contextOverrides?: ContextOverrides } = {},
) => {
  const contextTrace = emptyContextTrace(input.contextOverrides);
  const concept = shouldIncludeConcept(input.contextOverrides) ? project.lockedConcept || {} : {};
  if (input.contextOverrides?.includeConcept === false) contextTrace.excluded.push('concept');
  const preset = getProjectRuntimePreset({
    preset_key: project.presetKey,
    workflow_key: project.workflowKey,
  } as any);
  const subject = presetSubject(concept, project.title, preset);
  let styleNotes = input.promptOverride || input.note || (shouldIncludeProjectStyleDescription(input.contextOverrides) ? project.styleDescription : undefined) || undefined;
  if (input.contextOverrides?.includeProjectStyleDescription === false) contextTrace.excluded.push('style:description');
  let guideAsset: any = null;

  if (input.guideAssetId && shouldIncludeGuideAsset(input.contextOverrides)) {
    guideAsset = await findProjectStyleAsset(project, input.guideAssetId);
    if (!guideAsset) return applyError('validation_failed', 'guideAssetId must be an image asset in this project.', { field: 'guideAssetId' });
    contextTrace.included.push('guide:image');
    const guideDescription = await analyzeImageStyle(
      await readAsBase64(guideAsset.file_path),
      mimeFromExt(guideAsset.file_path),
      project.textProvider,
    );
    styleNotes = [input.note, guideDescription].filter(Boolean).join('\n\n');
  } else if (input.guideAssetId) {
    contextTrace.excluded.push('guide:image');
  }

  const t0 = Date.now();
  const imageService = getImageService(project.imageModel);
  const results = input.promptOverride
    ? [{
      style: input.promptOverride,
      assetPath: await imageService.generateSingleStyleImage(
        input.promptOverride,
        subject,
        input.promptOverride,
        preset,
        getImageGenerationModelName(project.imageModel),
      ),
    }]
    : await imageService.generateStyleOptions(
      subject,
      styleNotes,
      project.id,
      preset,
      getImageGenerationModelName(project.imageModel),
    );
  const durationMs = Date.now() - t0;

  const candidates = [];
  for (const result of results.slice(0, Math.max(1, Math.min(input.count || 4, 4)))) {
    const assetId = uuidv4();
    await insertRow('assets', {
      id: assetId,
      project_id: project.id,
      category: 'style',
      file_path: result.assetPath,
      prompt: result.style,
      metadata: JSON.stringify({
        generatedBy: 'generate_style_candidates',
        guideAssetId: guideAsset?.id || null,
        promptOverride: !!input.promptOverride,
        contextOverrides: contextTrace,
      }),
    });
    candidates.push({
      assetId,
      url: storageUrl(result.assetPath),
      description: result.style,
    });
  }

  const styleExploration = {
    slots: candidates.map((candidate, index) => ({
      title: `Style ${index + 1}`,
      description: candidate.description,
      imageUrl: candidate.url,
      assetId: candidate.assetId,
    })),
  };
  await updateRows('projects', { id: project.id }, {
    style_exploration: JSON.stringify(styleExploration),
    updated_at: new Date().toISOString(),
  });

  await logCall({
    projectId: project.id,
    stage: 'generate-style-candidates',
    model: getStyleOptionsModelName(project.imageModel),
    prompt: styleNotes || input.promptOverride || 'Generate style candidates',
    referenceInputs: [
      ...(guideAsset ? [{ type: 'image' as const, label: 'Style guide', url: storageUrl(guideAsset.file_path) }] : []),
      ...(contextTrace.requested ? [{ type: 'text' as const, label: 'Context overrides', preview: contextTracePreview(contextTrace) }] : []),
    ],
    contextChain: await buildContextChain(project.id),
    responseSummary: `Generated ${candidates.length} style candidates.`,
    outputAssetIds: candidates.map((candidate) => candidate.assetId),
    durationMs,
    costEstimate: 0.04,
  });
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'style_candidates_generated',
    entityType: 'project',
    entityId: project.id,
    summary: `Codex generated ${candidates.length} style candidates.`,
    payload: { count: candidates.length, guideAssetId: guideAsset?.id || null, promptOverride: !!input.promptOverride, contextOverrides: contextTrace },
  });

  return {
    kind: 'mirage.style.candidates',
    projectId: project.id,
    candidates,
    styleExploration,
    webUrl: webStudioUrl(project.id, { step: 'blueprint' }),
  };
};
