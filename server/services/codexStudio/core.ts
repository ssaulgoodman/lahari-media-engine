import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { selectAll, selectColumns } from '../../database.js';
import type { FullProjectCore } from '../../routes/projects.js';
import { IMAGE_MODELS } from '../../../constants/imageModels.js';
import { STORYBOARD_PROVIDERS } from '../../../constants/storyboardProviders.js';
import { TEXT_PROVIDERS } from '../../../constants/textProviders.js';
import { VIDEO_MODELS } from '../../../constants/videoModels.js';

// Project mirrors the core fullProject shape (no tool-registry projection).
// availableTools/blockedTools live on the API response (getFullProject)
// but are computed FROM Project, so deriving Project from
// _getFullProjectCore avoids the type recursion.
export type Project = FullProjectCore;
export type ProjectShot = Project['scenes'][number]['shots'][number];

export const compactText = (value?: string | null, max = 700): string | null => {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trim()}...`;
};

export const stableJson = (value: unknown): string => {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.keys(item as Record<string, unknown>)
        .sort()
        .reduce((acc, key) => {
          acc[key] = normalize((item as Record<string, unknown>)[key]);
          return acc;
        }, {} as Record<string, unknown>);
    }
    return item;
  };
  return JSON.stringify(normalize(value));
};

export const hashJson = (value: unknown): string => {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
};

export const shotPromptHash = (shot: Pick<ProjectShot, 'visualPrompt' | 'motionPrompt' | 'direction' | 'continuityFrom'>): string => hashJson({
  visualPrompt: shot.visualPrompt || '',
  motionPrompt: shot.motionPrompt || '',
  direction: shot.direction || '',
  continuityFrom: shot.continuityFrom || 'cut',
});

export const storyboardPromptHash = (shot: Pick<ProjectShot, 'storyboardPrompt' | 'storyboardCutPlan'>): string => hashJson({
  storyboardPrompt: shot.storyboardPrompt || '',
  storyboardCutPlan: shot.storyboardCutPlan || '',
});

export const videoPromptHash = (shot: Pick<ProjectShot, 'motionPrompt'>): string => hashJson({
  motionPrompt: shot.motionPrompt || '',
});

export const audioPlanHash = (shot: Pick<ProjectShot, 'audioPlan'>): string => hashJson(shot.audioPlan || null);

export const castVoiceHash = (member: Pick<Project['cast'][number], 'voiceProvider' | 'voiceId' | 'voiceName'>): string => hashJson({
  voiceProvider: member.voiceProvider || null,
  voiceId: member.voiceId || null,
  voiceName: member.voiceName || null,
});

export const conceptHash = (concept: unknown): string => hashJson(concept || null);

export const styleDirectionHash = (project: Pick<Project, 'styleDescription' | 'styleGenerationPrompt' | 'colorPalette'>): string => hashJson({
  styleDescription: project.styleDescription || '',
  styleGenerationPrompt: project.styleGenerationPrompt || '',
  colorPalette: project.colorPalette || '',
});

export const buildScriptDraft = (project: Project) => ({
  cast: project.cast.map((member) => ({ id: member.id, name: member.name, description: member.description || '' })),
  environments: project.environments.map((environment) => ({ id: environment.id, name: environment.name, description: environment.description || '' })),
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
      duration: Number(shot.duration || 0),
      castIds: shot.castIds || [],
      environmentId: shot.environmentId || null,
      continuityFrom: shot.continuityFrom || 'cut',
    })),
  })),
});

export const scriptContentHash = (project: Project): string => hashJson(buildScriptDraft(project));

export const namesById = <T extends { id: string; name: string }>(items: T[]) => {
  return new Map(items.map((item) => [item.id, item.name]));
};

const slugify = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'mirage-project';
};

const appBaseUrl = () => (
  process.env.MIRAGE_STUDIO_URL
  || process.env.LAHARI_STUDIO_URL
  || process.env.APP_URL
  || process.env.PUBLIC_APP_URL
  || 'https://mirage-platform-production-05ca.up.railway.app'
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

export const defaultPreviewPath = (project: Project, previewId: string, suffix: string): string => {
  return path.join(process.cwd(), '.lahari', 'previews', project.id, `${previewId}-${suffix}`);
};

export const writeArtifact = (filePath: string, content: string) => {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content);
  return resolved;
};

export const writeArtifactIfMissing = (filePath: string, content: string) => {
  const resolved = path.resolve(filePath);
  if (fs.existsSync(resolved)) return resolved;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content);
  return resolved;
};

export const safeTimestamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export const escapeHtml = (value?: string | null): string => {
  return (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export const md = (value?: string | null): string => {
  return value?.trim() || 'None';
};

export const sessionDir = (projectId: string): string => {
  return path.join(process.cwd(), '.lahari', 'sessions', projectId);
};

export const sessionStatePath = (projectId: string): string => {
  return path.join(sessionDir(projectId), 'state.json');
};

export const sessionJournalPath = (projectId: string): string => {
  return path.join(sessionDir(projectId), 'journal.md');
};

export const defaultProjectWorkbenchDir = (project: Project): string => {
  return path.join(process.cwd(), '.lahari', 'projects', project.id);
};

export const journalEntry = (title: string, body: string): string => {
  return `\n\n## ${new Date().toISOString()} — ${title}\n\n${body.trim()}\n`;
};

export const appendSessionJournalEntry = (project: { id: string; title: string }, title: string, body: string): string => {
  const journalPath = sessionJournalPath(project.id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, `# Mirage Director Journal\n\nProject: ${project.title}\nID: ${project.id}\n`);
  }
  fs.appendFileSync(journalPath, journalEntry(title, body));
  return journalPath;
};

