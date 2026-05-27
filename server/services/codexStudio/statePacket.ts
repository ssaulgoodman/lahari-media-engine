import { getPipelinePreset, getWorkflowRecipe } from '../../presets.js';
import { availableTools, blockedTools } from '../../tools/registry.js';
import { getProjectConfigState } from '../projectConfig.js';
import {
  compactText,
  deriveDirectorDiagnosis,
  statusCounts,
  usesStoryboardWorkflow,
  webStudioUrl,
  type Project,
} from './core.js';
import { buildProjectPacket } from './packets.js';

export type ProjectStateDetail = 'summary' | 'production' | 'full';

const baseProject = async (project: Project) => {
  const projectConfig = await getProjectConfigState(project);
  const preferences = projectConfig.preferences.preferences;
  const preset = getPipelinePreset(project.presetKey);
  const workflow = getWorkflowRecipe(project.workflowKey || preset.workflowKey);
  return {
    id: project.id,
    title: project.title,
    status: project.status,
    presetKey: preset.key,
    presetLabel: preset.label,
    workflowKey: workflow.key,
    workflowLabel: workflow.label,
    seedKind: project.seedKind || workflow.primarySeed,
    effectivePreferences: {
      textProvider: preferences.textProvider,
      imageModel: preferences.imageModel,
      storyboardProvider: preferences.storyboardProvider,
      videoModel: preferences.videoModel,
    },
    styleNotes: projectConfig.styleNotes.styleNotes,
    styleNotesHash: projectConfig.styleNotes.hash,
    webUrl: webStudioUrl(project.id, { step: 'studio' }),
  };
};

export const buildProjectState = async (project: Project, detail: ProjectStateDetail = 'summary') => {
  if (detail === 'full') return buildProjectPacket(project);
  const projectBlock = await baseProject(project);
  const counts = statusCounts(project);
  const actions = {
    availableTools: availableTools(project).map((tool) => tool.key),
    blockedTools: blockedTools(project).map((tool) => ({
      key: tool.key,
      missing: tool.missing,
    })),
  };

  const summary = {
    kind: 'mirage.project.state',
    detail,
    generatedAt: new Date().toISOString(),
    project: projectBlock,
    diagnosis: deriveDirectorDiagnosis(project),
    counts,
    assets: {
      conceptLocked: !!project.lockedConcept,
      scriptScenes: project.scenes.length,
      styleLocked: !!project.styleAssetId,
      cast: {
        total: project.cast.length,
        lockedReferences: project.cast.filter((member) => member.referenceImageUrl || member.referenceAssetId).length,
        stalePrompts: project.cast.filter((member) => member.promptsStale).length,
      },
      environments: {
        total: project.environments.length,
        lockedReferences: project.environments.filter((environment) => environment.referenceImageUrl || environment.referenceAssetId).length,
        stalePrompts: project.environments.filter((environment) => environment.promptsStale).length,
      },
      shots: {
        total: counts.shots,
        storyboards: counts.storyboards,
        videos: counts.videos,
        locked: counts.lockedShots,
      },
    },
    actions,
  };

  if (detail === 'summary') return summary;

  return {
    ...summary,
    source: {
      projectBrief: project.projectBrief,
      meaning: compactText(project.meaning, 500),
      lyricsPreview: compactText(project.lyrics, 500),
    },
    looks: {
      style: {
        assetId: project.styleAssetId || null,
        assetUrl: project.styleAssetUrl || null,
        description: compactText(project.styleDescription, 500),
      },
      cast: project.cast.map((member) => ({
        id: member.id,
        name: member.name,
        description: compactText(member.description, 220),
        referenceAssetId: member.referenceAssetId || null,
        hasReference: !!member.referenceImageUrl,
        promptsStale: !!member.promptsStale,
      })),
      environments: project.environments.map((environment) => ({
        id: environment.id,
        name: environment.name,
        description: compactText(environment.description, 220),
        referenceAssetId: environment.referenceAssetId || null,
        hasReference: !!environment.referenceImageUrl,
        promptsStale: !!environment.promptsStale,
      })),
    },
    production: {
      workflow: usesStoryboardWorkflow(project) ? 'storyboard' : 'keyframe',
      scenes: project.scenes.map((scene, sceneIndex) => ({
        id: scene.id,
        index: sceneIndex + 1,
        sectionLabel: scene.sectionLabel,
        shotCount: scene.shots.length,
        shots: scene.shots.map((shot, shotIndex) => ({
          id: shot.id,
          index: shotIndex + 1,
          duration: shot.duration,
          beat: compactText(shot.direction || shot.visualPrompt, 180),
          hasStoryboardPrompt: !!shot.storyboardPrompt,
          hasStoryboard: !!shot.storyboardUrl,
          storyboardLocked: !!shot.storyboardLocked,
          hasFrame: !!shot.imageUrl,
          hasVideo: !!shot.videoUrl,
          locked: !!shot.locked,
          promptsStale: !!shot.promptsStale,
          lastError: compactText(shot.lastError, 180),
        })),
      })),
    },
  };
};
