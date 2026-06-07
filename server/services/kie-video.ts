// Kie.ai video provider (alternate to Segmind for Veo/Gemini Omni models).
//
// Kie is a durable-async-job API: submit returns a taskId, you poll record-info
// until successFlag flips. This mirrors the Segmind v2 async path so it plugs
// into the same generation-attempt ledger + charge-risk semantics the doctor
// reads. Segmind stays the stable default; Kie is selected by a `kie-*` model
// key and must pass real smoke tests before becoming a default anywhere.
//
// Veo contract (docs.kie.ai/veo3-api):
//   POST https://api.kie.ai/api/v1/veo/generate    -> { code, data: { taskId } }
//   GET  https://api.kie.ai/api/v1/veo/record-info?taskId=<id>
//        -> { data: { successFlag: 0|1|2|3, response: { resultUrls: string[] } } }
//   successFlag: 0 generating, 1 complete, 2/3 failed. Bearer auth.
//
// Market/Gemini Omni contract (docs.kie.ai/market/gemini-omni-video):
//   POST https://api.kie.ai/api/v1/jobs/createTask -> { code: 200, data: { taskId } }
//   GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=<id>
//        -> { data: { state: waiting|queuing|generating|success|fail, resultJson } }

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
    api: 'veo',
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
    maxImageUrls: 2,
  },
  'kie-veo3-fast': {
    provider: 'kie',
    api: 'veo',
    kieModel: 'veo3_fast',
    label: 'Veo 3 Fast (Kie)',
    family: 'veo',
    durations: [8],
    costPerSec: 0.10,
    aspectRatios: ['16:9', '9:16'] as const,
    supportsLastFrame: true,
    supportsRefs: false,
    refsWithFrames: false,
    maxImageUrls: 2,
  },
  'kie-gemini-omni-video': {
    provider: 'kie',
    api: 'market',
    kieModel: 'gemini-omni-video',
    label: 'Gemini Omni Video (Kie)',
    family: 'gemini_omni',
    durations: [4, 6, 8, 10],
    // Kie pricing: 4s $0.45, 6s $0.60, 8s $0.75, 10s $0.90.
    // This linear estimate intentionally matches 4s and slightly overestimates longer clips.
    costPerSec: 0.1125,
    aspectRatios: ['16:9', '9:16'] as const,
    supportsLastFrame: false,
    supportsRefs: true,
    refsWithFrames: true,
    maxImageUrls: 7,
  },
} as const;

export type KieModelKey = keyof typeof KIE_MODELS;
export const isKieModelKey = (key?: string | null): key is KieModelKey =>
  !!key && Object.prototype.hasOwnProperty.call(KIE_MODELS, key);

export type KieVideoOptions = {
  modelKey?: KieModelKey;
  endImageUrl?: string;
  referenceImageUrls?: string[];
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

const validHttpUrl = (url?: string | null): url is string =>
  typeof url === 'string' && /^https?:\/\//i.test(url);

const resultUrlsFrom = (data: any): string[] => {
  const response = typeof data?.response === 'string' ? parseMaybeJson(data.response) : data?.response;
  const info = typeof data?.info === 'string' ? parseMaybeJson(data.info) : data?.info;
  const resultJson = typeof data?.resultJson === 'string' ? parseMaybeJson(data.resultJson) : data?.resultJson;
  const raw = data?.resultUrls
    ?? data?.result_urls
    ?? data?.videoUrls
    ?? resultJson?.resultUrls
    ?? resultJson?.result_urls
    ?? resultJson?.videoUrls
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

const buildSubmitRequest = (
  modelKey: KieModelKey,
  motionPrompt: string,
  aspectRatio: '16:9' | '9:16',
  durationSec: number,
  startImageUrl?: string,
  opts?: KieVideoOptions,
): { url: string; body: Record<string, any>; imageUrls: string[] } => {
  const model = KIE_MODELS[modelKey];

  if (model.api === 'market') {
    const imageUrls = [
      startImageUrl,
      ...(opts?.referenceImageUrls || []),
    ].filter(validHttpUrl).slice(0, model.maxImageUrls);

    return {
      url: `${KIE_BASE}/jobs/createTask`,
      imageUrls,
      body: {
        model: model.kieModel,
        input: {
          prompt: motionPrompt || 'Cinematic camera movement',
          image_urls: imageUrls,
          audio_ids: [],
          video_list: [],
          duration: String(durationSec),
          aspect_ratio: aspectRatio,
        },
      },
    };
  }

  const imageUrls = [startImageUrl, opts?.endImageUrl]
    .filter(validHttpUrl)
    .slice(0, model.maxImageUrls);

  return {
    url: `${KIE_BASE}/veo/generate`,
    imageUrls,
    body: {
      prompt: motionPrompt,
      model: model.kieModel,
      aspect_ratio: aspectRatio,
      ...(imageUrls.length ? { imageUrls } : {}),
      generationType: imageUrls.length ? 'FIRST_AND_LAST_FRAMES_2_VIDEO' : 'TEXT_2_VIDEO',
    },
  };
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
  const estimatedCostUsd = Number((model.costPerSec * durationSec).toFixed(3));
  const apiKey = await requireProviderApiKey('kie');
  const requestStartedAt = new Date().toISOString();
  const submitRequest = buildSubmitRequest(modelKey, motionPrompt, aspectRatio, durationSec, startImageUrl, opts);

  await updateGenerationAttempt(opts?.generationAttemptId, {
    status: 'sent',
    providerRequestStatus: 'sent',
    requestStartedAt,
  });

  // ── Submit ────────────────────────────────────────────────────────────────
  let submit: Response;
  try {
    submit = await fetch(submitRequest.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(submitRequest.body),
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
    responseSummary: {
      phase: 'submit',
      httpStatus: submit.status,
      taskId,
      api: model.api,
      imageUrlCount: submitRequest.imageUrls.length,
    },
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

    const pollUrl = model.api === 'market'
      ? `${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`
      : `${KIE_BASE}/veo/record-info?taskId=${encodeURIComponent(taskId)}`;
    const poll = await fetch(pollUrl, {
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
    if (model.api === 'veo' && pollBodyCode !== null && pollBodyCode !== 200) {
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

    if (model.api === 'market') {
      const state = String(pollJson?.data?.state || '').toLowerCase();
      if (state === 'success') {
        resultUrls = resultUrlsFrom(pollJson?.data);
        break;
      }
      if (state === 'fail') {
        const providerMessage = pollJson?.data?.failMsg || pollJson?.msg || 'unknown provider error';
        await updateGenerationAttempt(opts?.generationAttemptId, {
          status: 'provider_failed',
          chargeStatus: 'provider_failed_no_output',
          providerRequestStatus: 'failed',
          providerRequestId: taskId,
          responseReceivedAt: new Date().toISOString(),
          responseSummary: {
            phase: 'poll',
            state,
            failCode: pollJson?.data?.failCode || null,
            message: providerMessage,
          },
          error: `Kie market generation failed: ${providerMessage}.`,
        });
        throw attachKieError(new Error(`Kie ${modelKey} generation failed for task ${taskId}: ${providerMessage}`), modelKey, {
          chargeStatus: 'provider_failed_no_output',
          providerRequestStatus: 'failed',
          providerRequestId: taskId,
          estimatedCostUsd: 0,
          errorCategory: 'provider_failed',
        });
      }
      // waiting / queuing / generating / unknown -> keep polling
      continue;
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
  buildSubmitRequest,
  resultUrlsFrom,
};
