import { getCurrentUserId } from '../../requestContext.js';
import { requireTenantApiKey, type ByokProvider } from './resolver.js';

const ENV_BY_PROVIDER: Record<ByokProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  segmind: 'SEGMIND_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  kie: 'KIE_API_KEY',
};

export const requireProviderApiKey = async (provider: ByokProvider): Promise<string> => {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error(`Missing request user context for ${provider} API key resolution`);
  }
  return requireTenantApiKey(userId, provider);
};

export const requireSystemProviderApiKey = (provider: ByokProvider): string => {
  const envName = ENV_BY_PROVIDER[provider];
  const envValue = process.env[envName];
  if (envValue) return envValue;
  throw new Error(`${envName} required for system ${provider} provider call`);
};
