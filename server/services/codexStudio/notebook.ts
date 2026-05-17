import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  compactText,
  md,
  scriptContentHash,
  shotPromptHash,
  shotLabel,
  storyboardPromptHash,
  statusCounts,
  usesStoryboardWorkflow,
  webStudioUrl,
  type Project,
} from './core.js';
import { buildProjectActionList } from './plans.js';
import { getProjectConfigState, PROJECT_PROMPT_OVERRIDE_KINDS, type ProjectPromptOverrideKind } from '../projectConfig.js';
import { buildScriptMarkdownDraft } from './scriptMarkdown.js';

export type NotebookFile = {
  path: string;
  content: string;
  mode: 'mirror' | 'draft' | 'config' | 'journal' | 'instructions' | 'skill';
  writePolicy: 'overwrite' | 'create_if_missing' | 'review_before_overwrite';
  description: string;
};

const normalizedProjectDir = (project: Project) => `lahari/projects/${project.id}`;
const LAHARI_SKILL_NAMES = [
  'lahari-director',
  'storyboard-prompt-craft',
  'script-doctor',
  'continuity-auditor',
  'style-ref-critic',
  'render-triage',
] as const;
const NOTEBOOK_VERSION = '2026-05-17.editable-script-v1';

const ensureNewline = (value: string) => value.endsWith('\n') ? value : `${value}\n`;

const projectUpdatedAt = (project: Project) => project.updatedAt || project.createdAt || 'unknown';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const buildWorkspaceInstructions = (project: Project): string => `# Lahari Workspace

This folder is the local notebook for Lahari project "${project.title}" (${project.id}).

Notebook version: ${NOTEBOOK_VERSION}

Supabase is canonical. This is an artist notebook, not the Lahari source checkout. Use Lahari MCP tools for project reads, applies, generation, locks, and issue capture. If those tools are unavailable, stop and reconnect Lahari instead of substituting shell commands.

If the MCP server returns a newer notebookVersion than the one shown here or in lahari/projects/${project.id}/notebook.json, refresh by calling write_project_notebook and writing the returned files before continuing.

Files under mirrors/ are read-only desk copies written from Lahari state. Do not hand-edit mirrors; refresh them with write_project_notebook after attach or after major mutations.

Files under drafts/ are editable working copies. For script changes, edit drafts/script.md surgically, preserve IDs unless intentionally replacing an entity, then apply with apply_script_markdown. If apply reports drift_detected, refresh the notebook and reconcile before retrying.

Files under config/ are the editable project layer. Edit config/prompts/*.md or config/preferences.json when you want project-specific runtime behavior, then persist through the matching apply_project_* MCP tool.

Project-local Lahari skills live under .agents/skills/ for Codex and .claude/skills/ for Claude Code. After this notebook is first written, restart or open a fresh harness session in this folder so native skill discovery can pick them up.

Use journal.md for your own concise operator notes: what changed, why, and what to inspect next.

Default ritual:
1. resolve_project when the artist names a song or project; use list_queue/search_catalog when browsing availability
2. attach_director_session once you have a projectId
3. write_project_notebook
4. read relevant mirrors before proposing changes
5. apply approved changes through typed MCP tools
6. refresh affected notebook files
`;

const readSkillBody = (skillName: string): string => {
  const skillPathCandidates = [
    path.join(process.cwd(), 'server', 'resources', 'skills', skillName, 'SKILL.md'),
    path.join(moduleDir, '..', '..', 'resources', 'skills', skillName, 'SKILL.md'),
    path.join(process.cwd(), '.agents', 'skills', skillName, 'SKILL.md'),
  ];
  const skillPath = skillPathCandidates.find((candidate) => fs.existsSync(candidate));
  if (!skillPath) {
    throw new Error(`Lahari notebook skill resource missing: ${skillName}`);
  }
  return fs.readFileSync(skillPath, 'utf8');
};

const buildSkillFiles = (): NotebookFile[] => LAHARI_SKILL_NAMES.flatMap((skillName) => {
  const content = readSkillBody(skillName);
  return [
    {
      path: `.agents/skills/${skillName}/SKILL.md`,
      mode: 'skill',
      writePolicy: 'overwrite',
      description: `Codex project-local Lahari skill: ${skillName}. Restart/open a fresh session after first write.`,
      content,
    },
    {
      path: `.claude/skills/${skillName}/SKILL.md`,
      mode: 'skill',
      writePolicy: 'overwrite',
      description: `Claude Code project-local Lahari skill: ${skillName}. Restart/open a fresh session after first write.`,
      content,
    },
  ];
});

