-- Ephemeral-ish operation presence for agent-driven work.
-- This lets the web studio show "Codex is working on this shot" and refresh
-- the relevant project after remote MCP / Director API mutations complete.

create table if not exists public.lahari_agent_operations (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.lahari_projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  source text not null check (source in ('mcp-remote', 'director-api', 'web', 'system')),
  tool text not null,
  status text not null check (status in ('running', 'success', 'error')),
  scope_type text not null check (scope_type in ('project', 'scene', 'shot')),
  scope_id text not null,
  label text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists lahari_agent_operations_project_started_idx
  on public.lahari_agent_operations (project_id, started_at desc);

create index if not exists lahari_agent_operations_project_status_idx
  on public.lahari_agent_operations (project_id, status, started_at desc);

alter table public.lahari_agent_operations enable row level security;

drop policy if exists "Artists can read their Lahari agent operations" on public.lahari_agent_operations;
create policy "Artists can read their Lahari agent operations"
  on public.lahari_agent_operations
  for select
  using (
    exists (
      select 1
      from public.lahari_projects p
      where p.id = lahari_agent_operations.project_id
        and p.user_id = auth.uid()
    )
  );

do $$
begin
  alter publication supabase_realtime add table public.lahari_agent_operations;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.lahari_projects;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.lahari_scenes;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.lahari_shots;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.lahari_cast_members;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.lahari_environments;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.lahari_storyboard_versions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.lahari_project_config;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.lahari_project_prompt_overrides;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.lahari_assets;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.lahari_renders;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.lahari_director_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
