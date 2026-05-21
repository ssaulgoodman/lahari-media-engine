/**
 * X-Ray: AI call logging for full pipeline transparency.
 * Every AI call is recorded with its full context so you can inspect
 * exactly what prompt, references, and rolling context went into each generation.
 */
import { v4 as uuidv4 } from 'uuid';
import { selectAll, selectOne, insertRow } from './database.js';
import { inspectComposedPrompt, type ComposePromptSection } from './prompts/_composer.js';

export interface XRayReference {
  type: 'image' | 'audio' | 'text';
  label: string;
  url?: string;       // storage URL for images/audio
  preview?: string;    // short text preview for text references
}

export interface XRayContext {
  lockedConcept?: string;
  lockedStyle?: string;
  lockedCharacters?: string[];
  additionalNotes?: string;
  recipe?: XRayRecipeTrace;
}

export interface XRayRecipeTrace {
  toolKey?: string;
  presetKey?: string;
  workflowKey?: string;
  sectionLabels: string[];
  sections: ComposePromptSection[];
}

export interface XRayEntry {
  id: string;
  projectId: string;
  stage: string;
  model: string;
  prompt: string;
  referenceInputs: XRayReference[];
  contextChain: XRayContext;
  responseSummary: string;
  outputAssetIds: string[];
  durationMs: number;
  costEstimate: number;
  error?: string;
  createdAt: string;
}

/**
 * Log an AI call. Call this AFTER the AI call completes (or fails).
 * Now async — callers should await but fire-and-forget is also fine
 * for non-critical logging (the route can respond before the log lands).
 */
export const logCall = async (params: {
  projectId: string;
  stage: string;
  model: string;
  prompt: string;
  referenceInputs?: XRayReference[];
  contextChain?: XRayContext;
  responseSummary?: string;
  outputAssetIds?: string[];
  durationMs: number;
  costEstimate?: number;
  error?: string;
  toolKey?: string;
  presetKey?: string;
  workflowKey?: string;
}): Promise<string> => {
  const id = uuidv4();
  const contextChain: XRayContext = { ...(params.contextChain || {}) };
  const recipe = await buildRecipeTrace(params);
  if (recipe) contextChain.recipe = recipe;

  await insertRow('ai_calls', {
    id,
    project_id: params.projectId,
    stage: params.stage,
    model: params.model,
    prompt: params.prompt,
    reference_inputs: JSON.stringify(params.referenceInputs || []),
    context_chain: JSON.stringify(contextChain),
    response_summary: params.responseSummary || '',
    output_asset_ids: JSON.stringify(params.outputAssetIds || []),
    duration_ms: params.durationMs,
    cost_estimate: params.costEstimate || 0,
    error: params.error || null,
  });
  return id;
};

const STAGE_TOOL_KEY: Record<string, string> = {
  'generate-concepts': 'generate-concept',
  'refine-concept': 'refine-concept',
  'generate-script': 'plan-scenes-from-music',
  'parse-script': 'parse-script',
  'parse-script-intake': 'parse-script',
  'refine-script': 'refine-script',
  'brainstorm-styles': 'brainstorm-style',
  'visualize-style': 'visualize-style',
  'refine-style-direction': 'refine-style-direction',
  'write-shot-prompts': 'write-shot-prompts',
  'write-audio-plan': 'write-audio-plan',
  'write-storyboard-prompt': 'write-storyboard-prompt',
  'refine-storyboard-prompt': 'write-storyboard-prompt',
  'generate-dialogue-audio': 'generate-dialogue-audio',
  'generate-shot-start-frame': 'generate-keyframe',
  'generate-shot-video': 'generate-video-from-keyframe',
};

const buildRecipeTrace = async (params: {
  projectId: string;
  stage: string;
  prompt: string;
  toolKey?: string;
  presetKey?: string;
  workflowKey?: string;
}): Promise<XRayRecipeTrace | undefined> => {
  const sections = inspectComposedPrompt(params.prompt);
  if (!sections.length) return undefined;

  let presetKey = params.presetKey;
  let workflowKey = params.workflowKey;
  if (!presetKey || !workflowKey) {
    try {
      const project: any = await selectOne('projects', { id: params.projectId });
      presetKey ||= project?.preset_key;
      workflowKey ||= project?.workflow_key;
    } catch {
      // Recipe metadata should never make logging fail.
    }
  }

  return {
    toolKey: params.toolKey || STAGE_TOOL_KEY[params.stage] || params.stage,
    presetKey,
    workflowKey,
    sectionLabels: sections.map((item) => item.title),
    sections,
  };
};

/**
 * Get all AI calls for a project, newest first.
 */
export const getCalls = async (projectId: string): Promise<XRayEntry[]> => {
  const rows = await selectAll('ai_calls', { project_id: projectId }, { orderBy: 'created_at', ascending: false });

  return rows.map((r: any) => ({
    id: r.id,
    projectId: r.project_id,
    stage: r.stage,
    model: r.model,
    prompt: r.prompt,
    referenceInputs: JSON.parse(r.reference_inputs || '[]'),
    contextChain: JSON.parse(r.context_chain || '{}'),
    responseSummary: r.response_summary,
    outputAssetIds: JSON.parse(r.output_asset_ids || '[]'),
    durationMs: r.duration_ms,
    costEstimate: r.cost_estimate,
    error: r.error,
    createdAt: r.created_at,
  }));
};

/**
 * Build the rolling context summary for a project at its current state.
 * This is what gets passed to the next generation call.
 */
export const buildContextChain = async (projectId: string): Promise<XRayContext> => {
  const project = await selectOne('projects', { id: projectId });
  if (!project) return {};

  const concept = project.locked_concept ? JSON.parse(project.locked_concept) : null;
  const cast = await selectAll('cast_members', { project_id: projectId });
  const hasLockedCast = cast.some((c: any) => c.reference_asset_id);

  // Only include things the user has explicitly locked — not defaults
  return {
    lockedConcept: concept
      ? `${concept.conceptDirection || concept.title || 'Concept'} — ${concept.subject || concept.primarySubject || project.title || 'subject'} / ${concept.mood || 'mood'}`
      : undefined,
    lockedStyle: project.status !== 'analyzed' && project.status !== 'concept_locked'
      ? project.style_description || undefined
      : undefined,
    lockedCharacters: hasLockedCast
      ? cast.map((c: any) => `${c.name}: ${c.reference_asset_id ? 'ref locked' : 'NO ref'}`)
      : undefined,
  };
};
