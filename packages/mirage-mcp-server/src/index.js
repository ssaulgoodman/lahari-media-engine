#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const DEFAULT_API_URL = 'https://mirage-platform-production-05ca.up.railway.app';
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const promptOverrideKindSchema = z.enum(['concept', 'script', 'shot_prompts', 'storyboard', 'video', 'character_looks', 'environment_looks']);
const modelOverrideSchema = z.object({
  storyboardProvider: z.string().optional(),
  videoModel: z.string().optional(),
}).optional();
const dialogueStrategySchema = z.enum(['lipsync', 'overlay']);
const ttsStatusSchema = z.enum(['pending', 'generating', 'success', 'error']);
const audioPlanSchema = z.object({
  dialogueStrategy: dialogueStrategySchema,
  dialogue: z.array(z.object({
    id: z.string().min(1),
    characterId: z.string().min(1),
    text: z.string().min(1).max(500),
    delivery: z.string().max(200).optional(),
    emotion: z.string().max(100).optional(),
    order: z.number().positive(),
    paceHint: z.enum(['slow', 'natural', 'fast']).optional(),
    targetSec: z.number().positive().max(30).optional(),
    ttsAssetId: z.string().nullable().optional(),
    ttsStatus: ttsStatusSchema.optional(),
    ttsError: z.string().max(500).optional(),
    ttsCharCount: z.number().int().nonnegative().optional(),
    ttsDurationSec: z.number().nonnegative().optional(),
  })).max(100),
  soundNotes: z.string().max(1000).optional(),
});

const textResult = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

class DirectorApiError extends Error {
  constructor(error) {
    super(error?.message || error?.code || 'Mirage director API error');
    this.name = 'DirectorApiError';
    this.error = error || { code: 'director_api_error', message: this.message };
  }
}

const credentialsPath = () => {
  return process.env.MIRAGE_CREDENTIALS_PATH
    || path.join(os.homedir(), '.mirage', 'credentials');
};