const buildBrief = (project: Project, actions: ReturnType<typeof buildProjectActionList>): string => {
  const counts = statusCounts(project);
  const diagnosis = actions.diagnosis;
  return `# ${project.title}

Updated: ${projectUpdatedAt(project)}
Project ID: ${project.id}
Web: ${webStudioUrl(project.id, { step: 'studio' })}

## Current Read

${diagnosis.productionRead}

- Status: ${project.status}
- Workflow: ${usesStoryboardWorkflow(project) ? 'storyboard' : 'keyframe'}
- Models: text ${project.textProvider}, image ${project.imageModel}, storyboard ${project.storyboardProvider}, video ${project.videoModel}
- Counts: ${counts.scenes} scenes, ${counts.shots} shots, ${counts.storyboardPrompts}/${counts.shots} storyboard prompts, ${counts.storyboards}/${counts.shots} boards, ${counts.videos}/${counts.shots} videos

## Bottleneck

${diagnosis.bottleneck}

## Next Approved Action

${diagnosis.nextApprovedAction}

## Weak Links

${diagnosis.weakLinks.length ? diagnosis.weakLinks.map((item) => `- ${item}`).join('\n') : '- None from deterministic checks.'}
`;
};

const buildConcept = (project: Project): string => {
  const locked = project.lockedConcept;
  return `# Concept

Updated: ${projectUpdatedAt(project)}
Project: ${project.title}

## Locked Concept

${locked ? `### ${locked.title || locked.deity || 'Untitled'}

- Direction: ${locked.direction || locked.conceptDirection || 'None'}
- Deity: ${locked.deity || 'None'}
- Mood: ${locked.mood || 'None'}

${md(locked.description || locked.conceptDirection || JSON.stringify(locked, null, 2))}` : 'No locked concept.'}
`;
};

const buildAudioAnalysis = (project: Project): string => {
  const structure = project.musicalStructure.length
    ? project.musicalStructure.map((section: any) => `- ${section.label || 'Section'} ${section.startTime || '?'}-${section.endTime || '?'}${section.energyLevel ? `, energy ${section.energyLevel}` : ''}: ${section.description || ''}`).join('\n')
    : '- No musical structure saved.';

  return `# Audio Analysis

Updated: ${projectUpdatedAt(project)}
Project: ${project.title}

## Classification

- Song type: ${project.songType || 'unknown'}
- Narrative: ${project.isNarrative ?? 'unknown'}
- Meditative: ${project.isMeditative ?? 'unknown'}

## Meaning

${md(project.meaning)}

## Musical Structure

${structure}

## Lyrics

${md(project.lyrics)}
`;
};

const buildScript = (project: Project): string => {
  const scenes = project.scenes.length
    ? project.scenes.map((scene, sceneIndex) => {
      const shots = scene.shots.map((shot, shotIndex) => `- ${shotLabel(sceneIndex, shotIndex)} (${shot.duration}s, ${shot.continuityFrom || 'cut'}): ${shot.direction || 'No direction.'}`).join('\n');
      return `## Scene ${sceneIndex + 1}: ${scene.sectionLabel || 'Untitled'} (${scene.startTime || '?'}-${scene.endTime || '?'})

${md(scene.narrativeDescription)}

${shots || 'No shots.'}`;
    }).join('\n\n')
    : 'No scenes saved.';

  return `# Script

Updated: ${projectUpdatedAt(project)}
Project: ${project.title}
Base fingerprint: ${scriptContentHash(project)}

${scenes}
`;
};

const buildStyle = (project: Project): string => `# Style

Updated: ${projectUpdatedAt(project)}
Project: ${project.title}

- Locked style URL: ${project.styleAssetUrl || 'None'}
- Style directions explored: ${project.styleExploration?.slots?.length || 0}

## Direction

${md(project.styleDescription)}
`;

const buildCast = (project: Project): string => `# Cast / Entities

Updated: ${projectUpdatedAt(project)}
Project: ${project.title}

${project.cast.length ? project.cast.map((member) => `## ${member.name}

- ID: ${member.id}
- Reference URL: ${member.referenceImageUrl || 'None'}
- Prompt stale: ${member.promptsStale ? 'yes' : 'no'}

