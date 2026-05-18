-- Mirage BYOK provider keys.
-- Tenant keys are encrypted in the application with MIRAGE_ENCRYPTION_KEY.
-- The database stores ciphertext and metadata only.

create table if not exists studio_tenant_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  key_label text,
  key_value_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_error text,
  constraint studio_tenant_api_keys_provider_check
    check (provider in ('anthropic', 'openai', 'gemini', 'segmind', 'elevenlabs'))
);

create unique index if not exists studio_tenant_api_keys_user_provider_idx
  on studio_tenant_api_keys(user_id, provider);

create index if not exists studio_tenant_api_keys_user_updated_idx
  on studio_tenant_api_keys(user_id, updated_at desc);

alter table studio_tenant_api_keys enable row level security;
