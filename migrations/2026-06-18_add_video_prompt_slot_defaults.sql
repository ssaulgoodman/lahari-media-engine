alter table if exists public.studio_shots
  add column if not exists video_prompt_slots jsonb not null default '{}'::jsonb;

alter table if exists public.lahari_shots
  add column if not exists video_prompt_slots jsonb not null default '{}'::jsonb;

do $$
begin
  if to_regclass('public.studio_shots') is not null then
    comment on column public.studio_shots.video_prompt_slots is
      'Per-shot storyboard-video prompt slot defaults. Known keys mirror generate_video contextOverrides include* booleans; missing keys follow recipe/engine defaults.';
  end if;

  if to_regclass('public.lahari_shots') is not null then
    comment on column public.lahari_shots.video_prompt_slots is
      'Per-shot storyboard-video prompt slot defaults. Known keys mirror generate_video contextOverrides include* booleans; missing keys follow recipe/engine defaults.';
  end if;
end $$;
