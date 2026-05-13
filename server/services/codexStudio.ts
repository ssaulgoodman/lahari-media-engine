import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { selectAll, selectColumns, updateRows, insertRow, deleteRows, rpcVoid } from '../database.js';
import type { getFullProject } from '../routes/projects.js';
import { planScenes, refineScript, writeShotPrompts } from './claude.js';
import { generateStoryboardVersion, lockStoryboardVersion, planStoryboardPrompt, unlockStoryboardVersion, writeStoryboardPrompt } from './storyboard.js';
import { generateShotVideo } from './videoGeneration.js';
import { eventResultPointers, listDirectorEvents, recordDirectorEvent, type DirectorEvent } from './directorEvents.js';
import { getModelMinDuration } from './segmind.js';
import type { StoryboardPromptVariant } from './seedance-storyboard-rd.js';
import {
  applyProjectPreferences,
  applyProjectPromptOverride,
  getProjectConfigState,
  revertProjectPromptOverride,
  writeProjectConfigDeskCopy,
  type ProjectPromptOverrideKind,
} from './projectConfig.js';
import { IMAGE_MODELS } from '../../constants/imageModels.js';
import { getStoryboardProvider, STORYBOARD_PROVIDERS } from '../../constants/storyboardProviders.js';
import { TEXT_PROVIDERS } from '../../constants/textProviders.js';
import { getVideoModel, VIDEO_MODELS } from '../../constants/videoModels.js';

type Project = Awaited<ReturnType<typeof getFullProject>>;
type ProjectShot = Project['scenes'][number]['shots'][number];

export const compactText = (value?: string | null, max = 700): string | null => {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trim()}...`;
};

const namesById = <T extends { id: string; name: string }>(items: T[]) => {
  return new Map(items.map((item) => [item.id, item.name]));
};

const slugify = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'lahari-project';
};

const appBaseUrl = () => (
  process.env.LAHARI_STUDIO_URL
  || process.env.APP_URL
  || process.env.PUBLIC_APP_URL
  || 'https://lahari-media-engine-production.up.railway.app'
).replace(/\/+$/, '');

const studioStepParam = (step: 'queue' | 'blueprint' | 'studio' | 'render') => step;

export const webStudioUrl = (projectId: string, opts: { step?: 'queue' | 'blueprint' | 'studio' | 'render'; shotId?: string; action?: string } = {}): string => {
  const params = new URLSearchParams();
  params.set('project', projectId);
  if (opts.step) params.set('step', studioStepParam(opts.step));
  if (opts.shotId) params.set('shot', opts.shotId);
  if (opts.action) params.set('action', opts.action);
  return `${appBaseUrl()}/?${params.toString()}`;
};

export const defaultArtifactPath = (project: Project, suffix: string): string => {
  return path.join(process.cwd(), '.lahari', 'codex', `${slugify(project.title)}-${suffix}`);
};

const defaultPreviewPath = (project: Project, previewId: string, suffix: string): string => {
  return path.join(process.cwd(), '.lahari', 'previews', project.id, `${previewId}-${suffix}`);
};

export const writeArtifact = (filePath: string, content: string) => {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content);
  return resolved;
};

const writeArtifactIfMissing = (filePath: string, content: string) => {
  const resolved = path.resolve(filePath);
  if (fs.existsSync(resolved)) return resolved;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content);
  return resolved;
};

const safeTimestamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const escapeHtml = (value?: string | null): string => {
  return (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const md = (value?: string | null): string => {
  return value?.trim() || 'None';
};

const sessionDir = (projectId: string): string => {
  return path.join(process.cwd(), '.lahari', 'sessions', projectId);
};

const sessionStatePath = (projectId: string): string => {
  return path.join(sessionDir(projectId), 'state.json');
};

const sessionJournalPath = (projectId: string): string => {
  return path.join(sessionDir(projectId), 'journal.md');
};

export const defaultProjectWorkbenchDir = (project: Project): string => {
  return path.join(process.cwd(), '.lahari', 'projects', project.id);
};

const readTextFileIfExists = (filePath: string): string | null => {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
};

const readJsonFileIfExists = (filePath: string): unknown | null => {
  const content = readTextFileIfExists(filePath);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

export const listProjects = async (limitArg?: string) => {
  const parsedLimit = limitArg ? Number.parseInt(limitArg, 10) : 20;
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20;
  const rows = await selectColumns(
    'projects',
    'id,title,status,song_type,is_narrative,is_meditative,image_model,storyboard_provider,video_model,text_provider,created_at,updated_at',
    {},
    { orderBy: 'updated_at', ascending: false, limit },
  );

  return {
    kind: 'lahari.project.list',
    generatedAt: new Date().toISOString(),
    limit,
    projects: rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      preset: 'bhakti-music-video',
      songType: row.song_type || null,
      isNarrative: row.is_narrative ?? null,
      isMeditative: row.is_meditative ?? null,
      imageModel: row.image_model || IMAGE_MODELS[0].key,
      storyboardProvider: row.storyboard_provider || STORYBOARD_PROVIDERS[0].key,
      videoModel: row.video_model || VIDEO_MODELS[0].key,
      textProvider: row.text_provider || TEXT_PROVIDERS[0].key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
};

export const statusCounts = (project: Project) => {
  const counts = {
    scenes: project.scenes.length,
    shots: 0,
    frames: 0,
    storyboardPrompts: 0,
    storyboards: 0,
    videos: 0,
    lockedShots: 0,
    lockedStoryboards: 0,
    stalePrompts: 0,
    errors: 0,
    chainedShots: 0,
    storyboardRefContinuity: 0,
  };

  for (const scene of project.scenes) {
    for (const shot of scene.shots) {
      counts.shots += 1;
      if (shot.imageUrl) counts.frames += 1;
      if (shot.storyboardPrompt) counts.storyboardPrompts += 1;
      if (shot.storyboardUrl) counts.storyboards += 1;
      if (shot.videoUrl) counts.videos += 1;
      if (shot.locked) counts.lockedShots += 1;
      if (shot.storyboardLocked) counts.lockedStoryboards += 1;
      if (shot.promptsStale) counts.stalePrompts += 1;
      if (
        shot.lastError
        || shot.imageStatus === 'error'
        || shot.videoStatus === 'error'
        || shot.storyboardStatus === 'error'
        || shot.storyboardPromptStatus === 'error'
      ) counts.errors += 1;
      if (shot.continuityFrom === 'prev_shot') counts.chainedShots += 1;
      if (shot.usePrevStoryboardRef) counts.storyboardRefContinuity += 1;
    }
  }

  return counts;
};

const usesStoryboardWorkflow = (project: Project): boolean => {
  return project.videoModel?.startsWith('seedance')
    || project.scenes.some((scene) => scene.shots.some((shot) => (
      !!shot.storyboardPrompt
      || !!shot.storyboardUrl
      || !!shot.storyboardLocked
      || shot.storyboardPromptStatus === 'loading'
      || shot.storyboardStatus === 'loading'
    )));
};

export const recommendedActions = (project: Project): string[] => {
  const counts = statusCounts(project);
  const storyboardWorkflow = usesStoryboardWorkflow(project);
  const actions: string[] = [];

  if (!project.lockedConcept) actions.push('Choose or generate concept directions.');
  if (!counts.scenes) actions.push('Generate the script/shot plan.');
  if (!project.styleAssetUrl) actions.push('Lock a reusable style reference.');
  if (project.cast.some((member) => !member.referenceImageUrl)) actions.push('Generate or upload missing character/entity references.');
  if (project.environments.some((environment) => !environment.referenceImageUrl)) actions.push('Generate or upload missing environment/location references.');
  if (!storyboardWorkflow && counts.shots > 0 && project.scenes.some((scene) => scene.shots.some((shot) => !shot.visualPrompt || !shot.motionPrompt))) {
    actions.push('Write or rewrite shot prompts before frame/video generation.');
  }
  if (storyboardWorkflow && counts.shots > 0 && counts.storyboardPrompts < counts.shots) {
    actions.push('Write missing storyboard prompts/cut plans for Seedance storyboard mode.');
  }
  if (counts.stalePrompts) actions.push('Review stale prompts before generating new assets.');
  if (counts.errors) actions.push('Inspect failed shots and retry manually with feedback.');
  if (storyboardWorkflow && counts.shots && counts.storyboards < counts.shots) actions.push('Generate missing storyboard boards.');
  if (!storyboardWorkflow && counts.shots && counts.frames < counts.shots) actions.push('Generate missing start frames.');
  if (counts.shots && counts.videos < counts.shots) actions.push('Generate missing videos after frames are ready.');
  if (counts.shots && counts.lockedShots < counts.shots) actions.push('Review and lock completed shots.');

  return actions.slice(0, 8);
};

export const deriveCheckpointState = (project: Project) => {
  const counts = statusCounts(project);
  const missingRefs = missingReferenceNames(project);
  const hasConcept = !!project.lockedConcept;
  const hasScript = counts.scenes > 0 && counts.shots > 0;
  const hasStyle = !!project.styleAssetUrl;
  const refsComplete = missingRefs.cast.length === 0 && missingRefs.environments.length === 0;
  const storyboardWorkflow = usesStoryboardWorkflow(project);
  const promptsComplete = hasScript && project.scenes.every((scene) => scene.shots.every((shot) => (
    !!shot.visualPrompt
    && !!shot.motionPrompt
    && shot.motionPrompt !== 'Cinematic camera movement'
  )));
  const storyboardPromptsComplete = hasScript && project.scenes.every((scene) => scene.shots.every((shot) => !!shot.storyboardPrompt));
  const framesComplete = counts.shots > 0 && counts.frames === counts.shots;
  const storyboardsComplete = counts.shots > 0 && counts.storyboards === counts.shots;
  const videosComplete = counts.shots > 0 && counts.videos === counts.shots;
  const locksComplete = counts.shots > 0 && counts.lockedShots === counts.shots;

  let key = 'audio_analysis';
  let label = 'Audio analysis';
  let summary = 'Review source lyrics, meaning, structure, and song classification before concept work.';

  if (project.status === 'completed') {
    key = 'completed';
    label = 'Completed';
    summary = 'Project is completed. Useful next work is audit, publish review, or meta-learning capture.';
  } else if (videosComplete && locksComplete) {
    key = 'render_publish';
    label = 'Render and publish';
    summary = 'All shots have videos and are locked. Ready for final assembly/publish review.';
  } else if (videosComplete) {
    key = 'studio_review';
    label = 'Studio review';
    summary = 'All shot videos exist. Review quality, lock winners, and handle stale/error states.';
  } else if (storyboardWorkflow && storyboardsComplete) {
    key = 'video_generation';
    label = 'Video generation';
    summary = 'Storyboard boards are complete. Generate or retry videos from locked boards and cut plans.';
  } else if (framesComplete) {
    key = 'video_generation';
    label = 'Video generation';
    summary = 'Start frames are complete. Generate or retry shot videos, respecting chained-shot dependencies.';
  } else if (storyboardWorkflow && storyboardPromptsComplete) {
    key = 'storyboard_generation';
    label = 'Storyboard generation';
    summary = 'Storyboard prompts are ready. Generate missing boards and inspect the visual sequence.';
  } else if (promptsComplete) {
    key = 'frame_generation';
    label = 'Frame generation';
    summary = 'Shot prompts are ready. Generate missing start frames and inspect the visual sequence.';
  } else if (refsComplete && hasScript && hasStyle) {
    key = 'shot_prompting';
    label = 'Shot prompting';
    summary = 'Blueprint references are ready. Write or rewrite cinematic shot prompts before generating frames.';
  } else if (hasStyle && hasScript) {
    key = 'looks';
    label = 'Characters and environments';
    summary = 'Style is locked. Finish reusable character/entity and environment/location references.';
  } else if (hasScript) {
    key = 'style';
    label = 'Style direction';
    summary = 'Script exists. Brainstorm, visualize, and lock the reusable style reference.';
  } else if (hasConcept) {
    key = 'script';
    label = 'Script and shot plan';
    summary = 'Concept is locked. Generate or refine cast, environments, scenes, and shot beats.';
  } else if (project.conceptOptions.length > 0) {
    key = 'concept';
    label = 'Concept selection';
    summary = 'Concept options exist. Choose, refine, or regenerate before script planning.';
  }

  const openIssues = [
    project.songType ? null : 'Song classification is missing; this may be an older project or unanalyzed cache path.',
    counts.stalePrompts ? `${counts.stalePrompts} stale prompt${counts.stalePrompts === 1 ? '' : 's'} need review.` : null,
    counts.errors ? `${counts.errors} error state${counts.errors === 1 ? ' needs' : 's need'} triage.` : null,
    missingRefs.cast.length ? `Missing character/entity references: ${missingRefs.cast.join(', ')}.` : null,
    missingRefs.environments.length ? `Missing environment/location references: ${missingRefs.environments.join(', ')}.` : null,
    !storyboardWorkflow && hasScript && !promptsComplete ? 'Some shots are missing usable visual or motion prompts.' : null,
    storyboardWorkflow && hasScript && !storyboardPromptsComplete ? 'Some shots are missing storyboard prompts/cut plans.' : null,
    !storyboardWorkflow && counts.shots && counts.frames < counts.shots ? `${counts.shots - counts.frames} start frame${counts.shots - counts.frames === 1 ? '' : 's'} missing.` : null,
    storyboardWorkflow && counts.shots && counts.storyboards < counts.shots ? `${counts.shots - counts.storyboards} storyboard board${counts.shots - counts.storyboards === 1 ? '' : 's'} missing.` : null,
    counts.shots && counts.videos < counts.shots ? `${counts.shots - counts.videos} video${counts.shots - counts.videos === 1 ? '' : 's'} missing.` : null,
    counts.shots && counts.lockedShots < counts.shots ? `${counts.shots - counts.lockedShots} shot${counts.shots - counts.lockedShots === 1 ? '' : 's'} not locked.` : null,
  ].filter(Boolean) as string[];

  return {
    key,
    label,
    summary,
    projectStatus: project.status,
    counts,
    openIssues,
    recommendedActions: recommendedActions(project),
  };
};

const shotLabel = (sceneIndex: number, shotIndex: number) => `S${sceneIndex + 1}.${shotIndex + 1}`;

export const deriveDirectorDiagnosis = (project: Project) => {
  const checkpoint = deriveCheckpointState(project);
  const counts = checkpoint.counts;
  const storyboardWorkflow = usesStoryboardWorkflow(project);
  const weakShots: string[] = [];
  const riskNotes: string[] = [];

  for (const [sceneIndex, scene] of project.scenes.entries()) {
    for (const [shotIndex, shot] of scene.shots.entries()) {
      const label = shotLabel(sceneIndex, shotIndex);
      const beat = compactText(shot.direction || shot.storyboardPrompt || shot.visualPrompt, 120);
      const reasons = [
        shot.lastError ? 'error' : null,
        shot.promptsStale ? 'stale prompt' : null,
        storyboardWorkflow && !shot.storyboardPrompt ? 'missing storyboard prompt' : null,
        storyboardWorkflow && !shot.storyboardUrl ? 'missing board' : null,
        !storyboardWorkflow && !shot.imageUrl ? 'missing start frame' : null,
        !shot.videoUrl ? 'missing video' : null,
        shot.videoStatus === 'stale' ? 'video stale' : null,
        shot.storyboardStatus === 'error' ? 'board error' : null,
        shot.videoStatus === 'error' ? 'video error' : null,
        shot.videoUrl && !shot.locked ? 'needs lock review' : null,
        storyboardWorkflow && shot.storyboardUrl && !shot.storyboardLocked ? 'board needs lock review' : null,
      ].filter(Boolean);
      if (!reasons.length) continue;
      weakShots.push(`${label}: ${reasons.join(', ')}${beat ? ` - ${beat}` : ''}`);
    }
  }

  if (project.videoModel?.startsWith('seedance') && !storyboardWorkflow) {
    riskNotes.push('Project uses Seedance but has no storyboard artifacts yet; confirm whether it should be in storyboard mode.');
  }
  if (storyboardWorkflow && counts.storyboardPrompts > 0 && counts.storyboards === 0) {
    riskNotes.push('Storyboard prompts exist but no boards are rendered; visual review is blocked until boards are generated.');
  }
  if (counts.videos > 0 && counts.lockedShots < counts.videos) {
    riskNotes.push(`${counts.videos - counts.lockedShots} generated video${counts.videos - counts.lockedShots === 1 ? '' : 's'} still need artist lock/reject review.`);
  }
  if (counts.storyboards > 0 && storyboardWorkflow && counts.lockedStoryboards < counts.storyboards) {
    const unlockedBoards = counts.storyboards - counts.lockedStoryboards;
    riskNotes.push(`${unlockedBoards} storyboard board${unlockedBoards === 1 ? '' : 's'} still ${unlockedBoards === 1 ? 'needs' : 'need'} lock/reject review.`);
  }
  if (!project.styleAssetUrl) riskNotes.push('No locked style asset; downstream visual consistency will drift.');
  if (checkpoint.openIssues.length === 0 && riskNotes.length === 0) {
    riskNotes.push('No deterministic risks found. Next review should be visual/taste-based, not inventory-based.');
  }

  const nextApprovedAction = checkpoint.recommendedActions[0] || (
    counts.videos === counts.shots && counts.lockedShots === counts.shots
      ? 'Generate a final render or review render history.'
      : 'Open the focused evidence sheets and perform visual/taste review.'
  );

  return {
    kind: 'lahari.director.diagnosis',
    generatedAt: new Date().toISOString(),
    checkpoint: {
      key: checkpoint.key,
      label: checkpoint.label,
      summary: checkpoint.summary,
    },
    productionRead: `${checkpoint.label}: ${checkpoint.summary}`,
    bottleneck: checkpoint.openIssues[0] || nextApprovedAction,
    weakLinks: weakShots.slice(0, 8),
    riskNotes: riskNotes.slice(0, 8),
    nextApprovedAction,
  };
};

const listProjectRenders = async (projectId: string) => {
  const rows = await selectAll(
    'assets',
    { project_id: projectId, category: 'final_render' },
    { orderBy: 'created_at', ascending: false, limit: 10 },
  );
  const renderRows = await selectAll(
    'renders',
    { project_id: projectId, status: 'completed' },
  );
  const urlByPath = new Map<string, string>();
  for (const row of renderRows as any[]) {
    if (row.storage_path && row.video_url) urlByPath.set(row.storage_path, row.video_url);
  }

  return rows.map((row: any) => ({
    assetId: row.id,
    storagePath: row.file_path,
    videoUrl: urlByPath.get(row.file_path) || null,
    createdAt: row.created_at,
  }));
};

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

const hasUsableShotPrompts = (project: Project): boolean => {
  return project.scenes.every((scene) => scene.shots.every((shot) => (
    !!shot.visualPrompt
    && !!shot.motionPrompt
    && shot.motionPrompt !== 'Cinematic camera movement'
  )));
};

const missingReferenceNames = (project: Project) => {
  return {
    cast: project.cast.filter((member) => !member.referenceImageUrl).map((member) => member.name),
    environments: project.environments.filter((environment) => !environment.referenceImageUrl).map((environment) => environment.name),
  };
};

export const buildProjectReport = (project: Project): string => {
  const counts = statusCounts(project);
  const missingRefs = missingReferenceNames(project);
  const actions = recommendedActions(project);
  const styleSlots = project.styleExploration?.slots || [];
  const workflow = usesStoryboardWorkflow(project) ? 'storyboard' : 'keyframe';
  const diagnosis = deriveDirectorDiagnosis(project);

  const sceneLines = project.scenes.map((scene, sceneIndex) => {
    const shotSummary = scene.shots.map((shot, shotIndex) => {
      const flags = [
        shot.imageUrl ? 'frame' : 'no-frame',
        shot.storyboardUrl ? 'board' : null,
        shot.videoUrl ? 'video' : 'no-video',
        shot.locked ? 'locked' : null,
        shot.storyboardLocked ? 'board-locked' : null,
        shot.promptsStale ? 'stale' : null,
        shot.lastError ? 'error' : null,
        shot.continuityFrom === 'prev_shot' ? 'chain' : null,
        shot.usePrevStoryboardRef ? 'prev-board-ref' : null,
      ].filter(Boolean).join(', ');
      return `  - Shot ${shotIndex + 1} (${shot.duration}s, ${flags}): ${compactText(shot.direction || shot.storyboardPrompt || shot.visualPrompt, 180) || 'No beat/prompt'}`;
    }).join('\n');

    return `### Scene ${sceneIndex + 1}: ${scene.sectionLabel || 'Untitled'} (${scene.startTime || '?'}-${scene.endTime || '?'})

