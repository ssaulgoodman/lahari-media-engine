#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { selectColumns } from '../server/database.js';
import { getFullProject } from '../server/routes/projects.js';

type Project = Awaited<ReturnType<typeof getFullProject>>;

const usage = () => {
  console.log(`Lahari CLI

Read-only Codex-native studio helpers.

Usage:
  npm run lahari -- project list [limit]
  npm run lahari -- project packet <projectId>
  npm run lahari -- project report <projectId> [out.md]
  npm run lahari -- project contact-sheet <projectId> [out.html]
  npm run lahari -- shot packet <projectId> <shotId>

Output:
  JSON packets and local review artifacts designed for Codex inspection and future MCP wrapping.
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

const slugify = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'lahari-project';
};

const defaultArtifactPath = (project: Project, suffix: string): string => {
  return path.join(process.cwd(), '.lahari', 'codex', `${slugify(project.title)}-${suffix}`);
};

const writeArtifact = (filePath: string, content: string) => {
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

const listProjects = async (limitArg?: string) => {
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

const projectReport = (project: Project): string => {
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
      return `  - Shot ${shotIndex + 1} (${shot.duration}s, ${flags}): ${compactText((shot as any).direction || shot.visualPrompt, 180) || 'No beat/prompt'}`;
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

const projectContactSheet = (project: Project): string => {
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
      const body = compactText((shot as any).direction || shot.visualPrompt, 220) || undefined;
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
  const [domain, action, projectId, arg4] = process.argv.slice(2);

  if (!domain || domain === 'help' || domain === '--help' || domain === '-h') {
    usage();
    return;
  }

  if (domain === 'project' && action === 'list') {
    console.log(JSON.stringify(await listProjects(projectId), null, 2));
    return;
  }

  if (domain === 'project' && action === 'packet' && projectId) {
    const project = await getFullProject(projectId);
    console.log(JSON.stringify(projectPacket(project), null, 2));
    return;
  }

  if (domain === 'project' && action === 'report' && projectId) {
    const project = await getFullProject(projectId);
    const outPath = arg4 || defaultArtifactPath(project, 'director-report.md');
    const written = writeArtifact(outPath, projectReport(project));
    console.log(JSON.stringify({ kind: 'lahari.artifact', type: 'director-report', path: written }, null, 2));
    return;
  }

  if (domain === 'project' && action === 'contact-sheet' && projectId) {
    const project = await getFullProject(projectId);
    const outPath = arg4 || defaultArtifactPath(project, 'contact-sheet.html');
    const written = writeArtifact(outPath, projectContactSheet(project));
    console.log(JSON.stringify({ kind: 'lahari.artifact', type: 'contact-sheet', path: written }, null, 2));
    return;
  }

  if (domain === 'shot' && action === 'packet' && projectId && arg4) {
    const project = await getFullProject(projectId);
    console.log(JSON.stringify(shotPacket(project, arg4), null, 2));
    return;
  }

  usage();
  process.exitCode = 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
