-- Index the columns used by per-user queue dashboard lookups.
-- listQueue() runs an aggregation grouped by source_queue_id partitioned by
-- user_id; the /queue/:id/start route does an exact-match lookup on both.
-- Both queries were doing seq scans because lahari_projects only had the
-- primary-key index.
--
-- Partial index on source_queue_id excludes legacy projects without queue
-- linkage (a small share of rows in practice but worth skipping at scale).

CREATE INDEX IF NOT EXISTS idx_lahari_projects_source_queue
  ON lahari_projects (source_queue_id)
  WHERE source_queue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lahari_projects_user_id
  ON lahari_projects (user_id);
