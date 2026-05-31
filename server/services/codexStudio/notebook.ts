import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  compactText,
  md,
  audioPlanHash,
  hashJson,
  scriptContentHash,
  styleDirectionHash,
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
import { getCalls, type XRayEntry, type XRayReference } from '../../xray.js';
import { buildScriptMarkdownDraft } from './scriptMarkdown.js';
import { buildAudioPlanMarkdownDraft } from './audioPlanMarkdown.js';
import { buildStoryboardSceneMarkdownDraft, storyboardSceneDraftPath } from './storyboardMarkdown.js';
import {
  ACTION_SURFACES,
  actionSpecsForSurface,
  buildActionSchemaIndex,
  buildActionSchemaPayload,
  buildActionsHash,
  isMaterializedAgentActionSpec,
} from '../actionRegistry.js';

export type NotebookFile = {
  path: string;
  content: string;
  mode: 'state' | 'draft' | 'config' | 'journal' | 'instructions' | 'skill';
  writePolicy: 'overwrite' | 'create_if_missing' | 'review_before_overwrite';
  // 'workspace' = Mirage-wide shared file at the workspace root (AGENTS/CLAUDE,
  // skills, config/actions, config/skills.json). Sync should hash-gate these and
  // not churn them per project. 'project' (default) = lives under
  // mirage/projects/<projectId>/ and syncs with that project.
  scope?: 'workspace' | 'project';
  description: string;
};

const normalizedProjectDir = (project: Pick<Project, 'id'>) => `mirage/projects/${project.id}`;
const MIRAGE_SKILL_NAMES = [
  'concept-writer',
  'script-writer',
  'art-director',
  'casting-director',
  'sound-director',
  'audio-director',
  'storyboarding',
  'video-director',
] as const;
const NOTEBOOK_VERSION = '2026-05-21.mcp-polish-v1';

type MirageSkillName = typeof MIRAGE_SKILL_NAMES[number];

type NotebookSkillResource = {
  name: MirageSkillName;
  content: string;
  hash: string;
  version: string;
  paths: string[];
};

type NotebookSkillsManifest = {
  kind: 'mirage.skills.index';
  version: string;
  refresh: {
    command: 'mint_cli_token -> returned isolated-cache sync command';
    restartRequired: boolean;
  };
  skills: Array<{
    name: MirageSkillName;
    version: string;
    hash: string;
    paths: string[];
  }>;
};

const ensureNewline = (value: string) => value.endsWith('\n') ? value : `${value}\n`;

const projectUpdatedAt = (project: Project) => project.updatedAt || project.createdAt || 'unknown';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const readResourceText = (relativePath: string): string => {
  const candidates = [
    path.join(process.cwd(), 'server', 'resources', relativePath),
    path.join(moduleDir, '..', '..', 'resources', relativePath),
  ];
  const resourcePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resourcePath) {
    throw new Error(`Mirage notebook resource missing: ${relativePath}`);
  }
  return fs.readFileSync(resourcePath, 'utf8');
};

const renderTemplate = (template: string, values: Record<string, string>): string => {
  return Object.entries(values).reduce((body, [key, value]) => {
    return body.split(`{{${key}}}`).join(value);
  }, template);
};

const buildWorkspaceInstructions = (): string => {
  return renderTemplate(readResourceText('notebook/AGENTS.template.md'), {
    NOTEBOOK_VERSION,
  });
};

const readSkillBody = (skillName: string): string => {
  const skillPathCandidates = [
    path.join(process.cwd(), 'server', 'resources', 'skills', skillName, 'SKILL.md'),
    path.join(moduleDir, '..', '..', 'resources', 'skills', skillName, 'SKILL.md'),
    path.join(process.cwd(), '.agents', 'skills', skillName, 'SKILL.md'),
  ];
  const skillPath = skillPathCandidates.find((candidate) => fs.existsSync(candidate));
  if (!skillPath) {
    throw new Error(`Mirage notebook skill resource missing: ${skillName}`);
  }
  return fs.readFileSync(skillPath, 'utf8');
};

