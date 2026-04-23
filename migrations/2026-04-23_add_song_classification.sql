alter table lahari_projects
  add column if not exists song_type text,
  add column if not exists is_narrative boolean,
  add column if not exists is_meditative boolean;
