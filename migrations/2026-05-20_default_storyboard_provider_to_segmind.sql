-- Mirage provider policy: image/storyboard/video generation defaults to Segmind.
alter table if exists studio_projects
  alter column storyboard_provider set default 'nano-banana-2';

