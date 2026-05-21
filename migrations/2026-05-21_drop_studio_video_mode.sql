-- 2026-05-21: drop studio_projects.video_mode
--
-- videoMode = 'montage' | 'cinematic' was a project-level relic from the
-- music-video planner era. In the post-Wave 2 shape, pacing, continuity,
-- and edit density come from per-shot continuity_from + shot prompts and
-- preset taste — not a project-wide mode switch.
--
-- The column was also coupling to use_next_as_end_frame on every shot at
-- script-creation time; that derivation now happens per-shot at
-- writeShotPrompts apply, keyed on continuity_from='prev_shot'.
--
-- This drops ONLY studio_projects.video_mode. lahari_projects (Lahari prod
-- on `main` branch) keeps the column — Lahari's planner still uses it.

ALTER TABLE studio_projects DROP COLUMN IF EXISTS video_mode;
