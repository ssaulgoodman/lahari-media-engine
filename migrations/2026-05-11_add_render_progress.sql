-- Phase 2 render observability. All columns are nullable/additive so existing
-- render rows keep working and old clients can ignore the extra status fields.
alter table lahari_renders
  add column if not exists progress numeric,
  add column if not exists stage text,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists modal_function_call_id text,
  add column if not exists error_code text;

create index if not exists lahari_renders_active_idx
  on lahari_renders(status, last_heartbeat_at desc)
  where status = 'rendering';
