# Mirage Agent Surface — Tool-By-Tool Audit

Working sheet for Saul. Goes with `docs/mirage-agent-surface-redesign.md`.

Format: one row per tool. Plain English column says what the tool actually does. Proposal is Claude's recommendation. Why is the one-line rationale. Saul marks the call.

**Codex annotation rule:** if you disagree with Claude's proposal, add a new row directly below using the format `↳ Codex` in the Tool column and put your counter-proposal + rationale in the relevant cells. Keeps the table legible — conflicts pop out as a sub-row visually nested under the parent.

## Buckets

- **cockpit** — always-on, in the ~9-tool surface
- **registry** — discovered via `list_actions`, run via `run_action`
- **resource** — read-only, URI-based, subscribable (slice 2+)
- **debug** — kept but hidden from default agent catalog
- **kill** — delete, no replacement
- **merge → X** — fold into another tool/action, drop this name
- **absorb → X** — silently handled by another tool (e.g. setup happens inside `open_project`)

## Saul's call markers

- ✅ agree with proposal
- ❌ kill (even if I proposed keep)
- 🔄 different name / different bucket — write what you want
- 💬 stop and discuss in chat

---

## 1. Looks (11 tools — slice 1 target)

This is the path we're proving the architecture on. Decisions here matter most.

**Binary-boundary resolution (per Codex Q1/Q2/Q3):** the binary upload moves OUT of MCP entirely. A new HTTPS endpoint `POST /api/agent/uploads` returns `{assetId}` after multipart upload (the agent shell-execs curl). MCP-side stays JSON-only and exposes two semantic verbs: `lock_reference` (use as-is) and `generate_*_candidates({guideAssetId})` (use as visual guide).

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `generate_character_looks` | Generates N candidate images for a cast member in the locked style | merge → `generate_character_candidates` (registry, async via start_job; gains `promptOverride` and `guideAssetId` params) | "looks" → "candidates" because we're producing choices, not committing one. `promptOverride` absorbs the apply_* twin. `guideAssetId` enables "upload as guide" flow. | ☐ |
| `apply_generate_character_looks` | Commits the result of a separate plan call (the "apply" half of plan/apply) | kill | Redundant — `promptOverride` becomes an optional param on the unified generate action | ☐ |
| `generate_environment_looks` | Generates N candidate images for an environment | merge → `generate_environment_candidates` (registry, async; same `promptOverride` + `guideAssetId` params) | Mirror of cast | ☐ |
| `apply_generate_environment_looks` | Same plan/apply leftover for envs | kill | Same redundancy | ☐ |
| `list_character_look_candidates` | Returns candidate images for a cast member | merge → `list_candidates({entityType: 'cast'})` (registry slice 1, resource slice 2) | Three near-duplicate list tools collapse to one typed action | ☐ |
| `list_environment_look_candidates` | Returns candidates for an environment | merge → `list_candidates({entityType: 'env'})` | Same collapse | ☐ |
| `list_reference_candidates` | Returns currently-locked references across entity types | merge → `list_candidates(...)` | Third near-duplicate | ☐ |
| `apply_cast_reference` | Sets a candidate image as the cast member's canonical reference | merge → `lock_reference({entityType: 'cast', sourceAssetId})` (registry) | Pure semantic action; no bytes in MCP. "Lock" matches the UI word. | ☐ |
| `apply_environment_reference` | Same for environment | merge → `lock_reference({entityType: 'env', sourceAssetId})` | Same merge | ☐ |
| `upload_cast_reference` | Uploads a new image and locks it as the cast reference (binary in via MCP base64 today) | **move OUT of MCP** → HTTPS `POST /api/agent/uploads` (multipart, bearer auth) returns `{assetId}`. Agent then calls `lock_reference({sourceAssetId})` for as-is, or `generate_character_candidates({guideAssetId})` for guide. | F1 resolved: bytes leave the agent path entirely. MCP keeps JSON-only. | ☐ |
| `upload_environment_reference` | Same for env | **move OUT of MCP** → same HTTPS endpoint, then `lock_reference({entityType: 'env', sourceAssetId})` | Same split | ☐ |

**Net:**
- **4 MCP registry actions:** `generate_character_candidates`, `generate_environment_candidates`, `list_candidates`, `lock_reference`
- **1 non-MCP HTTPS endpoint:** `POST /api/agent/uploads` (binary boundary, outside the registry)
- **2 killed:** `apply_generate_character_looks`, `apply_generate_environment_looks`
- All 4 MCP actions are registry, none cockpit.