${md(scene.narrativeDescription)}

${shotSummary || 'No shots.'}`;
  }).join('\n\n');

  return `# Lahari Director Report

Generated: ${new Date().toISOString()}

## Project

- Title: ${project.title}
- ID: ${project.id}
- Status: ${project.status}
- Preset: bhakti-music-video
- Song type: ${project.songType || 'unknown'}${project.isMeditative ? ', meditative' : ''}${project.isNarrative ? ', narrative' : ''}
- Workflow: ${workflow}
- Models: text ${project.textProvider}, image ${project.imageModel}, storyboard ${project.storyboardProvider}, video ${project.videoModel}
- Format: ${project.aspectRatio}, ${project.videoResolution}, target shot duration ${project.targetDuration || 'unset'}s

## Director Diagnosis

- Production read: ${diagnosis.productionRead}
- Bottleneck: ${diagnosis.bottleneck}
- Next approved action: ${diagnosis.nextApprovedAction}

Weak links:
${diagnosis.weakLinks.length ? diagnosis.weakLinks.map((item) => `- ${item}`).join('\n') : '- No deterministic weak links found.'}

Risk notes:
${diagnosis.riskNotes.length ? diagnosis.riskNotes.map((item) => `- ${item}`).join('\n') : '- No deterministic risks found.'}

## Production Counts

- Scenes: ${counts.scenes}
- Shots: ${counts.shots}
- Start frames: ${counts.frames}/${counts.shots}
- Storyboard prompts: ${counts.storyboardPrompts}/${counts.shots}
- Storyboard boards: ${counts.storyboards}/${counts.shots}
- Videos: ${counts.videos}/${counts.shots}
- Locked shots: ${counts.lockedShots}/${counts.shots}
- Locked storyboards: ${counts.lockedStoryboards}/${counts.shots}
- Chained shots: ${counts.chainedShots}
- Previous-board refs: ${counts.storyboardRefContinuity}
- Stale prompts: ${counts.stalePrompts}
- Errors: ${counts.errors}

## Source Read

${md(compactText(project.meaning, 1200))}

## Concept

${project.lockedConcept ? `Locked: ${project.lockedConcept.title || project.lockedConcept.deity || 'Untitled'}\n\n${md(project.lockedConcept.description || project.lockedConcept.conceptDirection)}` : 'No locked concept.'}

## Style

- Style asset: ${project.styleAssetUrl || 'None'}
- Style directions explored: ${styleSlots.length}

${md(compactText(project.styleDescription, 900))}

## References

- Cast/entities: ${project.cast.length}
- Missing cast/entity references: ${missingRefs.cast.length ? missingRefs.cast.join(', ') : 'None'}
- Environments/locations: ${project.environments.length}
- Missing environment/location references: ${missingRefs.environments.length ? missingRefs.environments.join(', ') : 'None'}

## Prompt Readiness

- Shot prompts complete: ${hasUsableShotPrompts(project) ? 'Yes' : 'No'}
- Storyboard prompts complete: ${counts.shots > 0 && counts.storyboardPrompts === counts.shots ? 'Yes' : 'No'}
- Style reference locked: ${project.styleAssetUrl ? 'Yes' : 'No'}
- Character/entity references complete: ${missingRefs.cast.length ? 'No' : 'Yes'}
- Environment/location references complete: ${missingRefs.environments.length ? 'No' : 'Yes'}

## Recommended Next Actions

${actions.length ? actions.map((action) => `- ${action}`).join('\n') : '- No obvious next action from deterministic checks.'}

## Scenes And Shots

${sceneLines || 'No scenes yet.'}
`;
};

const imageCard = (title: string, imageUrl?: string | null, meta?: string, body?: string) => {
  return `<article class="card">
    <div class="thumb">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}">` : '<div class="missing">No image</div>'}</div>
    <h3>${escapeHtml(title)}</h3>
    ${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ''}
    ${body ? `<p>${escapeHtml(body)}</p>` : ''}
  </article>`;
};

const videoCard = (title: string, videoUrl?: string | null, meta?: string, body?: string) => {
  return `<article class="card">
    <div class="thumb">${videoUrl ? `<video src="${escapeHtml(videoUrl)}" controls preload="metadata"></video>` : '<div class="missing">No video URL</div>'}</div>
    <h3>${escapeHtml(title)}</h3>
    ${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ''}
    ${body ? `<p>${escapeHtml(body)}</p>` : ''}
  </article>`;
};

const sheetHtml = (project: Project, title: string, sections: string, stats?: string): string => {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(project.title)} · ${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #111114; color: #f4f4f5; }
    body { margin: 0; padding: 32px; background: #111114; }
    header, .section, .text-panel { max-width: 1120px; margin-left: auto; margin-right: auto; }
    header { margin-bottom: 28px; }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.1; }
    h2 { max-width: 1120px; margin: 32px auto 14px; font-size: 18px; }
    .sub { color: #a1a1aa; margin: 0; }
    .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .pill { border: 1px solid #3f3f46; border-radius: 8px; padding: 6px 10px; color: #d4d4d8; background: #18181b; font-size: 13px; }
    .grid { max-width: 1120px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
    .card { border: 1px solid #27272a; border-radius: 8px; background: #18181b; overflow: hidden; }
    .thumb { aspect-ratio: 16 / 10; background: #09090b; display: grid; place-items: center; }
    .thumb img, .thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
    .missing { color: #71717a; font-size: 13px; }
    h3 { margin: 10px 10px 4px; font-size: 14px; }
    p { margin: 6px 10px 12px; color: #d4d4d8; font-size: 12px; line-height: 1.4; }
    .meta { color: #a1a1aa; margin-bottom: 6px; }
    .text-panel { border: 1px solid #27272a; border-radius: 8px; background: #18181b; padding: 16px; color: #d4d4d8; font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(project.title)}</h1>
    <p class="sub">${escapeHtml(title)} - ${escapeHtml(project.status)} - ${escapeHtml(project.songType || 'unknown')}</p>
    ${stats || ''}
  </header>
  ${sections}
</body>
</html>`;
};

export const PROJECT_SHEET_TYPES = ['overview', 'style', 'references', 'storyboard', 'renders'] as const;
export type ProjectSheetType = typeof PROJECT_SHEET_TYPES[number];

export const normalizeProjectSheetType = (value?: string): ProjectSheetType => {
  const normalized = (value || 'overview').toLowerCase();
  if ((PROJECT_SHEET_TYPES as readonly string[]).includes(normalized)) return normalized as ProjectSheetType;
  throw new Error(`Unknown project sheet type "${value}". Expected one of: ${PROJECT_SHEET_TYPES.join(', ')}`);
};

export const defaultProjectSheetPath = (project: Project, type: ProjectSheetType): string => {
  return defaultArtifactPath(project, `${type}-sheet.html`);
};

const buildStats = (counts: ReturnType<typeof statusCounts>) => {
  return `<div class="stats">
      <span class="pill">${counts.scenes} scenes</span>
      <span class="pill">${counts.shots} shots</span>
      <span class="pill">${counts.storyboards}/${counts.shots} boards</span>
      <span class="pill">${counts.frames}/${counts.shots} frames</span>
      <span class="pill">${counts.videos}/${counts.shots} videos</span>
      <span class="pill">${counts.lockedShots}/${counts.shots} locked</span>
      <span class="pill">${counts.errors} errors</span>
    </div>`;
};

export const buildProjectSheet = async (project: Project, rawType?: string): Promise<string> => {
  const type = normalizeProjectSheetType(rawType);
  if (type === 'overview') return buildProjectContactSheet(project);

  const counts = statusCounts(project);
  const styleSlots = project.styleExploration?.slots || [];

  if (type === 'style') {
    const cards = [
      imageCard('Locked style', project.styleAssetUrl, 'selected reference', compactText(project.styleDescription, 220) || undefined),
      ...styleSlots.map((slot: any) => imageCard(
        slot.title || 'Style option',
        slot.imageUrl,
        'exploration slot',
        compactText(slot.description, 220) || undefined,
      )),
    ].join('\n');
    const text = `<h2>Style Read</h2><div class="text-panel">${escapeHtml(md(compactText(project.styleDescription, 1400)))}</div>`;
    return sheetHtml(project, 'Style Sheet', `${text}<h2>Style References</h2><section class="grid">${cards}</section>`, buildStats(counts));
  }

  if (type === 'references') {
    const castCards = project.cast.map((member) => imageCard(
      member.name,
      member.referenceImageUrl,
      member.promptsStale ? 'character/entity - stale prompt' : 'character/entity',
      compactText(member.description, 220) || undefined,
    )).join('\n');
    const envCards = project.environments.map((environment) => imageCard(
      environment.name,
      environment.referenceImageUrl,
      environment.promptsStale ? 'environment/location - stale prompt' : 'environment/location',
      compactText(environment.description, 220) || undefined,
    )).join('\n');
    return sheetHtml(project, 'Reference Sheet', `
  <h2>Characters / Entities</h2>
  <section class="grid">${castCards || '<p>No cast/entities.</p>'}</section>
  <h2>Environments / Locations</h2>
  <section class="grid">${envCards || '<p>No environments/locations.</p>'}</section>`, buildStats(counts));
  }

  if (type === 'storyboard') {
    const shotCards = project.scenes.flatMap((scene, sceneIndex) => (
      scene.shots.map((shot, shotIndex) => {
        const labels = [
          `Scene ${sceneIndex + 1}`,
          `Shot ${shotIndex + 1}`,
          `${shot.duration}s`,
          shot.storyboardPromptStatus ? `prompt ${shot.storyboardPromptStatus}` : null,
          shot.storyboardStatus ? `board ${shot.storyboardStatus}` : null,
          shot.videoStatus ? `video ${shot.videoStatus}` : null,
          shot.storyboardLocked ? 'board locked' : null,
          shot.locked ? 'shot locked' : null,
          shot.promptsStale ? 'stale' : null,
        ].filter(Boolean).join(' - ');
        const body = compactText(shot.direction || shot.storyboardPrompt || shot.visualPrompt, 260) || undefined;
        return imageCard(`S${sceneIndex + 1}.${shotIndex + 1}`, shot.storyboardUrl || shot.imageUrl, labels, body);
      })
    )).join('\n');
    return sheetHtml(project, 'Storyboard Sheet', `<h2>Storyboard / Start Frames</h2><section class="grid">${shotCards || '<p>No shots.</p>'}</section>`, buildStats(counts));
  }

  const renders = await listProjectRenders(project.id);
  const cards = renders.map((render, index) => videoCard(
    `Render ${index + 1}`,
    render.videoUrl,
    render.createdAt || render.storagePath,
    render.videoUrl ? render.storagePath : `Storage path: ${render.storagePath}`,
  )).join('\n');
  return sheetHtml(project, 'Render Sheet', `<h2>Final Renders</h2><section class="grid">${cards || '<p>No final render assets found.</p>'}</section>`, buildStats(counts));
};

