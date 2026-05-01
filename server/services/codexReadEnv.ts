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
export const prepareCodexReadEnv = async (): Promise<{ keyMode: 'service' | 'anon' | 'missing'; warning?: string }> => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!url) return { keyMode: 'missing', warning: 'SUPABASE_URL or VITE_SUPABASE_URL is required.' };
  if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = url;

  if (serviceKey && await testSupabaseKey(url, serviceKey)) {
    return { keyMode: 'service' };
  }

  if (anonKey && await testSupabaseKey(url, anonKey)) {
    process.env.SUPABASE_SERVICE_KEY = anonKey;
    return {
      keyMode: 'anon',
      warning: 'SUPABASE_SERVICE_KEY was rejected, using VITE_SUPABASE_ANON_KEY for read-only Codex tools.',
    };
  }

  return {
    keyMode: 'missing',
    warning: 'No valid Supabase key found. Refresh SUPABASE_SERVICE_KEY or VITE_SUPABASE_ANON_KEY.',
  };
};

export const prepareCodexWriteEnv = async (): Promise<{ keyMode: 'service' | 'missing'; warning?: string }> => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!url) return { keyMode: 'missing', warning: 'SUPABASE_URL or VITE_SUPABASE_URL is required.' };
  if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = url;

  if (serviceKey && await testSupabaseKey(url, serviceKey)) {
    return { keyMode: 'service' };
  }

  return {
    keyMode: 'missing',
    warning: 'A valid SUPABASE_SERVICE_KEY is required for Lahari write/apply tools. Refusing to fall back to anon key for mutations.',
  };
};
