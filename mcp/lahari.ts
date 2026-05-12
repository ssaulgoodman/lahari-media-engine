#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { prepareCodexReadEnv, prepareCodexWriteEnv } from '../server/services/codexReadEnv.js';

const loadStudio = async () => {
  const [{ getFullProject }, studio] = await Promise.all([
    import('../server/routes/projects.js'),
    import('../server/services/codexStudio.js'),
  ]);

  return { getFullProject, ...studio };
};

const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

const server = new McpServer({
  name: 'lahari-codex-studio',
  version: '0.1.0',
});

server.registerTool('list_projects', {
  title: 'List Lahari projects',
  description: 'Read-only. Lists recent Lahari projects with status, song classification, and model settings.',
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().describe('Maximum number of recent projects to return. Default: 20.'),
  },
}, async ({ limit }) => {
  const studio = await loadStudio();
  return textResult(await studio.listProjects(limit?.toString()));
});

server.registerTool('get_project_packet', {
  title: 'Get project packet',
  description: 'Read-only. Returns a compact Codex-oriented packet for one Lahari project.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
  },
}, async ({ projectId }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.buildProjectPacket(project));
});

server.registerTool('get_project_actions', {
  title: 'Get project action list',
  description: 'Read-only. Returns a compact menu of legal next actions for a Lahari project, including CLI commands, MCP tool names, prerequisites, and cost estimates where available.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
  },
}, async ({ projectId }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(studio.buildProjectActionList(project));
});

server.registerTool('hydrate_project_workbench', {
  title: 'Hydrate project workbench',
  description: 'Read-only with local file output. Pulls canonical Supabase state and writes a local Codex workbench under .lahari/projects/<projectId>.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    outputDir: z.string().optional().describe('Optional output directory. Defaults to .lahari/projects/<projectId>.'),
  },
}, async ({ projectId, outputDir }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.hydrateProjectWorkbench(project, outputDir));
});

server.registerTool('get_shot_packet', {
  title: 'Get shot packet',
  description: 'Read-only. Returns one shot with its scene, prompts, assets, and previous/next context.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotId: z.string().min(1).describe('Shot ID within the project.'),
  },
}, async ({ projectId, shotId }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(studio.buildShotPacket(project, shotId));
});

server.registerTool('write_project_artifacts', {
  title: 'Write project review artifacts',
  description: 'Read-only with local file output. Writes a director report Markdown file and/or HTML contact sheet under .lahari/codex by default. Does not mutate Lahari DB or assets.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    reportPath: z.string().optional().describe('Optional output path for the Markdown director report.'),
    contactSheetPath: z.string().optional().describe('Optional output path for the HTML contact sheet.'),
    includeReport: z.boolean().default(true).describe('Whether to write the Markdown director report.'),
    includeContactSheet: z.boolean().default(true).describe('Whether to write the HTML contact sheet.'),
  },
}, async ({ projectId, reportPath, contactSheetPath, includeReport, includeContactSheet }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  const artifacts: { type: string; path: string }[] = [];

  if (includeReport) {
    const outPath = reportPath || studio.defaultArtifactPath(project, 'director-report.md');
    artifacts.push({ type: 'director-report', path: studio.writeArtifact(outPath, studio.buildProjectReport(project)) });
  }

  if (includeContactSheet) {
    const outPath = contactSheetPath || studio.defaultArtifactPath(project, 'contact-sheet.html');
    artifacts.push({ type: 'contact-sheet', path: studio.writeArtifact(outPath, studio.buildProjectContactSheet(project)) });
  }

  return textResult({
    kind: 'lahari.artifacts',
    projectId,
    artifacts,
    note: 'Local artifacts only. No Lahari database rows or assets were mutated.',
  });
});

server.registerTool('write_project_sheets', {
  title: 'Write focused project sheets',
  description: 'Read-only with local file output. Writes focused HTML evidence sheets under .lahari/codex: overview, style, references, storyboard, and/or renders.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    sheetTypes: z.array(z.enum(['overview', 'style', 'references', 'storyboard', 'renders'])).optional().describe('Sheet types to write. Default: style, references, storyboard, renders.'),
    outputDir: z.string().optional().describe('Optional output directory. Defaults to .lahari/codex.'),
  },
}, async ({ projectId, sheetTypes, outputDir }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  const types = sheetTypes?.length ? sheetTypes : ['style', 'references', 'storyboard', 'renders'];
  const artifacts: { type: string; path: string }[] = [];

  for (const rawType of types) {
    const sheetType = studio.normalizeProjectSheetType(rawType);
    const outPath = outputDir
      ? `${outputDir.replace(/\/$/, '')}/${project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'lahari-project'}-${sheetType}-sheet.html`
      : studio.defaultProjectSheetPath(project, sheetType);
    artifacts.push({
      type: `${sheetType}-sheet`,
      path: studio.writeArtifact(outPath, await studio.buildProjectSheet(project, sheetType)),
    });
  }

  return textResult({
    kind: 'lahari.sheets',
    projectId,
    artifacts,
    note: 'Local HTML artifacts only. No Lahari database rows or assets were mutated.',
  });
});

