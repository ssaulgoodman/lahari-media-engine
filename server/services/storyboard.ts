import { v4 as uuidv4 } from 'uuid';
import { incrementColumn, insertRow, selectAll, selectOne, updateRows } from '../database.js';
import { storageUrl } from '../storage.js';
import { generateOpenAIImageFromPrompt, OpenAIRefImage } from './openai-image.js';
import { generateNanoBanana2 } from './segmind-image.js';
import { generateImageWithRefs, imagePartFromPath, type ContentPart } from './imagen.js';
import { generateText } from './text-provider.js';
import { getTextProvider, type TextProviderKey } from '../../constants/textProviders.js';
import { buildStoryboardPrompt, StoryboardPromptVariant, StoryboardRdInput } from './seedance-storyboard-rd.js';
import { buildContextChain, logCall } from '../xray.js';
import { getStoryboardProvider } from '../../constants/storyboardProviders.js';
import { getProjectPreferencesState, getProjectPromptOverride } from './projectConfig.js';
import { getProjectRuntimePreset } from '../presets.js';
import { buildStoryboardPlannerPrompt } from '../prompts/storyboard.js';

type StoryboardRefMeta = {
  label: string;
  assetId?: string;
  filePath: string;
  // Stable key used to look up this ref in shot.excluded_refs.{storyboard,video}.
  // Format: 'style' | 'cast:<castMemberId>' | 'env:<environmentId>'. Refs
  // without a key (e.g. artist-uploaded refine attachments) are always
  // included because there's no UI for the artist to exclude them.
  excludableKey?: string;
};
export type { StoryboardRefMeta };

/** Filter parallel refs + refMeta arrays by the shot's per-tab exclusion list.
 *  Excluded keys correspond to refMeta.excludableKey; non-excludable refs
 *  (artist-uploaded refine refs etc.) always pass through. */
export const applyRefExclusion = (
  refs: OpenAIRefImage[],
  refMeta: StoryboardRefMeta[],
  excludedKeys: string[],
): { refs: OpenAIRefImage[]; refMeta: StoryboardRefMeta[] } => {
  if (!excludedKeys.length) return { refs, refMeta };
  const filteredRefs: OpenAIRefImage[] = [];
  const filteredMeta: StoryboardRefMeta[] = [];
  for (let i = 0; i < refs.length; i++) {
    const key = refMeta[i]?.excludableKey;
    if (key && excludedKeys.includes(key)) continue;
    filteredRefs.push(refs[i]);
    filteredMeta.push(refMeta[i]);
  }
  return { refs: filteredRefs, refMeta: filteredMeta };
};

/** Read the storyboard-mode exclusion list off a shot row. Defaults to
 *  empty for both tabs when the column is missing or malformed. */
export const getShotExcludedRefs = (shot: any): { storyboard: string[]; video: string[] } => {
  const raw = shot?.excluded_refs;
  if (!raw) return { storyboard: [], video: [] };
  const parsed = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (!parsed || typeof parsed !== 'object') return { storyboard: [], video: [] };
  return {
    storyboard: Array.isArray(parsed.storyboard) ? parsed.storyboard.filter((k: any) => typeof k === 'string') : [],
    video: Array.isArray(parsed.video) ? parsed.video.filter((k: any) => typeof k === 'string') : [],
  };
};

type StoryboardContext = {
  project: any;
  scene: any;
  shot: any;
  input: StoryboardRdInput;
  refs: OpenAIRefImage[];
  refMeta: StoryboardRefMeta[];
};

type StoryboardRefineMode = 'replan' | 'edit_image';

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
    concept: concept.conceptDirection || concept.summary || concept.title || `Production project for ${project.title}`,
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
  excludableKey?: string,
) => {
  if (!asset?.file_path) return;
  refs.push({ label, imagePath: asset.file_path });
  refMeta.push({ label, assetId: asset.id, filePath: asset.file_path, excludableKey });
};

const estimateStoryboardCost = (imageCount: number): number => {
  const configured = Number(process.env.OPENAI_STORYBOARD_RENDER_COST_ESTIMATE || process.env.OPENAI_STORYBOARD_COST_ESTIMATE || 0);
  if (configured > 0) return configured * Math.max(1, imageCount);
  return 0.12 * Math.max(1, imageCount);
};

const estimateStoryboardPlanCost = (): number => {
  const configured = Number(process.env.OPENAI_STORYBOARD_PLAN_COST_ESTIMATE || 0);
  return configured > 0 ? configured : 0.02;
};