const loadSkillResources = (): NotebookSkillResource[] => MIRAGE_SKILL_NAMES.map((skillName) => {
  const content = readSkillBody(skillName);
  const hash = hashJson(content);
  return {
    name: skillName,
    content,
    hash,
    version: hash.slice(0, 12),
    paths: [
      `.agents/skills/${skillName}/SKILL.md`,
      `.claude/skills/${skillName}/SKILL.md`,
    ],
  };
});

const buildSkillsManifest = (skillResources: NotebookSkillResource[]): NotebookSkillsManifest => {
  const skills = skillResources.map(({ name, hash, version, paths }) => ({
    name,
    version,
    hash,
    paths,
  }));
  return {
    kind: 'mirage.skills.index',
    version: hashJson(skills.map(({ name, hash }) => ({ name, hash }))),
    refresh: {
      command: 'mint_cli_token -> returned isolated-cache sync command',
      restartRequired: true,
    },
    skills,
  };
};

const buildSkillsManifestFile = (manifest: NotebookSkillsManifest): NotebookFile => ({
  path: `config/skills.json`,
  mode: 'config',
  scope: 'workspace',
  writePolicy: 'overwrite',
  description: 'Workspace-shared Mirage skill manifest. If hashes differ from a project notebook.json, sync and restart/open a fresh harness session.',
  content: `${JSON.stringify(manifest, null, 2)}\n`,
});

const buildPromptOverridesReadme = (baseDir: string): NotebookFile => ({
  path: `${baseDir}/config/prompts/README.md`,
  mode: 'config',
  writePolicy: 'overwrite',
  description: 'Explains project prompt override files.',
  content: [
    '# Project Prompt Overrides',
    '',
    'This folder contains optional project-level prompt recipes. It is not a log of every prompt Mirage sends to a model.',
    '',
    'Most projects should leave these files empty. Use them only when a complete repeatable recipe keeps improving one prompt kind across the project. For lighter taste, prefer `config/style-notes.json`. For one shot or one call, prefer the action input, `contextOverrides`, `promptOverride`, or the shot/storyboard/audio draft itself.',
    '',
    'Overrides can affect text, image, storyboard, audio, and video worker calls. They are not limited to paid calls. The code-owned action contract and worker invariants still apply: Codex can shape the recipe, but it cannot remove required output formats, validation rules, or provider constraints.',
    '',
    'Supported override files:',
    '- `concept.md` — concept direction recipe.',
    '- `script.md` — script topology/planning recipe. Use with care after visual work exists.',
    '- `shot_prompts.md` — shot-level visual/motion prompt writing recipe.',
    '- `storyboard.md` — storyboard prompt-writing recipe. Per-shot storyboard prompts live in `storyboards/*.md`.',
    '- `video.md` — video prompt assembly recipe. Per-shot motion prompts live on the shot.',
    '- `character_looks.md` — character/entity reference prompt recipe. Per-character descriptions stay on cast entries.',
    '- `environment_looks.md` — environment/location reference prompt recipe. Per-environment descriptions stay on environment entries.',
    '- `audio_plan.md` — dialogue, narration, sound-note, and lipsync/overlay planning recipe.',
    '',
    'Persist changes with `run_action(apply_project_prompt_override)`. Revert with `run_action(revert_project_prompt_override)`.',
  ].join('\n'),
});

const traceFileName = (call: XRayEntry): string => {
  const timestamp = (call.createdAt || new Date().toISOString())
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const stage = (call.stage || 'generation')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'generation';
  return `${timestamp}-${stage}-${call.id.slice(0, 8)}.md`;
};

