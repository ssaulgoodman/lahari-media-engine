import { getProjectConfigState } from '../projectConfig.js';
import { getPipelinePreset, getWorkflowRecipe } from '../../presets.js';
import { allToolsForProject, availableTools, blockedTools } from '../../tools/registry.js';
import {
  compactText,
  conceptHash,
  deriveDirectorDiagnosis,
  listProjectRenders,
  namesById,
  recommendedActions,
  scriptContentHash,
  shotPromptHash,
  storyboardPromptHash,
  styleDirectionHash,
  statusCounts,
  usesStoryboardWorkflow,
  videoPromptHash,
  webStudioUrl,
  type Project,
} from './core.js';

const summarizeAudioPlan = (audioPlan: any) => {
  if (!audioPlan) return null;
  return {
    dialogueStrategy: audioPlan.dialogueStrategy || 'overlay',
    soundNotes: compactText(audioPlan.soundNotes, 350),
    dialogue: Array.isArray(audioPlan.dialogue)
      ? audioPlan.dialogue.map((line: any) => ({
        id: line.id,
        characterId: line.characterId,
        text: compactText(line.text, 350),
        order: line.order,
        targetSec: line.targetSec,
        ttsAssetId: line.ttsAssetId || null,
        ttsAssetUrl: line.ttsAssetUrl || null,
        ttsStatus: line.ttsStatus || 'pending',
        ttsError: compactText(line.ttsError, 220),
        ttsCharCount: line.ttsCharCount,
        ttsDurationSec: line.ttsDurationSec,
      }))
      : [],
  };
};

const buildAudioPhasePacket = (project: Project) => {
  const hasAudioTools = allToolsForProject(project).some((tool) => tool.surface === 'asset:audio');
  if (!hasAudioTools) {
    return {
      state: 'skipped',
      totalDialogueLines: 0,
      pendingTtsLineCount: 0,
      missingVoices: [],
      audioPlanStaleShotIds: [],
    };
  }

  const referencedCastIds = new Set<string>();
  let totalDialogueLines = 0;
  let pendingTtsLineCount = 0;
  const audioPlanStaleShotIds: string[] = [];

  for (const scene of project.scenes) {
    for (const shot of scene.shots) {
      if (shot.audioPlanStale) audioPlanStaleShotIds.push(shot.id);
      const dialogue = shot.audioPlan?.dialogue || [];
      totalDialogueLines += dialogue.length;
      for (const line of dialogue as any[]) {
        if (line.characterId) referencedCastIds.add(line.characterId);
        if (line.ttsStatus !== 'success' || !line.ttsAssetId) pendingTtsLineCount += 1;
      }
    }
  }

  const missingVoices = project.cast
    .filter((member) => referencedCastIds.has(member.id) && !member.voiceId)
    .map((member) => ({ id: member.id, name: member.name }));

  const state = totalDialogueLines === 0
    ? 'not_started'
    : audioPlanStaleShotIds.length > 0
      ? 'stale'
      : missingVoices.length > 0 || pendingTtsLineCount > 0
        ? 'needs_tts'
        : 'ready';

  return {
    state,
    totalDialogueLines,
    pendingTtsLineCount,
    missingVoices,
    audioPlanStaleShotIds,
  };
};