const extractJsonObject = (text: string): any => {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || trimmed;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Storyboard planner returned no JSON object');
  return JSON.parse(raw.slice(start, end + 1));
};

const withArtistRef = (
  refs: OpenAIRefImage[],
  refMeta: StoryboardRefMeta[],
  artistReferenceImagePath?: string,
) => {
  if (!artistReferenceImagePath) return { refs, refMeta };
  return {
    refs: [
      ...refs,
      { label: 'Artist storyboard refinement reference', imagePath: artistReferenceImagePath },
    ],
    refMeta: [
      ...refMeta,
      { label: 'Artist storyboard refinement reference', filePath: artistReferenceImagePath },
    ],
  };
};

/** Find the previous shot in the same scene by sort_order. Used for
 *  storyboard continuity refs — the shot the artist is handing off from.
 *  Returns null on the first shot of any scene (no in-scene predecessor) or
 *  when the shot row can't be resolved. */
export const findPrevShotInScene = async (shot: any): Promise<any | null> => {
  if (!shot?.scene_id || shot.sort_order == null) return null;
  if (shot.sort_order === 0) return null;
  const sceneShots = await selectAll('shots', { scene_id: shot.scene_id });
  return sceneShots.find((s: any) => s.sort_order === shot.sort_order - 1) || null;
};

/** Resolve `shot.include_prev_cut_plan` into the actual boolean the planner
 *  should use. Nullable column means "artist hasn't decided → use the smart
 *  default": true when shot is tagged as a continuation AND a previous shot
 *  exists in the same scene; false otherwise. Explicit true/false from the
 *  artist always wins. */
export const resolveIncludePrevCutPlan = (shot: any, prevShot: any | null): boolean => {
  if (shot?.include_prev_cut_plan === true) return true;
  if (shot?.include_prev_cut_plan === false) return false;
  if (!prevShot) return false;
  return shot?.continuity_from === 'prev_shot';
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
    addRef(refs, refMeta, 'Locked style reference', await selectOne('assets', { id: project.style_asset_id }), 'style');
  }
  for (const member of activeCast) {
    if (!member.reference_asset_id) continue;
    addRef(refs, refMeta, `Character reference: ${member.name}`, await selectOne('assets', { id: member.reference_asset_id }), `cast:${member.id}`);
  }
  if (environment?.reference_asset_id) {
    addRef(refs, refMeta, `Environment reference: ${environment.name}`, await selectOne('assets', { id: environment.reference_asset_id }), `env:${environment.id}`);
  }

  // Continuity ref: when the artist enables "use prev storyboard", look up
  // the previous shot in the same scene and attach its locked storyboard
  // image as another ref. Slots into the existing per-step exclusion model
  // via excludableKey 'prev_storyboard' so it can be dropped just like any
  // other chip. Skipped silently when the prev shot has no storyboard yet —
  // the artist gets visual feedback (no chip) instead of a silent error.
  if (shot.use_prev_storyboard_ref) {
    const prevShot = await findPrevShotInScene(shot);
    if (prevShot?.storyboard_asset_id) {
      const prevAsset = await selectOne('assets', { id: prevShot.storyboard_asset_id });
      if (prevAsset?.file_path) {
        addRef(refs, refMeta, 'Previous shot storyboard (continuity)', prevAsset, 'prev_storyboard');
      }
    }
  }

  const concept = buildConceptSummary(project);
  const preset = getProjectRuntimePreset(project);
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
    preset,
  };

  return { project, scene, shot, input, refs, refMeta };
};

