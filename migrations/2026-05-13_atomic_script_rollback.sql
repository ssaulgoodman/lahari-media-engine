-- Atomic script rollback for Codex preview applies.
--
-- Supabase REST calls are not transactional across multiple delete/insert
-- statements. This function restores the script graph inside one Postgres
-- transaction so rollback cannot leave half-restored scenes/shots.

create or replace function public.lahari_rollback_script_preview(
  p_project_id text,
  p_before_project jsonb,
  p_before_rows jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scene jsonb;
  v_shot jsonb;
  v_member jsonb;
  v_environment jsonb;
  v_scene_idx integer := 0;
  v_shot_idx integer := 0;
  v_member_idx integer := 0;
  v_environment_idx integer := 0;
begin
  if p_project_id is null or p_project_id = '' then
    raise exception 'project id is required';
  end if;

  if p_before_project is null or p_before_rows is null then
    raise exception 'rollback snapshot is required';
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

  for v_member in select * from jsonb_array_elements(coalesce(p_before_rows->'cast', '[]'::jsonb))
  loop
    insert into public.lahari_cast_members (
      id, project_id, name, description, generation_prompt,
      prompts_stale, reference_asset_id, sort_order
    ) values (
      v_member->>'id',
      p_project_id,
      coalesce(v_member->>'name', 'Character ' || (v_member_idx + 1)),
      coalesce(v_member->>'description', ''),
      nullif(v_member->>'generationPrompt', ''),
      coalesce((v_member->>'promptsStale')::boolean, false),
      nullif(v_member->>'referenceAssetId', ''),
      v_member_idx
    );
    v_member_idx := v_member_idx + 1;
  end loop;

  for v_environment in select * from jsonb_array_elements(coalesce(p_before_rows->'environments', '[]'::jsonb))
  loop
    insert into public.lahari_environments (
      id, project_id, name, description, generation_prompt,
      prompts_stale, reference_asset_id, sort_order
    ) values (
      v_environment->>'id',
      p_project_id,
      coalesce(v_environment->>'name', 'Environment ' || (v_environment_idx + 1)),
      coalesce(v_environment->>'description', ''),
      nullif(v_environment->>'generationPrompt', ''),
      coalesce((v_environment->>'promptsStale')::boolean, false),
      nullif(v_environment->>'referenceAssetId', ''),
      v_environment_idx
    );
    v_environment_idx := v_environment_idx + 1;
  end loop;

  for v_scene in select * from jsonb_array_elements(coalesce(p_before_rows->'scenes', '[]'::jsonb))
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
        include_prev_cut_plan, excluded_refs, sort_order, image_status, video_status
      ) values (
        v_shot->>'id',
        v_scene->>'id',
        coalesce(v_shot->>'direction', ''),
        coalesce(v_shot->>'visualPrompt', ''),
        coalesce(v_shot->>'motionPrompt', ''),
        coalesce((v_shot->>'duration')::double precision, 15),
        coalesce(v_shot->'castIds', '[]'::jsonb)::text,
        nullif(v_shot->>'environmentId', ''),
        coalesce(v_shot->>'continuityFrom', 'cut'),
        coalesce((v_shot->>'promptsStale')::boolean, false),
        case when coalesce((v_shot->>'useNextAsEndFrame')::boolean, false) then 1 else 0 end,
        coalesce((v_shot->>'lipsyncEnabled')::boolean, false),
        coalesce((v_shot->>'usePrevStoryboardRef')::boolean, false),
        case
          when v_shot ? 'includePrevCutPlan' and v_shot->'includePrevCutPlan' <> 'null'::jsonb
            then (v_shot->>'includePrevCutPlan')::boolean
          else null
        end,
        coalesce(v_shot->'excludedRefs', '{"storyboard":[],"video":[]}'::jsonb),
        v_shot_idx,
        'idle',
        'idle'
      );
      v_shot_idx := v_shot_idx + 1;
    end loop;

    v_scene_idx := v_scene_idx + 1;
  end loop;

  update public.lahari_projects
  set
    status = coalesce(p_before_project->>'status', status),
    last_script_prompt = nullif(p_before_project->>'lastScriptPrompt', ''),
    last_write_shots_prompt = nullif(p_before_project->>'lastWriteShotsPrompt', ''),
    updated_at = now()
  where id = p_project_id;
end;
$$;

revoke all on function public.lahari_rollback_script_preview(text, jsonb, jsonb) from public;
grant execute on function public.lahari_rollback_script_preview(text, jsonb, jsonb) to service_role;
