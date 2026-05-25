import crypto from 'node:crypto';
import { Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import { selectColumns, selectOne } from '../database.js';
import { getFullProject } from './projects.js';
import { listDirectorEvents } from '../services/directorEvents.js';
import { captureMirageIssue, recordMcpAudit, summarizeAgentTiming } from '../services/mirageAudit.js';
import { createCliToken, verifyMcpBearerToken } from '../services/mcpTokens.js';
import { RateLimitError, assertRateLimit, envInt } from '../services/rateLimit.js';
import { finishAgentOperation, startAgentOperation } from '../services/agentOperations.js';
import * as studio from '../services/codexStudio.js';
import { runWithRequestContext } from '../requestContext.js';
import { structuredError } from '../services/structuredErrors.js';
import { normalizeWorkflowKey } from '../presets.js';

const router = Router();
const HOSTED_MCP_VERSION = '0.1.12';
const promptOverrideKindSchema = z.enum(['concept', 'script', 'shot_prompts', 'storyboard', 'video', 'character_looks', 'environment_looks', 'audio_plan']);
const HOSTED_MCP_INSTRUCTIONS = `You are operating Mirage as an assistant director.

Supabase is canonical project truth. Use MCP tools for reads, applies, generation, locks, and issue capture. Do not invent direct database writes.

Artist flow: when the artist names a project, calls out a workflow, or asks to continue work, call list_projects or resolve_project first. If the artist asks to start a new non-audio project, call create_project, then open_project. For Looks and Storyboard work, prefer list_actions -> describe_action -> run_action; use parallel_run when several independent storyboard actions should start together. If you need to bring a local/native image into Mirage, do not send bytes through MCP: POST multipart to /api/agent/uploads with the same bearer token, then pass the returned assetId to lock_reference as sourceAssetId or generate_candidates as guideAssetId. For notebook/file editing, prefer mint_cli_token plus the returned shell-specific sync command to materialize or refresh the notebook without moving file bodies through chat. Use commands.posix on macOS/Linux; use commands.powershell on Windows, which intentionally wraps npx through cmd /c to avoid PowerShell npx.ps1 policy blocks. If shell/npx/npm is unavailable or blocked, use get_project_notebook_manifest then read_project_notebook_file path-by-path. Treat mirrors/ files as read-only DB snapshots. Edit drafts/script.md for surgical script changes, then persist with apply_script_markdown. Storyboard prompt text can be persisted through run_action(apply_storyboard_prompts) with either shots[] or scene markdown. Edit drafts/audio-plan.md for dialogue/audio-plan changes, then persist with apply_audio_plan_markdown. Append concise decisions to journal.md. After first notebook write, restart or open a fresh harness session in that folder so native skills are discovered.

Text generation is harness-native: write concepts, style directions, scripts, shot prompts, storyboard prompts, and video prompts yourself, then persist with apply-only tools. Media generation stays tool-based and paid; ask before generation. Use per-call modelOverride for experiments instead of changing project defaults.

Use production language with artists. Say open/attach, not hydrate. The web app is the visual studio; use returned web links for visual review. If a tool behaves unexpectedly or the web studio disagrees with MCP state, call mirage_capture_issue before guessing.`;

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
const projectId = idString.describe('Mirage project ID.');
const shotId = idString.describe('Shot ID within the project.');
const shortText = z.string().max(2000);
const mediumText = z.string().max(8000);
const promptText = z.string().min(1).max(30000);
const imageBase64Text = z.string().min(1).max(20_000_000).describe('Base64 image data, optionally as a data:image/...;base64,... URL.');
const imageMimeType = z.enum(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']).optional();
const scriptMarkdownText = z.string().min(1).max(120000);
const audioPlanMarkdownText = z.string().min(1).max(120000);
const storyboardSceneMarkdownText = z.string().min(1).max(80000);
const optionalPromptText = z.string().max(30000).optional();
const notebookFilePath = z.string().min(1).max(800).describe('Notebook file path returned by get_project_notebook_manifest.');
const maxArray = <T extends z.ZodTypeAny>(schema: T, max: number) => z.array(schema).max(max);
const modelOverrideSchema = z.object({
  storyboardProvider: idString.optional(),
  videoModel: idString.optional(),
}).optional();
const workflowKeySchema = z.enum(['music_led', 'scripted_narrative', 'music_video', 'anime_scripted']);
const presetKeySchema = z.enum(['music_video_default', 'anime_default']);
const seedKindSchema = z.enum(['script', 'brief', 'document', 'idea']);
const workflowModeSchema = z.enum(['auto', 'storyboard', 'keyframe']);
const dialogueStrategySchema = z.enum(['lipsync', 'overlay']);
const ttsStatusSchema = z.enum(['pending', 'generating', 'success', 'error']);
const lookEntityTypeSchema = z.enum(['cast', 'environment', 'env']);
const actionKeySchema = z.enum([
  'generate_candidates',
  'list_candidates',
  'lock_reference',
  'generate_storyboard',
  'bulk_generate_storyboards',
  'apply_storyboard_prompts',
  'refine_storyboard_image',
  'lock_storyboard',
  'unlock_storyboard',
]);
const actionSurfaceSchema = z.enum(['looks', 'storyboard']);
const projectStateDetailSchema = z.enum(['summary', 'production', 'full']);
const actionInputSchema = z.record(z.string(), z.unknown()).optional();
const audioPlanSchema = z.object({
  dialogueStrategy: dialogueStrategySchema,
  dialogue: maxArray(z.object({
    id: idString,
    characterId: idString,
    text: z.string().min(1).max(500),
    order: z.number().positive().max(200),
    targetSec: z.number().positive().max(30).optional(),
    ttsAssetId: idString.nullable().optional(),
    ttsStatus: ttsStatusSchema.optional(),
    ttsError: z.string().max(500).optional(),
    ttsCharCount: z.number().int().nonnegative().optional(),
    ttsDurationSec: z.number().nonnegative().optional(),
  }), 100),
  soundNotes: z.string().max(1000).optional(),
});

const MCP_LIMITS = {
  requestPerMinute: envInt('MIRAGE_MCP_REQUESTS_PER_MINUTE', envInt('LAHARI_MCP_REQUESTS_PER_MINUTE', 120)),
  mutatingPerHour: envInt('MIRAGE_MCP_MUTATIONS_PER_HOUR', envInt('LAHARI_MCP_MUTATIONS_PER_HOUR', 180)),
  paidPerDay: envInt('MIRAGE_MCP_PAID_CALLS_PER_DAY', envInt('LAHARI_MCP_PAID_CALLS_PER_DAY', 30)),
  issuesPerHour: envInt('MIRAGE_MCP_ISSUES_PER_HOUR', envInt('LAHARI_MCP_ISSUES_PER_HOUR', 20)),
};

const PAID_TOOLS = new Set([
  'apply_generate_storyboard',
  'generate_storyboard',
  'bulk_generate_storyboards',
  'refine_storyboard_image',
  'apply_generate_character_looks',
  'generate_character_looks',
  'apply_generate_environment_looks',
  'generate_environment_looks',
  'apply_generate_video',
  'generate_dialogue_audio',
]);

const LOOK_ACTION_SPECS = {
  generate_candidates: {
    key: 'generate_candidates',
    title: 'Generate reference candidates',
    surface: 'looks',
    mutates: true,
    paid: true,
    description: 'Generate reusable character or environment reference candidates. Use note for soft direction, promptOverride for an exact final prompt, and guideAssetId after uploading an image as a visual guide.',
    input: {
      projectId: 'string',
      entityType: '"cast" | "environment"',
      entityIds: 'string[]',
      note: 'optional string',
      promptOverride: 'optional string; only one entityId may be used',
      guideAssetId: 'optional existing Mirage asset id',
    },
    examples: [{
      projectId: 'project_uuid',
      entityType: 'cast',
      entityIds: ['cast_member_uuid'],
      note: 'make the outfit simpler and closer to the locked style reference',
    }],
  },
  list_candidates: {
    key: 'list_candidates',
    title: 'List reference candidates',
    surface: 'looks',
    mutates: false,
    paid: false,
    description: 'List generated candidate image URLs and asset IDs for one cast member or environment.',
    input: {
      projectId: 'string',
      entityType: '"cast" | "environment"',
      entityId: 'string',
    },
    examples: [{
      projectId: 'project_uuid',
      entityType: 'environment',
      entityId: 'environment_uuid',
    }],
  },
  lock_reference: {
    key: 'lock_reference',
    title: 'Lock reference',
    surface: 'looks',
    mutates: true,
    paid: false,
    description: 'Set an existing Mirage asset as the canonical character or environment reference. Use after list_candidates or /api/agent/uploads.',
    input: {
      projectId: 'string',
      entityType: '"cast" | "environment"',
      entityId: 'string',
      sourceAssetId: 'string',
    },
    examples: [{
      projectId: 'project_uuid',
      entityType: 'cast',
      entityId: 'cast_member_uuid',
      sourceAssetId: 'asset_uuid',
    }],
  },
} as const;

const STORYBOARD_ACTION_SPECS = {
  generate_storyboard: {
    key: 'generate_storyboard',
    title: 'Generate storyboard',
    surface: 'storyboard',
    mutates: true,
    paid: true,
    description: 'Render a storyboard board for one shot from its saved storyboard prompt. dryRun returns the plan without spending.',
    input: {
      projectId: 'string',
      shotId: 'string',
      dryRun: 'optional boolean',
      artistNote: 'optional soft direction for image generation',
      modelOverride: 'optional storyboardProvider override',
    },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid', dryRun: true }],
  },
  bulk_generate_storyboards: {
    key: 'bulk_generate_storyboards',
    title: 'Bulk generate storyboards',
    surface: 'storyboard',
    mutates: true,
    paid: true,
    description: 'Generate missing/stale/error storyboard boards for selected shots. Use parallel_run for custom parallel batches.',
    input: {
      projectId: 'string',
      shotIds: 'optional string[]',
      force: 'optional boolean',
      artistNote: 'optional soft direction',
      modelOverride: 'optional storyboardProvider override',
    },
    examples: [{ projectId: 'project_uuid', shotIds: ['shot_a', 'shot_b'], force: true }],
  },
  apply_storyboard_prompts: {
    key: 'apply_storyboard_prompts',
    title: 'Apply storyboard prompts',
    surface: 'storyboard',
    mutates: true,
    paid: false,
    description: 'Persist storyboard prompt/cut-plan text. Accepts either structured shots[] or one scene markdown draft.',
    input: {
      projectId: 'string',
      shots: 'optional array of {shotId, storyboardPrompt, storyboardCutPlan?, baseHash?}',
      markdown: 'optional mirage-storyboard-scene-v1 markdown',
      force: 'optional boolean',
    },
    examples: [{ projectId: 'project_uuid', shots: [{ shotId: 'shot_uuid', storyboardPrompt: '...', storyboardCutPlan: '...' }] }],
  },
  refine_storyboard_image: {
    key: 'refine_storyboard_image',
    title: 'Refine storyboard image',
    surface: 'storyboard',
    mutates: true,
    paid: true,
    description: 'Edit the current storyboard image using artist feedback. This is image-edit mode, not prompt text persistence.',
    input: {
      projectId: 'string',
      shotId: 'string',
      feedback: 'string',
      previousVersionId: 'optional string',
      modelOverride: 'optional storyboardProvider override',
    },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid', feedback: 'make the pose less dramatic' }],
  },
  lock_storyboard: {
    key: 'lock_storyboard',
    title: 'Lock storyboard',
    surface: 'storyboard',
    mutates: true,
    paid: false,
    description: 'Mark one storyboard version as approved so current video generation can use it.',
    input: { projectId: 'string', shotId: 'string', versionId: 'optional string' },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid' }],
  },
  unlock_storyboard: {
    key: 'unlock_storyboard',
    title: 'Unlock storyboard',
    surface: 'storyboard',
    mutates: true,
    paid: false,
    description: 'Clear storyboard approval so the board can be regenerated or replaced.',
    input: { projectId: 'string', shotId: 'string' },
    examples: [{ projectId: 'project_uuid', shotId: 'shot_uuid' }],
  },
} as const;

const ALL_ACTION_SPECS = {
  ...LOOK_ACTION_SPECS,
  ...STORYBOARD_ACTION_SPECS,
} as const;

const normalizeLookEntityType = (value: string) => value === 'env' ? 'environment' : value;
const actionSpec = (actionKey?: string | null) => actionKey ? ALL_ACTION_SPECS[actionKey as keyof typeof ALL_ACTION_SPECS] : undefined;

const generateCandidatesInputSchema = z.object({
  projectId,
  entityType: lookEntityTypeSchema,
  entityIds: maxArray(idString, 30).min(1),
  note: mediumText.optional(),
  promptOverride: optionalPromptText,
  guideAssetId: idString.optional(),
});
const listCandidatesInputSchema = z.object({
  projectId,
  entityType: lookEntityTypeSchema,
  entityId: idString,
});
const lockReferenceInputSchema = z.object({
  projectId,
  entityType: lookEntityTypeSchema,
  entityId: idString,
  sourceAssetId: idString,
});
const generateStoryboardInputSchema = z.object({
  projectId,
  shotId,
  dryRun: z.boolean().optional(),
  artistNote: mediumText.optional(),
  modelOverride: modelOverrideSchema,
});
const bulkGenerateStoryboardsInputSchema = z.object({
  projectId,
  shotIds: maxArray(idString, 100).optional(),
  force: z.boolean().optional(),
  artistNote: mediumText.optional(),
  modelOverride: modelOverrideSchema,
});
const applyStoryboardPromptsInputSchema = z.object({
  projectId,
  shots: maxArray(z.object({
    shotId: idString,
    storyboardPrompt: promptText,
    storyboardCutPlan: optionalPromptText,
    baseHash: idString.optional(),
  }), 100).optional(),
  markdown: storyboardSceneMarkdownText.optional(),
  force: z.boolean().optional(),
});
const refineStoryboardImageInputSchema = z.object({
  projectId,
  shotId,
  feedback: mediumText.min(1),
  previousVersionId: idString.optional(),
  modelOverride: modelOverrideSchema,
});
const storyboardLockInputSchema = z.object({
  projectId,
  shotId,
  versionId: idString.optional(),
});

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
      code: error.message.toLowerCase().includes('auth') ? 'auth_expired' : 'mirage_mcp_error',
      message: error.message,
    };
  }
  return {
    code: 'mirage_mcp_error',
    message: String(error || 'Unknown Mirage MCP error'),
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
    kind: 'mirage.director.remote_session',
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
        payload: event.payload || {},
      })),
    },
    sourceOfTruth: 'Supabase is canonical. Remote MCP clients should keep local files as desk copies only.',
  };
};

