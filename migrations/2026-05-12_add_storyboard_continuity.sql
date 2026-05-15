-- Per-shot continuity controls for storyboard mode.
--
-- use_prev_storyboard_ref: when true, the previous shot's locked
-- storyboard image is attached as a vision input to the planner AND as an
-- image ref to the image renderer. The "previous shot" is computed at gen
-- time from same scene + sort_order - 1; nothing is denormalized here, so
-- re-generating the previous shot's storyboard automatically updates this
-- shot's continuity ref on next write.
--
-- include_prev_cut_plan: nullable so we can distinguish "artist hasn't
-- decided → use smart default" from "explicit on/off." Smart default
-- (computed in the planner) is true when shot.continuity_from === 'prev_shot'
-- AND a previous shot exists in the same scene.

alter table lahari_shots
  add column if not exists use_prev_storyboard_ref boolean not null default false,
  add column if not exists include_prev_cut_plan boolean default null;
