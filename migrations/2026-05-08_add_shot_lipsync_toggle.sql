alter table if exists lahari_shots
  add column if not exists lipsync_enabled boolean default false;

comment on column lahari_shots.lipsync_enabled is
  'When true, Seedance storyboard video generation sends a sliced shot-audio reference and prompts subtle visible vocal lip-sync.';
