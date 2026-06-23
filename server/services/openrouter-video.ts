import { saveBuffer, storageUrl } from '../storage.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER_SEEDANCE_FAST = 'bytedance/seedance-2.0-fast';

type OpenRouterResolution = '480p' | '720p' | '1080p';
type OpenRouterAspectRatio = '16:9' | '9:16';

const OPENROUTER_SEEDANCE_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

const getApiKey = () => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not set in environment');
  return key;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const chooseDuration = (requested?: number): number => {
  const target = requested ?? 15;
  return OPENROUTER_SEEDANCE_DURATIONS.find(d => d >= target)
    ?? OPENROUTER_SEEDANCE_DURATIONS[OPENROUTER_SEEDANCE_DURATIONS.length - 1];
};

const authHeaders = () => ({
  Authorization: `Bearer ${getApiKey()}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': process.env.PUBLIC_APP_URL || 'https://lahari-media-engine-production.up.railway.app',
  'X-Title': 'Lahari Media Engine',
});

type OpenRouterVideoJob = {
  id: string;
  polling_url?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired' | string;
  error?: string;
  unsigned_urls?: string[];
  usage?: { cost?: number | null; is_byok?: boolean };
};

const readJsonOrText = async (res: Response) => {
  const text = await res.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const assertOk = async (res: Response, label: string) => {
  if (res.ok) return;
  const body = await readJsonOrText(res);
  const detail = typeof body === 'string' ? body : JSON.stringify(body);
  throw new Error(`${label} failed (${res.status}): ${detail.slice(0, 600)}`);
};

const pollVideoJob = async (jobId: string): Promise<OpenRouterVideoJob> => {
  const deadline = Date.now() + 15 * 60 * 1000;
  let last: OpenRouterVideoJob | null = null;

  while (Date.now() < deadline) {
    const res = await fetch(`${OPENROUTER_BASE}/videos/${jobId}`, {
      method: 'GET',
      headers: authHeaders(),
    });
    await assertOk(res, 'OpenRouter video poll');
    last = await res.json() as OpenRouterVideoJob;

    if (last.status === 'completed') return last;
    if (['failed', 'cancelled', 'expired'].includes(last.status)) {
      throw new Error(`OpenRouter video ${last.status}: ${last.error || 'No provider error returned'}`);
    }
    await sleep(5000);
  }

  throw new Error(`OpenRouter video timed out after 15 minutes${last ? ` (last status: ${last.status})` : ''}`);
};

const downloadVideoBuffer = async (job: OpenRouterVideoJob): Promise<Buffer> => {
  const unsignedUrl = job.unsigned_urls?.[0];
  if (unsignedUrl) {
    const unsignedRes = await fetch(unsignedUrl);
    if (unsignedRes.ok) return Buffer.from(await unsignedRes.arrayBuffer());
  }

  const res = await fetch(`${OPENROUTER_BASE}/videos/${job.id}/content`, {
    method: 'GET',
    headers: authHeaders(),
  });
  await assertOk(res, 'OpenRouter video download');
  return Buffer.from(await res.arrayBuffer());
};

export const generateOpenRouterSeedanceVideo = async (
  startImagePath: string | undefined,
  motionPrompt: string,
  opts?: {
    endImagePath?: string;
    referenceImagePaths?: string[];
    referenceAudioPaths?: string[];
    resolution?: OpenRouterResolution;
    aspectRatio?: OpenRouterAspectRatio;
    durationSec?: number;
  }
): Promise<{ videoPath: string; modelId: string; durationSec: number }> => {
  const durationSec = chooseDuration(opts?.durationSec);
  const resolution = opts?.resolution === '480p' ? '480p' : '720p';
  const aspectRatio = opts?.aspectRatio || '16:9';
  const startUrl = startImagePath ? storageUrl(startImagePath) : undefined;
  const endUrl = opts?.endImagePath ? storageUrl(opts.endImagePath) : undefined;
  const refUrls = (opts?.referenceImagePaths || []).map(p => storageUrl(p));
  const audioUrls = (opts?.referenceAudioPaths || []).map(p => storageUrl(p));

  const frameImages = [
    startUrl ? { type: 'image_url', image_url: { url: startUrl }, frame_type: 'first_frame' } : null,
    endUrl ? { type: 'image_url', image_url: { url: endUrl }, frame_type: 'last_frame' } : null,
  ].filter(Boolean);

  const inputReferences = [
    ...refUrls.slice(0, 9).map(url => ({ type: 'image_url', image_url: { url } })),
    ...audioUrls.slice(0, 1).map(url => ({ type: 'audio_url', audio_url: { url } })),
  ];

  const body: Record<string, any> = {
    model: OPENROUTER_SEEDANCE_FAST,
    prompt: motionPrompt || 'Cinematic camera movement',
    duration: durationSec,
    resolution,
    aspect_ratio: aspectRatio,
    generate_audio: false,
    seed: Math.floor(Math.random() * 1000000),
  };
  if (frameImages.length) body.frame_images = frameImages;
  if (inputReferences.length) body.input_references = inputReferences;

  console.log(`[openrouter-video] model=${OPENROUTER_SEEDANCE_FAST}, duration=${durationSec}s, resolution=${resolution}, frames=${frameImages.length}, refs=${refUrls.length}, audioRefs=${audioUrls.length}, prompt=${(motionPrompt || '').substring(0, 80)}...`);

  const createRes = await fetch(`${OPENROUTER_BASE}/videos`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  await assertOk(createRes, 'OpenRouter video create');
  const created = await createRes.json() as OpenRouterVideoJob;
  const completed = created.status === 'completed' ? created : await pollVideoJob(created.id);
  const buffer = await downloadVideoBuffer(completed);

  if (buffer.length < 1000) {
    const text = buffer.toString('utf-8');
    throw new Error(`OpenRouter returned a suspiciously small video payload: ${text.slice(0, 300)}`);
  }

  const videoPath = await saveBuffer(buffer, 'videos', 'mp4');
  console.log(`[openrouter-video] Video saved: ${videoPath} (${(buffer.length / 1024 / 1024).toFixed(1)}MB, cost=${completed.usage?.cost ?? 'unknown'})`);
  return { videoPath, modelId: 'seedance-2.0-fast-openrouter', durationSec };
};
