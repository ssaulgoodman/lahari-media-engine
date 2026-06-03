-- Shared render timeline drafts. One canonical editable timeline per project.
-- Browser localStorage remains only a fallback/cache; this row is what lets
-- two operators on the same account see the same render edit.

CREATE TABLE IF NOT EXISTS lahari_project_timelines (
  project_id text PRIMARY KEY REFERENCES lahari_projects(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lahari_project_timelines_updated_at
  ON lahari_project_timelines (updated_at DESC);

ALTER TABLE lahari_project_timelines REPLICA IDENTITY FULL;
