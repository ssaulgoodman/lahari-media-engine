create table if not exists public.lahari_mcp_call_traces (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('mcp-remote', 'director-api')),
  user_id text,
  token_id uuid,
  project_id text,
  tool text not null,
  status text not null check (status in ('success', 'error')),
  read_only boolean not null default false,
  paid boolean not null default false,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  duration_ms integer not null default 0,
  request_bytes integer not null default 0,
  response_bytes integer not null default 0,
  error_code text,
  error_message text,
  result_kind text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists lahari_mcp_call_traces_project_started_idx
  on public.lahari_mcp_call_traces (project_id, started_at desc);

create index if not exists lahari_mcp_call_traces_user_started_idx
  on public.lahari_mcp_call_traces (user_id, started_at desc);

create index if not exists lahari_mcp_call_traces_token_started_idx
  on public.lahari_mcp_call_traces (token_id, started_at desc);

create index if not exists lahari_mcp_call_traces_tool_started_idx
  on public.lahari_mcp_call_traces (tool, started_at desc);

alter table public.lahari_mcp_call_traces enable row level security;
