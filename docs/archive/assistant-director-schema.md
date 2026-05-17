> **Archived.** Historical early schema sketch. Superseded by what shipped (see ledger R28, R29, R36). Preserved for reference. 
# Assistant Director — Database Schema Reference

Tables the assistant director agent needs read access to for full project-overview context. Source of truth: `docs/database.sql` (live schema dump). Everything else (ai_calls telemetry, renders job tracking, queue/songs catalog, external batch_jobs / clips / videos / shots / files tables) is out of scope.

**Note on types**: Many JSON-ish fields on `lahari_projects` and `lahari_shots` are stored as `text` (serialized JSON), not `jsonb`. Parse with `JSON.parse()` on the server. `lahari_scenes.start_time`/`end_time` are `text` (formatted like `[M:SS]`), not numeric.

**Note on booleans**: Some flags on `lahari_shots` are `int4` (0/1), not `bool` — specifically `locked`, `use_next_as_end_frame`, `refined_from_prev_frame`. `prompts_stale` is a proper `bool`. Coerce with `!!value` when reading.

---

## 1. `lahari_projects` — root row

| Column | Type | Purpose |
|---|---|---|
| `id` | `text` pk | Project id |
| `user_id` | `uuid` nullable | Auth owner (Supabase user id) |
| `parent_project_id` | `text` nullable | Fork lineage (null for originals) |
| `source_queue_id` | `text` nullable | Link back to `music_video_queue.id` |
| `title` | `text` nullable | Display title |
| `status` | `text` nullable | `analyzing` → `analyzed` → `concept` → `script` → `style` → `characters` → `environments` → `studio` → `completed` / `error` |
| `audio_path` | `text` nullable | Supabase Storage key for source audio |
| `lyrics` | `text` nullable | Full lyrics text |
| `meaning` | `text` nullable | AI-generated meaning summary |
| `musical_structure` | `text` nullable | JSON-serialized array of sections |
| `concept_options` | `text` nullable | JSON-serialized 3 concept options |
| `locked_concept` | `text` nullable | JSON-serialized chosen concept |
| `style_description` | `text` nullable | Style DNA text |
| `style_asset_id` | `text` nullable | FK → `lahari_assets.id` (locked style image) |
| `style_generation_prompt` | `text` nullable | Last imagen prompt for style |
| `style_exploration` | `text` nullable | JSON-serialized brainstorm slots |
| `color_palette` | `text` nullable | Palette text |
| `video_mode` | `text` nullable | Generation mode |
| `video_model` | `text` nullable | `veo-3.1-fast` / `veo-3.1` / `seedance-2.0-fast` / `seedance-2.0` |
| `aspect_ratio` | `text` nullable | `16:9` / `9:16` / etc |
| `video_resolution` | `text` nullable | `720p` / `1080p` |
| `last_concept_prompt` | `text` nullable | Last Claude prompt (debugging) |
| `last_script_prompt` | `text` nullable | Last Claude prompt (debugging) |
| `last_write_shots_prompt` | `text` nullable | Last Claude prompt (debugging) |
| `target_duration` | `int4` nullable | Song length (s) |
| `cost_estimate` | `float4` nullable | Running cost |
| `created_at` | `timestamptz` nullable | |
| `updated_at` | `timestamptz` nullable | |

---

## 2. `lahari_scenes` — per-section (Verse, Chorus, etc.)

| Column | Type | Purpose |
|---|---|---|
| `id` | `text` pk | Scene id |
| `project_id` | `text` | FK → `lahari_projects.id` |
| `sort_order` | `int4` nullable | Ordering within project |
| `section_label` | `text` nullable | e.g. "Verse 1", "Chorus" |
| `start_time` | `text` nullable | Formatted timestamp (e.g. `[0:05]`) |
| `end_time` | `text` nullable | Formatted timestamp |
| `lyrics` | `text` nullable | Scene's lyric lines |
| `narrative_description` | `text` nullable | Creative direction |

---

## 3. `lahari_shots` — per-shot atomic unit