server.registerTool('attach_director_session', {
  title: 'Attach director session',
  description: 'Local-file only. Creates or refreshes a Codex director session for a Lahari project under .lahari/sessions.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    note: z.string().optional().describe('Optional operator note to append to the journal.'),
  },
}, async ({ projectId, note }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(studio.attachDirectorSession(project, note));
});

server.registerTool('get_director_session', {
  title: 'Get director session',
  description: 'Read-only/local-file. Returns the current derived checkpoint plus saved session state and journal when present.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
  },
}, async ({ projectId }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(studio.getDirectorSession(project));
});

server.registerTool('add_director_note', {
  title: 'Add director journal note',
  description: 'Local-file only. Appends an operator/Codex note to the project director journal and refreshes local state.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    note: z.string().min(1).describe('Note to append to the director journal.'),
  },
}, async ({ projectId, note }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(studio.addDirectorSessionNote(project, note));
});

server.registerTool('preview_rewrite_shot_prompts', {
  title: 'Preview shot prompt rewrite',
  description: 'Paid AI call, preview-only. Rewrites shot visual/motion prompts into local preview artifacts without mutating the Lahari database.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    note: z.string().optional().describe('Optional director note to steer the rewrite preview.'),
  },
}, async ({ projectId, note }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.previewRewriteShotPrompts(project, note));
});

server.registerTool('preview_rewrite_script', {
  title: 'Preview script rewrite',
  description: 'Paid AI call, preview-only. Generates or refines the full script into local preview artifacts without mutating the Lahari database.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    note: z.string().optional().describe('Optional director note to steer the script rewrite.'),
  },
}, async ({ projectId, note }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.previewRewriteScript(project, note));
});

server.registerTool('preview_rewrite_storyboard_prompt', {
  title: 'Preview storyboard prompt rewrite',
  description: 'Paid AI call, preview-only. Rewrites one shot storyboard prompt and cut plan into local preview artifacts without mutating the Lahari database.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotId: z.string().min(1).describe('Shot ID within the project.'),
    note: z.string().optional().describe('Optional director note to steer the storyboard prompt rewrite.'),
  },
}, async ({ projectId, shotId, note }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.previewRewriteStoryboardPrompt(project, shotId, note));
});

server.registerTool('plan_generate_storyboard', {
  title: 'Plan storyboard generation',
  description: 'Read-only. Reports prerequisites, estimated cost, state changes, and approval wording before generating a storyboard board.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotId: z.string().min(1).describe('Shot ID within the project.'),
  },
}, async ({ projectId, shotId }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(studio.planGenerateStoryboard(project, shotId));
});

server.registerTool('plan_generate_video', {
  title: 'Plan video generation',
  description: 'Read-only. Reports prerequisites, estimated cost, state changes, and approval wording before generating a shot video.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotId: z.string().min(1).describe('Shot ID within the project.'),
  },
}, async ({ projectId, shotId }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(studio.planGenerateVideo(project, shotId));
});

server.registerTool('plan_apply_shot_prompt_preview', {
  title: 'Plan applying shot prompt preview',
  description: 'Read-only. Validates a saved shot prompt preview and reports the exact mutation blast radius before apply.',
  inputSchema: {
    previewJsonPath: z.string().min(1).describe('Path to a .lahari preview JSON artifact.'),
  },
}, async ({ previewJsonPath }) => {
  const studio = await loadStudio();
  const preview = JSON.parse(fs.readFileSync(previewJsonPath, 'utf8'));
  const project = await studio.getFullProject(preview.project.id);
  return textResult(await studio.getRewriteShotPromptsApplyPlan(previewJsonPath, project));
});

server.registerTool('plan_apply_storyboard_prompt_preview', {
  title: 'Plan applying storyboard prompt preview',
  description: 'Read-only. Validates a saved storyboard prompt preview and reports exact mutation blast radius before apply.',
  inputSchema: {
    previewJsonPath: z.string().min(1).describe('Path to a .lahari preview JSON artifact.'),
  },
}, async ({ previewJsonPath }) => {
  const studio = await loadStudio();
  const preview = JSON.parse(fs.readFileSync(previewJsonPath, 'utf8'));
  const project = await studio.getFullProject(preview.project.id);
  return textResult(await studio.getRewriteStoryboardPromptApplyPlan(previewJsonPath, project));
});

