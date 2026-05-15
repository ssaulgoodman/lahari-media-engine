alter table public.lahari_project_prompt_overrides
  drop constraint if exists lahari_project_prompt_overrides_kind_check;

alter table public.lahari_project_prompt_overrides
  add constraint lahari_project_prompt_overrides_kind_check
  check (kind in ('concept', 'script', 'shot_prompts', 'storyboard', 'video'));
