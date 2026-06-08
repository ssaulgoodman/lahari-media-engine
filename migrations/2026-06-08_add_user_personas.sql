do $$
begin
  create table if not exists public.studio_personas (
    id text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    slug text not null,
    description text,
    workflow_name text not null default 'yapper',
    project_workflow_key text not null default 'scripted_narrative',
    preset_key text not null default 'anime_default',
    character_reference_asset_id text references public.studio_assets(id) on delete set null,
    style_asset_id text references public.studio_assets(id) on delete set null,
    voice_provider text,
    voice_id text,
    voice_name text,
    tone_notes text,
    topic_lane text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, slug)
  );

  create index if not exists studio_personas_user_updated_idx
    on public.studio_personas(user_id, updated_at desc);

  create index if not exists studio_personas_user_workflow_idx
    on public.studio_personas(user_id, workflow_name);

  alter table public.studio_personas enable row level security;

  drop policy if exists "Artists can read own studio personas" on public.studio_personas;
  create policy "Artists can read own studio personas"
    on public.studio_personas
    for select
    using (user_id = auth.uid());
exception
  when undefined_table then
    null;
end $$;

do $$
begin
  create table if not exists public.lahari_personas (
    id text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    slug text not null,
    description text,
    workflow_name text not null default 'yapper',
    project_workflow_key text not null default 'scripted_narrative',
    preset_key text not null default 'anime_default',
    character_reference_asset_id text references public.lahari_assets(id) on delete set null,
    style_asset_id text references public.lahari_assets(id) on delete set null,
    voice_provider text,
    voice_id text,
    voice_name text,
    tone_notes text,
    topic_lane text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, slug)
  );

  create index if not exists lahari_personas_user_updated_idx
    on public.lahari_personas(user_id, updated_at desc);

  create index if not exists lahari_personas_user_workflow_idx
    on public.lahari_personas(user_id, workflow_name);

  alter table public.lahari_personas enable row level security;

  drop policy if exists "Artists can read own Lahari personas" on public.lahari_personas;
  create policy "Artists can read own Lahari personas"
    on public.lahari_personas
    for select
    using (user_id = auth.uid());
exception
  when undefined_table then
    null;
end $$;
