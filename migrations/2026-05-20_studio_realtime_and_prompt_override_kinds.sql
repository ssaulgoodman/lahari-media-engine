-- Mirage v1: make the explicit client-realtime surface match studio_* tables,
-- and expand prompt override kinds to the full project-level override contract.

alter table public.studio_project_prompt_overrides
  drop constraint if exists studio_project_prompt_overrides_kind_check;

alter table public.studio_project_prompt_overrides
  add constraint studio_project_prompt_overrides_kind_check
  check (kind in (
    'concept',
    'script',
    'shot_prompts',
    'storyboard',
    'video',
    'character_looks',
    'environment_looks',
    'audio_plan'
  ));

drop policy if exists "Artists can read own studio projects" on public.studio_projects;
create policy "Artists can read own studio projects"
  on public.studio_projects
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Artists can read own studio scenes" on public.studio_scenes;
create policy "Artists can read own studio scenes"
  on public.studio_scenes
  for select
  to authenticated
  using (
    exists (
      select 1 from public.studio_projects p
      where p.id = studio_scenes.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Artists can read own studio shots" on public.studio_shots;
create policy "Artists can read own studio shots"
  on public.studio_shots
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.studio_scenes s
      join public.studio_projects p on p.id = s.project_id
      where s.id = studio_shots.scene_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Artists can read own studio cast" on public.studio_cast_members;
create policy "Artists can read own studio cast"
  on public.studio_cast_members
  for select
  to authenticated
  using (
    exists (
      select 1 from public.studio_projects p
      where p.id = studio_cast_members.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Artists can read own studio environments" on public.studio_environments;
create policy "Artists can read own studio environments"
  on public.studio_environments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.studio_projects p
      where p.id = studio_environments.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Artists can read own studio assets" on public.studio_assets;
create policy "Artists can read own studio assets"
  on public.studio_assets
  for select
  to authenticated
  using (
    exists (
      select 1 from public.studio_projects p
      where p.id = studio_assets.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Artists can read own studio storyboard versions" on public.studio_storyboard_versions;
create policy "Artists can read own studio storyboard versions"
  on public.studio_storyboard_versions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.studio_projects p
      where p.id = studio_storyboard_versions.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Artists can read own studio renders" on public.studio_renders;
create policy "Artists can read own studio renders"
  on public.studio_renders
  for select
  to authenticated
  using (
    exists (
      select 1 from public.studio_projects p
      where p.id = studio_renders.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Artists can read own studio project config" on public.studio_project_config;
create policy "Artists can read own studio project config"
  on public.studio_project_config
  for select
  to authenticated
  using (
    exists (
      select 1 from public.studio_projects p
      where p.id = studio_project_config.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Artists can read own studio prompt overrides" on public.studio_project_prompt_overrides;
create policy "Artists can read own studio prompt overrides"
  on public.studio_project_prompt_overrides
  for select
  to authenticated
  using (
    exists (
      select 1 from public.studio_projects p
      where p.id = studio_project_prompt_overrides.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Artists can read own studio director events" on public.studio_director_events;
create policy "Artists can read own studio director events"
  on public.studio_director_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.studio_projects p
      where p.id = studio_director_events.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Artists can read own studio agent operations" on public.studio_agent_operations;
create policy "Artists can read own studio agent operations"
  on public.studio_agent_operations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.studio_projects p
      where p.id = studio_agent_operations.project_id
        and p.user_id = auth.uid()
    )
  );

do $$
begin
  alter publication supabase_realtime add table public.studio_projects;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_scenes;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_shots;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_cast_members;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_environments;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_assets;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_storyboard_versions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_renders;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_project_config;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_project_prompt_overrides;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_director_events;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_agent_operations;
exception when duplicate_object then null;
end $$;
