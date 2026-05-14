-- Durable artist/operator event log for Codex-native director sessions.
--
-- Supabase project tables remain canonical state. This table is the human
-- decision trail: locks, rejects, prompt edits, regenerations, Codex applies,
-- and explicit notes that future Codex sessions need to understand intent.
-- Ephemeral progress belongs in Realtime broadcast, not here.

create table if not exists public.lahari_director_events (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.lahari_projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  source text not null check (source in ('web', 'codex', 'system')),
  event_type text not null,
  entity_type text,
  entity_id text,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lahari_director_events_project_created_idx
  on public.lahari_director_events (project_id, created_at desc);

create index if not exists lahari_director_events_project_type_idx
  on public.lahari_director_events (project_id, event_type, created_at desc);
