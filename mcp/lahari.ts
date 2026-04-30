#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { getFullProject } from '../server/routes/projects.js';
import {
  buildProjectContactSheet,
  buildProjectPacket,
  buildProjectReport,
  buildShotPacket,
  defaultArtifactPath,
  listProjects,
  writeArtifact,
} from '../server/services/codexStudio.js';

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
  return textResult(await listProjects(limit?.toString()));
});

server.registerTool('get_project_packet', {
  title: 'Get project packet',
  description: 'Read-only. Returns a compact Codex-oriented packet for one Lahari project.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
  },
}, async ({ projectId }) => {
  const project = await getFullProject(projectId);
  return textResult(buildProjectPacket(project));
});

server.registerTool('get_shot_packet', {
  title: 'Get shot packet',
  description: 'Read-only. Returns one shot with its scene, prompts, assets, and previous/next context.',
  inputSchema: {
    projectId: z.string().min(1).describe('Lahari project ID.'),
    shotId: z.string().min(1).describe('Shot ID within the project.'),
  },
}, async ({ projectId, shotId }) => {
  const project = await getFullProject(projectId);
  return textResult(buildShotPacket(project, shotId));
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
  const project = await getFullProject(projectId);
  const artifacts: { type: string; path: string }[] = [];

  if (includeReport) {
    const outPath = reportPath || defaultArtifactPath(project, 'director-report.md');
    artifacts.push({ type: 'director-report', path: writeArtifact(outPath, buildProjectReport(project)) });
  }

  if (includeContactSheet) {
    const outPath = contactSheetPath || defaultArtifactPath(project, 'contact-sheet.html');
    artifacts.push({ type: 'contact-sheet', path: writeArtifact(outPath, buildProjectContactSheet(project)) });
  }

  return textResult({
    kind: 'lahari.artifacts',
    projectId,
    artifacts,
    note: 'Local artifacts only. No Lahari database rows or assets were mutated.',
  });
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Lahari Codex Studio MCP server running on stdio');
}

main().catch((error) => {
  console.error('Lahari MCP server error:', error);
  process.exit(1);
});
