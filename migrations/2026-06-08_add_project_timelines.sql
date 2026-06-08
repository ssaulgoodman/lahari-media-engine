do $$
begin
  create table if not exists public.studio_project_timelines (
    project_id text primary key references public.studio_projects(id) on delete cascade,
    snapshot jsonb not null,
    version integer not null default 1 check (version > 0),
    updated_by uuid null references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create index if not exists studio_project_timelines_updated_at_idx
    on public.studio_project_timelines(updated_at desc);

  alter table public.studio_project_timelines enable row level security;

  drop policy if exists "Artists can read own studio timelines" on public.studio_project_timelines;
  create policy "Artists can read own studio timelines"
    on public.studio_project_timelines
    for select
    using (
      exists (
        select 1 from public.studio_projects p
        where p.id = studio_project_timelines.project_id
          and p.user_id = auth.uid()
      )
    );

  alter table public.studio_project_timelines replica identity full;

  begin
    alter publication supabase_realtime add table public.studio_project_timelines;
  exception when duplicate_object then
    null;
  end;
exception
  when undefined_table then
    null;
end $$;

do $$
begin
  create table if not exists public.studio_project_timeline_versions (
    id uuid primary key default gen_random_uuid(),
    project_id text not null references public.studio_projects(id) on delete cascade,
    version integer not null check (version > 0),
    snapshot jsonb not null,
    saved_by uuid null references auth.users(id) on delete set null,
    source text not null default 'save',
    item_count integer not null default 0,
    duration_ms integer null,
    created_at timestamptz not null default now(),
    unique (project_id, version)
  );

  create index if not exists studio_project_timeline_versions_project_created_idx
    on public.studio_project_timeline_versions(project_id, created_at desc);

  create index if not exists studio_project_timeline_versions_project_version_idx
    on public.studio_project_timeline_versions(project_id, version desc);

  alter table public.studio_project_timeline_versions enable row level security;

  drop policy if exists "Artists can read own studio timeline versions" on public.studio_project_timeline_versions;
  create policy "Artists can read own studio timeline versions"
    on public.studio_project_timeline_versions
    for select
    using (
      exists (
        select 1 from public.studio_projects p
        where p.id = studio_project_timeline_versions.project_id
          and p.user_id = auth.uid()
      )
    );
exception
  when undefined_table then
    null;
end $$;

do $$
begin
  if to_regclass('public.studio_project_timelines') is not null
    and to_regclass('public.studio_project_timeline_versions') is not null then
    insert into public.studio_project_timeline_versions (
      project_id,
      version,
      snapshot,
      saved_by,
      source,
      item_count,
      duration_ms,
      created_at
    )
    select
      project_id,
      version,
      snapshot,
      updated_by,
      'backfill',
      coalesce(jsonb_array_length(snapshot->'trackItemIds'), 0),
      nullif(floor((snapshot->>'duration')::numeric)::integer, 0),
      updated_at
    from public.studio_project_timelines
    on conflict (project_id, version) do nothing;
  end if;
end $$;

do $$
begin
  create table if not exists public.lahari_project_timelines (
    project_id text primary key references public.lahari_projects(id) on delete cascade,
    snapshot jsonb not null,
    version integer not null default 1 check (version > 0),
    updated_by uuid null references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create index if not exists lahari_project_timelines_updated_at_idx
    on public.lahari_project_timelines(updated_at desc);

  alter table public.lahari_project_timelines enable row level security;

  drop policy if exists "Artists can read own Lahari timelines" on public.lahari_project_timelines;
  create policy "Artists can read own Lahari timelines"
    on public.lahari_project_timelines
    for select
    using (
      exists (
        select 1 from public.lahari_projects p
        where p.id = lahari_project_timelines.project_id
          and p.user_id = auth.uid()
      )
    );

  alter table public.lahari_project_timelines replica identity full;

  begin
    alter publication supabase_realtime add table public.lahari_project_timelines;
  exception when duplicate_object then
    null;
  end;
exception
  when undefined_table then
    null;
end $$;

do $$
begin
  create table if not exists public.lahari_project_timeline_versions (
    id uuid primary key default gen_random_uuid(),
    project_id text not null references public.lahari_projects(id) on delete cascade,
    version integer not null check (version > 0),
    snapshot jsonb not null,
    saved_by uuid null references auth.users(id) on delete set null,
    source text not null default 'save',
    item_count integer not null default 0,
    duration_ms integer null,
    created_at timestamptz not null default now(),
    unique (project_id, version)
  );

  create index if not exists lahari_project_timeline_versions_project_created_idx
    on public.lahari_project_timeline_versions(project_id, created_at desc);

  create index if not exists lahari_project_timeline_versions_project_version_idx
    on public.lahari_project_timeline_versions(project_id, version desc);

  alter table public.lahari_project_timeline_versions enable row level security;

  drop policy if exists "Artists can read own Lahari timeline versions" on public.lahari_project_timeline_versions;
  create policy "Artists can read own Lahari timeline versions"
    on public.lahari_project_timeline_versions
    for select
    using (
      exists (
        select 1 from public.lahari_projects p
        where p.id = lahari_project_timeline_versions.project_id
          and p.user_id = auth.uid()
      )
    );
exception
  when undefined_table then
    null;
end $$;

do $$
begin
  if to_regclass('public.lahari_project_timelines') is not null
    and to_regclass('public.lahari_project_timeline_versions') is not null then
    insert into public.lahari_project_timeline_versions (
      project_id,
      version,
      snapshot,
      saved_by,
      source,
      item_count,
      duration_ms,
      created_at
    )
    select
      project_id,
      version,
      snapshot,
      updated_by,
      'backfill',
      coalesce(jsonb_array_length(snapshot->'trackItemIds'), 0),
      nullif(floor((snapshot->>'duration')::numeric)::integer, 0),
      updated_at
    from public.lahari_project_timelines
    on conflict (project_id, version) do nothing;
  end if;
end $$;
