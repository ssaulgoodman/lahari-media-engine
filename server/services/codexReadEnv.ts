import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const stripEmptyEnvValues = (keys: string[]) => {
  for (const key of keys) {
    if (process.env[key]?.trim() === '') delete process.env[key];
  }
};

const loadFirstExistingEnv = (): string | null => {
  stripEmptyEnvValues([
    'LAHARI_ENV_FILE',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
  ]);

  const candidates = [
    process.env.LAHARI_ENV_FILE,
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', 'lahari-media-engine', '.env'),
    path.join(process.cwd(), '..', '.env'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    dotenv.config({ path: candidate, override: false, quiet: true });
    return candidate;
  }

  return null;
};

const testSupabaseKey = async (url: string, key: string): Promise<boolean> => {
  try {
    const res = await fetch(`${url}/rest/v1/lahari_projects?select=id&limit=1`, {
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
      },
    });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Codex-native tools are read-only by default. Prefer the service key when it
 * works, but fall back to the anon key for local inspection if the checked-in
 * .env service key has gone stale. This must run before importing modules that
 * initialize the shared Supabase client.
 */
export const prepareCodexReadEnv = async (): Promise<{ keyMode: 'service' | 'anon' | 'missing'; warning?: string; envFile?: string }> => {
  const envFile = loadFirstExistingEnv();
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_KEY?.trim();
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();

  if (!url) return { keyMode: 'missing', warning: 'SUPABASE_URL or VITE_SUPABASE_URL is required.', envFile: envFile || undefined };
  if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = url;

  if (serviceKey && await testSupabaseKey(url, serviceKey)) {
    return { keyMode: 'service', envFile: envFile || undefined };
  }

  if (anonKey && await testSupabaseKey(url, anonKey)) {
    process.env.SUPABASE_SERVICE_KEY = anonKey;
    return {
      keyMode: 'anon',
      warning: 'SUPABASE_SERVICE_KEY was rejected, using VITE_SUPABASE_ANON_KEY for read-only Codex tools.',
      envFile: envFile || undefined,
    };
  }

  return {
    keyMode: 'missing',
    warning: 'No valid Supabase key found. Refresh SUPABASE_SERVICE_KEY or VITE_SUPABASE_ANON_KEY.',
    envFile: envFile || undefined,
  };
};

export const prepareCodexWriteEnv = async (): Promise<{ keyMode: 'service' | 'missing'; warning?: string; envFile?: string }> => {
  const envFile = loadFirstExistingEnv();
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_KEY?.trim();

  if (!url) return { keyMode: 'missing', warning: 'SUPABASE_URL or VITE_SUPABASE_URL is required.', envFile: envFile || undefined };
  if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = url;

  if (serviceKey && await testSupabaseKey(url, serviceKey)) {
    return { keyMode: 'service', envFile: envFile || undefined };
  }

  return {
    keyMode: 'missing',
    warning: 'A valid SUPABASE_SERVICE_KEY is required for Lahari write/apply tools. Refusing to fall back to anon key for mutations.',
    envFile: envFile || undefined,
  };
};
