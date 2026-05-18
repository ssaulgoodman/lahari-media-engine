alter table public.lahari_project_prompt_overrides
  drop constraint if exists lahari_project_prompt_overrides_kind_check;

alter table public.lahari_project_prompt_overrides
  add constraint lahari_project_prompt_overrides_kind_check
  check (kind in (
    'concept',
    'script',
    'shot_prompts',
    'storyboard',
    'video',
    'character_looks',
    'environment_looks'
  ));

alter table public.lahari_shots
  add column if not exists workflow_mode text default 'auto';

alter table public.lahari_shots
  drop constraint if exists lahari_shots_workflow_mode_check;

alter table public.lahari_shots
  add constraint lahari_shots_workflow_mode_check
  check (workflow_mode in ('auto', 'storyboard', 'keyframe'));

comment on column public.lahari_shots.workflow_mode is
  'Per-shot production workflow override. auto follows project/model defaults; storyboard and keyframe force the shot-level path for director-agent workflows.';

create or replace function public.lahari_apply_script(
  p_project_id text,
  p_script jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member jsonb;
  v_environment jsonb;
  v_scene jsonb;
  v_shot jsonb;
  v_member_idx integer := 0;
  v_environment_idx integer := 0;
  v_scene_idx integer := 0;
  v_shot_idx integer := 0;
begin
  if p_project_id is null or p_project_id = '' then
    raise exception 'project id is required';
  end if;

  if p_script is null
    or jsonb_typeof(coalesce(p_script->'scenes', 'null'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_script->'scenes', '[]'::jsonb)) = 0 then
    raise exception 'script.scenes must contain at least one scene';
  end if;

  if not exists (select 1 from public.lahari_projects where id = p_project_id) then
    raise exception 'project not found: %', p_project_id;
  end if;

  delete from public.lahari_shots
  where scene_id in (
    select id from public.lahari_scenes where project_id = p_project_id
  );
  delete from public.lahari_scenes where project_id = p_project_id;
  delete from public.lahari_cast_members where project_id = p_project_id;
  delete from public.lahari_environments where project_id = p_project_id;

  for v_member in select * from jsonb_array_elements(coalesce(p_script->'cast', '[]'::jsonb))
  loop
    insert into public.lahari_cast_members (
      id, project_id, name, description, sort_order
    ) values (
      v_member->>'id',
      p_project_id,
      coalesce(v_member->>'name', 'Character ' || (v_member_idx + 1)),
      coalesce(v_member->>'description', ''),
      v_member_idx
    );
    v_member_idx := v_member_idx + 1;
  end loop;

  for v_environment in select * from jsonb_array_elements(coalesce(p_script->'environments', '[]'::jsonb))
  loop
    insert into public.lahari_environments (
      id, project_id, name, description, sort_order
    ) values (
      v_environment->>'id',
      p_project_id,
      coalesce(v_environment->>'name', 'Environment ' || (v_environment_idx + 1)),
      coalesce(v_environment->>'description', ''),
      v_environment_idx
    );
    v_environment_idx := v_environment_idx + 1;
  end loop;

  for v_scene in select * from jsonb_array_elements(p_script->'scenes')
  loop
    insert into public.lahari_scenes (
      id, project_id, section_label, start_time, end_time,
      lyrics, narrative_description, sort_order
    ) values (
      v_scene->>'id',
      p_project_id,
      coalesce(v_scene->>'sectionLabel', 'Scene ' || (v_scene_idx + 1)),
      coalesce(v_scene->>'startTime', ''),
      coalesce(v_scene->>'endTime', ''),
      coalesce(v_scene->>'lyrics', ''),
      coalesce(v_scene->>'narrativeDescription', ''),
      v_scene_idx
    );

    v_shot_idx := 0;
    for v_shot in select * from jsonb_array_elements(coalesce(v_scene->'shots', '[]'::jsonb))
    loop
      insert into public.lahari_shots (
        id, scene_id, direction, visual_prompt, motion_prompt, duration,
        cast_ids, environment_id, continuity_from, prompts_stale,
        use_next_as_end_frame, lipsync_enabled, use_prev_storyboard_ref,
        include_prev_cut_plan, excluded_refs, workflow_mode, sort_order, image_status, video_status
      ) values (
        v_shot->>'id',
        v_scene->>'id',
        coalesce(v_shot->>'direction', ''),
        '',
        '',
        coalesce((v_shot->>'duration')::double precision, 15),
        coalesce(v_shot->'castIds', '[]'::jsonb)::text,
        nullif(v_shot->>'environmentId', ''),
        coalesce(v_shot->>'continuityFrom', 'cut'),
        false,
        0,
        false,
        false,
        null,
        '{"storyboard":[],"video":[]}'::jsonb,
        coalesce(nullif(v_shot->>'workflowMode', ''), 'auto'),
        v_shot_idx,
        'idle',
        'idle'
      );
      v_shot_idx := v_shot_idx + 1;
    end loop;

    v_scene_idx := v_scene_idx + 1;
  end loop;

  update public.lahari_projects
  set status = 'scripted',
      updated_at = now()
  where id = p_project_id;
end;
$$;

revoke all on function public.lahari_apply_script(text, jsonb) from public;
grant execute on function public.lahari_apply_script(text, jsonb) to service_role;