server.registerTool('plan_apply_script_preview', {
  title: 'Plan applying script preview',
  description: 'Read-only. Validates a saved script preview and reports exact mutation blast radius before apply.',
  inputSchema: {
    previewJsonPath: z.string().min(1).describe('Path to a .lahari preview JSON artifact.'),
  },
}, async ({ previewJsonPath }) => {
  const studio = await loadStudio();
  const preview = JSON.parse(fs.readFileSync(previewJsonPath, 'utf8'));
  const project = await studio.getFullProject(preview.project.id);
  return textResult(await studio.getRewriteScriptApplyPlan(previewJsonPath, project));
});

server.registerTool('apply_shot_prompt_preview', {
  title: 'Apply shot prompt preview',
  description: 'Mutating. Applies a saved shot prompt preview to Supabase after validating project/shot drift. Updates shot prompts, continuity, stale flags, project prompt cache, and local director journal.',
  inputSchema: {
    previewJsonPath: z.string().min(1).describe('Path to a .lahari preview JSON artifact.'),
  },
}, async ({ previewJsonPath }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for apply_shot_prompt_preview.');

  const studio = await loadStudio();
  const preview = JSON.parse(fs.readFileSync(previewJsonPath, 'utf8'));
  const project = await studio.getFullProject(preview.project.id);
  return textResult(await studio.applyRewriteShotPromptsPreview(previewJsonPath, project));
});

server.registerTool('apply_storyboard_prompt_preview', {
  title: 'Apply storyboard prompt preview',
  description: 'Mutating. Applies a saved storyboard prompt preview to Supabase after validating drift. Updates storyboard prompt/cut plan and marks storyboard/video stale for review.',
  inputSchema: {
    previewJsonPath: z.string().min(1).describe('Path to a .lahari preview JSON artifact.'),
  },
}, async ({ previewJsonPath }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for apply_storyboard_prompt_preview.');

  const studio = await loadStudio();
  const preview = JSON.parse(fs.readFileSync(previewJsonPath, 'utf8'));
  const project = await studio.getFullProject(preview.project.id);
  return textResult(await studio.applyRewriteStoryboardPromptPreview(previewJsonPath, project));
});

server.registerTool('apply_script_preview', {
  title: 'Apply script preview',
  description: 'Mutating. Applies a saved script preview to Supabase after validating drift and refusing downstream visual work. Replaces cast, environments, scenes, and shots.',
  inputSchema: {
    previewJsonPath: z.string().min(1).describe('Path to a .lahari preview JSON artifact.'),
  },
}, async ({ previewJsonPath }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for apply_script_preview.');

  const studio = await loadStudio();
  const preview = JSON.parse(fs.readFileSync(previewJsonPath, 'utf8'));
  const project = await studio.getFullProject(preview.project.id);
  return textResult(await studio.applyRewriteScriptPreview(previewJsonPath, project));
});

server.registerTool('apply_generate_storyboard', {
  title: 'Generate storyboard board',
  description: 'Mutating and paid. Generates a new storyboard board for one shot after validating prerequisites. Updates the active storyboard pointer, unlocks the board for review, and marks video stale.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotId: z.string().min(1).describe('Shot ID within the project.'),
    artistNote: z.string().optional().describe('Optional refinement/render note to pass to storyboard generation.'),
  },
}, async ({ projectId, shotId, artistNote }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for apply_generate_storyboard.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.applyGenerateStoryboard(project, shotId, artistNote));
});

server.registerTool('apply_generate_video', {
  title: 'Generate shot video',
  description: 'Mutating and paid. Generates a new video for one shot after validating prerequisites. Updates the active video pointer and attempts last-frame extraction.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotId: z.string().min(1).describe('Shot ID within the project.'),
    promptOverride: z.string().optional().describe('Optional prompt override for keyframe-mode video generation.'),
  },
}, async ({ projectId, shotId, promptOverride }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for apply_generate_video.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.applyGenerateVideo(project, shotId, promptOverride));
});

async function main() {
  const env = await prepareCodexReadEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('No valid Supabase key available for Lahari MCP.');

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Lahari Codex Studio MCP server running on stdio');
}

main().catch((error) => {
  console.error('Lahari MCP server error:', error);
  process.exit(1);
});
