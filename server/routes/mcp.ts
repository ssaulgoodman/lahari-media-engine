import { Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import { selectColumns, selectOne } from '../database.js';
import { getFullProject } from './projects.js';
import { listDirectorEvents } from '../services/directorEvents.js';
import { captureLahariIssue, recordMcpAudit } from '../services/lahariAudit.js';
import { verifyMcpBearerToken } from '../services/mcpTokens.js';
import * as studio from '../services/codexStudio.js';

const router = Router();
const HOSTED_MCP_VERSION = '0.1.0';

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

const projectId = z.string().min(1).describe('Lahari project ID.');
const shotId = z.string().min(1).describe('Shot ID within the project.');

const structuredToolError = (error: unknown) => {
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
  });

  const registerTool = (
    name: string,
    config: Parameters<typeof server.registerTool>[1],
    handler: (args: any) => Promise<unknown>,
  ) => {
    server.registerTool(name, config, async (args: any) => {
      const startedAt = new Date().toISOString();
      const start = Date.now();
      recordMcpAudit({ source: 'mcp-remote', phase: 'start', tool: name, args, startedAt });
      try {
        const result = await handler(args || {});
        recordMcpAudit({ source: 'mcp-remote', phase: 'finish', tool: name, args, result, durationMs: Date.now() - start, startedAt });
        return textResult(result);
      } catch (error) {
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
    description: 'Remote gap. Local desk-copy writing belongs to the fallback local package.',
    inputSchema: { projectId, outputDir: z.string().optional() },
  }, unsupported('hydrate_project_workbench', 'Hosted MCP cannot write local .lahari desk-copy files.'));

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
      reportPath: z.string().optional(),
      contactSheetPath: z.string().optional(),
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
      outputDir: z.string().optional(),
    },
  }, unsupported('write_project_sheets', 'Requires local artifact rendering in the fallback package.'));

  registerTool('attach_director_session', {
    title: 'Attach director session',
    description: 'Opens a Lahari project for director work and returns packet/actions/events.',
    inputSchema: { projectId, note: z.string().optional(), sinceSeq: z.number().optional() },
  }, ({ projectId, note, sinceSeq }) => remoteSessionState(projectId, auth.userId, { note, sinceSeq }));

  registerTool('get_director_session', {
    title: 'Get director session',
    description: 'Returns current packet/actions/events for a project.',
    inputSchema: { projectId, sinceSeq: z.number().optional() },
  }, ({ projectId, sinceSeq }) => remoteSessionState(projectId, auth.userId, { sinceSeq }));

  registerTool('add_director_note', {
    title: 'Add director journal note',
    description: 'Remote gap. Hosted note event endpoint is not exposed yet.',
    inputSchema: { projectId, note: z.string().min(1) },
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
      ? { projectId, shotId, note: z.string().optional() }
      : name.startsWith('preview_rewrite_')
        ? { projectId, note: z.string().optional() }
        : { previewJsonPath: z.string().min(1) };
    registerTool(name, {
      title,
      description: 'Remote gap. Legacy local-preview-file workflow is not exposed in hosted MCP.',
      inputSchema: schema,
    }, unsupported(name, 'R28 apply-only tools replaced this local preview-file path for remote artist workspaces.'));
  }

  registerTool('plan_generate_storyboard', {
    title: 'Plan storyboard generation',
    description: 'Read-only. Reports prerequisites and cost before generating a storyboard board.',
    inputSchema: { projectId, shotId },
  }, async ({ projectId, shotId }) => studio.planGenerateStoryboard(await fullProjectForUser(projectId, auth.userId), shotId));

  registerTool('plan_generate_video', {
    title: 'Plan video generation',
    description: 'Read-only. Reports prerequisites and cost before generating a shot video.',
    inputSchema: { projectId, shotId },
  }, async ({ projectId, shotId }) => studio.planGenerateVideo(await fullProjectForUser(projectId, auth.userId), shotId));

  const generateStoryboard = async ({ projectId, shotId, artistNote }: any) => studio.applyGenerateStoryboard(
    await fullProjectForUser(projectId, auth.userId),
    shotId,
    artistNote,
  );
  registerTool('apply_generate_storyboard', {
    title: 'Generate storyboard board',
    description: 'Mutating and paid. Generates a new storyboard board for one shot.',
    inputSchema: { projectId, shotId, artistNote: z.string().optional() },
  }, generateStoryboard);
  registerTool('generate_storyboard', {
    title: 'Generate storyboard board',
    description: 'Alias for apply_generate_storyboard.',
    inputSchema: { projectId, shotId, artistNote: z.string().optional() },
  }, generateStoryboard);

  registerTool('bulk_generate_storyboards', {
    title: 'Bulk generate storyboard boards',
    description: 'Mutating and paid. Generates boards for selected unlocked shots.',
    inputSchema: {
      projectId,
      shotIds: z.array(z.string().min(1)).optional(),
      force: z.boolean().optional(),
      artistNote: z.string().optional(),
    },
  }, async ({ projectId, shotIds, force, artistNote }) => studio.bulkGenerateStoryboards(await fullProjectForUser(projectId, auth.userId), {
    shotIds,
    force,
    artistNote,
  }));

  registerTool('refine_storyboard_image', {
    title: 'Refine storyboard image',
    description: 'Mutating and paid. Refines active board/current version from artist feedback.',
    inputSchema: {
      projectId,
      shotId,
      feedback: z.string().min(1),
      previousVersionId: z.string().optional(),
      artistReferenceImagePath: z.string().optional(),
    },
  }, async ({ projectId, shotId, feedback, previousVersionId, artistReferenceImagePath }) => studio.refineStoryboardImage(
    await fullProjectForUser(projectId, auth.userId),
    shotId,
    { feedback, previousVersionId, artistReferenceImagePath },
  ));

  registerTool('lock_storyboard', {
    title: 'Lock storyboard board',
    description: 'Mutating. Locks active storyboard board or specific version.',
    inputSchema: { projectId, shotId, versionId: z.string().optional() },
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
        textProvider: z.string().optional(),
        imageModel: z.string().optional(),
        storyboardProvider: z.string().optional(),
        videoModel: z.string().optional(),
      }),
      baseHash: z.string().optional(),
    },
  }, async ({ projectId, preferences, baseHash }) => studio.applyProjectPreferencesConfig(await fullProjectForUser(projectId, auth.userId), preferences, baseHash));

  registerTool('apply_shot_prompts', {
    title: 'Apply shot prompts',
    description: 'Mutating. Persists Codex-written visual/motion/direction/continuity updates.',
    inputSchema: {
      projectId,
      shots: z.array(z.object({
        shotId: z.string().min(1),
        visualPrompt: z.string().optional(),
        motionPrompt: z.string().optional(),
        direction: z.string().optional(),
        continuityFrom: z.enum(['cut', 'prev_shot']).optional(),
        baseHash: z.string().optional(),
      })).min(1),
      force: z.boolean().optional(),
    },
  }, async ({ projectId, shots, force }) => studio.applyShotPrompts(await fullProjectForUser(projectId, auth.userId), shots, { force }));

  registerTool('apply_storyboard_prompt', {
    title: 'Apply storyboard prompt',
    description: 'Mutating. Persists a Codex-written storyboard prompt and cut plan.',
    inputSchema: {
      projectId,
      shotId,
      storyboardPrompt: z.string().min(1),
      storyboardCutPlan: z.string().optional(),
      baseHash: z.string().optional(),
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
    description: 'Mutating. Persists Codex-written storyboard prompts/cut plans for multiple shots.',
    inputSchema: {
      projectId,
      shots: z.array(z.object({
        shotId: z.string().min(1),
        storyboardPrompt: z.string().min(1),
        storyboardCutPlan: z.string().optional(),
        baseHash: z.string().optional(),
      })).min(1),
      force: z.boolean().optional(),
    },
  }, async ({ projectId, shots, force }) => studio.applyStoryboardPromptsBulk(await fullProjectForUser(projectId, auth.userId), { shots, force }));

  registerTool('apply_concept', {
    title: 'Apply concept',
    description: 'Mutating. Persists a Codex-written locked concept object.',
    inputSchema: {
      projectId,
      concept: z.object({
        title: z.string().min(1),
        direction: z.string().min(1),
        description: z.string().min(1),
        deity: z.string().optional(),
        mood: z.string().optional(),
      }),
      baseHash: z.string().optional(),
      force: z.boolean().optional(),
    },
  }, async ({ projectId, concept, baseHash, force }) => studio.applyConcept(await fullProjectForUser(projectId, auth.userId), concept, { baseHash, force }));

  registerTool('apply_video_prompt', {
    title: 'Apply video prompt',
    description: 'Mutating. Persists a Codex-written keyframe-mode motion prompt.',
    inputSchema: { projectId, shotId, motionPrompt: z.string().min(1), baseHash: z.string().optional(), force: z.boolean().optional() },
  }, async ({ projectId, shotId, motionPrompt, baseHash, force }) => studio.applyVideoPrompt(await fullProjectForUser(projectId, auth.userId), shotId, motionPrompt, { baseHash, force }));

  registerTool('apply_script', {
    title: 'Apply script',
    description: 'Mutating and high blast radius. Atomically replaces cast, environments, scenes, and shots.',
    inputSchema: {
      projectId,
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
      baseFingerprint: z.string().optional(),
      force: z.boolean().optional(),
    },
  }, async ({ projectId, script, baseFingerprint, force }) => studio.applyScript(await fullProjectForUser(projectId, auth.userId), script, { baseFingerprint, force }));

  registerTool('apply_project_prompt_override', {
    title: 'Apply project prompt override',
    description: 'Mutating. Persists a Codex-written project-level storyboard/video recipe.',
    inputSchema: { projectId, kind: z.enum(['storyboard', 'video']), body: z.string().min(1), baseHash: z.string().optional() },
  }, async ({ projectId, kind, body, baseHash }) => studio.applyProjectPromptOverrideConfig(await fullProjectForUser(projectId, auth.userId), kind, body, baseHash));

  registerTool('revert_project_prompt_override', {
    title: 'Revert project prompt override',
    description: 'Mutating. Reverts active project prompt recipe.',
    inputSchema: { projectId, kind: z.enum(['storyboard', 'video']), baseHash: z.string().optional() },
  }, async ({ projectId, kind, baseHash }) => studio.revertProjectPromptOverrideConfig(await fullProjectForUser(projectId, auth.userId), kind, baseHash));

  registerTool('apply_generate_video', {
    title: 'Generate shot video',
    description: 'Mutating and paid. Generates a new video for one shot.',
    inputSchema: { projectId, shotId, promptOverride: z.string().optional() },
  }, async ({ projectId, shotId, promptOverride }) => studio.applyGenerateVideo(await fullProjectForUser(projectId, auth.userId), shotId, promptOverride));

  registerTool('lahari_capture_issue', {
    title: 'Capture Lahari director issue',
    description: 'Captures an issue for later engine debugging.',
    inputSchema: {
      projectId: z.string().optional(),
      severity: z.enum(['low', 'mid', 'high']),
      summary: z.string().min(1),
      suggestedFix: z.string().optional(),
      recentToolCalls: z.unknown().optional(),
    },
  }, async ({ projectId, severity, summary, suggestedFix, recentToolCalls }) => {
    if (projectId) await assertProjectAccess(projectId, auth.userId);
    return captureLahariIssue({ projectId, severity, summary, suggestedFix, recentToolCalls });
  });

  return server;
};

router.post('/', async (req, res) => {
  let auth: HostedAuth;
  try {
    auth = await verifyMcpBearerToken(bearerToken(req.headers.authorization));
  } catch (error) {
    return res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: error instanceof Error ? error.message : 'Unauthorized Lahari MCP request',
      },
      id: (req.body as any)?.id ?? null,
    });
  }

  const server = createHostedMcpServer(auth);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
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
