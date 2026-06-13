> Archived 2026-06-13. Core schema interpretation decisions were captured in `docs/mirage-platform-v1-ledger.md` D21 and current migrations/code. Keep this as historical audit evidence.

# Schema Audit — Mirage v1

**Date:** 2026-05-20
**Trigger:** `target_duration` field collision between anime "episode runtime" intake (StartProject) and "per-shot pacing" runtime usage (ScriptPhase / generate-script). Saul's correction: workflow-specific artist intent belongs in `project_brief` JSONB, not in engine columns.

**Lens:** every column lives in one of two buckets, per Saul's framework:
- **Engine primitive** — useful across music_video, anime, ads, reels. The engine reads it at runtime.
- **Workflow/agent intent** — workflow-specific or artist-supplied context. Belongs in `project_brief` (artist intent) or `source_payload` (seed material).

If a column is "engine primitive" only when interpreted one way and "workflow intent" the other, it's drift. That's what we just hit.

---

## Critical — fix to land the current bug

### `studio_projects.target_duration` (int4, default 8)

| Use site | Meaning |
|---|---|
| `generate-script.ts:68,146,303,377` (`basePacing`) | Per-shot pacing seconds. Engine setting. |
| `BlueprintContextBar.tsx:387` | Clamped to model's allowed durations. Per-shot. |
| `StartProject.tsx:106` (anime intake, before my fix) | Total episode runtime in seconds. Artist intent. |
| `claude.ts:411` (parseAnimeScriptToPlan) | Passed to LLM as "TARGET RUNTIME: about X seconds." |

**Verdict:** name is per-shot pacing; usage drifted to "also stash episode runtime here." Saul's resolution: `target_duration` stays as per-shot pacing (engine setting). Episode runtime intent moves to `project_brief.targetRuntime`.

**Resolved locally:** `StartProject` sends `targetRuntime`, and `server/routes/projects.ts` stores it in `project_brief.targetRuntime` while writing preset shot pacing to `target_duration`. `generate-script.ts` also clamps old polluted values so legacy test projects with `target_duration=120` do not produce 120-second shots.

---

## High — workflow-specific columns leaking into the engine row

`studio_projects` carries seven columns that are music_video-specific and always null on anime:

| Column | Status | Recommendation |
|---|---|---|
| `audio_path` | live (music_video only) | Keep — used by render audio mix + audio analysis. Anime ignores. Engine-adjacent but acceptable. |
| `lyrics` | live (music_video only) | Move to `project_brief.audioAnalysis.lyrics`. Anime never reads this. |
| `musical_structure` (TEXT JSON) | live (music_video only) | Move to `project_brief.audioAnalysis.musicalStructure`. Stored as TEXT not JSONB — drift. |
| `meaning` | live (music_video only) | Move to `project_brief.audioAnalysis.meaning`. |
| `song_type` | live (music_video only) | Move to `project_brief.audioAnalysis.songType`. |
| `is_narrative` | live (music_video only) | Move to `project_brief.audioAnalysis.isNarrative`. |
| `is_meditative` | live (music_video only) | Move to `project_brief.audioAnalysis.isMeditative`. |
| `analysis_step` | live (music_video only) | Transient flight status. Should be ephemeral state, not a project column. Move to `studio_agent_operations` or drop. |

**Cost of fixing now:** medium. The columns are read in ~6 server files (`generate-script.ts`, `generate-style.ts`, `storyboard.ts`, `openai-script.ts`, `claude.ts`, `projects.ts`). A migration would `ALTER TABLE` to drop, code updates to read from `project_brief.audioAnalysis.*` instead. ~1 day of coordinated Codex work.

**Cost of NOT fixing:** every future workflow inherits these columns as dead weight in the row, and the temptation to repurpose them for ads/reels (the exact thing that just hit us with `target_duration`) stays alive.

**Verdict:** **flag for v1.x, not v1.** Currently they work; the bug we just hit was a different field. But this is the pattern of the bug, and Saul's stance is "now is the right time to do this." If Codex agrees, do the migration before v1 ships. If not, do it in v1.1 before workflow #3.

---

## High — `cast_ids` as TEXT JSON

`studio_shots.cast_ids text` stores a JSON array string. Real cost:
- Can't FK to `studio_cast_members.id`
- Can't query "all shots referencing cast X" without scanning + parsing every row
- Every read does `JSON.parse(shot.cast_ids)` defensively

**Recommendation:** `studio_shot_cast` join table (shot_id, cast_member_id, sort_order). Engine primitive. Useful for every workflow.

**Cost:** small migration + ~10 line code change at read/write sites. Worth doing now.

---

## Medium — TEXT-stored JSON should be JSONB

