import { v4 as uuidv4 } from 'uuid';
import { selectOne, selectAll, insertRow, updateRows, findShot, incrementColumn } from '../database.js';
import { readAsBase64, mimeFromExt, storageUrl } from '../storage.js';
import { SEGMIND_MODELS, SegmindModelKey } from './segmind.js';
import { generateVideoWithFallback } from './video-provider.js';
import { extractAudioSegment, extractLastFrame } from './ffmpeg.js';
import { refreshChainedShotPrompt } from './claude.js';
import { buildSeedanceStoryboardVideoPrompt } from './seedance-storyboard-rd.js';
import { loadStoryboardContext, getShotExcludedRefs } from './storyboard.js';
import { logCall, buildContextChain } from '../xray.js';
import type { XRayReference } from '../xray.js';
import { parseTimestamp } from '../routes/scope-helpers.js';
import { getProjectPreferencesState, getProjectPromptOverride } from './projectConfig.js';
import { createGenerationAttempt, updateGenerationAttempt } from './generationAttempts.js';

const parseJson = <T>(value: any, fallback: T): T => {
  if (!value) return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

const formatTimecode = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const selectProviderDuration = (durations: readonly number[], requestedRaw: any): number => {
  const sorted = [...durations].sort((a, b) => a - b);
  const requested = Number(requestedRaw || sorted[0] || 4);
  return sorted.find(d => d >= requested) ?? sorted[sorted.length - 1] ?? requested;
};

type VideoGenerationRef = {
  type?: string;
  id?: string;
};

type DialogueLine = {
  id?: string;
  characterId?: string;
  text?: string;
  order?: number;
  startMs?: number;
  endMs?: number;
  targetSec?: number;
  ttsAssetId?: string | null;
  ttsStatus?: string;
  ttsDurationSec?: number;
};

type AudioPlan = {
  dialogueStrategy?: 'lipsync' | 'overlay';
  dialogue?: DialogueLine[];
  soundNotes?: string;
};
type DialogueVideoMode = 'lipsync' | 'overlay';

const dialogueVideoMode = (project: any): DialogueVideoMode => {
  const brief = parseJson<Record<string, any>>(project?.project_brief, {});
  return brief.dialogueVideoMode === 'lipsync' ? 'lipsync' : 'overlay';
};

export type GenerateShotVideoOptions = {
  promptOverride?: string;
  refs?: VideoGenerationRef[];
  nativeAudioMode?: 'auto' | 'off' | 'on';
  modelOverride?: {
    videoModel?: string;
  };
};

const structuredVideoError = (code: string, message: string, details: Record<string, any>, statusCode = 400) => {
  const error = new Error(JSON.stringify({ code, message, ...details })) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
};

const lineTimingPhrase = (line: DialogueLine): string => {
  const startMs = Number(line.startMs);
  const endMs = Number(line.endMs);
  const durationMs = Number(line.ttsDurationSec || line.targetSec || 0) * 1000;
  const hasStart = Number.isFinite(startMs) && startMs >= 0;
  const computedEnd = Number.isFinite(endMs) && endMs > startMs
    ? endMs
    : hasStart && Number.isFinite(durationMs) && durationMs > 0
      ? startMs + durationMs
      : null;
  if (!hasStart) return '';
  const fmt = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
  return computedEnd ? ` from ${fmt(startMs)} to ${fmt(computedEnd)}` : ` starting at ${fmt(startMs)}`;
};

export const generateShotVideo = async (projectId: string, shotId: string, opts: GenerateShotVideoOptions = {}) => {
  const project = await selectOne('projects', { id: projectId });
  if (!project) {
    const error = new Error('Project not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const shot = await selectOne('shots', { id: shotId });
  if (!shot) {
    const error = new Error('Shot not found') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  const projectPreferences = await getProjectPreferencesState(project as any);
  const videoModelKey = (opts.modelOverride?.videoModel || projectPreferences.preferences.videoModel || 'veo-3.1-fast') as SegmindModelKey;
  const modelSpec = SEGMIND_MODELS[videoModelKey] || SEGMIND_MODELS['veo-3.1-fast'];
  const estimatedProviderDuration = selectProviderDuration(modelSpec.durations, shot.duration);
  const estimatedVideoCost = Number((modelSpec.costPerSec * estimatedProviderDuration).toFixed(3));
  const generationAttemptId = uuidv4();
  const forcedKeyframe = shot.workflow_mode === 'keyframe';
  const forcedStoryboard = shot.workflow_mode === 'storyboard';
  const useStoryboardMode = !forcedKeyframe && modelSpec.family === 'seedance' && !!shot.storyboard_locked && !!shot.storyboard_asset_id;

  if (forcedStoryboard && !useStoryboardMode) {
    const error = new Error('Shot workflow is storyboard, but no locked storyboard asset is available') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  if (!shot.image_asset_id && !useStoryboardMode) {
    const error = new Error('Shot has no image yet') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  const imageAsset = shot.image_asset_id ? await selectOne('assets', { id: shot.image_asset_id }) : null;
  if (!imageAsset && !useStoryboardMode) {
    const error = new Error('Image asset not found') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  const storyboardAsset = useStoryboardMode ? await selectOne('assets', { id: shot.storyboard_asset_id }) : null;
  if (useStoryboardMode && !storyboardAsset) {
    const error = new Error('Locked storyboard asset not found') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  const storyboardContext = useStoryboardMode ? await loadStoryboardContext(project.id, shot.id) : null;
  const storyboardVersion = useStoryboardMode && shot.storyboard_version_id
    ? await selectOne('storyboard_versions', { id: shot.storyboard_version_id, shot_id: shot.id, project_id: project.id })
    : null;
  const storyboardVersionMeta = parseJson<{ cutPlanText?: string | null }>(storyboardVersion?.metadata, {});
  const storyboardCutPlanText = String(shot.storyboard_cut_plan || '').trim() || storyboardVersionMeta.cutPlanText || null;

  const scene = await selectOne('scenes', { id: shot.scene_id });
  const shotCastIds = JSON.parse(shot.cast_ids || '[]');
  const cast = await selectAll('cast_members', { project_id: projectId });
  const activeCast = cast.filter((c: any) => shotCastIds.includes(c.id));
  const storyboardSentRefs: { label: string; filePath: string }[] = [];
  const storyboardAudioRefs: XRayReference[] = [];
  const t0 = Date.now();
  let finalVideoPromptForTrace = shot.motion_prompt || 'Cinematic camera movement';

  try {
    await updateRows('shots', { id: shot.id }, { video_status: 'loading' });

    const veoPromptParts: string[] = [];
    if (shot.motion_prompt && shot.motion_prompt !== 'Cinematic camera movement') {
      veoPromptParts.push(shot.motion_prompt);
    }

    const aspect = (project.aspect_ratio === '9:16' ? '9:16' : '16:9') as '16:9' | '9:16';
    const resolution = (project.video_resolution === '1080p' ? '1080p' : '720p') as '720p' | '1080p';

    const videoFrontendRefs = opts.refs;
    const referenceImagePaths: string[] = [];
    const resolveVideoAsset = async (id: string) => { const a = await selectOne('assets', { id }); return a?.file_path; };

    if (useStoryboardMode && storyboardAsset?.file_path) {
      referenceImagePaths.push(storyboardAsset.file_path);
    }

    if (videoFrontendRefs && !useStoryboardMode) {
      const allCast = await selectAll('cast_members', { project_id: projectId });
      const allEnvs = await selectAll('environments', { project_id: projectId });
      for (const ref of videoFrontendRefs) {
        if (referenceImagePaths.length >= 9) break;
        if (ref.type === 'cast' && ref.id) {
          const c = allCast.find((m: any) => m.id === ref.id);
          if (c?.reference_asset_id) { const p = await resolveVideoAsset(c.reference_asset_id); if (p) referenceImagePaths.push(p); }
        } else if (ref.type === 'env' && ref.id) {
          const e = allEnvs.find((en: any) => en.id === ref.id);
          if (e?.reference_asset_id) { const p = await resolveVideoAsset(e.reference_asset_id); if (p) referenceImagePaths.push(p); }
        } else if (ref.type === 'uploaded' && ref.id) {
          const p = await resolveVideoAsset(ref.id); if (p) referenceImagePaths.push(p);
        }
      }
    } else {
      if (useStoryboardMode && storyboardContext) {
        const excludedVideoKeys = getShotExcludedRefs(shot).video;
        const allowedRefs = excludedVideoKeys.length
          ? storyboardContext.refMeta.filter((r) => !r.excludableKey || !excludedVideoKeys.includes(r.excludableKey))
          : storyboardContext.refMeta;
        for (const ref of allowedRefs) {
          if (referenceImagePaths.length >= 9) break;
          referenceImagePaths.push(ref.filePath);
          storyboardSentRefs.push({ label: ref.label, filePath: ref.filePath });
        }
      } else {
        for (const c of activeCast) {
          if (c.reference_asset_id && referenceImagePaths.length < 9) {
            const refAsset = await selectOne('assets', { id: c.reference_asset_id });
            if (refAsset) referenceImagePaths.push(refAsset.file_path);
          }
        }
        if (shot.environment_id && referenceImagePaths.length < 9) {
          const env = await selectOne('environments', { id: shot.environment_id });
          if (env?.reference_asset_id) {
            const envAsset = await selectOne('assets', { id: env.reference_asset_id });
            if (envAsset) referenceImagePaths.push(envAsset.file_path);
          }
        }
        const shotRefAssets = await selectAll('assets', { shot_id: shot.id, category: 'shot_ref' });
        for (const sra of shotRefAssets) {
          if (referenceImagePaths.length < 9) referenceImagePaths.push(sra.file_path);
        }
      }
    }

    let endImagePath: string | undefined;
    if (shot.end_image_asset_id && modelSpec.supportsLastFrame) {
      const endAsset = await selectOne('assets', { id: shot.end_image_asset_id });
      if (endAsset) endImagePath = endAsset.file_path;
    }

    if (!useStoryboardMode && referenceImagePaths.length > 0 && modelSpec.supportsRefs) {
      const refLabels: string[] = [];
      const castWithRefs = activeCast.filter((c: any) => c.reference_asset_id);
      castWithRefs.forEach((c: any) => refLabels.push(`Maintain ${c.name}'s appearance from reference`));
      if (shot.environment_id) {
        const env = await selectOne('environments', { id: shot.environment_id });
        if (env?.reference_asset_id) refLabels.push(`Maintain ${env.name} setting from reference`);
      }
      if (refLabels.length) veoPromptParts.push(refLabels.join('. '));
    }

    const audioPlan = parseJson<AudioPlan | null>(shot.audio_plan, null);
    const projectDialogueMode = dialogueVideoMode(project);
    const soundNotes = String(audioPlan?.soundNotes || '').trim().slice(0, 500);
    const dialogueLines = [...(audioPlan?.dialogue || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    const hasDialogue = dialogueLines.length > 0;
    const planWantsLipsync = projectDialogueMode === 'lipsync' && hasDialogue;
    const nativeAudioMode = opts.nativeAudioMode || 'auto';
    const seedanceNativeAudio = modelSpec.family === 'seedance'
      && nativeAudioMode !== 'off'
      && (nativeAudioMode === 'on' || hasDialogue || !!soundNotes);
    const visibleSoundCue = soundNotes
      ? seedanceNativeAudio
        ? `Native audio cue: generate synchronized sound only for this explicit cue: ${soundNotes}`
        : `Visible sound cue to imply through action only, not generated audio: ${soundNotes}`
      : '';
    if (visibleSoundCue) {
      veoPromptParts.push(visibleSoundCue);
    }
    let dialoguePerformanceCue = '';
    if (planWantsLipsync && !useStoryboardMode) {
      const castNameById = new Map(activeCast.map((c: any) => [c.id, c.name || 'Speaker']));
      const dialogueBrief = dialogueLines
        .map((line) => {
          const speaker = castNameById.get(line.characterId || '') || 'Speaker';
          return `${speaker}${lineTimingPhrase(line)}: "${String(line.text || '').trim()}"`;
        })
        .filter(Boolean)
        .join(' ');
      if (dialogueBrief) {
        dialoguePerformanceCue = seedanceNativeAudio
          ? `Native audio + lip-sync performance: generate audible synchronized speech for these exact lines, with visible speakers naturally speaking them using believable mouth movement and acting timed to the shot. Do not add subtitles or readable text. ${dialogueBrief}`
          : `Native lip-sync performance: visible speakers should naturally speak these lines with believable mouth movement and acting timed to the shot. Do not add subtitles or readable text. ${dialogueBrief}`;
        veoPromptParts.push(dialoguePerformanceCue);
      }
    }
    if (projectDialogueMode === 'overlay' && hasDialogue) {
      const castNameById = new Map(activeCast.map((c: any) => [c.id, c.name || 'Speaker']));
      const dialogueBrief = dialogueLines
        .map((line) => {
          const speaker = castNameById.get(line.characterId || '') || 'Speaker';
          return `${speaker}${lineTimingPhrase(line)}: "${String(line.text || '').trim()}"`;
        })
        .filter(Boolean)
        .join(' ');
      if (dialogueBrief) {
        dialoguePerformanceCue = seedanceNativeAudio
          ? `Native audio performance: generate audible synchronized speech for these exact lines, with visible speakers naturally saying them using believable mouth movement and acting timed to the shot. The final edit may overlay generated TTS, so keep the native voice clean and natural. Do not add subtitles or readable text. ${dialogueBrief}`
          : `Dialogue performance: visible speakers should naturally say these lines with mouth movement and acting timed to the shot. The final edit may overlay generated TTS, so do not add subtitles or readable text. ${dialogueBrief}`;
        veoPromptParts.push(dialoguePerformanceCue);
      }
    }

    const storyboardPromptBase = useStoryboardMode
      ? buildSeedanceStoryboardVideoPrompt(storyboardContext!.input, 'board_plus_timing', {
        cutPlanText: storyboardCutPlanText,
        refs: storyboardSentRefs.map((ref) => ({ label: ref.label })),
        lipsyncEnabled: !!shot.lipsync_enabled && !planWantsLipsync,
        nativeAudioEnabled: seedanceNativeAudio,
      })
      : '';
    const projectVideoOverride = useStoryboardMode
      ? await getProjectPromptOverride(project.id, 'video')
      : null;
    const storyboardPrompt = projectVideoOverride
      ? `${projectVideoOverride.trim()}\n\nBase storyboard video prompt:\n${storyboardPromptBase}`
      : storyboardPromptBase;
    const keyframePrompt = opts.promptOverride?.trim()
      ? [opts.promptOverride.trim(), visibleSoundCue, dialoguePerformanceCue].filter(Boolean).join('\n\n')
      : veoPromptParts.join('. ');
    const veoPrompt = useStoryboardMode
      ? [storyboardPrompt, visibleSoundCue, dialoguePerformanceCue].filter(Boolean).join('\n\n')
      : keyframePrompt;
    finalVideoPromptForTrace = veoPrompt || finalVideoPromptForTrace;
    console.log(`  [shot ${shot.id} video] model=${videoModelKey} | ${veoPrompt.substring(0, 120)}...`);

    const legacySongLipsync = useStoryboardMode && shot.lipsync_enabled && !planWantsLipsync;
    const referenceAudioPaths: string[] = [];
    let referenceAudioAssetId: string | null = null;
    let referenceAudioMode: 'source_audio_lipsync' | null = null;

    if (planWantsLipsync) {
      if (modelSpec.family !== 'seedance') {
        throw structuredVideoError(
          'lipsync_requires_seedance',
          'Lip-sync dialogue shots require a Seedance video model.',
          { shotId: shot.id, model: videoModelKey },
        );
      }
    } else if (legacySongLipsync) {
      if (!project.audio_path) {
        throw new Error('Lip-sync is enabled for this shot, but the project has no source audio.');
      }
      const sceneShots = await selectAll('shots', { scene_id: shot.scene_id }, { orderBy: 'sort_order' });
      const priorDuration = sceneShots
        .filter((candidate: any) => Number(candidate.sort_order || 0) < Number(shot.sort_order || 0))
        .reduce((sum: number, candidate: any) => sum + Number(candidate.duration || 0), 0);
      const shotStartSec = parseTimestamp(scene?.start_time || '0:00') + priorDuration;
      const shotDurationSec = Number(shot.duration || storyboardContext?.input.clipDuration || modelSpec.durations[0] || 5);
      const audioPath = await extractAudioSegment(project.audio_path, shotStartSec, shotDurationSec);
      referenceAudioPaths.push(audioPath);
      referenceAudioAssetId = uuidv4();
      referenceAudioMode = 'source_audio_lipsync';
      await insertRow('assets', {
        id: referenceAudioAssetId,
        project_id: project.id,
        shot_id: shot.id,
        category: 'shot_audio_ref',
        file_path: audioPath,
        metadata: JSON.stringify({
          sourceAudioPath: project.audio_path,
          startSec: shotStartSec,
          durationSec: shotDurationSec,
          purpose: 'seedance_lipsync_reference',
        }),
      });
      storyboardAudioRefs.push({
        type: 'audio',
        label: `Shot audio reference (${formatTimecode(shotStartSec)}-${formatTimecode(shotStartSec + shotDurationSec)})`,
        url: storageUrl(audioPath),
      });
    }

    await createGenerationAttempt({
      id: generationAttemptId,
      projectId: project.id,
      shotId: shot.id,
      userId: project.user_id || null,
      stage: 'generate-shot-video',
      provider: 'segmind',
      model: videoModelKey in SEGMIND_MODELS ? videoModelKey : 'veo-3.1-fast',
      estimatedCost: estimatedVideoCost,
      requestSummary: {
        mode: useStoryboardMode ? 'storyboard' : 'keyframe',
        durationSec: estimatedProviderDuration,
        resolution,
        aspectRatio: aspect,
        hasPromptOverride: !!opts.promptOverride?.trim(),
        referenceImageCount: modelSpec.supportsRefs ? referenceImagePaths.length : 0,
        referenceAudioCount: modelSpec.family === 'seedance' ? referenceAudioPaths.length : 0,
        nativeAudioMode,
        generateAudio: seedanceNativeAudio,
        storyboardAssetId: useStoryboardMode ? shot.storyboard_asset_id : null,
        startImageAssetId: useStoryboardMode ? null : shot.image_asset_id,
      },
    });

    const result = await generateVideoWithFallback(useStoryboardMode ? undefined : imageAsset!.file_path, veoPrompt, {
      endImagePath: useStoryboardMode ? undefined : endImagePath,
      referenceImagePaths: modelSpec.supportsRefs ? referenceImagePaths : undefined,
      referenceAudioPaths: modelSpec.family === 'seedance' ? referenceAudioPaths : undefined,
      generateAudio: seedanceNativeAudio,
      aspectRatio: aspect,
      resolution,
      durationSec: shot.duration,
      modelKey: videoModelKey in SEGMIND_MODELS ? videoModelKey : 'veo-3.1-fast',
      generationAttemptId,
    });
    const videoPath = result.videoPath;
    const costEstimate = modelSpec.costPerSec * result.durationSec;
    const modelId = result.modelId;

    const durationMs = Date.now() - t0;
    const assetId = uuidv4();

    let extractedAssetId: string | null = null;
    let extractedFramePath: string | null = null;
    try {
      const framePath = await extractLastFrame(videoPath);
      extractedFramePath = framePath;
      extractedAssetId = uuidv4();
      await insertRow('assets', { id: extractedAssetId, project_id: project.id, shot_id: shot.id, category: 'shot_extracted_last_frame', file_path: framePath });
    } catch (err: any) {
      console.warn(`  [shot ${shot.id}] last-frame extraction failed: ${err.message}`);
    }

    const videoMetadata = JSON.stringify({
      extracted_last_frame_asset_id: extractedAssetId,
      reference_audio_asset_id: referenceAudioAssetId,
      reference_audio_mode: referenceAudioMode,
      dialogue_strategy: projectDialogueMode,
      native_audio_generated: seedanceNativeAudio,
    });
    await insertRow('assets', { id: assetId, project_id: project.id, shot_id: shot.id, category: 'shot_video', file_path: videoPath, metadata: videoMetadata });
    await updateGenerationAttempt(generationAttemptId, {
      outputAssetIds: extractedAssetId ? [assetId, extractedAssetId] : [assetId],
      durationMs: Date.now() - t0,
    });

    const shotNow = await selectOne('shots', { id: shot.id });
    const clearVideoError = shotNow?.image_status !== 'error' && shotNow?.end_image_status !== 'error';
    await updateRows('shots', { id: shot.id }, {
      video_asset_id: assetId,
      video_status: 'success',
      ...(clearVideoError ? { last_error: null } : {}),
      extracted_last_frame_asset_id: extractedAssetId,
    });

    if (!useStoryboardMode && extractedFramePath) {
      try {
        const nextShot = await findShot(shot.scene_id, shot.sort_order + 1, { continuity_from: 'prev_shot', locked: 0 });
        if (nextShot && nextShot.visual_prompt) {
          const nextCastIds: string[] = JSON.parse(nextShot.cast_ids || '[]');
          const nextCast = cast.filter((c: any) => nextCastIds.includes(c.id));
          const nextEnv = nextShot.environment_id
            ? await selectOne('environments', { id: nextShot.environment_id })
            : null;
          const prevFrameBase64 = await readAsBase64(extractedFramePath);
          const prevFrameMime = mimeFromExt(extractedFramePath);
          const refreshed = await refreshChainedShotPrompt({
            prevFrameBase64,
            prevFrameMime,
            shotDirection: nextShot.direction || '',
            currentVisualPrompt: nextShot.visual_prompt || '',
            currentMotionPrompt: nextShot.motion_prompt || 'Cinematic camera movement',
            characterNames: nextCast.map((c: any) => c.name),
            environmentName: nextEnv?.name,
            textProvider: projectPreferences.preferences.textProvider,
          });
          await updateRows('shots', { id: nextShot.id }, {
            visual_prompt: refreshed.visualPrompt,
            motion_prompt: refreshed.motionPrompt,
            refined_from_prev_frame: 1,
            continuity_description: null,
            prompts_stale: false,
          });
          await logCall({
            projectId: project.id,
            stage: 'refresh-chained-shot',
            model: 'claude-sonnet-4-6',
            prompt: `Chain refresh for shot ${nextShot.id} using prev shot ${shot.id}'s last frame`,
            referenceInputs: [{ type: 'image', label: 'Prev extracted last frame', url: storageUrl(extractedFramePath) }],
            contextChain: await buildContextChain(project.id),
            responseSummary: `Refreshed: "${refreshed.visualPrompt.substring(0, 100)}..."`,
            durationMs: 0,
            costEstimate: 0.01,
          });
          console.log(`  [shot ${shot.id}] next shot ${nextShot.id} prompt refreshed from extracted frame`);
        }
      } catch (err: any) {
        console.warn(`  [shot ${shot.id}] chain refresh failed: ${err.message}`);
      }
    }

    await logCall({
      projectId: project.id,
      stage: 'generate-shot-video',
      model: modelId,
      prompt: veoPrompt,
      referenceInputs: useStoryboardMode && storyboardAsset
        ? [
          { type: 'image' as const, label: 'Locked numbered storyboard', url: storageUrl(storyboardAsset.file_path) },
          ...storyboardSentRefs.map((ref) => ({ type: 'image' as const, label: ref.label, url: storageUrl(ref.filePath) })),
          ...storyboardAudioRefs,
        ]
        : imageAsset
          ? [
            { type: 'image' as const, label: 'Start keyframe', url: storageUrl(imageAsset.file_path) },
            ...storyboardAudioRefs,
          ]
          : [],
      contextChain: await buildContextChain(project.id),
      responseSummary: `Video generated via ${result.provider} (${modelId}): ${videoPath}${extractedAssetId ? ' (last frame extracted)' : ''}`,
      outputAssetIds: extractedAssetId ? [assetId, extractedAssetId] : [assetId],
      durationMs,
      costEstimate,
    });

    await incrementColumn('projects', { id: projectId }, 'cost_estimate', costEstimate);
    await updateRows('projects', { id: projectId }, { updated_at: new Date().toISOString() });

    return {
      assetId,
      videoUrl: storageUrl(videoPath),
      videoPath,
      extractedLastFrameAssetId: extractedAssetId,
      extractedLastFrameUrl: extractedFramePath ? storageUrl(extractedFramePath) : null,
      model: modelId,
      provider: result.provider,
      durationSec: result.durationSec,
      costEstimate,
      mode: useStoryboardMode ? 'storyboard' : 'keyframe',
    };
  } catch (err: any) {
    console.error(`[shot ${shot.id}] Video gen failed:`, err);
    const durationMs = Date.now() - t0;
    const chargeStatus = err?.chargeStatus || 'not_recorded';
    const provider = err?.provider || 'segmind';
    const errorModel = err?.modelId || videoModelKey;
    const estimatedCostUsd = Number(err?.estimatedCostUsd || (
      ['provider_completed_ingest_failed', 'provider_outcome_unknown', 'provider_accepted_pending'].includes(chargeStatus) ? estimatedVideoCost : 0
    ));
    const retryWarning = err?.retryWarning || (['charge_unknown', 'provider_outcome_unknown', 'provider_accepted_pending'].includes(chargeStatus)
      ? 'Retry may spend again because the provider request outcome is unknown.'
      : null);
    if (chargeStatus) {
      (err as any).chargeStatus = chargeStatus;
      (err as any).provider = provider;
      (err as any).modelId = errorModel;
      (err as any).estimatedCostUsd = estimatedCostUsd;
      if (retryWarning) (err as any).retryWarning = retryWarning;
    }
    await logCall({
      projectId: project.id,
      stage: 'generate-shot-video',
      model: errorModel,
      prompt: finalVideoPromptForTrace,
      referenceInputs: useStoryboardMode && storyboardAsset
        ? [
          { type: 'image' as const, label: 'Locked numbered storyboard', url: storageUrl(storyboardAsset.file_path) },
          ...storyboardSentRefs.map((ref) => ({ type: 'image' as const, label: ref.label, url: storageUrl(ref.filePath) })),
          ...storyboardAudioRefs,
        ]
        : imageAsset
          ? [
            { type: 'image' as const, label: 'Start keyframe', url: storageUrl(imageAsset.file_path) },
            ...storyboardAudioRefs,
          ]
          : [],
      contextChain: await buildContextChain(project.id),
      responseSummary: `Video generation failed. Provider: ${provider}. Charge status: ${chargeStatus}. Estimated risk: $${estimatedCostUsd.toFixed(3)}.${retryWarning ? ` ${retryWarning}` : ''}`,
      durationMs,
      costEstimate: ['charge_unknown', 'provider_outcome_unknown', 'provider_accepted_pending', 'provider_completed_ingest_failed'].includes(chargeStatus) ? estimatedCostUsd : 0,
      error: err.message,
    });
    await updateRows('shots', { id: shot.id }, { video_status: 'error', last_error: err.message?.slice(0, 500) || 'Unknown error' });
    throw err;
  }
};
