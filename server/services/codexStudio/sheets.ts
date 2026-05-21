import {
  compactText,
  defaultArtifactPath,
  deriveDirectorDiagnosis,
  escapeHtml,
  hasUsableShotPrompts,
  listProjectRenders,
  md,
  missingReferenceNames,
  recommendedActions,
  statusCounts,
  usesStoryboardWorkflow,
  webStudioUrl,
  type Project,
} from './core.js';

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

  return `# Mirage Director Report

Generated: ${new Date().toISOString()}

## Project

- Title: ${project.title}
- ID: ${project.id}
- Status: ${project.status}
- Preset: ${project.presetKey || 'unknown'}
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

${project.lockedConcept ? `Locked: ${project.lockedConcept.title || project.lockedConcept.subject || project.lockedConcept.primarySubject || 'Untitled'}\n\n${md(project.lockedConcept.description || project.lockedConcept.conceptDirection)}` : 'No locked concept.'}

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
