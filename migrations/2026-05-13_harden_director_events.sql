-- Hardening pass for the durable director event journal.
--
-- seq is the journal cursor. created_at is still useful for humans, but seq is
-- strictly monotonic, so session attach cannot drop same-millisecond events.

alter table public.lahari_director_events
  add column if not exists seq bigserial;

create index if not exists lahari_director_events_project_seq_idx
  on public.lahari_director_events (project_id, seq);
