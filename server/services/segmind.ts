/**
 * Segmind video generation service — unified provider for all video models.
 * Segmind v2 async API is the Mirage default: submit, poll by provider request
 * id, then ingest the final asset. The old v1 binary response path remains as
 * an env escape hatch for compatibility debugging.
 *
 * Models: Veo 3.1 Fast, Veo 3.1, Seedance 2.0 Fast, Seedance 2.0
 */
import { saveBuffer, storageUrl } from '../storage.js';
import { supportsPlatformColumns } from '../database.js';
import { requireProviderApiKey } from './byok/providerKeys.js';
import { updateGenerationAttempt } from './generationAttempts.js';

const SEGMIND_V1_BASE = 'https://api.segmind.com/v1';
const SEGMIND_V2_BASE = 'https://api.segmind.com/v2';
type SegmindResolution = '480p' | '720p' | '1080p';
type SegmindVideoOptions = {
  endImagePath?: string;
  referenceImagePaths?: string[];
  resolution?: SegmindResolution;
  referenceAudioPaths?: string[];
  generateAudio?: boolean;
  aspectRatio?: '16:9' | '9:16';
  durationSec?: number;
  modelKey?: SegmindModelKey;
  generationAttemptId?: string;
};

type SegmindPreparedRequest = {
  modelKey: SegmindModelKey;
  model: typeof SEGMIND_MODELS[SegmindModelKey];
  body: Record<string, any>;
  durationSec: number;
  resolution: SegmindResolution;
  refUrls: string[];
  refAudioUrls: string[];
};

// ─── Model registry ──────────────────────────────────────────────

export const SEGMIND_MODELS = {
  'veo-3.1-fast': {
    path: 'veo-3.1-fast',
    endpoint: `${SEGMIND_V1_BASE}/veo-3.1-fast`,
    label: 'Veo 3.1 Fast',
    family: 'veo',
    durations: [8],
    costPerSec: 0.10,
    supportsLastFrame: true,
    supportsRefs: true, // reference_images[] only when no start frame is sent
    refsWithFrames: false,
  },
  'veo-3.1': {
    path: 'veo-3.1',
    endpoint: `${SEGMIND_V1_BASE}/veo-3.1`,
    label: 'Veo 3.1',
    family: 'veo',
    durations: [4, 6, 8],
    costPerSec: 0.20,
    supportsLastFrame: true,
    supportsRefs: true, // reference_images[] only when no start frame is sent
    refsWithFrames: false,
  },
  'seedance-2.0-fast': {
    path: 'seedance-2.0-fast',
    endpoint: `${SEGMIND_V1_BASE}/seedance-2.0-fast`,
    label: 'Seedance 2.0 Fast',
    family: 'seedance',
    durations: [4, 5, 6, 8, 10, 12, 15],
    costPerSec: 0.146,
    supportsLastFrame: true,
    supportsRefs: true, // up to 9 reference images
    refsWithFrames: false,
  },
  'seedance-2.0': {
    path: 'seedance-2.0',
    endpoint: `${SEGMIND_V1_BASE}/seedance-2.0`,
    label: 'Seedance 2.0',
    family: 'seedance',
    durations: [4, 5, 6, 8, 10, 12, 15],
    costPerSec: 0.182,
    supportsLastFrame: true,
    supportsRefs: true,
    refsWithFrames: false,
  },
} as const;

export type SegmindModelKey = keyof typeof SEGMIND_MODELS;

/** Smallest valid duration for a given model (or default model). */
export const getModelMinDuration = (modelKey?: string): number => {
  // Default aligned with constants/videoModels.ts first entry — Seedance
  // 2.0 Fast is the storyboard-mode default. Was veo-3.1-fast.
  const model = SEGMIND_MODELS[(modelKey || 'seedance-2.0-fast') as SegmindModelKey];
  if (!model) return 4;
  return Math.min(...model.durations);
};

// ─── Generate Video ──────────────────────────────────────────────

export const generateSegmindVideo = async (
  startImagePath: string | undefined,
  motionPrompt: string,
  opts?: SegmindVideoOptions
): Promise<{ videoPath: string; modelId: string; durationSec: number; providerRequestId?: string | null }> => {
  const prepared = prepareSegmindRequest(startImagePath, motionPrompt, opts);
  const mode = getSegmindVideoApiMode();
  const endpoint = mode === 'v2_async'
    ? `${SEGMIND_V2_BASE}/${prepared.model.path}`
    : prepared.model.endpoint;
  const bodyKeys = Object.keys(prepared.body).sort().join(',');
  const sentRefCount = Array.isArray(prepared.body.reference_images) ? prepared.body.reference_images.length : 0;
  console.log(`[segmind] mode=${mode}, model=${prepared.modelKey}, endpoint=${endpoint}, duration=${prepared.durationSec}s, resolution=${prepared.resolution}, refs=${sentRefCount}/${prepared.refUrls.length}, audioRefs=${prepared.refAudioUrls.length}, generateAudio=${!!opts?.generateAudio}, keys=${bodyKeys}, prompt=${(motionPrompt || '').substring(0, 80)}...`);

  return mode === 'v2_async'
    ? await generateSegmindVideoV2(prepared, opts)
    : await generateSegmindVideoV1(prepared, opts);
};

