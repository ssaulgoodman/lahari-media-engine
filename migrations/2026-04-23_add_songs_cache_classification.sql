alter table songs
  add column if not exists cached_song_type text,
  add column if not exists cached_is_narrative boolean,
  add column if not exists cached_is_meditative boolean;
