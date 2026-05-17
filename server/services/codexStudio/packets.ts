import { getProjectConfigState } from '../projectConfig.js';
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

export const buildProjectPacket = async (project: Project) => {
  const castNames = namesById(project.cast);
  const environmentNames = namesById(project.environments);
  const counts = statusCounts(project);
  const renders = await listProjectRenders(project.id);
  const projectConfig = await getProjectConfigState(project);

  return {
    kind: 'lahari.project.packet',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      preset: 'bhakti-music-video',
      videoMode: project.videoMode,
      imageModel: project.imageModel,
      storyboardProvider: project.storyboardProvider,
      videoModel: project.videoModel,
      textProvider: project.textProvider,
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
        hasReference: !!member.referenceImageUrl,
        promptsStale: member.promptsStale,
      })),
      environments: project.environments.map((environment) => ({
        id: environment.id,
        name: environment.name,
        description: compactText(environment.description, 350),
        hasReference: !!environment.referenceImageUrl,
        promptsStale: environment.promptsStale,
      })),
    },
    production: {
      counts,
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

  for (const [sceneIndex, scene] of project.scenes.entries()) {
    const shotIndex = scene.shots.findIndex((shot) => shot.id === shotId);
    if (shotIndex === -1) continue;

    const shot = scene.shots[shotIndex];
    const previousShot = shotIndex > 0 ? scene.shots[shotIndex - 1] : null;
    const nextShot = shotIndex < scene.shots.length - 1 ? scene.shots[shotIndex + 1] : null;

    return {
      kind: 'lahari.shot.packet',
      generatedAt: new Date().toISOString(),
      project: {
        id: project.id,
        title: project.title,
        status: project.status,
        preset: 'bhakti-music-video',
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