| Column | Type | Purpose |
|---|---|---|
| `id` | `text` pk | Shot id |
| `scene_id` | `text` | FK → `lahari_scenes.id` |
| `sort_order` | `int4` nullable | Ordering within scene |
| `duration` | `float4` nullable | Shot length (s) |
| `visual_prompt` | `text` nullable | First-frame image prompt |
| `motion_prompt` | `text` nullable | Video motion prompt |
| `end_visual_prompt` | `text` nullable | End-frame image prompt |
| `end_user_feedback` | `text` nullable | Artist critique for end-frame refine |
| `user_feedback` | `text` nullable | Artist critique for first-frame/video refine |
| `cast_ids` | `text` nullable | JSON-serialized array of cast member ids |
| `environment_id` | `text` nullable | FK → `lahari_environments.id` |
| `continuity_from` | `text` nullable | `cut` (hard cut) / `prev_shot` (chained) |
| `continuity_description` | `text` nullable | Narrative continuity note |
| `refined_from_prev_frame` | `int4` nullable | 0/1 flag: prompt was auto-rewritten from extracted last frame |
| `image_asset_id` | `text` nullable | Active first-frame asset → `lahari_assets.id` |
| `end_image_asset_id` | `text` nullable | Active end-frame asset → `lahari_assets.id` |
| `extracted_last_frame_asset_id` | `text` nullable | ffmpeg-extracted real last frame → `lahari_assets.id` |
| `video_asset_id` | `text` nullable | Active clip → `lahari_assets.id` |
| `image_status` | `text` nullable | `idle` / `generating` / `ready` / `error` |
| `end_image_status` | `text` nullable | Same |
| `video_status` | `text` nullable | Same |
| `locked` | `int4` nullable | 0/1 |
| `prompts_stale` | `bool` nullable | Upstream change invalidated prompts |
| `use_next_as_end_frame` | `int4` nullable | 0/1 reverse-chain flag |
| `attempt_count` | `int4` nullable | Gen attempts |
| `critique` | `text` nullable | JSON-serialized critique payload |
| `last_error` | `text` nullable | Truncated error from last failed gen |

---

## 4. `lahari_cast_members` — characters

| Column | Type | Purpose |
|---|---|---|
| `id` | `text` pk | Cast member id |
| `project_id` | `text` | FK → `lahari_projects.id` |
| `sort_order` | `int4` nullable | Ordering |
| `name` | `text` | Character name |
| `description` | `text` nullable | Identity (face, costume, ornaments — action-free) |
| `generation_prompt` | `text` nullable | Imagen prompt (editable) |
| `prompts_stale` | `bool` nullable | Upstream change flag |
| `reference_asset_id` | `text` nullable | Locked neutral portrait → `lahari_assets.id` |

---

## 5. `lahari_environments` — locations

Same shape as cast.

| Column | Type | Purpose |
|---|---|---|
| `id` | `text` pk | Env id |
| `project_id` | `text` | FK → `lahari_projects.id` |
| `sort_order` | `int4` nullable | Ordering |
| `name` | `text` | Location name |
| `description` | `text` nullable | Description |
| `generation_prompt` | `text` nullable | Imagen prompt (editable) |
| `prompts_stale` | `bool` nullable | Upstream change flag |
| `reference_asset_id` | `text` nullable | Locked env image → `lahari_assets.id` |

---

## 6. `lahari_assets` — file pointers

Resolve any `*_asset_id` → Supabase Storage URL via `storageUrl(file_path)`.

| Column | Type | Purpose |
|---|---|---|
| `id` | `text` pk | Asset id |
| `project_id` | `text` | FK → `lahari_projects.id` |
| `shot_id` | `text` nullable | FK → `lahari_shots.id` (set for shot-scoped assets) |
| `category` | `text` | `shot_image` / `shot_end_frame` / `shot_video` / `shot_ref` / `character_ref` / `environment_ref` / `style_image` / `final_render` |
| `file_path` | `text` | Supabase Storage key |
| `prompt` | `text` nullable | The prompt that produced this asset (useful for version history) |
| `metadata` | `text` nullable | JSON-serialized extra metadata |
| `created_at` | `timestamptz` nullable | Use for version-history ordering (latest-first) |

