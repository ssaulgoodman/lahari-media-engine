// Kie.ai video provider (alternate to Segmind for Veo models).
//
// Kie is a durable-async-job API: submit returns a taskId, you poll record-info
// until successFlag flips. This mirrors the Segmind v2 async path so it plugs
// into the same generation-attempt ledger + charge-risk semantics the doctor
// reads. Segmind stays the stable default; Kie is selected by a `kie-*` model
// key and must pass real smoke tests before becoming a default anywhere.
//
// Contract (docs.kie.ai/veo3-api):
//   POST https://api.kie.ai/api/v1/veo/generate    -> { code, data: { taskId } }
//   GET  https://api.kie.ai/api/v1/veo/record-info?taskId=<id>
//        -> { data: { successFlag: 0|1|2|3, response: { resultUrls: string[] } } }
//   successFlag: 0 generating, 1 complete, 2/3 failed. Bearer auth.

import { saveBuffer } from '../storage.js';
import { requireProviderApiKey } from './byok/providerKeys.js';
import { updateGenerationAttempt } from './generationAttempts.js';

const KIE_BASE = 'https://api.kie.ai/api/v1';
const KIE_POLL_INTERVAL_MS = 12_000;
const KIE_POLL_TIMEOUT_MS = 8 * 60 * 1000;

// ─── Model registry (provider-owned spec) ───────────────────────────────────
// costPerSec is an estimate for dry-run/ledger only — verify against kie.ai
// pricing before treating Kie cost numbers as authoritative.
export const KIE_MODELS = {
  'kie-veo3': {
    provider: 'kie',
    kieModel: 'veo3',
    label: 'Veo 3 (Kie)',
    family: 'veo',
    durations: [8],
    costPerSec: 0.20,
    aspectRatios: ['16:9', '9:16'] as const,
    // Kie imageUrls supports one image, or first+last frame as two images.
    supportsLastFrame: true,
    supportsRefs: false,
    refsWithFrames: false,
  },
  'kie-veo3-fast': {
    provider: 'kie',
    kieModel: 'veo3_fast',
    label: 'Veo 3 Fast (Kie)',
    family: 'veo',
    durations: [8],
    costPerSec: 0.10,
    aspectRatios: ['16:9', '9:16'] as const,
    supportsLastFrame: true,
    supportsRefs: false,
    refsWithFrames: false,
  },
} as const;

export type KieModelKey = keyof typeof KIE_MODELS;
export const isKieModelKey = (key?: string | null): key is KieModelKey =>
  !!key && Object.prototype.hasOwnProperty.call(KIE_MODELS, key);

export type KieVideoOptions = {
  modelKey?: KieModelKey;
  endImageUrl?: string;
  aspectRatio?: '16:9' | '9:16';
  durationSec?: number;
  generationAttemptId?: string;
};

export type KieVideoResult = {
  videoPath: string;
  modelId: string;
  durationSec: number;
  providerRequestId?: string | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseMaybeJson = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const resultUrlsFrom = (data: any): string[] => {
  const response = typeof data?.response === 'string' ? parseMaybeJson(data.response) : data?.response;
  const info = typeof data?.info === 'string' ? parseMaybeJson(data.info) : data?.info;
  const raw = data?.resultUrls
    ?? data?.result_urls
    ?? data?.videoUrls
    ?? response?.resultUrls
    ?? response?.result_urls
    ?? response?.videoUrls
    ?? info?.resultUrls
    ?? info?.result_urls
    ?? info?.videoUrls;
  if (Array.isArray(raw)) return raw.filter((u: any) => typeof u === 'string');
  if (typeof raw === 'string') {
    const parsed = parseMaybeJson(raw);
    if (Array.isArray(parsed)) return parsed.filter((u: any) => typeof u === 'string');
    if (/^https?:\/\//i.test(raw.trim())) return [raw.trim()];
  }
  return [];
};

const attachKieError = (
  err: any,
  modelKey: KieModelKey,
  fields: {
    chargeStatus: string;
    providerRequestStatus: string;
    providerRequestId?: string | null;
    estimatedCostUsd: number;
    retryWarning?: string | null;
    errorCategory?: string;
  },
) => {
  err.provider = 'kie';
  err.modelId = modelKey;
  err.chargeStatus = fields.chargeStatus;
  err.providerRequestStatus = fields.providerRequestStatus;
  err.providerRequestId = fields.providerRequestId || null;
  err.estimatedCostUsd = fields.estimatedCostUsd;
  if (fields.retryWarning) err.retryWarning = fields.retryWarning;
  if (fields.errorCategory) err.errorCategory = fields.errorCategory;
  return err;
};

const downloadToBuffer = async (url: string): Promise<Buffer> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kie result download failed (${res.status} ${res.statusText})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 16) throw new Error(`Kie result download returned suspiciously small media (${buffer.length} bytes)`);
  return buffer;
};