export const buildProjectContactSheet = (project: Project): string => {
  const counts = statusCounts(project);
  const styleSlots = project.styleExploration?.slots || [];
  const castCards = project.cast.map((member) => imageCard(
    member.name,
    member.referenceImageUrl,
    member.promptsStale ? 'stale prompt' : 'reference',
    compactText(member.description, 180) || undefined,
  )).join('\n');
  const envCards = project.environments.map((environment) => imageCard(
    environment.name,
    environment.referenceImageUrl,
    environment.promptsStale ? 'stale prompt' : 'reference',
    compactText(environment.description, 180) || undefined,
  )).join('\n');
  const styleCards = [
    imageCard('Locked style', project.styleAssetUrl, 'selected reference', compactText(project.styleDescription, 180) || undefined),
    ...styleSlots.map((slot: any) => imageCard(
      slot.title || 'Style option',
      slot.imageUrl,
      'exploration slot',
      compactText(slot.description, 180) || undefined,
    )),
  ].join('\n');
  const shotCards = project.scenes.flatMap((scene, sceneIndex) => (
    scene.shots.map((shot, shotIndex) => {
      const labels = [
        `Scene ${sceneIndex + 1}`,
        `Shot ${shotIndex + 1}`,
        `${shot.duration}s`,
        shot.continuityFrom === 'prev_shot' ? 'chain' : 'cut',
        shot.storyboardUrl ? 'board' : null,
        shot.locked ? 'locked' : null,
        shot.storyboardLocked ? 'board locked' : null,
        shot.promptsStale ? 'stale' : null,
      ].filter(Boolean).join(' · ');
      const title = `S${sceneIndex + 1}.${shotIndex + 1}`;
      const body = compactText(shot.direction || shot.storyboardPrompt || shot.visualPrompt, 220) || undefined;
      return imageCard(title, shot.storyboardUrl || shot.imageUrl, labels, body);
    })
  )).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(project.title)} · Lahari Contact Sheet</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #111114; color: #f4f4f5; }
    body { margin: 0; padding: 32px; background: #111114; }
    header { max-width: 1120px; margin: 0 auto 28px; }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.1; }
    h2 { max-width: 1120px; margin: 32px auto 14px; font-size: 18px; }
    .sub { color: #a1a1aa; margin: 0; }
    .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .pill { border: 1px solid #3f3f46; border-radius: 8px; padding: 6px 10px; color: #d4d4d8; background: #18181b; font-size: 13px; }
    .grid { max-width: 1120px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
    .card { border: 1px solid #27272a; border-radius: 8px; background: #18181b; overflow: hidden; }
    .thumb { aspect-ratio: 16 / 10; background: #09090b; display: grid; place-items: center; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .missing { color: #71717a; font-size: 13px; }
    h3 { margin: 10px 10px 4px; font-size: 14px; }
    p { margin: 6px 10px 12px; color: #d4d4d8; font-size: 12px; line-height: 1.4; }
    .meta { color: #a1a1aa; margin-bottom: 6px; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(project.title)}</h1>
    <p class="sub">${escapeHtml(project.status)} · ${escapeHtml(project.songType || 'unknown')} ${project.isMeditative ? '· meditative' : ''}${project.isNarrative ? '· narrative' : ''}</p>
    <div class="stats">
      <span class="pill">${counts.scenes} scenes</span>
      <span class="pill">${counts.shots} shots</span>
      <span class="pill">${counts.frames}/${counts.shots} frames</span>
      <span class="pill">${counts.videos}/${counts.shots} videos</span>
      <span class="pill">${counts.lockedShots}/${counts.shots} locked</span>
      <span class="pill">${counts.stalePrompts} stale</span>
      <span class="pill">${counts.errors} errors</span>
    </div>
  </header>

  <h2>Style</h2>
  <section class="grid">${styleCards}</section>

  <h2>Characters / Entities</h2>
  <section class="grid">${castCards || '<p>No cast/entities.</p>'}</section>

  <h2>Environments / Locations</h2>
  <section class="grid">${envCards || '<p>No environments/locations.</p>'}</section>

  <h2>Storyboard / Start Frames</h2>
  <section class="grid">${shotCards || '<p>No shots.</p>'}</section>
</body>
</html>`;
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

const journalEntry = (title: string, body: string): string => {
  return `\n\n## ${new Date().toISOString()} — ${title}\n\n${body.trim()}\n`;
};

const readSessionEventCursor = (projectId: string): { seq: number | null; createdAt: string | null } => {
  try {
    const raw = fs.readFileSync(sessionStatePath(projectId), 'utf8');
    const parsed = JSON.parse(raw);
    const seq = Number(parsed?.directorEvents?.lastSeq);
    return {
      seq: Number.isFinite(seq) ? seq : null,
      createdAt: parsed?.directorEvents?.lastSyncedAt || null,
    };
  } catch {
    return { seq: null, createdAt: null };
  }
};

const formatDirectorEvents = (events: DirectorEvent[]): string => {
  if (!events.length) return '- No web studio or Codex apply events since the last attach.';
  return events.map((event) => {
    const target = event.entity_type && event.entity_id ? ` (${event.entity_type}:${event.entity_id})` : '';
    return `- ${event.created_at} [${event.source}/${event.event_type}]${target} ${event.summary}`;
  }).join('\n');
};

const eventSyncSummary = (events: DirectorEvent[], previousCursor: { seq: number | null; createdAt: string | null } = { seq: null, createdAt: null }) => {
  const last = events[events.length - 1] || null;
  const lastSeq = typeof last?.seq === 'number' ? last.seq : previousCursor.seq;
  return {
    newEvents: events.length,
    lastSeq,
    lastSyncedAt: last?.created_at || previousCursor.createdAt,
    recentEvents: events.slice(-10).map((event) => ({
      id: event.id,
      createdAt: event.created_at,
      source: event.source,
      eventType: event.event_type,
      entityType: event.entity_type,
      entityId: event.entity_id,
      summary: event.summary,
    })),
  };
};

const sessionState = (
  project: Project,
  note?: string | null,
  directorEvents = eventSyncSummary([], { seq: null, createdAt: null }),
  projectConfig?: Awaited<ReturnType<typeof getProjectConfigState>>,
) => {
  const checkpoint = deriveCheckpointState(project);
  const diagnosis = deriveDirectorDiagnosis(project);
  return {
    kind: 'lahari.director.session',
    updatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      preset: 'bhakti-music-video',
      imageModel: project.imageModel,
      storyboardProvider: project.storyboardProvider,
      videoModel: project.videoModel,
      textProvider: project.textProvider,
      updatedAt: project.updatedAt,
      webUrl: webStudioUrl(project.id, { step: 'studio' }),
    },
    checkpoint,
    diagnosis,
    directorEvents,
    projectConfig: projectConfig ? {
      preferences: projectConfig.preferences.preferences,
      preferencesHash: projectConfig.preferences.hash,
      warnings: projectConfig.preferences.warnings,
      promptOverrides: Object.values(projectConfig.prompts).map((prompt) => ({
        kind: prompt.kind,
        active: prompt.active,
        source: prompt.source,
        hash: prompt.hash,
        updatedAt: prompt.updatedAt,
      })),
    } : null,
    note: note || null,
    files: {
      state: sessionStatePath(project.id),
      journal: sessionJournalPath(project.id),
      workbench: defaultProjectWorkbenchDir(project),
      directorReport: defaultArtifactPath(project, 'director-report.md'),
      contactSheet: defaultArtifactPath(project, 'contact-sheet.html'),
    },
    guardrails: [
      'Supabase is canonical project truth; .lahari files are Codex desk copies.',
      'Read-only inspection is allowed without approval.',
      'Ask before paid generation, DB writes, lock/unlock changes, deletes, publish, or destructive rewrites.',
      'Use preview/diff artifacts before overwriting creative work.',
    ],
  };
};

export const attachDirectorSession = async (project: Project, note?: string) => {
  const dir = sessionDir(project.id);
  fs.mkdirSync(dir, { recursive: true });

  const previousEventCursor = readSessionEventCursor(project.id);
  const newEvents = await listDirectorEvents(project.id, {
    afterSeq: previousEventCursor.seq,
    afterCreatedAt: previousEventCursor.seq === null ? previousEventCursor.createdAt : null,
    limit: 100,
  });
  const workbench = await hydrateProjectWorkbench(project);
  const state = sessionState(project, note, eventSyncSummary(newEvents, previousEventCursor), workbench.projectConfig);

  const journalPath = sessionJournalPath(project.id);
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Lahari Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }

  const actions = state.checkpoint.recommendedActions.length
    ? state.checkpoint.recommendedActions.map((action) => `- ${action}`).join('\n')
    : '- No deterministic next action.';
  const issues = state.checkpoint.openIssues.length
    ? state.checkpoint.openIssues.map((issue) => `- ${issue}`).join('\n')
    : '- No open issues from deterministic checks.';
  const noteBlock = note ? `\n\nOperator note: ${note}` : '';
  const eventBlock = `\n\nChanges since last attach:\n${formatDirectorEvents(newEvents)}`;

  fs.appendFileSync(journalPath, journalEntry('session attached', `Checkpoint: ${state.checkpoint.label}\n\n${state.checkpoint.summary}${noteBlock}${eventBlock}\n\nBottleneck: ${state.diagnosis.bottleneck}\nNext approved action: ${state.diagnosis.nextApprovedAction}\n\nOpen issues:\n${issues}\n\nRecommended next actions:\n${actions}`));
  fs.writeFileSync(sessionStatePath(project.id), `${JSON.stringify(state, null, 2)}\n`);

  return {
    kind: 'lahari.director.session.attached',
    projectId: project.id,
    projectTitle: project.title,
    suggestedCodexSessionTitle: `Lahari - ${project.title}`,
    artistOpening: `Working on ${project.title}`,
    webUrl: webStudioUrl(project.id, { step: 'studio' }),
    statePath: sessionStatePath(project.id),
    journalPath,
    workbenchDir: workbench.baseDir,
    workbenchArtifacts: workbench.artifacts,
    projectConfig: state.projectConfig,
    checkpoint: state.checkpoint,
    diagnosis: state.diagnosis,
    directorEvents: state.directorEvents,
    sourceOfTruth: 'Supabase is canonical; .lahari files are local Codex desk copies.',
  };
};

export const getDirectorSession = (project: Project) => {
  const statePath = sessionStatePath(project.id);
  const journalPath = sessionJournalPath(project.id);
  const currentState = sessionState(project);

  return {
    kind: 'lahari.director.session.read',
    projectId: project.id,
    exists: fs.existsSync(statePath) || fs.existsSync(journalPath),
    currentState,
    savedState: readJsonFileIfExists(statePath),
    journal: readTextFileIfExists(journalPath),
  };
};

export const addDirectorSessionNote = (project: Project, note: string) => {
  if (!note.trim()) throw new Error('Session note cannot be empty.');

  const dir = sessionDir(project.id);
  fs.mkdirSync(dir, { recursive: true });

  const state = sessionState(project, note);
  fs.writeFileSync(sessionStatePath(project.id), `${JSON.stringify(state, null, 2)}\n`);

  const journalPath = sessionJournalPath(project.id);
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Lahari Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }

  fs.appendFileSync(journalPath, journalEntry('operator note', `${note.trim()}\n\nCheckpoint: ${state.checkpoint.label}`));

  return {
    kind: 'lahari.director.session.note_added',
    projectId: project.id,
    statePath: sessionStatePath(project.id),
    journalPath,
    checkpoint: state.checkpoint,
  };
};

type ShotPromptPreviewShot = {
  id: string;
  sceneIndex: number;
  shotIndex: number;
  duration: number;
  beat: string;
  castNames: string[];
  sceneNarrative: string;
  sceneLyrics: string;
  before: {
    visualPrompt: string;
    motionPrompt: string;
    continuityFrom: string;
    promptsStale: boolean;
  };
  after: {
    visualPrompt: string;
    motionPrompt: string;
    continuityFrom: 'cut' | 'prev_shot';
  };
};

type ShotPromptPreviewFile = {
  kind: 'lahari.preview.rewrite_shot_prompts';
  previewId: string;
  generatedAt: string;
  project: {
    id: string;
    title: string;
    status: string;
    imageModel?: string;
    videoModel?: string;
  };
  model: string;
  userNote: string | null;
  counts: {
    shots: number;
    changed: number;
  };
  artifacts: {
    markdownPath: string;
    jsonPath: string;
    promptPath: string;
  };
  shots: ShotPromptPreviewShot[];
  note: string;
};

const formatPromptBlock = (value?: string | null): string => {
  return value?.trim() ? value.trim() : '_empty_';
};

const buildShotPromptPreviewMarkdown = (
  project: Project,
  preview: {
    previewId: string;
    generatedAt: string;
    userNote?: string;
    model: string;
    shots: ShotPromptPreviewShot[];
    promptPath: string;
    jsonPath: string;
  },
) => {
  const changed = preview.shots.filter((shot) => (
    shot.before.visualPrompt !== shot.after.visualPrompt
    || shot.before.motionPrompt !== shot.after.motionPrompt
    || shot.before.continuityFrom !== shot.after.continuityFrom
  )).length;

  const shotSections = preview.shots.map((shot) => `## Scene ${shot.sceneIndex}, Shot ${shot.shotIndex}

- Shot ID: \`${shot.id}\`
- Duration: ${shot.duration}s
- Cast: ${shot.castNames.join(', ') || 'none'}
- Beat: ${shot.beat || 'None'}
- Continuity: \`${shot.before.continuityFrom || 'cut'}\` -> \`${shot.after.continuityFrom}\`

### Visual Prompt

Before:
${formatPromptBlock(shot.before.visualPrompt)}

After:
${formatPromptBlock(shot.after.visualPrompt)}

### Motion Prompt

Before:
${formatPromptBlock(shot.before.motionPrompt)}

After:
${formatPromptBlock(shot.after.motionPrompt)}
`).join('\n');

  return `# Shot Prompt Rewrite Preview

Generated: ${preview.generatedAt}
Preview ID: \`${preview.previewId}\`
Project: ${project.title}
Project ID: \`${project.id}\`
Model: ${preview.model}
User note: ${preview.userNote || 'None'}

This is a preview only. No Lahari database rows, prompts, stale flags, frames, or videos were changed.

## Summary

- Shots previewed: ${preview.shots.length}
- Shots changed: ${changed}
- JSON artifact: \`${preview.jsonPath}\`
- Runtime prompt artifact: \`${preview.promptPath}\`

${shotSections || 'No shots.'}
`;
};

export const previewRewriteShotPrompts = async (project: Project, userNote?: string) => {
  if (!project.scenes.length) throw new Error('Project has no scenes. Generate a script before previewing shot prompts.');
  const allProjectShots = project.scenes.flatMap((scene) => scene.shots);
  if (!allProjectShots.length) throw new Error('Project has no shots. Generate a script before previewing shot prompts.');

  const castById = namesById(project.cast);
  const firstShotIdsPerScene = new Set<string>();
  const previewShots: ShotPromptPreviewShot[] = [];
  const batchPrompts: string[] = [];
  const BATCH_SIZE = 15;

  const allShots = project.scenes.flatMap((scene, sceneIndex) => {
    if (scene.shots[0]) firstShotIdsPerScene.add(scene.shots[0].id);
    return scene.shots.map((shot, shotIndex) => {
      const castNames = (shot.castIds || []).map((id) => castById.get(id) || id);
      return {
        id: shot.id,
        sceneIndex: sceneIndex + 1,
        shotIndex: shotIndex + 1,
        direction: shot.direction || shot.visualPrompt || '',
        duration: shot.duration,
        castNames,
        sceneNarrative: scene.narrativeDescription || '',
        sceneLyrics: scene.lyrics || '',
        before: {
          visualPrompt: shot.visualPrompt || '',
          motionPrompt: shot.motionPrompt || '',
          continuityFrom: shot.continuityFrom || 'cut',
          promptsStale: !!shot.promptsStale,
        },
      };
    });
  });

  let previousBatchTail: { id: string; visualPrompt: string; motionPrompt: string }[] | undefined;

  for (let i = 0; i < allShots.length; i += BATCH_SIZE) {
    const batch = allShots.slice(i, i + BATCH_SIZE);
    const result = await writeShotPrompts(batch.map((shot) => ({
      id: shot.id,
      direction: shot.direction,
      duration: shot.duration,
      castNames: shot.castNames,
      sceneNarrative: shot.sceneNarrative,
      sceneLyrics: shot.sceneLyrics,
    })), {
      cast: project.cast.map((member) => ({ name: member.name, description: member.description })),
      concept: project.lockedConcept || {},
      userNote,
      songType: project.songType || undefined,
      isNarrative: project.isNarrative ?? undefined,
      isMeditative: project.isMeditative ?? undefined,
    }, previousBatchTail);

    batchPrompts.push(
      allShots.length > BATCH_SIZE
        ? `=== Batch ${Math.floor(i / BATCH_SIZE) + 1} (shots ${i + 1}-${Math.min(i + BATCH_SIZE, allShots.length)}) ===\n${result.prompt}`
        : result.prompt,
    );

    const outputById = new Map(result.shots.map((shot) => [shot.id, shot]));
    for (const shot of batch) {
      const output = outputById.get(shot.id);
      if (!output) throw new Error(`writeShotPrompts preview did not return shot ID ${shot.id}`);
      previewShots.push({
        id: shot.id,
        sceneIndex: shot.sceneIndex,
        shotIndex: shot.shotIndex,
        duration: shot.duration,
        beat: shot.direction,
        castNames: shot.castNames,
        sceneNarrative: shot.sceneNarrative,
        sceneLyrics: shot.sceneLyrics,
        before: shot.before,
        after: {
          visualPrompt: output.visualPrompt || '',
          motionPrompt: output.motionPrompt || '',
          continuityFrom: firstShotIdsPerScene.has(shot.id) ? 'cut' : (output.continuityFrom || 'cut'),
        },
      });
    }

    previousBatchTail = result.shots.slice(-2).map((shot) => ({
      id: shot.id,
      visualPrompt: shot.visualPrompt,
      motionPrompt: shot.motionPrompt,
    }));
  }

  const now = new Date().toISOString();
  const previewId = `${now.replace(/[:.]/g, '-')}-shot-prompts`;
  const promptPath = defaultPreviewPath(project, previewId, 'runtime-prompt.txt');
  const jsonPath = defaultPreviewPath(project, previewId, 'preview.json');
  const markdownPath = defaultPreviewPath(project, previewId, 'preview.md');
  const promptText = batchPrompts.join('\n\n');

  const preview = {
    kind: 'lahari.preview.rewrite_shot_prompts',
    previewId,
    generatedAt: now,
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      imageModel: project.imageModel,
      videoModel: project.videoModel,
    },
    model: 'claude-opus-4-7',
    userNote: userNote || null,
    counts: {
      shots: previewShots.length,
      changed: previewShots.filter((shot) => (
        shot.before.visualPrompt !== shot.after.visualPrompt
        || shot.before.motionPrompt !== shot.after.motionPrompt
        || shot.before.continuityFrom !== shot.after.continuityFrom
      )).length,
    },
    artifacts: {
      markdownPath,
      jsonPath,
      promptPath,
    },
    shots: previewShots,
    note: 'Preview only. No database rows, assets, or stale flags were changed.',
  };

  writeArtifact(promptPath, promptText);
  writeArtifact(jsonPath, `${JSON.stringify(preview, null, 2)}\n`);
  writeArtifact(markdownPath, buildShotPromptPreviewMarkdown(project, {
    previewId,
    generatedAt: now,
    userNote,
    model: preview.model,
    shots: previewShots,
    promptPath,
    jsonPath,
  }));

  return preview;
};

const readShotPromptPreview = (previewJsonPath: string): ShotPromptPreviewFile => {
  const resolved = path.resolve(previewJsonPath);
  if (!fs.existsSync(resolved)) throw new Error(`Preview JSON not found: ${resolved}`);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (parsed?.kind !== 'lahari.preview.rewrite_shot_prompts') {
    throw new Error('Preview JSON is not a lahari.preview.rewrite_shot_prompts artifact.');
  }
  if (!parsed.project?.id || !Array.isArray(parsed.shots)) {
    throw new Error('Preview JSON is missing project ID or shots.');
  }
  return parsed as ShotPromptPreviewFile;
};

export const getRewriteShotPromptsApplyPlan = async (previewJsonPath: string, project: Project) => {
  const preview = readShotPromptPreview(previewJsonPath);
  if (preview.project.id !== project.id) {
    throw new Error(`Preview belongs to project ${preview.project.id}, not loaded project ${project.id}.`);
  }

  const currentShots = new Map<string, ProjectShot>(project.scenes.flatMap((scene) => scene.shots.map((shot) => [shot.id, shot])));
  const missingShotIds = preview.shots.filter((shot) => !currentShots.has(shot.id)).map((shot) => shot.id);
  const driftedShots = preview.shots.filter((shot) => {
    const current = currentShots.get(shot.id);
    if (!current) return false;
    return (current.visualPrompt || '') !== (shot.before.visualPrompt || '')
      || (current.motionPrompt || '') !== (shot.before.motionPrompt || '')
      || (current.continuityFrom || 'cut') !== (shot.before.continuityFrom || 'cut');
  }).map((shot) => shot.id);
  const changedShots = preview.shots.filter((shot) => (
    shot.before.visualPrompt !== shot.after.visualPrompt
    || shot.before.motionPrompt !== shot.after.motionPrompt
    || shot.before.continuityFrom !== shot.after.continuityFrom
  ));
  const hasShots = preview.shots.length > 0;

  return {
    kind: 'lahari.apply_plan.rewrite_shot_prompts',
    previewId: preview.previewId,
    previewPath: path.resolve(previewJsonPath),
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
    },
    counts: {
      previewShots: preview.shots.length,
      changedShots: changedShots.length,
      missingShots: missingShotIds.length,
      driftedShots: driftedShots.length,
    },
    missingShotIds,
    driftedShotIds: driftedShots,
    canApply: hasShots && missingShotIds.length === 0 && driftedShots.length === 0,
    note: !hasShots
      ? 'Refusing to apply an empty preview.'
      : missingShotIds.length || driftedShots.length
      ? 'Refusing to apply until missing/drifted shots are resolved. Regenerate a fresh preview.'
      : 'Ready to apply. This will update shot prompts/continuity and clear prompts_stale for previewed shots.',
  };
};

export const applyRewriteShotPromptsPreview = async (previewJsonPath: string, project: Project) => {
  const preview = readShotPromptPreview(previewJsonPath);
  const plan = await getRewriteShotPromptsApplyPlan(previewJsonPath, project);
  if (!plan.canApply) {
    throw new Error(`${plan.note} Missing: ${plan.missingShotIds.join(', ') || 'none'}. Drifted: ${plan.driftedShotIds.join(', ') || 'none'}.`);
  }

  for (const shot of preview.shots) {
    await updateRows('shots', { id: shot.id }, {
      visual_prompt: shot.after.visualPrompt || '',
      motion_prompt: shot.after.motionPrompt || '',
      continuity_from: shot.after.continuityFrom || 'cut',
      prompts_stale: false,
    });
  }

  const promptText = preview.artifacts?.promptPath && fs.existsSync(preview.artifacts.promptPath)
    ? fs.readFileSync(preview.artifacts.promptPath, 'utf8')
    : undefined;
  await updateRows('projects', { id: project.id }, {
    ...(promptText ? { last_write_shots_prompt: promptText } : {}),
    updated_at: new Date().toISOString(),
  });

  const changed = preview.shots.filter((shot) => (
    shot.before.visualPrompt !== shot.after.visualPrompt
    || shot.before.motionPrompt !== shot.after.motionPrompt
    || shot.before.continuityFrom !== shot.after.continuityFrom
  ));
  const journalPath = sessionJournalPath(project.id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Lahari Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }
  fs.appendFileSync(journalPath, journalEntry('applied shot prompt preview', `Preview ID: ${preview.previewId}\nPreview JSON: ${path.resolve(previewJsonPath)}\nShots updated: ${preview.shots.length}\nChanged shots: ${changed.length}\n\nNo frames, videos, assets, or locks were changed.`));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'shot_prompts_preview_applied',
    entityType: 'project',
    entityId: project.id,
    summary: `Applied shot prompt preview ${preview.previewId}; ${preview.shots.length} shots updated, ${changed.length} changed.`,
    payload: {
      previewId: preview.previewId,
      previewJsonPath: path.resolve(previewJsonPath),
      shotsUpdated: preview.shots.length,
      changedShots: changed.length,
      changedShotIds: changed.map((shot) => shot.id),
    },
  });

  return {
    kind: 'lahari.apply.rewrite_shot_prompts',
    previewId: preview.previewId,
    projectId: project.id,
    shotsUpdated: preview.shots.length,
    changedShots: changed.length,
    journalPath,
    note: 'Applied preview to Supabase. Updated visual_prompt, motion_prompt, continuity_from, prompts_stale=false, and project last_write_shots_prompt when available.',
  };
};

