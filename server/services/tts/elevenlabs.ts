import { requireTenantApiKey } from '../byok/resolver.js';
import { DEFAULT_ELEVENLABS_TTS_MODEL, normalizeElevenLabsTtsModel } from '../../../constants/ttsModels.js';

export type ElevenLabsSpeechInput = {
  userId: string;
  voiceId: string;
  modelId?: string;
  text: string;
};

export type ElevenLabsSpeechResult = {
  audioBuffer: Buffer;
  mimeType: string;
  characterCount: number;
};

export type ElevenLabsVoiceChangeInput = {
  userId: string;
  voiceId: string;
  modelId?: string;
  audioBuffer: Buffer;
  mimeType?: string;
  filename?: string;
  removeBackgroundNoise?: boolean;
};

export type ElevenLabsVoiceChangeResult = {
  audioBuffer: Buffer;
  mimeType: string;
};

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_ELEVENLABS_STS_MODEL = 'eleven_multilingual_sts_v2';

const buildError = async (res: Response, voiceId: string, label = 'TTS') => {
  const body = await res.text().catch(() => '');
  const lower = body.toLowerCase();
  if (res.status === 404 || lower.includes('voice')) {
    const err = new Error(`ElevenLabs voice not found: ${voiceId}`);
    (err as any).statusCode = 404;
    return err;
  }
  if (res.status === 401 || res.status === 403) {
    const err = new Error('ElevenLabs API key was rejected.');
    (err as any).statusCode = 402;
    return err;
  }
  if (res.status === 429 || lower.includes('quota') || lower.includes('limit')) {
    const err = new Error('ElevenLabs quota or rate limit exceeded.');
    (err as any).statusCode = 429;
    return err;
  }
  const err = new Error(`ElevenLabs ${label} failed (${res.status}): ${body || res.statusText}`);
  (err as any).statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
  return err;
};

export const generateElevenLabsSpeech = async ({
  userId,
  voiceId,
  modelId,
  text,
}: ElevenLabsSpeechInput): Promise<ElevenLabsSpeechResult> => {
  const apiKey = await requireTenantApiKey(userId, 'elevenlabs');
  const cleanText = text.trim();
  if (!voiceId.trim()) throw new Error('ElevenLabs voiceId is required.');
  if (!cleanText) throw new Error('TTS text is required.');

  const res = await fetch(`${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: cleanText,
      model_id: modelId ? normalizeElevenLabsTtsModel(modelId) : DEFAULT_ELEVENLABS_TTS_MODEL,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!res.ok) throw await buildError(res, voiceId);
  const arrayBuffer = await res.arrayBuffer();
  return {
    audioBuffer: Buffer.from(arrayBuffer),
    mimeType: res.headers.get('content-type') || 'audio/mpeg',
    characterCount: cleanText.length,
  };
};

export const changeElevenLabsVoice = async ({
  userId,
  voiceId,
  modelId,
  audioBuffer,
  mimeType = 'audio/mpeg',
  filename = 'source.mp3',
  removeBackgroundNoise = false,
}: ElevenLabsVoiceChangeInput): Promise<ElevenLabsVoiceChangeResult> => {
  const apiKey = await requireTenantApiKey(userId, 'elevenlabs');
  if (!voiceId.trim()) throw new Error('ElevenLabs voiceId is required.');
  if (!audioBuffer.length) throw new Error('Voice changer input audio is empty.');

  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), filename);
  form.append('model_id', modelId || DEFAULT_ELEVENLABS_STS_MODEL);
  if (removeBackgroundNoise) form.append('remove_background_noise', 'true');

  const res = await fetch(`${ELEVENLABS_BASE_URL}/speech-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      Accept: 'audio/mpeg',
    },
    body: form,
  });

  if (!res.ok) throw await buildError(res, voiceId, 'voice changer');
  const arrayBuffer = await res.arrayBuffer();
  return {
    audioBuffer: Buffer.from(arrayBuffer),
    mimeType: res.headers.get('content-type') || 'audio/mpeg',
  };
};
