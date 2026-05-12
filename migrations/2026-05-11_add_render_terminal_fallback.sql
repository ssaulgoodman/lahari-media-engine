-- Phase 3 render resilience. Lets the renderer persist a terminal result if
-- callback delivery exhausts during a Railway deploy/outage. The backend
-- reconciler later runs the normal finalizePublish path from these fields.
alter table lahari_renders
  add column if not exists terminal_payload jsonb,
  add column if not exists terminal_at timestamptz;

create index if not exists lahari_renders_pending_finalize_idx
  on lahari_renders(updated_at asc)
  where status = 'pending_finalize';
