import { insertRow, updateRows } from '../database.js';

export type GenerationAttemptStatus =
  | 'prepared'
  | 'sent'
  | 'provider_rejected'
  | 'provider_completed'
  | 'provider_outcome_unknown'
  | 'ingest_failed';

type JsonLike = Record<string, any> | any[];

const isMissingAttemptsTable = (err: any): boolean => {
  const message = String(err?.message || err || '').toLowerCase();
  return message.includes('generation_attempts')
    && (
      message.includes('does not exist')
      || message.includes('could not find')
      || message.includes('schema cache')
      || message.includes('relation')
    );
};

const safeJson = (value: JsonLike | undefined): any => value ?? {};

const warn = (action: string, err: any) => {
  if (isMissingAttemptsTable(err)) return;
  console.warn(`[generation-attempts] ${action} failed: ${err?.message || err}`);
};

export const createGenerationAttempt = async (params: {
  id: string;
  projectId: string;
  shotId?: string | null;
  userId?: string | null;
  stage: string;
  provider: string;
  model: string;
  estimatedCost: number;
  requestSummary?: JsonLike;
}): Promise<void> => {
  try {
    await insertRow('generation_attempts', {
      id: params.id,
      project_id: params.projectId,
      shot_id: params.shotId || null,
      user_id: params.userId || null,
      stage: params.stage,
      provider: params.provider,
      model: params.model,
      estimated_cost: params.estimatedCost,
      status: 'prepared',
      request_summary: safeJson(params.requestSummary),
      updated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    warn('create', err);
  }
};

export const updateGenerationAttempt = async (id: string | undefined, updates: {
  status?: GenerationAttemptStatus;
  chargeStatus?: string | null;
  providerRequestStatus?: string | null;
  providerRequestId?: string | null;
  responseSummary?: JsonLike;
  outputAssetIds?: string[];
  error?: string | null;
  durationMs?: number | null;
  requestStartedAt?: string | null;
  responseReceivedAt?: string | null;
}): Promise<void> => {
  if (!id) return;
  const row: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };
  if (updates.status) row.status = updates.status;
  if (updates.chargeStatus !== undefined) row.charge_status = updates.chargeStatus;
  if (updates.providerRequestStatus !== undefined) row.provider_request_status = updates.providerRequestStatus;
  if (updates.providerRequestId !== undefined) row.provider_request_id = updates.providerRequestId;
  if (updates.responseSummary !== undefined) row.response_summary = safeJson(updates.responseSummary);
  if (updates.outputAssetIds !== undefined) row.output_asset_ids = updates.outputAssetIds;
  if (updates.error !== undefined) row.error = updates.error;
  if (updates.durationMs !== undefined) row.duration_ms = updates.durationMs;
  if (updates.requestStartedAt !== undefined) row.request_started_at = updates.requestStartedAt;
  if (updates.responseReceivedAt !== undefined) row.response_received_at = updates.responseReceivedAt;

  try {
    await updateRows('generation_attempts', { id }, row);
  } catch (err: any) {
    warn('update', err);
  }
};
