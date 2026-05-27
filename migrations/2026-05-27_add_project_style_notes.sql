-- Project-local style-note buckets for graph-first prompt composition.
--
-- These are editable project data, not preset/runtime doctrine. They start
-- small and can later be harvested into reusable presets when a project works.

alter table if exists public.lahari_project_config
  add column if not exists style_notes jsonb not null default '{}'::jsonb;

alter table if exists public.studio_project_config
  add column if not exists style_notes jsonb not null default '{}'::jsonb;
