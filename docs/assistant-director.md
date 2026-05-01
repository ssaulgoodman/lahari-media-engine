# Assistant Director — Agent Reference

The `assistantDirector` agent is a chat-based director's assistant for Lahari projects. It can **read** the full project graph and **edit** a curated subset of fields under an approval gate. This document is the single source of truth for what the agent sees, what it can change, and where it sits in the pipeline. Pairs with [`pipeline-anatomy.md`](./pipeline-anatomy.md) (pipeline context, every step + every prompt) and [`database.sql`](./database.sql) (live schema dump).

## Where the agent fits in the pipeline

Lahari is a 12-step pipeline (see `pipeline-anatomy.md`). The agent sits **alongside** the pipeline, not inside it — the pipeline owns row creation, AI-output writes, and asset generation; the agent owns director-facing edits to the *recipe* (prompts, descriptions, feedback, locks, project meta).

| Pipeline step | Pipeline writes | Agent edits |
|---|---|---|
| 1 Audio Analysis (lyrics / structure / meaning) | `lyrics`, `musical_structure`, `meaning`, song-type fields | — |
| 2 Concept Generation | `concept_options`, `locked_concept` | — (UI handles inline concept edits via `PATCH /:id/concept`) |
| 3 Script Generation | scenes, shots, cast, environments rows; per-shot `direction` | scene `section_label` / `narrative_description` / `lyrics`; cast & env `name` / `description` |
| 4 Style (brainstorm / visualize / refine / lock + enrich) | `style_asset_id`, `style_exploration`, `style_generation_prompt` | `style_description` (editable post-enrich) |
| 5 Characters | `cast_members.reference_asset_id` | `cast_members.generation_prompt` |
| 6 Environments | `environments.reference_asset_id` | `environments.generation_prompt` |
| 7 Shot Prompts (bulk write) | initial `visual_prompt`, `motion_prompt`, `continuity_from` | `visual_prompt`, `motion_prompt`, `end_visual_prompt`, `continuity_from`, `continuity_description`, `cast_ids`, `environment_id` |
| 8 Start Frame | `image_asset_id`, `image_status` | `user_feedback` (drives refine) |
| 9 End Frame | `end_image_asset_id`, `end_image_status` | `end_user_feedback`, `end_visual_prompt` |
| 10 Video Generation | `video_asset_id`, `video_status`, `attempt_count`, `last_error` | — (motion prompt is a step-7 field) |
| 11 Last Frame Extraction | `extracted_last_frame_asset_id` | — |
| 12 Chained Shot Prompt Refresh | rewrites `visual_prompt` / `motion_prompt`, sets `refined_from_prev_frame` | (artist overrides via step-7 prompt edits) |
| Lock state | — | `locked` (per shot) |
| Project meta | `status`, `audio_path`, `cost_estimate`, asset pointers | `title`, `video_model`, `aspect_ratio`, `video_resolution`, `target_duration`, `color_palette` |
| Staleness | sets `prompts_stale = true` automatically when upstream changes | `prompts_stale` (manual flip via tool) |

---

## Editing model

- **Update only.** No insert tools, no delete tools. Row creation belongs to the Lahari pipeline; assets are append-only — replacement is by FK swap (see "Version history" in `pipeline-anatomy.md` step 10), not in-place edit.
- **Approval-gated.** Every write tool sets `requireApproval: true`. `agent.stream()` emits a `tool-call-approval` chunk and pauses until the consumer calls `agent.approveToolCall({ runId, toolCallId })` or `declineToolCall(...)`. `generate()` callers see `finishReason: 'suspended'` and resume via `agent.approveToolCallGenerate({ runId, toolCallId })`. Snapshots persist to the LibSQL `default` store configured in `src/mastra/index.ts`.
- **Propose-then-commit.** The agent's instructions tell it to resolve the target id, show before/after in chat, and call exactly one write per turn unless explicitly authorized to batch.
- **Partial updates.** All field arguments are optional; only fields the agent passes are written. Empty patches return `{ updated: false, reason: 'no fields supplied' }`.

---

## Read tools (`src/mastra/tools/lahari-tools.ts`)

Every query scopes by `project_id` (or a downstream id like `shot_id`) so the agent can't read across projects.

| Tool | Purpose |
|---|---|
| `list-projects` | Discover project ids by title, newest first |
| `get-project` | Full `lahari_projects` row, JSON fields parsed |
| `get-project-summary` | Cheap rollup: status, style DNA, counts (cast/env/scenes/shots, locked, with start/end/video). **Call first for project-wide questions.** |
| `get-project-overview` | Denormalized tree: project + scenes + shots + cast + environments in one call |
| `list-cast` | Cast members for a project |
| `list-environments` | Environments for a project |
| `list-scenes` | Scenes (section label, formatted timestamps, lyrics, narrative) |
| `list-shots` | All shots for a project, or filtered to one scene |
| `get-shot` | One shot with parent scene metadata |
| `list-assets` | Assets for a project, optionally filtered by category |
| `get-shot-history` | Version history per shot (`shot_image` / `shot_end_frame` / `shot_video`, newest first) |
| `get-shot-refs` | Director-uploaded reference images on a shot (`category = shot_ref`) |
| `resolve-asset-urls` | Batch-resolve asset ids → 1h signed Supabase Storage URLs (only call when displaying) |
| `get-chat-history` | Prior director-chat turns for the project (continuity across sessions) |

