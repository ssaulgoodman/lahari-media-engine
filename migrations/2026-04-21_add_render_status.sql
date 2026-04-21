-- Per-render job tracking. One row per /render invocation so callbacks from
-- stale runs can't clobber fresh state, and failed renders stay queryable
-- (lahari_assets only tracks successful uploads).
--
-- status transitions:
--   rendering → completed
--             ↘ failed
create table if not exists lahari_renders (
  id            text primary key,
  project_id    text not null references lahari_projects(id) on delete cascade,
  status        text not null default 'rendering',
  video_url     text,
  storage_path  text,
  error         text,
  render_ms     bigint,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists lahari_renders_project_idx
  on lahari_renders(project_id, created_at desc);

-- All server-side access goes through the service key (which bypasses RLS).
-- Enabling RLS with no policies means anon/authenticated JWTs see zero rows,
-- so an accidental client-side read can't leak render status/URLs.
alter table lahari_renders enable row level security;
