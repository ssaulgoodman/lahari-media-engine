#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { prepareCodexReadEnv } from '../server/services/codexReadEnv.js';

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
  return textResult(studio.buildProjectPacket(project));
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
