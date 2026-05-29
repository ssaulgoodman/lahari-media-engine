import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  compactText,
  md,
  audioPlanHash,
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
import { buildScriptMarkdownDraft } from './scriptMarkdown.js';
import { buildAudioPlanMarkdownDraft } from './audioPlanMarkdown.js';
import { buildStoryboardSceneMarkdownDraft, storyboardSceneDraftPath } from './storyboardMarkdown.js';
import { getPipelinePreset, getWorkflowRecipe } from '../../presets.js';
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
  mode: 'mirror' | 'draft' | 'config' | 'journal' | 'instructions' | 'skill';
  writePolicy: 'overwrite' | 'create_if_missing' | 'review_before_overwrite';
  description: string;
};

const normalizedProjectDir = (project: Project) => `mirage/projects/${project.id}`;
const MIRAGE_SKILL_NAMES = [
  'mirage-director',
  'storyboard-prompt-craft',
  'script-doctor',
  'continuity-auditor',
  'style-ref-critic',
  'render-triage',
  'audio-director',
] as const;
const NOTEBOOK_VERSION = '2026-05-21.mcp-polish-v1';

const ensureNewline = (value: string) => value.endsWith('\n') ? value : `${value}\n`;

const projectUpdatedAt = (project: Project) => project.updatedAt || project.createdAt || 'unknown';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const buildWorkspaceInstructions = (project: Project): string => {
  const preset = getPipelinePreset(project.presetKey);
  const workflow = getWorkflowRecipe(project.workflowKey || preset.workflowKey);
  const seedKind = project.seedKind || workflow.primarySeed;
  return `# Mirage Workspace

This folder is the local notebook for Mirage project "${project.title}" (${project.id}).

Notebook version: ${NOTEBOOK_VERSION}

Project mode:
- Seed kind: ${seedKind}
- Workflow: ${workflow.key} — ${workflow.summary}
- Preset: ${preset.key} — ${preset.label}

These three fields are the operating contract for the agent. Seed kind says what the artist started with. Workflow says which planner/source spine applies. Preset says taste/model/default prompt rules. Available and blocked tools in the project packet are the source of truth for what can run next. Do not assume songs, lyrics, religious subjects, fixed locations, or audio analysis unless this project's seed/workflow/preset/tool list says so.

Supabase is canonical. This is an artist notebook, not the engine source checkout. Use Mirage MCP tools for project reads, applies, generation, locks, and issue capture. If those tools are unavailable, stop and reconnect Mirage instead of substituting shell commands.

If the MCP server returns a newer notebookVersion than the one shown here or in mirage/projects/${project.id}/notebook.json, refresh before continuing. Preferred path: call mint_cli_token, then run the returned command for the active shell in this workspace. Use commands.posix on macOS/Linux. Use commands.powershell on Windows; it wraps npx through cmd /c to avoid PowerShell npx.ps1 policy blocks. If shell/npx/npm is still blocked, call get_project_notebook_manifest and then read_project_notebook_file path-by-path. Last fallback: call write_project_notebook and write the returned files manually only when the payload is small enough.

Files under mirrors/ are read-only desk copies written from Mirage state. Do not hand-edit mirrors; refresh them with CLI sync, manifest + per-file MCP fallback, or write_project_notebook after attach or after major mutations.

Files under drafts/ are editable working copies. For script changes, edit drafts/script.md surgically, preserve IDs unless intentionally replacing an entity, then apply with apply_script_markdown. For audio work, inspect mirrors/audio-plan.md and use apply_audio_plan for structured JSON updates. For storyboard prompt work, edit drafts/storyboards/<scene>.md scene-by-scene, preserving shot IDs and base hashes, then apply with apply_storyboard_scene_markdown. If apply reports drift_detected, refresh the notebook and reconcile before retrying.

Files under config/ are the editable project layer. Edit config/prompts/*.md or config/preferences.json when you want project-specific runtime behavior, then persist through the matching apply_project_* MCP tool.
Use config/style-notes.json for project-learned visual, storyboard, motion, script, dialogue, and audio style notes; persist with apply_project_style_notes.
Action schemas are materialized under config/actions/. Read config/actions/index.json first, then only the surface file you need (for example config/actions/looks.json). Use MCP list_actions only when these files are missing, stale, or you need live server truth.

For Looks work, prefer list_actions / describe_action / run_action. Use generate_candidates for character/environment candidate batches, list_candidates or list_results to recover asset IDs/URLs, and lock_reference to set the canonical reference.

For local image/audio files, keep bytes outside MCP: POST multipart to /api/agent/uploads with the Mirage bearer token, projectId, purpose, entityId, and file. For images, use the returned assetId as sourceAssetId for use-as-is or guideAssetId for upload-as-guide. For audio, use purpose=audio_source; upload only attaches the source file, then you decide whether to run analyze_audio_transcribe/analyze_audio_structure. Legacy base64 upload tools are fallback only when the HTTPS upload path is blocked.

Project-local Mirage skills live under .agents/skills/ for Codex and .claude/skills/ for Claude Code. After this notebook is first written, restart or open a fresh harness session in this folder so native skill discovery can pick them up.

Use journal.md for your own concise operator notes: what changed, why, and what to inspect next.

Default ritual:
1. resolve_project when the artist names a project; use list_queue/search_catalog only for catalog/queue-backed music-video work
2. attach_director_session once you have a projectId
3. mint_cli_token, then npx @ssaulgoodman420/mirage-cli sync; for local reference images use /api/agent/uploads with the Mirage bearer token, then run_action(lock_reference) or run_action(generate_candidates with guideAssetId); if blocked, use get_project_notebook_manifest + read_project_notebook_file
4. read relevant mirrors and project mode before proposing changes
5. apply approved changes through typed MCP tools
6. refresh affected notebook files
`;
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

const buildSkillFiles = (): NotebookFile[] => MIRAGE_SKILL_NAMES.flatMap((skillName) => {
  const content = readSkillBody(skillName);
  return [
    {
      path: `.agents/skills/${skillName}/SKILL.md`,
      mode: 'skill',
      writePolicy: 'overwrite',
      description: `Codex project-local Mirage skill: ${skillName}. Restart/open a fresh session after first write.`,
      content,
    },
    {
      path: `.claude/skills/${skillName}/SKILL.md`,
      mode: 'skill',
      writePolicy: 'overwrite',
      description: `Claude Code project-local Mirage skill: ${skillName}. Restart/open a fresh session after first write.`,
      content,
    },
  ];
});

const buildBrief = (project: Project, actions: ReturnType<typeof buildProjectActionList>): string => {
  const counts = statusCounts(project);
  const diagnosis = actions.diagnosis;
  const preset = getPipelinePreset(project.presetKey);
  const workflow = getWorkflowRecipe(project.workflowKey || preset.workflowKey);
  const seedKind = project.seedKind || workflow.primarySeed;
  return `# ${project.title}

Updated: ${projectUpdatedAt(project)}
Project ID: ${project.id}
Web: ${webStudioUrl(project.id, { step: 'studio' })}

## Current Read

${diagnosis.productionRead}

- Status: ${project.status}
- Seed kind: ${seedKind}
- Workflow: ${workflow.key} (${workflow.label}) — ${workflow.summary}
- Preset: ${preset.key} (${preset.label})
- Studio mode: ${usesStoryboardWorkflow(project) ? 'storyboard' : 'keyframe'}
- Models: text ${project.textProvider}, image ${project.imageModel}, storyboard ${project.storyboardProvider}, video ${project.videoModel}
- Counts: ${counts.scenes} scenes, ${counts.shots} shots, ${counts.storyboardPrompts}/${counts.shots} storyboard prompts, ${counts.storyboards}/${counts.shots} boards, ${counts.videos}/${counts.shots} videos

## Source Contract

- Accepted seeds: ${workflow.acceptedSeeds.join(', ')}
- Source rules: ${preset.source.rules}
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

This is a mirror for agent review. Persist changes with apply_audio_plan using the Shot ID and Base hash for each edited shot.

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

const buildStoryboardSceneDraftFile = (project: Project, sceneIndex: number, scene: Project['scenes'][number]): NotebookFile => ({
  path: storyboardSceneDraftPath(project, sceneIndex, scene),
  mode: 'draft',
  writePolicy: 'review_before_overwrite',
  description: `Editable storyboard prompt/cut-plan draft for ${scene.sectionLabel || `Scene ${sceneIndex + 1}`}. Apply with apply_storyboard_scene_markdown.`,
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

const buildNotebookMeta = (project: Project, actions: ReturnType<typeof buildProjectActionList>) => ({
  notebookVersion: NOTEBOOK_VERSION,
  generatedAt: new Date().toISOString(),
  actionsHash: buildActionsHash(),
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

const buildActionsArtifacts = (project: Project): NotebookFile[] => {
  const baseDir = normalizedProjectDir(project);
  const actionsHash = buildActionsHash();
  const generatedAt = new Date().toISOString();
  // TODO: When availableTools/blockedTools become hard runtime gating for
  // registry actions, filter these materialized specs by project before
  // writing. Today they intentionally mirror the full action registry.
  const agentActions = actionSpecsForSurface().filter(isMaterializedAgentActionSpec);
  const index = {
    kind: 'mirage.actions.index',
    projectId: project.id,
    generatedAt,
    version: actionsHash,
    ...buildActionSchemaIndex(agentActions),
  };
  const files: NotebookFile[] = [{
    path: `${baseDir}/config/actions/index.json`,
    mode: 'config',
    writePolicy: 'overwrite',
    description: 'Scan-only action index. Read this first, then the surface-specific file you need.',
    content: `${JSON.stringify(index, null, 2)}\n`,
  }];
  for (const surface of ACTION_SURFACES) {
    const actions = actionSpecsForSurface(surface).filter(isMaterializedAgentActionSpec);
    files.push({
      path: `${baseDir}/config/actions/${surface}.json`,
      mode: 'config',
      writePolicy: 'overwrite',
      description: `Full Mirage action specs for the ${surface} surface.`,
      content: `${JSON.stringify({
        kind: 'mirage.actions.surface',
        projectId: project.id,
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
	  if (opts.audioPlan) {
	    files.push({
	      path: `${baseDir}/mirrors/audio-plan.md`,
	      mode: 'mirror',
	      writePolicy: 'overwrite',
	      description: 'Per-shot dialogue/TTS audio plan mirror.',
	      content: buildAudioPlan(project),
	    });
	    files.push({
	      path: `${baseDir}/drafts/audio-plan.md`,
	      mode: 'draft',
	      writePolicy: 'review_before_overwrite',
	      description: 'Editable audio plan draft. Edit JSON per shot and apply with apply_audio_plan_markdown.',
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
  opts: { preferences?: boolean; styleNotes?: boolean; promptKinds?: ProjectPromptOverrideKind[]; hashes?: boolean; actions?: boolean } = {},
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
  if (opts.hashes) {
    files.push({
      path: `${baseDir}/config/hashes.json`,
      mode: 'config',
      writePolicy: 'overwrite',
      description: 'Base hashes for drift-aware apply tools.',
      content: `${JSON.stringify(await buildHashes(project), null, 2)}\n`,
    });
  }
  if (opts.actions) files.push(...buildActionsArtifacts(project));
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
      description: 'Workspace-local Mirage notebook instructions.',
      content: buildWorkspaceInstructions(project),
    },
    {
      path: 'CLAUDE.md',
      mode: 'instructions',
      writePolicy: 'overwrite',
      description: 'Claude Code workspace-local Mirage notebook instructions.',
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
    ...project.scenes.map((scene, sceneIndex) => buildStoryboardSceneDraftFile(project, sceneIndex, scene)),
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
	    {
	      path: `${baseDir}/mirrors/audio-plan.md`,
	      mode: 'mirror',
	      writePolicy: 'overwrite',
	      description: 'Per-shot dialogue/TTS audio plan mirror.',
	      content: buildAudioPlan(project),
	    },
	    {
	      path: `${baseDir}/drafts/audio-plan.md`,
	      mode: 'draft',
	      writePolicy: 'review_before_overwrite',
	      description: 'Editable audio plan draft. Edit JSON per shot and apply with apply_audio_plan_markdown.',
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
    ...buildActionsArtifacts(project),
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
    writeInstructions: 'Last fallback path only. Prefer mint_cli_token + the returned shell-specific npx @ssaulgoodman420/mirage-cli sync command so file bodies do not travel through chat. If shell/npx/npm is blocked, prefer get_project_notebook_manifest + read_project_notebook_file path-by-path. If using this full payload manually, write each file to path relative to the current workspace. Overwrite AGENTS.md, CLAUDE.md, .agents/skills, .claude/skills, mirrors/, and hashes. Create journal.md only if missing. Before overwriting drafts/ or config/, check whether the file has unsaved local edits; drafts are editable working copies and config files are editable project overrides. Apply script draft edits with apply_script_markdown. Apply scene storyboard drafts with apply_storyboard_scene_markdown. After the first notebook write, restart/open a fresh Codex or Claude session in this folder so project-local skills are discovered. Append concise decisions to journal.md.',
  };
};
