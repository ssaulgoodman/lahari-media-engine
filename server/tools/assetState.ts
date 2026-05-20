import type { Project } from '../services/codexStudio/core.js';
import type { AssetKey } from './types.js';

const hasText = (value?: string | null): boolean => !!value && value.trim().length > 0;

const hasSourcePayloadText = (project: Project, key: string): boolean => {
  const payload = project.sourcePayload;
  return !!payload && typeof payload[key] === 'string' && (payload[key] as string).trim().length > 0;
};

const hasAnyAudioPlan = (project: Project): boolean =>
  project.scenes.some((scene) => scene.shots.some((shot) => !!shot.audioPlan));

const hasAnyTtsAsset = (project: Project): boolean =>
  project.scenes.some((scene) => scene.shots.some((shot) =>
    (shot.audioPlan?.dialogue || []).some((line: any) => !!line.ttsAssetId && line.ttsStatus === 'success')
  ));

const hasAnyShotPrompts = (project: Project): boolean =>
  project.scenes.some((scene) => scene.shots.some((shot) =>
    hasText(shot.visualPrompt) || hasText(shot.motionPrompt)
  ));

const hasAnyStoryboardPrompts = (project: Project): boolean =>
  project.scenes.some((scene) => scene.shots.some((shot) =>
    hasText(shot.storyboardPrompt)
  ));

const hasAllCastLooks = (project: Project): boolean =>
  project.cast.length > 0 && project.cast.every((member) => !!member.referenceImageUrl || !!member.referenceAssetId);

const hasAllEnvLooks = (project: Project): boolean =>
  project.environments.length > 0 && project.environments.every((env) => !!env.referenceImageUrl || !!env.referenceAssetId);

const hasVoicesForPlannedDialogue = (project: Project): boolean => {
  const referencedCastIds = new Set<string>();
  for (const scene of project.scenes) {
    for (const shot of scene.shots) {
      for (const line of shot.audioPlan?.dialogue || []) {
        if (line.characterId) referencedCastIds.add(line.characterId);
      }
    }
  }

  if (referencedCastIds.size === 0) return false;

  const voiceByCastId = new Map(project.cast.map((member) => [member.id, !!member.voiceId]));
  return Array.from(referencedCastIds).every((castId) => voiceByCastId.get(castId));
};

const hasStoryboards = (project: Project): boolean =>
  project.scenes.some((scene) => scene.shots.some((shot) => !!shot.storyboardUrl || !!shot.storyboardAssetId));

const hasKeyframes = (project: Project): boolean =>
  project.scenes.some((scene) => scene.shots.some((shot) => !!shot.imageUrl));

const hasVideos = (project: Project): boolean =>
  project.scenes.some((scene) => scene.shots.some((shot) => !!shot.videoUrl));

export const getAssetState = (project: Project): Set<AssetKey> => {
  const assets = new Set<AssetKey>();
  const hasScenes = project.scenes.length > 0;
  const shotCount = project.scenes.reduce((count, scene) => count + scene.shots.length, 0);

  if (project.audioPath) assets.add('audio');
  if (hasText(project.lyrics) || hasSourcePayloadText(project, 'scriptText')) assets.add('scriptText');
  if (hasText(project.projectBrief?.directorBrief as string | undefined) || hasText(project.projectBrief?.context as string | undefined)) assets.add('directorBrief');
  if (typeof project.projectBrief?.targetRuntime === 'number') assets.add('targetRuntime');
  if (hasText(project.lyrics)) assets.add('lyrics');
  if (project.musicalStructure.length > 0) assets.add('musicalStructure');
  if (hasText(project.meaning)) assets.add('meaning');
  if (project.lockedConcept || project.conceptOptions.length > 0) assets.add('concept');
  if ((project.styleExploration?.slots || []).length > 0) assets.add('styleDirections');
  if (project.styleAssetUrl) assets.add('styleAsset');
  if (project.cast.length > 0) assets.add('cast');
  if (project.environments.length > 0) assets.add('environments');
  if (hasScenes) assets.add('scenes');
  if (shotCount > 0) assets.add('shots');
  if (hasAnyShotPrompts(project)) assets.add('shotPrompts');
  if (hasAnyStoryboardPrompts(project)) assets.add('storyboardPrompts');
  if (hasAllCastLooks(project)) assets.add('castLooks');
  if (hasAllEnvLooks(project)) assets.add('envLooks');
  if (hasAnyAudioPlan(project)) assets.add('audioPlan');
  if (hasVoicesForPlannedDialogue(project)) assets.add('castVoices');
  if (hasAnyTtsAsset(project)) assets.add('ttsAssets');
  if (hasStoryboards(project)) assets.add('storyboards');
  if (hasKeyframes(project)) assets.add('keyframes');
  if (hasVideos(project)) assets.add('videos');
  if (project.status === 'rendered') assets.add('render');

  return assets;
};

export const hasAsset = (project: Project, key: AssetKey): boolean => getAssetState(project).has(key);