export const buildProjectPacket = async (project: Project) => {
  const castNames = namesById(project.cast);
  const environmentNames = namesById(project.environments);
  const counts = statusCounts(project);
  const renders = await listProjectRenders(project.id);
  const projectConfig = await getProjectConfigState(project);
  const preferences = projectConfig.preferences.preferences;
  const preset = getPipelinePreset(project.presetKey);
  const workflow = getWorkflowRecipe(project.workflowKey || preset.workflowKey);
  const audioPhase = buildAudioPhasePacket(project);
  const available = availableTools(project);
  const blocked = blockedTools(project);

  return {
    kind: 'mirage.project.packet',
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
      imageModel: preferences.imageModel,
      storyboardProvider: preferences.storyboardProvider,
      videoModel: preferences.videoModel,
      textProvider: preferences.textProvider,
      aspectRatio: project.aspectRatio,
      videoResolution: project.videoResolution,
      targetDuration: project.targetDuration,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      webUrl: webStudioUrl(project.id, { step: 'studio' }),
    },
    baseHashes: {
      concept: conceptHash(project.lockedConcept),
      script: scriptContentHash(project),
      style: styleDirectionHash(project),
    },
    source: {
      acceptedSeeds: workflow.acceptedSeeds,
      workflowSummary: workflow.summary,
      sourceRules: preset.source.rules,
      projectBrief: project.projectBrief,
      sourcePayload: project.sourcePayload,
      audioPath: project.audioPath,
      songType: project.songType,
      isNarrative: project.isNarrative,
      isMeditative: project.isMeditative,
      meaning: compactText(project.meaning, 900),
      lyricsPreview: compactText(project.lyrics, 900),
      musicalStructure: project.musicalStructure.map((section: any) => ({
        label: section.label,
        startTime: section.startTime,
        endTime: section.endTime,
        energyLevel: section.energyLevel,
        description: compactText(section.description, 180),
      })),
    },
    concept: {
      locked: project.lockedConcept,
      optionCount: project.conceptOptions.length,
    },
    style: {
      description: compactText(project.styleDescription, 700),
      assetId: project.styleAssetId || null,
      assetUrl: project.styleAssetUrl,
      explorationSlots: project.styleExploration?.slots?.map((slot: any) => ({
        id: slot.id,
        title: slot.title,
        description: compactText(slot.description, 300),
        imageUrl: slot.imageUrl,
      })) || [],
    },
    references: {
      cast: project.cast.map((member) => ({
        id: member.id,
        name: member.name,
        description: compactText(member.description, 350),
        voice: {
          provider: member.voiceProvider || null,
          id: member.voiceId || null,
          name: member.voiceName || null,
          assigned: !!member.voiceId,
        },
        hasReference: !!member.referenceImageUrl,
        referenceAssetId: member.referenceAssetId || null,
        referenceImageUrl: member.referenceImageUrl || null,
        promptsStale: member.promptsStale,
      })),
      environments: project.environments.map((environment) => ({
        id: environment.id,
        name: environment.name,
        description: compactText(environment.description, 350),
        hasReference: !!environment.referenceImageUrl,
        referenceAssetId: environment.referenceAssetId || null,
        referenceImageUrl: environment.referenceImageUrl || null,
        promptsStale: environment.promptsStale,
      })),
    },
    production: {
      counts,
      audioPhase,
      availableTools: available,
      blockedTools: blocked,
      workflow: usesStoryboardWorkflow(project) ? 'storyboard' : 'keyframe',
      renders: {
        count: renders.length,
        recent: renders,
      },
      scenes: project.scenes.map((scene, sceneIndex) => ({
        id: scene.id,
        index: sceneIndex + 1,
        sectionLabel: scene.sectionLabel,
        timeRange: `${scene.startTime || '?'}-${scene.endTime || '?'}`,
        narrativeDescription: compactText(scene.narrativeDescription, 450),
        shotCount: scene.shots.length,
        shots: scene.shots.map((shot, shotIndex) => ({
          id: shot.id,
          index: shotIndex + 1,
          duration: shot.duration,
          beat: compactText(shot.direction || shot.visualPrompt, 220),
          hasVisualPrompt: !!shot.visualPrompt,
          hasMotionPrompt: !!shot.motionPrompt && shot.motionPrompt !== 'Cinematic camera movement',
          hasStoryboardPrompt: !!shot.storyboardPrompt,
          hasStoryboard: !!shot.storyboardUrl,
          hasFrame: !!shot.imageUrl,
          hasVideo: !!shot.videoUrl,
          locked: shot.locked,
          storyboardLocked: shot.storyboardLocked,
          promptsStale: shot.promptsStale,
          continuityFrom: shot.continuityFrom,
          usePrevStoryboardRef: shot.usePrevStoryboardRef,
          includePrevCutPlan: shot.includePrevCutPlan,
          cast: (shot.castIds || []).map((id) => castNames.get(id) || id),
          environment: shot.environmentId ? environmentNames.get(shot.environmentId) || shot.environmentId : null,
          imageStatus: shot.imageStatus,
          storyboardPromptStatus: shot.storyboardPromptStatus,
          storyboardStatus: shot.storyboardStatus,
          videoStatus: shot.videoStatus,
          audioPlanStale: !!shot.audioPlanStale,
          audioPlan: summarizeAudioPlan(shot.audioPlan),
          lastError: compactText(shot.lastError, 250),
        })),
      })),
    },
    projectConfig: {
      preferences: projectConfig.preferences.preferences,
      preferencesHash: projectConfig.preferences.hash,
      warnings: projectConfig.preferences.warnings,
      promptOverrides: Object.values(projectConfig.prompts).map((prompt) => ({
        kind: prompt.kind,
        scopeType: prompt.scopeType,
        scopeId: prompt.scopeId,
        active: prompt.active,
        source: prompt.source,
        hash: prompt.hash,
        updatedAt: prompt.updatedAt,
      })),
    },
    diagnosis: deriveDirectorDiagnosis(project),
    recommendedActions: recommendedActions(project),
  };
};