export const writeStoryboardPrompt = async (opts: {
  projectId: string;
  shotId: string;
  variant?: StoryboardPromptVariant;
  artistNote?: string;
  artistReferenceImagePath?: string;
}): Promise<{
  storyboardPrompt: string;
  cutPlanText: string;
}> => {
  await updateRows('shots', { id: opts.shotId }, { storyboard_prompt_status: 'loading' });
  const t0 = Date.now();

  try {
    const result = await planStoryboardPrompt(opts);
    await updateRows('shots', { id: opts.shotId }, {
      storyboard_prompt: result.storyboardPrompt,
      storyboard_cut_plan: result.cutPlanText,
      storyboard_prompt_status: 'success',
      storyboard_prompt_user_feedback: opts.artistNote || null,
      // Clear staleness now that the planner has re-read castIds /
      // environment_id from DB and folded them into the prompt + cut plan.
      // Mirrors the keyframe pipeline's clear in refine-prompt (the
      // equivalent text-rewrite action). Without this, stale stays true
      // forever after the first cast/env edit and the UI indicator
      // becomes useless noise.
      prompts_stale: false,
      last_error: null,
    });

    const durationMs = Date.now() - t0;
    await logCall({
      projectId: opts.projectId,
      stage: opts.artistNote?.trim() ? 'refine-storyboard-prompt' : 'write-storyboard-prompt',
      model: result.model,
      prompt: result.runtimePrompt,
      referenceInputs: result.referenceInputs,
      contextChain: await buildContextChain(opts.projectId),
      responseSummary: `Saved storyboard prompt for shot ${opts.shotId}`,
      durationMs,
      costEstimate: result.costEstimate,
    });
    await incrementColumn('projects', { id: opts.projectId }, 'cost_estimate', result.costEstimate);

    return { storyboardPrompt: result.storyboardPrompt, cutPlanText: result.cutPlanText };
  } catch (err: any) {
    const ctx = await loadStoryboardContext(opts.projectId, opts.shotId);
    const preferences = await getProjectPreferencesState(ctx.project as any);
    const providerSpec = getTextProvider(preferences.preferences.textProvider as TextProviderKey | undefined);
    await updateRows('shots', { id: opts.shotId }, {
      storyboard_prompt_status: 'error',
      last_error: err.message,
    });
    await logCall({
      projectId: opts.projectId,
      stage: opts.artistNote?.trim() ? 'refine-storyboard-prompt' : 'write-storyboard-prompt',
      model: providerSpec.runtimeModel,
      prompt: `Storyboard prompt planning failed for shot ${opts.shotId}`,
      referenceInputs: [],
      contextChain: await buildContextChain(opts.projectId),
      durationMs: Date.now() - t0,
      error: err.message,
    });
    throw err;
  }
};

export const planStoryboardPrompt = async (opts: {
  projectId: string;
  shotId: string;
  variant?: StoryboardPromptVariant;
  artistNote?: string;
  artistReferenceImagePath?: string;
}): Promise<{
  storyboardPrompt: string;
  cutPlanText: string;
  runtimePrompt: string;
  model: string;
  costEstimate: number;
  referenceInputs: { type: 'image'; label: string; url: string }[];
}> => {
  const ctx = await loadStoryboardContext(opts.projectId, opts.shotId);
  const variant = opts.variant || 'adaptive_numbered_storyboard';
  const basePrompt = buildStoryboardPrompt(ctx.input, variant);
  const projectStoryboardOverride = await getProjectPromptOverride(opts.projectId, 'storyboard');
  const preferences = await getProjectPreferencesState(ctx.project as any);
  // Provider selection: per-project setting. Falls back to the registry's
  // first entry (Claude Opus) when text_provider is null on the row. The
  // env-var override (OPENAI_STORYBOARD_PLANNER_MODEL) is no longer
  // consulted — overrides now happen per-project via the dropdown.
  const providerKey = preferences.preferences.textProvider as TextProviderKey | undefined;
  const providerSpec = getTextProvider(providerKey);
  const currentPrompt = ctx.shot.storyboard_prompt || '';
  const currentCutPlan = ctx.shot.storyboard_cut_plan || '';

  // Continuity from previous shot — two independent flags both come from
  // shot row state. include_prev_cut_plan resolves through the smart-default
  // helper (null → derive from continuity_from). use_prev_storyboard_ref is
  // an explicit boolean; when on, loadStoryboardContext above already
  // attached the prev shot's storyboard as a 'prev_storyboard' ref.
  const prevShot = await findPrevShotInScene(ctx.shot);
  const includePrevCutPlan = resolveIncludePrevCutPlan(ctx.shot, prevShot);
  const prevCutPlanTail = includePrevCutPlan && prevShot?.storyboard_cut_plan
    ? String(prevShot.storyboard_cut_plan).trim()
    : '';
  // Vision-continuity instruction: only meaningful when the planner is
  // actually getting the previous storyboard image. Refs filter below
  // controls whether we send it; this note tells the model how to use it.
  const prevStoryboardRef = ctx.refMeta.find((r) => r.excludableKey === 'prev_storyboard');
  const prompt = buildStoryboardPlannerPrompt({
    sourceBrief: basePrompt,
    currentPrompt,
    currentCutPlan,
    artistNote: opts.artistNote,
    hasArtistReference: !!opts.artistReferenceImagePath,
    hasPreviousStoryboardRef: !!prevStoryboardRef,
    previousCutPlanTail: prevCutPlanTail || undefined,
    projectOverride: projectStoryboardOverride || undefined,
    preset: ctx.input.preset,
  });

  const plannerRefs = withArtistRef(ctx.refs, ctx.refMeta, opts.artistReferenceImagePath);
  // Vision inputs to the planner. Originally "text-only by design", but
  // that policy made the planner blind to the project's visual medium —
  // stylized projects inherited cinema bias because the planner couldn't
  // see what was actually locked. New policy: send artist refs, previous
  // storyboard continuity refs, and the locked style image. Cast/env refs
  // still stay out of the planner; they handle identity downstream in the
  // image renderer.
  const plannerVisionRefs = plannerRefs.refs.filter((ref) => {
    if (ref.imagePath === opts.artistReferenceImagePath) return true;
    const meta = plannerRefs.refMeta.find((m) => m.filePath === ref.imagePath);
    return meta?.excludableKey === 'prev_storyboard' || meta?.excludableKey === 'style';
  });

  // Dispatched through text-provider.ts. The provider abstraction handles
  // each vendor's JSON-mode and vision-input conventions; we just pass the
  // request and parse the text response with extractJsonObject as before.
  const { text: outputText, model: actualModel } = await generateText(providerKey, {
    userPrompt: prompt,
    inputImages: plannerVisionRefs.map((ref) => ({
      url: storageUrl(ref.imagePath),
      label: plannerRefs.refMeta.find((m) => m.filePath === ref.imagePath)?.label,
    })),
    jsonMode: true,
    reasoning: 'low',
    maxTokens: 4096,
  });
  const parsed = extractJsonObject(outputText);
  const storyboardPrompt = String(parsed.storyboardPrompt || '').trim();
  const cutPlanText = String(parsed.cutPlanText || '').trim();
  if (!storyboardPrompt || !cutPlanText) throw new Error('Storyboard planner returned empty prompt or cut plan');

  return {
    storyboardPrompt,
    cutPlanText,
    runtimePrompt: prompt,
    model: actualModel || providerSpec.runtimeModel,
    costEstimate: estimateStoryboardPlanCost(),
    referenceInputs: plannerRefs.refMeta.map((ref) => ({ type: 'image' as const, label: ref.label, url: storageUrl(ref.filePath) })),
  };
};

