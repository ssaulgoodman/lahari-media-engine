import { getCurrentUserId } from '../../requestContext.js';
import { requireTenantApiKey, type ByokProvider } from './resolver.js';

const ENV_BY_PROVIDER: Record<ByokProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  segmind: 'SEGMIND_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
};

export const requireProviderApiKey = async (provider: ByokProvider): Promise<string> => {
  const userId = getCurrentUserId();
  if (userId) return requireTenantApiKey(userId, provider);

  // Internal engine jobs and one-off developer scripts may run outside an
  // authenticated request. Mirage user-facing routes always carry userId.
  const envName = ENV_BY_PROVIDER[provider];
  const envValue = process.env[envName];
  if (envValue) return envValue;
  return requireTenantApiKey(null, provider);
};
