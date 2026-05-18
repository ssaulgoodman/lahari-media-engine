import crypto from 'node:crypto';
import { Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import { selectColumns, selectOne } from '../database.js';
import { getFullProject } from './projects.js';
import { listDirectorEvents } from '../services/directorEvents.js';
import { captureLahariIssue, recordMcpAudit } from '../services/lahariAudit.js';
import { createCliToken, verifyMcpBearerToken } from '../services/mcpTokens.js';
import { RateLimitError, assertRateLimit, envInt } from '../services/rateLimit.js';
import { finishAgentOperation, startAgentOperation } from '../services/agentOperations.js';
import * as studio from '../services/codexStudio.js';
import { runWithRequestContext } from '../requestContext.js';
import { structuredError } from '../services/structuredErrors.js';

const router = Router();
const HOSTED_MCP_VERSION = '0.1.6';
const promptOverrideKindSchema = z.enum(['concept', 'script', 'shot_prompts', 'storyboard', 'video', 'character_looks', 'environment_looks']);
const HOSTED_MCP_INSTRUCTIONS = `You are operating Lahari as an assistant director.

Supabase is canonical project truth. Use MCP tools for reads, applies, generation, locks, and issue capture. Do not invent direct database writes.

Artist flow: when the artist names a song/project, call resolve_project first. Use list_queue or search_catalog when they ask what is available or what is in progress. After resolving a project, attach_director_session, then prefer mint_cli_token plus the returned shell-specific sync command to materialize or refresh the notebook without moving file bodies through chat. Use commands.posix on macOS/Linux; use commands.powershell on Windows, which intentionally wraps npx through cmd /c to avoid PowerShell npx.ps1 policy blocks. If shell/npx/npm is unavailable or blocked, use get_project_notebook_manifest then read_project_notebook_file path-by-path and write each returned file. If even that is unavailable, fall back to write_project_notebook for small notebooks. Treat mirrors/ files as read-only desk copies. Edit drafts/script.md for surgical script changes, then persist with apply_script_markdown. Write storyboard prompts scene-by-scene in drafts/storyboards/*.md, then persist with apply_storyboard_scene_markdown. Edit config/ files only when preparing project-level overrides, then persist with apply_project_preferences or apply_project_prompt_override. Append concise decisions to journal.md. After first notebook write, restart or open a fresh harness session in that folder so native skills are discovered.

Text generation is harness-native: write concepts, style directions, scripts, shot prompts, storyboard prompts, and video prompts yourself, then persist with apply-only tools. Media generation stays tool-based and paid; ask before generation. Use per-call modelOverride for experiments instead of changing project defaults.

Use production language with artists. Say open/attach, not hydrate. The web app is the visual studio; use returned web links for visual review. If a tool behaves unexpectedly or the web studio disagrees with MCP state, call lahari_capture_issue before guessing.`;

type HostedAuth = {
  userId: string;
  tokenId: string;
  label: string;
};

const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

const bearerToken = (header?: string | null) => {
  const match = (header || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const idString = z.string().min(1).max(160);
const projectId = idString.describe('Lahari project ID.');
const shotId = idString.describe('Shot ID within the project.');
const shortText = z.string().max(2000);
const mediumText = z.string().max(8000);
const promptText = z.string().min(1).max(30000);
const scriptMarkdownText = z.string().min(1).max(120000);
const storyboardSceneMarkdownText = z.string().min(1).max(80000);
const optionalPromptText = z.string().max(30000).optional();
const notebookFilePath = z.string().min(1).max(800).describe('Notebook file path returned by get_project_notebook_manifest.');
const maxArray = <T extends z.ZodTypeAny>(schema: T, max: number) => z.array(schema).max(max);
const modelOverrideSchema = z.object({
  storyboardProvider: idString.optional(),
  videoModel: idString.optional(),
}).optional();
const workflowModeSchema = z.enum(['auto', 'storyboard', 'keyframe']);

const MCP_LIMITS = {
  requestPerMinute: envInt('LAHARI_MCP_REQUESTS_PER_MINUTE', 120),
  mutatingPerHour: envInt('LAHARI_MCP_MUTATIONS_PER_HOUR', 180),
  paidPerDay: envInt('LAHARI_MCP_PAID_CALLS_PER_DAY', 30),
  issuesPerHour: envInt('LAHARI_MCP_ISSUES_PER_HOUR', 20),
};

const PAID_TOOLS = new Set([
  'apply_generate_storyboard',
  'generate_storyboard',
  'bulk_generate_storyboards',
  'refine_storyboard_image',
  'apply_generate_video',
]);

const structuredToolError = (error: unknown) => {
  if (error instanceof RateLimitError) {
    return {
      code: 'rate_limited',
      message: error.message,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  const structured = structuredError(error, 'mirage_mcp_error');
  if (structured.code !== 'mirage_mcp_error' || structured.provider || structured.setupUrl || structured.retryAfterSeconds) {
    return structured;
  }
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed === 'object' && parsed.code && parsed.message) return parsed;
    } catch {
      // Plain Error message; wrap below.
    }
    return {
      code: error.message.toLowerCase().includes('auth') ? 'auth_expired' : 'lahari_mcp_error',
      message: error.message,
    };
  }
  return {
    code: 'lahari_mcp_error',
    message: String(error || 'Unknown Lahari MCP error'),
  };
};

const assertProjectAccess = async (projectId: string, userId: string) => {
  if (!projectId) throw new Error('projectId is required');
  if (!userId) throw new Error('Auth required');
  const row = await selectOne('projects', { id: projectId });
  if (!row) throw new Error(`Project not found: ${projectId}`);
  if (row.user_id !== userId) throw new Error('Access denied');
  return row;
};

const fullProjectForUser = async (projectId: string, userId: string) => {
  await assertProjectAccess(projectId, userId);
  const project = await getFullProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  return project;
};

const remoteSessionState = async (projectId: string, userId: string, opts: { sinceSeq?: number | null; note?: string | null } = {}) => {
  const project = await fullProjectForUser(projectId, userId);
  const [packet, actions, status, events] = await Promise.all([
    studio.buildProjectPacket(project),
    studio.buildProjectActionList(project),
    studio.buildStoryboardStatus(project),
    listDirectorEvents(projectId, { afterSeq: opts.sinceSeq ?? null, limit: 50 }),
  ]);
  return {
    kind: 'lahari.director.remote_session',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      webUrl: studio.webStudioUrl(project.id, { step: 'studio' }),
    },
    note: opts.note || null,
    packet,
    actions,
    storyboardStatus: status,
    directorEvents: {
      newEvents: events.length,
      lastSeq: events.length ? events[events.length - 1].seq ?? opts.sinceSeq ?? null : opts.sinceSeq ?? null,
      recentEvents: events.slice(-10).map((event) => ({
        id: event.id,
        seq: event.seq ?? null,
        createdAt: event.created_at,
        source: event.source,
        eventType: event.event_type,
        entityType: event.entity_type,
        entityId: event.entity_id,
        summary: event.summary,
      })),
    },
    sourceOfTruth: 'Supabase is canonical. Remote MCP clients should keep local files as desk copies only.',
  };
};

const createHostedMcpServer = (auth: HostedAuth) => {
  const server = new McpServer({
    name: 'lahari',
    version: HOSTED_MCP_VERSION,
  }, {
    instructions: HOSTED_MCP_INSTRUCTIONS,
  });

  const toolAnnotations = (name: string): ToolAnnotations => {
    const readOnlyPrefixes = [
      'list_',
      'search_',
      'get_',
      'read_',
      'plan_',
      'preview_',
      'review_',
      'write_project_notebook',
      'write_project_artifacts',
      'write_project_sheets',
      'hydrate_project_workbench',
    ];
    if (readOnlyPrefixes.some((prefix) => name.startsWith(prefix)) || name === 'attach_director_session' || name === 'resolve_project') {
      return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    }
    if (name === 'add_director_note' || name === 'lahari_capture_issue') {
      return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
    }
    if (name === 'apply_script' || name === 'apply_script_markdown' || name.startsWith('rollback_') || name.startsWith('revert_')) {
      return { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
    }
    if (name.startsWith('apply_') || name.startsWith('generate_') || name.startsWith('bulk_generate_') || name.startsWith('refine_') || name.startsWith('lock_') || name.startsWith('unlock_')) {
      return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
    }
    return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  };

  const registerTool = (
    name: string,
    config: Parameters<typeof server.registerTool>[1],
    handler: (args: any) => Promise<unknown>,
  ) => {
    server.registerTool(name, {
      ...config,
      annotations: {
        ...toolAnnotations(name),
        ...config.annotations,
      },
    }, async (args: any) => {
      const startedAt = new Date().toISOString();
      const start = Date.now();
      const annotations = toolAnnotations(name);
      recordMcpAudit({ source: 'mcp-remote', phase: 'start', tool: name, args, startedAt });
      let operationId: string | null = null;
      try {
        if (PAID_TOOLS.has(name)) {
          assertRateLimit({
            key: `mcp:paid:${auth.tokenId}`,
            limit: MCP_LIMITS.paidPerDay,
            windowMs: 24 * 60 * 60 * 1000,
            label: 'Paid Lahari MCP tool',
          });
        } else if (name === 'lahari_capture_issue') {
          assertRateLimit({
            key: `mcp:issue:${auth.tokenId}`,
            limit: MCP_LIMITS.issuesPerHour,
            windowMs: 60 * 60 * 1000,
            label: 'Lahari issue capture',
          });
        } else if (!annotations.readOnlyHint) {
          assertRateLimit({
            key: `mcp:mutating:${auth.tokenId}`,
            limit: MCP_LIMITS.mutatingPerHour,
            windowMs: 60 * 60 * 1000,
            label: 'Mutating Lahari MCP tool',
          });
        }
        if (!annotations.readOnlyHint) {
          operationId = await startAgentOperation({
            projectId: args?.projectId,
            userId: auth.userId,
            source: 'mcp-remote',
            tool: name,
            args,
          });
        }
        const result = await handler(args || {});
        await finishAgentOperation(operationId, 'success', { result });
        recordMcpAudit({ source: 'mcp-remote', phase: 'finish', tool: name, args, result, durationMs: Date.now() - start, startedAt });
        return textResult(result);
      } catch (error) {
        await finishAgentOperation(operationId, 'error', { error });
        recordMcpAudit({ source: 'mcp-remote', phase: 'finish', tool: name, args, error, durationMs: Date.now() - start, startedAt });
        throw new Error(JSON.stringify(structuredToolError(error), null, 2));
      }
    });
  };

  const unsupported = (tool: string, reason: string) => async () => {
    throw new Error(JSON.stringify({
      code: 'remote_facade_gap',
      message: `${tool} is not available in the hosted Lahari MCP server yet.`,
      details: { tool, reason },
    }, null, 2));
  };

  registerTool('list_projects', {
    title: 'List Lahari projects',
    description: 'Read-only. Lists recent Lahari projects for the authenticated artist.',
    inputSchema: { limit: z.number().int().min(1).max(100).optional() },
  }, async ({ limit }) => {
    const rows = await selectColumns(
      'projects',
      'id,title,status,song_type,is_narrative,is_meditative,image_model,storyboard_provider,video_model,text_provider,created_at,updated_at',
      { user_id: auth.userId },
      { orderBy: 'updated_at', ascending: false, limit: Math.min(Number(limit || 20) || 20, 100) },
    );
    return {
      kind: 'lahari.project.list',
      generatedAt: new Date().toISOString(),
      projects: rows.map((row: any) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        songType: row.song_type || null,
        isNarrative: row.is_narrative ?? null,
        isMeditative: row.is_meditative ?? null,
        imageModel: row.image_model,
        storyboardProvider: row.storyboard_provider,
        videoModel: row.video_model,
        textProvider: row.text_provider,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  });

  registerTool('list_queue', {
    title: 'List Lahari music queue',
    description: 'Read-only. Lists music-video queue items for the authenticated artist, including duration, queue status, linked/current project, and next action.',
    inputSchema: {
      status: z.string().optional().describe('Optional queue status filter, or "all".'),
      query: z.string().min(1).max(120).optional().describe('Optional title/deity/language/note search.'),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ status, query, limit }) => studio.listQueueForDirector(auth.userId, { status, query, limit }));

  registerTool('search_catalog', {
    title: 'Search Lahari catalog',
    description: 'Read-only. Searches the artist-owned project list plus the music queue by title/transliteration/deity and returns normalized matches.',
    inputSchema: {
      query: z.string().min(1).max(120),
      limit: z.number().int().min(1).max(50).optional(),
    },
  }, async ({ query, limit }) => studio.searchCatalogForDirector(auth.userId, query, { limit }));

  registerTool('resolve_project', {
    title: 'Resolve Lahari project or queue item',
    description: 'Read-only. Friendly opener for artist phrases like "open Gakaarayaachyam"; resolves project IDs, project titles, and queue/song matches into the next legal action.',
    inputSchema: {
      query: z.string().min(1).max(120).describe('Project ID, project title, song title, transliteration, deity, or queue label.'),
    },
  }, async ({ query }) => studio.resolveProjectForDirector(auth.userId, query));

  registerTool('get_project_packet', {
    title: 'Get project packet',
    description: 'Read-only. Returns a compact Codex-oriented packet for one Lahari project.',
    inputSchema: { projectId },
  }, async ({ projectId }) => studio.buildProjectPacket(await fullProjectForUser(projectId, auth.userId)));

  registerTool('get_project_actions', {
    title: 'Get project action list',
    description: 'Read-only. Returns legal next actions for a Lahari project.',
    inputSchema: { projectId },
  }, async ({ projectId }) => studio.buildProjectActionList(await fullProjectForUser(projectId, auth.userId)));

  registerTool('hydrate_project_workbench', {
    title: 'Hydrate project workbench',
    description: 'Deprecated remote gap. Use write_project_notebook for remote artist workspaces.',
    inputSchema: { projectId, outputDir: idString.optional() },
  }, unsupported('hydrate_project_workbench', 'Use write_project_notebook; it returns deterministic file payloads for the agent to write via harness file tools.'));

  registerTool('write_project_notebook', {
    title: 'Write project notebook',
    description: 'Read-only final fallback. Returns deterministic local notebook file payloads in one response. Prefer CLI sync; if npx is blocked, use get_project_notebook_manifest + read_project_notebook_file path-by-path.',
    inputSchema: { projectId },
  }, async ({ projectId }) => studio.buildProjectNotebook(await fullProjectForUser(projectId, auth.userId)));

  registerTool('get_project_notebook_manifest', {
    title: 'Get project notebook manifest',
    description: 'Read-only. Returns notebook file metadata without file bodies. Use with read_project_notebook_file when CLI sync is blocked and write_project_notebook would be too large.',
    inputSchema: { projectId },
  }, async ({ projectId }) => {
    const notebook = await studio.buildProjectNotebook(await fullProjectForUser(projectId, auth.userId));
    return {
      kind: 'lahari.notebook.manifest',
      notebookVersion: notebook.notebookVersion,
      generatedAt: notebook.generatedAt,
      project: notebook.project,
      baseDir: notebook.baseDir,
      files: notebook.files.map((file) => ({
        path: file.path,
        mode: file.mode,
        writePolicy: file.writePolicy,
        description: file.description,
        hash: sha256(file.content),
        size: Buffer.byteLength(file.content, 'utf8'),
      })),
      next: 'Call read_project_notebook_file for each path you need, then write the returned content to that path relative to the current workspace.',
    };
  });

  registerTool('read_project_notebook_file', {
    title: 'Read project notebook file',
    description: 'Read-only. Returns one deterministic notebook file body by path. Use after get_project_notebook_manifest to avoid giant MCP payloads.',
    inputSchema: {
      projectId,
      path: notebookFilePath,
    },
  }, async ({ projectId, path: requestedPath }) => {
    const notebook = await studio.buildProjectNotebook(await fullProjectForUser(projectId, auth.userId));
    const file = notebook.files.find((candidate) => candidate.path === requestedPath);
    if (!file) {
      throw new Error(JSON.stringify({
        code: 'notebook_file_not_found',
        message: `Notebook file not found: ${requestedPath}`,
        details: { requestedPath },
      }));
    }
    return {
      kind: 'lahari.notebook.file',
      notebookVersion: notebook.notebookVersion,
      generatedAt: notebook.generatedAt,
      project: notebook.project,
      baseDir: notebook.baseDir,
      file: {
        path: file.path,
        mode: file.mode,
        writePolicy: file.writePolicy,
        description: file.description,
        hash: sha256(file.content),
        size: Buffer.byteLength(file.content, 'utf8'),
        content: file.content,
      },
    };
  });

  registerTool('mint_cli_token', {
    title: 'Mint short-lived CLI sync token',
    description: 'Mutating security surface. Issues a short-lived project-scoped token for npx @ssaulgoodman420/lahari-cli sync so notebook file bodies do not travel through chat.',
    inputSchema: {
      projectId,
      ttlMinutes: z.number().int().min(5).max(180).optional(),
    },
  }, async ({ projectId, ttlMinutes }) => createCliToken(auth.userId, { projectId, ttlMinutes }));

  registerTool('review_storyboard_prompts', {
    title: 'Review storyboard prompts',
    description: 'Remote gap. Use get_storyboard_status plus get_project_packet for now.',
    inputSchema: { projectId },
  }, unsupported('review_storyboard_prompts', 'No hosted storyboard-review endpoint exists yet.'));

  registerTool('get_storyboard_status', {
    title: 'Get storyboard status',
    description: 'Read-only. Returns shot-by-shot storyboard readiness.',
    inputSchema: { projectId },
  }, async ({ projectId }) => studio.buildStoryboardStatus(await fullProjectForUser(projectId, auth.userId)));

  registerTool('get_shot_packet', {
    title: 'Get shot packet',
    description: 'Read-only. Returns one shot with scene, prompts, assets, and context.',
    inputSchema: { projectId, shotId },
  }, async ({ projectId, shotId }) => studio.buildShotPacket(await fullProjectForUser(projectId, auth.userId), shotId));

  registerTool('write_project_artifacts', {
    title: 'Write project review artifacts',
    description: 'Remote gap. Hosted MCP cannot write local reports/contact sheets.',
    inputSchema: {
      projectId,
      reportPath: idString.optional(),
      contactSheetPath: idString.optional(),
      includeReport: z.boolean().default(true),
      includeContactSheet: z.boolean().default(true),
    },
  }, unsupported('write_project_artifacts', 'Requires local artifact rendering in the fallback package.'));

  registerTool('write_project_sheets', {
    title: 'Write focused project sheets',
    description: 'Remote gap. Hosted MCP cannot write local evidence sheets.',
    inputSchema: {
      projectId,
      sheetTypes: z.array(z.enum(['overview', 'style', 'references', 'storyboard', 'renders'])).optional(),
      outputDir: idString.optional(),
    },
  }, unsupported('write_project_sheets', 'Requires local artifact rendering in the fallback package.'));

  registerTool('attach_director_session', {
    title: 'Attach director session',
    description: 'Opens a Lahari project for director work and returns packet/actions/events.',
    inputSchema: { projectId, note: shortText.optional(), sinceSeq: z.number().optional() },
  }, ({ projectId, note, sinceSeq }) => remoteSessionState(projectId, auth.userId, { note, sinceSeq }));

  registerTool('get_director_session', {
    title: 'Get director session',
    description: 'Returns current packet/actions/events for a project.',
    inputSchema: { projectId, sinceSeq: z.number().optional() },
  }, ({ projectId, sinceSeq }) => remoteSessionState(projectId, auth.userId, { sinceSeq }));

  registerTool('add_director_note', {
    title: 'Add director journal note',
    description: 'Remote gap. Hosted note event endpoint is not exposed yet.',
    inputSchema: { projectId, note: mediumText.min(1) },
  }, unsupported('add_director_note', 'Requires hosted director-note event endpoint.'));

  for (const [name, title] of [
    ['preview_rewrite_shot_prompts', 'Preview shot prompt rewrite'],
    ['preview_rewrite_script', 'Preview script rewrite'],
    ['preview_rewrite_storyboard_prompt', 'Preview storyboard prompt rewrite'],
    ['plan_apply_shot_prompt_preview', 'Plan applying shot prompt preview'],
    ['plan_apply_storyboard_prompt_preview', 'Plan applying storyboard prompt preview'],
    ['plan_apply_script_preview', 'Plan applying script preview'],
    ['apply_shot_prompt_preview', 'Apply shot prompt preview'],
    ['apply_storyboard_prompt_preview', 'Apply storyboard prompt preview'],
    ['apply_script_preview', 'Apply script preview'],
    ['rollback_shot_prompt_preview', 'Rollback shot prompt preview'],
    ['rollback_storyboard_prompt_preview', 'Rollback storyboard prompt preview'],
    ['rollback_script_preview', 'Rollback script preview'],
  ] as const) {
    const schema = name === 'preview_rewrite_storyboard_prompt'
      ? { projectId, shotId, note: shortText.optional() }
      : name.startsWith('preview_rewrite_')
        ? { projectId, note: shortText.optional() }
        : { previewJsonPath: idString };
    registerTool(name, {
      title,
      description: 'Remote gap. Legacy local-preview-file workflow is not exposed in hosted MCP.',
      inputSchema: schema,
    }, unsupported(name, 'R28 apply-only tools replaced this local preview-file path for remote artist workspaces.'));
  }

  registerTool('plan_generate_storyboard', {
    title: 'Plan storyboard generation',
    description: 'Read-only. Reports prerequisites and cost before generating a storyboard board.',
    inputSchema: { projectId, shotId, modelOverride: modelOverrideSchema },
  }, async ({ projectId, shotId, modelOverride }) => studio.planGenerateStoryboard(await fullProjectForUser(projectId, auth.userId), shotId, modelOverride || {}));

  registerTool('plan_generate_video', {
    title: 'Plan video generation',
    description: 'Read-only. Reports prerequisites and cost before generating a shot video.',
    inputSchema: { projectId, shotId, modelOverride: modelOverrideSchema },
  }, async ({ projectId, shotId, modelOverride }) => studio.planGenerateVideo(await fullProjectForUser(projectId, auth.userId), shotId, modelOverride || {}));

  const generateStoryboard = async ({ projectId, shotId, artistNote, modelOverride }: any) => studio.applyGenerateStoryboard(
    await fullProjectForUser(projectId, auth.userId),
    shotId,
    artistNote,
    modelOverride || {},
  );
  registerTool('apply_generate_storyboard', {
    title: 'Generate storyboard board',
    description: 'Mutating and paid. Generates a new storyboard board for one shot.',
    inputSchema: { projectId, shotId, artistNote: shortText.optional(), modelOverride: modelOverrideSchema },
  }, generateStoryboard);
  registerTool('generate_storyboard', {
    title: 'Generate storyboard board',
    description: 'Alias for apply_generate_storyboard.',
    inputSchema: { projectId, shotId, artistNote: shortText.optional(), modelOverride: modelOverrideSchema },
  }, generateStoryboard);

  registerTool('bulk_generate_storyboards', {
    title: 'Bulk generate storyboard boards',
    description: 'Mutating and paid. Generates boards for selected unlocked shots.',
    inputSchema: {
      projectId,
      shotIds: maxArray(idString, 100).optional(),
      force: z.boolean().optional(),
      artistNote: shortText.optional(),
      modelOverride: modelOverrideSchema,
    },
  }, async ({ projectId, shotIds, force, artistNote, modelOverride }) => studio.bulkGenerateStoryboards(await fullProjectForUser(projectId, auth.userId), {
    shotIds,
    force,
    artistNote,
    modelOverride: modelOverride || {},
  }));

  registerTool('refine_storyboard_image', {
    title: 'Refine storyboard image',
    description: 'Mutating and paid. Refines active board/current version from artist feedback.',
    inputSchema: {
      projectId,
      shotId,
      feedback: mediumText.min(1),
      previousVersionId: idString.optional(),
      artistReferenceImagePath: idString.optional(),
      modelOverride: modelOverrideSchema,
    },
  }, async ({ projectId, shotId, feedback, previousVersionId, artistReferenceImagePath, modelOverride }) => studio.refineStoryboardImage(
    await fullProjectForUser(projectId, auth.userId),
    shotId,
    { feedback, previousVersionId, artistReferenceImagePath, modelOverride: modelOverride || {} },
  ));

  registerTool('lock_storyboard', {
    title: 'Lock storyboard board',
    description: 'Mutating. Locks active storyboard board or specific version.',
    inputSchema: { projectId, shotId, versionId: idString.optional() },
  }, async ({ projectId, shotId, versionId }) => studio.lockStoryboardBoard(await fullProjectForUser(projectId, auth.userId), shotId, versionId));

  registerTool('unlock_storyboard', {
    title: 'Unlock storyboard board',
    description: 'Mutating. Unlocks storyboard board for revision.',
    inputSchema: { projectId, shotId },
  }, async ({ projectId, shotId }) => studio.unlockStoryboardBoard(await fullProjectForUser(projectId, auth.userId), shotId));

  registerTool('apply_project_preferences', {
    title: 'Apply project preferences',
    description: 'Mutating. Persists Codex-written project model preferences.',
    inputSchema: {
      projectId,
      preferences: z.object({
        textProvider: idString.optional(),
        storyboardProvider: idString.optional(),
        videoModel: idString.optional(),
      }),
      baseHash: z.string().optional(),
    },
  }, async ({ projectId, preferences, baseHash }) => studio.applyProjectPreferencesConfig(await fullProjectForUser(projectId, auth.userId), preferences, baseHash));

  registerTool('apply_shot_prompts', {
    title: 'Apply shot prompts',
    description: 'Mutating. Persists Codex-written visual/motion/direction/continuity updates.',
    inputSchema: {
      projectId,
      shots: maxArray(z.object({
        shotId: idString,
        visualPrompt: optionalPromptText,
        motionPrompt: optionalPromptText,
        direction: mediumText.optional(),
        continuityFrom: z.enum(['cut', 'prev_shot']).optional(),
        baseHash: idString.optional(),
      }), 100).min(1),
      force: z.boolean().optional(),
    },
  }, async ({ projectId, shots, force }) => studio.applyShotPrompts(await fullProjectForUser(projectId, auth.userId), shots, { force }));

  registerTool('apply_shot_workflow_modes', {
    title: 'Apply shot workflow modes',
    description: 'Mutating. Persists per-shot workflow mode overrides: auto, storyboard, or keyframe.',
    inputSchema: {
      projectId,
      shots: maxArray(z.object({
        shotId,
        workflowMode: workflowModeSchema,
        note: mediumText.optional(),
      }), 100).min(1),
    },
  }, async ({ projectId, shots }) => studio.applyShotWorkflowModes(await fullProjectForUser(projectId, auth.userId), shots));

  registerTool('apply_storyboard_prompt', {
    title: 'Apply storyboard prompt',
    description: 'Mutating. Persists a Codex-written storyboard prompt and cut plan.',
    inputSchema: {
      projectId,
      shotId,
      storyboardPrompt: promptText,
      storyboardCutPlan: optionalPromptText,
      baseHash: idString.optional(),
      force: z.boolean().optional(),
    },
  }, async ({ projectId, shotId, storyboardPrompt, storyboardCutPlan, baseHash, force }) => studio.applyStoryboardPrompt(
    await fullProjectForUser(projectId, auth.userId),
    shotId,
    storyboardPrompt,
    storyboardCutPlan || '',
    { baseHash, force },
  ));

  registerTool('apply_storyboard_prompts_bulk', {
    title: 'Apply storyboard prompts bulk',
    description: 'Mutating. Persists Codex-written storyboard prompts/cut plans for multiple shots. Prefer apply_storyboard_scene_markdown for artist-facing scene-by-scene writing.',
    inputSchema: {
      projectId,
      shots: maxArray(z.object({
        shotId: idString,
        storyboardPrompt: promptText,
        storyboardCutPlan: optionalPromptText,
        baseHash: idString.optional(),
      }), 100).min(1),
      force: z.boolean().optional(),
    },
  }, async ({ projectId, shots, force }) => studio.applyStoryboardPromptsBulk(await fullProjectForUser(projectId, auth.userId), { shots, force }));

  registerTool('apply_storyboard_scene_markdown', {
    title: 'Apply storyboard scene markdown',
    description: 'Mutating. Parses an edited drafts/storyboards/<scene>.md file, validates per-shot hashes, and persists storyboard prompts plus Seedance cut plans scene-by-scene.',
    inputSchema: {
      projectId,
      markdown: storyboardSceneMarkdownText,
      force: z.boolean().optional(),
    },
  }, async ({ projectId, markdown, force }) => studio.applyStoryboardSceneMarkdown(await fullProjectForUser(projectId, auth.userId), markdown, { force }));

  registerTool('apply_concept', {
    title: 'Apply concept',
    description: 'Mutating. Persists a Codex-written locked concept object.',
    inputSchema: {
      projectId,
      concept: z.object({
        title: mediumText.min(1),
        direction: promptText,
        description: promptText,
        deity: mediumText.optional(),
        mood: mediumText.optional(),
      }),
      baseHash: z.string().optional(),
      force: z.boolean().optional(),
    },
  }, async ({ projectId, concept, baseHash, force }) => studio.applyConcept(await fullProjectForUser(projectId, auth.userId), concept, { baseHash, force }));

  registerTool('apply_style_direction', {
    title: 'Apply style direction',
    description: 'Mutating. Persists Codex-written project style direction text without generating or locking a style image.',
    inputSchema: {
      projectId,
      style: z.object({
        styleDescription: promptText,
        styleGenerationPrompt: optionalPromptText,
        colorPalette: mediumText.optional(),
      }),
      baseHash: z.string().optional(),
      force: z.boolean().optional(),
    },
  }, async ({ projectId, style, baseHash, force }) => studio.applyStyleDirection(await fullProjectForUser(projectId, auth.userId), style, { baseHash, force }));

  registerTool('apply_video_prompt', {
    title: 'Apply video prompt',
    description: 'Mutating. Persists a Codex-written keyframe-mode motion prompt.',
    inputSchema: { projectId, shotId, motionPrompt: promptText, baseHash: idString.optional(), force: z.boolean().optional() },
  }, async ({ projectId, shotId, motionPrompt, baseHash, force }) => studio.applyVideoPrompt(await fullProjectForUser(projectId, auth.userId), shotId, motionPrompt, { baseHash, force }));

  registerTool('apply_script', {
    title: 'Apply script',
    description: 'Mutating and high blast radius. Atomically replaces cast, environments, scenes, and shots.',
    inputSchema: {
      projectId,
      script: z.object({
        cast: maxArray(z.object({ id: idString.optional(), name: mediumText.min(1), description: promptText.optional() }), 60),
        environments: maxArray(z.object({ id: idString.optional(), name: mediumText.min(1), description: promptText.optional() }), 60),
        scenes: maxArray(z.object({
          id: idString.optional(),
          sectionLabel: mediumText.optional(),
          startTime: idString.optional(),
          endTime: idString.optional(),
          lyrics: promptText.optional(),
          narrativeDescription: promptText.optional(),
          shots: maxArray(z.object({
            id: idString.optional(),
            direction: promptText,
            duration: z.number().positive().max(120),
            castIds: maxArray(idString, 20).optional(),
            environmentId: idString.nullable().optional(),
            continuityFrom: z.enum(['cut', 'prev_shot']).optional(),
          }), 80).min(1),
        }), 80).min(1),
      }),
      baseFingerprint: idString.optional(),
      force: z.boolean().optional(),
    },
  }, async ({ projectId, script, baseFingerprint, force }) => studio.applyScript(await fullProjectForUser(projectId, auth.userId), script, { baseFingerprint, force }));

  registerTool('apply_script_markdown', {
    title: 'Apply script markdown',
    description: 'Mutating and high blast radius. Parses an edited drafts/script.md Lahari script draft, validates fingerprint/durations, and atomically replaces cast, environments, scenes, and shots.',
    inputSchema: {
      projectId,
      markdown: scriptMarkdownText,
      baseFingerprint: idString.optional(),
      force: z.boolean().optional(),
    },
  }, async ({ projectId, markdown, baseFingerprint, force }) => studio.applyScriptMarkdown(await fullProjectForUser(projectId, auth.userId), markdown, { baseFingerprint, force }));

  registerTool('apply_project_prompt_override', {
    title: 'Apply project prompt override',
    description: 'Mutating. Persists a Codex-written project-level prompt recipe.',
    inputSchema: { projectId, kind: promptOverrideKindSchema, body: promptText, baseHash: idString.optional() },
  }, async ({ projectId, kind, body, baseHash }) => studio.applyProjectPromptOverrideConfig(await fullProjectForUser(projectId, auth.userId), kind, body, baseHash));

  registerTool('revert_project_prompt_override', {
    title: 'Revert project prompt override',
    description: 'Mutating. Reverts active project prompt recipe.',
    inputSchema: { projectId, kind: promptOverrideKindSchema, baseHash: idString.optional() },
  }, async ({ projectId, kind, baseHash }) => studio.revertProjectPromptOverrideConfig(await fullProjectForUser(projectId, auth.userId), kind, baseHash));

  registerTool('apply_generate_video', {
    title: 'Generate shot video',
    description: 'Mutating and paid. Generates a new video for one shot.',
    inputSchema: { projectId, shotId, promptOverride: optionalPromptText, modelOverride: modelOverrideSchema },
  }, async ({ projectId, shotId, promptOverride, modelOverride }) => studio.applyGenerateVideo(await fullProjectForUser(projectId, auth.userId), shotId, promptOverride, modelOverride || {}));

  registerTool('lahari_capture_issue', {
    title: 'Capture Lahari director issue',
    description: 'Captures an issue for later engine debugging.',
    inputSchema: {
      projectId,
      severity: z.enum(['low', 'mid', 'high']),
      summary: shortText.min(1),
      suggestedFix: mediumText.optional(),
      recentToolCalls: z.unknown().optional(),
    },
  }, async ({ projectId, severity, summary, suggestedFix, recentToolCalls }) => {
    await assertProjectAccess(projectId, auth.userId);
    return captureLahariIssue({ projectId, severity, summary, suggestedFix, recentToolCalls });
  });

  return server;
};

router.post('/', async (req, res) => {
  let auth: HostedAuth;
  try {
    auth = await verifyMcpBearerToken(bearerToken(req.headers.authorization));
    assertRateLimit({
      key: `mcp:request:${auth.tokenId}`,
      limit: MCP_LIMITS.requestPerMinute,
      windowMs: 60 * 1000,
      label: 'Lahari MCP request',
    });
  } catch (error) {
    const structured = structuredToolError(error);
    const status = error instanceof RateLimitError ? 429 : 401;
    return res.status(status).json({
      jsonrpc: '2.0',
      error: {
        code: error instanceof RateLimitError ? -32029 : -32001,
        message: structured.message || 'Unauthorized Lahari MCP request',
        data: structured,
      },
      id: (req.body as any)?.id ?? null,
    });
  }

  await runWithRequestContext({ userId: auth.userId }, async () => {
    const server = createHostedMcpServer(auth);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
});

router.get('/', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Lahari MCP uses Streamable HTTP POST requests.',
    },
    id: null,
  });
});

router.delete('/', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Lahari MCP is stateless; DELETE is not supported.',
    },
    id: null,
  });
});

export { router as mcpRouter };
