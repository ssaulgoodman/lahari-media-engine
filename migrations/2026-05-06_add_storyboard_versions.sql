-- Storyboard mode for Seedance + GPT Image workflows.
-- Stores the canonical Lahari history separately from OpenAI's response chain.

alter table if exists lahari_shots
  add column if not exists storyboard_asset_id text,
  add column if not exists storyboard_version_id text,
  add column if not exists storyboard_status text default 'idle',
  add column if not exists storyboard_locked boolean default false,
  add column if not exists storyboard_user_feedback text;

create table if not exists lahari_storyboard_versions (
  id text primary key,
  project_id text not null references lahari_projects(id) on delete cascade,
  shot_id text not null references lahari_shots(id) on delete cascade,
  asset_id text not null references lahari_assets(id) on delete cascade,
  parent_version_id text references lahari_storyboard_versions(id) on delete set null,
  openai_response_id text,
  openai_image_call_ids jsonb,
  reasoning_model text,
  image_model text,
  prompt text,
  artist_note text,
  refs jsonb,
  metadata jsonb,
  locked boolean default false,
  created_at timestamptz default now()
);

create index if not exists lahari_storyboard_versions_project_idx
  on lahari_storyboard_versions(project_id);

create index if not exists lahari_storyboard_versions_shot_idx
  on lahari_storyboard_versions(shot_id, created_at desc);