const fenced = (value: string, language = ''): string => {
  const body = value || '';
  const ticks = body.match(/`{3,}/g)?.reduce((max, match) => Math.max(max, match.length), 3) || 3;
  const fence = '`'.repeat(ticks + 1);
  return `${fence}${language}\n${body}\n${fence}`;
};

const formatTraceReference = (ref: XRayReference): string => {
  const suffix = [
    ref.url ? `url=${ref.url}` : null,
    ref.preview ? `preview=${JSON.stringify(compactText(ref.preview, 220))}` : null,
  ].filter(Boolean).join(' ');
  return `- ${ref.type}: ${ref.label}${suffix ? ` — ${suffix}` : ''}`;
};

const buildGenerationTraceIndex = (baseDir: string, calls: XRayEntry[]): NotebookFile => ({
  path: `${baseDir}/state/generation-traces/index.md`,
  mode: 'state',
  writePolicy: 'overwrite',
  description: 'Index of recent AI/media generation traces.',
  content: [
    '# Generation Traces',
    '',
    'Recent model calls captured from Mirage server truth. Use these files to inspect what prompt, refs, outputs, model, and cost were actually sent for paid generation/debuggable model calls.',
    '',
    calls.length
      ? calls.map((call) => [
        `- [${call.createdAt} — ${call.stage}](${traceFileName(call)})`,
        `  - model: ${call.model}`,
        `  - outputs: ${call.outputAssetIds.length ? call.outputAssetIds.join(', ') : 'none recorded'}`,
        `  - refs: ${call.referenceInputs.length}`,
        `  - cost: $${Number(call.costEstimate || 0).toFixed(4)}; duration: ${call.durationMs || 0}ms${call.error ? `; error: ${call.error}` : ''}`,
      ].join('\n')).join('\n')
      : 'No generation traces recorded yet.',
    '',
  ].join('\n'),
});

const buildGenerationTraceFile = (baseDir: string, call: XRayEntry): NotebookFile => ({
  path: `${baseDir}/state/generation-traces/${traceFileName(call)}`,
  mode: 'state',
  writePolicy: 'overwrite',
  description: `Generation trace for ${call.stage}.`,
  content: [
    `# ${call.stage}`,
    '',
    `- Call ID: ${call.id}`,
    `- Created: ${call.createdAt}`,
    `- Model: ${call.model}`,
    `- Duration: ${call.durationMs || 0}ms`,
    `- Estimated cost: $${Number(call.costEstimate || 0).toFixed(4)}`,
    `- Output asset IDs: ${call.outputAssetIds.length ? call.outputAssetIds.join(', ') : 'none recorded'}`,
    call.error ? `- Error: ${call.error}` : null,
    '',
    '## References Sent',
    '',
    call.referenceInputs.length ? call.referenceInputs.map(formatTraceReference).join('\n') : 'No reference inputs recorded.',
    '',
    '## Response Summary',
    '',
    call.responseSummary || 'No response summary recorded.',
    '',
    '## Final Prompt Sent',
    '',
    fenced(call.prompt || '', 'text'),
    '',
    '## Context Chain',
    '',
    fenced(JSON.stringify(call.contextChain || {}, null, 2), 'json'),
    '',
  ].filter((part): part is string => part !== null).join('\n'),
});

const buildGenerationTraceFiles = async (project: Project, limit = 50): Promise<NotebookFile[]> => {
  try {
    const calls = (await getCalls(project.id)).slice(0, limit);
    return [
      buildGenerationTraceIndex(normalizedProjectDir(project), calls),
      ...calls.map((call) => buildGenerationTraceFile(normalizedProjectDir(project), call)),
    ];
  } catch (error: any) {
    return [{
      path: `${normalizedProjectDir(project)}/state/generation-traces/index.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Index of recent AI/media generation traces.',
      content: [
        '# Generation Traces',
        '',
        'Generation trace sync is unavailable for this project right now.',
        '',
        `Error: ${error?.message || error}`,
        '',
      ].join('\n'),
    }];
  }
};

const buildSkillFiles = (skillResources: NotebookSkillResource[]): NotebookFile[] => skillResources.flatMap(({ name: skillName, content }) => {
  return [
    {
      path: `.agents/skills/${skillName}/SKILL.md`,
      mode: 'skill',
      scope: 'workspace',
      writePolicy: 'overwrite',
      description: `Workspace-shared Mirage skill (Codex): ${skillName}. Restart/open a fresh session after it changes.`,
      content,
    },
    {
      path: `.claude/skills/${skillName}/SKILL.md`,
      mode: 'skill',
      scope: 'workspace',
      writePolicy: 'overwrite',
      description: `Workspace-shared Mirage skill (Claude Code): ${skillName}. Restart/open a fresh session after it changes.`,
      content,
    },
  ];
});

export const buildNotebookSkillArtifacts = (project: Pick<Project, 'id'>): {
  manifest: NotebookSkillsManifest;
  files: NotebookFile[];
} => {
  const skillResources = loadSkillResources();
  const manifest = buildSkillsManifest(skillResources);
  return {
    manifest,
    files: [
      ...buildSkillFiles(skillResources),
      buildSkillsManifestFile(manifest),
    ],
  };
};

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
- Studio mode: ${usesStoryboardWorkflow(project) ? 'storyboard' : 'keyframe'}
- Models: text ${project.textProvider}, image ${project.imageModel}, storyboard ${project.storyboardProvider}, video ${project.videoModel}
- Counts: ${counts.scenes} scenes, ${counts.shots} shots, ${counts.storyboardPrompts}/${counts.shots} storyboard prompts, ${counts.storyboards}/${counts.shots} boards, ${counts.videos}/${counts.shots} videos

## Project Source

- Project brief: ${project.projectBrief ? md(JSON.stringify(project.projectBrief, null, 2)) : 'None saved.'}
- Source payload: ${project.sourcePayload ? md(JSON.stringify(project.sourcePayload, null, 2)) : 'None saved.'}

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

${locked ? `### ${locked.title || locked.subject || locked.primarySubject || 'Untitled'}

- Direction: ${locked.direction || locked.conceptDirection || 'None'}
- Subject: ${locked.subject || locked.primarySubject || 'None'}
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

## Meaning / Brief

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
- Workflow mode: ${shot.workflowMode || 'auto'}
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

const buildAudioPlan = (project: Project): string => {
  const body = project.scenes.flatMap((scene, sceneIndex) => scene.shots.map((shot, shotIndex) => {
    const plan = shot.audioPlan;
    const dialogue = plan?.dialogue?.length
      ? plan.dialogue
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((line) => {
          const character = project.cast.find((member) => member.id === line.characterId);
          return `| ${line.order} | ${character?.name || line.characterId} | ${line.characterId} | ${line.ttsStatus || 'pending'} | ${line.text.replace(/\|/g, '\\|')} |`;
        })
        .join('\n')
      : '| - | - | - | - | No dialogue lines. |';
    return `## ${shotLabel(sceneIndex, shotIndex)}: ${compactText(shot.direction, 120) || 'Shot'}

- Shot ID: ${shot.id}
- Base hash: ${audioPlanHash(shot)}
- Strategy: ${plan?.dialogueStrategy || 'None'}
- Stale: ${shot.audioPlanStale ? 'yes' : 'no'}
- Duration: ${shot.duration}s

### Dialogue

| Order | Speaker | Character ID | TTS | Text |
|---:|---|---|---|---|
${dialogue}

### Sound Notes

${md(plan?.soundNotes)}
`;
  })).join('\n');

  return `# Audio Plan

Updated: ${projectUpdatedAt(project)}
Project: ${project.title}

This is a state snapshot for agent review. Edit audio-plan.md for changes, then persist with run_action(apply_audio_plan) using the Shot ID and Base hash for each edited shot.

${body || 'No shots saved.'}
`;
};

const buildStoryboardFile = (project: Project, sceneIndex: number, shotIndex: number, shot: Project['scenes'][number]['shots'][number]): NotebookFile => ({
  path: `${normalizedProjectDir(project)}/state/storyboards/${shot.id}.md`,
  mode: 'state',
  writePolicy: 'overwrite',
  description: `Storyboard prompt state snapshot for ${shotLabel(sceneIndex, shotIndex)}.`,
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

const buildStoryboardSceneDraftFile = (project: Project, sceneIndex: number, scene: Project['scenes'][number]): NotebookFile => ({
  path: storyboardSceneDraftPath(project, sceneIndex, scene),
  mode: 'draft',
  writePolicy: 'review_before_overwrite',
  description: `Editable storyboard prompt/cut-plan artifact for ${scene.sectionLabel || `Scene ${sceneIndex + 1}`}. Apply with run_action(apply_storyboard_prompts) using markdown.`,
  content: buildStoryboardSceneMarkdownDraft(project, sceneIndex, scene),
});

const buildHashes = async (project: Project) => {
  const config = await getProjectConfigState(project);
  return {
    generatedAt: projectUpdatedAt(project),
    script: { hash: scriptContentHash(project) },
    style: { hash: styleDirectionHash(project) },
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
    styleNotes: {
      hash: config.styleNotes.hash,
      source: config.styleNotes.source,
    },
  };
};

const buildNotebookMeta = (
  project: Project,
  actions: ReturnType<typeof buildProjectActionList>,
  skillsManifest: NotebookSkillsManifest,
) => ({
  notebookVersion: NOTEBOOK_VERSION,
  generatedAt: new Date().toISOString(),
  actionsHash: buildActionsHash(),
  skillsHash: skillsManifest.version,
  skills: skillsManifest.skills.map(({ name, version, hash, paths }) => ({
    name,
    version,
    hash,
    paths,
  })),
  project: {
    id: project.id,
    title: project.title,
    status: project.status,
    updatedAt: projectUpdatedAt(project),
    webUrl: webStudioUrl(project.id, { step: 'studio' }),
  },
  discovery: {
    openerTool: 'open_project',
    browseTools: ['list_projects'],
  },
  diagnosis: actions.diagnosis,
});

// Action schemas are workspace-global (the registry is the same for every
// project), so they materialize at the workspace root, not under a project dir.
// TODO: When availableTools/blockedTools become hard runtime gating for registry
// actions, add a per-project availability overlay inside the project notebook
// rather than re-stamping the shared index. Today these mirror the full registry.
const buildActionsArtifacts = (): NotebookFile[] => {
  const actionsHash = buildActionsHash();
  const generatedAt = new Date().toISOString();
  const agentActions = actionSpecsForSurface().filter(isMaterializedAgentActionSpec);
  const index = {
    kind: 'mirage.actions.index',
    generatedAt,
    version: actionsHash,
    ...buildActionSchemaIndex(agentActions),
  };
  const files: NotebookFile[] = [{
    path: `config/actions/index.json`,
    mode: 'config',
    scope: 'workspace',
    writePolicy: 'overwrite',
    description: 'Workspace-shared scan-only action index. Read this first, then the surface-specific file you need.',
    content: `${JSON.stringify(index, null, 2)}\n`,
  }];
  for (const surface of ACTION_SURFACES) {
    const actions = actionSpecsForSurface(surface).filter(isMaterializedAgentActionSpec);
    files.push({
      path: `config/actions/${surface}.json`,
      mode: 'config',
      scope: 'workspace',
      writePolicy: 'overwrite',
      description: `Workspace-shared Mirage action specs for the ${surface} surface.`,
      content: `${JSON.stringify({
        kind: 'mirage.actions.surface',
        surface,
        generatedAt,
        version: actionsHash,
        ...buildActionSchemaPayload(actions),
      }, null, 2)}\n`,
    });
  }
  return files;
};

export const buildNotebookMirrorArtifacts = (
  project: Project,
  opts: {
    brief?: boolean;
    audioAnalysis?: boolean;
    concept?: boolean;
    script?: boolean;
    scriptDraft?: boolean;
    storyboardSceneIds?: string[];
    style?: boolean;
    cast?: boolean;
    environments?: boolean;
    shotPrompts?: boolean;
    audioPlan?: boolean;
    storyboardShotIds?: string[];
  } = {},
): NotebookFile[] => {
  const baseDir = normalizedProjectDir(project);
  const files: NotebookFile[] = [];
  if (opts.brief) {
    files.push({
      path: `${baseDir}/state/brief.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Compact production read and next action.',
      content: buildBrief(project, buildProjectActionList(project)),
    });
  }
  if (opts.audioAnalysis) {
    files.push({
      path: `${baseDir}/state/audio-analysis.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Audio meaning/brief, lyrics, and structure state snapshot.',
      content: buildAudioAnalysis(project),
    });
  }
  if (opts.concept) {
    files.push({
      path: `${baseDir}/state/concept.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Locked concept state snapshot.',
      content: buildConcept(project),
    });
  }
  if (opts.script || opts.scriptDraft) {
    files.push({
      path: `${baseDir}/script.md`,
      mode: 'draft',
      writePolicy: 'review_before_overwrite',
      description: 'Editable script artifact. Use apply_text_edits for post-visual wording changes; use apply_script only for pre-visual scripts or topology rebuilds.',
      content: buildScriptMarkdownDraft(project),
    });
  }
  if (opts.style) {
    files.push({
      path: `${baseDir}/state/style.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Style direction and locked style URL state snapshot.',
      content: buildStyle(project),
    });
  }
  if (opts.cast) {
    files.push({
      path: `${baseDir}/state/cast.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Character/entity state snapshot.',
      content: buildCast(project),
    });
  }
  if (opts.environments) {
    files.push({
      path: `${baseDir}/state/environments.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Environment/location state snapshot.',
      content: buildEnvironments(project),
    });
  }
  if (opts.shotPrompts) {
    files.push({
      path: `${baseDir}/state/shot-prompts.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Per-shot prompt state snapshot.',
      content: buildShotPrompts(project),
    });
  }
  if (opts.audioPlan) {
    files.push({
      path: `${baseDir}/audio-plan.md`,
      mode: 'draft',
      writePolicy: 'review_before_overwrite',
      description: 'Editable audio plan artifact. Edit JSON per shot and apply with run_action(apply_audio_plan) using markdown.',
      content: buildAudioPlanMarkdownDraft(project),
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
  if (opts.storyboardSceneIds?.length) {
    const requested = new Set(opts.storyboardSceneIds);
    for (const [sceneIndex, scene] of project.scenes.entries()) {
      if (requested.has(scene.id)) files.push(buildStoryboardSceneDraftFile(project, sceneIndex, scene));
    }
  }
  return files;
};

export const buildNotebookConfigArtifacts = async (
  project: Project,
  opts: {
    preferences?: boolean;
    styleNotes?: boolean;
    promptKinds?: ProjectPromptOverrideKind[];
    hashes?: boolean;
    actions?: boolean;
    skills?: boolean;
  } = {},
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
  if (opts.styleNotes) {
    files.push({
      path: `${baseDir}/config/style-notes.json`,
      mode: 'config',
      writePolicy: 'review_before_overwrite',
      description: 'Editable per-surface project style notes. Apply with apply_project_style_notes.',
      content: `${JSON.stringify(config.styleNotes.styleNotes, null, 2)}\n`,
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
  if (opts.promptKinds?.length) files.push(buildPromptOverridesReadme(baseDir));
  if (opts.hashes) {
    files.push({
      path: `${baseDir}/config/hashes.json`,
      mode: 'config',
      writePolicy: 'overwrite',
      description: 'Base hashes for drift-aware apply tools.',
      content: `${JSON.stringify(await buildHashes(project), null, 2)}\n`,
    });
  }
  if (opts.actions) files.push(...buildActionsArtifacts());
  if (opts.skills) files.push(buildSkillsManifestFile(buildSkillsManifest(loadSkillResources())));
  return files;
};

export const buildProjectNotebook = async (project: Project) => {
  const baseDir = normalizedProjectDir(project);
  const actions = buildProjectActionList(project);
  const config = await getProjectConfigState(project);
  const skillResources = loadSkillResources();
  const skillsManifest = buildSkillsManifest(skillResources);
  const generationTraceFiles = await buildGenerationTraceFiles(project);
  const files: NotebookFile[] = [
    {
      path: 'AGENTS.md',
      mode: 'instructions',
      scope: 'workspace',
      writePolicy: 'overwrite',
      description: 'Workspace-shared Mirage operating instructions (Mirage-wide, not project-specific).',
      content: buildWorkspaceInstructions(),
    },
    {
      path: 'CLAUDE.md',
      mode: 'instructions',
      scope: 'workspace',
      writePolicy: 'overwrite',
      description: 'Workspace-shared Mirage operating instructions for Claude Code (Mirage-wide, not project-specific).',
      content: buildWorkspaceInstructions(),
    },
    ...buildSkillFiles(skillResources),
    {
      path: `${baseDir}/state/brief.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Compact production read and next action.',
      content: buildBrief(project, actions),
    },
    {
      path: `${baseDir}/state/audio-analysis.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Audio meaning/brief, lyrics, and structure state snapshot.',
      content: buildAudioAnalysis(project),
    },
    {
      path: `${baseDir}/state/concept.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Locked concept state snapshot.',
      content: buildConcept(project),
    },
    {
      path: `${baseDir}/script.md`,
      mode: 'draft',
      writePolicy: 'review_before_overwrite',
      description: 'Editable script artifact. Use apply_text_edits for post-visual wording changes; use apply_script only for pre-visual scripts or topology rebuilds.',
      content: buildScriptMarkdownDraft(project),
    },
    ...project.scenes.map((scene, sceneIndex) => buildStoryboardSceneDraftFile(project, sceneIndex, scene)),
    {
      path: `${baseDir}/state/style.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Style direction and locked style URL state snapshot.',
      content: buildStyle(project),
    },
    {
      path: `${baseDir}/state/cast.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Character/entity state snapshot.',
      content: buildCast(project),
    },
    {
      path: `${baseDir}/state/environments.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Environment/location state snapshot.',
      content: buildEnvironments(project),
    },
    {
      path: `${baseDir}/state/shot-prompts.md`,
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Per-shot prompt state snapshot.',
      content: buildShotPrompts(project),
    },
    ...generationTraceFiles,
    {
      path: `${baseDir}/audio-plan.md`,
      mode: 'draft',
      writePolicy: 'review_before_overwrite',
      description: 'Editable audio plan artifact. Edit JSON per shot and apply with run_action(apply_audio_plan) using markdown.',
      content: buildAudioPlanMarkdownDraft(project),
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
      path: `${baseDir}/config/style-notes.json`,
      mode: 'config',
      writePolicy: 'review_before_overwrite',
      description: 'Editable per-surface project style notes. Apply with apply_project_style_notes.',
      content: `${JSON.stringify(config.styleNotes.styleNotes, null, 2)}\n`,
    },
    ...buildActionsArtifacts(),
    buildSkillsManifestFile(skillsManifest),
    buildPromptOverridesReadme(baseDir),
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
      mode: 'state',
      writePolicy: 'overwrite',
      description: 'Machine-readable notebook metadata, including notebookVersion and skillsHash for stale-workspace checks.',
      content: `${JSON.stringify(buildNotebookMeta(project, actions, skillsManifest), null, 2)}\n`,
    },
    {
      path: `${baseDir}/journal.md`,
      mode: 'journal',
      writePolicy: 'create_if_missing',
      description: 'Local operator journal. Append notes here; do not overwrite unless intentionally resetting the notebook.',
      content: `# Mirage Journal

Project: ${project.title}
Project ID: ${project.id}

## ${projectUpdatedAt(project)} - Notebook Created

Opened project and wrote the initial local notebook.
`,
    },
  ];

  return {
    kind: 'mirage.project.notebook',
    notebookVersion: NOTEBOOK_VERSION,
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      webUrl: webStudioUrl(project.id, { step: 'studio' }),
    },
    baseDir,
    files,
    writeInstructions: 'Last fallback path only. Prefer mint_cli_token + the returned shell-specific sync command so file bodies do not travel through chat; retry it once on error. On Windows/Codex, install the Mirage CLI once outside the live-token flow, then use the returned installed-CLI command if npx is blocked. Use get_project_notebook_manifest + read_project_notebook_file path-by-path only when the harness has no shell capability. If using this full payload manually, write each file to its path relative to the current workspace. Each file carries a scope. Workspace-shared files (scope=workspace: AGENTS.md, CLAUDE.md, .agents/skills, .claude/skills, config/actions, config/skills.json) are Mirage-wide at the workspace root — only overwrite them when their hash changed; do not rewrite them per project. Project files (scope=project, default) live under mirage/projects/<projectId>/ (state/, script.md, audio-plan.md, storyboards/, config/style-notes.json, config/preferences.json, config/prompts/, hashes.json, notebook.json, journal.md). Create journal.md only if missing. Before overwriting editable artifacts or a project config/ file, check whether it has unsaved local edits; script.md, audio-plan.md, and storyboards/*.md are editable working copies and project config files are editable overrides. Apply post-visual wording edits with run_action(apply_text_edits); use run_action(apply_script) only for pre-visual scripts or topology rebuilds. Apply scene storyboard edits with run_action(apply_storyboard_prompts) using markdown. After the skills hash changes or the first notebook write, restart/open a fresh Codex or Claude session in the workspace so skills reload. Append concise decisions to the project journal.md.',
  };
};