export const readTextFileIfExists = (filePath: string): string | null => {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
};

export const readJsonFileIfExists = (filePath: string): unknown | null => {
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
    'id,title,status,preset_key,song_type,is_narrative,is_meditative,image_model,storyboard_provider,video_model,text_provider,created_at,updated_at',
    {},
    { orderBy: 'updated_at', ascending: false, limit },
  );

  return {
    kind: 'mirage.project.list',
    generatedAt: new Date().toISOString(),
    limit,
    projects: rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      preset: row.preset_key || 'music_video_default',
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

export const hasUsableShotPrompts = (project: Project): boolean => {
  return project.scenes.every((scene) => scene.shots.every((shot) => (
    !!shot.visualPrompt
    && !!shot.motionPrompt
    && shot.motionPrompt !== 'Cinematic camera movement'
  )));
};

export const missingReferenceNames = (project: Project) => {
  return {
    cast: project.cast.filter((member) => !member.referenceImageUrl).map((member) => member.name),
    environments: project.environments.filter((environment) => !environment.referenceImageUrl).map((environment) => environment.name),
  };
};

export const usesStoryboardWorkflow = (project: Project): boolean => {
  if (project.scenes.some((scene) => scene.shots.some((shot) => shot.workflowMode === 'storyboard'))) {
    return true;
  }
  return project.videoModel?.startsWith('seedance')
    || project.scenes.some((scene) => scene.shots.some((shot) => (
      !!shot.storyboardPrompt
      || !!shot.storyboardUrl
      || !!shot.storyboardLocked
      || shot.storyboardPromptStatus === 'loading'
      || shot.storyboardStatus === 'loading'
    )));
};

export const shotWorkflowMode = (project: Project, shot: ProjectShot): 'storyboard' | 'keyframe' => {
  if (shot.workflowMode === 'storyboard') return 'storyboard';
  if (shot.workflowMode === 'keyframe') return 'keyframe';
  if (project.videoModel?.startsWith('seedance')) return 'storyboard';
  if (shot.storyboardPrompt || shot.storyboardUrl || shot.storyboardLocked || shot.storyboardPromptStatus === 'loading' || shot.storyboardStatus === 'loading') {
    return 'storyboard';
  }
  return 'keyframe';
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
  if (storyboardWorkflow && counts.storyboards > counts.lockedStoryboards) actions.push('Review and lock generated storyboard boards before video.');
  if (!storyboardWorkflow && counts.shots && counts.frames < counts.shots) actions.push('Generate missing start frames.');
  if (storyboardWorkflow) {
    if (counts.lockedStoryboards > counts.videos) actions.push('Generate missing videos from locked storyboard boards.');
  } else if (counts.shots && counts.frames === counts.shots && counts.videos < counts.shots) {
    actions.push('Generate missing videos after frames are ready.');
  }
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
  const storyboardsLockedComplete = storyboardsComplete && counts.lockedStoryboards === counts.storyboards;
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
  } else if (storyboardWorkflow && storyboardsLockedComplete) {
    key = 'video_generation';
    label = 'Video generation';
    summary = 'Storyboard boards are complete. Generate or retry videos from locked boards and cut plans.';
  } else if (storyboardWorkflow && storyboardsComplete) {
    key = 'storyboard_review';
    label = 'Storyboard review';
    summary = 'Storyboard boards exist. Review and lock the reusable boards before video generation.';
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

  const classificationIssue = project.songType ? null : 'Song classification is missing; re-run audio analysis if this project still needs classification-sensitive decisions.';
  const openIssues = [
    counts.stalePrompts ? `${counts.stalePrompts} stale prompt${counts.stalePrompts === 1 ? '' : 's'} need review.` : null,
    counts.errors ? `${counts.errors} error state${counts.errors === 1 ? ' needs' : 's need'} triage.` : null,
    missingRefs.cast.length ? `Missing character/entity references: ${missingRefs.cast.join(', ')}.` : null,
    missingRefs.environments.length ? `Missing environment/location references: ${missingRefs.environments.join(', ')}.` : null,
    !storyboardWorkflow && hasScript && !promptsComplete ? 'Some shots are missing usable visual or motion prompts.' : null,
    storyboardWorkflow && hasScript && !storyboardPromptsComplete ? 'Some shots are missing storyboard prompts/cut plans.' : null,
    !storyboardWorkflow && counts.shots && counts.frames < counts.shots ? `${counts.shots - counts.frames} start frame${counts.shots - counts.frames === 1 ? '' : 's'} missing.` : null,
    storyboardWorkflow && counts.shots && counts.storyboards < counts.shots ? `${counts.shots - counts.storyboards} storyboard board${counts.shots - counts.storyboards === 1 ? '' : 's'} missing.` : null,
    storyboardWorkflow && counts.storyboards > counts.lockedStoryboards ? `${counts.storyboards - counts.lockedStoryboards} storyboard board${counts.storyboards - counts.lockedStoryboards === 1 ? '' : 's'} need review/lock before video.` : null,
    counts.shots && counts.videos < counts.shots ? `${counts.shots - counts.videos} video${counts.shots - counts.videos === 1 ? '' : 's'} missing.` : null,
    counts.shots && counts.lockedShots < counts.shots ? `${counts.shots - counts.lockedShots} shot${counts.shots - counts.lockedShots === 1 ? '' : 's'} not locked.` : null,
    classificationIssue,
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

export const shotLabel = (sceneIndex: number, shotIndex: number) => `S${sceneIndex + 1}.${shotIndex + 1}`;

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

export const listProjectRenders = async (projectId: string) => {
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