**The two UI upload flows now have a clean MCP mirror:**

| UI button | What it means | Agent path |
|---|---|---|
| **Use as-is** (Characters / Envs / Style) | The uploaded image IS the locked asset, no generation | `POST /api/agent/uploads` → `lock_reference({sourceAssetId})` |
| **Upload as guide** (Characters / Envs / Style) | The uploaded image is an input; generate candidates that look like it but in project style | `POST /api/agent/uploads` → `generate_character_candidates({guideAssetId})` |

Same primitive (`/api/agent/uploads`), two semantic verbs (`lock_reference` vs `generate_*_candidates({guideAssetId})`). Visual Studio's two upload buttons map cleanly onto the agent's two flows. This unifies the surfaces.

**Future cleanup (post-slice-1, captured for symmetry):**

- **Add `apply_character_prompt` and `apply_environment_prompt` as registry actions.** Today Looks has no "save prompt without generating" path — prompts only get set inline via `note` or `promptOverride`. Storyboard has `apply_storyboard_prompt` for exactly this case. Mirror the pattern to Looks (and video/audio if relevant) for surface consistency. The agent should be able to write a prompt, save it, regenerate later — not be forced into "write+regenerate atomically."
- **Revisit kill of `lock_storyboard` / `unlock_storyboard`.** They do two jobs (approval marker + accidental-regen protection). Both can be replaced: approval via explicit `storyboardVersionId` on `generate_video`, protection via artist restraint. -2 tools, simpler mental model, but requires changing the video-gen contract. Slice 2-3 candidate once multi-version workflows are real.

**Open questions — resolved by Saul:**

- ✅ **Name: `lock_reference`.** Matches UI word; agent treats lock+unlock as a paired verb pair downstream.
- ✅ **`list_candidates` as registry action in slice 1, resource in slice 2.**
- ✅ **No `discard_candidates` in slice 1.** Future capability is `archive_candidates` (not `discard`) — preserves the rejected candidates as soft-archived rather than hard-deleting, so prompt-iteration history and "show me what I rejected" workflows stay possible. Not in the slice 1 surface.
- ✅ **Generic `POST /api/agent/uploads` with typed `purpose` form field.** Server validates purpose values (`cast_reference`, `env_reference`, `style_reference`, `cast_guide`, `env_guide`, `style_guide`). One endpoint, one auth path, validation pushed to the form-field check.

---

## 2. Concept (1 tool)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `apply_concept` | Commits a concept choice (text + metadata) and advances project to script phase | keep as `apply_concept` (registry) | Apply IS the verb — concept is the genesis. To change, reapply with new text. No lock/unlock primitive needed; reapplication IS the change. Versions accumulate in history; latest applied wins. | ✅ Saul |

---

## 3. Script (4 tools)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `apply_script` | Commits a script using structured JSON input (scenes/shots/lines) | merge → `apply_script` (registry, accepts array OR markdown input; drift-check via `scriptFingerprint` runs when markdown variant is provided) | Same collapse pattern as `apply_storyboard_prompts`: one tool with two input shapes. Markdown path preserves the drift-check capability Codex flagged. Apply IS the verb — reapply replaces. No lock primitive needed (no downstream pinning required). | ✅ Saul |
| `apply_script_markdown` | Same as above but takes the strict markdown format defined in the script-apply parser | absorbed by `apply_script` (markdown input mode) | One tool, two input shapes — same as storyboard collapse | ✅ Saul |
| `apply_shot_prompts` | Updates visual/motion/end-frame prompts for one or more shots | keep `apply_shot_prompts` (registry) | Real per-shot text mutation; same role as apply_storyboard_prompt for per-shot fields | ✅ Saul |
| `apply_shot_workflow_modes` | Sets keyframe-vs-storyboard mode (and other per-shot workflow flags) | keep `apply_shot_workflow_modes` (registry) | Real per-shot config operation | ✅ Saul |

---

## 4. Style (1 tool — but the upload-flow pattern also applies)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `apply_style_direction` | Commits a style choice (description + asset URL) and locks the style for the project | keep `apply_style_direction` (registry, partial updates allowed: `sourceAssetId` for image, `description` for text, either independently) | Image and text are independent partial updates on the same tool. `sourceAssetId` covers "Use uploaded image as style" (use-as-is). `description` covers the identify-style backfill path. They never mutate atomically unless the artist asked for both. | ✅ Saul |