---

## Write tools (`src/mastra/tools/lahari-write-tools.ts`)

All 11 tools have `requireApproval: true`.

| Tool | Table | Fields |
|---|---|---|
| `update-shot-prompts` | `lahari_shots` | `visual_prompt`, `motion_prompt`, `end_visual_prompt` |
| `update-shot-feedback` | `lahari_shots` | `user_feedback`, `end_user_feedback` |
| `update-shot-continuity` | `lahari_shots` | `continuity_from` (`cut` \| `prev_shot`), `continuity_description` |
| `update-shot-cast-env` | `lahari_shots` | `cast_ids` (array, JSON-stringified before write), `environment_id` (or `null` to clear) |
| `set-shot-locked` | `lahari_shots` | `locked` (bool, coerced to 0/1 int) |
| `update-scene` | `lahari_scenes` | `section_label`, `narrative_description`, `lyrics` |
| `update-cast-member` | `lahari_cast_members` | `name`, `description`, `generation_prompt` |
| `update-environment` | `lahari_environments` | `name`, `description`, `generation_prompt` |
| `update-project-meta` | `lahari_projects` | `title`, `video_model`, `aspect_ratio`, `video_resolution`, `target_duration`, `color_palette` |
| `update-style-description` | `lahari_projects` | `style_description` (the 30–50 word style DNA) |
| `mark-prompts-stale` | shots / cast / envs | `prompts_stale` (bool); pick table via `entity` arg |

### Storage quirks the write tools handle

- `lahari_shots.cast_ids` is `text` storing a JSON array — `update-shot-cast-env` calls `JSON.stringify()` before writing.
- `lahari_shots.locked`, `use_next_as_end_frame`, `refined_from_prev_frame` are `int4` (0/1), not `bool` — `set-shot-locked` coerces.
- `lahari_shots.prompts_stale`, `lahari_cast_members.prompts_stale`, `lahari_environments.prompts_stale` are real `bool` — written as-is.
- Many JSON-ish fields on `lahari_projects` and `lahari_shots` are stored as `text` (serialized JSON), not `jsonb`. Read tools parse with `JSON.parse()` server-side.
- `lahari_scenes.start_time`/`end_time` are `text` (formatted like `[M:SS]`), not numeric.

---

## Out of scope — do not add tools for these

Grouped by reason.

### Pipeline-owned (the generation pipeline writes these)

- `lahari_shots.image_status`, `end_image_status`, `video_status`, `attempt_count`, `last_error`
- `lahari_shots.refined_from_prev_frame`, `use_next_as_end_frame`
- `lahari_shots.image_asset_id`, `end_image_asset_id`, `video_asset_id`, `extracted_last_frame_asset_id`
- `lahari_cast_members.reference_asset_id`, `lahari_environments.reference_asset_id` (locking is a UI/pipeline action)
- `lahari_projects.style_asset_id`, `style_generation_prompt`, `style_exploration`
- `lahari_projects.last_concept_prompt`, `last_script_prompt`, `last_write_shots_prompt` (debugging-only fields)

### State-machine fields (changing these mid-flow corrupts pipeline state)

- `lahari_projects.status` (the `analyzing → analyzed → … → completed` progression)
- `lahari_projects.locked_concept` (set by the concept-pick UI, drives all downstream planning)

### AI-generated source-of-truth content (not director-editable through chat)

- `lahari_projects.lyrics`, `musical_structure`, `meaning`, `concept_options`

### Immutable / identity

- `lahari_assets.*` — assets are append-only. To "replace" an asset, the pipeline generates a new one and swaps the FK pointer.
- `lahari_scenes.start_time`, `end_time` — derived from detected musical structure.
- `lahari_projects.audio_path`, `parent_project_id`, `source_queue_id`, `user_id`, `created_at`, `updated_at`, `cost_estimate`
- `lahari_shots.critique` — column exists but is pipeline-written critique JSON; not surfaced to the agent.

### Out-of-scope tables entirely

- `lahari_ai_calls` (telemetry)
- `lahari_renders` (render-job state, polled by the render UI)
- `lahari_chat_messages` (read via `get-chat-history`, never written by the agent)
- All non-`lahari_*` tables: `batch_jobs`, `bot_conversations`, `clips`, `videos`, `shots` (unprefixed), `projects` (unprefixed), `songs`, `files`, `render_jobs`, `music_video_queue`

---

## Adding a new write tool

1. Confirm the field is not in the out-of-scope list above.
2. Add the tool to `src/mastra/tools/lahari-write-tools.ts` with `requireApproval: true`.
3. Use `pickDefined()` so partial updates only write fields the agent actually passed.
4. JSON-stringify any field stored as `text` (e.g. `cast_ids`); coerce booleans to 0/1 int for `int4` columns (`locked`, `use_next_as_end_frame`, `refined_from_prev_frame`).
5. Re-export it in `lahariWriteTools`.
6. Update this document's write-tools table.
7. Mention the tool in the agent's "Editing the project" instructions block in `src/mastra/agents/assistant-director.ts` so the LLM knows it exists and which guard rails apply.
