import { getPipelinePreset, getWorkflowRecipe } from '../../presets.js';
import { getProjectConfigState } from '../projectConfig.js';
import {
  audioPlanHash,
  compactText,
  namesById,
  shotLabel,
  shotPromptHash,
  shotWorkflowMode,
  storyboardPromptHash,
  type Project,
  type ProjectShot,
  videoPromptHash,
  webStudioUrl,
} from './core.js';
import {
  describePromptComposition,
  planGenerateStoryboard,
  planGenerateVideo,
  type PromptDescriptionKind,
} from './storyboardOps.js';

type PromptDescriptionSummary = {
  kind: PromptDescriptionKind;
  generatedAt: string | null;
  source: string;
  attemptId?: string | null;
  versionId?: string | null;
  hasComposition: boolean;
  note: string;
  segments: Array<{
    slot: string | null;
    label: string;
    included: boolean;
    source: string | null;
    editPath: string | null;
    preview: string | null;
  }>;
  images: Array<{
    ref: string | null;
    role: string | null;
    assetId: string | null;
    source: string | null;
    included?: boolean;
  }>;
	  params: Record<string, unknown> | null;
	  inspectorAction: {
	    tool: 'run_action';
	    actionKey: 'describe_prompt';
	    input: {
	      projectId: string;
	      kind: PromptDescriptionKind;
      shotId: string;
      versionId?: string;
    };
  };
};

const parseWorkflowRecipeMeta = (metadata?: Record<string, unknown> | null) => {
  const raw = metadata?.workflowRecipe;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  return {
    name: typeof item.name === 'string' ? item.name : null,
    label: typeof item.label === 'string' ? item.label : null,
    version: typeof item.version === 'string' ? item.version : null,
    video: item.video && typeof item.video === 'object' && !Array.isArray(item.video)
      ? item.video as Record<string, unknown>
      : null,
  };
};

const promptOverrideSummary = (state: Awaited<ReturnType<typeof getProjectConfigState>>['prompts'][keyof Awaited<ReturnType<typeof getProjectConfigState>>['prompts']]) => ({
  active: state.active,
  source: state.source,
  hash: state.hash,
  updatedAt: state.updatedAt,
  overrideId: state.overrideId,
  workflowRecipe: parseWorkflowRecipeMeta(state.metadata),
});

type MaybeResult<T> = { ok: true; value: T } | { ok: false; error: string };

