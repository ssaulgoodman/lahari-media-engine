import { getSB, T } from '../../database.js';
import { decryptKey, encryptKey } from './crypto.js';

export const BYOK_PROVIDERS = ['anthropic', 'openai', 'gemini', 'segmind', 'elevenlabs'] as const;
export type ByokProvider = typeof BYOK_PROVIDERS[number];

export type ApiKeySummary = {
  provider: ByokProvider;
  label: string | null;
  isSet: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
};

export class MissingProviderKeyError extends Error {
  provider: ByokProvider;
  setupUrl: string;

  constructor(provider: ByokProvider) {
    super(`Your ${provider} API key is not set.`);
    this.name = 'MissingProviderKeyError';
    this.provider = provider;
    this.setupUrl = '/account/keys';
  }

  toJSON() {
    return {
      code: 'missing_key',
      provider: this.provider,
      setupUrl: this.setupUrl,
      message: this.message,
    };
  }
}

export const isByokProvider = (value: string): value is ByokProvider =>
  (BYOK_PROVIDERS as readonly string[]).includes(value);

export const assertByokProvider = (value: string): ByokProvider => {
  if (isByokProvider(value)) return value;
  throw new Error(`Unsupported provider: ${value}`);
};

export const listTenantApiKeys = async (userId: string): Promise<{ providers: ApiKeySummary[] }> => {
  if (!userId) throw new Error('Auth required');

  const { data, error } = await getSB()
    .from(T.tenant_api_keys)
    .select('provider,key_label,created_at,updated_at,last_used_at,last_error')
    .eq('user_id', userId);
  if (error) throw new Error(`DB select tenant api keys: ${error.message}`);

  const byProvider = new Map((data || []).map((row: any) => [row.provider, row]));
  return {
    providers: BYOK_PROVIDERS.map((provider) => {
      const row: any = byProvider.get(provider);
      return {
        provider,
        label: row?.key_label || null,
        isSet: !!row,
        createdAt: row?.created_at || null,
        updatedAt: row?.updated_at || null,
        lastUsedAt: row?.last_used_at || null,
        lastError: row?.last_error || null,
      };
    }),
  };
};

export const upsertTenantApiKey = async (
  userId: string,
  providerValue: string,
  value: string,
  label?: string | null,
): Promise<ApiKeySummary> => {
  if (!userId) throw new Error('Auth required');
  const provider = assertByokProvider(providerValue);
  const encrypted = encryptKey(value);
  const now = new Date().toISOString();

  const row = {
    user_id: userId,
    provider,
    key_label: label?.trim() || null,
    key_value_encrypted: encrypted,
    updated_at: now,
    last_error: null,
  };

  const { data, error } = await getSB()
    .from(T.tenant_api_keys)
    .upsert(row, { onConflict: 'user_id,provider' })
    .select('provider,key_label,created_at,updated_at,last_used_at,last_error')
    .single();
  if (error) throw new Error(`DB upsert tenant api key: ${error.message}`);

  return {
    provider,
    label: data?.key_label || null,
    isSet: true,
    createdAt: data?.created_at || null,
    updatedAt: data?.updated_at || null,
    lastUsedAt: data?.last_used_at || null,
    lastError: data?.last_error || null,
  };
};

export const deleteTenantApiKey = async (userId: string, providerValue: string) => {
  if (!userId) throw new Error('Auth required');
  const provider = assertByokProvider(providerValue);
  const { error } = await getSB()
    .from(T.tenant_api_keys)
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider);
  if (error) throw new Error(`DB delete tenant api key: ${error.message}`);
  return { provider, isSet: false };
};

export const getTenantApiKey = async (
  userId: string | null | undefined,
  providerValue: string,
): Promise<string | null> => {
  if (!userId) return null;
  const provider = assertByokProvider(providerValue);
  const { data, error } = await getSB()
    .from(T.tenant_api_keys)
    .select('id,key_value_encrypted')
    .eq('user_id', userId)
    .eq('provider', provider)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`DB select tenant api key: ${error.message}`);
  if (!data?.key_value_encrypted) return null;

  const value = decryptKey(data.key_value_encrypted);
  await getSB()
    .from(T.tenant_api_keys)
    .update({ last_used_at: new Date().toISOString(), last_error: null })
    .eq('id', data.id);
  return value;
};

export const requireTenantApiKey = async (userId: string | null | undefined, provider: ByokProvider) => {
  const key = await getTenantApiKey(userId, provider);
  if (!key) throw new MissingProviderKeyError(provider);
  return key;
};
