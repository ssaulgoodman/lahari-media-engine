# Assistant Director — Tool Surface

Inventory of the agent's tool surface, mapped against `docs/pipeline-anatomy.md` (pipeline steps) and `docs/database.sql` (schema). All write tools have `requireApproval: true`.

Sources:
- Read tools — `src/mastra/tools/lahari-tools.ts` (`lahariTools`)
- Write tools — `src/mastra/tools/lahari-write-tools.ts` (`lahariWriteTools`)

---

## Write tools (11)

### Shots — `lahari_shots`
| Tool | Fields |
|---|---|
| `update-shot-prompts` | `visual_prompt`, `motion_prompt`, `end_visual_prompt` |
| `update-shot-feedback` | `user_feedback`, `end_user_feedback` |
| `update-shot-continuity` | `continuity_from` (`cut` \| `prev_shot`), `continuity_description` |
| `update-shot-cast-env` | `cast_ids` (replaces array), `environment_id` |
| `set-shot-locked` | `locked` (boolean → 0/1) |

### Scenes — `lahari_scenes`
| Tool | Fields |
|---|---|
| `update-scene` | `section_label`, `narrative_description`, `lyrics` |

### Cast — `lahari_cast_members`
| Tool | Fields |
|---|---|
| `update-cast-member` | `name`, `description`, `generation_prompt` |

### Environments — `lahari_environments`
| Tool | Fields |
|---|---|
| `update-environment` | `name`, `description`, `generation_prompt` |

### Project — `lahari_projects`
| Tool | Fields |
|---|---|
| `update-project-meta` | `title`, `video_model`, `aspect_ratio`, `video_resolution`, `target_duration`, `color_palette` |
| `update-style-description` | `style_description` (the 30–50 word style DNA) |

### Stale flag (cross-entity)
| Tool | Fields |
|---|---|
| `mark-prompts-stale` | `prompts_stale` on shot / cast / env |

---

## Coverage vs. pipeline steps

Step numbers follow `docs/pipeline-anatomy.md`.

| Pipeline step | Schema field(s) | Editable? |
|---|---|---|
| 1 Audio Analysis (lyrics / structure / meaning) | `lyrics`, `musical_structure`, `meaning`, `cached_song_type`, `is_narrative`, `is_meditative` | No (pipeline-managed) |
| 2 Concept Generation | `concept_options`, `locked_concept` | No (pipeline-managed; UI handles inline concept edits separately) |
| 3 Script — scenes | `section_label`, `narrative_description`, `lyrics` | Yes |
| 3 Script — cast / env | `name`, `description` | Yes |
| 3 Script — shot direction | `direction` | No (pipeline-managed; intent is preserved across rewrites) |
| 4 Style — DNA text | `style_description` | Yes |
| 4 Style — assets | `style_asset_id`, `style_exploration`, `style_generation_prompt` | No (asset / pipeline-managed) |
| 5 Characters — prompt | `cast_members.generation_prompt` | Yes |
| 5 Characters — ref | `cast_members.reference_asset_id` | No (asset-bound) |
| 6 Environments — prompt | `environments.generation_prompt` | Yes |
| 6 Environments — ref | `environments.reference_asset_id` | No (asset-bound) |
| 7 Shot Prompts (bulk write) | `visual_prompt`, `motion_prompt`, `end_visual_prompt`, `continuity_from`, `continuity_description` | Yes |
| 8 Start Frame | `image_asset_id`, `image_status` | No (pipeline-managed) |
| 8 Start Frame — director note | `user_feedback` | Yes |
| 9 End Frame | `end_image_asset_id`, `end_image_status` | No (pipeline-managed) |
| 9 End Frame — director note | `end_user_feedback` | Yes |
| 10 Video Generation | `video_asset_id`, `video_status`, `attempt_count`, `last_error` | No (pipeline-managed) |
| 11 Last Frame Extraction | `extracted_last_frame_asset_id` | No (mechanical) |
| 12 Chained Shot Prompt Refresh | `refined_from_prev_frame`, rewrites of `visual_prompt` / `motion_prompt` | No (auto-runs; artist overrides via step 7 fields) |
| Lock state | `locked` | Yes |
| Project meta | `title`, `video_model`, `aspect_ratio`, `video_resolution`, `target_duration`, `color_palette` | Yes |
| Staleness | `prompts_stale` (shot / cast / env) | Yes |

---

## Deliberate gaps

Per `CLAUDE.md` and `docs/assistant-director.md`:

- **No insert tools** — row creation is owned by the upstream Lahari pipeline.
- **No delete tools** — assets are append-only (see "Version history" in `pipeline-anatomy.md` step 10); replacement is by FK swap, not in-place edit.
- **No status writes** — `image_status`, `video_status`, `end_image_status`, project `status`, `attempt_count`, `last_error`, all `*_asset_id` columns are pipeline-managed.
- **No raw AI output writes** — `lyrics`, `musical_structure`, `meaning`, `concept_options`, `locked_concept`, `style_exploration`.
- **Scene timing not editable** — `start_time`, `end_time`, `sort_order` reflect detected musical structure.
- **`shots.critique` not surfaced** — column exists but only `user_feedback` / `end_user_feedback` are exposed for director notes.
- **Out-of-scope tables** — no tools for `batch_jobs`, `bot_conversations`, `clips`, `files`, `music_video_queue`, `songs`, `videos`, `render_jobs`, `lahari_renders`, `lahari_ai_calls`, `lahari_chat_messages`, or the legacy `projects` / `shots` tables.