const maybeRun = async <T>(fn: () => Promise<T> | T): Promise<MaybeResult<T>> => {
  try {
    return { ok: true, value: await fn() };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
};

const maybeError = <T>(result: MaybeResult<T>, fallback: string) => {
  if ('error' in result) return result.error;
  return fallback;
};

const summarizeComposition = (
  projectId: string,
  shotId: string,
  kind: PromptDescriptionKind,
  raw: any,
): PromptDescriptionSummary => {
  const composition = raw?.composition || null;
  const segments = Array.isArray(composition?.segments)
    ? composition.segments.map((segment: any) => ({
      slot: typeof segment.slot === 'string' ? segment.slot : null,
      label: segment.label || segment.slot || 'Segment',
      included: segment.included !== false,
      source: typeof segment.source === 'string' ? segment.source : null,
      editPath: typeof segment.editPath === 'string' ? segment.editPath : null,
      preview: compactText(typeof segment.text === 'string' ? segment.text : segment.value, 260),
    }))
    : [];
  const images = Array.isArray(composition?.images)
    ? composition.images.map((image: any) => ({
      ref: typeof image.ref === 'string' ? image.ref : null,
      role: image.role || image.label || null,
      assetId: image.assetId || null,
      source: image.source || null,
      included: image.included,
    }))
    : [];
  const versionId = raw?.versionId || null;
  return {
    kind,
    generatedAt: raw?.generatedAt || null,
    source: raw?.source || '',
    attemptId: raw?.attemptId || null,
    versionId,
    hasComposition: !!composition,
    note: raw?.note || '',
    segments,
    images,
	    params: composition?.params && typeof composition.params === 'object' ? composition.params : null,
	    inspectorAction: {
	      tool: 'run_action',
	      actionKey: 'describe_prompt',
	      input: {
	        projectId,
        kind,
        shotId,
        ...(kind === 'storyboard_render' && versionId ? { versionId } : {}),
      },
    },
  };
};

const shotRefKeyExcluded = (shot: ProjectShot, tab: 'storyboard' | 'video', rawKey: string) => {
  const excluded = shot.excludedRefs?.[tab] || [];
  return excluded.includes(rawKey) || excluded.includes(rawKey.replace(/^cast:|^env:/, ''));
};

const effectiveWorkflowModeSource = (project: Project, shot: ProjectShot) => {
  if (shot.workflowMode === 'storyboard' || shot.workflowMode === 'keyframe') return 'shot.workflowMode';
  if (project.videoModel?.startsWith('seedance')) return 'project.videoModel';
  if (shot.storyboardPrompt || shot.storyboardUrl || shot.storyboardLocked || shot.storyboardPromptStatus === 'loading' || shot.storyboardStatus === 'loading') {
    return 'shot storyboard state';
  }
  return 'engine default';
};

const videoSlotSummary = (shot: ProjectShot) => {
  const slots = shot.videoPromptSlots || {};
  const keys = ['includeFormat', 'includeShotBeat', 'includeRefs', 'includeCutPlan', 'includeAudio'] as const;
  return Object.fromEntries(keys.map((key) => [
    key,
    {
      value: typeof (slots as any)[key] === 'boolean' ? (slots as any)[key] : null,
      source: typeof (slots as any)[key] === 'boolean' ? 'shot.video_prompt_slots' : 'composer default',
      editPath: 'apply_shot_prompts.videoPromptSlots | Studio payload inspector',
    },
  ]));
};

const buildRecommendedNextActions = (args: {
  shot: ProjectShot;
  effectiveMode: 'storyboard' | 'keyframe';
  storyboardPlan: any;
  videoPlan: any;
  storyboardDescription?: PromptDescriptionSummary | null;
  videoDescription?: PromptDescriptionSummary | null;
}) => {
  const actions: string[] = [];
  const { shot, effectiveMode, storyboardPlan, videoPlan, storyboardDescription, videoDescription } = args;
  if (effectiveMode === 'storyboard') {
    if (!shot.storyboardPrompt) actions.push('Write the storyboard prompt and cut plan with run_action(apply_storyboard_prompts).');
    else if (shot.promptsStale || shot.storyboardPromptStatus === 'stale') actions.push('Review/rewrite the stale storyboard prompt before rendering.');
    if (!shot.storyboardUrl && storyboardPlan?.canRun) actions.push('Generate a storyboard board with start_job(generate_storyboard).');
    if (shot.storyboardUrl && !shot.storyboardLocked) actions.push('Review and lock the storyboard board with run_action(lock_storyboard), or refine/import a replacement.');
    if (shot.storyboardLocked && videoPlan?.canRun) actions.push('Dry-run video with run_action(generate_video, { dryRun: true }) before spending.');
    if (storyboardDescription && !storyboardDescription.hasComposition) actions.push('Regenerate/refine the board once if prompt payload provenance is needed; older/imported boards may predate composition capture.');
  } else {
    if (!shot.imageUrl) actions.push('Generate or import a keyframe before video.');
    if (!shot.motionPrompt || shot.motionPrompt === 'Cinematic camera movement') actions.push('Write a precise keyframe motion prompt with run_action(apply_video_prompt).');
    if (shot.imageUrl && videoPlan?.canRun) actions.push('Dry-run video with run_action(generate_video, { dryRun: true }) before spending.');
  }
  if (videoDescription && !videoDescription.hasComposition && shot.videoUrl) actions.push('The active video predates prompt composition capture; rerun dryRun or inspect asset history before diagnosing prompt causes.');
  if (shot.lastError) actions.push('Inspect the last error before retrying; change upstream input or provider after repeated failures.');
  return actions.slice(0, 8);
};

export const buildShotContext = async (project: Project, shotId: string) => {
  const castNames = namesById(project.cast);
  const environmentNames = namesById(project.environments);
  const preset = getPipelinePreset(project.presetKey);
  const workflow = getWorkflowRecipe(project.workflowKey || preset.workflowKey);
  const projectConfig = await getProjectConfigState(project);

  for (const [sceneIndex, scene] of project.scenes.entries()) {
    const shotIndex = scene.shots.findIndex((candidate) => candidate.id === shotId);
    if (shotIndex === -1) continue;
    const shot = scene.shots[shotIndex];
    const effectiveMode = shotWorkflowMode(project, shot);

    const [storyboardPlanResult, videoPlanResult, storyboardDescriptionResult, videoDescriptionResult] = await Promise.all([
      maybeRun(() => planGenerateStoryboard(project, shotId)),
      maybeRun(() => planGenerateVideo(project, shotId)),
      maybeRun(() => describePromptComposition(project, { kind: 'storyboard_render', shotId, versionId: shot.storyboardVersionId })),
      maybeRun(() => describePromptComposition(project, { kind: 'video', shotId })),
    ]);

    const storyboardDescription = storyboardDescriptionResult.ok
      ? summarizeComposition(project.id, shotId, 'storyboard_render', storyboardDescriptionResult.value)
      : null;
    const videoDescription = videoDescriptionResult.ok
      ? summarizeComposition(project.id, shotId, 'video', videoDescriptionResult.value)
      : null;
    const storyboardPlan = storyboardPlanResult.ok ? storyboardPlanResult.value : null;
    const videoPlan = videoPlanResult.ok ? videoPlanResult.value : null;

    return {
      kind: 'mirage.shot.context',
      generatedAt: new Date().toISOString(),
      project: {
        id: project.id,
        title: project.title,
        status: project.status,
        presetKey: preset.key,
        presetLabel: preset.label,
        workflowKey: workflow.key,
        workflowLabel: workflow.label,
        seedKind: project.seedKind || workflow.primarySeed,
        effectivePreferences: projectConfig.preferences.preferences,
        webUrl: webStudioUrl(project.id, { step: 'studio', shotId }),
      },
      scene: {
        id: scene.id,
        index: sceneIndex + 1,
        label: scene.sectionLabel,
        timeRange: `${scene.startTime || '?'}-${scene.endTime || '?'}`,
        narrativeDescription: compactText(scene.narrativeDescription, 500),
        lyrics: compactText(scene.lyrics, 400),
      },
      shot: {
        id: shot.id,
        label: shotLabel(sceneIndex, shotIndex),
        index: shotIndex + 1,
        durationSec: shot.duration,
        effectiveWorkflowMode: effectiveMode,
        effectiveWorkflowModeSource: effectiveWorkflowModeSource(project, shot),
        savedWorkflowMode: shot.workflowMode || 'auto',
        locked: !!shot.locked,
        promptsStale: !!shot.promptsStale,
        storyboardLocked: !!shot.storyboardLocked,
        statuses: {
          storyboardPrompt: shot.storyboardPromptStatus || 'idle',
          storyboard: shot.storyboardStatus || 'idle',
          image: shot.imageStatus || 'idle',
          video: shot.videoStatus || 'idle',
          audioPlanStale: !!shot.audioPlanStale,
        },
        baseHashes: {
          shotPrompts: shotPromptHash(shot),
          storyboardPrompt: storyboardPromptHash(shot),
          videoPrompt: videoPromptHash(shot),
          audioPlan: audioPlanHash(shot),
        },
        lastError: compactText(shot.lastError, 350),
      },
      promptState: {
        beat: {
          present: !!(shot.direction || shot.visualPrompt),
          preview: compactText(shot.direction || shot.visualPrompt, 500),
          source: shot.direction ? 'shots.direction' : 'shots.visual_prompt',
          editPath: 'apply_text_edits | apply_shot_prompts.direction',
        },
        storyboardPrompt: {
          present: !!shot.storyboardPrompt,
          status: shot.storyboardPromptStatus || 'idle',
          preview: compactText(shot.storyboardPrompt, 700),
          hash: storyboardPromptHash(shot),
          editPath: 'apply_storyboard_prompts',
        },
        cutPlan: {
          present: !!shot.storyboardCutPlan,
          preview: compactText(shot.storyboardCutPlan, 700),
          editPath: 'apply_storyboard_prompts | refine_storyboard_image replan',
        },
        keyframeMotionPrompt: {
          present: !!shot.motionPrompt && shot.motionPrompt !== 'Cinematic camera movement',
          preview: compactText(shot.motionPrompt, 500),
          hash: videoPromptHash(shot),
          editPath: 'apply_video_prompt',
        },
      },
      workflowConfig: {
        storyboard: promptOverrideSummary(projectConfig.prompts.storyboard),
        video: promptOverrideSummary(projectConfig.prompts.video),
        videoPromptSlots: videoSlotSummary(shot),
      },
      refs: {
        style: {
          assetId: project.styleAssetId || null,
          url: project.styleAssetUrl || null,
          includedByDefault: !!project.styleAssetId,
        },
        cast: (shot.castIds || []).map((id) => ({
          id,
          name: castNames.get(id) || id,
          hasReference: !!project.cast.find((member) => member.id === id)?.referenceImageUrl,
          referenceAssetId: project.cast.find((member) => member.id === id)?.referenceAssetId || null,
          storyboardExcluded: shotRefKeyExcluded(shot, 'storyboard', `cast:${id}`),
          videoExcluded: shotRefKeyExcluded(shot, 'video', `cast:${id}`),
        })),
        environment: shot.environmentId ? {
          id: shot.environmentId,
          name: environmentNames.get(shot.environmentId) || shot.environmentId,
          hasReference: !!project.environments.find((environment) => environment.id === shot.environmentId)?.referenceImageUrl,
          referenceAssetId: project.environments.find((environment) => environment.id === shot.environmentId)?.referenceAssetId || null,
          storyboardExcluded: shotRefKeyExcluded(shot, 'storyboard', `env:${shot.environmentId}`),
          videoExcluded: shotRefKeyExcluded(shot, 'video', `env:${shot.environmentId}`),
        } : null,
        previousStoryboard: {
          usePrevStoryboardRef: !!shot.usePrevStoryboardRef,
          includePrevCutPlan: shot.includePrevCutPlan,
        },
      },
      assets: {
        startFrameUrl: shot.imageUrl || null,
        storyboardUrl: shot.storyboardUrl || null,
        storyboardAssetId: shot.storyboardAssetId || null,
        storyboardVersionId: shot.storyboardVersionId || null,
        endFrameUrl: shot.endImageUrl || null,
        extractedLastFrameUrl: shot.extractedLastFrameUrl || null,
        videoUrl: shot.videoUrl || null,
      },
	      promptPayloads: {
	        storyboardRender: storyboardDescription || {
	          kind: 'storyboard_render',
	          hasComposition: false,
	          note: maybeError(storyboardDescriptionResult, 'No storyboard render prompt payload captured.'),
	        },
	        video: videoDescription || {
	          kind: 'video',
	          hasComposition: false,
	          note: maybeError(videoDescriptionResult, 'No video prompt payload captured.'),
	        },
	      },
      eligibility: {
        storyboard: storyboardPlan ? {
          canRun: storyboardPlan.canRun,
          prerequisites: storyboardPlan.prerequisites,
          provider: storyboardPlan.provider,
          estimatedCost: storyboardPlan.estimatedCost,
          willOverwrite: storyboardPlan.willOverwrite,
	        } : { canRun: false, prerequisites: [maybeError(storyboardPlanResult, 'Unknown storyboard planning error.')] },
        video: videoPlan ? {
          canRun: videoPlan.canRun,
          prerequisites: videoPlan.prerequisites,
          mode: videoPlan.mode,
          model: videoPlan.model,
          providerDuration: videoPlan.providerDuration,
          estimatedCost: videoPlan.estimatedCost,
          willOverwrite: videoPlan.willOverwrite,
	        } : { canRun: false, prerequisites: [maybeError(videoPlanResult, 'Unknown video planning error.')] },
      },
      recommendedNextActions: buildRecommendedNextActions({
        shot,
        effectiveMode,
        storyboardPlan,
        videoPlan,
        storyboardDescription,
        videoDescription,
      }),
      exactPayloads: {
	        note: 'Exact full prompt bodies are intentionally not embedded here. Use describe_prompt for one payload when needed.',
	        storyboardRender: {
	          tool: 'run_action',
	          actionKey: 'describe_prompt',
	          input: {
	            projectId: project.id,
            shotId,
            kind: 'storyboard_render',
            ...(shot.storyboardVersionId ? { versionId: shot.storyboardVersionId } : {}),
          },
	        },
	        video: {
	          tool: 'run_action',
	          actionKey: 'describe_prompt',
	          input: {
            projectId: project.id,
            shotId,
            kind: 'video',
          },
        },
      },
    };
  }

  throw new Error(`Shot not found in project: ${shotId}`);
};
