#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { prepareCodexReadEnv, prepareCodexWriteEnv } from '../server/services/codexReadEnv.js';
import { captureLahariIssue, recordMcpAudit } from '../server/services/lahariAudit.js';

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

const registerAuditedTool = (
  name: string,
  config: Parameters<typeof server.registerTool>[1],
  handler: (args: any) => Promise<any>
) => {
  server.registerTool(name, config, async (args: any) => {
    const startedAt = new Date().toISOString();
    const start = Date.now();
    recordMcpAudit({ phase: 'start', tool: name, args, startedAt });
    try {
      const result = await handler(args);
      recordMcpAudit({ phase: 'finish', tool: name, args, result, durationMs: Date.now() - start, startedAt });
      return result;
    } catch (error) {
      recordMcpAudit({ phase: 'finish', tool: name, args, error, durationMs: Date.now() - start, startedAt });
      throw error;
    }
  });
};

registerAuditedTool('list_projects', {
  title: 'List Lahari projects',
  description: 'Read-only. Lists recent Lahari projects with status, song classification, and model settings.',
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().describe('Maximum number of recent projects to return. Default: 20.'),
  },
}, async ({ limit }) => {
  const studio = await loadStudio();
  return textResult(await studio.listProjects(limit?.toString()));
});

registerAuditedTool('get_project_packet', {
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

registerAuditedTool('get_project_actions', {
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

registerAuditedTool('hydrate_project_workbench', {
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

registerAuditedTool('write_project_notebook', {
  title: 'Write project notebook',
  description: 'Read-only. Returns deterministic local notebook files for this project. The agent should write each returned file path relative to the current workspace.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
  },
}, async ({ projectId }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.buildProjectNotebook(project));
});

registerAuditedTool('review_storyboard_prompts', {
  title: 'Review storyboard prompts',
  description: 'Read-only. Reviews all storyboard prompts/cut plans for missing, stale, overlong, or blocked states and returns rewrite/generation commands.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
  },
}, async ({ projectId }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(studio.buildStoryboardPromptReview(project));
});

registerAuditedTool('get_storyboard_status', {
  title: 'Get storyboard status',
  description: 'Read-only. Returns a compact shot-by-shot storyboard readiness view with prompt, board, video, lock state, and next native action.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
  },
}, async ({ projectId }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(studio.buildStoryboardStatus(project));
});

registerAuditedTool('write_storyboard_prompt', {
  title: 'Write storyboard prompt',
  description: 'Deprecated. Prefer apply_storyboard_prompt: write the prompt directly using the storyboard-prompt-craft skill, then apply. This mutating paid tool wraps a backend LLM call and bypasses the harness-native pattern.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotId: z.string().min(1).describe('Shot ID within the project.'),
    artistNote: z.string().optional().describe('Optional steering note for the planner.'),
    variant: z.enum(['adaptive_numbered_storyboard', 'four_panel_clean', 'six_panel_music_video', 'filmstrip_minimal_cuts']).optional().describe('Storyboard prompt variant. Defaults to adaptive_numbered_storyboard.'),
    artistReferenceImagePath: z.string().optional().describe('Optional storage/file path for an extra visual reference.'),
  },
}, async ({ projectId, shotId, artistNote, variant, artistReferenceImagePath }) => {
  console.error('[deprecated] write_storyboard_prompt — use apply_storyboard_prompt instead.');
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for write_storyboard_prompt.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.writeStoryboardPromptForShot(project, shotId, { artistNote, variant, artistReferenceImagePath }));
});

