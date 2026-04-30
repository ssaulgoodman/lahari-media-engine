#!/usr/bin/env node
import 'dotenv/config';
import { getFullProject } from '../server/routes/projects.js';

type Project = Awaited<ReturnType<typeof getFullProject>>;

const usage = () => {
  console.log(`Lahari CLI

Read-only Codex-native studio helpers.

Usage:
  npm run lahari -- project packet <projectId>
  npm run lahari -- shot packet <projectId> <shotId>

Output:
  JSON packets designed for Codex inspection and future MCP wrapping.
`);
};

const compactText = (value?: string | null, max = 700): string | null => {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trim()}…`;
};

const namesById = <T extends { id: string; name: string }>(items: T[]) => {
  return new Map(items.map((item) => [item.id, item.name]));
};

const statusCounts = (project: Project) => {
  const counts = {
    scenes: project.scenes.length,
    shots: 0,
    frames: 0,
    videos: 0,
    lockedShots: 0,
    stalePrompts: 0,
    errors: 0,
    chainedShots: 0,
  };

  for (const scene of project.scenes) {
    for (const shot of scene.shots) {
      counts.shots += 1;
      if (shot.imageUrl) counts.frames += 1;
      if (shot.videoUrl) counts.videos += 1;
      if (shot.locked) counts.lockedShots += 1;
      if (shot.promptsStale) counts.stalePrompts += 1;
      if (shot.lastError || shot.imageStatus === 'error' || shot.videoStatus === 'error') counts.errors += 1;
      if (shot.continuityFrom === 'prev_shot') counts.chainedShots += 1;
    }
  }

  return counts;
};

const recommendedActions = (project: Project): string[] => {
  const counts = statusCounts(project);
  const actions: string[] = [];

  if (!project.lockedConcept) actions.push('Choose or generate concept directions.');
  if (!counts.scenes) actions.push('Generate the script/shot plan.');
  if (!project.styleAssetUrl) actions.push('Lock a reusable style reference.');
  if (project.cast.some((member) => !member.referenceImageUrl)) actions.push('Generate or upload missing character/entity references.');
  if (project.environments.some((environment) => !environment.referenceImageUrl)) actions.push('Generate or upload missing environment/location references.');
  if (counts.shots > 0 && project.scenes.some((scene) => scene.shots.some((shot) => !shot.visualPrompt || !shot.motionPrompt))) {
    actions.push('Write or rewrite shot prompts before frame/video generation.');
  }
  if (counts.stalePrompts) actions.push('Review stale prompts before generating new assets.');
  if (counts.errors) actions.push('Inspect failed shots and retry manually with feedback.');
  if (counts.shots && counts.frames < counts.shots) actions.push('Generate missing start frames.');
  if (counts.shots && counts.videos < counts.shots) actions.push('Generate missing videos after frames are ready.');
  if (counts.shots && counts.lockedShots < counts.shots) actions.push('Review and lock completed shots.');

  return actions.slice(0, 8);
};

const projectPacket = (project: Project) => {
  const castNames = namesById(project.cast);
  const environmentNames = namesById(project.environments);
  const counts = statusCounts(project);

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
      videoModel: project.videoModel,
      aspectRatio: project.aspectRatio,
      videoResolution: project.videoResolution,
      targetDuration: project.targetDuration,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
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
          beat: compactText((shot as any).direction || shot.visualPrompt, 220),
          hasVisualPrompt: !!shot.visualPrompt,
          hasMotionPrompt: !!shot.motionPrompt && shot.motionPrompt !== 'Cinematic camera movement',
          hasFrame: !!shot.imageUrl,
          hasVideo: !!shot.videoUrl,
          locked: shot.locked,
          promptsStale: shot.promptsStale,
          continuityFrom: shot.continuityFrom,
          cast: (shot.castIds || []).map((id) => castNames.get(id) || id),
          environment: shot.environmentId ? environmentNames.get(shot.environmentId) || shot.environmentId : null,
          imageStatus: shot.imageStatus,
          videoStatus: shot.videoStatus,
          lastError: compactText(shot.lastError, 250),
        })),
      })),
    },
    recommendedActions: recommendedActions(project),
  };
};

const shotPacket = (project: Project, shotId: string) => {
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
        videoModel: project.videoModel,
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
        beat: compactText((shot as any).direction || shot.visualPrompt, 500),
        visualPrompt: shot.visualPrompt,
        motionPrompt: shot.motionPrompt,
        endVisualPrompt: shot.endVisualPrompt,
        continuityFrom: shot.continuityFrom,
        refinedFromPrevFrame: shot.refinedFromPrevFrame,
        cast: (shot.castIds || []).map((id) => castNames.get(id) || id),
        environment: shot.environmentId ? environmentNames.get(shot.environmentId) || shot.environmentId : null,
        promptsStale: shot.promptsStale,
        locked: shot.locked,
        imageStatus: shot.imageStatus,
        videoStatus: shot.videoStatus,
        lastError: shot.lastError,
        assets: {
          startFrame: shot.imageUrl,
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
          videoUrl: previousShot.videoUrl,
          extractedLastFrameUrl: previousShot.extractedLastFrameUrl,
        } : null,
        next: nextShot ? {
          id: nextShot.id,
          visualPrompt: compactText(nextShot.visualPrompt, 300),
          motionPrompt: compactText(nextShot.motionPrompt, 300),
          continuityFrom: nextShot.continuityFrom,
        } : null,
      },
    };
  }

  throw new Error(`Shot not found in project: ${shotId}`);
};

const main = async () => {
  const [domain, action, projectId, shotId] = process.argv.slice(2);

  if (!domain || domain === 'help' || domain === '--help' || domain === '-h') {
    usage();
    return;
  }

  if (domain === 'project' && action === 'packet' && projectId) {
    const project = await getFullProject(projectId);
    console.log(JSON.stringify(projectPacket(project), null, 2));
    return;
  }

  if (domain === 'shot' && action === 'packet' && projectId && shotId) {
    const project = await getFullProject(projectId);
    console.log(JSON.stringify(shotPacket(project, shotId), null, 2));
    return;
  }

  usage();
  process.exitCode = 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