${md(member.description)}`).join('\n\n') : 'No cast/entities saved.'}
`;

const buildEnvironments = (project: Project): string => `# Environments / Locations

Updated: ${projectUpdatedAt(project)}
Project: ${project.title}

${project.environments.length ? project.environments.map((environment) => `## ${environment.name}

- ID: ${environment.id}
- Reference URL: ${environment.referenceImageUrl || 'None'}
- Prompt stale: ${environment.promptsStale ? 'yes' : 'no'}

${md(environment.description)}`).join('\n\n') : 'No environments/locations saved.'}
`;

const buildShotPrompts = (project: Project): string => {
  const body = project.scenes.flatMap((scene, sceneIndex) => scene.shots.map((shot, shotIndex) => `## ${shotLabel(sceneIndex, shotIndex)}: ${compactText(shot.direction, 120) || 'Shot'}

- Shot ID: ${shot.id}
- Shot prompt base hash: ${shotPromptHash(shot)}
- Storyboard base hash: ${storyboardPromptHash(shot)}
- Duration: ${shot.duration}s
- Continuity: ${shot.continuityFrom || 'cut'}
- Stale: ${shot.promptsStale ? 'yes' : 'no'}
- Board: ${shot.storyboardUrl || 'None'}
- Video: ${shot.videoUrl || 'None'}

### Direction

${md(shot.direction)}

### Visual Prompt

${md(shot.visualPrompt)}

### Motion Prompt

${md(shot.motionPrompt)}

### Storyboard Prompt

${md(shot.storyboardPrompt)}

### Cut Plan

${md(shot.storyboardCutPlan)}
`)).join('\n');

  return `# Shot Prompts

Updated: ${projectUpdatedAt(project)}
Project: ${project.title}

${body || 'No shots saved.'}
`;
};

const buildStoryboardFile = (project: Project, sceneIndex: number, shotIndex: number, shot: Project['scenes'][number]['shots'][number]): NotebookFile => ({
  path: `${normalizedProjectDir(project)}/mirrors/storyboards/${shot.id}.md`,
  mode: 'mirror',
  writePolicy: 'overwrite',
  description: `Storyboard prompt mirror for ${shotLabel(sceneIndex, shotIndex)}.`,
  content: `# ${shotLabel(sceneIndex, shotIndex)} Storyboard

Updated: ${projectUpdatedAt(project)}
Project: ${project.title}
Shot ID: ${shot.id}
Base hash: ${storyboardPromptHash(shot)}

## Direction

${md(shot.direction)}

## Storyboard Prompt

${md(shot.storyboardPrompt)}

## Cut Plan

${md(shot.storyboardCutPlan)}

## Current Board

- URL: ${shot.storyboardUrl || 'None'}
- Locked: ${shot.storyboardLocked ? 'yes' : 'no'}
- Status: ${shot.storyboardStatus || 'idle'}
`,
});

const buildHashes = async (project: Project) => {
  const config = await getProjectConfigState(project);
  return {
    generatedAt: projectUpdatedAt(project),
    script: { hash: scriptContentHash(project) },
    prompts: {
      ...Object.fromEntries(PROJECT_PROMPT_OVERRIDE_KINDS.map((kind) => [
        kind,
        {
          hash: config.prompts[kind].hash,
          source: config.prompts[kind].source,
          overrideId: config.prompts[kind].overrideId,
        },
      ])),
    },
    preferences: {
      hash: config.preferences.hash,
      source: config.preferences.source,
    },
  };
};

const buildNotebookMeta = (project: Project, actions: ReturnType<typeof buildProjectActionList>) => ({
  notebookVersion: NOTEBOOK_VERSION,
  generatedAt: new Date().toISOString(),
  project: {
    id: project.id,
    title: project.title,
    status: project.status,
    updatedAt: projectUpdatedAt(project),
    webUrl: webStudioUrl(project.id, { step: 'studio' }),
  },
  discovery: {
    openerTool: 'resolve_project',
    browseTools: ['list_queue', 'search_catalog'],
  },
  diagnosis: actions.diagnosis,
});