registerAuditedTool('bulk_write_storyboard_prompts', {
  title: 'Bulk write storyboard prompts',
  description: 'Deprecated. Prefer apply_storyboard_prompts_bulk: write prompts directly using the storyboard-prompt-craft skill, then apply. This mutating paid tool wraps backend LLM calls and bypasses the harness-native pattern.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotIds: z.array(z.string().min(1)).optional().describe('Optional explicit shot subset. Defaults to all eligible shots.'),
    force: z.boolean().optional().describe('Rewrite selected unlocked shots even when a prompt already exists. Requires explicit approval.'),
    artistNote: z.string().optional().describe('Optional steering note for every selected shot.'),
    variant: z.enum(['adaptive_numbered_storyboard', 'four_panel_clean', 'six_panel_music_video', 'filmstrip_minimal_cuts']).optional().describe('Storyboard prompt variant. Defaults to adaptive_numbered_storyboard.'),
    artistReferenceImagePath: z.string().optional().describe('Optional storage/file path for an extra visual reference.'),
  },
}, async ({ projectId, shotIds, force, artistNote, variant, artistReferenceImagePath }) => {
  console.error('[deprecated] bulk_write_storyboard_prompts — use apply_storyboard_prompts_bulk instead.');
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for bulk_write_storyboard_prompts.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.bulkWriteStoryboardPrompts(project, { shotIds, force, artistNote, variant, artistReferenceImagePath }));
});