**Style gap 1 — "Upload as guide" (✅ Saul: add it):** Visual Studio's StylePhase has "Upload reference" which uses an upload as a visual *guide* for brainstorming style candidates. No MCP equivalent today. Adding `generate_style_candidates({guideAssetId, note?, promptOverride?})` as a registry action brings the agent to parity. Net-new capability, not a migration.

**Style gap 2 — "Identify locked style" (✅ Saul: add it, simple shape):** When the artist uploads a style image as-is, `style_description` stays empty. Downstream prompts that reference it get nothing. Frame: **upload-as-is creates visual truth first; one identifying line of text helps downstream prompts know what they're working with.**

Two natural paths, both write to the same `style_description` field via `apply_style_direction({description})`:

1. **Agent identifies, artist confirms.** Agent looks at the locked style image and proposes a short line — "solarpunk Ghibli-inspired art" / "Ilya Kuvshinov-style anime portrait" / "70s analog sci-fi". Artist accepts (or rewrites) → it lands in the field.
2. **Artist types it directly.** No agent involved. Web UI text field, agent reads later.

No structured taxonomy. No bullet-list categories. The description is whatever short identifying line lets future prompts recognize the style. The agent is good at this naturally — it doesn't need a template, it just needs permission to suggest.

Surface this as a registry action discoverable when `style_description` is empty:

```ts
identify_style({ projectId })
// → agent reads locked style, returns a suggested description string for artist confirmation
// (apply happens via apply_style_direction({description}) once artist confirms)
```

**Style-only.** No entityType generalization — character/env descriptions already come from the script when it's applied, so no equivalent gap exists there.

**Hard separation stays:** `apply_style_direction({sourceAssetId})` sets the image. `apply_style_direction({description})` sets the text. Same tool, partial updates. The agent never mutates both atomically unless the artist asked for both.

---

## 5. Storyboard (12 tools — biggest cluster)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `generate_storyboard` | Renders the storyboard image for one shot using the locked storyboard prompt | keep `generate_storyboard` (registry, async via start_job; gains `promptOverride` + `guideAssetId` params for the same three modes as `generate_character_candidates`) | Mirror of looks: one tool handles plain regen / soft note / hard override / use-image-as-guide | ✅ Saul |
| `plan_generate_storyboard` | Returns what generate_storyboard WOULD do without actually rendering | merge → `generate_storyboard({dryRun: true})` | Mode flag, not separate tool | ✅ Saul |
| `apply_generate_storyboard` | Commits the result of a separate plan call | kill | Redundant — generate commits on success; `promptOverride` is a param on the unified generate | ✅ Saul |
| `bulk_generate_storyboards` | Generates storyboards for many shots in one call | keep `bulk_generate_storyboards` (registry, async). **Implemented via `parallel_run` in slice 1, not later** — storyboard bulk is the prototypical concurrency case | Bulk path is where the agent's clunky-linear behavior shows; `parallel_run` ships with slice 1 because of this | ✅ Saul (parallel NOW) |
| `apply_storyboard_prompt` | Updates the storyboard text prompt for one shot | merge → `apply_storyboard_prompts` (registry, accepts array OR markdown) | Single text-save tool with two input shapes; drift-check runs when markdown variant is provided | ✅ Saul |
| `apply_storyboard_prompts_bulk` | Same but for multiple shots in one call | absorbed by `apply_storyboard_prompts` (array input) | One tool, array form | ✅ Saul |
| `apply_storyboard_scene_markdown` | Applies storyboard prompts for a whole scene via markdown input | absorbed by `apply_storyboard_prompts` (markdown input, with `scriptFingerprint` for drift-check) | One tool, markdown form preserves drift-check capability Codex flagged | ✅ Saul (Claude flipped: collapse, not keep separate) |
| `refine_storyboard_image` | Re-renders a storyboard from current image + artist note (image-edit mode, not text-rewrite) | keep `refine_storyboard_image` (registry, async) | Different semantics from generate (edits existing image vs renders fresh) | ✅ Saul |
| `review_storyboard_prompts` | Returns storyboard prompts across project for QA / batch review | merge → resource (`mirage://projects/{id}/storyboards/prompts`) | Read-only QA list; subscribe-not-poll | ✅ Saul |
| `lock_storyboard` | Marks a storyboard as final so video gen can reference it | keep `lock_storyboard` (registry) for slice 1. **Flagged for slice 2-3 kill** once `generate_video({storyboardVersionId})` makes lock redundant | Real phase-gate today; bloat reduction parked behind video-gen contract change | ✅ Saul (kill later) |
| `unlock_storyboard` | Reverses lock so storyboard can be regenerated | keep `unlock_storyboard` (registry) for slice 1. **Killed alongside `lock_storyboard` in slice 2-3** | Pair with lock | ✅ Saul (kill later) |
| `get_storyboard_status` | Returns generation status of all storyboards in project | merge → resource (`mirage://projects/{id}/storyboards/status`) | Read-only generation-state, agent benefits from subscribe-not-poll | ✅ Saul |