type StoryboardPromptPreviewFile = {
  kind: 'lahari.preview.rewrite_storyboard_prompt';
  previewId: string;
  generatedAt: string;
  project: { id: string; title: string; status: string; textProvider?: string; storyboardProvider?: string };
  shot: {
    id: string;
    sceneIndex: number;
    shotIndex: number;
    beat: string;
    before: {
      storyboardPrompt: string;
      storyboardCutPlan: string;
      promptsStale: boolean;
    };
    after: {
      storyboardPrompt: string;
      storyboardCutPlan: string;
    };
  };
  model: string;
  costEstimate: number;
  userNote: string | null;
  artifacts: { markdownPath: string; jsonPath: string; promptPath: string };
  note: string;
};

const buildStoryboardPromptPreviewMarkdown = (preview: StoryboardPromptPreviewFile) => {
  return `# Storyboard Prompt Preview

Generated: ${preview.generatedAt}
Preview ID: \`${preview.previewId}\`
Project: ${preview.project.title}
Project ID: \`${preview.project.id}\`
Shot ID: \`${preview.shot.id}\`
Model: ${preview.model}
Estimated cost: ${preview.costEstimate}
User note: ${preview.userNote || 'None'}

This is a preview only. No Lahari database rows, assets, stale flags, frames, videos, or locks were changed.

## Shot

- Scene ${preview.shot.sceneIndex}, Shot ${preview.shot.shotIndex}
- Beat: ${preview.shot.beat || 'None'}
- JSON artifact: \`${preview.artifacts.jsonPath}\`
- Runtime prompt artifact: \`${preview.artifacts.promptPath}\`

## Storyboard Prompt

Before:
${formatPromptBlock(preview.shot.before.storyboardPrompt)}

After:
${formatPromptBlock(preview.shot.after.storyboardPrompt)}

## Cut Plan

Before:
${formatPromptBlock(preview.shot.before.storyboardCutPlan)}

After:
${formatPromptBlock(preview.shot.after.storyboardCutPlan)}
`;
};

export const previewRewriteStoryboardPrompt = async (project: Project, shotId: string, userNote?: string) => {
  let target: { shot: ProjectShot; sceneIndex: number; shotIndex: number } | null = null;
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    const shotIndex = scene.shots.findIndex((shot) => shot.id === shotId);
    if (shotIndex >= 0) {
      target = { shot: scene.shots[shotIndex], sceneIndex: sceneIndex + 1, shotIndex: shotIndex + 1 };
      break;
    }
  }
  if (!target) throw new Error(`Shot not found in project: ${shotId}`);

  const result = await planStoryboardPrompt({
    projectId: project.id,
    shotId,
    variant: 'adaptive_numbered_storyboard',
    artistNote: userNote,
  });

  const now = new Date().toISOString();
  const previewId = `${now.replace(/[:.]/g, '-')}-storyboard-prompt-${shotId.slice(0, 8)}`;
  const promptPath = defaultPreviewPath(project, previewId, 'runtime-prompt.txt');
  const jsonPath = defaultPreviewPath(project, previewId, 'preview.json');
  const markdownPath = defaultPreviewPath(project, previewId, 'preview.md');

  const preview: StoryboardPromptPreviewFile = {
    kind: 'lahari.preview.rewrite_storyboard_prompt',
    previewId,
    generatedAt: now,
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      textProvider: project.textProvider,
      storyboardProvider: project.storyboardProvider,
    },
    shot: {
      id: shotId,
      sceneIndex: target.sceneIndex,
      shotIndex: target.shotIndex,
      beat: target.shot.direction || target.shot.storyboardPrompt || target.shot.visualPrompt || '',
      before: {
        storyboardPrompt: target.shot.storyboardPrompt || '',
        storyboardCutPlan: target.shot.storyboardCutPlan || '',
        promptsStale: !!target.shot.promptsStale,
      },
      after: {
        storyboardPrompt: result.storyboardPrompt,
        storyboardCutPlan: result.cutPlanText,
      },
    },
    model: result.model,
    costEstimate: result.costEstimate,
    userNote: userNote || null,
    artifacts: { markdownPath, jsonPath, promptPath },
    note: 'Preview only. No database rows, assets, stale flags, frames, videos, or locks were changed.',
  };

  writeArtifact(promptPath, result.runtimePrompt);
  writeArtifact(jsonPath, `${JSON.stringify(preview, null, 2)}\n`);
  writeArtifact(markdownPath, buildStoryboardPromptPreviewMarkdown(preview));
  return preview;
};

const readStoryboardPromptPreview = (previewJsonPath: string): StoryboardPromptPreviewFile => {
  const resolved = path.resolve(previewJsonPath);
  if (!fs.existsSync(resolved)) throw new Error(`Preview JSON not found: ${resolved}`);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (parsed?.kind !== 'lahari.preview.rewrite_storyboard_prompt') {
    throw new Error('Preview JSON is not a lahari.preview.rewrite_storyboard_prompt artifact.');
  }
  if (!parsed.project?.id || !parsed.shot?.id) {
    throw new Error('Preview JSON is missing project or shot ID.');
  }
  return parsed as StoryboardPromptPreviewFile;
};

export const getRewriteStoryboardPromptApplyPlan = async (previewJsonPath: string, project: Project) => {
  const preview = readStoryboardPromptPreview(previewJsonPath);
  if (preview.project.id !== project.id) {
    throw new Error(`Preview belongs to project ${preview.project.id}, not loaded project ${project.id}.`);
  }
  const current = project.scenes.flatMap((scene) => scene.shots).find((shot) => shot.id === preview.shot.id);
  const missingShot = !current;
  const drifted = current
    ? (current.storyboardPrompt || '') !== (preview.shot.before.storyboardPrompt || '')
      || (current.storyboardCutPlan || '') !== (preview.shot.before.storyboardCutPlan || '')
    : false;
  const changed = preview.shot.before.storyboardPrompt !== preview.shot.after.storyboardPrompt
    || preview.shot.before.storyboardCutPlan !== preview.shot.after.storyboardCutPlan;

  return {
    kind: 'lahari.apply_plan.rewrite_storyboard_prompt',
    previewId: preview.previewId,
    previewPath: path.resolve(previewJsonPath),
    project: { id: project.id, title: project.title, status: project.status },
    shotId: preview.shot.id,
    counts: {
      changed: changed ? 1 : 0,
      missingShots: missingShot ? 1 : 0,
      driftedShots: drifted ? 1 : 0,
    },
    canApply: changed && !missingShot && !drifted,
    note: missingShot
      ? 'Refusing to apply because the previewed shot no longer exists.'
      : drifted
      ? 'Refusing to apply because the current storyboard prompt/cut plan drifted. Regenerate a fresh preview.'
      : changed
      ? 'Ready to apply. This will update storyboard_prompt, storyboard_cut_plan, storyboard_prompt_status, prompts_stale=false, and mark storyboard/video stale for review.'
      : 'Nothing changed in the preview.',
  };
};

export const applyRewriteStoryboardPromptPreview = async (previewJsonPath: string, project: Project) => {
  const preview = readStoryboardPromptPreview(previewJsonPath);
  const plan = await getRewriteStoryboardPromptApplyPlan(previewJsonPath, project);
  if (!plan.canApply) throw new Error(plan.note);
  const current = project.scenes.flatMap((scene) => scene.shots).find((shot) => shot.id === preview.shot.id);

  await updateRows('shots', { id: preview.shot.id }, {
    storyboard_prompt: preview.shot.after.storyboardPrompt,
    storyboard_cut_plan: preview.shot.after.storyboardCutPlan,
    storyboard_prompt_status: 'success',
    storyboard_prompt_user_feedback: preview.userNote,
    prompts_stale: false,
    ...(current?.storyboardUrl ? { storyboard_status: 'stale' } : {}),
    ...(current?.videoUrl ? { video_status: 'stale' } : {}),
    last_error: null,
  });

  const journalPath = sessionJournalPath(project.id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Lahari Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }
  fs.appendFileSync(journalPath, journalEntry('applied storyboard prompt preview', `Preview ID: ${preview.previewId}\nPreview JSON: ${path.resolve(previewJsonPath)}\nShot updated: ${preview.shot.id}\n\nExisting storyboard/video outputs were marked stale for review when present. No assets or locks were changed.`));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboard_prompt_preview_applied',
    entityType: 'shot',
    entityId: preview.shot.id,
    summary: `Applied storyboard prompt preview ${preview.previewId} for ${shotLabel(preview.shot.sceneIndex - 1, preview.shot.shotIndex - 1)}.`,
    payload: {
      previewId: preview.previewId,
      previewJsonPath: path.resolve(previewJsonPath),
      shotId: preview.shot.id,
      markedStoryboardStale: !!current?.storyboardUrl,
      markedVideoStale: !!current?.videoUrl,
    },
  });

  return {
    kind: 'lahari.apply.rewrite_storyboard_prompt',
    previewId: preview.previewId,
    projectId: project.id,
    shotId: preview.shot.id,
    journalPath,
    note: 'Applied preview to Supabase. Updated storyboard prompt/cut plan, cleared prompt stale state, and marked existing storyboard/video outputs stale.',
  };
};

const findProjectShot = (project: Project, shotId: string): { shot: ProjectShot; sceneIndex: number; shotIndex: number } | null => {
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    const shotIndex = scene.shots.findIndex((shot) => shot.id === shotId);
    if (shotIndex >= 0) return { shot: scene.shots[shotIndex], sceneIndex: sceneIndex + 1, shotIndex: shotIndex + 1 };
  }
  return null;
};

