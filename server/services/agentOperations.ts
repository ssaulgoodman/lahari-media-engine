import { v4 as uuidv4 } from 'uuid';
import { insertRow, selectAll, selectOne, updateRows } from '../database.js';

type AgentOperationSource = 'mcp-remote' | 'director-api' | 'web' | 'system';
type AgentOperationStatus = 'running' | 'success' | 'error';

type OperationScope = {
  scopeType: 'project' | 'scene' | 'shot';
  scopeId: string;
};

type StartAgentOperationInput = {
  projectId?: string | null;
  userId?: string | null;
  source: AgentOperationSource;
  tool: string;
  args?: Record<string, any> | null;
};

const safePayload = (value: unknown) => {
  try {
    return JSON.parse(JSON.stringify(value ?? {}));
  } catch {
    return {};
  }
};

const compactResult = (value: unknown) => {
  const result = safePayload(value) as Record<string, any>;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return {};
  const compact: Record<string, any> = {};
  for (const key of [
    'kind',
    'status',
    'shotId',
    'sceneId',
    'assetId',
    'versionId',
    'storyboardAssetId',
    'storyboardVersionId',
    'videoAssetId',
    'renderId',
    'webUrl',
    'costUsd',
    'estimatedCostUsd',
    'chargeStatus',
    'providerRequestStatus',
    'providerRequestId',
    'provider',
    'model',
    'retryWarning',
  ]) {
    if (result[key] !== undefined) compact[key] = result[key];
  }
  if (result.project && typeof result.project === 'object') {
    compact.project = {
      id: result.project.id,
      title: result.project.title,
      status: result.project.status,
    };
  }
  if (result.summary && typeof result.summary === 'object') compact.summary = result.summary;
  if (result.changedArtifactSummary && typeof result.changedArtifactSummary === 'object') compact.changedArtifactSummary = result.changedArtifactSummary;
  if (Array.isArray(result.changedArtifacts)) compact.changedArtifacts = result.changedArtifacts.map((row: any) => ({
    kind: row?.kind,
    path: row?.path,
    hash: row?.hash,
    size: row?.size,
    mode: row?.mode,
    writePolicy: row?.writePolicy,
    description: row?.description,
  }));
  if (Array.isArray(result.results)) compact.results = result.results.map((row: any) => ({
    shotId: row?.shotId,
    status: row?.status,
    error: row?.error,
    changedArtifactSummary: row?.changedArtifactSummary,
    changedArtifacts: row?.changedArtifacts,
  }));
  if (Array.isArray(result.candidates)) compact.candidates = result.candidates.map((row: any) => ({
    assetId: row?.assetId,
    url: row?.url,
    description: row?.description,
    model: row?.model,
    provider: row?.provider,
    locked: row?.locked,
    createdAt: row?.createdAt,
  }));
  if (Array.isArray(result.assets)) compact.assets = result.assets.map((row: any) => ({
    assetId: row?.assetId || row?.id,
    url: row?.url,
    category: row?.category,
    createdAt: row?.createdAt,
  }));
  for (const key of ['url', 'assetUrl', 'videoUrl', 'storyboardUrl']) {
    if (result[key] !== undefined) compact[key] = result[key];
  }
  return compact;
};

const isMissingTableError = (error: any) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42P01'
    || code === 'PGRST205'
    || message.includes('lahari_agent_operations')
    || message.includes('agent_operations');
};