const renderWithProvider = async (
  providerKey: string | undefined,
  prompt: string,
  aspectRatio: string,
  refs: OpenAIRefImage[],
): Promise<{ storagePath: string; model: string; provider: string; costEstimate: number; size?: string }> => {
  const provider = getStoryboardProvider(providerKey);

  if (provider.provider === 'openai') {
    const [storagePath] = await generateOpenAIImageFromPrompt(prompt, { aspectRatio, refs, count: 1 });
    return {
      storagePath,
      model: provider.runtimeModel,
      provider: provider.key,
      costEstimate: estimateStoryboardCost(1),
      size: aspectRatio === '9:16' ? '1024x1536' : aspectRatio === '1:1' ? '1024x1024' : '1536x1024',
    };
  }

  if (provider.provider === 'google') {
    // Nano Banana Pro (gemini-3-pro-image-preview) — multimodal API. The
    // existing generateImageWithRefs helper consumes a `parts` array of
    // text + inlineData segments. Translate the storyboard ref shape (text
    // label + filepath or inlineData) into that protocol. Numbered labels
    // ("Image N = ...") match the convention the keyframe pipeline uses so
    // the model interprets refs the same way across stages.
    const parts: ContentPart[] = [{ text: prompt }];
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      parts.push({ text: `Image ${i + 1} = ${ref.label}` });
      if (ref.imagePath) {
        parts.push(await imagePartFromPath(ref.imagePath));
      } else if (ref.inlineData) {
        parts.push({ inlineData: { mimeType: ref.inlineData.mimeType, data: ref.inlineData.data } });
      }
    }
    // Pass the spec's runtimeModel so the artist's exact pick runs (no
    // Pro→Flash auto-fallback in explicit-model mode). When the registry
    // flips a model between providers — e.g. `nano-banana-2` was Segmind,
    // now Google `gemini-3.1-flash-image-preview` — this guarantees the
    // dispatched model matches the label.
    const storagePath = await generateImageWithRefs(parts, aspectRatio, provider.runtimeModel);
    return {
      storagePath,
      model: provider.runtimeModel,
      provider: provider.key,
      // Gemini image gen is per-image priced; matches the rough cost band
      // we use for shot frame gen.
      costEstimate: Number(process.env.GEMINI_STORYBOARD_RENDER_COST_ESTIMATE || 0.04),
    };
  }

  const imagePath = await generateNanoBanana2(prompt, aspectRatio, refs, provider.runtimeModel);
  return {
    storagePath: imagePath,
    model: provider.runtimeModel,
    provider: provider.key,
    costEstimate: Number(process.env.SEGMIND_STORYBOARD_RENDER_COST_ESTIMATE || 0.03),
  };
};

