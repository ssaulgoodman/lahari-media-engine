import { v4 as uuidv4 } from 'uuid';
import { insertRow, selectAll, selectOne, updateRows } from '../../../database.js';
import { recordDirectorEvent } from '../../directorEvents.js';
import { readAsBase64, storageUrl, mimeFromExt } from '../../../storage.js';
import { analyzeImageStyle } from '../../claude.js';
import { getImageGenerationModelName, getImageService, getStyleOptionsModelName } from '../../image-provider.js';
import { getProjectRuntimePreset, presetSubject } from '../../../presets.js';
import { buildContextChain, logCall } from '../../../xray.js';
import { formatSelectedStyleNotes, getProjectStyleNotesState } from '../../projectConfig.js';
import {
  contextTracePreview,
  emptyContextTrace,
  shouldIncludeConcept,
  shouldIncludeGuideAsset,
  shouldIncludeProjectStyleDescription,
  selectedStyleNoteSections,
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

const styleDescriptionNeedsBackfill = (value?: string | null) => {
  const text = String(value || '').trim();
  return text.length < 40;
};

const identifyStyleAsset = async (
  project: Project,
  asset: any,
  opts: { apply?: boolean; auto?: boolean } = {},
) => {
  const t0 = Date.now();
  const base64 = await readAsBase64(asset.file_path);
  const mimeType = mimeFromExt(asset.file_path);
  const styleDescription = await analyzeImageStyle(base64, mimeType, project.textProvider);
  const durationMs = Date.now() - t0;

  await logCall({
    projectId: project.id,
    stage: opts.auto ? 'identify-style-auto' : 'identify-style',
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
    summary: opts.auto
      ? 'Codex auto-identified the locked style reference.'
      : 'Codex identified the locked style reference.',
    payload: {
      assetId: asset.id,
      descriptionChars: styleDescription.length,
      applied: !!opts.apply,
      auto: !!opts.auto,
    },
  });

  return styleDescription;
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

  let autoIdentifiedStyleDescription: string | null = null;
  let autoIdentifyError: string | null = null;
  if (
    sourceAsset
    && input.styleDescription === undefined
    && styleDescriptionNeedsBackfill(project.styleDescription)
  ) {
    try {
      autoIdentifiedStyleDescription = await identifyStyleAsset(project, sourceAsset, { apply: true, auto: true });
    } catch (err: any) {
      autoIdentifyError = err?.message || String(err);
      console.warn(`[${project.id}] Style auto-identification failed for ${sourceAsset.id}: ${autoIdentifyError}`);
    }
  }

  const nextProject = {
    ...project,
    styleDescription: input.styleDescription !== undefined
      ? input.styleDescription.trim()
      : autoIdentifiedStyleDescription || project.styleDescription || '',
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
      autoIdentified: !!autoIdentifiedStyleDescription,
      autoIdentifyError,
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
      ? autoIdentifiedStyleDescription
        ? 'Locked style reference, auto-identified style text, and marked downstream references/prompts stale.'
        : 'Locked style reference and marked downstream references/prompts stale.'
      : 'Applied style direction text. No style image was generated or locked.',
    autoIdentified: !!autoIdentifiedStyleDescription,
    autoIdentifyError,
  };
};

export const identifyStyle = async (project: Project, input: { assetId?: string; apply?: boolean } = {}) => {
  const assetId = input.assetId || project.styleAssetId;
  const asset = await findProjectStyleAsset(project, assetId);
  if (!asset) return applyError('validation_failed', 'No style asset found to identify.', { field: 'assetId' });

  const styleDescription = await identifyStyleAsset(project, asset, { apply: input.apply });

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
  input: {
    note?: string;
    promptOverride?: string;
    directions?: Array<{ title?: string; description: string }>;
    guideAssetId?: string;
    count?: number;
    contextOverrides?: ContextOverrides;
  } = {},
) => {
  const contextTrace = emptyContextTrace(input.contextOverrides);
  const concept = shouldIncludeConcept(input.contextOverrides) ? project.lockedConcept || {} : {};
  if (input.contextOverrides?.includeConcept === false) contextTrace.excluded.push('concept');
  const preset = getProjectRuntimePreset({
    preset_key: project.presetKey,
    workflow_key: project.workflowKey,
  } as any);
  const subject = presetSubject(concept, project.title, preset);
  const projectStyleNotes = await getProjectStyleNotesState(project.id);
  const styleNoteSections = selectedStyleNoteSections(['image'], input.contextOverrides);
  const learnedStyleNotes = formatSelectedStyleNotes(projectStyleNotes, styleNoteSections, { modelKey: getImageGenerationModelName(project.imageModel) });
  let styleNotes = input.promptOverride
    || [input.note, shouldIncludeProjectStyleDescription(input.contextOverrides) ? project.styleDescription : undefined, learnedStyleNotes]
      .filter(Boolean)
      .join('\n\n')
    || undefined;
  if (learnedStyleNotes) contextTrace.included.push(`styleNotes:${styleNoteSections.join(',')}`);
  if (input.contextOverrides?.styleNoteSections?.exclude?.length) contextTrace.excluded.push(`styleNotes:${input.contextOverrides.styleNoteSections.exclude.join(',')}`);
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
  const suppliedDirections = input.directions
    ?.map((direction) => ({
      title: String(direction.title || '').trim(),
      description: String(direction.description || '').trim(),
    }))
    .filter((direction) => direction.description)
    .slice(0, 4) || [];
  const results: Array<{ title?: string; style: string; assetPath: string }> = input.promptOverride
    ? [{
      title: 'Prompt override',
      style: input.promptOverride,
      assetPath: await imageService.generateSingleStyleImage(
        input.promptOverride,
        subject,
        input.promptOverride,
        preset,
        getImageGenerationModelName(project.imageModel),
      ),
    }]
    : suppliedDirections.length
      ? await Promise.all(suppliedDirections.map(async (direction) => ({
        title: direction.title || undefined,
        style: direction.description,
        assetPath: await imageService.generateSingleStyleImage(
          direction.description,
          subject,
          direction.description,
          preset,
          getImageGenerationModelName(project.imageModel),
        ),
      })))
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
        suppliedDirection: suppliedDirections.length > 0,
        title: result.title || null,
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
      title: (results[index] as any)?.title || `Style ${index + 1}`,
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
