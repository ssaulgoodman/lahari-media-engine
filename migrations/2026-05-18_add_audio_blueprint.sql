-- Audio Blueprint v1 foundation for the clean Mirage/studio schema.
-- Apply only to the new platform Supabase project using DB_TABLE_PREFIX=studio.

alter table if exists public.studio_cast_members
  add column if not exists voice_provider text,
  add column if not exists voice_id text,
  add column if not exists voice_name text;

alter table if exists public.studio_cast_members
  drop constraint if exists studio_cast_members_voice_provider_check;

alter table if exists public.studio_cast_members
  add constraint studio_cast_members_voice_provider_check
  check (voice_provider is null or voice_provider in ('elevenlabs'));

alter table if exists public.studio_shots
  add column if not exists audio_plan jsonb,
  add column if not exists audio_plan_stale boolean not null default false;

create table if not exists public.studio_provider_usage_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  day_utc date not null,
  cost_usd numeric(10,4) not null default 0,
  char_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_provider_usage_daily_provider_check
    check (provider in ('anthropic', 'openai', 'gemini', 'segmind', 'elevenlabs')),
  constraint studio_provider_usage_daily_nonnegative_check
    check (cost_usd >= 0 and char_count >= 0)
);

create unique index if not exists studio_provider_usage_daily_user_provider_day_idx
  on public.studio_provider_usage_daily(user_id, provider, day_utc);

create index if not exists studio_provider_usage_daily_user_day_idx
  on public.studio_provider_usage_daily(user_id, day_utc desc);

alter table public.studio_provider_usage_daily enable row level security;
