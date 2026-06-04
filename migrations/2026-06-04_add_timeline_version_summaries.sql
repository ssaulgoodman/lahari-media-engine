-- Small summary columns keep the Timeline History popover light. Full
-- snapshots stay in the immutable version row for restore.

ALTER TABLE lahari_project_timeline_versions
  ADD COLUMN IF NOT EXISTS item_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_ms integer NULL;

UPDATE lahari_project_timeline_versions
SET
  item_count = COALESCE(jsonb_array_length(snapshot->'trackItemIds'), 0),
  duration_ms = NULLIF(floor((snapshot->>'duration')::numeric)::integer, 0)
WHERE item_count = 0
  OR duration_ms IS NULL;