const readCredentials = () => {
  const filePath = credentialsPath();
  if (!fs.existsSync(filePath)) {
    throw new DirectorApiError({
      code: 'auth_missing',
      message: `Mirage credentials not found at ${filePath}. Run npx @mirage/setup init or login first.`,
    });
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new DirectorApiError({
      code: 'auth_invalid',
      message: `Could not read Mirage credentials: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
};

const writeCredentials = (credentials) => {
  const filePath = credentialsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // chmod is best-effort on non-POSIX systems.
  }
};

const credentialValue = (credentials, key, envKey) => {
  return credentials?.[key] || process.env[envKey] || null;
};

const refreshCredentials = async (credentials) => {
  const refreshToken = credentials.refresh_token;
  const supabaseUrl = credentialValue(credentials, 'supabase_url', 'MIRAGE_SUPABASE_URL')
    || process.env.VITE_SUPABASE_URL
    || process.env.SUPABASE_URL;
  const anonKey = credentialValue(credentials, 'supabase_anon_key', 'MIRAGE_SUPABASE_ANON_KEY')
    || process.env.VITE_SUPABASE_ANON_KEY
    || process.env.SUPABASE_ANON_KEY;

  if (!refreshToken || !supabaseUrl || !anonKey) {
    throw new DirectorApiError({
      code: 'auth_expired',
      message: 'Mirage token is expired and refresh credentials are incomplete. Run npx @mirage/setup login.',
      details: { hasRefreshToken: !!refreshToken, hasSupabaseUrl: !!supabaseUrl, hasAnonKey: !!anonKey },
    });
  }

  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new DirectorApiError({
      code: 'auth_expired',
      message: json?.error_description || json?.msg || 'Could not refresh Mirage auth token. Run npx @mirage/setup login.',
      details: json || { status: response.status },
    });
  }

  const next = {
    ...credentials,
    access_token: json.access_token,
    refresh_token: json.refresh_token || credentials.refresh_token,
    expires_at: new Date(Date.now() + Number(json.expires_in || 3600) * 1000).toISOString(),
    supabase_url: supabaseUrl,
    supabase_anon_key: anonKey,
  };
  writeCredentials(next);
  return next;
};

const getFreshCredentials = async () => {
  const credentials = readCredentials();
  const expiresAt = credentials.expires_at ? Date.parse(credentials.expires_at) : NaN;
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() <= REFRESH_SKEW_MS) {
    return refreshCredentials(credentials);
  }
  if (!credentials.access_token) {
    throw new DirectorApiError({
      code: 'auth_missing',
      message: 'Mirage credentials are missing access_token. Run npx @mirage/setup login.',
    });
  }
  return credentials;
};

const apiBaseUrl = (credentials) => {
  return (process.env.MIRAGE_API_URL || credentials.api_url || DEFAULT_API_URL).replace(/\/+$/, '');
};

const requestDirector = async (method, route, body) => {
  const credentials = await getFreshCredentials();
  const response = await fetch(`${apiBaseUrl(credentials)}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${credentials.access_token}`,
      'content-type': 'application/json',
      'x-mirage-mcp-version': pkg.version,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const envelope = await response.json().catch(() => null);
  if (!response.ok || envelope?.ok === false) {
    const structuredError = envelope?.error && typeof envelope.error === 'object'
      ? envelope.error
      : {
          code: response.status === 401 ? 'auth_expired' : 'director_api_error',
          message: typeof envelope?.error === 'string' ? envelope.error : `Mirage director API returned HTTP ${response.status}`,
          details: envelope,
        };
    throw new DirectorApiError(structuredError || {
      code: response.status === 401 ? 'auth_expired' : 'director_api_error',
      message: `Mirage director API returned HTTP ${response.status}`,
      details: envelope,
    });
  }
  return envelope?.data ?? envelope;
};

const directorGet = (route) => requestDirector('GET', route);
const directorPost = (route, body) => requestDirector('POST', route, body);

const unsupported = (tool, reason) => async () => {
  throw new DirectorApiError({
    code: 'remote_facade_gap',
    message: `${tool} is not available in the remote Mirage MCP server yet.`,
    details: { tool, reason },
  });
};

const enumStoryboardVariant = z.enum(['adaptive_numbered_storyboard', 'four_panel_clean', 'six_panel_music_video', 'filmstrip_minimal_cuts']);
const projectId = z.string().min(1).describe('Mirage project ID.');
const shotId = z.string().min(1).describe('Shot ID within the project.');

const server = new McpServer({
  name: 'mirage-remote',
  version: pkg.version,
});

const toolAnnotations = (name) => {
  const readOnlyPrefixes = [
    'list_',
    'search_',
    'get_',
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
  if (name === 'add_director_note' || name === 'mirage_capture_issue') {
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

const registerTool = (name, config, handler) => {
  server.registerTool(name, {
    ...config,
    annotations: {
      ...toolAnnotations(name),
      ...config.annotations,
    },
  }, async (args) => {
    try {
      return textResult(await handler(args || {}));
    } catch (error) {
      if (error instanceof DirectorApiError) {
        throw new Error(JSON.stringify(error.error, null, 2));
      }
      throw error;
    }
  });
};

registerTool('list_projects', {
  title: 'List Mirage projects',
  description: 'Read-only. Lists recent Mirage projects for the authenticated artist.',
  inputSchema: { limit: z.number().int().min(1).max(100).optional() },
}, ({ limit }) => directorGet(`/api/director/projects${limit ? `?limit=${encodeURIComponent(limit)}` : ''}`));

registerTool('list_queue', {
  title: 'List Mirage music queue',
  description: 'Read-only legacy source-adapter surface. Mirage direct intake does not require a queue.',
  inputSchema: {
    status: z.string().optional().describe('Optional queue status filter, or "all".'),
    query: z.string().min(1).max(120).optional().describe('Optional title/language/note search.'),
    limit: z.number().int().min(1).max(100).optional(),
  },
}, ({ status, query, limit }) => {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (query) params.set('query', query);
  if (limit) params.set('limit', String(limit));
  return directorGet(`/api/director/queue${params.toString() ? `?${params.toString()}` : ''}`);
});

registerTool('search_catalog', {
  title: 'Search Mirage catalog',
  description: 'Read-only. Searches artist-owned projects plus any enabled legacy source-adapter catalog.',
  inputSchema: {
    query: z.string().min(1).max(120),
    limit: z.number().int().min(1).max(50).optional(),
  },
}, ({ query, limit }) => {
  const params = new URLSearchParams({ query });
  if (limit) params.set('limit', String(limit));
  return directorGet(`/api/director/catalog/search?${params.toString()}`);
});

registerTool('resolve_project', {
  title: 'Resolve Mirage project',
  description: 'Read-only. Friendly opener for artist phrases like "open my anime pilot"; resolves project IDs, project titles, and any enabled source-adapter matches into the next legal action.',
  inputSchema: {
    query: z.string().min(1).max(120).describe('Project ID, project title, workflow label, or source-adapter label.'),
  },
}, ({ query }) => directorGet(`/api/director/resolve?query=${encodeURIComponent(query)}`));

registerTool('get_project_packet', {
  title: 'Get project packet',
  description: 'Read-only. Returns a compact Codex-oriented packet for one Mirage project.',
  inputSchema: { projectId },
}, ({ projectId }) => directorGet(`/api/director/projects/${encodeURIComponent(projectId)}/packet`));

registerTool('get_project_actions', {
  title: 'Get project action list',
  description: 'Read-only. Returns legal next actions for a Mirage project.',
  inputSchema: { projectId },
}, ({ projectId }) => directorGet(`/api/director/projects/${encodeURIComponent(projectId)}/actions`));

registerTool('hydrate_project_workbench', {
  title: 'Hydrate project workbench',
  description: 'Deprecated remote gap. Use write_project_notebook for remote artist workspaces.',
  inputSchema: { projectId, outputDir: z.string().optional() },
}, unsupported('hydrate_project_workbench', 'Use write_project_notebook; it returns deterministic file payloads for the agent to write via harness file tools.'));

registerTool('write_project_notebook', {
  title: 'Write project notebook',
  description: 'Read-only. Returns deterministic local notebook files for this project. The agent should write each returned file path relative to the current workspace.',
  inputSchema: { projectId },
}, ({ projectId }) => directorGet(`/api/director/projects/${encodeURIComponent(projectId)}/notebook`));

registerTool('review_storyboard_prompts', {
  title: 'Review storyboard prompts',
  description: 'Remote gap. Use get_storyboard_status plus get_project_packet for now.',
  inputSchema: { projectId },
}, unsupported('review_storyboard_prompts', 'No hosted /api/director/storyboard-review endpoint exists yet.'));

registerTool('get_storyboard_status', {
  title: 'Get storyboard status',
  description: 'Read-only. Returns shot-by-shot storyboard readiness.',
  inputSchema: { projectId },
}, ({ projectId }) => directorGet(`/api/director/projects/${encodeURIComponent(projectId)}/storyboard-status`));

registerTool('write_storyboard_prompt', {
  title: 'Write storyboard prompt',
  description: 'Deprecated remote gap. Prefer apply_storyboard_prompt with Codex-written content.',
  inputSchema: {
    projectId,
    shotId,
    artistNote: z.string().optional(),
    variant: enumStoryboardVariant.optional(),
    artistReferenceImagePath: z.string().optional(),
  },
}, unsupported('write_storyboard_prompt', 'Deprecated backend-LLM wrapper intentionally not exposed in remote MCP. Use apply_storyboard_prompt.'));

registerTool('bulk_write_storyboard_prompts', {
  title: 'Bulk write storyboard prompts',
  description: 'Deprecated remote gap. Prefer apply_storyboard_scene_markdown with Codex-written scene drafts.',
  inputSchema: {
    projectId,
    shotIds: z.array(z.string().min(1)).optional(),
    force: z.boolean().optional(),
    artistNote: z.string().optional(),
    variant: enumStoryboardVariant.optional(),
    artistReferenceImagePath: z.string().optional(),
  },
}, unsupported('bulk_write_storyboard_prompts', 'Deprecated backend-LLM wrapper intentionally not exposed in remote MCP. Edit drafts/storyboards/<scene>.md and use apply_storyboard_scene_markdown.'));

registerTool('get_shot_packet', {
  title: 'Get shot packet',
  description: 'Read-only. Returns one shot with scene, prompts, assets, and context.',
  inputSchema: { projectId, shotId },
}, ({ projectId, shotId }) => directorGet(`/api/director/projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}/packet`));

registerTool('write_project_artifacts', {
  title: 'Write project review artifacts',
  description: 'Remote gap. Local report/contact-sheet writing is not exposed in remote MCP yet.',
  inputSchema: {
    projectId,
    reportPath: z.string().optional(),
    contactSheetPath: z.string().optional(),
    includeReport: z.boolean().default(true),
    includeContactSheet: z.boolean().default(true),
  },
}, unsupported('write_project_artifacts', 'Requires local artifact rendering in @ssaulgoodman420/mirage-mcp-server.'));

registerTool('write_project_sheets', {
  title: 'Write focused project sheets',
  description: 'Remote gap. Local evidence-sheet writing is not exposed in remote MCP yet.',
  inputSchema: {
    projectId,
    sheetTypes: z.array(z.enum(['overview', 'style', 'references', 'storyboard', 'renders'])).optional(),
    outputDir: z.string().optional(),
  },
}, unsupported('write_project_sheets', 'Requires local artifact rendering in @ssaulgoodman420/mirage-mcp-server.'));

registerTool('attach_director_session', {
  title: 'Attach director session',
  description: 'Remote. Opens a Mirage project for director work and returns packet/actions/events. Local journal writing is deferred to setup workspace support.',
  inputSchema: { projectId, note: z.string().optional(), sinceSeq: z.number().optional() },
}, ({ projectId, note, sinceSeq }) => directorPost('/api/director/session/attach', { projectId, note, sinceSeq }));

registerTool('get_director_session', {
  title: 'Get director session',
  description: 'Remote. Returns current packet/actions/events for a project.',
  inputSchema: { projectId, sinceSeq: z.number().optional() },
}, ({ projectId, sinceSeq }) => {
  const query = sinceSeq == null ? '' : `?sinceSeq=${encodeURIComponent(sinceSeq)}`;
  return directorGet(`/api/director/projects/${encodeURIComponent(projectId)}/session${query}`);
});

registerTool('add_director_note', {
  title: 'Add director journal note',
  description: 'Remote gap. Local journal note writing is not exposed in remote MCP yet.',
  inputSchema: { projectId, note: z.string().min(1) },
}, unsupported('add_director_note', 'Requires local journal writer or hosted director-note event endpoint.'));

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
]) {
  const schema = name === 'preview_rewrite_storyboard_prompt'
    ? { projectId, shotId, note: z.string().optional() }
    : name.startsWith('preview_rewrite_')
      ? { projectId, note: z.string().optional() }
      : { previewJsonPath: z.string().min(1) };
  registerTool(name, {
    title,
    description: 'Remote gap. Legacy local-preview-file workflow is not exposed in the hosted director facade.',
    inputSchema: schema,
  }, unsupported(name, 'R28 apply-only tools replaced this local preview-file path for remote artist workspaces.'));
}

registerTool('plan_generate_storyboard', {
  title: 'Plan storyboard generation',
  description: 'Read-only. Reports prerequisites and cost before generating a storyboard board.',
  inputSchema: { projectId, shotId, modelOverride: modelOverrideSchema },
}, ({ projectId, shotId, modelOverride }) => directorPost('/api/director/preview/generate-storyboard', { projectId, shotId, modelOverride }));

registerTool('plan_generate_video', {
  title: 'Plan video generation',
  description: 'Read-only. Reports prerequisites and cost before generating a shot video.',
  inputSchema: { projectId, shotId, modelOverride: modelOverrideSchema },
}, ({ projectId, shotId, modelOverride }) => directorPost('/api/director/preview/generate-video', { projectId, shotId, modelOverride }));

registerTool('apply_generate_storyboard', {
  title: 'Generate storyboard board',
  description: 'Mutating and paid. Generates a new storyboard board for one shot.',
  inputSchema: { projectId, shotId, artistNote: z.string().optional(), modelOverride: modelOverrideSchema },
}, ({ projectId, shotId, artistNote, modelOverride }) => directorPost('/api/director/generate/storyboard', { projectId, shotId, artistNote, modelOverride }));

registerTool('generate_storyboard', {
  title: 'Generate storyboard board',
  description: 'Alias for apply_generate_storyboard.',
  inputSchema: { projectId, shotId, artistNote: z.string().optional(), modelOverride: modelOverrideSchema },
}, ({ projectId, shotId, artistNote, modelOverride }) => directorPost('/api/director/generate/storyboard', { projectId, shotId, artistNote, modelOverride }));

registerTool('bulk_generate_storyboards', {
  title: 'Bulk generate storyboard boards',
  description: 'Mutating and paid. Generates boards for selected unlocked shots.',
  inputSchema: {
    projectId,
    shotIds: z.array(z.string().min(1)).optional(),
    force: z.boolean().optional(),
    artistNote: z.string().optional(),
    modelOverride: modelOverrideSchema,
  },
}, ({ projectId, shotIds, force, artistNote, modelOverride }) => directorPost('/api/director/generate/storyboards-bulk', { projectId, shotIds, force, artistNote, modelOverride }));

registerTool('refine_storyboard_image', {
  title: 'Refine storyboard image',
  description: 'Mutating and paid. Refines active board/current version from artist feedback.',
  inputSchema: {
    projectId,
    shotId,
    feedback: z.string().min(1),
    previousVersionId: z.string().optional(),
    artistReferenceImagePath: z.string().optional(),
    modelOverride: modelOverrideSchema,
  },
}, ({ projectId, shotId, feedback, previousVersionId, artistReferenceImagePath, modelOverride }) => directorPost('/api/director/refine/storyboard-image', {
  projectId,
  shotId,
  feedback,
  previousVersionId,
  artistReferenceImagePath,
  modelOverride,
}));

registerTool('lock_storyboard', {
  title: 'Lock storyboard board',
  description: 'Mutating. Locks active storyboard board or specific version.',
  inputSchema: { projectId, shotId, versionId: z.string().optional() },
}, ({ projectId, shotId, versionId }) => directorPost('/api/director/storyboard/lock', { projectId, shotId, versionId }));

registerTool('unlock_storyboard', {
  title: 'Unlock storyboard board',
  description: 'Mutating. Unlocks storyboard board for revision.',
  inputSchema: { projectId, shotId },
}, ({ projectId, shotId }) => directorPost('/api/director/storyboard/unlock', { projectId, shotId }));

registerTool('apply_project_preferences', {
  title: 'Apply project preferences',
  description: 'Mutating. Persists Codex-written project model preferences.',
  inputSchema: {
    projectId,
    preferences: z.object({
      textProvider: z.string().optional(),
      storyboardProvider: z.string().optional(),
      videoModel: z.string().optional(),
    }),
    baseHash: z.string().optional(),
  },
}, ({ projectId, preferences, baseHash }) => directorPost('/api/director/apply/project-preferences', { projectId, preferences, baseHash }));

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
}, ({ projectId, shots, force }) => directorPost('/api/director/apply/shot-prompts', { projectId, shots, force }));

registerTool('apply_shot_workflow_modes', {
  title: 'Apply shot workflow modes',
  description: 'Mutating. Persists per-shot workflow mode overrides: auto, storyboard, or keyframe.',
  inputSchema: {
    projectId,
    shots: z.array(z.object({
      shotId: z.string().min(1),
      workflowMode: z.enum(['auto', 'storyboard', 'keyframe']),
      note: z.string().optional(),
    })).min(1),
  },
}, ({ projectId, shots }) => directorPost('/api/director/apply/shot-workflow-modes', { projectId, shots }));

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
}, ({ projectId, shotId, storyboardPrompt, storyboardCutPlan, baseHash, force }) => directorPost('/api/director/apply/storyboard-prompt', {
  projectId,
  shotId,
  storyboardPrompt,
  storyboardCutPlan,
  baseHash,
  force,
}));

registerTool('apply_storyboard_prompts_bulk', {
  title: 'Apply storyboard prompts bulk',
  description: 'Mutating. Persists Codex-written storyboard prompts/cut plans for multiple shots. Prefer apply_storyboard_scene_markdown for artist-facing scene-by-scene writing.',
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
}, ({ projectId, shots, force }) => directorPost('/api/director/apply/storyboard-prompts-bulk', { projectId, shots, force }));

registerTool('apply_storyboard_scene_markdown', {
  title: 'Apply storyboard scene markdown',
  description: 'Mutating. Parses an edited drafts/storyboards/<scene>.md file, validates per-shot hashes, and persists storyboard prompts plus Seedance cut plans scene-by-scene.',
  inputSchema: {
    projectId,
    markdown: z.string().min(1).describe('Full contents of mirage/projects/<projectId>/drafts/storyboards/<scene>.md after scene-level edits.'),
    force: z.boolean().optional(),
  },
}, ({ projectId, markdown, force }) => directorPost('/api/director/apply/storyboard-scene-markdown', { projectId, markdown, force }));

registerTool('apply_concept', {
  title: 'Apply concept',
  description: 'Mutating. Persists a Codex-written locked concept object.',
  inputSchema: {
    projectId,
    concept: z.object({
      title: z.string().min(1),
      direction: z.string().min(1),
      description: z.string().min(1),
      mood: z.string().optional(),
    }),
    baseHash: z.string().optional(),
    force: z.boolean().optional(),
  },
}, ({ projectId, concept, baseHash, force }) => directorPost('/api/director/apply/concept', { projectId, concept, baseHash, force }));

registerTool('apply_style_direction', {
  title: 'Apply style direction',
  description: 'Mutating. Persists Codex-written project style direction text without generating or locking a style image.',
  inputSchema: {
    projectId,
    style: z.object({
      styleDescription: z.string().min(1),
      styleGenerationPrompt: z.string().optional(),
      colorPalette: z.string().optional(),
    }),
    baseHash: z.string().optional(),
    force: z.boolean().optional(),
  },
}, ({ projectId, style, baseHash, force }) => directorPost('/api/director/apply/style-direction', { projectId, style, baseHash, force }));

registerTool('apply_video_prompt', {
  title: 'Apply video prompt',
  description: 'Mutating. Persists a Codex-written keyframe-mode motion prompt.',
  inputSchema: { projectId, shotId, motionPrompt: z.string().min(1), baseHash: z.string().optional(), force: z.boolean().optional() },
}, ({ projectId, shotId, motionPrompt, baseHash, force }) => directorPost('/api/director/apply/video-prompt', { projectId, shotId, motionPrompt, baseHash, force }));

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
}, ({ projectId, script, baseFingerprint, force }) => directorPost('/api/director/apply/script', { projectId, script, baseFingerprint, force }));

registerTool('apply_script_markdown', {
  title: 'Apply script markdown',
  description: 'Mutating and high blast radius. Parses an edited drafts/script.md Mirage script draft, validates fingerprint/durations, and atomically replaces cast, environments, scenes, and shots.',
  inputSchema: {
    projectId,
    markdown: z.string().min(1).describe('Full contents of mirage/projects/<projectId>/drafts/script.md after surgical edits.'),
    baseFingerprint: z.string().optional(),
    force: z.boolean().optional(),
  },
}, ({ projectId, markdown, baseFingerprint, force }) => directorPost('/api/director/apply/script-markdown', { projectId, markdown, baseFingerprint, force }));

registerTool('apply_audio_plan', {
  title: 'Apply audio plan',
  description: 'Mutating. Persists Codex-written per-shot dialogue, sound notes, and dialogue strategy.',
  inputSchema: {
    projectId,
    shots: z.array(z.object({
      shotId,
      audioPlan: audioPlanSchema,
      baseHash: z.string().optional(),
    })).min(1).max(100),
    force: z.boolean().optional(),
  },
}, ({ projectId, shots, force }) => directorPost('/api/director/apply/audio-plan', { projectId, shots, force }));

registerTool('apply_audio_plan_markdown', {
  title: 'Apply audio plan markdown',
  description: 'Mutating. Parses drafts/audio-plan.md, validates per-shot hashes, and persists audio plans.',
  inputSchema: {
    projectId,
    markdown: z.string().min(1),
    force: z.boolean().optional(),
  },
}, ({ projectId, markdown, force }) => directorPost('/api/director/apply/audio-plan-markdown', { projectId, markdown, force }));

registerTool('apply_cast_voice', {
  title: 'Apply cast voice',
  description: 'Mutating. Persists a character voice assignment for TTS generation.',
  inputSchema: {
    projectId,
    castMemberId: z.string().min(1),
    voiceProvider: z.literal('elevenlabs'),
    voiceId: z.string().min(1),
    voiceName: z.string().optional(),
    baseHash: z.string().optional(),
    force: z.boolean().optional(),
  },
}, ({ projectId, castMemberId, voiceProvider, voiceId, voiceName, baseHash, force }) => directorPost('/api/director/apply/cast-voice', {
  projectId,
  castMemberId,
  voiceProvider,
  voiceId,
  voiceName,
  baseHash,
  force,
}));

registerTool('get_audio_plan_cost', {
  title: 'Get audio plan cost',
  description: 'Read-only. Estimates pending TTS character count/cost and missing voices for selected dialogue.',
  inputSchema: {
    projectId,
    shotIds: z.array(z.string().min(1)).max(100).optional(),
    dialogueIds: z.array(z.string().min(1)).max(200).optional(),
    characterIds: z.array(z.string().min(1)).max(100).optional(),
  },
}, ({ projectId, shotIds, dialogueIds, characterIds }) => {
  const qs = new URLSearchParams();
  if (shotIds?.length) qs.set('shotIds', shotIds.join(','));
  if (dialogueIds?.length) qs.set('dialogueIds', dialogueIds.join(','));
  if (characterIds?.length) qs.set('characterIds', characterIds.join(','));
  const suffix = qs.toString();
  return directorGet(`/api/director/projects/${encodeURIComponent(projectId)}/audio-plan-cost${suffix ? `?${suffix}` : ''}`);
});

registerTool('generate_dialogue_audio', {
  title: 'Generate dialogue audio',
  description: 'Mutating and paid. Generates ElevenLabs TTS for selected pending/error dialogue lines with assigned voices.',
  inputSchema: {
    projectId,
    shotIds: z.array(z.string().min(1)).max(100).optional(),
    dialogueIds: z.array(z.string().min(1)).max(200).optional(),
    characterIds: z.array(z.string().min(1)).max(100).optional(),
  },
}, ({ projectId, shotIds, dialogueIds, characterIds }) => directorPost('/api/director/generate/dialogue-audio', {
  projectId,
  shotIds,
  dialogueIds,
  characterIds,
}));

registerTool('apply_project_prompt_override', {
  title: 'Apply project prompt override',
  description: 'Mutating. Persists a Codex-written project-level prompt recipe.',
  inputSchema: { projectId, kind: promptOverrideKindSchema, body: z.string().min(1), baseHash: z.string().optional() },
}, ({ projectId, kind, body, baseHash }) => directorPost('/api/director/apply/project-prompt-override', { projectId, kind, body, baseHash }));

registerTool('revert_project_prompt_override', {
  title: 'Revert project prompt override',
  description: 'Mutating. Reverts active project prompt recipe.',
  inputSchema: { projectId, kind: promptOverrideKindSchema, baseHash: z.string().optional() },
}, ({ projectId, kind, baseHash }) => directorPost('/api/director/rollback/project-prompt-override', { projectId, kind, baseHash }));

registerTool('apply_generate_video', {
  title: 'Generate shot video',
  description: 'Mutating and paid. Generates a new video for one shot.',
  inputSchema: { projectId, shotId, promptOverride: z.string().optional(), modelOverride: modelOverrideSchema },
}, ({ projectId, shotId, promptOverride, modelOverride }) => directorPost('/api/director/generate/video', { projectId, shotId, promptOverride, modelOverride }));

registerTool('mirage_capture_issue', {
  title: 'Capture Mirage director issue',
  description: 'Captures an issue for later engine debugging.',
  inputSchema: {
    projectId: z.string().optional(),
    severity: z.enum(['low', 'mid', 'high']),
    summary: z.string().min(1),
    suggestedFix: z.string().optional(),
    recentToolCalls: z.unknown().optional(),
  },
}, ({ projectId, severity, summary, suggestedFix, recentToolCalls }) => directorPost('/api/director/issues/capture', {
  projectId,
  severity,
  summary,
  suggestedFix,
  recentToolCalls,
}));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Mirage remote MCP server ${pkg.version} running on stdio`);
}

main().catch((error) => {
  if (error instanceof DirectorApiError) {
    console.error(JSON.stringify(error.error, null, 2));
  } else {
    console.error(error);
  }
  process.exit(1);
});