registerAuditedTool('get_shot_packet', {
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

registerAuditedTool('write_project_artifacts', {
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

registerAuditedTool('write_project_sheets', {
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

registerAuditedTool('attach_director_session', {
  title: 'Attach director session',
  description: 'Local-file only. Opens a Lahari project as the current director session, refreshes .lahari/sessions, hydrates the .lahari/projects workbench, and returns a web studio link.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    note: z.string().optional().describe('Optional operator note to append to the journal.'),
  },
}, async ({ projectId, note }) => {
  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.attachDirectorSession(project, note));
});

registerAuditedTool('get_director_session', {
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

registerAuditedTool('add_director_note', {
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

registerAuditedTool('preview_rewrite_shot_prompts', {
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

registerAuditedTool('preview_rewrite_script', {
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

registerAuditedTool('preview_rewrite_storyboard_prompt', {
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

registerAuditedTool('plan_generate_storyboard', {
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

registerAuditedTool('plan_generate_video', {
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

registerAuditedTool('plan_apply_shot_prompt_preview', {
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

registerAuditedTool('plan_apply_storyboard_prompt_preview', {
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

registerAuditedTool('plan_apply_script_preview', {
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

registerAuditedTool('apply_shot_prompt_preview', {
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

registerAuditedTool('apply_storyboard_prompt_preview', {
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

registerAuditedTool('apply_script_preview', {
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

registerAuditedTool('rollback_shot_prompt_preview', {
  title: 'Rollback shot prompt preview',
  description: 'Mutating. Restores shot prompt fields from a saved preview before-snapshot after validating current state still matches the preview after-state.',
  inputSchema: {
    previewJsonPath: z.string().min(1).describe('Path to a .lahari preview JSON artifact.'),
  },
}, async ({ previewJsonPath }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for rollback_shot_prompt_preview.');

  const studio = await loadStudio();
  const preview = JSON.parse(fs.readFileSync(previewJsonPath, 'utf8'));
  const project = await studio.getFullProject(preview.project.id);
  return textResult(await studio.rollbackRewriteShotPromptsPreview(previewJsonPath, project));
});

registerAuditedTool('rollback_storyboard_prompt_preview', {
  title: 'Rollback storyboard prompt preview',
  description: 'Mutating. Restores storyboard prompt fields from a saved preview before-snapshot after validating current state still matches the preview after-state.',
  inputSchema: {
    previewJsonPath: z.string().min(1).describe('Path to a .lahari preview JSON artifact.'),
  },
}, async ({ previewJsonPath }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for rollback_storyboard_prompt_preview.');

  const studio = await loadStudio();
  const preview = JSON.parse(fs.readFileSync(previewJsonPath, 'utf8'));
  const project = await studio.getFullProject(preview.project.id);
  return textResult(await studio.rollbackRewriteStoryboardPromptPreview(previewJsonPath, project));
});

registerAuditedTool('rollback_script_preview', {
  title: 'Rollback script preview',
  description: 'Mutating. Restores script/cast/environment rows from a saved preview rollback snapshot after validating current script still matches the preview after-state.',
  inputSchema: {
    previewJsonPath: z.string().min(1).describe('Path to a .lahari preview JSON artifact.'),
  },
}, async ({ previewJsonPath }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for rollback_script_preview.');

  const studio = await loadStudio();
  const preview = JSON.parse(fs.readFileSync(previewJsonPath, 'utf8'));
  const project = await studio.getFullProject(preview.project.id);
  return textResult(await studio.rollbackRewriteScriptPreview(previewJsonPath, project));
});

registerAuditedTool('apply_generate_storyboard', {
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

registerAuditedTool('generate_storyboard', {
  title: 'Generate storyboard board',
  description: 'Alias for apply_generate_storyboard. Mutating and paid. Generates a new storyboard board for one shot after validating prerequisites.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotId: z.string().min(1).describe('Shot ID within the project.'),
    artistNote: z.string().optional().describe('Optional refinement/render note to pass to storyboard generation.'),
  },
}, async ({ projectId, shotId, artistNote }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for generate_storyboard.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.applyGenerateStoryboard(project, shotId, artistNote));
});

registerAuditedTool('bulk_generate_storyboards', {
  title: 'Bulk generate storyboard boards',
  description: 'Mutating and paid. Generates boards for selected unlocked shots with saved prompts. Default only targets missing/stale/error boards; force requires explicit approval.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotIds: z.array(z.string().min(1)).optional().describe('Optional explicit shot subset. Defaults to all eligible shots.'),
    force: z.boolean().optional().describe('Regenerate selected unlocked shots even when a board already exists. Requires explicit approval.'),
    artistNote: z.string().optional().describe('Optional render note to pass to each storyboard generation.'),
  },
}, async ({ projectId, shotIds, force, artistNote }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for bulk_generate_storyboards.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.bulkGenerateStoryboards(project, { shotIds, force, artistNote }));
});

registerAuditedTool('refine_storyboard_image', {
  title: 'Refine storyboard image',
  description: 'Mutating and paid. Uses storyboard edit-image mode to refine the active board or a specified previous version from artist feedback.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotId: z.string().min(1).describe('Shot ID within the project.'),
    feedback: z.string().min(1).describe('Concrete visual edit feedback from the artist/director.'),
    previousVersionId: z.string().optional().describe('Optional storyboard version to edit. Defaults to active version.'),
    artistReferenceImagePath: z.string().optional().describe('Optional storage/file path for an extra visual reference.'),
  },
}, async ({ projectId, shotId, feedback, previousVersionId, artistReferenceImagePath }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for refine_storyboard_image.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.refineStoryboardImage(project, shotId, { feedback, previousVersionId, artistReferenceImagePath }));
});

registerAuditedTool('lock_storyboard', {
  title: 'Lock storyboard board',
  description: 'Mutating. Locks the active storyboard board, or a specific storyboard version, after visual review in the web studio.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotId: z.string().min(1).describe('Shot ID within the project.'),
    versionId: z.string().optional().describe('Optional storyboard version ID. Defaults to the active storyboard version.'),
  },
}, async ({ projectId, shotId, versionId }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for lock_storyboard.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.lockStoryboardBoard(project, shotId, versionId));
});

registerAuditedTool('unlock_storyboard', {
  title: 'Unlock storyboard board',
  description: 'Mutating. Unlocks the storyboard board for one shot so it can be revised or regenerated.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotId: z.string().min(1).describe('Shot ID within the project.'),
  },
}, async ({ projectId, shotId }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for unlock_storyboard.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.unlockStoryboardBoard(project, shotId));
});

registerAuditedTool('apply_project_preferences', {
  title: 'Apply project preferences',
  description: 'Mutating. Persists Codex-written project model preferences after validating the config base hash. No LLM call.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    preferences: z.object({
      textProvider: z.string().optional(),
      imageModel: z.string().optional(),
      storyboardProvider: z.string().optional(),
      videoModel: z.string().optional(),
    }).describe('Project preference object. Unknown or invalid provider keys are rejected/fallback-warned by the engine.'),
    baseHash: z.string().optional().describe('Hash from .lahari/projects/<projectId>/config/hashes.json. Refuses apply if stale.'),
  },
}, async ({ projectId, preferences, baseHash }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for apply_project_preferences.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.applyProjectPreferencesConfig(project, preferences, baseHash));
});

registerAuditedTool('apply_shot_prompts', {
  title: 'Apply shot prompts',
  description: 'Mutating. Persists Codex-written visual/motion/direction/continuity updates for one or more shots. No LLM call; validates length and optional baseHash drift.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shots: z.array(z.object({
      shotId: z.string().min(1),
      visualPrompt: z.string().optional(),
      motionPrompt: z.string().optional(),
      direction: z.string().optional(),
      continuityFrom: z.enum(['cut', 'prev_shot']).optional(),
      baseHash: z.string().optional(),
    })).min(1).describe('Array of shot prompt updates. Use get_shot_packet baseHashes.shotPrompts when available.'),
    force: z.boolean().optional().describe('Bypass baseHash drift checks only after explicit approval.'),
  },
}, async ({ projectId, shots, force }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for apply_shot_prompts.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.applyShotPrompts(project, shots, { force }));
});

registerAuditedTool('apply_storyboard_prompt', {
  title: 'Apply storyboard prompt',
  description: 'Mutating. Persists a Codex-written storyboard_prompt and storyboard_cut_plan for one shot. No LLM call; validates drift and marks existing board/video stale.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotId: z.string().min(1).describe('Shot ID within the project.'),
    storyboardPrompt: z.string().min(1).describe('Codex-written image-render storyboard prompt.'),
    storyboardCutPlan: z.string().optional().describe('Codex-written cut plan. Can be empty.'),
    baseHash: z.string().optional().describe('Hash from get_shot_packet baseHashes.storyboardPrompt.'),
    force: z.boolean().optional().describe('Bypass baseHash drift checks only after explicit approval.'),
  },
}, async ({ projectId, shotId, storyboardPrompt, storyboardCutPlan, baseHash, force }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for apply_storyboard_prompt.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.applyStoryboardPrompt(project, shotId, storyboardPrompt, storyboardCutPlan || '', { baseHash, force }));
});

registerAuditedTool('apply_storyboard_prompts_bulk', {
  title: 'Apply storyboard prompts bulk',
  description: 'Mutating. Persists Codex-written storyboard prompts/cut plans for multiple shots. No LLM call; locked shots are skipped and invalid/drifted rows are rejected.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shots: z.array(z.object({
      shotId: z.string().min(1),
      storyboardPrompt: z.string().min(1),
      storyboardCutPlan: z.string().optional(),
      baseHash: z.string().optional(),
    })).min(1),
    force: z.boolean().optional().describe('Bypass baseHash drift checks only after explicit approval.'),
  },
}, async ({ projectId, shots, force }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for apply_storyboard_prompts_bulk.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.applyStoryboardPromptsBulk(project, {
    shots: shots.map((shot: any) => ({ ...shot, storyboardCutPlan: shot.storyboardCutPlan || '' })),
    force,
  }));
});

registerAuditedTool('apply_concept', {
  title: 'Apply concept',
  description: 'Mutating. Persists a Codex-written locked concept object. No LLM call; marks existing shot prompts stale when script rows exist.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    concept: z.object({
      title: z.string().min(1),
      direction: z.string().min(1),
      description: z.string().min(1),
      deity: z.string().optional(),
      mood: z.string().optional(),
    }),
    baseHash: z.string().optional().describe('Hash of current locked concept when known.'),
    force: z.boolean().optional().describe('Bypass baseHash drift checks only after explicit approval.'),
  },
}, async ({ projectId, concept, baseHash, force }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for apply_concept.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.applyConcept(project, concept, { baseHash, force }));
});

registerAuditedTool('apply_video_prompt', {
  title: 'Apply video prompt',
  description: 'Mutating. Persists a Codex-written keyframe-mode motion_prompt for one shot. Refuses storyboard-mode projects; use apply_storyboard_prompt there.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotId: z.string().min(1).describe('Shot ID within the project.'),
    motionPrompt: z.string().min(1).describe('Codex-written keyframe-mode motion prompt.'),
    baseHash: z.string().optional().describe('Hash from get_shot_packet baseHashes.videoPrompt.'),
    force: z.boolean().optional().describe('Bypass baseHash drift checks only after explicit approval.'),
  },
}, async ({ projectId, shotId, motionPrompt, baseHash, force }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for apply_video_prompt.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.applyVideoPrompt(project, shotId, motionPrompt, { baseHash, force }));
});

