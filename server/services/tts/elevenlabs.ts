import { requireTenantApiKey } from '../byok/resolver.js';

export type ElevenLabsSpeechInput = {
  userId: string;
  voiceId: string;
  text: string;
};

export type ElevenLabsSpeechResult = {
  audioBuffer: Buffer;
  mimeType: string;
  characterCount: number;
};

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

const buildError = async (res: Response, voiceId: string) => {
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
  const err = new Error(`ElevenLabs TTS failed (${res.status}): ${body || res.statusText}`);
  (err as any).statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
  return err;
};

export const generateElevenLabsSpeech = async ({
  userId,
  voiceId,
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
      model_id: DEFAULT_MODEL_ID,
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