**Net (slice 1):** 12 → 5 registry actions + 2 resources. -5 killed/absorbed.
**Net (after slice 2-3 lock kill):** 12 → 3 registry actions + 2 resources. -7 killed/absorbed.

**Storyboard surface decisions:**

- **`parallel_run` lands in slice 1** (was slice 2-3). Storyboard bulk is the natural test case for the concurrency primitive.
- **One unified `apply_storyboard_prompts`** with array OR markdown input. Drift-check runs in markdown mode (preserves the capability Codex flagged). Honest one-tool version of the three originals.
- **`lock_storyboard` / `unlock_storyboard` survive slice 1**, slated for kill in slice 2-3 once `generate_video` takes `storyboardVersionId` directly. Approval becomes "use this specific version" rather than "this version is the chosen one"; protection becomes artist restraint.

**Future capability (post-slice-1, captured for symmetry):**

- **Mirror the apply-prompt pattern to Looks and Envs.** Add `apply_character_prompt({castMemberId, prompt})` and `apply_environment_prompt({environmentId, prompt})` as registry actions. Today Looks has no "save prompt without generating" path — prompts only get set inline via `note` or `promptOverride` on the generate call. Same gap fix as the storyboard write-prompt path.
- **Lahari V2 grammar — declined.** `lock_storyboard` / `refine_storyboard_image` stay. "Choose" doesn't read right. Current names match Studio UI verbatim and the agent surface follows.

---

## 6. Video (3 tools)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `plan_generate_video` | Returns what video generation WOULD do without running | merge → `generate_video({dryRun: true})` | Same kill as plan_generate_storyboard — dryRun mode replaces the separate plan tool | ✅ Saul |
| `apply_generate_video` | Commits a planned video generation; today this is the only way to actually generate | merge → `generate_video` (registry, async via start_job; supports `promptOverride`, `refs`, `dryRun`) | Idempotent generate, no plan/apply split. Mirror of looks/storyboard pattern. | ✅ Saul |
| `apply_video_prompt` | Updates the video prompt text for a shot | keep `apply_video_prompt` (registry) | Real text mutation; same role as apply_storyboard_prompt for the video field | ✅ Saul |

**Net:** 3 → 2 registry actions. -1 killed.

**Note on params:** Video doesn't have a `guideAssetId` equivalent because video gen already takes input refs (storyboard image, start frame, cast/env refs). The "guide" concept is implicit in those existing refs. So `generate_video` lands with `promptOverride` + `refs` + `dryRun` but no separate guide param.

---

## 7. Audio (5 tools)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `generate_dialogue_audio` | Generates TTS for one or more dialogue lines using cast voices | keep `generate_dialogue_audio` (registry, async via start_job; supports `promptOverride` for voice direction, `dryRun` for cost preview) | Real paid operation. Mirror of looks/storyboard generate pattern. | ✅ Saul |
| `apply_audio_plan` | Commits an audio plan (structured input) | merge → `apply_audio_plan` (registry, accepts array OR markdown input; drift-check runs when markdown variant is provided) | Same collapse pattern as `apply_script` and `apply_storyboard_prompts`: one tool, two input shapes. Markdown path preserves drift-check capability Codex flagged. | ✅ Saul |
| `apply_audio_plan_markdown` | Same but markdown input | absorbed by `apply_audio_plan` (markdown input mode) | One tool, two input shapes — same as script/storyboard collapse | ✅ Saul |
| `apply_cast_voice` | Sets the ElevenLabs voice ID for a cast member | keep `apply_cast_voice` (registry) | Real per-cast config mutation | ✅ Saul |
| `get_audio_plan_cost` | Returns estimated TTS cost for a plan | merge → resource (`mirage://projects/{id}/audio/cost`) | Read-only cost data; subscribe-not-poll when plan changes | ✅ Saul |