Use cases:
- Resolve `*_asset_id` pointers on shots/cast/env/project.
- List version history per shot: filter by `shot_id` + `category in ('shot_image', 'shot_end_frame', 'shot_video')`, order by `created_at desc`.
- List shot-level reference uploads: `category = 'shot_ref'`, `shot_id = ?`.

---

## 7. `lahari_chat_messages` — director chat log

| Column | Type | Purpose |
|---|---|---|
| `id` | `int4` pk (autoinc) | Message id |
| `project_id` | `text` | FK → `lahari_projects.id` |
| `role` | `text` | `user` / `assistant` |
| `text` | `text` | Message body |
| `created_at` | `timestamptz` nullable | |

Prior assistant-director turns — use as conversation memory.

---

## 8. `lahari_director_events` — durable artist/operator decision log

This is the bridge between web studio activity and future Codex director sessions. It records intent-bearing actions, not transient progress.

| Column | Type | Purpose |
|---|---|---|
| `id` | `uuid` pk | Event id |
| `seq` | `bigserial` | Strictly monotonic session cursor |
| `project_id` | `text` | FK → `lahari_projects.id` |
| `user_id` | `uuid` nullable | Supabase auth user when action came from the web studio |
| `source` | `text` | `web` / `codex` / `system` |
| `event_type` | `text` | Compact action name, e.g. `shot_locked`, `storyboard_prompt_preview_applied` |
| `entity_type` | `text` nullable | `project` / `scene` / `shot` |
| `entity_id` | `text` nullable | Target row id |
| `summary` | `text` | Human-readable one-line event summary |
| `payload` | `jsonb` | Small structured context for Codex and debugging |
| `created_at` | `timestamptz` | Event time |

Use cases:
- `attach_director_session` pulls events with `seq > lastSeq` from the local session cursor and appends them to `.lahari/sessions/<projectId>/journal.md`.
- Web studio actions write lock/unlock/edit/clear/revert/generate events.
- Codex apply tools write preview-apply and generation events.

---

## Out of scope (do NOT expose to the agent)

- **`lahari_ai_calls`** — cost/latency telemetry; admin-only.
- **`lahari_renders`** — per-render job tracking; only the render UI polling loop needs it.
- **`music_video_queue`, `songs`, `files`** — external catalog. `lahari_projects` already caches `lyrics` / `meaning` / `musical_structure`, so the agent doesn't need the source rows.
- **`batch_jobs`, `bot_conversations`, `clips`, `videos`, `projects` (unprefixed), `shots` (unprefixed), `render_jobs`** — belong to sibling services (pixel flows / timeline renderer / echo bot). Not part of the Lahari project graph.

---

## Suggested tool surface for the agent

A minimal read-only toolkit — every query scopes by `project_id` so the agent can't accidentally read across projects.

| Tool | Query |
|---|---|
| `get_project(project_id)` | `lahari_projects` by id (one row) |
| `get_scenes(project_id)` | `lahari_scenes` by project_id, order by sort_order |
| `get_shots(project_id)` | `lahari_shots` via scenes (single roundtrip: filter shots by `scene_id in (scene ids)`) |
| `get_cast(project_id)` | `lahari_cast_members` by project_id, order by sort_order |
| `get_environments(project_id)` | `lahari_environments` by project_id, order by sort_order |
| `get_asset_urls(asset_ids[])` | `lahari_assets` by id list, return `{id, url}` map |
| `get_shot_history(shot_id)` | `lahari_assets` by shot_id + category in (shot_image, shot_end_frame, shot_video), order by created_at desc |
| `get_shot_refs(shot_id)` | `lahari_assets` by shot_id + category = shot_ref |
| `get_chat_history(project_id, limit)` | `lahari_chat_messages` by project_id, order by id |

For project-overview context, a single composed call matching `getFullProject()` (see `server/routes/projects.ts:265`) is probably the right shape — parallel-fetch projects + scenes + shots + cast + environments + assets + chat in one go, return a denormalized project tree with URLs resolved.
