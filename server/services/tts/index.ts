import { generateElevenLabsSpeech } from './elevenlabs.js';
import { type ByokProvider, assertByokProvider } from '../byok/resolver.js';

export type TtsProvider = Extract<ByokProvider, 'elevenlabs'>;

export type GenerateSpeechInput = {
  userId: string;
  provider: string;
  voiceId: string;
  text: string;
  deliveryHint?: string;
};

export type GenerateSpeechResult = {
  audioBuffer: Buffer;
  mimeType: string;
  characterCount: number;
};

export const assertTtsProvider = (provider: string): TtsProvider => {
  const byokProvider = assertByokProvider(provider);
  if (byokProvider !== 'elevenlabs') throw new Error(`Unsupported TTS provider: ${provider}`);
  return byokProvider;
};

export const generateSpeech = async (input: GenerateSpeechInput): Promise<GenerateSpeechResult> => {
  const provider = assertTtsProvider(input.provider);
  if (provider === 'elevenlabs') return generateElevenLabsSpeech(input);
  throw new Error(`Unsupported TTS provider: ${provider}`);
};