**Net:** 5 → 3 registry actions + 1 resource. -1 killed/absorbed.

---

## 8. System / Project config (3 tools)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `apply_project_preferences` | Sets project-level prefs (text model, image model, video model, storyboard provider, etc.) | keep `apply_project_preferences` (registry) | Real config mutation | ✅ Saul |
| `apply_project_prompt_override` | Sets a custom prompt TEMPLATE body for a registered tool, scoped to this project | keep `apply_project_prompt_override` (registry, default surface — NOT debug) | First-class feature: how the artist's accumulated taste shapes the engine over time. Per architecture §8, this is the graduation path from per-call experiment to project-wide preference. Skill teaches: if the agent ships the same per-call `promptOverride` repeatedly, suggest promoting it here. | ✅ Saul |
| `revert_project_prompt_override` | Removes a project's prompt override (engine falls back to global default in `server/prompts/*`) | keep `revert_project_prompt_override` (registry, default surface) | Real reverse mutation; paired with override | ✅ Saul |

---

## 9. Session / Notebook (9 tools — second-biggest cluster)

This is where setup ritual lives today. Slimming hard. All three Codex counters accepted.

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `attach_director_session` | Initializes the agent's session for a project (binds project state to current MCP session) | absorbed by cockpit `open_project` | Session bootstrap belongs in the open primitive, not a separate setup call | ✅ Saul |
| `get_director_session` | Returns current director session state | merge → resource (`mirage://projects/{id}/director-session`) | Read-only; folds into the resource layer slice 2 | ✅ Saul |
| `add_director_note` | Adds a free-form note to the director session for later reference | keep `add_director_note` (registry) — labeled clearly as **project-journal**, not agent memory | Codex's clarification stands: agent memory = agent-local/cross-session (lives in Codex's own memory tools); director note = project-canonical/visible-to-others (lives in Mirage). Different jobs, not redundant. | ✅ Saul (Codex framing) |
| `write_project_notebook` | Materializes the full artist workspace (mirrors/, drafts/, config/, journal.md, etc.) under `mirage/projects/<id>/` | **Demote to debug-tier registry action** (not default surface) | Preferred path is CLI sync via token — writes files locally without serializing through MCP. MCP path stays as fallback for blocked-CLI cases only. | ✅ Saul (Codex counter) |
| `write_project_artifacts` | Writes specific artifact files to the workspace | **Demote to debug-tier registry** | Evidence-sheet / developer-audit output, not core artist flow. Shouldn't appear in default `list_actions`. | ✅ Saul (Codex counter) |
| `write_project_sheets` | Writes structured data sheets to the workspace | **Demote to debug-tier registry** | Same as above — developer-audit surface, not default artist flow. | ✅ Saul (Codex counter) |
| `read_project_notebook_file` | Reads a single file from the workspace by path | merge → resource (`mirage://projects/{id}/notebook/{path}`) | Read-only file content | ✅ Saul |
| `get_project_notebook_manifest` | Returns the workspace file manifest (what files exist, when last written) | merge → resource (`mirage://projects/{id}/notebook/manifest`) | Read-only manifest | ✅ Saul |
| `hydrate_project_workbench` | Refreshes the workspace from current project state | absorbed by cockpit `open_project` (implicit refresh) | Setup ritual; should be automatic, not a separate agent call | ✅ Saul |

**Net:** 9 → 1 default-surface registry + 3 debug-tier registry + 3 resources + 2 absorbed into cockpit.

**Surface tier matters here:** the default `list_actions` surface for an artist session shows `add_director_note` only. The three notebook-write tools are reachable but only via `list_actions({includeDebug: true})` or `list_actions({surface: 'system'})`. Keeps the agent's discoverable catalog clean while preserving capability.

---