const prepareSegmindRequest = (
  startImagePath: string | undefined,
  motionPrompt: string,
  opts?: SegmindVideoOptions,
): SegmindPreparedRequest => {
  const modelKey: SegmindModelKey = opts?.modelKey || 'seedance-2.0-fast';
  const model = SEGMIND_MODELS[modelKey];
  if (!model) throw new Error(`Unknown Segmind model: ${modelKey}`);

  const durations = [...model.durations].sort((a, b) => a - b);
  const requested = opts?.durationSec ?? durations[0];
  const durationSec = durations.find(d => d >= requested) ?? durations[durations.length - 1];

  const startUrl = startImagePath ? storageUrl(startImagePath) : undefined;
  const endUrl = opts?.endImagePath ? storageUrl(opts.endImagePath) : undefined;
  const refUrls = (opts?.referenceImagePaths || []).map(p => storageUrl(p));
  const refAudioUrls = (opts?.referenceAudioPaths || []).map(p => storageUrl(p));
  const requestedResolution = opts?.resolution || '720p';
  const resolution = model.family === 'seedance'
    ? (requestedResolution === '480p' ? '480p' : '720p')
    : (requestedResolution === '1080p' ? '1080p' : '720p');

  let body: Record<string, any>;

  if (model.family === 'veo') {
    body = {
      prompt: motionPrompt || 'Cinematic camera movement',
      image: startUrl,
      duration: durationSec,
      resolution,
      aspect_ratio: opts?.aspectRatio || '16:9',
      generate_audio: !!opts?.generateAudio,
      seed: Math.floor(Math.random() * 1000000),
    };
    if (endUrl && model.supportsLastFrame) body.last_frame = endUrl;
    if ((!startUrl || model.refsWithFrames) && refUrls.length && model.supportsRefs) body.reference_images = refUrls;
  } else {
    const useFrameMode = !!startUrl;
    body = {
      prompt: motionPrompt || 'Cinematic camera movement',
      duration: durationSec,
      resolution,
      aspect_ratio: opts?.aspectRatio || '16:9',
      generate_audio: !!opts?.generateAudio,
      seed: Math.floor(Math.random() * 1000000),
    };
    if (useFrameMode) {
      body.first_frame_url = startUrl;
      if (endUrl && model.supportsLastFrame) body.last_frame_url = endUrl;
    }
    if (!useFrameMode && refUrls.length && model.supportsRefs) {
      body.reference_images = refUrls.slice(0, 9);
    }
    if (refAudioUrls.length) {
      body.reference_audios = refAudioUrls.slice(0, 1);
    }
  }

  return { modelKey, model, body, durationSec, resolution, refUrls, refAudioUrls };
};

const getSegmindVideoApiMode = (): 'v1_sync' | 'v2_async' => {
  const explicit = String(process.env.SEGMIND_VIDEO_API_MODE || '').trim().toLowerCase();
  if (explicit === 'v1_sync') return 'v1_sync';
  if (explicit === 'v2_async') return 'v2_async';
  return supportsPlatformColumns() ? 'v2_async' : 'v1_sync';
};