/**
 * Generate a video via Kie. `startImageUrl` must be a publicly fetchable URL
 * (Kie pulls it server-side); production Supabase asset URLs satisfy this.
 */
export const generateKieVideo = async (
  startImageUrl: string | undefined,
  motionPrompt: string,
  opts?: KieVideoOptions,
): Promise<KieVideoResult> => {
  const modelKey: KieModelKey = (opts?.modelKey && isKieModelKey(opts.modelKey)) ? opts.modelKey : 'kie-veo3-fast';
  const model = KIE_MODELS[modelKey];
  const durations = [...model.durations].sort((a, b) => a - b);
  const requestedDuration = opts?.durationSec || durations[0];
  const durationSec = durations.find((d) => d >= requestedDuration) ?? durations[durations.length - 1];
  const aspectRatio = opts?.aspectRatio || '9:16';
  const imageUrls = [startImageUrl, opts?.endImageUrl]
    .filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url));
  const estimatedCostUsd = Number((model.costPerSec * durationSec).toFixed(3));
  const apiKey = await requireProviderApiKey('kie');
  const requestStartedAt = new Date().toISOString();

  await updateGenerationAttempt(opts?.generationAttemptId, {
    status: 'sent',
    providerRequestStatus: 'sent',
    requestStartedAt,
  });

  // ── Submit ────────────────────────────────────────────────────────────────
  let submit: Response;
  try {
    submit = await fetch(`${KIE_BASE}/veo/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: motionPrompt,
        model: model.kieModel,
        aspect_ratio: aspectRatio,
        ...(imageUrls.length ? { imageUrls } : {}),
        generationType: imageUrls.length ? 'FIRST_AND_LAST_FRAMES_2_VIDEO' : 'TEXT_2_VIDEO',
      }),
    });
  } catch (error: any) {
    // Network failure before we know if Kie accepted the job → outcome unknown.
    await updateGenerationAttempt(opts?.generationAttemptId, {
      status: 'provider_outcome_unknown',
      chargeStatus: 'provider_outcome_unknown',
      providerRequestStatus: 'submit_unknown',
      responseReceivedAt: new Date().toISOString(),
      responseSummary: { phase: 'submit', errorClass: error?.name || 'FetchError', message: error?.message || String(error) },
      error: error?.message || String(error),
    });
    throw attachKieError(new Error(`Kie ${modelKey} submit network failure: ${error?.message || error}`), modelKey, {
      chargeStatus: 'provider_outcome_unknown',
      providerRequestStatus: 'submit_unknown',
      estimatedCostUsd,
      retryWarning: 'Kie may have accepted the job before the network dropped. Do not retry until reconciled.',
      errorCategory: 'submit_unknown',
    });
  }

  const responseReceivedAt = new Date().toISOString();
  const submitText = await submit.text().catch(() => '');
  const submitJson = parseMaybeJson(submitText);
  const submitBodyCode = submitJson?.code === undefined ? null : Number(submitJson.code);
  const taskId = String(submitJson?.data?.taskId || submitJson?.data?.task_id || '').trim();

  if (!submit.ok || (submitBodyCode !== null && submitBodyCode !== 200)) {
    await updateGenerationAttempt(opts?.generationAttemptId, {
      status: 'provider_rejected',
      chargeStatus: 'provider_rejected_no_output',
      providerRequestStatus: 'submit_error',
      responseReceivedAt,
      responseSummary: { phase: 'submit', httpStatus: submit.status, code: submitBodyCode, message: submitJson?.msg || null, bodyPreview: submitText.slice(0, 1000) },
      error: `Kie submit rejected (${submitBodyCode ?? submit.status}).`,
    });
    throw attachKieError(new Error(`Kie ${modelKey} submit rejected (${submitBodyCode ?? submit.status} ${submit.statusText}): ${submitText.slice(0, 240)}`), modelKey, {
      chargeStatus: 'provider_rejected_no_output',
      providerRequestStatus: 'submit_error',
      estimatedCostUsd: 0,
      errorCategory: 'submit_error',
    });
  }

  if (!taskId) {
    await updateGenerationAttempt(opts?.generationAttemptId, {
      status: 'provider_outcome_unknown',
      chargeStatus: 'provider_outcome_unknown',
      providerRequestStatus: 'accepted_missing_task_id',
      responseReceivedAt,
      responseSummary: { phase: 'submit', httpStatus: submit.status, bodyPreview: submitText.slice(0, 1000) },
      error: 'Kie submit succeeded but returned no data.taskId.',
    });
    throw attachKieError(new Error(`Kie ${modelKey} submit returned no taskId.`), modelKey, {
      chargeStatus: 'provider_outcome_unknown',
      providerRequestStatus: 'accepted_missing_task_id',
      estimatedCostUsd,
      retryWarning: 'Kie may have accepted the job, but Mirage has no task id to poll. Do not retry until reconciled.',
      errorCategory: 'accepted_missing_task_id',
    });
  }

  await updateGenerationAttempt(opts?.generationAttemptId, {
    status: 'provider_accepted',
    chargeStatus: 'provider_accepted_pending',
    providerRequestStatus: 'accepted',
    providerRequestId: taskId,
    responseReceivedAt,
    responseSummary: { phase: 'submit', httpStatus: submit.status, taskId },
  });

  // ── Poll ──────────────────────────────────────────────────────────────────
  const deadline = Date.now() + KIE_POLL_TIMEOUT_MS;
  let resultUrls: string[] = [];
  while (true) {
    if (Date.now() > deadline) {
      await updateGenerationAttempt(opts?.generationAttemptId, {
        status: 'provider_outcome_unknown',
        chargeStatus: 'provider_outcome_unknown',
        providerRequestStatus: 'poll_timeout',
        providerRequestId: taskId,
        responseReceivedAt: new Date().toISOString(),
        error: 'Kie poll timed out before completion.',
      });
      throw attachKieError(new Error(`Kie ${modelKey} poll timed out for task ${taskId}.`), modelKey, {
        chargeStatus: 'provider_outcome_unknown',
        providerRequestStatus: 'poll_timeout',
        providerRequestId: taskId,
        estimatedCostUsd,
        retryWarning: 'Kie job may still be running. Do not retry until the task is reconciled.',
        errorCategory: 'poll_timeout',
      });
    }
    await sleep(KIE_POLL_INTERVAL_MS);

    const poll = await fetch(`${KIE_BASE}/veo/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => null);
    if (!poll) continue; // transient poll error — keep polling until deadline

    const pollText = await poll.text().catch(() => '');
    const pollJson = parseMaybeJson(pollText);
    if (!poll.ok) {
      if ([400, 401, 404, 422, 451].includes(poll.status)) {
        await updateGenerationAttempt(opts?.generationAttemptId, {
          status: 'provider_failed',
          chargeStatus: 'provider_failed_no_output',
          providerRequestStatus: 'failed',
          providerRequestId: taskId,
          responseReceivedAt: new Date().toISOString(),
          responseSummary: { phase: 'poll', httpStatus: poll.status, message: pollJson?.msg || null, bodyPreview: pollText.slice(0, 1000) },
          error: `Kie poll HTTP ${poll.status}.`,
        });
        throw attachKieError(new Error(`Kie ${modelKey} poll rejected for task ${taskId} (${poll.status} ${poll.statusText}): ${pollText.slice(0, 240)}`), modelKey, {
          chargeStatus: 'provider_failed_no_output',
          providerRequestStatus: 'failed',
          providerRequestId: taskId,
          estimatedCostUsd: 0,
          errorCategory: 'provider_failed',
        });
      }
      continue;
    }
    const pollBodyCode = pollJson?.code === undefined ? null : Number(pollJson.code);
    if (pollBodyCode !== null && pollBodyCode !== 200) {
      await updateGenerationAttempt(opts?.generationAttemptId, {
        status: 'provider_failed',
        chargeStatus: 'provider_failed_no_output',
        providerRequestStatus: 'failed',
        providerRequestId: taskId,
        responseReceivedAt: new Date().toISOString(),
        responseSummary: { phase: 'poll', code: pollBodyCode, message: pollJson?.msg || null },
        error: `Kie poll returned code ${pollBodyCode}.`,
      });
      throw attachKieError(new Error(`Kie ${modelKey} poll failed for task ${taskId}: ${pollJson?.msg || `code ${pollBodyCode}`}`), modelKey, {
        chargeStatus: 'provider_failed_no_output',
        providerRequestStatus: 'failed',
        providerRequestId: taskId,
        estimatedCostUsd: 0,
        errorCategory: 'provider_failed',
      });
    }
    const flag = Number(pollJson?.data?.successFlag ?? pollJson?.data?.success_flag);
    if (flag === 1) {
      resultUrls = resultUrlsFrom(pollJson?.data);
      break;
    }
    if (flag === 2 || flag === 3) {
      await updateGenerationAttempt(opts?.generationAttemptId, {
        status: 'provider_failed',
        chargeStatus: 'provider_failed_no_output',
        providerRequestStatus: 'failed',
        providerRequestId: taskId,
        responseReceivedAt: new Date().toISOString(),
        responseSummary: { phase: 'poll', successFlag: flag, message: pollJson?.data?.errorMessage || pollJson?.msg || null },
        error: `Kie generation failed (successFlag=${flag}).`,
      });
      throw attachKieError(new Error(`Kie ${modelKey} generation failed (successFlag=${flag}) for task ${taskId}.`), modelKey, {
        chargeStatus: 'provider_failed_no_output',
        providerRequestStatus: 'failed',
        providerRequestId: taskId,
        estimatedCostUsd: 0,
        errorCategory: 'provider_failed',
      });
    }
    // flag === 0 (generating) or unknown → keep polling
  }

  if (!resultUrls.length) {
    await updateGenerationAttempt(opts?.generationAttemptId, {
      status: 'provider_outcome_unknown',
      chargeStatus: 'provider_outcome_unknown',
      providerRequestStatus: 'completed_missing_output',
      providerRequestId: taskId,
      responseReceivedAt: new Date().toISOString(),
      error: 'Kie reported success but returned no resultUrls.',
    });
    throw attachKieError(new Error(`Kie ${modelKey} completed but returned no video URL for task ${taskId}.`), modelKey, {
      chargeStatus: 'provider_outcome_unknown',
      providerRequestStatus: 'completed_missing_output',
      providerRequestId: taskId,
      estimatedCostUsd,
      errorCategory: 'completed_missing_output',
    });
  }

  // ── Ingest ────────────────────────────────────────────────────────────────
  let buffer: Buffer;
  let videoPath: string;
  try {
    buffer = await downloadToBuffer(resultUrls[0]);
    videoPath = await saveBuffer(buffer, 'videos', 'mp4');
  } catch (error: any) {
    await updateGenerationAttempt(opts?.generationAttemptId, {
      status: 'ingest_failed',
      chargeStatus: 'provider_completed_ingest_failed',
      providerRequestStatus: 'completed',
      providerRequestId: taskId,
      responseReceivedAt: new Date().toISOString(),
      responseSummary: { phase: 'ingest', outputUrl: resultUrls[0] },
      error: error?.message || String(error),
    });
    throw attachKieError(error, modelKey, {
      chargeStatus: 'provider_completed_ingest_failed',
      providerRequestStatus: 'completed',
      providerRequestId: taskId,
      estimatedCostUsd,
      retryWarning: 'Kie completed the video, but Mirage failed while saving it. Do not regenerate; recover the provider output or inspect failed ingest.',
      errorCategory: 'ingest_failed',
    });
  }

  await updateGenerationAttempt(opts?.generationAttemptId, {
    status: 'provider_completed',
    chargeStatus: 'provider_completed',
    providerRequestStatus: 'completed',
    providerRequestId: taskId,
    responseReceivedAt: new Date().toISOString(),
    responseSummary: { phase: 'completed', outputUrl: resultUrls[0], outputBytes: buffer.length, outputPath: videoPath },
  });
  console.log(`[kie] Async video saved: ${videoPath} (${(buffer.length / 1024 / 1024).toFixed(1)}MB, task=${taskId})`);

  return { videoPath, modelId: modelKey, durationSec, providerRequestId: taskId };
};

export const __kieVideoTest = {
  resultUrlsFrom,
};