## 10. Project discovery / state (8 tools)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `create_project` | Creates a new project (intake from script or audio) | keep as cockpit `create_project` | Real bootstrap operation, frequent enough for cockpit | ✅ Saul |
| `list_projects` | Returns list of projects the user owns | merge → resource (`mirage://projects`) | Read-only list | ✅ Saul |
| `resolve_project` | Maps a query/identifier (name or partial ID) to a project ID | absorbed by cockpit `open_project` (accepts id or name) | One open_project tool does both lookup + load | ✅ Saul |
| `get_project_packet` | Returns full project state dump (the heavy one — drives most ceremony today) | merge → cockpit `get_project_state({detail})` slice 1 → resource (`mirage://projects/{id}/state`) slice 2 | Per architecture; detail modes control payload size | ✅ Saul |
| `get_project_actions` | Returns the available actions for a project based on its current state | merge → cockpit `list_actions` | Per architecture; this IS list_actions in the new shape | ✅ Saul |
| `get_shot_packet` | Returns full state for one specific shot | merge → resource (`mirage://projects/{id}/shots/{shotId}/packet`) | Read-only, smaller-scope variant of packet — lets agent read one shot deeply without pulling whole project | ✅ Saul |
| `list_queue` | Returns the project intake queue (jobs waiting to be picked up) | merge → resource (`mirage://queue`) | Read-only | ✅ Saul |
| `search_catalog` | Searches the song catalog (music-led intake) | merge → resource (`mirage://catalog?q={query}`) | Parameterized read; fits resource model | ✅ Saul |

**Net:** 8 → 1 cockpit + 5 resources + 2 absorbed into cockpit.

**Net:** 8 → 1 cockpit + 5 resources + 2 absorbed into cockpit.

---

## 11. Issue capture / debug (3 tools)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `mint_cli_token` | Mints a token for the local CLI (so `mirage upload-cast-reference` etc. can authenticate) | **Slice 1: keep as debug-tier registry action. Slice 2-3: move to UI-only setup flow.** | Codex counter accepted with timing nuance: until plugin/account-settings UI for token generation is properly built, agent needs to be able to mint tokens for CLI flows. Once UI is polished, demote out of MCP entirely. | ✅ Saul (Codex counter w/ timeline) |
| `lahari_capture_issue` | Captures an issue report (legacy from Lahari project) | kill | Migration leftover, never should have been ported | ✅ Saul |
| `mirage_capture_issue` | Captures an issue report (the actual one) | merge → cockpit `capture_issue` | Real operation, frequent enough for cockpit, generalize the name | ✅ Saul |

---

## Summary Tally (Final)

| Group | Today | Default Registry | Debug Registry | Resources | Killed | Absorbed/Moved |
|---|---|---|---|---|---|---|
| Looks | 11 | 3 | 0 | 0 | 2 | 6 (incl. 2 upload→HTTPS) |
| Concept | 1 | 1 | 0 | 0 | 0 | 0 |
| Script | 4 | 3 | 0 | 0 | 0 | 1 |
| Style | 1 (+2 new) | 3 | 0 | 0 | 0 | 0 |
| Storyboard | 12 | 6 (4 after slice 2-3 lock kill) | 0 | 2 | 2 | 2 |
| Video | 3 | 2 | 0 | 0 | 1 | 0 |
| Audio | 5 | 3 | 0 | 1 | 0 | 1 |
| System | 3 | 3 | 0 | 0 | 0 | 0 |
| Session/Notebook | 9 | 1 | 3 | 3 | 0 | 2 |
| Project discovery | 8 | 0 | 0 | 5 | 0 | 3 (incl. 2 into cockpit) |
| Issue/debug | 3 | 0 | 1 | 0 | 1 | 1 (into cockpit `capture_issue`) |
| **Total slice 1** | **60** | **25** | **4** | **11** | **6** | **16** |

Cross-check: 25 + 4 + 11 + 6 + 16 = 62. Two of the 60 absorb upload tools into the non-MCP HTTPS endpoint and aren't separate registry/resource slots (they leave MCP entirely). Plus 2 net-new capabilities added (`generate_style_candidates`, `identify_style`).

**Architecture cockpit (not from the 60-tool catalog):**
`open_project`, `list_actions`, `describe_action`, `run_action`, `start_job`, `get_job`, `list_results`, plus migrated cockpit promotions `create_project`, `capture_issue` = **9 cockpit tools.**

**Outside-MCP transport (also new):**
`POST /api/agent/uploads` HTTPS endpoint with bearer auth + typed `purpose` form field.

### Headline numbers