export const buildShotPacket = (project: Project, shotId: string) => {
  const castNames = namesById(project.cast);
  const environmentNames = namesById(project.environments);
  const preset = getPipelinePreset(project.presetKey);
  const workflow = getWorkflowRecipe(project.workflowKey || preset.workflowKey);

  for (const [sceneIndex, scene] of project.scenes.entries()) {
    const shotIndex = scene.shots.findIndex((shot) => shot.id === shotId);
    if (shotIndex === -1) continue;

    const shot = scene.shots[shotIndex];
    const previousShot = shotIndex > 0 ? scene.shots[shotIndex - 1] : null;
    const nextShot = shotIndex < scene.shots.length - 1 ? scene.shots[shotIndex + 1] : null;

    return {
      kind: 'mirage.shot.packet',
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
        imageModel: project.imageModel,
        storyboardProvider: project.storyboardProvider,
        videoModel: project.videoModel,
        textProvider: project.textProvider,
      },
      scene: {
        id: scene.id,
        index: sceneIndex + 1,
        sectionLabel: scene.sectionLabel,
        startTime: scene.startTime,
        endTime: scene.endTime,
        lyrics: compactText(scene.lyrics, 600),
        narrativeDescription: compactText(scene.narrativeDescription, 700),
      },
      shot: {
        id: shot.id,
        index: shotIndex + 1,
        duration: shot.duration,
        beat: compactText(shot.direction || shot.visualPrompt, 500),
        visualPrompt: shot.visualPrompt,
        motionPrompt: shot.motionPrompt,
        storyboardPrompt: shot.storyboardPrompt,
        storyboardCutPlan: shot.storyboardCutPlan,
        storyboardPromptStatus: shot.storyboardPromptStatus,
        storyboardStatus: shot.storyboardStatus,
        endVisualPrompt: shot.endVisualPrompt,
        continuityFrom: shot.continuityFrom,
        workflowMode: shot.workflowMode || 'auto',
        usePrevStoryboardRef: shot.usePrevStoryboardRef,
        includePrevCutPlan: shot.includePrevCutPlan,
        refinedFromPrevFrame: shot.refinedFromPrevFrame,
        cast: (shot.castIds || []).map((id) => castNames.get(id) || id),
        environment: shot.environmentId ? environmentNames.get(shot.environmentId) || shot.environmentId : null,
        excludedRefs: shot.excludedRefs,
        promptsStale: shot.promptsStale,
        audioPlanStale: !!shot.audioPlanStale,
        audioPlan: summarizeAudioPlan(shot.audioPlan),
        locked: shot.locked,
        storyboardLocked: shot.storyboardLocked,
        imageStatus: shot.imageStatus,
        videoStatus: shot.videoStatus,
        lastError: shot.lastError,
        baseHashes: {
          shotPrompts: shotPromptHash(shot),
          storyboardPrompt: storyboardPromptHash(shot),
          videoPrompt: videoPromptHash(shot),
        },
        assets: {
          startFrame: shot.imageUrl,
          storyboard: shot.storyboardUrl,
          endFrame: shot.endImageUrl,
          extractedLastFrame: shot.extractedLastFrameUrl,
          video: shot.videoUrl,
        },
      },
      neighbors: {
        previous: previousShot ? {
          id: previousShot.id,
          visualPrompt: compactText(previousShot.visualPrompt, 300),
          motionPrompt: compactText(previousShot.motionPrompt, 300),
          storyboardPrompt: compactText(previousShot.storyboardPrompt, 300),
          storyboardCutPlan: compactText(previousShot.storyboardCutPlan, 300),
          storyboardUrl: previousShot.storyboardUrl,
          videoUrl: previousShot.videoUrl,
          extractedLastFrameUrl: previousShot.extractedLastFrameUrl,
        } : null,
        next: nextShot ? {
          id: nextShot.id,
          visualPrompt: compactText(nextShot.visualPrompt, 300),
          motionPrompt: compactText(nextShot.motionPrompt, 300),
          storyboardPrompt: compactText(nextShot.storyboardPrompt, 300),
          storyboardCutPlan: compactText(nextShot.storyboardCutPlan, 300),
          continuityFrom: nextShot.continuityFrom,
        } : null,
      },
    };
  }

  throw new Error(`Shot not found in project: ${shotId}`);
};