const roundCost = (cost: number): number => Number(cost.toFixed(3));

const allProjectShots = (project: Project) => {
  const items: { shot: ProjectShot; sceneIndex: number; shotIndex: number }[] = [];
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    for (const [shotIndex, shot] of scene.shots.entries()) {
      items.push({ shot, sceneIndex: sceneIndex + 1, shotIndex: shotIndex + 1 });
    }
  }
  return items;
};

const filterShotTargets = (project: Project, shotIds?: string[]) => {
  const requested = new Set((shotIds || []).filter(Boolean));
  const targets = allProjectShots(project).filter((target) => !requested.size || requested.has(target.shot.id));
  if (requested.size && targets.length !== requested.size) {
    const found = new Set(targets.map((target) => target.shot.id));
    const missing = [...requested].filter((id) => !found.has(id));
    throw new Error(`Shot(s) not found in project: ${missing.join(', ')}`);
  }
  return targets;
};

const storyboardPromptCostEstimate = () => roundCost(Number(process.env.STORYBOARD_PROMPT_WRITE_COST_ESTIMATE || process.env.OPENAI_STORYBOARD_PLAN_COST_ESTIMATE || 0.02));

export const planGenerateStoryboard = (project: Project, shotId: string) => {
  const target = findProjectShot(project, shotId);
  if (!target) throw new Error(`Shot not found in project: ${shotId}`);
  const provider = getStoryboardProvider(project.storyboardProvider);
  const shot = target.shot;
  const prerequisites = [
    shot.storyboardPrompt ? null : 'Saved storyboard_prompt is required.',
    shot.locked ? 'Shot is locked; unlock before generating a new storyboard board.' : null,
    shot.storyboardLocked ? 'Storyboard board is locked; unlock before generating a replacement board.' : null,
  ].filter(Boolean) as string[];
  const willOverwrite = !!shot.storyboardUrl;
  const willChange = [
    'Create a new shot_storyboard asset and storyboard_versions row.',
    'Set this shot storyboard_asset_id/storyboard_version_id to the new board.',
    'Set storyboard_status=success and storyboard_locked=false.',
    'Set video_status=stale so video is reviewed/regenerated against the new board.',
    willOverwrite ? 'Replace the active storyboard pointer; old board remains in version history.' : null,
  ].filter(Boolean) as string[];
  const costEstimate = roundCost(provider.provider === 'segmind'
    ? Number(process.env.SEGMIND_STORYBOARD_RENDER_COST_ESTIMATE || 0.03)
    : provider.provider === 'google'
    ? Number(process.env.GEMINI_STORYBOARD_RENDER_COST_ESTIMATE || 0.04)
    : Number(process.env.OPENAI_STORYBOARD_RENDER_COST_ESTIMATE || process.env.OPENAI_STORYBOARD_COST_ESTIMATE || 0.12));

  return {
    kind: 'lahari.generation_plan.storyboard',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      storyboardProvider: project.storyboardProvider,
      aspectRatio: project.aspectRatio,
    },
    shot: {
      id: shot.id,
      sceneIndex: target.sceneIndex,
      shotIndex: target.shotIndex,
      beat: compactText(shot.direction || shot.storyboardPrompt || shot.visualPrompt, 260),
      hasStoryboardPrompt: !!shot.storyboardPrompt,
      hasStoryboard: !!shot.storyboardUrl,
      storyboardLocked: !!shot.storyboardLocked,
      videoStatus: shot.videoStatus,
    },
    provider: {
      key: provider.key,
      model: provider.runtimeModel,
      provider: provider.provider,
    },
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'generate-storyboard' }),
    paid: true,
    estimatedCost: costEstimate,
    canRun: prerequisites.length === 0,
    prerequisites,
    willOverwrite,
    willChange,
    approval: `Generate a new storyboard board for ${project.title} ${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)} using ${provider.label}. Estimated cost: $${costEstimate.toFixed(3)}. ${willOverwrite ? 'This will replace the active board pointer and keep the old board in history.' : 'This will create the first active board for this shot.'}`,
  };
};

export const buildStoryboardStatus = (project: Project) => {
  const shots: any[] = [];
  const summary = {
    scenes: project.scenes.length,
    shots: 0,
    promptsReady: 0,
    promptsMissing: 0,
    promptsStale: 0,
    boardsReady: 0,
    boardsMissing: 0,
    boardsStale: 0,
    boardsLocked: 0,
    videosReady: 0,
    videosMissing: 0,
    videosStale: 0,
    shotsLocked: 0,
  };

  for (const [sceneIndex, scene] of project.scenes.entries()) {
    for (const [shotIndex, shot] of scene.shots.entries()) {
      summary.shots += 1;
      if (shot.storyboardPrompt) summary.promptsReady += 1;
      else summary.promptsMissing += 1;
      if (shot.promptsStale || shot.storyboardPromptStatus === 'stale') summary.promptsStale += 1;
      if (shot.storyboardUrl) summary.boardsReady += 1;
      else summary.boardsMissing += 1;
      if (shot.storyboardStatus === 'stale') summary.boardsStale += 1;
      if (shot.storyboardLocked) summary.boardsLocked += 1;
      if (shot.videoUrl) summary.videosReady += 1;
      else summary.videosMissing += 1;
      if (shot.videoStatus === 'stale') summary.videosStale += 1;
      if (shot.locked) summary.shotsLocked += 1;

      const readiness = [
        !shot.storyboardPrompt ? 'missing storyboard prompt' : null,
        shot.promptsStale || shot.storyboardPromptStatus === 'stale' ? 'prompt stale' : null,
        shot.storyboardPromptStatus === 'error' ? 'prompt writer error' : null,
        !shot.storyboardUrl ? 'missing board' : null,
        shot.storyboardStatus === 'stale' ? 'board stale' : null,
        shot.storyboardStatus === 'error' ? 'board generation error' : null,
        shot.storyboardUrl && !shot.storyboardLocked ? 'board needs review/lock' : null,
        project.videoModel?.startsWith('seedance') && shot.storyboardUrl && !shot.storyboardLocked ? 'video blocked until board lock' : null,
        shot.videoStatus === 'stale' ? 'video stale' : null,
        shot.lastError ? `last error: ${compactText(shot.lastError, 180)}` : null,
      ].filter(Boolean);

      const label = shotLabel(sceneIndex, shotIndex);
      const needsBoard = shot.storyboardPrompt && (!shot.storyboardUrl || shot.storyboardStatus === 'stale' || shot.storyboardStatus === 'error') && !shot.locked;
      const nextAction = needsBoard ? {
        kind: 'generate_storyboard',
        canRun: true,
        paid: true,
        cli: `npm run lahari -- apply generate-storyboard ${project.id} ${shot.id}`,
        mcpTool: 'apply_generate_storyboard',
        webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'generate-storyboard' }),
      } : shot.storyboardUrl && !shot.storyboardLocked ? {
        kind: 'lock_storyboard',
        canRun: true,
        paid: false,
        cli: `npm run lahari -- apply lock-storyboard ${project.id} ${shot.id}`,
        mcpTool: 'lock_storyboard',
        webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'review-storyboard' }),
      } : null;

      shots.push({
        id: shot.id,
        label,
        scene: scene.sectionLabel,
        beat: compactText(shot.direction || shot.storyboardPrompt || shot.visualPrompt, 220),
        duration: shot.duration,
        prompt: {
          has: !!shot.storyboardPrompt,
          status: shot.storyboardPromptStatus,
          chars: (shot.storyboardPrompt || '').length,
          cutPlanChars: (shot.storyboardCutPlan || '').length,
          stale: !!shot.promptsStale || shot.storyboardPromptStatus === 'stale',
        },
        board: {
          has: !!shot.storyboardUrl,
          status: shot.storyboardStatus,
          locked: !!shot.storyboardLocked,
          assetId: shot.storyboardAssetId || null,
          versionId: shot.storyboardVersionId || null,
          url: shot.storyboardUrl || null,
        },
        video: {
          has: !!shot.videoUrl,
          status: shot.videoStatus,
          locked: !!shot.locked,
          url: shot.videoUrl || null,
        },
        readiness,
        nextAction,
        webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'review-storyboard' }),
      });
    }
  }

  return {
    kind: 'lahari.storyboard.status',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      storyboardProvider: project.storyboardProvider,
      videoModel: project.videoModel,
    },
    summary,
    shots,
  };
};

export const writeStoryboardPromptForShot = async (project: Project, shotId: string, opts: {
  artistNote?: string;
  variant?: StoryboardPromptVariant;
  artistReferenceImagePath?: string;
} = {}) => {
  const target = findProjectShot(project, shotId);
  if (!target) throw new Error(`Shot not found in project: ${shotId}`);
  if (target.shot.locked) throw new Error('Cannot write storyboard prompt: shot is locked.');

  const result = await writeStoryboardPrompt({
    projectId: project.id,
    shotId,
    variant: opts.variant,
    artistNote: opts.artistNote,
    artistReferenceImagePath: opts.artistReferenceImagePath,
  });
  const estimatedCost = storyboardPromptCostEstimate();
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: opts.artistNote ? 'storyboard_prompt_refined' : 'storyboard_prompt_written',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex ${opts.artistNote ? 'refined' : 'wrote'} storyboard prompt and cut plan for ${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)}.`,
    payload: {
      artistNote: opts.artistNote || null,
      variant: opts.variant || 'adaptive_numbered_storyboard',
      estimatedCost,
      promptChars: result.storyboardPrompt.length,
      cutPlanChars: result.cutPlanText.length,
    },
  });

  return {
    kind: 'lahari.apply.write_storyboard_prompt',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    shot: {
      id: shotId,
      label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
      beat: compactText(target.shot.direction || target.shot.visualPrompt, 220),
    },
    paid: true,
    estimatedCost,
    result: {
      storyboardPromptChars: result.storyboardPrompt.length,
      cutPlanChars: result.cutPlanText.length,
      storyboardPrompt: compactText(result.storyboardPrompt, 900),
      cutPlanText: compactText(result.cutPlanText, 700),
    },
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard-prompt' }),
    note: 'Saved storyboard_prompt and storyboard_cut_plan on the shot.',
  };
};

export const bulkWriteStoryboardPrompts = async (project: Project, opts: {
  shotIds?: string[];
  force?: boolean;
  artistNote?: string;
  variant?: StoryboardPromptVariant;
  artistReferenceImagePath?: string;
} = {}) => {
  const targets = filterShotTargets(project, opts.shotIds);
  const selected = targets.filter(({ shot }) => {
    if (shot.locked) return false;
    if (opts.force) return true;
    return !shot.storyboardPrompt || shot.storyboardPromptStatus === 'error';
  });
  const skipped = targets
    .filter((target) => !selected.some((item) => item.shot.id === target.shot.id))
    .map(({ shot, sceneIndex, shotIndex }) => ({
      shotId: shot.id,
      label: shotLabel(sceneIndex - 1, shotIndex - 1),
      reason: shot.locked ? 'shot locked' : opts.force ? 'not selected' : 'prompt already present',
    }));
  const estimatedCost = roundCost(selected.length * storyboardPromptCostEstimate());
  const results: any[] = [];

  for (const target of selected) {
    try {
      const result = await writeStoryboardPromptForShot(project, target.shot.id, opts);
      results.push({ shotId: target.shot.id, label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1), ok: true, result: result.result });
    } catch (error) {
      results.push({
        shotId: target.shot.id,
        label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboard_prompts_bulk_written',
    entityType: 'project',
    entityId: project.id,
    summary: `Codex bulk wrote storyboard prompts for ${results.filter((row) => row.ok).length} shot(s).`,
    payload: {
      requestedShotIds: opts.shotIds || null,
      force: !!opts.force,
      estimatedCost,
      results: results.map((row) => ({ shotId: row.shotId, label: row.label, ok: row.ok, error: row.error || null })),
      skipped,
    },
  });

  return {
    kind: 'lahari.apply.bulk_write_storyboard_prompts',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    paid: true,
    estimatedCost,
    counts: {
      requested: targets.length,
      selected: selected.length,
      succeeded: results.filter((row) => row.ok).length,
      failed: results.filter((row) => !row.ok).length,
      skipped: skipped.length,
    },
    results,
    skipped,
    note: opts.force
      ? 'Force mode rewrote selected unlocked storyboard prompts.'
      : 'Default mode wrote only missing/error storyboard prompts and skipped locked or already-ready shots.',
  };
};

export const planGenerateVideo = (project: Project, shotId: string) => {
  const target = findProjectShot(project, shotId);
  if (!target) throw new Error(`Shot not found in project: ${shotId}`);
  const shot = target.shot;
  const model = getVideoModel(project.videoModel);
  const storyboardMode = model.key.startsWith('seedance') && !!shot.storyboardLocked && !!shot.storyboardUrl;
  const prerequisites = [
    storyboardMode || shot.imageUrl ? null : model.key.startsWith('seedance')
      ? 'Locked storyboard board or start frame is required.'
      : 'Start frame is required.',
    model.key.startsWith('seedance') && shot.storyboardUrl && !shot.storyboardLocked ? 'Storyboard board exists but is not locked.' : null,
    shot.locked ? 'Shot is locked; unlock before regenerating video.' : null,
  ].filter(Boolean) as string[];
  const duration = Number(shot.duration || model.durations[0] || 5);
  const estimatedCost = roundCost(duration * model.costPerSec);
  const willOverwrite = !!shot.videoUrl;
  const willChange = [
    'Create a new shot_video asset.',
    'Set this shot video_asset_id to the new video.',
    'Attempt to extract and store the real last frame.',
    'Set video_status=success on completion.',
    storyboardMode ? 'Use locked storyboard board as the primary Seedance reference.' : 'Use start keyframe as the primary video reference.',
    willOverwrite ? 'Replace the active video pointer; old video remains in asset history.' : null,
  ].filter(Boolean) as string[];

  return {
    kind: 'lahari.generation_plan.video',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      videoModel: project.videoModel,
      aspectRatio: project.aspectRatio,
      videoResolution: project.videoResolution,
    },
    shot: {
      id: shot.id,
      sceneIndex: target.sceneIndex,
      shotIndex: target.shotIndex,
      beat: compactText(shot.direction || shot.storyboardPrompt || shot.visualPrompt, 260),
      duration,
      hasStartFrame: !!shot.imageUrl,
      hasStoryboard: !!shot.storyboardUrl,
      storyboardLocked: !!shot.storyboardLocked,
      hasVideo: !!shot.videoUrl,
      locked: !!shot.locked,
      videoStatus: shot.videoStatus,
    },
    mode: storyboardMode ? 'storyboard' : 'keyframe',
    model: {
      key: model.key,
      label: model.label,
      costPerSec: model.costPerSec,
      supportsRefs: model.supportsRefs,
      supportsLastFrame: model.supportsLastFrame,
    },
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'generate-video' }),
    paid: true,
    estimatedCost,
    canRun: prerequisites.length === 0,
    prerequisites,
    willOverwrite,
    willChange,
    approval: `Generate a ${duration}s ${model.label} video for ${project.title} ${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)} in ${storyboardMode ? 'storyboard' : 'keyframe'} mode. Estimated cost: $${estimatedCost.toFixed(3)}. ${willOverwrite ? 'This will replace the active video pointer and keep the old video in history.' : 'This will create the first active video for this shot.'}`,
  };
};

export const applyGenerateStoryboard = async (project: Project, shotId: string, artistNote?: string) => {
  const plan = planGenerateStoryboard(project, shotId);
  if (!plan.canRun) {
    throw new Error(`Cannot generate storyboard: ${plan.prerequisites.join(' ')}`);
  }

  const result = await generateStoryboardVersion({
    projectId: project.id,
    shotId,
    artistNote,
  });
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboard_generated',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex generated a storyboard board for ${shotLabel(plan.shot.sceneIndex - 1, plan.shot.shotIndex - 1)}.`,
    payload: {
      artistNote: artistNote || null,
      provider: plan.provider,
      estimatedCost: plan.estimatedCost,
      result: eventResultPointers(result),
    },
  });

  return {
    kind: 'lahari.generation_result.storyboard',
    generatedAt: new Date().toISOString(),
    project: plan.project,
    shot: plan.shot,
    provider: plan.provider,
    estimatedCost: plan.estimatedCost,
    appliedPlan: {
      willOverwrite: plan.willOverwrite,
      willChange: plan.willChange,
    },
    result,
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' }),
    note: 'Generated storyboard board, updated the active storyboard pointer, unlocked the board for review, and marked video stale.',
  };
};

