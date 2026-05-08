import { v4 as uuidv4 } from 'uuid';
import { incrementColumn, insertRow, selectAll, selectOne, updateRows } from '../database.js';
import { storageUrl } from '../storage.js';
import { generateOpenAIImageWithResponses, OpenAIRefImage } from './openai-image.js';
import { buildStoryboardPrompt, StoryboardPromptVariant, StoryboardRdInput } from './seedance-storyboard-rd.js';
import { buildContextChain, logCall } from '../xray.js';

type StoryboardRefMeta = {
  label: string;
  assetId?: string;
  filePath: string;
};
export type { StoryboardRefMeta };

type StoryboardContext = {
  project: any;
  scene: any;
  shot: any;
  input: StoryboardRdInput;
  refs: OpenAIRefImage[];
  refMeta: StoryboardRefMeta[];
};

const parseJson = <T>(value: any, fallback: T): T => {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

const parseTimestamp = (t?: string): number => {
  if (!t || !t.includes(':')) return 0;
  const parts = t.split(':').map(Number);
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return parts[0] * 60 + (parts[1] || 0);
};

const buildConceptSummary = (project: any): { concept: string; mood?: string } => {
  const concept = parseJson<Record<string, any>>(project.locked_concept, {});
  return {
    concept: concept.conceptDirection || concept.summary || concept.title || `Devotional music video for ${project.title}`,
    mood: concept.mood || undefined,
  };
};

const buildMusicalCue = (project: any, scene: any): string | undefined => {
  const sections = parseJson<any[]>(project.musical_structure, []);
  if (!sections.length) return undefined;

  const sceneStart = parseTimestamp(scene.start_time);
  const sceneEnd = parseTimestamp(scene.end_time);
  const matching = sections
    .map((section) => {
      const start = parseTimestamp(section.startTime || section.start_time);
      const end = parseTimestamp(section.endTime || section.end_time);
      const overlap = Math.max(0, Math.min(sceneEnd, end) - Math.max(sceneStart, start));
      return { section, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap)[0]?.section;

  if (!matching) return undefined;
  const label = matching.label || matching.sectionLabel || 'Musical section';
  const start = matching.startTime || matching.start_time;
  const end = matching.endTime || matching.end_time;
  const energy = matching.energy || matching.energyLevel || matching.energy_level;
  const description = matching.description;
  return [
    `${label}${start && end ? ` (${start}-${end})` : ''}`,
    energy ? `${energy} energy` : '',
    description || '',
  ].filter(Boolean).join('; ');
};

const addRef = (
  refs: OpenAIRefImage[],
  refMeta: StoryboardRefMeta[],
  label: string,
  asset: any,
) => {
  if (!asset?.file_path) return;
  refs.push({ label, imagePath: asset.file_path });
  refMeta.push({ label, assetId: asset.id, filePath: asset.file_path });
};

const estimateStoryboardCost = (imageCount: number): number => {
  const configured = Number(process.env.OPENAI_STORYBOARD_COST_ESTIMATE || 0);
  if (configured > 0) return configured * Math.max(1, imageCount);
  // Rough non-zero telemetry until OpenAI usage exposes image-tool cost directly.
  return 0.06 * Math.max(1, imageCount);
};

const isMissingPreviousResponse = (err: any): boolean => {
  const text = `${err?.message || ''} ${err?.code || ''} ${err?.type || ''}`.toLowerCase();
  const mentionsPreviousResponse = text.includes('previous_response') || text.includes('previous response');
  const looksMissingOrExpired = text.includes('not found') || text.includes('expired');
  return mentionsPreviousResponse || (looksMissingOrExpired && text.includes('previous') && text.includes('response'));
};

const shouldRegenerateStoryboardRefine = (artistNote?: string): boolean => {
  const note = artistNote?.toLowerCase().trim() || '';
  if (!note) return false;
  const surgicalHints = [
    'small fix', 'surgical', 'only change', 'just change', 'keep layout',
    'keep the same panels', 'same panels', 'same composition', 'same cut plan',
    'fix face', 'fix hand', 'fix hands', 'fix eyes', 'fix costume', 'fix color',
    'clean up', 'remove artifact', 'remove text', 'remove number', 'remove label',
  ];
  if (surgicalHints.some((hint) => note.includes(hint))) return false;

  const regenerateHints = [
    'panel', 'panels', 'cut', 'cuts', 'beat', 'beats', 'timing', 'duration',
    'remove', 'add', 'fewer', 'more', 'reorder', 'sequence', 'pacing',
    'layout', 'row', 'grid', 'story', 'thematic', 'theme', 'make it about',
    'change the action', 'different action', 'different angle', 'new angle',
    'from scratch', 'redo', 'rework',
  ];
  return regenerateHints.some((hint) => note.includes(hint));
};

export const loadStoryboardContext = async (projectId: string, shotId: string): Promise<StoryboardContext> => {
  const project = await selectOne('projects', { id: projectId });
  if (!project) throw new Error('Project not found');

  const shot = await selectOne('shots', { id: shotId });
  if (!shot) throw new Error('Shot not found');

  const scene = await selectOne('scenes', { id: shot.scene_id });
  if (!scene || scene.project_id !== projectId) throw new Error('Shot does not belong to this project');

  const castIds = parseJson<string[]>(shot.cast_ids, []);
  const cast = await selectAll('cast_members', { project_id: projectId });
  const activeCast = cast.filter((member: any) => castIds.includes(member.id));
  const environment = shot.environment_id ? await selectOne('environments', { id: shot.environment_id }) : null;

  const refs: OpenAIRefImage[] = [];
  const refMeta: StoryboardRefMeta[] = [];

  if (project.style_asset_id) {
    addRef(refs, refMeta, 'Locked style reference', await selectOne('assets', { id: project.style_asset_id }));
  }
  for (const member of activeCast) {
    if (!member.reference_asset_id) continue;
    addRef(refs, refMeta, `Character reference: ${member.name}`, await selectOne('assets', { id: member.reference_asset_id }));
  }
  if (environment?.reference_asset_id) {
    addRef(refs, refMeta, `Environment reference: ${environment.name}`, await selectOne('assets', { id: environment.reference_asset_id }));
  }

  const concept = buildConceptSummary(project);
  const input: StoryboardRdInput = {
    title: project.title,
    concept: concept.concept,
    mood: concept.mood,
    songType: project.song_type || undefined,
    sceneLabel: scene.section_label || `Scene ${scene.sort_order + 1}`,
    sceneStart: scene.start_time || '',
    sceneEnd: scene.end_time || '',
    sceneNarrative: scene.narrative_description || '',
    sceneLyrics: scene.lyrics || '',
    musicalCue: buildMusicalCue(project, scene),
    clipDirection: shot.direction || shot.motion_prompt || shot.visual_prompt || '',
    clipDuration: Math.max(4, Math.min(15, Number(shot.duration || 15))),
    castNames: activeCast.map((member: any) => member.name),
    environmentName: environment?.name || undefined,
  };

  return { project, scene, shot, input, refs, refMeta };
};

export const generateStoryboardVersion = async (opts: {
  projectId: string;
  shotId: string;
  variant?: StoryboardPromptVariant;
  artistNote?: string;
  previousVersionId?: string;
}): Promise<{
  versionId: string;
  assetId: string;
  imageUrl: string;
  storagePath: string;
  responseId: string;
  reasoningModel: string;
  imageModel: string;
}> => {
  const ctx = await loadStoryboardContext(opts.projectId, opts.shotId);
  const isRefine = Boolean(opts.artistNote?.trim() || opts.previousVersionId);
  const previousVersion = isRefine
    ? opts.previousVersionId
      ? await selectOne('storyboard_versions', { id: opts.previousVersionId, shot_id: opts.shotId })
      : ctx.shot.storyboard_version_id
        ? await selectOne('storyboard_versions', { id: ctx.shot.storyboard_version_id, shot_id: opts.shotId })
        : null
    : null;

  const variant = opts.variant || 'adaptive_numbered_storyboard';
  const basePrompt = buildStoryboardPrompt(ctx.input, variant);
  const previousMetadata = parseJson<Record<string, any>>(previousVersion?.metadata, {});
  const previousCutPlan = previousMetadata.cutPlanText ? `\n\nPrevious cut plan to preserve/improve:\n${previousMetadata.cutPlanText}` : '';
  const regenerateRefine = shouldRegenerateStoryboardRefine(opts.artistNote);
  const prompt = opts.artistNote?.trim()
    ? `Refine the existing Lahari storyboard using this artist note: "${opts.artistNote.trim()}"

${regenerateRefine
  ? `If the note asks for panel count, cut order, pacing, layout, action, or thematic changes, re-plan the storyboard and generate a new clean board.`
  : `Treat this as a surgical visual edit. Preserve the same cut plan, panel count, layout, camera order, character identity, costume, environment, and style unless the note explicitly asks otherwise.`}
Keep the same ${ctx.input.clipDuration}s clip intent unless the note explicitly asks otherwise.
${previousCutPlan}

Original storyboard brief:
${basePrompt}`
    : basePrompt;

  await updateRows('shots', { id: opts.shotId }, { storyboard_status: 'loading' });
  const t0 = Date.now();

  try {
    let responseChainFallback = false;
    const callResponses = (previousResponseId?: string, refs: OpenAIRefImage[] = ctx.refs) => generateOpenAIImageWithResponses(prompt, {
      aspectRatio: ctx.project.aspect_ratio || '16:9',
      size: '3072x1536',
      refs,
      previousResponseId,
      action: previousVersion && !regenerateRefine ? 'edit' : 'generate',
      quality: 'medium',
    });

    let result;
    try {
      result = await callResponses(previousVersion?.openai_response_id || undefined);
    } catch (err: any) {
      if (!previousVersion?.openai_response_id || !isMissingPreviousResponse(err)) throw err;

      responseChainFallback = true;
      const previousAsset = previousVersion.asset_id
        ? await selectOne('assets', { id: previousVersion.asset_id })
        : null;
      const fallbackRefs = previousAsset?.file_path
        ? [{ label: 'Previous storyboard version to refine', imagePath: previousAsset.file_path }, ...ctx.refs]
        : ctx.refs;
      result = await callResponses(undefined, fallbackRefs);
    }

    const [storagePath] = result.imagePaths;
    const assetId = uuidv4();
    const versionId = uuidv4();
    const durationMs = Date.now() - t0;
    const costEstimate = estimateStoryboardCost(result.imagePaths.length);
    await insertRow('assets', {
      id: assetId,
      project_id: opts.projectId,
      shot_id: opts.shotId,
      category: 'shot_storyboard',
      file_path: storagePath,
      prompt,
      metadata: JSON.stringify({
        storyboardVersionId: versionId,
        openaiResponseId: result.responseId,
        imageGenerationCallIds: result.imageGenerationCallIds,
        imageGenerationRevisedPrompts: result.imageGenerationRevisedPrompts,
        responseText: result.outputText,
        responseChainFallback,
      }),
    });

    await insertRow('storyboard_versions', {
      id: versionId,
      project_id: opts.projectId,
      shot_id: opts.shotId,
      asset_id: assetId,
      parent_version_id: previousVersion?.id || null,
      openai_response_id: result.responseId,
      openai_image_call_ids: result.imageGenerationCallIds,
      reasoning_model: result.reasoningModel,
      image_model: result.imageModel,
      prompt,
      artist_note: opts.artistNote || null,
      refs: ctx.refMeta,
      metadata: {
        variant,
        clipDuration: ctx.input.clipDuration,
        sceneLabel: ctx.input.sceneLabel,
        cutPlanText: result.outputText || null,
        revisedPrompt: result.imageGenerationRevisedPrompts[0] || null,
        responseChainFallback,
      },
      locked: false,
    });

    await updateRows('shots', { id: opts.shotId }, {
      storyboard_asset_id: assetId,
      storyboard_version_id: versionId,
      storyboard_status: 'success',
      storyboard_locked: false,
      storyboard_user_feedback: opts.artistNote || null,
      video_status: 'stale',
      last_error: null,
    });

    await logCall({
      projectId: opts.projectId,
      stage: opts.artistNote?.trim() ? 'refine-storyboard' : 'generate-storyboard',
      model: `${result.reasoningModel}+${result.imageModel}`,
      prompt,
      referenceInputs: ctx.refMeta.map((ref) => ({ type: 'image' as const, label: ref.label, url: storageUrl(ref.filePath) })),
      contextChain: await buildContextChain(opts.projectId),
      responseSummary: `${opts.artistNote?.trim() ? 'Refined' : 'Generated'} storyboard ${versionId}${responseChainFallback ? ' (fresh response fallback)' : ''}`,
      outputAssetIds: [assetId],
      durationMs,
      costEstimate,
    });
    await incrementColumn('projects', { id: opts.projectId }, 'cost_estimate', costEstimate);

    return {
      versionId,
      assetId,
      imageUrl: storageUrl(storagePath),
      storagePath,
      responseId: result.responseId,
      reasoningModel: result.reasoningModel,
      imageModel: result.imageModel,
    };
  } catch (err: any) {
    const durationMs = Date.now() - t0;
    await logCall({
      projectId: opts.projectId,
      stage: opts.artistNote?.trim() ? 'refine-storyboard' : 'generate-storyboard',
      model: 'openai-responses-image',
      prompt,
      referenceInputs: ctx.refMeta.map((ref) => ({ type: 'image' as const, label: ref.label, url: storageUrl(ref.filePath) })),
      contextChain: await buildContextChain(opts.projectId),
      durationMs,
      error: err.message,
    });
    await updateRows('shots', { id: opts.shotId }, {
      storyboard_status: 'error',
      last_error: err.message,
    });
    throw err;
  }
};

export const lockStoryboardVersion = async (projectId: string, shotId: string, versionId?: string): Promise<void> => {
  const shot = await selectOne('shots', { id: shotId });
  if (!shot) throw new Error('Shot not found');
  const targetVersionId = versionId || shot.storyboard_version_id;
  if (!targetVersionId) throw new Error('No storyboard version to lock');

  const version = await selectOne('storyboard_versions', { id: targetVersionId, shot_id: shotId, project_id: projectId });
  if (!version) throw new Error('Storyboard version not found');

  await updateRows('storyboard_versions', { shot_id: shotId }, { locked: false });
  await updateRows('storyboard_versions', { id: targetVersionId }, { locked: true });
  await updateRows('shots', { id: shotId }, {
    storyboard_version_id: targetVersionId,
    storyboard_asset_id: version.asset_id,
    storyboard_locked: true,
    storyboard_status: 'success',
  });
};

export const unlockStoryboardVersion = async (projectId: string, shotId: string): Promise<void> => {
  const shot = await selectOne('shots', { id: shotId });
  if (!shot) throw new Error('Shot not found');

  const scene = await selectOne('scenes', { id: shot.scene_id });
  if (!scene || scene.project_id !== projectId) throw new Error('Shot does not belong to this project');

  await updateRows('storyboard_versions', { shot_id: shotId }, { locked: false });
  await updateRows('shots', { id: shotId }, {
    storyboard_locked: false,
    storyboard_status: shot.storyboard_asset_id ? 'success' : 'idle',
  });
};

export const updateStoryboardCutPlan = async (
  projectId: string,
  shotId: string,
  cutPlanText: string
): Promise<void> => {
  const shot = await selectOne('shots', { id: shotId });
  if (!shot) throw new Error('Shot not found');

  const scene = await selectOne('scenes', { id: shot.scene_id });
  if (!scene || scene.project_id !== projectId) throw new Error('Shot does not belong to this project');

  const versionId = shot.storyboard_version_id;
  if (!versionId) throw new Error('No active storyboard version to update');

  const version = await selectOne('storyboard_versions', { id: versionId, shot_id: shotId, project_id: projectId });
  if (!version) throw new Error('Storyboard version not found');

  const metadata = parseJson<Record<string, any>>(version.metadata, {});
  await updateRows('storyboard_versions', { id: versionId }, {
    metadata: {
      ...metadata,
      cutPlanText: cutPlanText.trim(),
      cutPlanEditedAt: new Date().toISOString(),
    },
  });
};