export const buildNotebookMirrorArtifacts = (
  project: Project,
  opts: {
    brief?: boolean;
    audioAnalysis?: boolean;
    concept?: boolean;
    script?: boolean;
    scriptDraft?: boolean;
    style?: boolean;
    cast?: boolean;
    environments?: boolean;
    shotPrompts?: boolean;
    storyboardShotIds?: string[];
  } = {},
): NotebookFile[] => {
  const baseDir = normalizedProjectDir(project);
  const files: NotebookFile[] = [];
  if (opts.brief) {
    files.push({
      path: `${baseDir}/mirrors/brief.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Compact production read and next action.',
      content: buildBrief(project, buildProjectActionList(project)),
    });
  }
  if (opts.audioAnalysis) {
    files.push({
      path: `${baseDir}/mirrors/audio-analysis.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Audio meaning, classification, lyrics, and structure mirror.',
      content: buildAudioAnalysis(project),
    });
  }
  if (opts.concept) {
    files.push({
      path: `${baseDir}/mirrors/concept.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Locked concept mirror.',
      content: buildConcept(project),
    });
  }
  if (opts.script) {
    files.push({
      path: `${baseDir}/mirrors/script.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Script mirror with scenes and shot beats.',
      content: buildScript(project),
    });
  }
  if (opts.scriptDraft) {
    files.push({
      path: `${baseDir}/drafts/script.md`,
      mode: 'draft',
      writePolicy: 'review_before_overwrite',
      description: 'Editable script draft. Edit surgically and apply with apply_script_markdown.',
      content: buildScriptMarkdownDraft(project),
    });
  }
  if (opts.style) {
    files.push({
      path: `${baseDir}/mirrors/style.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Style direction and locked style URL mirror.',
      content: buildStyle(project),
    });
  }
  if (opts.cast) {
    files.push({
      path: `${baseDir}/mirrors/cast.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Character/entity mirror.',
      content: buildCast(project),
    });
  }
  if (opts.environments) {
    files.push({
      path: `${baseDir}/mirrors/environments.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Environment/location mirror.',
      content: buildEnvironments(project),
    });
  }
  if (opts.shotPrompts) {
    files.push({
      path: `${baseDir}/mirrors/shot-prompts.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Per-shot prompt mirror.',
      content: buildShotPrompts(project),
    });
  }
  if (opts.storyboardShotIds?.length) {
    const requested = new Set(opts.storyboardShotIds);
    for (const [sceneIndex, scene] of project.scenes.entries()) {
      for (const [shotIndex, shot] of scene.shots.entries()) {
        if (requested.has(shot.id)) files.push(buildStoryboardFile(project, sceneIndex, shotIndex, shot));
      }
    }
  }
  return files;
};

export const buildNotebookConfigArtifacts = async (
  project: Project,
  opts: { preferences?: boolean; promptKinds?: ProjectPromptOverrideKind[]; hashes?: boolean } = {},
): Promise<NotebookFile[]> => {
  const baseDir = normalizedProjectDir(project);
  const config = await getProjectConfigState(project);
  const files: NotebookFile[] = [];
  if (opts.preferences) {
    files.push({
      path: `${baseDir}/config/preferences.json`,
      mode: 'config',
      writePolicy: 'review_before_overwrite',
      description: 'Editable project model preferences. Apply with apply_project_preferences.',
      content: `${JSON.stringify(config.preferences.preferences, null, 2)}\n`,
    });
  }
  for (const kind of opts.promptKinds || []) {
    files.push({
      path: `${baseDir}/config/prompts/${kind}.md`,
      mode: 'config',
      writePolicy: 'review_before_overwrite',
      description: `Editable project ${kind} prompt recipe. Apply with apply_project_prompt_override(kind="${kind}").`,
      content: ensureNewline(config.prompts[kind].body),
    });
  }
  if (opts.hashes) {
    files.push({
      path: `${baseDir}/config/hashes.json`,
      mode: 'config',
      writePolicy: 'overwrite',
      description: 'Base hashes for drift-aware apply tools.',
      content: `${JSON.stringify(await buildHashes(project), null, 2)}\n`,
    });
  }
  return files;
};

