export const ELEVENLABS_TTS_MODELS = ['eleven_multilingual_v2', 'eleven_v3'] as const;
export type ElevenLabsTtsModel = typeof ELEVENLABS_TTS_MODELS[number];

export const DEFAULT_ELEVENLABS_TTS_MODEL: ElevenLabsTtsModel =
  ELEVENLABS_TTS_MODELS.includes(process.env.ELEVENLABS_MODEL_ID as ElevenLabsTtsModel)
    ? process.env.ELEVENLABS_MODEL_ID as ElevenLabsTtsModel
    : 'eleven_multilingual_v2';

export const normalizeElevenLabsTtsModel = (value?: string | null): ElevenLabsTtsModel => (
  ELEVENLABS_TTS_MODELS.includes(value as ElevenLabsTtsModel)
    ? value as ElevenLabsTtsModel
    : DEFAULT_ELEVENLABS_TTS_MODEL
);
