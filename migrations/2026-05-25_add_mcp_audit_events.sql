-- Durable MCP timing/audit facts.
-- Filesystem JSONL is kept as a local debug mirror, but hosted Railway storage is
-- ephemeral. These rows back get_agent_timing_summary across deploys/restarts.

do $$
begin
  if to_regclass('public.studio_projects') is not null then
    create table if not exists public.studio_mcp_audit_events (
      id uuid primary key default gen_random_uuid(),
      project_id text references public.studio_projects(id) on delete cascade,
      source text not null check (source in ('mcp', 'mcp-remote', 'cli')),
      phase text not null check (phase in ('start', 'finish')),
      tool text not null,
      ts timestamptz not null default now(),
      started_at timestamptz,
      duration_ms integer,
      ok boolean,
      error_message text,
      result_size integer,
      args jsonb not null default '{}'::jsonb,
      result_summary jsonb not null default '{}'::jsonb
    );

    create index if not exists studio_mcp_audit_events_project_ts_idx
      on public.studio_mcp_audit_events(project_id, ts desc);

    create index if not exists studio_mcp_audit_events_tool_ts_idx
      on public.studio_mcp_audit_events(tool, ts desc);

    alter table public.studio_mcp_audit_events enable row level security;

    drop policy if exists "Artists can read own studio MCP audit events" on public.studio_mcp_audit_events;
    create policy "Artists can read own studio MCP audit events"
      on public.studio_mcp_audit_events
      for select
      to authenticated
      using (
        project_id is not null
        and exists (
          select 1 from public.studio_projects p
          where p.id = studio_mcp_audit_events.project_id
            and p.user_id = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if to_regclass('public.lahari_projects') is not null then
    create table if not exists public.lahari_mcp_audit_events (
      id uuid primary key default gen_random_uuid(),
      project_id text references public.lahari_projects(id) on delete cascade,
      source text not null check (source in ('mcp', 'mcp-remote', 'cli')),
      phase text not null check (phase in ('start', 'finish')),
      tool text not null,
      ts timestamptz not null default now(),
      started_at timestamptz,
      duration_ms integer,
      ok boolean,
      error_message text,
      result_size integer,
      args jsonb not null default '{}'::jsonb,
      result_summary jsonb not null default '{}'::jsonb
    );

    create index if not exists lahari_mcp_audit_events_project_ts_idx
      on public.lahari_mcp_audit_events(project_id, ts desc);

    create index if not exists lahari_mcp_audit_events_tool_ts_idx
      on public.lahari_mcp_audit_events(tool, ts desc);

    alter table public.lahari_mcp_audit_events enable row level security;

    drop policy if exists "Artists can read own Lahari MCP audit events" on public.lahari_mcp_audit_events;
    create policy "Artists can read own Lahari MCP audit events"
      on public.lahari_mcp_audit_events
      for select
      to authenticated
      using (
        project_id is not null
        and exists (
          select 1 from public.lahari_projects p
          where p.id = lahari_mcp_audit_events.project_id
            and p.user_id = auth.uid()
        )
      );
  end if;
end $$;