export const buildProjectNotebook = async (project: Project) => {
  const baseDir = normalizedProjectDir(project);
  const actions = buildProjectActionList(project);
  const config = await getProjectConfigState(project);
  const files: NotebookFile[] = [
    {
      path: 'AGENTS.md',
      mode: 'instructions',
      writePolicy: 'overwrite',
      description: 'Workspace-local Lahari notebook instructions.',
      content: buildWorkspaceInstructions(project),
    },
    {
      path: 'CLAUDE.md',
      mode: 'instructions',
      writePolicy: 'overwrite',
      description: 'Claude Code workspace-local Lahari notebook instructions.',
      content: buildWorkspaceInstructions(project),
    },
    ...buildSkillFiles(),
    {
      path: `${baseDir}/mirrors/brief.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Compact production read and next action.',
      content: buildBrief(project, actions),
    },
    {
      path: `${baseDir}/mirrors/audio-analysis.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Audio meaning, classification, lyrics, and structure mirror.',
      content: buildAudioAnalysis(project),
    },
    {
      path: `${baseDir}/mirrors/concept.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Locked concept mirror.',
      content: buildConcept(project),
    },
    {
      path: `${baseDir}/mirrors/script.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Script mirror with scenes and shot beats.',
      content: buildScript(project),
    },
    {
      path: `${baseDir}/drafts/script.md`,
      mode: 'draft',
      writePolicy: 'review_before_overwrite',
      description: 'Editable script draft. Edit surgically and apply with apply_script_markdown.',
      content: buildScriptMarkdownDraft(project),
    },
    {
      path: `${baseDir}/mirrors/style.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Style direction and locked style URL mirror.',
      content: buildStyle(project),
    },
    {
      path: `${baseDir}/mirrors/cast.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Character/entity mirror.',
      content: buildCast(project),
    },
    {
      path: `${baseDir}/mirrors/environments.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Environment/location mirror.',
      content: buildEnvironments(project),
    },
    {
      path: `${baseDir}/mirrors/shot-prompts.md`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Per-shot prompt mirror.',
      content: buildShotPrompts(project),
    },
    ...project.scenes.flatMap((scene, sceneIndex) => scene.shots.map((shot, shotIndex) => buildStoryboardFile(project, sceneIndex, shotIndex, shot))),
    {
      path: `${baseDir}/config/preferences.json`,
      mode: 'config',
      writePolicy: 'review_before_overwrite',
      description: 'Editable project model preferences. Apply with apply_project_preferences.',
      content: `${JSON.stringify(config.preferences.preferences, null, 2)}\n`,
    },
    ...PROJECT_PROMPT_OVERRIDE_KINDS.map((kind) => ({
      path: `${baseDir}/config/prompts/${kind}.md`,
      mode: 'config' as const,
      writePolicy: 'review_before_overwrite' as const,
      description: `Editable project ${kind} prompt recipe. Apply with apply_project_prompt_override(kind="${kind}").`,
      content: ensureNewline(config.prompts[kind].body),
    })),
    {
      path: `${baseDir}/config/hashes.json`,
      mode: 'config',
      writePolicy: 'overwrite',
      description: 'Base hashes for drift-aware apply tools.',
      content: `${JSON.stringify(await buildHashes(project), null, 2)}\n`,
    },
    {
      path: `${baseDir}/notebook.json`,
      mode: 'mirror',
      writePolicy: 'overwrite',
      description: 'Machine-readable notebook metadata, including notebookVersion for stale-workspace checks.',
      content: `${JSON.stringify(buildNotebookMeta(project, actions), null, 2)}\n`,
    },
    {
      path: `${baseDir}/journal.md`,
      mode: 'journal',
      writePolicy: 'create_if_missing',
      description: 'Local operator journal. Append notes here; do not overwrite unless intentionally resetting the notebook.',
      content: `# Lahari Journal

Project: ${project.title}
Project ID: ${project.id}

## ${projectUpdatedAt(project)} - Notebook Created

Opened project and wrote the initial local notebook.
`,
    },
  ];

  return {
    kind: 'lahari.project.notebook',
    notebookVersion: NOTEBOOK_VERSION,
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      webUrl: webStudioUrl(project.id, { step: 'studio' }),
    },
    baseDir,
    files,
    writeInstructions: 'Write each file to path relative to the current workspace. Overwrite AGENTS.md, CLAUDE.md, .agents/skills, .claude/skills, mirrors/, and hashes. Create journal.md only if missing. Before overwriting drafts/ or config/, check whether the file has unsaved local edits; drafts are editable working copies and config files are editable project overrides. Apply script draft edits with apply_script_markdown. After the first notebook write, restart/open a fresh Codex or Claude session in this folder so project-local skills are discovered. Append concise decisions to journal.md.',
  };
};
