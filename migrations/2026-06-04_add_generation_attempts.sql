do $$
begin
  create table if not exists public.studio_generation_attempts (
    id text primary key,
    project_id text references public.studio_projects(id) on delete cascade,
    shot_id text,
    user_id uuid references auth.users(id) on delete set null,
    stage text not null default 'generate-shot-video',
    provider text not null,
    model text not null,
    estimated_cost float4 not null default 0,
    status text not null,
    charge_status text,
    provider_request_status text,
    provider_request_id text,
    request_started_at timestamptz,
    response_received_at timestamptz,
    duration_ms int4,
    request_summary jsonb not null default '{}'::jsonb,
    response_summary jsonb not null default '{}'::jsonb,
    output_asset_ids jsonb not null default '[]'::jsonb,
    error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create index if not exists studio_generation_attempts_project_created_idx
    on public.studio_generation_attempts(project_id, created_at desc);

  create index if not exists studio_generation_attempts_shot_created_idx
    on public.studio_generation_attempts(shot_id, created_at desc);

  create index if not exists studio_generation_attempts_status_created_idx
    on public.studio_generation_attempts(status, created_at desc);

  alter table public.studio_generation_attempts enable row level security;

  drop policy if exists "Artists can read own studio generation attempts" on public.studio_generation_attempts;
  create policy "Artists can read own studio generation attempts"
    on public.studio_generation_attempts
    for select
    using (
      exists (
        select 1 from public.studio_projects p
        where p.id = studio_generation_attempts.project_id
          and p.user_id = auth.uid()
      )
    );

  begin
    alter publication supabase_realtime add table public.studio_generation_attempts;
  exception when duplicate_object then
    null;
  end;
exception
  when undefined_table then
    null;
end $$;

do $$
begin
  create table if not exists public.lahari_generation_attempts (
    id text primary key,
    project_id text references public.lahari_projects(id) on delete cascade,
    shot_id text,
    user_id uuid references auth.users(id) on delete set null,
    stage text not null default 'generate-shot-video',
    provider text not null,
    model text not null,
    estimated_cost float4 not null default 0,
    status text not null,
    charge_status text,
    provider_request_status text,
    provider_request_id text,
    request_started_at timestamptz,
    response_received_at timestamptz,
    duration_ms int4,
    request_summary jsonb not null default '{}'::jsonb,
    response_summary jsonb not null default '{}'::jsonb,
    output_asset_ids jsonb not null default '[]'::jsonb,
    error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create index if not exists lahari_generation_attempts_project_created_idx
    on public.lahari_generation_attempts(project_id, created_at desc);

  create index if not exists lahari_generation_attempts_shot_created_idx
    on public.lahari_generation_attempts(shot_id, created_at desc);

  create index if not exists lahari_generation_attempts_status_created_idx
    on public.lahari_generation_attempts(status, created_at desc);

  alter table public.lahari_generation_attempts enable row level security;

  drop policy if exists "Artists can read own Lahari generation attempts" on public.lahari_generation_attempts;
  create policy "Artists can read own Lahari generation attempts"
    on public.lahari_generation_attempts
    for select
    using (
      exists (
        select 1 from public.lahari_projects p
        where p.id = lahari_generation_attempts.project_id
          and p.user_id = auth.uid()
      )
    );

  begin
    alter publication supabase_realtime add table public.lahari_generation_attempts;
  exception when duplicate_object then
    null;
  end;
exception
  when undefined_table then
    null;
end $$;
