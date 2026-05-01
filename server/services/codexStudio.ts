import fs from 'fs';
import path from 'path';
import { selectColumns, updateRows } from '../database.js';
import type { getFullProject } from '../routes/projects.js';
import { writeShotPrompts } from './claude.js';

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
    'id,title,status,song_type,is_narrative,is_meditative,image_model,video_model,created_at,updated_at',
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
      imageModel: row.image_model || 'gemini-3-pro',
      videoModel: row.video_model || 'veo-3.1',
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

export const recommendedActions = (project: Project): string[] => {
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

export const deriveCheckpointState = (project: Project) => {
  const counts = statusCounts(project);
  const missingRefs = missingReferenceNames(project);
  const hasConcept = !!project.lockedConcept;
  const hasScript = counts.scenes > 0 && counts.shots > 0;
  const hasStyle = !!project.styleAssetUrl;
  const refsComplete = missingRefs.cast.length === 0 && missingRefs.environments.length === 0;
  const promptsComplete = hasScript && project.scenes.every((scene) => scene.shots.every((shot) => (
    !!shot.visualPrompt
    && !!shot.motionPrompt
    && shot.motionPrompt !== 'Cinematic camera movement'
  )));
  const framesComplete = counts.shots > 0 && counts.frames === counts.shots;
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
  } else if (framesComplete) {
    key = 'video_generation';
    label = 'Video generation';
    summary = 'Start frames are complete. Generate or retry shot videos, respecting chained-shot dependencies.';
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
    hasScript && !promptsComplete ? 'Some shots are missing usable visual or motion prompts.' : null,
    counts.shots && counts.frames < counts.shots ? `${counts.shots - counts.frames} start frame${counts.shots - counts.frames === 1 ? '' : 's'} missing.` : null,
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

export const buildProjectPacket = (project: Project) => {
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
          beat: compactText(shot.direction || shot.visualPrompt, 220),
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

  const sceneLines = project.scenes.map((scene, sceneIndex) => {
    const shotSummary = scene.shots.map((shot, shotIndex) => {
      const flags = [
        shot.imageUrl ? 'frame' : 'no-frame',
        shot.videoUrl ? 'video' : 'no-video',
        shot.locked ? 'locked' : null,
        shot.promptsStale ? 'stale' : null,
        shot.lastError ? 'error' : null,
        shot.continuityFrom === 'prev_shot' ? 'chain' : null,
      ].filter(Boolean).join(', ');
      return `  - Shot ${shotIndex + 1} (${shot.duration}s, ${flags}): ${compactText(shot.direction || shot.visualPrompt, 180) || 'No beat/prompt'}`;
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
- Models: image ${project.imageModel}, video ${project.videoModel}
- Format: ${project.aspectRatio}, ${project.videoResolution}, target shot duration ${project.targetDuration || 'unset'}s

## Production Counts

- Scenes: ${counts.scenes}
- Shots: ${counts.shots}
- Start frames: ${counts.frames}/${counts.shots}
- Videos: ${counts.videos}/${counts.shots}
- Locked shots: ${counts.lockedShots}/${counts.shots}
- Chained shots: ${counts.chainedShots}
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
        shot.locked ? 'locked' : null,
        shot.promptsStale ? 'stale' : null,
      ].filter(Boolean).join(' · ');
      const title = `S${sceneIndex + 1}.${shotIndex + 1}`;
      const body = compactText(shot.direction || shot.visualPrompt, 220) || undefined;
      return imageCard(title, shot.imageUrl, labels, body);
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

  <h2>Storyboard Frames</h2>
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
        beat: compactText(shot.direction || shot.visualPrompt, 500),
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

const journalEntry = (title: string, body: string): string => {
  return `\n\n## ${new Date().toISOString()} — ${title}\n\n${body.trim()}\n`;
};

const sessionState = (project: Project, note?: string | null) => {
  const checkpoint = deriveCheckpointState(project);
  return {
    kind: 'lahari.director.session',
    updatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      preset: 'bhakti-music-video',
      imageModel: project.imageModel,
      videoModel: project.videoModel,
      updatedAt: project.updatedAt,
    },
    checkpoint,
    note: note || null,
    files: {
      state: sessionStatePath(project.id),
      journal: sessionJournalPath(project.id),
      directorReport: defaultArtifactPath(project, 'director-report.md'),
      contactSheet: defaultArtifactPath(project, 'contact-sheet.html'),
    },
    guardrails: [
      'Read-only inspection is allowed without approval.',
      'Ask before paid generation, DB writes, lock/unlock changes, deletes, publish, or destructive rewrites.',
      'Use preview/diff artifacts before overwriting creative work.',
    ],
  };
};

export const attachDirectorSession = (project: Project, note?: string) => {
  const dir = sessionDir(project.id);
  fs.mkdirSync(dir, { recursive: true });

  const state = sessionState(project, note);
  fs.writeFileSync(sessionStatePath(project.id), `${JSON.stringify(state, null, 2)}\n`);

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

  fs.appendFileSync(journalPath, journalEntry('session attached', `Checkpoint: ${state.checkpoint.label}\n\n${state.checkpoint.summary}${noteBlock}\n\nOpen issues:\n${issues}\n\nRecommended next actions:\n${actions}`));

  return {
    kind: 'lahari.director.session.attached',
    projectId: project.id,
    statePath: sessionStatePath(project.id),
    journalPath,
    checkpoint: state.checkpoint,
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