registerAuditedTool('apply_script', {
  title: 'Apply script',
  description: 'Mutating and high blast radius. Atomically replaces cast, environments, scenes, and shots with Codex-written structured script content. Refuses downstream visual work unless force is explicitly approved.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    script: z.object({
      cast: z.array(z.object({ id: z.string().optional(), name: z.string().min(1), description: z.string().optional() })),
      environments: z.array(z.object({ id: z.string().optional(), name: z.string().min(1), description: z.string().optional() })),
      scenes: z.array(z.object({
        id: z.string().optional(),
        sectionLabel: z.string().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        lyrics: z.string().optional(),
        narrativeDescription: z.string().optional(),
        shots: z.array(z.object({
          id: z.string().optional(),
          direction: z.string().min(1),
          duration: z.number(),
          castIds: z.array(z.string()).optional(),
          environmentId: z.string().nullable().optional(),
          continuityFrom: z.enum(['cut', 'prev_shot']).optional(),
        })).min(1),
      })).min(1),
    }),
    baseFingerprint: z.string().optional().describe('Hash/fingerprint of current script from the latest read when known.'),
    force: z.boolean().optional().describe('Bypass drift/downstream visual work checks only after explicit approval.'),
  },
}, async ({ projectId, script, baseFingerprint, force }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for apply_script.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.applyScript(project, script, { baseFingerprint, force }));
});