const generateSegmindVideoV1 = async (
  prepared: SegmindPreparedRequest,
  opts?: SegmindVideoOptions,
): Promise<{ videoPath: string; modelId: string; durationSec: number; providerRequestId?: string | null }> => {
  const { modelKey, model, body, durationSec } = prepared;

  const apiKey = await requireProviderApiKey('segmind');
  const requestStartedAt = new Date().toISOString();
  await updateGenerationAttempt(opts?.generationAttemptId, {
    status: 'sent',
    providerRequestStatus: 'sent',
    requestStartedAt,
  });
  let res: Response;
  try {
    res = await fetch(model.endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error: any) {
    await updateGenerationAttempt(opts?.generationAttemptId, {
      status: 'provider_outcome_unknown',
      chargeStatus: 'charge_unknown',
      providerRequestStatus: 'sent_unknown',
      responseReceivedAt: new Date().toISOString(),
      error: error?.message || String(error),
      responseSummary: {
        errorClass: error?.name || 'FetchError',
        message: error?.message || String(error),
      },
    });
    const err = new Error(`Segmind ${modelKey} request outcome unknown: ${error?.message || error}`);
    (err as any).provider = 'segmind';
    (err as any).modelId = modelKey;
    (err as any).chargeStatus = 'charge_unknown';
    (err as any).providerRequestStatus = 'sent_unknown';
    (err as any).estimatedCostUsd = Number((model.costPerSec * durationSec).toFixed(3));
    (err as any).retryWarning = 'The provider request may have reached Segmind before the network/fetch failure. Retrying may spend again.';
    throw err;
  }

  const providerRequestId = extractProviderRequestId(res.headers);
  const responseHeaders = summarizeHeaders(res.headers);
  const responseReceivedAt = new Date().toISOString();

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    await updateGenerationAttempt(opts?.generationAttemptId, {
      status: 'provider_rejected',
      chargeStatus: 'provider_rejected_no_output',
      providerRequestStatus: 'responded_error',
      providerRequestId,
      responseReceivedAt,
      responseSummary: {
        httpStatus: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
        bodyPreview: errText.slice(0, 1000),
      },
      error: errText.slice(0, 500),
    });
    console.error(`[segmind] ${res.status} ${res.statusText}: ${errText.slice(0, 4000)}`);
    console.error(`[segmind] request body: ${JSON.stringify(body).slice(0, 2000)}`);
    const errDetails = (() => {
      try {
        const parsed = JSON.parse(errText);
        return typeof parsed?.error === 'string' ? parsed.error : errText;
      } catch {
        return errText;
      }
    })();
    // Classify errors so the artist sees actionable messages
    const lower = errDetails.toLowerCase();
    let userMessage: string;
    const isCreditsError =
      res.status === 402 ||
      lower.includes('insufficient credit') ||
      lower.includes('out of credits') ||
      lower.includes('not enough credits') ||
      lower.includes('payment required') ||
      (res.status === 403 && lower.includes('billing'));
    if (lower.includes('safety settings') || lower.includes('blocked') || lower.includes('person/face')) {
      userMessage = `Safety filter blocked this image — the AI flagged faces/people in the start frame. Try regenerating the start frame first, or switch to Seedance which has a different safety policy.`;
    } else if (isCreditsError) {
      userMessage = `Segmind credits exhausted — add credits or switch models, then retry.`;
    } else if (res.status === 404 || lower.includes('not_found') || lower.includes('not found')) {
      userMessage = `Model ${modelKey} is temporarily unavailable on Segmind (404). This usually resolves in a few minutes — try again shortly.`;
    } else if (res.status === 429 || lower.includes('rate limit') || lower.includes('quota')) {
      userMessage = `Rate limited — too many requests. Wait a minute and retry.`;
    } else if (lower.includes('mutually exclusive')) {
      userMessage = `Seedance can't use reference images when a start frame is set. Refs are skipped automatically — this shouldn't happen. Report this bug.`;
    } else if (lower.includes('resolution')) {
      userMessage = `${modelKey} rejected the requested resolution. Seedance supports 720p in Lahari; retry after saving the project render settings.`;
    } else if (lower.includes('duration')) {
      userMessage = `${modelKey} rejected the requested duration. Valid Seedance durations are 4, 5, 6, 8, 10, 12, or 15 seconds.`;
    } else {
      userMessage = `${modelKey} failed (${res.status}). ${errDetails.slice(0, 220)}`;
    }
    const err = new Error(userMessage);
    (err as any).segmindStatus = res.status;
    (err as any).segmindRaw = errText.slice(0, 4000);
    (err as any).provider = 'segmind';
    (err as any).modelId = modelKey;
    (err as any).chargeStatus = 'provider_rejected_no_output';
    (err as any).providerRequestStatus = 'responded_error';
    (err as any).providerRequestId = providerRequestId;
    (err as any).estimatedCostUsd = 0;
    (err as any).errorCategory = lower.includes('safety') || lower.includes('blocked')
      ? 'safety'
      : isCreditsError
        ? 'insufficient_credits'
        : res.status === 404
          ? 'model_unavailable'
          : 'unknown';
    throw err;
  }

  // Segmind returns video binary directly
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 1000) {
    // Suspiciously small — might be an error JSON
    const text = buffer.toString('utf-8');
    if (text.startsWith('{')) {
      await updateGenerationAttempt(opts?.generationAttemptId, {
        status: 'provider_rejected',
        chargeStatus: 'provider_rejected_no_output',
        providerRequestStatus: 'responded_json_error',
        providerRequestId,
        responseReceivedAt,
        responseSummary: {
          httpStatus: res.status,
          statusText: res.statusText,
          headers: responseHeaders,
          bodyPreview: text.slice(0, 1000),
        },
        error: text.slice(0, 500),
      });
      console.error(`[segmind] Got JSON instead of video: ${text.slice(0, 500)}`);
      const err = new Error(`Segmind ${modelKey} returned error: ${text.slice(0, 200)}`);
      (err as any).provider = 'segmind';
      (err as any).modelId = modelKey;
      (err as any).chargeStatus = 'provider_rejected_no_output';
      (err as any).providerRequestStatus = 'responded_json_error';
      (err as any).providerRequestId = providerRequestId;
      (err as any).estimatedCostUsd = 0;
      throw err;
    }
  }

  let videoPath: string;
  try {
    videoPath = await saveBuffer(buffer, 'videos', 'mp4');
  } catch (error: any) {
    await updateGenerationAttempt(opts?.generationAttemptId, {
      status: 'ingest_failed',
      chargeStatus: 'provider_completed_ingest_failed',
      providerRequestStatus: 'responded_success',
      providerRequestId,
      responseReceivedAt,
      responseSummary: {
        httpStatus: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
        outputBytes: buffer.length,
      },
      error: error?.message || String(error),
    });
    (error as any).provider = 'segmind';
    (error as any).modelId = modelKey;
    (error as any).chargeStatus = 'provider_completed_ingest_failed';
    (error as any).providerRequestStatus = 'responded_success';
    (error as any).providerRequestId = providerRequestId;
    (error as any).estimatedCostUsd = Number((model.costPerSec * durationSec).toFixed(3));
    (error as any).retryWarning = 'Segmind returned video bytes, but Mirage failed while saving them. Do not regenerate; recover or inspect the failed ingest.';
    throw error;
  }
  await updateGenerationAttempt(opts?.generationAttemptId, {
    status: 'provider_completed',
    chargeStatus: 'provider_completed',
    providerRequestStatus: 'responded_success',
    providerRequestId,
    responseReceivedAt,
    responseSummary: {
      httpStatus: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      outputBytes: buffer.length,
      outputPath: videoPath,
    },
  });
  console.log(`[segmind] Video saved: ${videoPath} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);

  return { videoPath, modelId: modelKey, durationSec, providerRequestId };
};

const generateSegmindVideoV2 = async (
  prepared: SegmindPreparedRequest,
  opts?: SegmindVideoOptions,
): Promise<{ videoPath: string; modelId: string; durationSec: number; providerRequestId?: string | null }> => {
  const { modelKey, model, body, durationSec } = prepared;
  const endpoint = `${SEGMIND_V2_BASE}/${model.path}`;
  const apiKey = await requireProviderApiKey('segmind');
  const requestStartedAt = new Date().toISOString();
  await updateGenerationAttempt(opts?.generationAttemptId, {
    status: 'sent',
    providerRequestStatus: 'sent',
    requestStartedAt,
  });

  let submit: Response;
  try {
    submit = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error: any) {
    await markAsyncOutcomeUnknown(opts?.generationAttemptId, modelKey, durationSec, model.costPerSec, {
      providerRequestStatus: 'submit_unknown',
      error,
      responseSummary: {
        phase: 'submit',
        errorClass: error?.name || 'FetchError',
        message: error?.message || String(error),
      },
    });
  }

  const responseHeaders = summarizeHeaders(submit.headers);
  const responseReceivedAt = new Date().toISOString();
  const submitText = await submit.text().catch(() => '');
  const submitJson = parseMaybeJson(submitText);
  const providerRequestId =
    String(submitJson?.request_id || submitJson?.requestId || '').trim()
    || extractProviderRequestId(submit.headers);
  const pollUrl = String(submitJson?.poll_url || submitJson?.pollUrl || '').trim();
  const responseUrl = String(submitJson?.response_url || submitJson?.responseUrl || '').trim();

  if (!submit.ok) {
    throw await buildSegmindHttpError({
      status: submit.status,
      statusText: submit.statusText,
      headers: responseHeaders,
      bodyText: submitText,
      body,
      modelKey,
      providerRequestId,
      generationAttemptId: opts?.generationAttemptId,
      providerRequestStatus: 'submit_error',
      responseReceivedAt,
    });
  }

  if (!providerRequestId || !pollUrl) {
    await updateGenerationAttempt(opts?.generationAttemptId, {
      status: 'provider_outcome_unknown',
      chargeStatus: 'provider_outcome_unknown',
      providerRequestStatus: 'accepted_missing_poll_contract',
      providerRequestId: providerRequestId || null,
      responseReceivedAt,
      responseSummary: {
        phase: 'submit',
        httpStatus: submit.status,
        headers: responseHeaders,
        bodyKeys: submitJson && typeof submitJson === 'object' ? Object.keys(submitJson).sort() : [],
        bodyPreview: submitText.slice(0, 1000),
      },
      error: 'Segmind async submit succeeded but did not return request_id and poll_url.',
    });
    const err = new Error(`Segmind ${modelKey} async submit did not return a usable request id/poll url.`);
    attachProviderError(err, modelKey, {
      chargeStatus: 'provider_outcome_unknown',
      providerRequestStatus: 'accepted_missing_poll_contract',
      providerRequestId: providerRequestId || null,
      estimatedCostUsd: Number((model.costPerSec * durationSec).toFixed(3)),
      retryWarning: 'Segmind may have accepted the job, but Mirage cannot poll it. Do not retry until the provider request is reconciled.',
    });
    throw err;
  }

  await updateGenerationAttempt(opts?.generationAttemptId, {
    status: 'provider_accepted',
    chargeStatus: 'provider_accepted_pending',
    providerRequestStatus: 'accepted',
    providerRequestId,
    responseReceivedAt,
    responseSummary: {
      phase: 'submit',
      httpStatus: submit.status,
      headers: responseHeaders,
      pollUrl,
      responseUrl: responseUrl || null,
    },
  });

  const poll = await pollSegmindRequest({
    apiKey,
    pollUrl,
    responseUrl: responseUrl || null,
    modelKey,
    durationSec,
    costPerSec: model.costPerSec,
    generationAttemptId: opts?.generationAttemptId,
    providerRequestId,
  });

  const buffer = poll.buffer;
  let videoPath: string;
  try {
    videoPath = await saveBuffer(buffer, 'videos', 'mp4');
  } catch (error: any) {
    await updateGenerationAttempt(opts?.generationAttemptId, {
      status: 'ingest_failed',
      chargeStatus: 'provider_completed_ingest_failed',
      providerRequestStatus: poll.status || 'completed',
      providerRequestId,
      responseReceivedAt: new Date().toISOString(),
      responseSummary: {
        phase: 'ingest',
        pollSummary: poll.summary,
        outputBytes: buffer.length,
      },
      error: error?.message || String(error),
    });
    attachProviderError(error, modelKey, {
      chargeStatus: 'provider_completed_ingest_failed',
      providerRequestStatus: poll.status || 'completed',
      providerRequestId,
      estimatedCostUsd: Number((model.costPerSec * durationSec).toFixed(3)),
      retryWarning: 'Segmind completed the video, but Mirage failed while saving it. Do not regenerate; recover the provider output or inspect failed ingest.',
    });
    throw error;
  }

  await updateGenerationAttempt(opts?.generationAttemptId, {
    status: 'provider_completed',
    chargeStatus: 'provider_completed',
    providerRequestStatus: poll.status || 'completed',
    providerRequestId,
    responseReceivedAt: new Date().toISOString(),
    responseSummary: {
      phase: 'completed',
      pollSummary: poll.summary,
      outputBytes: buffer.length,
      outputPath: videoPath,
    },
  });
  console.log(`[segmind] Async video saved: ${videoPath} (${(buffer.length / 1024 / 1024).toFixed(1)}MB, request=${providerRequestId})`);

  return { videoPath, modelId: modelKey, durationSec, providerRequestId };
};

const summarizeHeaders = (headers: Headers): Record<string, string> => {
  const keep = [
    'content-type',
    'content-length',
    'x-request-id',
    'x-segmind-request-id',
    'x-trace-id',
    'cf-ray',
    'server',
  ];
  const out: Record<string, string> = {};
  for (const key of keep) {
    const value = headers.get(key);
    if (value) out[key] = value.slice(0, 240);
  }
  return out;
};

const extractProviderRequestId = (headers: Headers): string | null => {
  for (const key of ['x-request-id', 'x-segmind-request-id', 'x-trace-id', 'cf-ray']) {
    const value = headers.get(key);
    if (value) return value.slice(0, 240);
  }
  return null;
};

const parseMaybeJson = (text: string): any => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const attachProviderError = (
  err: any,
  modelKey: SegmindModelKey,
  fields: {
    chargeStatus: string;
    providerRequestStatus: string;
    providerRequestId?: string | null;
    estimatedCostUsd: number;
    retryWarning?: string | null;
    segmindStatus?: number;
    segmindRaw?: string;
    errorCategory?: string;
  },
) => {
  err.provider = 'segmind';
  err.modelId = modelKey;
  err.chargeStatus = fields.chargeStatus;
  err.providerRequestStatus = fields.providerRequestStatus;
  err.providerRequestId = fields.providerRequestId || null;
  err.estimatedCostUsd = fields.estimatedCostUsd;
  if (fields.retryWarning) err.retryWarning = fields.retryWarning;
  if (fields.segmindStatus) err.segmindStatus = fields.segmindStatus;
  if (fields.segmindRaw) err.segmindRaw = fields.segmindRaw;
  if (fields.errorCategory) err.errorCategory = fields.errorCategory;
};

const markAsyncOutcomeUnknown = async (
  generationAttemptId: string | undefined,
  modelKey: SegmindModelKey,
  durationSec: number,
  costPerSec: number,
  params: {
    providerRequestStatus: string;
    providerRequestId?: string | null;
    error: any;
    responseSummary: Record<string, any>;
  },
): Promise<never> => {
  await updateGenerationAttempt(generationAttemptId, {
    status: 'provider_outcome_unknown',
    chargeStatus: 'provider_outcome_unknown',
    providerRequestStatus: params.providerRequestStatus,
    providerRequestId: params.providerRequestId || null,
    responseReceivedAt: new Date().toISOString(),
    error: params.error?.message || String(params.error),
    responseSummary: params.responseSummary,
  });
  const err = new Error(`Segmind ${modelKey} request outcome unknown: ${params.error?.message || params.error}`);
  attachProviderError(err, modelKey, {
    chargeStatus: 'provider_outcome_unknown',
    providerRequestStatus: params.providerRequestStatus,
    providerRequestId: params.providerRequestId || null,
    estimatedCostUsd: Number((costPerSec * durationSec).toFixed(3)),
    retryWarning: 'The provider request may have reached Segmind. Do not retry until the provider request is reconciled.',
  });
  throw err;
};

const buildSegmindHttpError = async (params: {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  body: Record<string, any>;
  modelKey: SegmindModelKey;
  providerRequestId?: string | null;
  generationAttemptId?: string;
  providerRequestStatus: string;
  responseReceivedAt: string;
}): Promise<Error> => {
  await updateGenerationAttempt(params.generationAttemptId, {
    status: 'provider_rejected',
    chargeStatus: 'provider_rejected_no_output',
    providerRequestStatus: params.providerRequestStatus,
    providerRequestId: params.providerRequestId || null,
    responseReceivedAt: params.responseReceivedAt,
    responseSummary: {
      httpStatus: params.status,
      statusText: params.statusText,
      headers: params.headers,
      bodyPreview: params.bodyText.slice(0, 1000),
    },
    error: params.bodyText.slice(0, 500),
  });
  console.error(`[segmind] ${params.status} ${params.statusText}: ${params.bodyText.slice(0, 4000)}`);
  console.error(`[segmind] request body: ${JSON.stringify(params.body).slice(0, 2000)}`);
  const errDetails = (() => {
    try {
      const parsed = JSON.parse(params.bodyText);
      return typeof parsed?.error === 'string' ? parsed.error : params.bodyText;
    } catch {
      return params.bodyText;
    }
  })();
  const lower = errDetails.toLowerCase();
  const isCreditsError =
    params.status === 402 ||
    lower.includes('insufficient credit') ||
    lower.includes('out of credits') ||
    lower.includes('not enough credits') ||
    lower.includes('payment required') ||
    (params.status === 403 && lower.includes('billing'));

  let userMessage: string;
  if (lower.includes('safety settings') || lower.includes('blocked') || lower.includes('person/face')) {
    userMessage = `Safety filter blocked this image — the AI flagged faces/people in the start frame. Try regenerating the start frame first, or switch to Seedance which has a different safety policy.`;
  } else if (isCreditsError) {
    userMessage = `Segmind credits exhausted — add credits or switch models, then retry.`;
  } else if (params.status === 404 || lower.includes('not_found') || lower.includes('not found')) {
    userMessage = `Model ${params.modelKey} is temporarily unavailable on Segmind (404). This usually resolves in a few minutes — try again shortly.`;
  } else if (params.status === 429 || lower.includes('rate limit') || lower.includes('quota')) {
    userMessage = `Rate limited — too many requests. Wait a minute and retry.`;
  } else if (lower.includes('mutually exclusive')) {
    userMessage = `Seedance can't use reference images when a start frame is set. Refs are skipped automatically — this shouldn't happen. Report this bug.`;
  } else if (lower.includes('resolution')) {
    userMessage = `${params.modelKey} rejected the requested resolution. Seedance supports 720p in Mirage; retry after saving the project render settings.`;
  } else if (lower.includes('duration')) {
    userMessage = `${params.modelKey} rejected the requested duration. Valid Seedance durations are 4, 5, 6, 8, 10, 12, or 15 seconds.`;
  } else {
    userMessage = `${params.modelKey} failed (${params.status}). ${errDetails.slice(0, 220)}`;
  }

  const err = new Error(userMessage);
  attachProviderError(err, params.modelKey, {
    chargeStatus: 'provider_rejected_no_output',
    providerRequestStatus: params.providerRequestStatus,
    providerRequestId: params.providerRequestId || null,
    estimatedCostUsd: 0,
    segmindStatus: params.status,
    segmindRaw: params.bodyText.slice(0, 4000),
    errorCategory: lower.includes('safety') || lower.includes('blocked')
      ? 'safety'
      : isCreditsError
        ? 'insufficient_credits'
        : params.status === 404
          ? 'model_unavailable'
          : 'unknown',
  });
  return err;
};

const normalizeProviderStatus = (payload: any): string => {
  return String(payload?.status || payload?.state || payload?.request_status || payload?.requestStatus || '').trim().toLowerCase();
};

const isTerminalSuccessStatus = (status: string): boolean => {
  return ['completed', 'complete', 'success', 'succeeded', 'done'].includes(status);
};

const isTerminalFailureStatus = (status: string): boolean => {
  return ['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(status);
};

const findVideoUrl = (value: any, seen = new Set<any>()): string | null => {
  if (!value || seen.has(value)) return null;
  if (typeof value === 'string') {
    if (!/^https?:\/\//i.test(value)) return null;
    const lower = value.toLowerCase();
    if (lower.includes('/requests/') || lower.includes('/request/')) return null;
    if (/\.(mp4|mov|webm)(\?|#|$)/i.test(value) || lower.includes('video')) return value;
    return null;
  }
  if (typeof value !== 'object') return null;
  seen.add(value);

  for (const key of ['video_url', 'videoUrl', 'output_url', 'outputUrl', 'url']) {
    const found = findVideoUrl(value[key], seen);
    if (found) return found;
  }
  for (const key of ['output', 'outputs', 'result', 'results', 'data', 'response']) {
    const found = findVideoUrl(value[key], seen);
    if (found) return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrl(item, seen);
      if (found) return found;
    }
  } else {
    for (const nested of Object.values(value)) {
      const found = findVideoUrl(nested, seen);
      if (found) return found;
    }
  }
  return null;
};

const readResponseAsBufferOrJson = async (res: Response): Promise<{ buffer?: Buffer; json?: any; textPreview?: string }> => {
  const contentType = res.headers.get('content-type') || '';
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (contentType.includes('video/') || buffer.length > 1000 && !buffer.subarray(0, 1).toString('utf8').startsWith('{')) {
    return { buffer };
  }
  const text = buffer.toString('utf8');
  return { json: parseMaybeJson(text), textPreview: text.slice(0, 1000) };
};

const downloadVideoUrl = async (url: string): Promise<Buffer> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download Segmind video output (${res.status} ${res.statusText})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 1000) {
    throw new Error(`Segmind video output download was too small (${buffer.length} bytes)`);
  }
  return buffer;
};

const resolveCompletedSegmindOutput = async (
  payload: any,
  responseUrl: string | null,
  apiKey: string,
): Promise<{ buffer: Buffer; summary: Record<string, any> }> => {
  const directUrl = findVideoUrl(payload);
  if (directUrl) {
    const buffer = await downloadVideoUrl(directUrl);
    return { buffer, summary: { outputSource: 'poll_payload_url', outputUrl: directUrl, pollKeys: Object.keys(payload || {}).sort() } };
  }

  if (responseUrl) {
    const res = await fetch(responseUrl, {
      headers: {
        'x-api-key': apiKey,
      },
    });
    if (!res.ok) {
      throw new Error(`Segmind response_url fetch failed (${res.status} ${res.statusText})`);
    }
    const parsed = await readResponseAsBufferOrJson(res);
    if (parsed.buffer) {
      return { buffer: parsed.buffer, summary: { outputSource: 'response_url_binary', responseUrl } };
    }
    const responseUrlOutput = findVideoUrl(parsed.json);
    if (responseUrlOutput) {
      const buffer = await downloadVideoUrl(responseUrlOutput);
      return {
        buffer,
        summary: {
          outputSource: 'response_url_json_url',
          responseUrl,
          outputUrl: responseUrlOutput,
          responseKeys: Object.keys(parsed.json || {}).sort(),
        },
      };
    }
    throw new Error(`Segmind response_url did not contain a video output. Body: ${parsed.textPreview || JSON.stringify(parsed.json || {}).slice(0, 500)}`);
  }

  throw new Error(`Segmind completed but no video output URL was found in the poll response.`);
};

const pollSegmindRequest = async (params: {
  apiKey: string;
  pollUrl: string;
  responseUrl: string | null;
  modelKey: SegmindModelKey;
  durationSec: number;
  costPerSec: number;
  generationAttemptId?: string;
  providerRequestId: string;
}): Promise<{ buffer: Buffer; status: string; summary: Record<string, any> }> => {
  const started = Date.now();
  const timeoutMs = Number(process.env.SEGMIND_ASYNC_TIMEOUT_MS || 12 * 60 * 1000);
  const intervalMs = Number(process.env.SEGMIND_ASYNC_POLL_INTERVAL_MS || 5000);
  let polls = 0;
  let lastPayload: any = null;

  while (Date.now() - started < timeoutMs) {
    polls += 1;
    let res: Response;
    try {
      res = await fetch(params.pollUrl, {
        headers: {
          'x-api-key': params.apiKey,
        },
      });
    } catch (error: any) {
      await markAsyncOutcomeUnknown(params.generationAttemptId, params.modelKey, params.durationSec, params.costPerSec, {
        providerRequestStatus: 'poll_fetch_failed',
        providerRequestId: params.providerRequestId,
        error,
        responseSummary: {
          phase: 'poll',
          pollUrl: params.pollUrl,
          polls,
          message: error?.message || String(error),
        },
      });
    }

    const text = await res.text().catch(() => '');
    const payload = parseMaybeJson(text) || { raw: text.slice(0, 1000) };
    lastPayload = payload;
    const status = normalizeProviderStatus(payload);

    if (!res.ok && res.status !== 404 && res.status !== 425) {
      await updateGenerationAttempt(params.generationAttemptId, {
        status: 'provider_outcome_unknown',
        chargeStatus: 'provider_outcome_unknown',
        providerRequestStatus: `poll_http_${res.status}`,
        providerRequestId: params.providerRequestId,
        responseSummary: {
          phase: 'poll',
          httpStatus: res.status,
          statusText: res.statusText,
          headers: summarizeHeaders(res.headers),
          bodyPreview: text.slice(0, 1000),
          polls,
        },
        error: text.slice(0, 500),
      });
      const err = new Error(`Segmind ${params.modelKey} poll failed (${res.status}). Provider request ${params.providerRequestId} may still complete.`);
      attachProviderError(err, params.modelKey, {
        chargeStatus: 'provider_outcome_unknown',
        providerRequestStatus: `poll_http_${res.status}`,
        providerRequestId: params.providerRequestId,
        estimatedCostUsd: Number((params.costPerSec * params.durationSec).toFixed(3)),
        retryWarning: 'Segmind accepted this job but Mirage could not poll the result. Do not retry until the provider request is reconciled.',
      });
      throw err;
    }

    if (isTerminalFailureStatus(status)) {
      const message = String(payload?.error || payload?.message || payload?.detail || 'Segmind job failed');
      await updateGenerationAttempt(params.generationAttemptId, {
        status: 'provider_failed',
        chargeStatus: 'provider_failed_no_output',
        providerRequestStatus: status || 'failed',
        providerRequestId: params.providerRequestId,
        responseSummary: {
          phase: 'poll',
          status,
          polls,
          metrics: payload?.metrics || null,
          bodyKeys: Object.keys(payload || {}).sort(),
          bodyPreview: JSON.stringify(payload || {}).slice(0, 1000),
        },
        error: message.slice(0, 500),
      });
      const err = new Error(`Segmind ${params.modelKey} job failed: ${message.slice(0, 220)}`);
      attachProviderError(err, params.modelKey, {
        chargeStatus: 'provider_failed_no_output',
        providerRequestStatus: status || 'failed',
        providerRequestId: params.providerRequestId,
        estimatedCostUsd: 0,
      });
      throw err;
    }

    if (isTerminalSuccessStatus(status)) {
      try {
        const resolved = await resolveCompletedSegmindOutput(payload, params.responseUrl, params.apiKey);
        return {
          buffer: resolved.buffer,
          status,
          summary: {
            ...resolved.summary,
            status,
            polls,
            metrics: payload?.metrics || null,
            pollKeys: Object.keys(payload || {}).sort(),
          },
        };
      } catch (error: any) {
        await updateGenerationAttempt(params.generationAttemptId, {
          status: 'ingest_failed',
          chargeStatus: 'provider_completed_ingest_failed',
          providerRequestStatus: status || 'completed_output_missing',
          providerRequestId: params.providerRequestId,
          responseSummary: {
            phase: 'resolve_output',
            status,
            polls,
            responseUrl: params.responseUrl,
            pollKeys: Object.keys(payload || {}).sort(),
            bodyPreview: JSON.stringify(payload || {}).slice(0, 1000),
          },
          error: error?.message || String(error),
        });
        attachProviderError(error, params.modelKey, {
          chargeStatus: 'provider_completed_ingest_failed',
          providerRequestStatus: status || 'completed_output_missing',
          providerRequestId: params.providerRequestId,
          estimatedCostUsd: Number((params.costPerSec * params.durationSec).toFixed(3)),
          retryWarning: 'Segmind completed this job, but Mirage could not retrieve the output. Do not regenerate; reconcile the provider request/output first.',
        });
        throw error;
      }
    }

    if (polls === 1 || polls % 6 === 0) {
      await updateGenerationAttempt(params.generationAttemptId, {
        status: 'provider_accepted',
        chargeStatus: 'provider_accepted_pending',
        providerRequestStatus: status || 'polling',
        providerRequestId: params.providerRequestId,
        responseSummary: {
          phase: 'poll',
          status: status || null,
          polls,
          elapsedMs: Date.now() - started,
          bodyKeys: Object.keys(payload || {}).sort(),
        },
      });
    }

    await sleep(intervalMs);
  }

  const err = new Error(`Segmind ${params.modelKey} job ${params.providerRequestId} did not finish before Mirage polling timed out.`);
  await markAsyncOutcomeUnknown(params.generationAttemptId, params.modelKey, params.durationSec, params.costPerSec, {
    providerRequestStatus: 'poll_timeout',
    providerRequestId: params.providerRequestId,
    error: err,
    responseSummary: {
      phase: 'poll_timeout',
      polls,
      timeoutMs,
      lastStatus: normalizeProviderStatus(lastPayload),
      lastBodyKeys: Object.keys(lastPayload || {}).sort(),
    },
  });
};