export const generateStoryboardVersion = async (opts: {
  projectId: string;
  shotId: string;
  variant?: StoryboardPromptVariant;
  artistNote?: string;
  previousVersionId?: string;
  refineMode?: StoryboardRefineMode;
  artistReferenceImagePath?: string;
  modelOverride?: {
    storyboardProvider?: string;
  };
}): Promise<{
  versionId: string;
  assetId: string;
  imageUrl: string;
  storagePath: string;
  responseId: string | null;
  reasoningModel: string | null;
  imageModel: string;
}> => {
  const ctx = await loadStoryboardContext(opts.projectId, opts.shotId);
  const promptBase = String(ctx.shot.storyboard_prompt || '').trim();
  const cutPlanText = String(ctx.shot.storyboard_cut_plan || '').trim();
  if (!promptBase) throw new Error('Write a storyboard prompt before rendering an image');
  // Cut plan is for the downstream Seedance video step — it doesn't gate or
  // feed image gen. Frontend already treats it as optional ("Optional" label
  // since commit 34a9f3c) so artists who deliberately empty it to fall back
  // to Seedance's "follow storyboard" default shouldn't get blocked here.

  const isRefine = Boolean(opts.artistNote?.trim() || opts.previousVersionId);
  const previousVersion = isRefine
    ? opts.previousVersionId
      ? await selectOne('storyboard_versions', { id: opts.previousVersionId, shot_id: opts.shotId })
      : ctx.shot.storyboard_version_id
        ? await selectOne('storyboard_versions', { id: ctx.shot.storyboard_version_id, shot_id: opts.shotId })
        : null
    : null;
  const previousAsset = previousVersion?.asset_id ? await selectOne('assets', { id: previousVersion.asset_id }) : null;
  const refineMode: StoryboardRefineMode = opts.refineMode === 'edit_image' ? 'edit_image' : 'replan';
  // Apply per-tab exclusion BEFORE the previous-image + artist-attached-ref
  // augmentations. The artist's exclusion list targets composition refs
  // (style/cast/env), not the edit-mode previous image or refine attachment
  // — those should always pass through if present.
  const excludedKeys = getShotExcludedRefs(ctx.shot).storyboard;
  const { refs: filteredRefs, refMeta: filteredMeta } = applyRefExclusion(ctx.refs, ctx.refMeta, excludedKeys);
  const baseRefs = previousAsset?.file_path && refineMode === 'edit_image'
    ? [{ label: 'Previous storyboard image to edit', imagePath: previousAsset.file_path }, ...filteredRefs]
    : filteredRefs;
  const baseRefMeta = previousAsset?.file_path && refineMode === 'edit_image'
    ? [{ label: 'Previous storyboard image to edit', assetId: previousAsset.id, filePath: previousAsset.file_path }, ...filteredMeta]
    : filteredMeta;
  const { refs, refMeta } = withArtistRef(baseRefs, baseRefMeta, opts.artistReferenceImagePath);
  const artistRefNote = opts.artistReferenceImagePath
    ? `\nArtist attached an additional refinement reference image. Use it as guidance for the requested change only; preserve the locked cast, environment, style refs, and saved cut plan.`
    : '';
  // Edit mode = "this storyboard image is good, change this one thing."
  // The image renderer doesn't render motion, timestamps, or cut sequencing,
  // so the cut plan is irrelevant context — at best ignored, at worst
  // bleeds visible text/arrows into the panels. Send only the base prompt
  // (which describes the target image) + the artist's edit instruction.
  const prompt = opts.artistNote?.trim() && refineMode === 'edit_image'
    ? `${promptBase}

Artist image edit note:
${opts.artistNote.trim()}
${artistRefNote}`
    : promptBase;

  await updateRows('shots', { id: opts.shotId }, { storyboard_status: 'loading' });
  const t0 = Date.now();
  const preferences = await getProjectPreferencesState(ctx.project as any);

  try {
    const rendered = await renderWithProvider(opts.modelOverride?.storyboardProvider || preferences.preferences.storyboardProvider, prompt, ctx.project.aspect_ratio || '16:9', refs);
    const assetId = uuidv4();
    const versionId = uuidv4();
    const durationMs = Date.now() - t0;
    await insertRow('assets', {
      id: assetId,
      project_id: opts.projectId,
      shot_id: opts.shotId,
      category: 'shot_storyboard',
      file_path: rendered.storagePath,
      prompt,
      metadata: JSON.stringify({
        storyboardVersionId: versionId,
        provider: rendered.provider,
        rendererModel: rendered.model,
        imageRenderOnly: true,
        size: rendered.size,
      }),
    });

    await insertRow('storyboard_versions', {
      id: versionId,
      project_id: opts.projectId,
      shot_id: opts.shotId,
      asset_id: assetId,
      parent_version_id: previousVersion?.id || null,
      openai_response_id: null,
      openai_image_call_ids: [],
      reasoning_model: null,
      image_model: rendered.model,
      prompt,
      artist_note: opts.artistNote || null,
      refs: refMeta,
      metadata: {
        variant: opts.variant || 'adaptive_numbered_storyboard',
        clipDuration: ctx.input.clipDuration,
        sceneLabel: ctx.input.sceneLabel,
        cutPlanText,
        storyboardPrompt: promptBase,
        provider: rendered.provider,
        rendererModel: rendered.model,
        imageRenderOnly: true,
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
      stage: opts.artistNote?.trim() ? 'edit-storyboard-image' : 'render-storyboard-image',
      model: rendered.model,
      prompt,
      referenceInputs: refMeta.map((ref) => ({ type: 'image' as const, label: ref.label, url: storageUrl(ref.filePath) })),
      contextChain: await buildContextChain(opts.projectId),
      responseSummary: `${opts.artistNote?.trim() ? 'Edited' : 'Rendered'} storyboard ${versionId} via ${rendered.provider}`,
      outputAssetIds: [assetId],
      durationMs,
      costEstimate: rendered.costEstimate,
    });
    await incrementColumn('projects', { id: opts.projectId }, 'cost_estimate', rendered.costEstimate);

    return {
      versionId,
      assetId,
      imageUrl: storageUrl(rendered.storagePath),
      storagePath: rendered.storagePath,
      responseId: null,
      reasoningModel: null,
      imageModel: rendered.model,
    };
  } catch (err: any) {
    const durationMs = Date.now() - t0;
    await logCall({
      projectId: opts.projectId,
      stage: opts.artistNote?.trim() ? 'edit-storyboard-image' : 'render-storyboard-image',
      model: getStoryboardProvider(preferences.preferences.storyboardProvider).runtimeModel,
      prompt,
      referenceInputs: refMeta.map((ref) => ({ type: 'image' as const, label: ref.label, url: storageUrl(ref.filePath) })),
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
  cutPlanText: string,
  storyboardPrompt?: string,
): Promise<void> => {
  const shot = await selectOne('shots', { id: shotId });
  if (!shot) throw new Error('Shot not found');

  const scene = await selectOne('scenes', { id: shot.scene_id });
  if (!scene || scene.project_id !== projectId) throw new Error('Shot does not belong to this project');

  const updates: Record<string, any> = {
    storyboard_cut_plan: cutPlanText.trim(),
    storyboard_prompt_status: shot.storyboard_prompt_status || 'success',
  };
  if (storyboardPrompt !== undefined) updates.storyboard_prompt = storyboardPrompt.trim();
  await updateRows('shots', { id: shotId }, updates);

  const versionId = shot.storyboard_version_id;
  if (versionId) {
    const version = await selectOne('storyboard_versions', { id: versionId, shot_id: shotId, project_id: projectId });
    if (!version) throw new Error('Storyboard version not found');

    const metadata = parseJson<Record<string, any>>(version.metadata, {});
    await updateRows('storyboard_versions', { id: versionId }, {
      prompt: storyboardPrompt !== undefined ? storyboardPrompt.trim() : version.prompt,
      metadata: {
        ...metadata,
        cutPlanText: cutPlanText.trim(),
        storyboardPrompt: storyboardPrompt !== undefined ? storyboardPrompt.trim() : metadata.storyboardPrompt,
        cutPlanEditedAt: new Date().toISOString(),
      },
    });
  }
};