registerAuditedTool('apply_project_prompt_override', {
  title: 'Apply project prompt override',
  description: 'Mutating. Persists a Codex-written project-level storyboard/video recipe after validating the config base hash. No preview tool by design; Codex is the preview.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    kind: z.enum(['storyboard', 'video']).describe('Which project prompt recipe to apply.'),
    body: z.string().min(1).describe('Codex-written override body. This is a reusable project recipe, not per-shot generated text.'),
    baseHash: z.string().optional().describe('Hash from .lahari/projects/<projectId>/config/hashes.json. Refuses apply if stale.'),
  },
}, async ({ projectId, kind, body, baseHash }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for apply_project_prompt_override.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.applyProjectPromptOverrideConfig(project, kind, body, baseHash));
});

registerAuditedTool('revert_project_prompt_override', {
  title: 'Revert project prompt override',
  description: 'Mutating. Reverts the active project prompt recipe to the previous inactive row, or to global default if no previous override exists.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    kind: z.enum(['storyboard', 'video']).describe('Which project prompt recipe to revert.'),
    baseHash: z.string().optional().describe('Hash from .lahari/projects/<projectId>/config/hashes.json. Refuses apply if stale.'),
  },
}, async ({ projectId, kind, baseHash }) => {
  const env = await prepareCodexWriteEnv();
  if (env.warning) console.error(`[lahari:mcp] ${env.warning}`);
  if (env.keyMode === 'missing') throw new Error('A valid SUPABASE_SERVICE_KEY is required for revert_project_prompt_override.');

  const studio = await loadStudio();
  const project = await studio.getFullProject(projectId);
  return textResult(await studio.revertProjectPromptOverrideConfig(project, kind, baseHash));
});

registerAuditedTool('apply_generate_video', {
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

registerAuditedTool('lahari_capture_issue', {
  title: 'Capture Lahari director issue',
  description: 'Local-file only. Call this when tool behavior, project state, or director-session flow seems wrong. Writes a compact issue file for the engine session to debug later.',
  inputSchema: {
    projectId: z.string().optional().describe('Optional Lahari project ID if the issue is project-specific.'),
    severity: z.enum(['low', 'mid', 'high']).describe('How disruptive the issue is.'),
    summary: z.string().min(1).describe('What went wrong, in one clear sentence or short paragraph.'),
    suggestedFix: z.string().optional().describe('Optional suspected fix or next debugging lead.'),
    recentToolCalls: z.unknown().optional().describe('Optional recent tool-call context. If omitted, the tool includes the latest audit entries.'),
  },
}, async ({ projectId, severity, summary, suggestedFix, recentToolCalls }) => {
  return textResult(captureLahariIssue({ projectId, severity, summary, suggestedFix, recentToolCalls }));
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