const createHostedMcpServer = (auth: HostedAuth) => {
  const server = new McpServer({
    name: 'mirage',
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
    if (readOnlyPrefixes.some((prefix) => name.startsWith(prefix)) || name === 'attach_director_session' || name === 'resolve_project' || name === 'open_project' || name === 'describe_action') {
      return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    }
    if (name === 'add_director_note' || name === 'lahari_capture_issue' || name === 'mirage_capture_issue') {
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
        const paidInvocation = PAID_TOOLS.has(name)
          || (name === 'run_action' && !!actionSpec(args?.actionKey)?.paid)
          || (name === 'parallel_run' && Array.isArray(args?.actions) && args.actions.some((action: any) => actionSpec(action?.actionKey)?.paid));
        if (paidInvocation) {
          assertRateLimit({
            key: `mcp:paid:${auth.tokenId}`,
            limit: MCP_LIMITS.paidPerDay,
            windowMs: 24 * 60 * 60 * 1000,
            label: 'Paid Mirage MCP tool',
          });
        } else if (name === 'lahari_capture_issue' || name === 'mirage_capture_issue') {
          assertRateLimit({
            key: `mcp:issue:${auth.tokenId}`,
            limit: MCP_LIMITS.issuesPerHour,
            windowMs: 60 * 60 * 1000,
            label: 'Mirage issue capture',
          });
        } else if (!annotations.readOnlyHint) {
          assertRateLimit({
            key: `mcp:mutating:${auth.tokenId}`,
            limit: MCP_LIMITS.mutatingPerHour,
            windowMs: 60 * 60 * 1000,
            label: 'Mutating Mirage MCP tool',
          });
        }
        if (!annotations.readOnlyHint) {
          operationId = await startAgentOperation({
            projectId: args?.projectId || args?.input?.projectId || args?.actions?.[0]?.input?.projectId,
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
      message: `${tool} is not available in the hosted Mirage MCP server yet.`,
      details: { tool, reason },
    }, null, 2));
  };

  const runRegistryAction = async (actionKey: z.infer<typeof actionKeySchema>, rawInput: Record<string, unknown> = {}) => {
    if (actionKey === 'generate_candidates') {
      const input = generateCandidatesInputSchema.parse(rawInput);
      const entityType = normalizeLookEntityType(input.entityType);
      const project = await fullProjectForUser(input.projectId, auth.userId);
      return entityType === 'cast'
        ? studio.generateCharacterLooksForDirector(project, input.entityIds, {
          note: input.note,
          promptOverride: input.promptOverride,
          guideAssetId: input.guideAssetId,
        })
        : studio.generateEnvironmentLooksForDirector(project, input.entityIds, {
          note: input.note,
          promptOverride: input.promptOverride,
          guideAssetId: input.guideAssetId,
        });
    }
    if (actionKey === 'list_candidates') {
      const input = listCandidatesInputSchema.parse(rawInput);
      const entityType = normalizeLookEntityType(input.entityType);
      return studio.listReferenceCandidates(await fullProjectForUser(input.projectId, auth.userId), {
        entityType: entityType === 'cast' ? 'character' : 'environment',
        entityId: input.entityId,
      });
    }
    if (actionKey === 'lock_reference') {
      const input = lockReferenceInputSchema.parse(rawInput);
      const entityType = normalizeLookEntityType(input.entityType);
      const project = await fullProjectForUser(input.projectId, auth.userId);
      return entityType === 'cast'
        ? studio.applyCastReference(project, { castMemberId: input.entityId, assetId: input.sourceAssetId })
        : studio.applyEnvironmentReference(project, { environmentId: input.entityId, assetId: input.sourceAssetId });
    }
    if (actionKey === 'generate_storyboard') {
      const input = generateStoryboardInputSchema.parse(rawInput);
      const project = await fullProjectForUser(input.projectId, auth.userId);
      return input.dryRun
        ? studio.planGenerateStoryboard(project, input.shotId, input.modelOverride || {})
        : studio.applyGenerateStoryboard(project, input.shotId, input.artistNote, input.modelOverride || {});
    }
    if (actionKey === 'bulk_generate_storyboards') {
      const input = bulkGenerateStoryboardsInputSchema.parse(rawInput);
      return studio.bulkGenerateStoryboards(await fullProjectForUser(input.projectId, auth.userId), {
        shotIds: input.shotIds,
        force: input.force,
        artistNote: input.artistNote,
        modelOverride: input.modelOverride || {},
      });
    }
    if (actionKey === 'apply_storyboard_prompts') {
      const input = applyStoryboardPromptsInputSchema.parse(rawInput);
      const project = await fullProjectForUser(input.projectId, auth.userId);
      if (input.markdown) return studio.applyStoryboardSceneMarkdown(project, input.markdown, { force: input.force });
      if (!input.shots?.length) throw new Error('apply_storyboard_prompts requires either shots[] or markdown.');
      return studio.applyStoryboardPromptsBulk(project, {
        shots: input.shots.map((shot) => ({ ...shot, storyboardCutPlan: shot.storyboardCutPlan || '' })),
        force: input.force,
      });
    }
    if (actionKey === 'refine_storyboard_image') {
      const input = refineStoryboardImageInputSchema.parse(rawInput);
      return studio.refineStoryboardImage(await fullProjectForUser(input.projectId, auth.userId), input.shotId, {
        feedback: input.feedback,
        previousVersionId: input.previousVersionId,
        modelOverride: input.modelOverride || {},
      });
    }
    if (actionKey === 'lock_storyboard') {
      const input = storyboardLockInputSchema.parse(rawInput);
      return studio.lockStoryboardBoard(await fullProjectForUser(input.projectId, auth.userId), input.shotId, input.versionId);
    }
    if (actionKey === 'unlock_storyboard') {
      const input = storyboardLockInputSchema.parse(rawInput);
      return studio.unlockStoryboardBoard(await fullProjectForUser(input.projectId, auth.userId), input.shotId);
    }
    throw new Error(`Unknown action: ${actionKey}`);
  };

  registerTool('list_projects', {
    title: 'List Mirage projects',
    description: 'Read-only. Lists recent Mirage projects for the authenticated artist.',
    inputSchema: { limit: z.number().int().min(1).max(100).optional() },
  }, async ({ limit }) => {
    const rows = await selectColumns(
      'projects',
      'id,title,status,preset_key,workflow_key,seed_kind,song_type,is_narrative,is_meditative,image_model,storyboard_provider,video_model,text_provider,created_at,updated_at',
      { user_id: auth.userId },
      { orderBy: 'updated_at', ascending: false, limit: Math.min(Number(limit || 20) || 20, 100) },
    );
    return {
      kind: 'mirage.project.list',
      generatedAt: new Date().toISOString(),
      projects: rows.map((row: any) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        presetKey: row.preset_key || null,
        workflowKey: normalizeWorkflowKey(row.workflow_key),
        seedKind: row.seed_kind || null,
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

  registerTool('get_agent_timing_summary', {
    title: 'Get agent timing summary',
    description: 'Read-only. Summarizes recent Mirage MCP audit timings for one project: tool duration, result size, inter-tool gaps, slow calls, and timeout/error counts. Use before agent-surface refactors to capture a baseline.',
    inputSchema: {
      projectId,
      sinceHours: z.number().int().min(1).max(24 * 14).optional(),
      source: z.enum(['mcp-remote', 'director-api', 'mcp', 'cli']).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ projectId, sinceHours, source, limit }) => {
    await assertProjectAccess(projectId, auth.userId);
    return summarizeAgentTiming({ projectId, sinceHours, source, limit });
  });

  registerTool('open_project', {
    title: 'Open Mirage project',
    description: 'Read-only cockpit tool. Opens a project session and returns the current packet, actions, recent events, and web studio URL.',
    inputSchema: {
      projectId,
      sinceSeq: z.number().int().nonnegative().optional(),
      note: mediumText.optional(),
    },
  }, async ({ projectId, sinceSeq, note }) => remoteSessionState(projectId, auth.userId, { sinceSeq: sinceSeq ?? null, note }));

  registerTool('get_project_state', {
    title: 'Get project state',
    description: 'Read-only cockpit tool. Returns a compact project state by default. Use detail=production for shot/look summaries or detail=full only when the complete legacy packet is required.',
    inputSchema: {
      projectId,
      detail: projectStateDetailSchema.optional(),
    },
  }, async ({ projectId, detail }) => studio.buildProjectState(await fullProjectForUser(projectId, auth.userId), detail || 'summary'));

  registerTool('list_actions', {
    title: 'List Mirage actions',
    description: 'Read-only cockpit tool. Lists contextual registry actions. Slice 1 exposes the Looks actions: generate_candidates, list_candidates, lock_reference.',
    inputSchema: {
      projectId,
      surface: actionSurfaceSchema.optional(),
    },
  }, async ({ projectId, surface }) => {
    await assertProjectAccess(projectId, auth.userId);
    const actions = Object.values(ALL_ACTION_SPECS).filter((action) => !surface || action.surface === surface);
    return {
      kind: 'mirage.actions.list',
      projectId,
      surface: surface || null,
      actions,
      count: actions.length,
    };
  });

  registerTool('describe_action', {
    title: 'Describe Mirage action',
    description: 'Read-only cockpit tool. Returns the input contract, examples, and semantics for one registry action.',
    inputSchema: {
      actionKey: actionKeySchema,
    },
  }, async ({ actionKey }) => ({
    kind: 'mirage.action.description',
    action: actionSpec(actionKey),
  }));

  registerTool('run_action', {
    title: 'Run Mirage action',
    description: 'Mutating cockpit tool. Runs a registry action by key. Slice 1 supports Looks actions only.',
    inputSchema: {
      actionKey: actionKeySchema,
      input: actionInputSchema,
    },
  }, async ({ actionKey, input }) => runRegistryAction(actionKey, input || {}));

  registerTool('parallel_run', {
    title: 'Run Mirage actions in parallel',
    description: 'Mutating cockpit tool. Runs up to 8 registry actions concurrently and returns one combined receipt. Use for bulk storyboard batches when separate action calls would serialize.',
    inputSchema: {
      actions: maxArray(z.object({
        actionKey: actionKeySchema,
        input: actionInputSchema,
      }), 8).min(1),
    },
  }, async ({ actions }) => {
    const startedAt = new Date().toISOString();
    const results = await Promise.all(actions.map(async (action: any, index: number) => {
      const t0 = Date.now();
      try {
        const result = await runRegistryAction(action.actionKey, action.input || {});
        return {
          index,
          actionKey: action.actionKey,
          ok: true,
          durationMs: Date.now() - t0,
          result,
        };
      } catch (error: any) {
        return {
          index,
          actionKey: action.actionKey,
          ok: false,
          durationMs: Date.now() - t0,
          error: error?.message || String(error),
        };
      }
    }));
    return {
      kind: 'mirage.actions.parallel_result',
      generatedAt: new Date().toISOString(),
      startedAt,
      counts: {
        total: results.length,
        succeeded: results.filter((row) => row.ok).length,
        failed: results.filter((row) => !row.ok).length,
      },
      results,
    };
  });

  registerTool('list_results', {
    title: 'List Mirage results',
    description: 'Read-only cockpit tool. Lists recoverable results for an entity. Slice 1 supports looks candidates.',
    inputSchema: {
      resultType: z.enum(['candidates']),
      projectId,
      entityType: lookEntityTypeSchema,
      entityId: idString,
    },
  }, async ({ resultType, projectId, entityType, entityId }) => {
    if (resultType !== 'candidates') throw new Error(`Unsupported resultType: ${resultType}`);
    return runRegistryAction('list_candidates', { projectId, entityType, entityId });
  });

  registerTool('create_project', {
    title: 'Create Mirage project',
    description: 'Creates a new non-audio Mirage project shell for the authenticated artist. No paid model call runs here; use apply_script/apply_script_markdown afterward to persist scenes, shots, cast, and environments.',
    inputSchema: {
      title: z.string().min(1).max(160),
      workflowKey: workflowKeySchema.optional().describe('Defaults from preset; use scripted_narrative for anime/script projects or music_led for music-video briefs.'),
      presetKey: presetKeySchema.optional().describe('Defaults to the workflow preset. anime_default creates scripted_narrative projects.'),
      seedKind: seedKindSchema.optional().describe('Non-audio seed kind. Audio upload is web-studio only.'),
      directorBrief: z.string().max(8000).optional(),
      scriptText: z.string().max(120000).optional().describe('Optional raw script/treatment seed. This is saved as source material; apply_script persists the production topology.'),
      targetRuntime: z.number().positive().max(7200).optional(),
      targetShotDuration: z.number().positive().max(60).optional(),
    },
  }, async ({ title, workflowKey, presetKey, seedKind, directorBrief, scriptText, targetRuntime, targetShotDuration }) => {
    const created = await studio.createProjectForDirector(auth.userId, {
      title,
      workflowKey,
      presetKey,
      seedKind,
      directorBrief,
      scriptText,
      targetRuntime,
      targetShotDuration,
    });
    return {
      ...created,
      project: await fullProjectForUser(created.projectId, auth.userId),
    };
  });

  registerTool('list_queue', {
    title: 'List legacy music queue',
    description: 'Read-only legacy source-adapter surface. Mirage direct intake does not require a queue.',
    inputSchema: {
      status: z.string().optional().describe('Optional queue status filter, or "all".'),
      query: z.string().min(1).max(120).optional().describe('Optional title/language/note search.'),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ status, query, limit }) => studio.listQueueForDirector(auth.userId, { status, query, limit }));

  registerTool('search_catalog', {
    title: 'Search Mirage catalog',
    description: 'Read-only. Searches artist-owned projects plus any enabled legacy source-adapter catalog.',
    inputSchema: {
      query: z.string().min(1).max(120),
      limit: z.number().int().min(1).max(50).optional(),
    },
  }, async ({ query, limit }) => studio.searchCatalogForDirector(auth.userId, query, { limit }));

  registerTool('resolve_project', {
    title: 'Resolve Mirage project',
    description: 'Read-only. Friendly opener for artist phrases like "open my anime pilot"; resolves project IDs, project titles, and any enabled source-adapter matches into the next legal action.',
    inputSchema: {
      query: z.string().min(1).max(120).describe('Project ID, project title, workflow label, or source-adapter label.'),
    },
  }, async ({ query }) => studio.resolveProjectForDirector(auth.userId, query));

  registerTool('get_project_packet', {
    title: 'Get project packet',
    description: 'Read-only. Returns a compact Codex-oriented packet for one Mirage project.',
    inputSchema: { projectId },
  }, async ({ projectId }) => studio.buildProjectPacket(await fullProjectForUser(projectId, auth.userId)));

  registerTool('get_project_actions', {
    title: 'Get project action list',
    description: 'Read-only. Returns legal next actions for a Mirage project.',
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
      kind: 'mirage.notebook.manifest',
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
      kind: 'mirage.notebook.file',
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
    description: 'Mutating security surface. Issues a short-lived project-scoped token for Mirage CLI sync so notebook file bodies do not travel through chat.',
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
    description: 'Opens a Mirage project for director work and returns packet/actions/events.',
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
        imageModel: idString.optional(),
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
    description: 'Mutating and high blast radius. Parses an edited drafts/script.md Mirage script draft, validates fingerprint/durations, and atomically replaces cast, environments, scenes, and shots.',
    inputSchema: {
      projectId,
      markdown: scriptMarkdownText,
      baseFingerprint: idString.optional(),
      force: z.boolean().optional(),
    },
  }, async ({ projectId, markdown, baseFingerprint, force }) => studio.applyScriptMarkdown(await fullProjectForUser(projectId, auth.userId), markdown, { baseFingerprint, force }));

  registerTool('apply_audio_plan', {
    title: 'Apply audio plan',
    description: 'Mutating. Persists Codex-written per-shot dialogue, sound notes, and dialogue strategy.',
    inputSchema: {
      projectId,
      shots: maxArray(z.object({
        shotId,
        audioPlan: audioPlanSchema,
        baseHash: idString.optional(),
      }), 100).min(1),
      force: z.boolean().optional(),
    },
  }, async ({ projectId, shots, force }) => studio.applyAudioPlan(await fullProjectForUser(projectId, auth.userId), shots, { force }));

  registerTool('apply_audio_plan_markdown', {
    title: 'Apply audio plan markdown',
    description: 'Mutating. Parses drafts/audio-plan.md, validates per-shot hashes, and persists audio plans.',
    inputSchema: {
      projectId,
      markdown: audioPlanMarkdownText,
      force: z.boolean().optional(),
    },
  }, async ({ projectId, markdown, force }) => studio.applyAudioPlanMarkdown(await fullProjectForUser(projectId, auth.userId), markdown, { force }));

  registerTool('apply_cast_voice', {
    title: 'Apply cast voice',
    description: 'Mutating. Persists a character voice assignment for TTS generation.',
    inputSchema: {
      projectId,
      castMemberId: idString,
      voiceProvider: z.literal('elevenlabs'),
      voiceId: idString,
      voiceName: mediumText.optional(),
      baseHash: idString.optional(),
      force: z.boolean().optional(),
    },
  }, async ({ projectId, castMemberId, voiceProvider, voiceId, voiceName, baseHash, force }) => studio.applyCastVoice(await fullProjectForUser(projectId, auth.userId), {
    castMemberId,
    voiceProvider,
    voiceId,
    voiceName,
    baseHash,
  }, { force }));

  const applyGenerateCharacterLooksHandler = async ({ projectId, castMemberIds, note, promptOverride }: {
    projectId: string;
    castMemberIds?: string[];
    note?: string;
    promptOverride?: string;
  }) => studio.generateCharacterLooksForDirector(await fullProjectForUser(projectId, auth.userId), castMemberIds || [], { note, promptOverride });

  const generateCharacterLooksHandler = async ({ projectId, castMemberIds, note }: {
    projectId: string;
    castMemberIds?: string[];
    note?: string;
  }) => studio.generateCharacterLooksForDirector(await fullProjectForUser(projectId, auth.userId), castMemberIds || [], { note });

  registerTool('apply_generate_character_looks', {
    title: 'Generate character looks',
    description: 'Mutating and paid. Generates candidate reusable character reference images. Optional promptOverride is an exact final prompt for one cast member; note softly rewrites the saved prompt before generation.',
    inputSchema: {
      projectId,
      castMemberIds: maxArray(idString, 30).optional(),
      note: mediumText.optional(),
      promptOverride: optionalPromptText,
    },
  }, applyGenerateCharacterLooksHandler);

  registerTool('generate_character_looks', {
    title: 'Generate character looks',
    description: 'Mutating and paid. Generates candidate reusable character reference images using the current saved/global character look prompt state. Use apply_generate_character_looks for exact promptOverride control.',
    inputSchema: {
      projectId,
      castMemberIds: maxArray(idString, 30).optional(),
      note: mediumText.optional(),
    },
  }, generateCharacterLooksHandler);

  const applyGenerateEnvironmentLooksHandler = async ({ projectId, environmentIds, note, promptOverride }: {
    projectId: string;
    environmentIds?: string[];
    note?: string;
    promptOverride?: string;
  }) => studio.generateEnvironmentLooksForDirector(await fullProjectForUser(projectId, auth.userId), environmentIds || [], { note, promptOverride });

  const generateEnvironmentLooksHandler = async ({ projectId, environmentIds, note }: {
    projectId: string;
    environmentIds?: string[];
    note?: string;
  }) => studio.generateEnvironmentLooksForDirector(await fullProjectForUser(projectId, auth.userId), environmentIds || [], { note });

  registerTool('apply_generate_environment_looks', {
    title: 'Generate environment looks',
    description: 'Mutating and paid. Generates candidate reusable environment/reference images. Optional promptOverride is an exact final prompt for one environment; note softly rewrites the saved prompt before generation.',
    inputSchema: {
      projectId,
      environmentIds: maxArray(idString, 30).optional(),
      note: mediumText.optional(),
      promptOverride: optionalPromptText,
    },
  }, applyGenerateEnvironmentLooksHandler);

  registerTool('generate_environment_looks', {
    title: 'Generate environment looks',
    description: 'Mutating and paid. Generates candidate reusable environment/reference images using the current saved/global environment look prompt state. Use apply_generate_environment_looks for exact promptOverride control.',
    inputSchema: {
      projectId,
      environmentIds: maxArray(idString, 30).optional(),
      note: mediumText.optional(),
    },
  }, generateEnvironmentLooksHandler);

  registerTool('apply_cast_reference', {
    title: 'Apply cast reference',
    description: 'Mutating. Sets a cast member reference from an existing project asset, such as the locked style asset. Marks dependent shot prompts stale.',
    inputSchema: {
      projectId,
      castMemberId: idString,
      assetId: idString.optional(),
      useProjectStyleAsset: z.boolean().optional(),
    },
  }, async ({ projectId, castMemberId, assetId, useProjectStyleAsset }) => studio.applyCastReference(await fullProjectForUser(projectId, auth.userId), {
    castMemberId,
    assetId,
    useProjectStyleAsset,
  }));

  registerTool('upload_cast_reference', {
    title: 'Upload cast reference',
    description: 'Mutating. Uploads a local/native image as the locked character reference, creates the project asset, and marks dependent shot prompts stale.',
    inputSchema: {
      projectId,
      castMemberId: idString,
      filename: idString.optional(),
      mimeType: imageMimeType,
      base64: imageBase64Text,
      note: mediumText.optional(),
    },
  }, async ({ projectId, castMemberId, filename, mimeType, base64, note }) => studio.uploadCastReference(await fullProjectForUser(projectId, auth.userId), {
    castMemberId,
    filename,
    mimeType,
    base64,
    note,
  }));

  registerTool('apply_environment_reference', {
    title: 'Apply environment reference',
    description: 'Mutating. Sets an environment reference from an existing project asset, such as the locked style asset. Marks dependent shot prompts stale.',
    inputSchema: {
      projectId,
      environmentId: idString,
      assetId: idString.optional(),
      useProjectStyleAsset: z.boolean().optional(),
    },
  }, async ({ projectId, environmentId, assetId, useProjectStyleAsset }) => studio.applyEnvironmentReference(await fullProjectForUser(projectId, auth.userId), {
    environmentId,
    assetId,
    useProjectStyleAsset,
  }));

  registerTool('upload_environment_reference', {
    title: 'Upload environment reference',
    description: 'Mutating. Uploads a local/native image as the locked environment reference, creates the project asset, and marks dependent shot prompts stale.',
    inputSchema: {
      projectId,
      environmentId: idString,
      filename: idString.optional(),
      mimeType: imageMimeType,
      base64: imageBase64Text,
      note: mediumText.optional(),
    },
  }, async ({ projectId, environmentId, filename, mimeType, base64, note }) => studio.uploadEnvironmentReference(await fullProjectForUser(projectId, auth.userId), {
    environmentId,
    filename,
    mimeType,
    base64,
    note,
  }));

  registerTool('list_reference_candidates', {
    title: 'List reference candidates',
    description: 'Read-only. Lists generated character or environment candidate images for one cast member/environment, including asset IDs and URLs. Use after look generation times out or before locking a reference.',
    inputSchema: {
      projectId,
      entityType: z.enum(['character', 'environment']),
      entityId: idString,
    },
  }, async ({ projectId, entityType, entityId }) => studio.listReferenceCandidates(await fullProjectForUser(projectId, auth.userId), { entityType, entityId }));

  registerTool('list_character_look_candidates', {
    title: 'List character look candidates',
    description: 'Read-only. Lists generated character look candidates for one cast member, including asset IDs and URLs. Use after character look generation times out or before locking a reference.',
    inputSchema: {
      projectId,
      castMemberId: idString,
    },
  }, async ({ projectId, castMemberId }) => studio.listReferenceCandidates(await fullProjectForUser(projectId, auth.userId), { entityType: 'character', entityId: castMemberId }));

  registerTool('list_environment_look_candidates', {
    title: 'List environment look candidates',
    description: 'Read-only. Lists generated environment look candidates for one environment, including asset IDs and URLs. Use after environment look generation times out or before locking a reference.',
    inputSchema: {
      projectId,
      environmentId: idString,
    },
  }, async ({ projectId, environmentId }) => studio.listReferenceCandidates(await fullProjectForUser(projectId, auth.userId), { entityType: 'environment', entityId: environmentId }));

  registerTool('get_audio_plan_cost', {
    title: 'Get audio plan cost',
    description: 'Read-only. Estimates pending TTS character count/cost and missing voices for selected dialogue.',
    inputSchema: {
      projectId,
      shotIds: maxArray(idString, 100).optional(),
      dialogueIds: maxArray(idString, 200).optional(),
      characterIds: maxArray(idString, 100).optional(),
    },
  }, async ({ projectId, shotIds, dialogueIds, characterIds }) => studio.getAudioPlanCost(await fullProjectForUser(projectId, auth.userId), {
    shotIds,
    dialogueIds,
    characterIds,
  }));

  registerTool('generate_dialogue_audio', {
    title: 'Generate dialogue audio',
    description: 'Mutating and paid. Generates ElevenLabs TTS for selected pending/error dialogue lines with assigned voices.',
    inputSchema: {
      projectId,
      shotIds: maxArray(idString, 100).optional(),
      dialogueIds: maxArray(idString, 200).optional(),
      characterIds: maxArray(idString, 100).optional(),
    },
  }, async ({ projectId, shotIds, dialogueIds, characterIds }) => studio.generateDialogueAudio(await fullProjectForUser(projectId, auth.userId), auth.userId, {
    shotIds,
    dialogueIds,
    characterIds,
  }));

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

  const captureIssue = async ({ projectId, severity, summary, suggestedFix, recentToolCalls }: any) => {
    await assertProjectAccess(projectId, auth.userId);
    return captureMirageIssue({ projectId, severity, summary, suggestedFix, recentToolCalls });
  };

  registerTool('mirage_capture_issue', {
    title: 'Capture Mirage director issue',
    description: 'Captures an issue for later engine debugging.',
    inputSchema: {
      projectId,
      severity: z.enum(['low', 'mid', 'high']),
      summary: shortText.min(1),
      suggestedFix: mediumText.optional(),
      recentToolCalls: z.unknown().optional(),
    },
  }, captureIssue);

  registerTool('lahari_capture_issue', {
    title: 'Capture director issue (legacy alias)',
    description: 'Legacy alias for mirage_capture_issue.',
    inputSchema: {
      projectId,
      severity: z.enum(['low', 'mid', 'high']),
      summary: shortText.min(1),
      suggestedFix: mediumText.optional(),
      recentToolCalls: z.unknown().optional(),
    },
  }, captureIssue);

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
      label: 'Mirage MCP request',
    });
  } catch (error) {
    const structured = structuredToolError(error);
    const status = error instanceof RateLimitError ? 429 : 401;
    return res.status(status).json({
      jsonrpc: '2.0',
      error: {
        code: error instanceof RateLimitError ? -32029 : -32001,
        message: structured.message || 'Unauthorized Mirage MCP request',
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
      message: 'Mirage MCP uses Streamable HTTP POST requests.',
    },
    id: null,
  });
});

router.delete('/', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Mirage MCP is stateless; DELETE is not supported.',
    },
    id: null,
  });
});

export { router as mcpRouter };
