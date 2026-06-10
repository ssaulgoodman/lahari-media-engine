-- Durable agent/artist issue reports.
-- mirage_capture_issue previously wrote JSON files to server-local .mirage/issues/,
-- which is ephemeral on hosted Railway storage. These rows make "I logged it" durable
-- and inspectable across deploys. Local JSON remains a dev-only fallback.
-- project_id uses ON DELETE SET NULL (not cascade): issues report on the machine,
-- and often outlive the project they were filed against.

do $$
begin
  if to_regclass('public.studio_projects') is not null then
    create table if not exists public.studio_issues (
      id uuid primary key default gen_random_uuid(),
      project_id text references public.studio_projects(id) on delete set null,
      user_id uuid references auth.users(id) on delete set null,
      source text not null check (source in ('mcp', 'director-api', 'web')),
      severity text not null check (severity in ('low', 'mid', 'high')),
      summary text not null,
      suggested_fix text,
      recent_tool_calls jsonb not null default '[]'::jsonb,
      status text not null default 'open' check (status in ('open', 'triaged', 'resolved', 'dismissed')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists studio_issues_status_created_idx
      on public.studio_issues(status, created_at desc);

    create index if not exists studio_issues_project_created_idx
      on public.studio_issues(project_id, created_at desc);

    alter table public.studio_issues enable row level security;

    drop policy if exists "Artists can read own studio issues" on public.studio_issues;
    create policy "Artists can read own studio issues"
      on public.studio_issues
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if to_regclass('public.lahari_projects') is not null then
    create table if not exists public.lahari_issues (
      id uuid primary key default gen_random_uuid(),
      project_id text references public.lahari_projects(id) on delete set null,
      user_id uuid references auth.users(id) on delete set null,
      source text not null check (source in ('mcp', 'director-api', 'web')),
      severity text not null check (severity in ('low', 'mid', 'high')),
      summary text not null,
      suggested_fix text,
      recent_tool_calls jsonb not null default '[]'::jsonb,
      status text not null default 'open' check (status in ('open', 'triaged', 'resolved', 'dismissed')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists lahari_issues_status_created_idx
      on public.lahari_issues(status, created_at desc);

    create index if not exists lahari_issues_project_created_idx
      on public.lahari_issues(project_id, created_at desc);

    alter table public.lahari_issues enable row level security;

    drop policy if exists "Artists can read own Lahari issues" on public.lahari_issues;
    create policy "Artists can read own Lahari issues"
      on public.lahari_issues
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;
end $$;
