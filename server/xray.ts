/**
 * X-Ray: AI call logging for full pipeline transparency.
 * Every AI call is recorded with its full context so you can inspect
 * exactly what prompt, references, and rolling context went into each generation.
 */
import { v4 as uuidv4 } from 'uuid';
import db from './db.js';

export interface XRayReference {
  type: 'image' | 'audio' | 'text';
  label: string;
  url?: string;       // storage URL for images/audio
  preview?: string;    // short text preview for text references
}

export interface XRayContext {
  lockedConcept?: string;   // e.g. "Ethereal Dreamscape — Lord Murugan"
  lockedStyle?: string;     // e.g. "Dark Renaissance chiaroscuro"
  lockedCharacters?: string[]; // e.g. ["Murugan: portrait ref locked", "Parvati: portrait ref locked"]
  videoMode?: string;
  additionalNotes?: string;
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
 */
export const logCall = (params: {
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
}): string => {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO ai_calls (id, project_id, stage, model, prompt, reference_inputs, context_chain, response_summary, output_asset_ids, duration_ms, cost_estimate, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.projectId,
    params.stage,
    params.model,
    params.prompt,
    JSON.stringify(params.referenceInputs || []),
    JSON.stringify(params.contextChain || {}),
    params.responseSummary || '',
    JSON.stringify(params.outputAssetIds || []),
    params.durationMs,
    params.costEstimate || 0,
    params.error || null
  );
  return id;
};

/**
 * Get all AI calls for a project, newest first.
 */
export const getCalls = (projectId: string): XRayEntry[] => {
  const rows = db.prepare(
    'SELECT * FROM ai_calls WHERE project_id = ? ORDER BY created_at DESC'
  ).all(projectId) as any[];

  return rows.map(r => ({
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
export const buildContextChain = (projectId: string): XRayContext => {
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return {};

  const concept = project.locked_concept ? JSON.parse(project.locked_concept) : null;
  const cast = db.prepare('SELECT * FROM cast_members WHERE project_id = ?').all(projectId) as any[];
  const hasLockedCast = cast.some((c: any) => c.reference_asset_id);

  // Only include things the user has explicitly locked — not defaults
  return {
    lockedConcept: concept
      ? `${concept.conceptDirection} — ${concept.deity} / ${concept.mood}`
      : undefined,
    lockedStyle: project.status !== 'analyzed' && project.status !== 'concept_locked'
      ? project.style_description || undefined
      : undefined,
    lockedCharacters: hasLockedCast
      ? cast.map((c: any) => `${c.name}: ${c.reference_asset_id ? 'ref locked' : 'NO ref'}`)
      : undefined,
    videoMode: project.status === 'scripted' || project.status === 'in_production' || project.status === 'rendered'
      ? project.video_mode
      : undefined,
  };
};