export const bulkGenerateStoryboards = async (project: Project, opts: {
  shotIds?: string[];
  force?: boolean;
  artistNote?: string;
} = {}) => {
  const targets = filterShotTargets(project, opts.shotIds);
  const candidates = targets.map((target) => {
    const shot = target.shot;
    const plan = shot.storyboardPrompt ? planGenerateStoryboard(project, shot.id) : null;
    const shouldRun = !!plan
      && plan.canRun
      && !shot.storyboardLocked
      && (opts.force || !shot.storyboardUrl || shot.storyboardStatus === 'stale' || shot.storyboardStatus === 'error');
    const skipReason = shot.locked ? 'shot locked'
      : shot.storyboardLocked ? 'storyboard locked'
      : !shot.storyboardPrompt ? 'missing storyboard prompt'
      : !plan?.canRun ? plan?.prerequisites.join('; ') || 'not runnable'
      : !opts.force && shot.storyboardUrl && shot.storyboardStatus !== 'stale' && shot.storyboardStatus !== 'error' ? 'board already present'
      : null;
    return { ...target, plan, shouldRun, skipReason };
  });
  const selected = candidates.filter((target) => target.shouldRun && target.plan);
  const skipped = candidates
    .filter((target) => !target.shouldRun)
    .map((target) => ({
      shotId: target.shot.id,
      label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
      reason: target.skipReason || 'not selected',
    }));
  const estimatedCost = roundCost(selected.reduce((sum, target) => sum + Number(target.plan?.estimatedCost || 0), 0));
  const results: any[] = [];

  for (const target of selected) {
    try {
      const result = await applyGenerateStoryboard(project, target.shot.id, opts.artistNote);
      results.push({
        shotId: target.shot.id,
        label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
        ok: true,
        estimatedCost: result.estimatedCost,
        result: eventResultPointers(result.result),
        webUrl: result.webUrl,
      });
    } catch (error) {
      results.push({
        shotId: target.shot.id,
        label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboards_bulk_generated',
    entityType: 'project',
    entityId: project.id,
    summary: `Codex bulk generated storyboard boards for ${results.filter((row) => row.ok).length} shot(s).`,
    payload: {
      requestedShotIds: opts.shotIds || null,
      force: !!opts.force,
      artistNote: opts.artistNote || null,
      estimatedCost,
      results: results.map((row) => ({ shotId: row.shotId, label: row.label, ok: row.ok, error: row.error || null, result: row.result || null })),
      skipped,
    },
  });

  return {
    kind: 'lahari.generation_result.bulk_storyboards',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title, storyboardProvider: project.storyboardProvider },
    paid: true,
    estimatedCost,
    counts: {
      requested: targets.length,
      selected: selected.length,
      succeeded: results.filter((row) => row.ok).length,
      failed: results.filter((row) => !row.ok).length,
      skipped: skipped.length,
    },
    results,
    skipped,
    note: opts.force
      ? 'Force mode generated storyboard boards for selected unlocked shots with saved prompts.'
      : 'Default mode generated only missing/stale/error unlocked storyboard boards with saved prompts.',
  };
};

export const refineStoryboardImage = async (project: Project, shotId: string, opts: {
  feedback: string;
  previousVersionId?: string;
  artistReferenceImagePath?: string;
}) => {
  const target = findProjectShot(project, shotId);
  if (!target) throw new Error(`Shot not found in project: ${shotId}`);
  if (target.shot.locked) throw new Error('Cannot refine storyboard image: shot is locked.');
  if (!target.shot.storyboardUrl && !opts.previousVersionId) {
    throw new Error('Cannot refine storyboard image: generate a storyboard board first.');
  }
  const plan = planGenerateStoryboard(project, shotId);
  const result = await generateStoryboardVersion({
    projectId: project.id,
    shotId,
    artistNote: opts.feedback,
    previousVersionId: opts.previousVersionId,
    refineMode: 'edit_image',
    artistReferenceImagePath: opts.artistReferenceImagePath,
  });
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboard_refined',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex refined the storyboard image for ${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)}.`,
    payload: {
      feedback: opts.feedback,
      previousVersionId: opts.previousVersionId || target.shot.storyboardVersionId || null,
      provider: plan.provider,
      estimatedCost: plan.estimatedCost,
      result: eventResultPointers(result),
    },
  });

  return {
    kind: 'lahari.generation_result.refine_storyboard_image',
    generatedAt: new Date().toISOString(),
    project: plan.project,
    shot: plan.shot,
    provider: plan.provider,
    paid: true,
    estimatedCost: plan.estimatedCost,
    result,
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' }),
    note: 'Refined storyboard image in edit-image mode, updated active storyboard pointer, unlocked board for review, and marked video stale.',
  };
};

export const lockStoryboardBoard = async (project: Project, shotId: string, versionId?: string) => {
  const target = findProjectShot(project, shotId);
  if (!target) throw new Error(`Shot not found in project: ${shotId}`);
  if (!target.shot.storyboardUrl && !versionId) {
    throw new Error('Cannot lock storyboard: this shot has no active storyboard board.');
  }

  const targetVersionId = versionId || target.shot.storyboardVersionId || null;
  await lockStoryboardVersion(project.id, shotId, versionId);
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboard_locked',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex locked the storyboard board for ${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)}.`,
    payload: {
      versionId: targetVersionId,
      webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' }),
    },
  });

  return {
    kind: 'lahari.apply.lock_storyboard',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    shot: {
      id: shotId,
      label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
      versionId: targetVersionId,
    },
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' }),
    note: 'Locked the active storyboard board. Video generation can now use this board as a trusted reference.',
  };
};

export const unlockStoryboardBoard = async (project: Project, shotId: string) => {
  const target = findProjectShot(project, shotId);
  if (!target) throw new Error(`Shot not found in project: ${shotId}`);

  await unlockStoryboardVersion(project.id, shotId);
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboard_unlocked',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex unlocked the storyboard board for ${shotLabel(target.sceneIndex - 1, target.shotIndex - 1)}.`,
    payload: {
      previousVersionId: target.shot.storyboardVersionId || null,
      webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' }),
    },
  });

  return {
    kind: 'lahari.apply.unlock_storyboard',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    shot: {
      id: shotId,
      label: shotLabel(target.sceneIndex - 1, target.shotIndex - 1),
      previousVersionId: target.shot.storyboardVersionId || null,
    },
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-storyboard' }),
    note: 'Unlocked the storyboard board for further review or regeneration.',
  };
};

export const applyProjectPreferencesConfig = async (
  project: Project,
  preferences: unknown,
  baseHash?: string | null,
) => {
  const result = await applyProjectPreferences(project, preferences, baseHash);
  const configCopy = await writeProjectConfigDeskCopy(project, defaultProjectWorkbenchDir(project));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'project_preferences_applied',
    entityType: 'project',
    entityId: project.id,
    summary: 'Codex applied project-level generation preferences.',
    payload: {
      baseHash: baseHash || null,
      newHash: result.hash,
      preferences: result.preferences,
      configPath: configCopy.preferencesPath,
    },
  });

  return {
    kind: 'lahari.apply.project_preferences',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    preferences: result.preferences,
    hash: result.hash,
    warnings: result.warnings,
    localFiles: {
      preferences: configCopy.preferencesPath,
      hashes: configCopy.hashesPath,
    },
    note: 'Applied project preferences. Supabase is canonical; local config hashes were refreshed.',
  };
};

export const applyProjectPromptOverrideConfig = async (
  project: Project,
  kind: ProjectPromptOverrideKind,
  body: string,
  baseHash?: string | null,
) => {
  const result = await applyProjectPromptOverride(project.id, kind, body, baseHash);
  const configCopy = await writeProjectConfigDeskCopy(project, defaultProjectWorkbenchDir(project));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'project_prompt_override_applied',
    entityType: 'project',
    entityId: project.id,
    summary: `Codex applied the project ${kind} prompt override.`,
    payload: {
      kind,
      baseHash: baseHash || null,
      newHash: result.hash,
      overrideId: result.overrideId,
      configPath: kind === 'storyboard' ? configCopy.storyboardPromptPath : configCopy.videoPromptPath,
    },
  });

  return {
    kind: 'lahari.apply.project_prompt_override',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    promptOverride: result,
    localFiles: {
      prompt: kind === 'storyboard' ? configCopy.storyboardPromptPath : configCopy.videoPromptPath,
      hashes: configCopy.hashesPath,
    },
    note: 'Applied project prompt override. There is no preview tool by design: Codex writes the recipe, this tool validates drift and persists it.',
  };
};

export const revertProjectPromptOverrideConfig = async (
  project: Project,
  kind: ProjectPromptOverrideKind,
  baseHash?: string | null,
) => {
  const result = await revertProjectPromptOverride(project.id, kind, baseHash);
  const configCopy = await writeProjectConfigDeskCopy(project, defaultProjectWorkbenchDir(project));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'project_prompt_override_reverted',
    entityType: 'project',
    entityId: project.id,
    summary: result.active
      ? `Codex reverted the project ${kind} prompt override to the previous active recipe.`
      : `Codex reverted the project ${kind} prompt override to the global default.`,
    payload: {
      kind,
      baseHash: baseHash || null,
      newHash: result.hash,
      overrideId: result.overrideId,
      source: result.source,
      configPath: kind === 'storyboard' ? configCopy.storyboardPromptPath : configCopy.videoPromptPath,
    },
  });

  return {
    kind: 'lahari.apply.revert_project_prompt_override',
    generatedAt: new Date().toISOString(),
    project: { id: project.id, title: project.title },
    promptOverride: result,
    localFiles: {
      prompt: kind === 'storyboard' ? configCopy.storyboardPromptPath : configCopy.videoPromptPath,
      hashes: configCopy.hashesPath,
    },
    note: result.active
      ? 'Reverted to the previous project override and refreshed local config hashes.'
      : 'No previous override remained active; reverted to the global default and refreshed local config hashes.',
  };
};

export const applyGenerateVideo = async (project: Project, shotId: string, promptOverride?: string) => {
  const plan = planGenerateVideo(project, shotId);
  if (!plan.canRun) {
    throw new Error(`Cannot generate video: ${plan.prerequisites.join(' ')}`);
  }

  const result = await generateShotVideo(project.id, shotId, { promptOverride });
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'video_generated',
    entityType: 'shot',
    entityId: shotId,
    summary: `Codex generated a video for ${shotLabel(plan.shot.sceneIndex - 1, plan.shot.shotIndex - 1)}.`,
    payload: {
      promptOverride: promptOverride || null,
      mode: plan.mode,
      model: plan.model,
      estimatedCost: plan.estimatedCost,
      result: eventResultPointers(result),
    },
  });

  return {
    kind: 'lahari.generation_result.video',
    generatedAt: new Date().toISOString(),
    project: plan.project,
    shot: plan.shot,
    mode: plan.mode,
    model: plan.model,
    estimatedCost: plan.estimatedCost,
    appliedPlan: {
      willOverwrite: plan.willOverwrite,
      willChange: plan.willChange,
    },
    result,
    webUrl: webStudioUrl(project.id, { step: 'studio', shotId, action: 'review-video' }),
    note: 'Generated shot video, updated the active video pointer, and attempted last-frame extraction.',
  };
};

export const buildProjectActionList = (project: Project) => {
  const diagnosis = deriveDirectorDiagnosis(project);
  const actions: any[] = [];

  for (const [sceneIndex, scene] of project.scenes.entries()) {
    for (const [shotIndex, shot] of scene.shots.entries()) {
      const label = shotLabel(sceneIndex, shotIndex);
      const beat = compactText(shot.direction || shot.storyboardPrompt || shot.visualPrompt, 180);

      if (shot.storyboardPrompt && (!shot.storyboardUrl || shot.storyboardStatus === 'stale' || shot.storyboardStatus === 'error')) {
        const plan = planGenerateStoryboard(project, shot.id);
        actions.push({
          id: `generate-storyboard:${shot.id}`,
          label: `Generate storyboard board for ${label}`,
          kind: 'generate_storyboard',
          shot: { id: shot.id, label, beat },
          canRun: plan.canRun,
          paid: plan.paid,
          estimatedCost: plan.estimatedCost,
          prerequisites: plan.prerequisites,
          webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'generate-storyboard' }),
          cli: `npm run lahari -- apply generate-storyboard ${project.id} ${shot.id}`,
          mcpTool: 'apply_generate_storyboard',
          plan,
        });
      }

      if (shot.storyboardUrl && !shot.storyboardLocked) {
        actions.push({
          id: `review-storyboard:${shot.id}`,
          label: `Review and lock storyboard board for ${label}`,
          kind: 'review_storyboard',
          shot: { id: shot.id, label, beat },
          canRun: true,
          paid: false,
          webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'review-storyboard' }),
          prerequisites: [],
          cli: `npm run lahari -- apply lock-storyboard ${project.id} ${shot.id}`,
          mcpTool: 'lock_storyboard',
        });
      }

      if ((!shot.videoUrl || shot.videoStatus === 'stale' || shot.videoStatus === 'error') && !shot.locked) {
        const plan = planGenerateVideo(project, shot.id);
        actions.push({
          id: `generate-video:${shot.id}`,
          label: `Generate video for ${label}`,
          kind: 'generate_video',
          shot: { id: shot.id, label, beat },
          canRun: plan.canRun,
          paid: plan.paid,
          estimatedCost: plan.estimatedCost,
          prerequisites: plan.prerequisites,
          webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'generate-video' }),
          cli: `npm run lahari -- apply generate-video ${project.id} ${shot.id}`,
          mcpTool: 'apply_generate_video',
          plan,
        });
      }

      if (shot.videoUrl && !shot.locked) {
        actions.push({
          id: `review-video:${shot.id}`,
          label: `Review and lock video for ${label}`,
          kind: 'review_video',
          shot: { id: shot.id, label, beat },
          canRun: false,
          paid: false,
          webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'review-video' }),
          prerequisites: ['No native lock-shot apply tool yet; use the Lahari web studio review control.'],
        });
      }
    }
  }

  return {
    kind: 'lahari.project.actions',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
    },
    diagnosis,
    actions: actions.slice(0, 20),
  };
};

export const buildStoryboardPromptReview = (project: Project) => {
  const items: any[] = [];
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    for (const [shotIndex, shot] of scene.shots.entries()) {
      const promptLength = (shot.storyboardPrompt || '').length;
      const cutPlanLength = (shot.storyboardCutPlan || '').length;
      const issues = [
        !shot.storyboardPrompt ? 'missing storyboard prompt' : null,
        !shot.storyboardCutPlan ? 'missing cut plan' : null,
        shot.promptsStale ? 'prompt stale' : null,
        shot.storyboardPromptStatus === 'error' ? 'prompt writer error' : null,
        shot.storyboardStatus === 'error' ? 'board generation error' : null,
        promptLength > 5000 ? 'prompt likely too long for reliable image following' : null,
        shot.storyboardUrl && !shot.storyboardLocked ? 'board needs review/lock before video' : null,
        project.videoModel?.startsWith('seedance') && !shot.storyboardLocked && !shot.imageUrl ? 'video blocked until board is locked or start frame exists' : null,
      ].filter(Boolean);
      if (!issues.length) continue;
      const boardNeedsGeneration = !shot.storyboardUrl || shot.storyboardStatus === 'stale' || shot.storyboardStatus === 'error';
      const plan = shot.storyboardPrompt && boardNeedsGeneration
        ? planGenerateStoryboard(project, shot.id)
        : null;
      items.push({
        shot: {
          id: shot.id,
          label: shotLabel(sceneIndex, shotIndex),
          scene: scene.sectionLabel,
          beat: compactText(shot.direction || shot.storyboardPrompt || shot.visualPrompt, 220),
          duration: shot.duration,
        },
        issues,
        stats: {
          storyboardPromptChars: promptLength,
          cutPlanChars: cutPlanLength,
          hasBoard: !!shot.storyboardUrl,
          boardLocked: !!shot.storyboardLocked,
          hasVideo: !!shot.videoUrl,
          videoLocked: !!shot.locked,
        },
        nextNativeAction: plan?.canRun ? {
          kind: 'generate_storyboard',
          cli: `npm run lahari -- apply generate-storyboard ${project.id} ${shot.id}`,
          webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'generate-storyboard' }),
          estimatedCost: plan.estimatedCost,
        } : null,
        webUrl: webStudioUrl(project.id, { step: 'studio', shotId: shot.id, action: 'review-storyboard-prompt' }),
        rewriteCommand: `npm run lahari -- preview rewrite-storyboard-prompt ${project.id} ${shot.id}`,
      });
    }
  }

  return {
    kind: 'lahari.storyboard_prompt.review',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      storyboardProvider: project.storyboardProvider,
      videoModel: project.videoModel,
    },
    summary: {
      totalIssues: items.reduce((sum, item) => sum + item.issues.length, 0),
      shotsWithIssues: items.length,
    },
    items,
  };
};

