import { storyboardPromptHash, type Project } from './core.js';
import { applyError, type ApplyError } from './applies/helpers.js';

export const STORYBOARD_SCENE_MARKDOWN_FORMAT = 'lahari-storyboard-scene-v1';

export type ParsedStoryboardSceneMarkdown = {
  projectId: string | null;
  sceneId: string | null;
  shots: {
    shotId: string;
    storyboardPrompt: string;
    storyboardCutPlan: string;
    baseHash?: string;
  }[];
};

const cleanBlock = (value: string): string => value
  .replace(/^\n+|\n+$/g, '')
  .split('\n')
  .map((line) => line.trimEnd())
  .join('\n')
  .trim();

const parseFrontmatter = (body: string): { meta: Record<string, string>; rest: string } => {
  if (!body.startsWith('---\n')) return { meta: {}, rest: body };
  const end = body.indexOf('\n---', 4);
  if (end < 0) return { meta: {}, rest: body };
  const raw = body.slice(4, end).trim();
  const meta: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) meta[match[1]] = match[2].trim();
  }
  return { meta, rest: body.slice(end + 4).replace(/^\n+/, '') };
};

const parseFieldBlock = (body: string, label: string, nextLabels: string[]): string => {
  const marker = `${label}:\n`;
  const start = body.indexOf(marker);
  if (start < 0) return '';
  const contentStart = start + marker.length;
  const endIndexes = [
    ...nextLabels.map((next) => body.indexOf(`${next}:\n`, contentStart)),
    body.indexOf('\n## Shot:', contentStart),
  ].filter((index) => index >= 0);
  const contentEnd = endIndexes.length ? Math.min(...endIndexes) : body.length;
  return cleanBlock(body.slice(contentStart, contentEnd));
};

const sceneSlug = (sceneIndex: number, scene: Project['scenes'][number]): string => {
  const label = (scene.sectionLabel || `scene-${sceneIndex + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || `scene-${sceneIndex + 1}`;
  return `${String(sceneIndex + 1).padStart(2, '0')}-${label}`;
};

export const storyboardSceneDraftPath = (
  project: Project,
  sceneIndex: number,
  scene: Project['scenes'][number],
): string => `lahari/projects/${project.id}/drafts/storyboards/${sceneSlug(sceneIndex, scene)}.md`;

export const buildStoryboardSceneMarkdownDraft = (
  project: Project,
  sceneIndex: number,
  scene: Project['scenes'][number],
): string => {
  const frontmatter = `---
format: ${STORYBOARD_SCENE_MARKDOWN_FORMAT}
projectId: ${project.id}
sceneId: ${scene.id}
---

# Storyboard Scene Draft

Edit this file scene-by-scene, then apply it with apply_storyboard_scene_markdown. Preserve shot IDs and base hashes unless you intentionally force through drift.

Scene: ${scene.sectionLabel || `Scene ${sceneIndex + 1}`}
Time: ${scene.startTime || '?'}-${scene.endTime || '?'}

## Scene Intent

${cleanBlock(scene.narrativeDescription || scene.lyrics || '') || '(write the scene-level visual/emotional continuity note here)'}
`;

  const shots = scene.shots.map((shot, shotIndex) => `## Shot: ${sceneIndex + 1}.${shotIndex + 1} [${shot.id}]
Base hash: ${storyboardPromptHash(shot)}
Workflow mode: ${shot.workflowMode || 'auto'}
Extra shot: ${(shot as any).isExtra ? 'yes' : 'no'}
Duration: ${Number(shot.duration || 0)}s
Direction:
${cleanBlock(shot.direction || '')}

Storyboard Prompt:
${cleanBlock(shot.storyboardPrompt || '')}

Cut Plan:
${cleanBlock(shot.storyboardCutPlan || '')}
`).join('\n');

  return `${frontmatter}\n${shots || 'No shots saved.'}`;
};

export const parseStoryboardSceneMarkdownDraft = (body: string): ParsedStoryboardSceneMarkdown | ApplyError => {
  const { meta, rest } = parseFrontmatter(body);
  if (meta.format !== STORYBOARD_SCENE_MARKDOWN_FORMAT) {
    return applyError('schema_invalid', `Storyboard scene draft format must be ${STORYBOARD_SCENE_MARKDOWN_FORMAT}.`, { field: 'format' });
  }

  const shotMatches = [...rest.matchAll(/^## Shot:\s+(.+?)\s+\[([^\]]+)\]\s*$/gm)];
  const shots = shotMatches.map((match, index) => {
    const next = shotMatches[index + 1];
    const start = (match.index || 0) + match[0].length;
    const end = next?.index ?? rest.length;
    const shotBody = rest.slice(start, end);
    const baseHash = shotBody.match(/^Base hash:\s*(.*)$/m)?.[1]?.trim() || undefined;
    return {
      shotId: match[2].trim(),
      baseHash,
      storyboardPrompt: parseFieldBlock(shotBody, 'Storyboard Prompt', ['Cut Plan']),
      storyboardCutPlan: parseFieldBlock(shotBody, 'Cut Plan', []),
    };
  });

  if (!shots.length && body.includes('## Shot:')) {
    return applyError('schema_invalid', 'Could not parse storyboard scene shots.', { field: 'shots' });
  }
  if (!shots.length) {
    return applyError('validation_failed', 'Storyboard scene draft contains no shots.', { field: 'shots' });
  }
  const missingPrompt = shots.find((shot) => !shot.storyboardPrompt.trim());
  if (missingPrompt) {
    return applyError('validation_failed', 'Each storyboard scene draft shot must include a Storyboard Prompt block.', { shotId: missingPrompt.shotId, field: 'storyboardPrompt' });
  }

  return {
    projectId: meta.projectId || null,
    sceneId: meta.sceneId || null,
    shots,
  };
};
