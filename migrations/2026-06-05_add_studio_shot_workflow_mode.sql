alter table if exists public.studio_shots
  add column if not exists workflow_mode text default 'auto';

alter table if exists public.studio_shots
  drop constraint if exists studio_shots_workflow_mode_check;

alter table if exists public.studio_shots
  add constraint studio_shots_workflow_mode_check
  check (workflow_mode in ('auto', 'storyboard', 'keyframe'));

comment on column public.studio_shots.workflow_mode is
  'Per-shot production workflow override. auto follows project/model defaults; storyboard and keyframe force the shot-level path for director-agent workflows.';