const buildBriefMarkdown = (project: Project, actionList: ReturnType<typeof buildProjectActionList>): string => {
  const counts = statusCounts(project);
  const diagnosis = actionList.diagnosis;
  const actionLines = actionList.actions.length
    ? actionList.actions.slice(0, 10).map((action: any) => `- ${action.label} (${action.canRun ? 'native' : 'manual'}${action.estimatedCost ? `, ~$${action.estimatedCost}` : ''})`).join('\n')
    : '- No immediate actions found.';

  return `# ${project.title}

Hydrated: ${new Date().toISOString()}
Project ID: ${project.id}

## Current Read

${diagnosis.productionRead}

- Status: ${project.status}
- Workflow: ${usesStoryboardWorkflow(project) ? 'storyboard' : 'keyframe'}
- Models: text ${project.textProvider}, image ${project.imageModel}, storyboard ${project.storyboardProvider}, video ${project.videoModel}
- Format: ${project.aspectRatio}, ${project.videoResolution}
- Counts: ${counts.scenes} scenes, ${counts.shots} shots, ${counts.storyboards}/${counts.shots} boards, ${counts.videos}/${counts.shots} videos, ${counts.lockedShots}/${counts.shots} locked shots

## Bottleneck

${diagnosis.bottleneck}

## Weak Links

${diagnosis.weakLinks.length ? diagnosis.weakLinks.map((item) => `- ${item}`).join('\n') : '- None from deterministic checks.'}

## Risk Notes

${diagnosis.riskNotes.length ? diagnosis.riskNotes.map((item) => `- ${item}`).join('\n') : '- None from deterministic checks.'}

## Next Actions

${actionLines}
`;
};

const buildAudioAnalysisMarkdown = (project: Project): string => {
  const sections = project.musicalStructure.length
    ? project.musicalStructure.map((section: any) => `- ${section.label || 'Section'} ${section.startTime || '?'}-${section.endTime || '?'}${section.energyLevel ? `, energy ${section.energyLevel}` : ''}: ${section.description || ''}`).join('\n')
    : '- No musical structure saved.';

  return `# Audio Analysis

Project: ${project.title}
Hydrated: ${new Date().toISOString()}

## Classification

- Song type: ${project.songType || 'unknown'}
- Narrative: ${project.isNarrative ?? 'unknown'}
- Meditative: ${project.isMeditative ?? 'unknown'}

## Meaning

${md(project.meaning)}

## Musical Structure

${sections}

## Lyrics

${md(project.lyrics)}
`;
};

const buildConceptNotesMarkdown = (project: Project): string => {
  const locked = project.lockedConcept;
  const options = project.conceptOptions.length
    ? project.conceptOptions.map((option: any, index: number) => `## Option ${index + 1}: ${option.title || option.deity || 'Untitled'}

${md(option.description || option.conceptDirection || JSON.stringify(option, null, 2))}`).join('\n\n')
    : 'No concept options saved.';

  return `# Concept Notes

Project: ${project.title}
Hydrated: ${new Date().toISOString()}

## Locked Concept

${locked ? `### ${locked.title || locked.deity || 'Untitled'}

${md(locked.description || locked.conceptDirection || JSON.stringify(locked, null, 2))}` : 'No locked concept.'}

## Saved Options

${options}
`;
};

const buildScriptMarkdown = (project: Project): string => {
  const cast = project.cast.length
    ? project.cast.map((member) => `- ${member.name}: ${member.description || 'No description.'}`).join('\n')
    : '- No cast/entities saved.';
  const environments = project.environments.length
    ? project.environments.map((environment) => `- ${environment.name}: ${environment.description || 'No description.'}`).join('\n')
    : '- No environments/locations saved.';
  const scenes = project.scenes.length
    ? project.scenes.map((scene, sceneIndex) => {
      const shots = scene.shots.map((shot, shotIndex) => `- ${shotLabel(sceneIndex, shotIndex)} (${shot.duration}s): ${shot.direction || shot.visualPrompt || shot.storyboardPrompt || 'No beat.'}`).join('\n');
      return `## Scene ${sceneIndex + 1}: ${scene.sectionLabel || 'Untitled'} (${scene.startTime || '?'}-${scene.endTime || '?'})

${md(scene.narrativeDescription)}

${shots || 'No shots.'}`;
    }).join('\n\n')
    : 'No scenes saved.';

  return `# Script

Project: ${project.title}
Hydrated: ${new Date().toISOString()}

## Cast / Entities

${cast}

## Environments / Locations

${environments}

## Scenes And Shots

${scenes}
`;
};

const buildStoryboardPromptsMarkdown = (project: Project): string => {
  const scenes = project.scenes.length
    ? project.scenes.map((scene, sceneIndex) => {
      const shots = scene.shots.map((shot, shotIndex) => `## ${shotLabel(sceneIndex, shotIndex)}: ${compactText(shot.direction, 120) || 'Shot'}

- Shot ID: ${shot.id}
- Duration: ${shot.duration}s
- Storyboard status: ${shot.storyboardStatus || 'idle'}${shot.storyboardLocked ? ', locked' : ''}
- Video status: ${shot.videoStatus || 'idle'}${shot.locked ? ', locked' : ''}

### Storyboard Prompt

${md(shot.storyboardPrompt)}

### Cut Plan

${md(shot.storyboardCutPlan)}

### Visual Prompt

${md(shot.visualPrompt)}

### Motion Prompt

${md(shot.motionPrompt)}
`).join('\n');
      return `# Scene ${sceneIndex + 1}: ${scene.sectionLabel || 'Untitled'}

${shots}`;
    }).join('\n\n')
    : 'No storyboard prompts saved.';

  return `# Storyboard Prompts

Project: ${project.title}
Hydrated: ${new Date().toISOString()}

${scenes}
`;
};

export const hydrateProjectWorkbench = async (project: Project, outputDir?: string) => {
  const baseDir = path.resolve(outputDir || defaultProjectWorkbenchDir(project));
  const snapshotDir = path.join(baseDir, 'snapshots');
  const packet = await buildProjectPacket(project);
  const actionList = buildProjectActionList(project);
  const configCopy = await writeProjectConfigDeskCopy(project, baseDir);
  const timestamp = safeTimestamp();
  const artifacts = [
    { type: 'brief', path: writeArtifact(path.join(baseDir, 'brief.md'), buildBriefMarkdown(project, actionList)) },
    { type: 'audio-analysis', path: writeArtifact(path.join(baseDir, 'audio-analysis.md'), buildAudioAnalysisMarkdown(project)) },
    { type: 'concept-notes', path: writeArtifact(path.join(baseDir, 'concept-notes.md'), buildConceptNotesMarkdown(project)) },
    { type: 'script', path: writeArtifact(path.join(baseDir, 'script.md'), buildScriptMarkdown(project)) },
    { type: 'storyboard-prompts', path: writeArtifact(path.join(baseDir, 'storyboard-prompts.md'), buildStoryboardPromptsMarkdown(project)) },
    { type: 'config-preferences', path: configCopy.preferencesPath },
    { type: 'config-storyboard-prompt', path: configCopy.storyboardPromptPath },
    { type: 'config-video-prompt', path: configCopy.videoPromptPath },
    { type: 'config-hashes', path: configCopy.hashesPath },
    { type: 'action-plan', path: writeArtifact(path.join(baseDir, 'action-plan.json'), `${JSON.stringify(actionList, null, 2)}\n`) },
    { type: 'packet-snapshot', path: writeArtifact(path.join(snapshotDir, `${timestamp}-packet.json`), `${JSON.stringify(packet, null, 2)}\n`) },
    { type: 'actions-snapshot', path: writeArtifact(path.join(snapshotDir, `${timestamp}-actions.json`), `${JSON.stringify(actionList, null, 2)}\n`) },
    { type: 'director-notes', path: writeArtifactIfMissing(path.join(baseDir, 'director-notes.md'), `# Director Notes

Project: ${project.title}
Project ID: ${project.id}

Local Codex notes live here. This file is not overwritten by hydration.
`) },
  ];

  return {
    kind: 'lahari.project.workbench',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
    },
    baseDir,
    sourceOfTruth: 'Supabase remains canonical; these files are a local Codex workbench mirror.',
    artifacts,
    projectConfig: configCopy.state,
  };
};

type ScriptPreviewFile = {
  kind: 'lahari.preview.rewrite_script';
  previewId: string;
  generatedAt: string;
  project: { id: string; title: string; status: string; videoModel?: string; textProvider?: string };
  mode: 'generate' | 'refine';
  model: string;
  userNote: string | null;
  beforeFingerprint: string;
  beforeCounts: { cast: number; environments: number; scenes: number; shots: number };
  beforeProject?: {
    status: string;
    lastScriptPrompt?: string | null;
    lastWriteShotsPrompt?: string | null;
  };
  beforeRows?: {
    cast: Array<{ id: string; name: string; description?: string | null; generationPrompt?: string | null; promptsStale?: boolean; referenceAssetId?: string | null }>;
    environments: Array<{ id: string; name: string; description?: string | null; generationPrompt?: string | null; promptsStale?: boolean; referenceAssetId?: string | null }>;
    scenes: Array<{
      id: string;
      sectionLabel?: string | null;
      startTime?: string | null;
      endTime?: string | null;
      lyrics?: string | null;
      narrativeDescription?: string | null;
      shots: Array<{
        id: string;
        direction?: string | null;
        visualPrompt?: string | null;
        motionPrompt?: string | null;
        duration?: number | null;
        castIds?: string[];
        environmentId?: string | null;
        continuityFrom?: string | null;
        promptsStale?: boolean;
        useNextAsEndFrame?: boolean;
        lipsyncEnabled?: boolean;
        usePrevStoryboardRef?: boolean;
        includePrevCutPlan?: boolean | null;
        excludedRefs?: { storyboard: string[]; video: string[] };
      }>;
    }>;
  };
  afterCounts: { cast: number; environments: number; scenes: number; shots: number };
  script: { cast: any[]; environments: any[]; scenes: any[] };
  artifacts: { markdownPath: string; jsonPath: string; promptPath: string };
  note: string;
};

const musicalStructureText = (project: Project): string => {
  return project.musicalStructure.length
    ? project.musicalStructure.map((section: any) => `${section.label || 'Section'} [${section.startTime || '?'}-${section.endTime || '?'}] ${section.energyLevel || ''} ${section.description || ''}`).join('\n')
    : '';
};

const buildScriptDraft = (project: Project) => {
  const castById = namesById(project.cast);
  const environmentById = namesById(project.environments);
  return {
    cast: project.cast.map((member) => ({ name: member.name, description: member.description || '' })),
    environments: project.environments.map((environment) => ({ name: environment.name, description: environment.description || '' })),
    scenes: project.scenes.map((scene) => ({
      sectionLabel: scene.sectionLabel,
      startTime: scene.startTime,
      endTime: scene.endTime,
      narrativeDescription: scene.narrativeDescription,
      shots: scene.shots.map((shot) => ({
        direction: shot.direction || shot.visualPrompt || '',
        duration: shot.duration,
        castNames: (shot.castIds || []).map((id) => castById.get(id) || id),
        environmentName: shot.environmentId ? environmentById.get(shot.environmentId) || '' : '',
      })),
    })),
  };
};

const buildScriptRollbackRows = (project: Project): NonNullable<ScriptPreviewFile['beforeRows']> => ({
  cast: project.cast.map((member) => ({
    id: member.id,
    name: member.name,
    description: member.description || '',
    generationPrompt: member.generationPrompt || null,
    promptsStale: !!member.promptsStale,
    referenceAssetId: member.referenceAssetId || null,
  })),
  environments: project.environments.map((environment) => ({
    id: environment.id,
    name: environment.name,
    description: environment.description || '',
    generationPrompt: environment.generationPrompt || null,
    promptsStale: !!environment.promptsStale,
    referenceAssetId: environment.referenceAssetId || null,
  })),
  scenes: project.scenes.map((scene) => ({
    id: scene.id,
    sectionLabel: scene.sectionLabel || '',
    startTime: scene.startTime || '',
    endTime: scene.endTime || '',
    lyrics: scene.lyrics || '',
    narrativeDescription: scene.narrativeDescription || '',
    shots: scene.shots.map((shot) => ({
      id: shot.id,
      direction: shot.direction || '',
      visualPrompt: shot.visualPrompt || '',
      motionPrompt: shot.motionPrompt || '',
      duration: shot.duration || null,
      castIds: shot.castIds || [],
      environmentId: shot.environmentId || null,
      continuityFrom: shot.continuityFrom || 'cut',
      promptsStale: !!shot.promptsStale,
      useNextAsEndFrame: !!shot.useNextAsEndFrame,
      lipsyncEnabled: !!shot.lipsyncEnabled,
      usePrevStoryboardRef: !!shot.usePrevStoryboardRef,
      includePrevCutPlan: shot.includePrevCutPlan ?? null,
      excludedRefs: shot.excludedRefs || { storyboard: [], video: [] },
    })),
  })),
});

const scriptFingerprint = (project: Project): string => {
  return JSON.stringify(buildScriptDraft(project));
};

const scriptFingerprintFromDraft = (script: { cast: any[]; environments: any[]; scenes: any[] }): string => {
  return JSON.stringify({
    cast: (script.cast || []).map((member) => ({ name: member.name, description: member.description || '' })),
    environments: (script.environments || []).map((environment) => ({ name: environment.name, description: environment.description || '' })),
    scenes: (script.scenes || []).map((scene) => ({
      sectionLabel: scene.sectionLabel || '',
      startTime: scene.startTime || '',
      endTime: scene.endTime || '',
      lyrics: scene.lyrics || '',
      narrativeDescription: scene.narrativeDescription || '',
      shots: (scene.shots || []).map((shot: any) => ({
        direction: shot.direction || '',
        castNames: shot.castNames || [],
        environmentName: shot.environmentName || '',
        duration: shot.duration || undefined,
      })),
    })),
  });
};

const scriptCounts = (script: { cast: any[]; environments: any[]; scenes: any[] }) => ({
  cast: script.cast?.length || 0,
  environments: script.environments?.length || 0,
  scenes: script.scenes?.length || 0,
  shots: (script.scenes || []).reduce((sum, scene) => sum + (scene.shots?.length || 0), 0),
});

const hasDownstreamVisualWork = (project: Project): boolean => {
  return project.cast.some((member) => !!member.referenceImageUrl)
    || project.environments.some((environment) => !!environment.referenceImageUrl)
    || project.scenes.some((scene) => scene.shots.some((shot) => (
      !!shot.imageUrl
      || !!shot.storyboardUrl
      || !!shot.videoUrl
      || !!shot.locked
      || !!shot.storyboardLocked
    )));
};

const buildScriptPreviewMarkdown = (preview: ScriptPreviewFile): string => {
  const cast = preview.script.cast.length
    ? preview.script.cast.map((member) => `- ${member.name}: ${member.description || 'No description.'}`).join('\n')
    : '- No cast/entities proposed.';
  const environments = preview.script.environments.length
    ? preview.script.environments.map((environment) => `- ${environment.name}: ${environment.description || 'No description.'}`).join('\n')
    : '- No environments proposed.';
  const scenes = preview.script.scenes.length
    ? preview.script.scenes.map((scene, sceneIndex) => {
      const shots = (scene.shots || []).map((shot: any, shotIndex: number) => {
        const castNames = (shot.castNames || []).join(', ') || 'None';
        return `- ${shotLabel(sceneIndex, shotIndex)} (${shot.duration || '?'}s, cast: ${castNames}, env: ${shot.environmentName || 'None'}): ${shot.direction || 'No direction.'}`;
      }).join('\n');
      return `## Scene ${sceneIndex + 1}: ${scene.sectionLabel || 'Untitled'} (${scene.startTime || '?'}-${scene.endTime || '?'})

${md(scene.narrativeDescription)}

${shots || 'No shots.'}`;
    }).join('\n\n')
    : 'No scenes proposed.';

  return `# Script Preview

Generated: ${preview.generatedAt}
Preview ID: \`${preview.previewId}\`
Project: ${preview.project.title}
Project ID: \`${preview.project.id}\`
Mode: ${preview.mode}
Model: ${preview.model}
User note: ${preview.userNote || 'None'}

This is a preview only. No Lahari database rows, assets, frames, videos, references, or locks were changed.

## Counts

- Before: ${preview.beforeCounts.cast} cast, ${preview.beforeCounts.environments} environments, ${preview.beforeCounts.scenes} scenes, ${preview.beforeCounts.shots} shots
- After: ${preview.afterCounts.cast} cast, ${preview.afterCounts.environments} environments, ${preview.afterCounts.scenes} scenes, ${preview.afterCounts.shots} shots

## Cast / Entities

${cast}

## Environments / Locations

${environments}

## Scenes And Shots

${scenes}
`;
};