| Column | Current | Should be |
|---|---|---|
| `studio_projects.concept_options` | text | jsonb |
| `studio_projects.locked_concept` | text | jsonb |
| `studio_projects.musical_structure` | text | jsonb (or moved to project_brief per above) |
| `studio_projects.style_exploration` | text | jsonb |
| `studio_assets.metadata` | text | jsonb |
| `studio_ai_calls.reference_inputs` | text | jsonb |
| `studio_ai_calls.context_chain` | text | jsonb |
| `studio_ai_calls.output_asset_ids` | text | jsonb |
| `studio_shots.critique` | text | jsonb |
| `studio_shots.cast_ids` | text (see above) | join table |

**Why it matters:** JSONB enables Postgres-native queries, indexing on keys, validation. TEXT is from when the schema mirrored SQLite. All write/read sites already `JSON.parse` — the drift is purely format.

**Verdict:** **cosmetic v1.5 cleanup.** Doesn't change behavior, doesn't block anything. Do in bulk when you do the music-video-column migration above.

---

## Medium — int4-bool drift in `studio_shots`

| Column | Current | Should be |
|---|---|---|
| `refined_from_prev_frame` | `int4 default 0` | `boolean default false` |
| `use_next_as_end_frame` | `int4 default 0` | `boolean default false` |
| `locked` | `int4 default 0` | `boolean default false` |

Read sites use `!!shot.refined_from_prev_frame` to coerce. Write sites use `0` / `1` / `useNextAsEndFrame ? 1 : 0`. Same SQLite-era drift.

**Verdict:** **v1.5 cosmetic.** Not breaking but ugly.

---

## Low / consistency

- `studio_mcp_tokens.user_id` is `text` while `studio_tenant_api_keys.user_id` is `uuid not null references auth.users(id)`. Inconsistent. Fix during the v1.5 cleanup.
- `studio_project_prompt_overrides.kind` enum lacks `'character_looks'`, `'environment_looks'`, and `'audio_plan'` — artists can't override the look-generation or audio-director prompts per-project. Real gap for the R29/R28 override contract. Add to the next migration.
- `last_script_prompt` / `last_concept_prompt` / `last_write_shots_prompt` on `studio_projects` — "remember the last prompt used" cache. Still live (drives "View prompt" buttons). Could move to `studio_ai_calls` (already has the prompt) but it's a query indirection. Acceptable.
- `studio_renders.terminal_at` / `terminal_payload` — naming leak from Modal renderer ("terminal" = final state). Cosmetic.

---

## Gaps — things not in the schema that maybe should be

- **No dialogue-line table.** Lives in `studio_shots.audio_plan` JSONB. Per ledger D2, intentional for v1 (audio_plan is the home for dialogue). If/when a voice library appears, split out.
- **No monthly provider usage rollup.** Only daily. Billing reconciliation would aggregate at query time. Defer.
- **No `project_brief` shape enforcement.** It's a free-form JSONB. Per Saul's framework that's correct — agents put intent there. But it means TypeScript types are the only contract. Worth documenting expected sub-keys (`targetRuntime`, `audioAnalysis`, etc.) in `types.ts` or a schema doc.

---

## Recommended order

If we're closing this audit before E2E ship:

1. **Now (done locally):** Backend intake handler routes `targetRuntime` → `project_brief.targetRuntime` instead of `target_duration`; `target_duration` remains per-shot pacing.
2. **Now (small, prevents future drift):** Add `'character_looks'`, `'environment_looks'`, and `'audio_plan'` to `studio_project_prompt_overrides.kind`.
3. **Now (v1 correctness):** Mirage realtime must be table-prefix aware and backed by owner-scoped RLS policies for any `studio_*` tables the browser subscribes to.
4. **Before workflow #3 (the pattern fix):** Move music_video-specific columns to `project_brief.audioAnalysis`. Or accept the dead-weight columns and revisit when adding ads/reels.
5. **v1.5 cosmetic pass:** TEXT→JSONB conversions, int4→boolean conversions, `studio_mcp_tokens.user_id` uuid+FK, optional `cast_ids` join table if querying shot/cast relationships becomes painful.

Saul's call on #4 is the big one. Doing it now means coordinated migration + ~6 service files. Doing it later means the next workflow inherits the bleed and may compound it.

---

## What Saul's framework is doing right

The audit is making me more confident in the framework, not less. Engine primitives + project_brief + source_payload is a clean 3-bucket model and most of the existing schema fits cleanly into bucket 1. The drift is concentrated in:
- Music-video-specific columns from the Lahari era (pre-abstraction)
- TEXT-JSON storage from the SQLite era
- One real conceptual collision (`target_duration` ↔ episode runtime) which we just caught

Nothing structural needs to change. The framework holds.
