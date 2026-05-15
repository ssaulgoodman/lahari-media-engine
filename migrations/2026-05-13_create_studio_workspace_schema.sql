-- Clean platform workspace bootstrap.
--
-- Apply this to a NEW Supabase project for the non-Lahari studio product.
-- Then run the app with:
--   DB_TABLE_PREFIX=studio
--   SUPABASE_URL=<new project url>
--   SUPABASE_SERVICE_KEY=<new service role key>
--
-- This intentionally does not create songs/files/music_video_queue. Those are
-- legacy source adapters, not required for music_video or anime_scripted v1.

create table if not exists studio_projects (
  id text primary key,
  user_id uuid,
  parent_project_id text references studio_projects(id) on delete set null,
  source_queue_id text,

  -- New platform/workflow fields.
  preset_key text not null default 'music_video_default',
  workflow_key text not null default 'music_video',
  seed_kind text not null default 'audio',
  project_brief jsonb,
  source_payload jsonb,

  title text,
  status text default 'uploaded',
  audio_path text,
  lyrics text,
  musical_structure text,
  concept_options text,
  locked_concept text,
  style_description text,
  style_asset_id text,
  color_palette text,
  meaning text,
  video_mode text default 'montage',
  target_duration int4 default 8,
  cost_estimate float4 default 0,
  style_exploration text,
  last_script_prompt text,
  last_concept_prompt text,
  last_write_shots_prompt text,
  aspect_ratio text default '16:9',
  video_resolution text default '720p',
  video_model text default 'seedance-2.0-fast',
  image_model text default 'nano-banana-2',
  storyboard_provider text default 'gpt-image-2',
  text_provider text default null,
  style_generation_prompt text,
  song_type text,
  is_narrative boolean,
  is_meditative boolean,
  analysis_step text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists studio_projects_user_created_idx
  on studio_projects(user_id, created_at desc);

create index if not exists studio_projects_workflow_idx
  on studio_projects(workflow_key, preset_key);

create table if not exists studio_assets (
  id text primary key,
  project_id text not null references studio_projects(id) on delete cascade,
  shot_id text,
  category text not null,
  file_path text not null,
  prompt text,
  metadata text,
  created_at timestamptz not null default now()
);

create index if not exists studio_assets_project_idx
  on studio_assets(project_id, created_at desc);

create index if not exists studio_assets_shot_category_idx
  on studio_assets(shot_id, category, created_at desc);

create table if not exists studio_cast_members (
  id text primary key,
  project_id text not null references studio_projects(id) on delete cascade,
  name text not null,
  description text,
  reference_asset_id text references studio_assets(id) on delete set null,
  sort_order int4 default 0,
  generation_prompt text,
  prompts_stale boolean default false
);

create index if not exists studio_cast_project_idx
  on studio_cast_members(project_id, sort_order);

create table if not exists studio_environments (
  id text primary key,
  project_id text not null references studio_projects(id) on delete cascade,
  name text not null,
  description text,
  reference_asset_id text references studio_assets(id) on delete set null,
  sort_order int4 default 0,
  generation_prompt text,
  prompts_stale boolean default false
);

create index if not exists studio_environments_project_idx
  on studio_environments(project_id, sort_order);

create table if not exists studio_scenes (
  id text primary key,
  project_id text not null references studio_projects(id) on delete cascade,
  section_label text,
  start_time text,
  end_time text,
  lyrics text,
  narrative_description text,
  sort_order int4 default 0
);

create index if not exists studio_scenes_project_idx
  on studio_scenes(project_id, sort_order);

create table if not exists studio_shots (
  id text primary key,
  scene_id text not null references studio_scenes(id) on delete cascade,
  visual_prompt text,
  motion_prompt text,
  direction text,
  duration float4,
  cast_ids text,
  environment_id text references studio_environments(id) on delete set null,
  continuity_from text,
  continuity_description text,
  refined_from_prev_frame int4 default 0,
  image_asset_id text references studio_assets(id) on delete set null,
  video_asset_id text references studio_assets(id) on delete set null,
  end_image_asset_id text references studio_assets(id) on delete set null,
  extracted_last_frame_asset_id text references studio_assets(id) on delete set null,
  image_status text default 'idle',
  video_status text default 'idle',
  end_image_status text default 'idle',
  critique text,
  attempt_count int4 default 0,
  use_next_as_end_frame int4 default 0,
  sort_order int4 default 0,
  locked int4 default 0,
  user_feedback text,
  end_visual_prompt text,
  end_user_feedback text,
  prompts_stale boolean default false,
  last_error text,

  storyboard_asset_id text references studio_assets(id) on delete set null,
  storyboard_version_id text,
  storyboard_status text default 'idle',
  storyboard_locked boolean default false,
  storyboard_user_feedback text,
  storyboard_prompt text,
  storyboard_cut_plan text,
  storyboard_prompt_status text default 'idle',
  storyboard_prompt_user_feedback text,
  use_prev_storyboard_ref boolean not null default false,
  include_prev_cut_plan boolean default null,
  excluded_refs jsonb not null default '{"storyboard":[],"video":[]}'::jsonb,
  lipsync_enabled boolean default false
);

create index if not exists studio_shots_scene_idx
  on studio_shots(scene_id, sort_order);

create index if not exists studio_shots_environment_idx
  on studio_shots(environment_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'studio_assets_shot_id_fkey'
  ) then
    alter table studio_assets
      add constraint studio_assets_shot_id_fkey
      foreign key (shot_id) references studio_shots(id) on delete cascade;
  end if;
end $$;

create table if not exists studio_storyboard_versions (
  id text primary key,
  project_id text not null references studio_projects(id) on delete cascade,
  shot_id text not null references studio_shots(id) on delete cascade,
  asset_id text not null references studio_assets(id) on delete cascade,
  parent_version_id text references studio_storyboard_versions(id) on delete set null,
  openai_response_id text,
  openai_image_call_ids jsonb,
  reasoning_model text,
  image_model text,
  prompt text,
  artist_note text,
  refs jsonb,
  metadata jsonb,
  locked boolean default false,
  created_at timestamptz not null default now()
);

create index if not exists studio_storyboard_versions_project_idx
  on studio_storyboard_versions(project_id);

create index if not exists studio_storyboard_versions_shot_idx
  on studio_storyboard_versions(shot_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'studio_shots_storyboard_version_id_fkey'
  ) then
    alter table studio_shots
      add constraint studio_shots_storyboard_version_id_fkey
      foreign key (storyboard_version_id) references studio_storyboard_versions(id) on delete set null;
  end if;
end $$;

create table if not exists studio_chat_messages (
  id bigserial primary key,
  project_id text not null references studio_projects(id) on delete cascade,
  role text not null,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists studio_chat_project_idx
  on studio_chat_messages(project_id, id);

create table if not exists studio_ai_calls (
  id text primary key,
  project_id text references studio_projects(id) on delete cascade,
  stage text not null,
  model text not null,
  prompt text not null,
  reference_inputs text,
  context_chain text,
  response_summary text,
  output_asset_ids text,
  duration_ms int4,
  cost_estimate float4,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists studio_ai_calls_project_idx
  on studio_ai_calls(project_id, created_at desc);

create index if not exists studio_ai_calls_created_idx
  on studio_ai_calls(created_at desc);

create table if not exists studio_director_events (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references studio_projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  source text not null check (source in ('web', 'codex', 'system')),
  event_type text not null,
  entity_type text,
  entity_id text,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists studio_director_events_project_created_idx
  on studio_director_events(project_id, created_at desc);

create index if not exists studio_director_events_project_type_idx
  on studio_director_events(project_id, event_type, created_at desc);

create table if not exists studio_agent_operations (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references studio_projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  source text not null check (source in ('mcp-remote', 'director-api', 'web', 'system')),
  tool text not null,
  status text not null check (status in ('running', 'success', 'error')),
  scope_type text not null check (scope_type in ('project', 'scene', 'shot')),
  scope_id text not null,
  label text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists studio_agent_operations_project_started_idx
  on studio_agent_operations(project_id, started_at desc);

create index if not exists studio_agent_operations_project_status_idx
  on studio_agent_operations(project_id, status, started_at desc);

create table if not exists studio_mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  label text not null default 'Studio MCP',
  token_hash text not null unique,
  token_prefix text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists studio_mcp_tokens_user_created_idx
  on studio_mcp_tokens(user_id, created_at desc);

create index if not exists studio_mcp_tokens_active_idx
  on studio_mcp_tokens(token_hash)
  where revoked_at is null;

create table if not exists studio_project_config (
  project_id text primary key references studio_projects(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists studio_project_prompt_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references studio_projects(id) on delete cascade,
  kind text not null check (kind in ('concept', 'script', 'shot_prompts', 'storyboard', 'video')),
  scope_type text not null default 'project' check (scope_type in ('project', 'scene', 'shot')),
  scope_id text null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create unique index if not exists studio_project_prompt_overrides_one_active_idx
  on studio_project_prompt_overrides(project_id, kind, scope_type, coalesce(scope_id, ''))
  where active;

create index if not exists studio_project_prompt_overrides_lookup_idx
  on studio_project_prompt_overrides(project_id, kind, scope_type, scope_id, active, updated_at desc);

create index if not exists studio_project_prompt_overrides_history_idx
  on studio_project_prompt_overrides(project_id, kind, updated_at desc);

create table if not exists studio_renders (
  id text primary key,
  project_id text not null references studio_projects(id) on delete cascade,
  status text not null default 'rendering',
  video_url text,
  storage_path text,
  error text,
  render_ms bigint,
  progress numeric,
  stage text,
  last_heartbeat_at timestamptz,
  modal_function_call_id text,
  error_code text,
  terminal_payload jsonb,
  terminal_at timestamptz,
  render_engine text,
  ffmpeg_fallback_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists studio_renders_project_idx
  on studio_renders(project_id, created_at desc);

create index if not exists studio_renders_active_idx
  on studio_renders(status, last_heartbeat_at desc)
  where status = 'rendering';

create index if not exists studio_renders_pending_finalize_idx
  on studio_renders(updated_at asc)
  where status = 'pending_finalize';

create index if not exists studio_renders_render_engine_idx
  on studio_renders(render_engine, created_at desc);

alter table studio_projects enable row level security;
alter table studio_assets enable row level security;
alter table studio_cast_members enable row level security;
alter table studio_environments enable row level security;
alter table studio_scenes enable row level security;
alter table studio_shots enable row level security;
alter table studio_storyboard_versions enable row level security;
alter table studio_chat_messages enable row level security;
alter table studio_ai_calls enable row level security;
alter table studio_director_events enable row level security;
alter table studio_agent_operations enable row level security;
alter table studio_mcp_tokens enable row level security;
alter table studio_project_config enable row level security;
alter table studio_project_prompt_overrides enable row level security;
alter table studio_renders enable row level security;