export const previewRewriteScript = async (project: Project, userNote?: string) => {
  if (!project.lockedConcept) throw new Error('Project has no locked concept. Lock a concept before script preview.');
  if (!project.audioPath) throw new Error('Project has no audio file.');
  const beforeScript = buildScriptDraft(project);
  const mode: 'generate' | 'refine' = project.scenes.length ? 'refine' : 'generate';
  const context = {
    concept: project.lockedConcept || {},
    videoMode: project.videoMode || 'montage',
    lyrics: project.lyrics || '',
    meaning: project.meaning || '',
    musicalStructure: musicalStructureText(project),
    basePacing: project.targetDuration || 15,
    minShotDuration: getModelMinDuration(project.videoModel),
    videoModel: project.videoModel || undefined,
  };
  const result = mode === 'refine'
    ? await refineScript(beforeScript, userNote || 'Improve the script for stronger narrative clarity, continuity, and production feasibility while preserving what works.', context)
    : await planScenes({
      ...context,
      userNote,
      songType: project.songType || undefined,
      isNarrative: project.isNarrative ?? undefined,
      isMeditative: project.isMeditative ?? undefined,
    });

  const now = new Date().toISOString();
  const previewId = `${safeTimestamp()}-script`;
  const promptPath = defaultPreviewPath(project, previewId, 'runtime-prompt.txt');
  const jsonPath = defaultPreviewPath(project, previewId, 'preview.json');
  const markdownPath = defaultPreviewPath(project, previewId, 'preview.md');
  const script = {
    cast: result.cast || [],
    environments: result.environments || [],
    scenes: result.scenes || [],
  };
  const preview: ScriptPreviewFile = {
    kind: 'lahari.preview.rewrite_script',
    previewId,
    generatedAt: now,
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      videoModel: project.videoModel,
      textProvider: project.textProvider,
    },
    mode,
    model: mode === 'refine' ? 'claude-opus-4-7' : 'claude-opus-4-7',
    userNote: userNote || null,
    beforeFingerprint: scriptFingerprint(project),
    beforeCounts: scriptCounts(beforeScript),
    beforeProject: {
      status: project.status,
      lastScriptPrompt: project.lastScriptPrompt || null,
      lastWriteShotsPrompt: project.lastWriteShotsPrompt || null,
    },
    beforeRows: buildScriptRollbackRows(project),
    afterCounts: scriptCounts(script),
    script,
    artifacts: { markdownPath, jsonPath, promptPath },
    note: 'Preview only. Applying this preview replaces cast, environments, scenes, and shots, and is refused when downstream visual work exists.',
  };

  writeArtifact(promptPath, result.prompt);
  writeArtifact(jsonPath, `${JSON.stringify(preview, null, 2)}\n`);
  writeArtifact(markdownPath, buildScriptPreviewMarkdown(preview));
  return preview;
};

const readScriptPreview = (previewJsonPath: string): ScriptPreviewFile => {
  const resolved = path.resolve(previewJsonPath);
  if (!fs.existsSync(resolved)) throw new Error(`Preview JSON not found: ${resolved}`);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (parsed?.kind !== 'lahari.preview.rewrite_script') {
    throw new Error('Preview JSON is not a lahari.preview.rewrite_script artifact.');
  }
  if (!parsed.project?.id || !parsed.script?.scenes) {
    throw new Error('Preview JSON is missing project or script data.');
  }
  return parsed as ScriptPreviewFile;
};

export const getRewriteScriptApplyPlan = async (previewJsonPath: string, project: Project) => {
  const preview = readScriptPreview(previewJsonPath);
  if (preview.project.id !== project.id) {
    throw new Error(`Preview belongs to project ${preview.project.id}, not loaded project ${project.id}.`);
  }
  const drifted = scriptFingerprint(project) !== preview.beforeFingerprint;
  const downstreamVisualWork = hasDownstreamVisualWork(project);
  const hasScript = preview.afterCounts.scenes > 0 && preview.afterCounts.shots > 0;
  const canApply = hasScript && !drifted && !downstreamVisualWork;

  return {
    kind: 'lahari.apply_plan.rewrite_script',
    previewId: preview.previewId,
    previewPath: path.resolve(previewJsonPath),
    project: { id: project.id, title: project.title, status: project.status },
    mode: preview.mode,
    counts: {
      before: preview.beforeCounts,
      after: preview.afterCounts,
      drifted: drifted ? 1 : 0,
      downstreamVisualWork: downstreamVisualWork ? 1 : 0,
    },
    canApply,
    willChange: [
      'Replace cast/entity rows for this project.',
      'Replace environment/location rows for this project.',
      'Replace all scenes and shots for this project.',
      'Set project status to scripted.',
      'Update last_script_prompt from preview runtime prompt.',
    ],
    note: !hasScript
      ? 'Refusing to apply an empty script preview.'
      : drifted
      ? 'Refusing to apply because the current script drifted. Regenerate a fresh preview.'
      : downstreamVisualWork
      ? 'Refusing to apply because downstream visual work exists. Fork first or use the web studio destructive flow deliberately.'
      : 'Ready to apply. This replaces script structure only; no assets exist yet.',
  };
};

export const applyRewriteScriptPreview = async (previewJsonPath: string, project: Project) => {
  const preview = readScriptPreview(previewJsonPath);
  const plan = await getRewriteScriptApplyPlan(previewJsonPath, project);
  if (!plan.canApply) throw new Error(plan.note);

  await deleteRows('cast_members', { project_id: project.id });
  await deleteRows('environments', { project_id: project.id });
  for (const scene of project.scenes) {
    await deleteRows('shots', { scene_id: scene.id });
  }
  await deleteRows('scenes', { project_id: project.id });

  const castNameToId = new Map<string, string>();
  for (let index = 0; index < preview.script.cast.length; index++) {
    const member = preview.script.cast[index];
    const id = uuidv4();
    castNameToId.set(String(member.name || '').toLowerCase(), id);
    await insertRow('cast_members', {
      id,
      project_id: project.id,
      name: member.name || `Character ${index + 1}`,
      description: member.description || '',
      sort_order: index,
    });
  }

  const environmentNameToId = new Map<string, string>();
  for (let index = 0; index < preview.script.environments.length; index++) {
    const environment = preview.script.environments[index];
    const id = uuidv4();
    environmentNameToId.set(String(environment.name || '').toLowerCase(), id);
    await insertRow('environments', {
      id,
      project_id: project.id,
      name: environment.name || `Environment ${index + 1}`,
      description: environment.description || '',
      sort_order: index,
    });
  }

  for (let sceneIndex = 0; sceneIndex < preview.script.scenes.length; sceneIndex++) {
    const scene = preview.script.scenes[sceneIndex];
    const sceneId = uuidv4();
    await insertRow('scenes', {
      id: sceneId,
      project_id: project.id,
      section_label: scene.sectionLabel || `Scene ${sceneIndex + 1}`,
      start_time: scene.startTime || '0:00',
      end_time: scene.endTime || '0:00',
      lyrics: scene.lyrics || '',
      narrative_description: scene.narrativeDescription || '',
      sort_order: sceneIndex,
    });

    for (let shotIndex = 0; shotIndex < (scene.shots || []).length; shotIndex++) {
      const shot = scene.shots[shotIndex];
      const castIds = (shot.castNames || [])
        .map((name: string) => castNameToId.get(String(name).toLowerCase()))
        .filter(Boolean);
      const environmentId = shot.environmentName
        ? environmentNameToId.get(String(shot.environmentName).toLowerCase()) || null
        : null;
      await insertRow('shots', {
        id: uuidv4(),
        scene_id: sceneId,
        direction: shot.direction || '',
        visual_prompt: '',
        motion_prompt: '',
        duration: Number(shot.duration || project.targetDuration || 15),
        cast_ids: JSON.stringify(castIds),
        environment_id: environmentId,
        use_next_as_end_frame: project.videoMode === 'cinematic' ? 1 : 0,
        sort_order: shotIndex,
        image_status: 'idle',
        video_status: 'idle',
      });
    }
  }

  const promptText = preview.artifacts?.promptPath && fs.existsSync(preview.artifacts.promptPath)
    ? fs.readFileSync(preview.artifacts.promptPath, 'utf8')
    : undefined;
  await updateRows('projects', { id: project.id }, {
    status: 'scripted',
    ...(promptText ? { last_script_prompt: promptText } : {}),
    updated_at: new Date().toISOString(),
  });

  const journalPath = sessionJournalPath(project.id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Lahari Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }
  fs.appendFileSync(journalPath, journalEntry('applied script preview', `Preview ID: ${preview.previewId}\nPreview JSON: ${path.resolve(previewJsonPath)}\nMode: ${preview.mode}\nScenes: ${preview.afterCounts.scenes}\nShots: ${preview.afterCounts.shots}\n\nNo assets, frames, videos, or locks existed at apply time.`));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'script_preview_applied',
    entityType: 'project',
    entityId: project.id,
    summary: `Applied script preview ${preview.previewId}; wrote ${preview.afterCounts.scenes} scenes and ${preview.afterCounts.shots} shots.`,
    payload: {
      previewId: preview.previewId,
      previewJsonPath: path.resolve(previewJsonPath),
      mode: preview.mode,
      scenesWritten: preview.afterCounts.scenes,
      shotsWritten: preview.afterCounts.shots,
    },
  });

  return {
    kind: 'lahari.apply.rewrite_script',
    previewId: preview.previewId,
    projectId: project.id,
    scenesWritten: preview.afterCounts.scenes,
    shotsWritten: preview.afterCounts.shots,
    journalPath,
    note: 'Applied preview to Supabase. Replaced cast, environments, scenes, and shots; project is now scripted.',
  };
};

export const rollbackRewriteShotPromptsPreview = async (previewJsonPath: string, project: Project) => {
  const preview = readShotPromptPreview(previewJsonPath);
  if (preview.project.id !== project.id) throw new Error(`Preview belongs to ${preview.project.id}, not ${project.id}.`);

  const currentById = new Map(project.scenes.flatMap((scene) => scene.shots).map((shot) => [shot.id, shot]));
  const drifted: string[] = [];
  for (const shot of preview.shots) {
    const current = currentById.get(shot.id);
    if (!current) {
      drifted.push(shot.id);
      continue;
    }
    if (
      current.visualPrompt !== (shot.after.visualPrompt || '')
      || current.motionPrompt !== (shot.after.motionPrompt || '')
      || current.continuityFrom !== (shot.after.continuityFrom || 'cut')
    ) {
      drifted.push(shot.id);
    }
  }
  if (drifted.length) {
    throw new Error(`Refusing rollback because current shot prompts no longer match preview after-state. Drifted: ${drifted.join(', ')}`);
  }

  for (const shot of preview.shots) {
    await updateRows('shots', { id: shot.id }, {
      visual_prompt: shot.before.visualPrompt || '',
      motion_prompt: shot.before.motionPrompt || '',
      continuity_from: shot.before.continuityFrom || 'cut',
      prompts_stale: !!shot.before.promptsStale,
    });
  }

  const journalPath = sessionJournalPath(project.id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Lahari Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }
  fs.appendFileSync(journalPath, journalEntry('rolled back shot prompt preview', `Preview ID: ${preview.previewId}\nPreview JSON: ${path.resolve(previewJsonPath)}\nShots restored: ${preview.shots.length}`));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'shot_prompts_preview_rolled_back',
    entityType: 'project',
    entityId: project.id,
    summary: `Rolled back shot prompt preview ${preview.previewId}; restored ${preview.shots.length} shots.`,
    payload: { previewId: preview.previewId, previewJsonPath: path.resolve(previewJsonPath), shotsRestored: preview.shots.length },
  });

  return {
    kind: 'lahari.rollback.rewrite_shot_prompts',
    previewId: preview.previewId,
    projectId: project.id,
    shotsRestored: preview.shots.length,
    journalPath,
    note: 'Rolled back preview fields to their before snapshot after validating current state matched the preview after-state.',
  };
};

export const rollbackRewriteStoryboardPromptPreview = async (previewJsonPath: string, project: Project) => {
  const preview = readStoryboardPromptPreview(previewJsonPath);
  if (preview.project.id !== project.id) throw new Error(`Preview belongs to ${preview.project.id}, not ${project.id}.`);
  const current = project.scenes.flatMap((scene) => scene.shots).find((shot) => shot.id === preview.shot.id);
  if (!current) throw new Error(`Previewed shot no longer exists: ${preview.shot.id}`);
  if (
    (current.storyboardPrompt || '') !== preview.shot.after.storyboardPrompt
    || (current.storyboardCutPlan || '') !== preview.shot.after.storyboardCutPlan
  ) {
    throw new Error('Refusing rollback because the current storyboard prompt/cut plan no longer matches the preview after-state.');
  }

  await updateRows('shots', { id: preview.shot.id }, {
    storyboard_prompt: preview.shot.before.storyboardPrompt,
    storyboard_cut_plan: preview.shot.before.storyboardCutPlan,
    prompts_stale: !!preview.shot.before.promptsStale,
    storyboard_prompt_status: 'success',
    last_error: null,
  });

  const journalPath = sessionJournalPath(project.id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Lahari Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }
  fs.appendFileSync(journalPath, journalEntry('rolled back storyboard prompt preview', `Preview ID: ${preview.previewId}\nPreview JSON: ${path.resolve(previewJsonPath)}\nShot restored: ${preview.shot.id}`));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'storyboard_prompt_preview_rolled_back',
    entityType: 'shot',
    entityId: preview.shot.id,
    summary: `Rolled back storyboard prompt preview ${preview.previewId}.`,
    payload: { previewId: preview.previewId, previewJsonPath: path.resolve(previewJsonPath), shotId: preview.shot.id },
  });

  return {
    kind: 'lahari.rollback.rewrite_storyboard_prompt',
    previewId: preview.previewId,
    projectId: project.id,
    shotId: preview.shot.id,
    journalPath,
    note: 'Rolled back storyboard prompt fields to their before snapshot after validating current state matched the preview after-state.',
  };
};

export const rollbackRewriteScriptPreview = async (previewJsonPath: string, project: Project) => {
  const preview = readScriptPreview(previewJsonPath);
  if (preview.project.id !== project.id) throw new Error(`Preview belongs to ${preview.project.id}, not ${project.id}.`);
  if (!preview.beforeRows || !preview.beforeProject) {
    throw new Error('This script preview does not contain a rollback snapshot. Regenerate the preview with the current tool version before relying on script rollback.');
  }
  if (hasDownstreamVisualWork(project)) {
    throw new Error('Refusing script rollback because downstream visual work now exists. Fork first or clear visual outputs before restoring script rows.');
  }
  if (scriptFingerprint(project) !== scriptFingerprintFromDraft(preview.script)) {
    throw new Error('Refusing rollback because the current script no longer matches the preview after-state.');
  }

  await rpcVoid('lahari_rollback_script_preview', {
    p_project_id: project.id,
    p_before_project: preview.beforeProject,
    p_before_rows: preview.beforeRows,
  });

  const journalPath = sessionJournalPath(project.id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Lahari Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }
  fs.appendFileSync(journalPath, journalEntry('rolled back script preview', `Preview ID: ${preview.previewId}\nPreview JSON: ${path.resolve(previewJsonPath)}\nRestored scenes: ${preview.beforeRows.scenes.length}`));
  await recordDirectorEvent({
    projectId: project.id,
    source: 'codex',
    eventType: 'script_preview_rolled_back',
    entityType: 'project',
    entityId: project.id,
    summary: `Rolled back script preview ${preview.previewId}.`,
    payload: { previewId: preview.previewId, previewJsonPath: path.resolve(previewJsonPath), scenesRestored: preview.beforeRows.scenes.length },
  });

  return {
    kind: 'lahari.rollback.rewrite_script',
    previewId: preview.previewId,
    projectId: project.id,
    scenesRestored: preview.beforeRows.scenes.length,
    journalPath,
    note: 'Rolled back script/cast/environment rows from the preview rollback snapshot after validating current script matched the preview after-state.',
  };
};
