-- Immutable render timeline save history. The existing
-- lahari_project_timelines row remains the fast "latest" pointer; this table
-- keeps every successful save restorable so two operators on one account
-- cannot permanently erase each other's timeline edits.

CREATE TABLE IF NOT EXISTS lahari_project_timeline_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL REFERENCES lahari_projects(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL,
  saved_by uuid NULL REFERENCES auth.users(id),
  source text NOT NULL DEFAULT 'save',
  item_count integer NOT NULL DEFAULT 0,
  duration_ms integer NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE INDEX IF NOT EXISTS idx_lahari_project_timeline_versions_project_created
  ON lahari_project_timeline_versions (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lahari_project_timeline_versions_project_version
  ON lahari_project_timeline_versions (project_id, version DESC);

INSERT INTO lahari_project_timeline_versions (
  project_id,
  version,
  snapshot,
  saved_by,
  source,
  item_count,
  duration_ms,
  created_at
)
SELECT
  project_id,
  version,
  snapshot,
  updated_by,
  'backfill',
  COALESCE(jsonb_array_length(snapshot->'trackItemIds'), 0),
  NULLIF(floor((snapshot->>'duration')::numeric)::integer, 0),
  updated_at
FROM lahari_project_timelines
ON CONFLICT (project_id, version) DO NOTHING;
