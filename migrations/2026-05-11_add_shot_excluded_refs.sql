-- Per-generation-step ref exclusion for storyboard mode.
--
-- Storyboard mode has TWO model calls (storyboard image gen + Seedance video
-- gen), and the right ref set differs between them: storyboard gen needs
-- cast/env/style anchors because the model has nothing else; Seedance video
-- gen already has the locked storyboard image baking in the composition, so
-- extra refs often dilute the lock rather than help.
--
-- Solution: per-tab exclusion lists. Each holds entity ref keys (e.g.
-- "style", "cast:<id>", "env:<id>", "shot_ref:<assetId>") to drop from that
-- specific generation step. Empty lists = include all available refs
-- (existing behavior). Composition on the shot (shot.cast_ids,
-- shot.environment_id) is unchanged — this only affects which images are
-- attached at gen time, not what the prompt says is IN the scene.

alter table lahari_shots
  add column if not exists excluded_refs jsonb not null default '{"storyboard":[],"video":[]}'::jsonb;