const labelTool = (tool: string, args: Record<string, any>) => {
  const shot = args.shotId ? ` ${args.shotId}` : '';
  const action = String(args.actionKey || tool).replace(/^job:/, '');
  if (action === 'generate_candidates') return `Generating ${args.entityType === 'environment' || args.entityType === 'env' ? 'environment' : 'character'} candidates`;
  if (action === 'generate_style_candidates') return 'Generating style candidates';
  if (action === 'generate_dialogue_audio') return 'Generating dialogue audio';
  if (action === 'bulk_generate_storyboards') return 'Generating storyboards';
  if (tool.includes('generate_storyboard') || tool.includes('generate.storyboard')) return `Generating storyboard${shot}`;
  if (tool.includes('import_storyboard_image')) return `Importing storyboard${shot}`;
  if (tool.includes('refine_storyboard') || tool.includes('refine.storyboard')) return `Refining storyboard${shot}`;
  if (tool.includes('generate_video') || tool.includes('generate.video')) return `Generating video${shot}`;
  if (tool.includes('storyboard_scene_markdown')) return 'Updating storyboard scene prompts';
  if (tool.includes('apply_storyboard_prompt') || tool.includes('storyboard_prompt')) return `Updating storyboard prompt${shot}`;
  if (action === 'apply_text_edits' || tool.includes('apply_text_edits')) return 'Applying text edits';
  if (action === 'add_shot' || tool.includes('add_shot')) return 'Adding shot';
  if (action === 'delete_shot' || tool.includes('delete_shot')) return 'Deleting shot';
  if (tool.includes('apply_script') || tool.includes('apply.script')) return 'Updating script';
  if (tool.includes('apply_concept') || tool.includes('apply.concept')) return 'Updating concept';
  if (tool.includes('apply_shot_prompts') || tool.includes('shot_prompts')) return 'Updating shot prompts';
  if (tool.includes('project_prompt_override')) return 'Updating project prompt override';
  if (tool.includes('project_preferences')) return 'Updating project preferences';
  if (tool.includes('lock_storyboard') || tool.includes('storyboard.lock')) return `Locking storyboard${shot}`;
  if (tool.includes('unlock_storyboard') || tool.includes('storyboard.unlock')) return `Unlocking storyboard${shot}`;
  return tool.replace(/^director\./, '').replace(/_/g, ' ');
};

const deriveScope = (projectId: string, args: Record<string, any>): OperationScope => {
  if (args.shotId) return { scopeType: 'shot', scopeId: String(args.shotId) };
  if (args.sceneId) return { scopeType: 'scene', scopeId: String(args.sceneId) };
  return { scopeType: 'project', scopeId: projectId };
};

export const startAgentOperation = async (input: StartAgentOperationInput): Promise<string | null> => {
  const projectId = input.projectId || input.args?.projectId;
  if (!projectId) return null;
  const args = safePayload(input.args) as Record<string, any>;
  const scope = deriveScope(String(projectId), args);
  const id = uuidv4();
  try {
    await insertRow('agent_operations', {
      id,
      project_id: String(projectId),
      user_id: input.userId || null,
      source: input.source,
      tool: input.tool,
      status: 'running',
      scope_type: scope.scopeType,
      scope_id: scope.scopeId,
      label: labelTool(input.tool, args),
      payload: args,
    });
    return id;
  } catch (error: any) {
    if (!isMissingTableError(error)) {
      console.warn(`[agent-operations] start failed for ${input.tool}: ${error?.message || error}`);
    }
    return null;
  }
};

export const getAgentOperation = async (id: string) => selectOne('agent_operations', { id });

export const listAgentOperations = async (
  projectId: string,
  opts: { status?: AgentOperationStatus | 'running' | 'success' | 'error'; limit?: number } = {},
) => selectAll(
  'agent_operations',
  { project_id: projectId, ...(opts.status ? { status: opts.status } : {}) },
  { orderBy: 'started_at', ascending: false, limit: Math.min(opts.limit || 20, 100) },
);

export const finishAgentOperation = async (
  id: string | null,
  status: AgentOperationStatus,
  opts: { error?: unknown; result?: unknown } = {},
) => {
  if (!id) return;
  try {
    await updateRows('agent_operations', { id }, {
      status,
      finished_at: new Date().toISOString(),
      error: opts.error instanceof Error ? opts.error.message : opts.error ? String(opts.error) : null,
      result: compactResult(opts.result),
    });
  } catch (error: any) {
    if (!isMissingTableError(error)) {
      console.warn(`[agent-operations] finish failed for ${id}: ${error?.message || error}`);
    }
  }
};
