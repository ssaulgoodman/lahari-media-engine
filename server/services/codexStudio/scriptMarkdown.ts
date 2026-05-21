import {
  scriptContentHash,
  type Project,
} from './core.js';
import { applyError, type ApplyError } from './applies/helpers.js';

export const SCRIPT_MARKDOWN_FORMAT = 'mirage-script-v1';

type ParsedScriptMarkdown = {
  baseFingerprint: string | null;
  projectId: string | null;
  script: {
    cast: { id: string; name: string; description: string }[];
    environments: { id: string; name: string; description: string }[];
    scenes: {
      id: string;
      sectionLabel: string;
      startTime: string;
      endTime: string;
      lyrics: string;
      narrativeDescription: string;
      shots: {
        id: string;
        direction: string;
        duration: number;
        castIds: string[];
        environmentId: string | null;
        continuityFrom: 'cut' | 'prev_shot';
      }[];
    }[];
  };
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

const sectionBetween = (body: string, start: string, endMarkers: string[]): string => {
  const startIndex = body.indexOf(start);
  if (startIndex < 0) return '';
  const contentStart = startIndex + start.length;
  const endIndexes = endMarkers
    .map((marker) => body.indexOf(marker, contentStart))
    .filter((index) => index >= 0);
  const contentEnd = endIndexes.length ? Math.min(...endIndexes) : body.length;
  return body.slice(contentStart, contentEnd);
};

const parseEntityBlocks = (
  body: string,
  headingPattern: RegExp,
): { id: string; name: string; description: string }[] => {
  const matches = [...body.matchAll(headingPattern)];
  return matches.map((match, index) => {
    const next = matches[index + 1];
    const start = (match.index || 0) + match[0].length;
    const end = next?.index ?? body.length;
    return {
      id: match[2].trim(),
      name: match[1].trim(),
      description: cleanBlock(body.slice(start, end)),
    };
  }).filter((entity) => entity.id && entity.name) || [];
};

const parseFieldBlock = (body: string, label: string, nextLabels: string[]): string => {
  const marker = `${label}:\n`;
  const start = body.indexOf(marker);
  if (start < 0) return '';
  const contentStart = start + marker.length;
  const endIndexes = [
    ...nextLabels.map((next) => body.indexOf(`${next}:\n`, contentStart)),
    body.indexOf('\n### Shot:', contentStart),
    body.indexOf('\n## Scene:', contentStart),
  ].filter((index) => index >= 0);
  const contentEnd = endIndexes.length ? Math.min(...endIndexes) : body.length;
  return cleanBlock(body.slice(contentStart, contentEnd));
};

export const buildScriptMarkdownDraft = (project: Project): string => {
  const frontmatter = `---
format: ${SCRIPT_MARKDOWN_FORMAT}
projectId: ${project.id}
scriptFingerprint: ${scriptContentHash(project)}
---

# Script Draft

Edit this file surgically, then apply it with apply_script_markdown. Keep IDs in brackets unchanged unless you are intentionally replacing that entity.
`;

  const cast = `## Cast

${project.cast.length ? project.cast.map((member) => `### Cast: ${member.name} [${member.id}]
${cleanBlock(member.description || '')}`).join('\n\n') : 'No cast/entities saved.'}
`;

  const environments = `## Environments

${project.environments.length ? project.environments.map((environment) => `### Environment: ${environment.name} [${environment.id}]
${cleanBlock(environment.description || '')}`).join('\n\n') : 'No environments/locations saved.'}
`;

  const scenes = `## Scenes

${project.scenes.length ? project.scenes.map((scene) => `## Scene: ${scene.sectionLabel || 'Untitled'} [${scene.id}] (${scene.startTime || '?'}-${scene.endTime || '?'})
Lyrics:
${cleanBlock(scene.lyrics || '')}

Narrative:
${cleanBlock(scene.narrativeDescription || '')}

${scene.shots.map((shot) => `### Shot: ${shot.id} (${Number(shot.duration || 0)}s)
Cast: ${(shot.castIds || []).join(', ') || 'none'}
Environment: ${shot.environmentId || 'none'}
Continuity: ${shot.continuityFrom || 'cut'}
Direction:
${cleanBlock(shot.direction || '')}`).join('\n\n')}`).join('\n\n') : 'No scenes saved.'}
`;

  return `${frontmatter}\n${cast}\n${environments}\n${scenes}`;
};

export const parseScriptMarkdownDraft = (body: string): ParsedScriptMarkdown | ApplyError => {
  const { meta, rest } = parseFrontmatter(body);
  if (meta.format !== SCRIPT_MARKDOWN_FORMAT) {
    return applyError('schema_invalid', `Script draft format must be ${SCRIPT_MARKDOWN_FORMAT}.`, { field: 'format' });
  }

  const castBody = sectionBetween(rest, '## Cast', ['\n## Environments', '\n## Scenes']);
  const envBody = sectionBetween(rest, '## Environments', ['\n## Scenes']);
  const scenesBody = sectionBetween(rest, '## Scenes', []);
  const cast = parseEntityBlocks(castBody, /^### Cast:\s+(.+?)\s+\[([^\]]+)\]\s*$/gm);
  const environments = parseEntityBlocks(envBody, /^### Environment:\s+(.+?)\s+\[([^\]]+)\]\s*$/gm);

  const sceneMatches = [...scenesBody.matchAll(/^## Scene:\s+(.+?)\s+\[([^\]]+)\]\s+\(([^-)]+)-([^)]+)\)\s*$/gm)];
  const scenes = sceneMatches.map((match, index) => {
    const next = sceneMatches[index + 1];
    const start = (match.index || 0) + match[0].length;
    const end = next?.index ?? scenesBody.length;
    const sceneBody = scenesBody.slice(start, end);
    const shotMatches = [...sceneBody.matchAll(/^### Shot:\s+([^\s]+)\s+\(([\d.]+)s\)\s*$/gm)];
    const shots = shotMatches.map((shotMatch, shotIndex) => {
      const nextShot = shotMatches[shotIndex + 1];
      const shotStart = (shotMatch.index || 0) + shotMatch[0].length;
      const shotEnd = nextShot?.index ?? sceneBody.length;
      const shotBody = sceneBody.slice(shotStart, shotEnd);
      const castLine = shotBody.match(/^Cast:\s*(.*)$/m)?.[1]?.trim() || '';
      const envLine = shotBody.match(/^Environment:\s*(.*)$/m)?.[1]?.trim() || '';
      const continuity = shotBody.match(/^Continuity:\s*(.*)$/m)?.[1]?.trim() || 'cut';
      return {
        id: shotMatch[1].trim(),
        duration: Number(shotMatch[2]),
        castIds: castLine && castLine !== 'none' ? castLine.split(',').map((id) => id.trim()).filter(Boolean) : [],
        environmentId: envLine && envLine !== 'none' ? envLine : null,
        continuityFrom: continuity === 'prev_shot' ? 'prev_shot' as const : 'cut' as const,
        direction: parseFieldBlock(shotBody, 'Direction', []),
      };
    });
    return {
      id: match[2].trim(),
      sectionLabel: match[1].trim(),
      startTime: match[3].trim(),
      endTime: match[4].trim(),
      lyrics: parseFieldBlock(sceneBody, 'Lyrics', ['Narrative']),
      narrativeDescription: parseFieldBlock(sceneBody, 'Narrative', []),
      shots,
    };
  });

  if (!cast.length && body.includes('### Cast:')) return applyError('schema_invalid', 'Could not parse cast section.', { field: 'cast' });
  if (!environments.length && body.includes('### Environment:')) return applyError('schema_invalid', 'Could not parse environments section.', { field: 'environments' });
  if (!scenes.length && body.includes('## Scene:')) return applyError('schema_invalid', 'Could not parse scenes section.', { field: 'scenes' });

  return {
    baseFingerprint: meta.scriptFingerprint || null,
    projectId: meta.projectId || null,
    script: { cast, environments, scenes },
  };
};