- **The agent's always-visible catalog: 9 tools** (cockpit). Down from 60.
- **Discoverable via `list_actions`: 25 default-surface registry actions.** The agent reaches for these only when a session is in a relevant surface.
- **Debug-tier: 4 actions** (`mint_cli_token` + 3 notebook write tools). Available behind `list_actions({includeDebug: true})`, never default.
- **Resources: 11 read endpoints.** Subscribe-not-poll (slice 2+) or slim tool reads (slice 1 shim).
- **Killed outright: 6** (lahari_capture_issue + 4 plan/apply_generate_* leftovers + 1 plan_generate_video).
- **Absorbed: 16** — either folded into a sibling tool (markdown variants, candidate-list variants), promoted into a cockpit primitive (`resolve_project`, `get_project_actions`), or moved to the HTTPS upload endpoint.

**Net agent-facing capability: ~36 MCP-side artifacts** (9 cockpit + 25 registry + 11 resources, minus the implicit doubles), down from 60. The big win isn't the absolute number — it's that the agent only carries 9 schemas every turn instead of 60.

### Slice 2-3 future reductions

Pending the metric-based propagation:

- **Looks slice 2:** old looks/upload tools deleted after alias period (per F2). -6.
- **Storyboard slice 2-3:** `lock_storyboard` + `unlock_storyboard` killed once `generate_video({storyboardVersionId})` lands. -2.
- **Issue/debug slice 2-3:** `mint_cli_token` moved to UI-only setup. -1.

Slice 2-3 final state: ~22 default registry + 4 debug + 11 resources = ~37 MCP artifacts total, with 9 always-visible.

---

## Next steps

Audit is resolved across all 60 tools. The remaining work is:

1. **Codex slice 1 build** (in flight) — cockpit + Looks ActionSpecs + binary upload endpoint + async job + parallel_run + skill update with the two-prompt-layers section + `apply_storyboard_prompts` collapse + storyboard ActionSpecs + Storyboard `parallel_run` integration.
2. **Claude compiles** the final migration list from this audit into the redesign doc's slice 2+ section once slice 1 ships and the metric is taken.
3. **Slice 2 / 3** kick off based on slice 1's measured result.

## Future Watch Items

Three open debates from the audit that are NOT decided yet, parked here so they don't get lost. Decisions are deferred until we have real session data from slice 1+.

**1. `upload_asset` cockpit promotion.**

Currently: HTTPS endpoint outside MCP, agent uses `lock_reference` for semantic, no `upload_asset` in cockpit. **Saul's position:** keep out for now. Uploads are binary/file-system/browser-native work; MCP is cleaner for intent + mutation. **Promotion trigger:** only if agents repeatedly fail to use the Studio/CLI path, OR if "upload this local file as reference/media" becomes a common director command. Watch slice 1+ telemetry.

**2. Resource ergonomics — push-update reality check.**

Currently: planning slice-2 migration of reads to resources (`mirage://...`) with a subscribe-not-poll story. **Saul's position:** needs a real Codex/Claude test before we architect around the push-update promise. If resources are just "read whole URI once," they're fine but not transformative — equivalent to slim tool reads. If they cache/refresh well in the client, they're great for mirrors and prior-art packs. **Decision trigger:** observe actual Codex Desktop subscription behavior before slice 2 commits to a resource-heavy architecture.

**3. `archive_candidates` cleanup action.**

Currently: no MCP tool for cleaning up rejected candidates; the web UI has no UI for it either. **Saul's position:** probably slice 3, after accumulation hurts. Mirror of the media-library soft-hide pattern that already exists (`hideShotVideoFromMediaLibrary`). **Decision trigger:** wait until artists actually say "too much junk" rather than build a cleanup tool preemptively. Premature archive tools add surface area for no current pain.

## Open questions still on the table (audit-internal)

These are smaller and bounded to slice 1 work:

1. **`get_project_actions` aliasing during transition.** Once `list_actions` ships in the cockpit, do we keep the old tool as a slice-1 alias for backward compat, or hard-cut? Codex's call when they build the cockpit. Default: keep as alias for one slice, kill in slice 2 per the alias deletion commitment (F2 in redesign doc).
2. **Collapsing the 3 notebook write tools.** Audit kept `write_project_notebook` + `write_project_artifacts` + `write_project_sheets` as three separate tools, all demoted to debug-tier. They smell collapsible into one `write_notebook({scope, files})` — but since they're already off the default surface, collapsing is cleanup work, not a slice-1 priority.
