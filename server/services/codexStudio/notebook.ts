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
import { getProjectConfigState } from '../projectConfig.js';

export type NotebookFile = {
  path: string;
  content: string;
  mode: 'mirror' | 'config' | 'journal' | 'instructions';
  writePolicy: 'overwrite' | 'create_if_missing' | 'review_before_overwrite';
  description: string;
};

const normalizedProjectDir = (project: Project) => `lahari/projects/${project.id}`;

const ensureNewline = (value: string) => value.endsWith('\n') ? value : `${value}\n`;

const buildWorkspaceInstructions = (project: Project): string => `# Lahari Workspace

This folder is the local notebook for Lahari project "${project.title}" (${project.id}).

Supabase is canonical. Files under mirrors/ are read-only desk copies written from Lahari state. Do not hand-edit mirrors; refresh them with write_project_notebook after attach or after major mutations.

Files under config/ are the editable project layer. Edit config/prompts/*.md or config/preferences.json when you want project-specific runtime behavior, then persist through the matching apply_project_* MCP tool.

Use journal.md for your own concise operator notes: what changed, why, and what to inspect next.

Default ritual:
1. attach_director_session
2. write_project_notebook
3. read relevant mirrors before proposing changes
4. apply approved changes through typed MCP tools
5. refresh affected notebook files
`;

const buildBrief = (project: Project, actions: ReturnType<typeof buildProjectActionList>): string => {
  const counts = statusCounts(project);
  const diagnosis = actions.diagnosis;
  return `# ${project.title}

Updated: ${new Date().toISOString()}
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

Updated: ${new Date().toISOString()}
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

Updated: ${new Date().toISOString()}
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

Updated: ${new Date().toISOString()}
Project: ${project.title}
Base fingerprint: ${scriptContentHash(project)}

${scenes}
`;
};

const buildStyle = (project: Project): string => `# Style

Updated: ${new Date().toISOString()}
Project: ${project.title}

- Locked style URL: ${project.styleAssetUrl || 'None'}
- Style directions explored: ${project.styleExploration?.slots?.length || 0}

## Direction

${md(project.styleDescription)}
`;

const buildCast = (project: Project): string => `# Cast / Entities

Updated: ${new Date().toISOString()}
Project: ${project.title}

${project.cast.length ? project.cast.map((member) => `## ${member.name}

- ID: ${member.id}
- Reference URL: ${member.referenceImageUrl || 'None'}
- Prompt stale: ${member.promptsStale ? 'yes' : 'no'}

${md(member.description)}`).join('\n\n') : 'No cast/entities saved.'}
`;

const buildEnvironments = (project: Project): string => `# Environments / Locations

Updated: ${new Date().toISOString()}
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

Updated: ${new Date().toISOString()}
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

Updated: ${new Date().toISOString()}
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
    generatedAt: new Date().toISOString(),
    script: { hash: scriptContentHash(project) },
    prompts: {
      storyboard: {
        hash: config.prompts.storyboard.hash,
        source: config.prompts.storyboard.source,
        overrideId: config.prompts.storyboard.overrideId,
      },
      video: {
        hash: config.prompts.video.hash,
        source: config.prompts.video.source,
        overrideId: config.prompts.video.overrideId,
      },
    },
    preferences: {
      hash: config.preferences.hash,
      source: config.preferences.source,
    },
  };
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
    {
      path: `${baseDir}/config/prompts/storyboard.md`,
      mode: 'config',
      writePolicy: 'review_before_overwrite',
      description: 'Editable project storyboard prompt recipe. Apply with apply_project_prompt_override(kind="storyboard").',
      content: ensureNewline(config.prompts.storyboard.body),
    },
    {
      path: `${baseDir}/config/prompts/video.md`,
      mode: 'config',
      writePolicy: 'review_before_overwrite',
      description: 'Editable project video prompt recipe. Apply with apply_project_prompt_override(kind="video").',
      content: ensureNewline(config.prompts.video.body),
    },
    {
      path: `${baseDir}/config/hashes.json`,
      mode: 'config',
      writePolicy: 'overwrite',
      description: 'Base hashes for drift-aware apply tools.',
      content: `${JSON.stringify(await buildHashes(project), null, 2)}\n`,
    },
    {
      path: `${baseDir}/journal.md`,
      mode: 'journal',
      writePolicy: 'create_if_missing',
      description: 'Local operator journal. Append notes here; do not overwrite unless intentionally resetting the notebook.',
      content: `# Lahari Journal

Project: ${project.title}
Project ID: ${project.id}

## ${new Date().toISOString()} - Notebook Created

Opened project and wrote the initial local notebook.
`,
    },
  ];

  return {
    kind: 'lahari.project.notebook',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      webUrl: webStudioUrl(project.id, { step: 'studio' }),
    },
    baseDir,
    files,
    writeInstructions: 'Write each file to path relative to the current workspace. Overwrite mirrors/ and hashes. Create journal.md only if missing. Before overwriting config/prompts or preferences, check whether the file has unsaved local edits; config files are editable project overrides. Append concise decisions to journal.md.',
  };
};
