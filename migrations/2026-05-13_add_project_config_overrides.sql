-- Project-local Codex configuration for director sessions.
--
-- Supabase remains canonical. The `.lahari/projects/<project_id>/config/`
-- files are editable desk copies; these tables are what generation reads.

create table if not exists public.lahari_project_config (
  project_id text primary key references public.lahari_projects(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.lahari_project_prompt_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.lahari_projects(id) on delete cascade,
  kind text not null check (kind in ('storyboard', 'video')),
  scope_type text not null default 'project' check (scope_type in ('project', 'scene', 'shot')),
  scope_id text null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create unique index if not exists lahari_project_prompt_overrides_one_active_idx
  on public.lahari_project_prompt_overrides (project_id, kind, scope_type, coalesce(scope_id, ''))
  where active;

create index if not exists lahari_project_prompt_overrides_lookup_idx
  on public.lahari_project_prompt_overrides (project_id, kind, scope_type, scope_id, active, updated_at desc);

create index if not exists lahari_project_prompt_overrides_history_idx
  on public.lahari_project_prompt_overrides (project_id, kind, updated_at desc);

alter table public.lahari_project_config enable row level security;
alter table public.lahari_project_prompt_overrides enable row level security;
