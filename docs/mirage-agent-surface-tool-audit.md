# Mirage Agent Surface — Tool-By-Tool Audit

Working sheet for Saul. Goes with `docs/mirage-agent-surface-redesign.md`.

Format: one row per tool. Plain English column says what the tool actually does. Proposal is Claude's recommendation. Why is the one-line rationale. Saul marks the call.

**Codex annotation rule:** if you disagree with Claude's proposal, add an italic note in a row directly below: `> _Codex: ..._`. Don't edit Claude's row in place — conflicts should pop out visually so Saul arbitrates instead of mediating.

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

**Open questions — resolved by Saul:**

- ✅ **Name: `lock_reference`.** Matches UI word; agent treats lock+unlock as a paired verb pair downstream.
- ✅ **`list_candidates` as registry action in slice 1, resource in slice 2.**
- ✅ **No `discard_candidates` in slice 1.** Future capability is `archive_candidates` (not `discard`) — preserves the rejected candidates as soft-archived rather than hard-deleting, so prompt-iteration history and "show me what I rejected" workflows stay possible. Not in the slice 1 surface.
- ✅ **Generic `POST /api/agent/uploads` with typed `purpose` form field.** Server validates purpose values (`cast_reference`, `env_reference`, `style_reference`, `cast_guide`, `env_guide`, `style_guide`). One endpoint, one auth path, validation pushed to the form-field check.

---

## 2. Concept (1 tool)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `apply_concept` | Commits a concept choice (text + metadata) and advances project to script phase | keep as `apply_concept` (registry) | Real operation, no merge candidates | ☐ |

---

## 3. Script (4 tools)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `apply_script` | Commits a script using structured JSON input (scenes/shots/lines) | merge → `apply_script` (registry, markdown-only input) | One canonical format per concept; markdown wins for agents | ☐ |
> _Codex: Keep structured apply as the internal canonical handler even if hosted agents prefer markdown. The visible MCP action can be `apply_script` with `format: 'markdown' | 'structured'`, default markdown. Fully dropping structured input risks losing the safest machine-to-machine path and forces parsing for programmatic updates._
| `apply_script_markdown` | Same as above but takes the strict markdown format defined in the script-apply parser | absorbed by `apply_script` | Drop structured variant; markdown becomes the single input | ☐ |
| `apply_shot_prompts` | Updates visual/motion/end-frame prompts for one or more shots | keep `apply_shot_prompts` (registry) | Real per-shot mutation | ☐ |
| `apply_shot_workflow_modes` | Sets keyframe-vs-storyboard mode (and other per-shot workflow flags) | keep `apply_shot_workflow_modes` (registry) | Real config operation | ☐ |

---

## 4. Style (1 tool — but the upload-flow pattern also applies)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `apply_style_direction` | Commits a style choice (description + asset URL) and locks the style for the project | keep `apply_style_direction` (registry, gains optional `sourceAssetId` param for use-as-is uploads) | Real operation; the style asset is the ground truth, description is locked alongside. `sourceAssetId` accepts an asset uploaded via `POST /api/agent/uploads` to support the "Use uploaded image as style" UI button. | ☐ |

**Style gap to flag** (not in current 60-tool list, but the UI exposes it): Visual Studio's StylePhase has both "Upload reference" (use as guide for generation) and "Use uploaded image as style" (use as-is, locks directly). The as-is path is covered by adding `sourceAssetId` to `apply_style_direction` above. The as-guide path would need a new MCP action — `generate_style_candidates({guideAssetId, note?})` — that doesn't exist in MCP today. Web UI handles it via its own brainstorm flow. **Decision needed:** add this action to bring the agent to parity, or accept that style brainstorming stays web-UI-only?

---

## 5. Storyboard (12 tools — biggest cluster)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `generate_storyboard` | Renders the storyboard image for one shot using the locked storyboard prompt | keep `generate_storyboard` (registry, async via start_job) | Real paid operation | ☐ |
| `plan_generate_storyboard` | Returns what generate_storyboard WOULD do without actually rendering | merge → `generate_storyboard({dryRun: true})` | Mode flag, not separate tool | ☐ |
| `apply_generate_storyboard` | Commits the result of a separate plan call | kill | Redundant — generate commits on success | ☐ |
| `bulk_generate_storyboards` | Generates storyboards for many shots in one call | keep `bulk_generate_storyboards` (registry, async; uses parallel_run internally once it ships) | Bulk operation is real; one-tool ergonomics now, parallel_run is the future shape | ☐ |
| `apply_storyboard_prompt` | Updates the storyboard text prompt for one shot | keep `apply_storyboard_prompt` (registry, supports array input for bulk) | Real text mutation; array support collapses the bulk variants | ☐ |
| `apply_storyboard_prompts_bulk` | Same but for multiple shots in one call | absorbed by `apply_storyboard_prompt` | One tool with array input | ☐ |
| `apply_storyboard_scene_markdown` | Applies storyboard prompts for a whole scene via markdown input | absorbed by `apply_storyboard_prompt` (with `format: 'markdown'`) | One tool with format param; OR drop if markdown isn't useful here | ☐ |
> _Codex: I would keep the scene-markdown path as a registry action, not absorb it immediately. It maps to the actual notebook editing workflow: edit one scene file, apply that scene. Array input and scene markdown are different ergonomics. Hide it from default Looks/Studio discovery unless notebook/file-edit mode is active._
| `refine_storyboard_image` | Re-renders a storyboard from current image + artist note (image-edit mode, not text-rewrite) | keep `refine_storyboard_image` (registry, async) | Different semantics from generate (edits an existing image vs renders fresh) | ☐ |
| `review_storyboard_prompts` | Returns storyboard prompts across project for QA / batch review | merge → resource (`mirage://projects/{id}/storyboards/prompts`) | Read-only; resource is the right shape | ☐ |
| `lock_storyboard` | Marks a storyboard as final so video gen can reference it | keep `lock_storyboard` (registry) | Real phase-gate operation; not the same as lock_reference (different entity, different semantic) | ☐ |
| `unlock_storyboard` | Reverses lock so storyboard can be regenerated | keep `unlock_storyboard` (registry) | Rare but real operation; could be a flag on lock_storyboard but separate is clearer | ☐ |
| `get_storyboard_status` | Returns generation status of all storyboards in project | merge → resource (`mirage://projects/{id}/storyboards/status`) | Read-only, agent benefits from subscribe-not-poll | ☐ |

**Net:** 12 → 6 registry actions + 2 resources. -4 killed/absorbed.

---

## 6. Video (3 tools)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `plan_generate_video` | Returns what video generation WOULD do without running | merge → `generate_video({dryRun: true})` | Mode | ☐ |
| `apply_generate_video` | Commits a planned video generation; today this is the only way to actually generate | merge → `generate_video` (registry, async via start_job) | Idempotent generate, no plan/apply split | ☐ |
| `apply_video_prompt` | Updates the video prompt text for a shot | keep `apply_video_prompt` (registry) | Real text mutation | ☐ |

**Net:** 3 → 2 actions.

---

## 7. Audio (5 tools)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `generate_dialogue_audio` | Generates TTS for one or more dialogue lines using cast voices | keep `generate_dialogue_audio` (registry, async) | Real paid operation | ☐ |
| `apply_audio_plan` | Commits an audio plan (structured input) | merge → `apply_audio_plan` (registry, markdown-only) | One format wins | ☐ |
> _Codex: Same caveat as script. Hosted agent default can be markdown, but structured should remain accepted behind the same action because audio plans are machine-produced and validated. Do not force all programmatic edits through markdown parsing._
| `apply_audio_plan_markdown` | Same but markdown input | absorbed by `apply_audio_plan` | Drop structured | ☐ |
| `apply_cast_voice` | Sets the ElevenLabs voice ID for a cast member | keep `apply_cast_voice` (registry) | Real per-cast mutation | ☐ |
| `get_audio_plan_cost` | Returns estimated TTS cost for a plan | merge → resource (`mirage://projects/{id}/audio/cost`) | Read-only | ☐ |

**Net:** 5 → 3 actions + 1 resource.

---

## 8. System / Project config (3 tools)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `apply_project_preferences` | Sets project-level prefs (text model, image model, video model, storyboard provider, etc.) | keep `apply_project_preferences` (registry) | Real config mutation | ☐ |
| `apply_project_prompt_override` | Sets a custom prompt body override for a registered tool | keep `apply_project_prompt_override` (registry) | Real prompt mutation | ☐ |
| `revert_project_prompt_override` | Removes a prompt override (back to default) | keep `revert_project_prompt_override` (registry) | Real reverse mutation | ☐ |

---

## 9. Session / Notebook (9 tools — second-biggest cluster)

This is where setup ritual lives today. Slimming hard.

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `attach_director_session` | Initializes the agent's session for a project (binds project state to current MCP session) | absorbed by cockpit `open_project` | Session bootstrap belongs in the open primitive, not a separate setup call | ☐ |
| `get_director_session` | Returns current director session state | merge → resource (`mirage://projects/{id}/director-session`) OR absorbed by `get_project_state` | Read-only; probably folds into project state | ☐ |
| `add_director_note` | Adds a free-form note to the director session for later reference | keep `add_director_note` (registry, low-priority surface) | Notes-to-self utility; could move to Codex memory tools but kept for now | ☐ |
> _Codex: Keep, but make it clearly project-journal, not agent memory. Codex memory is agent-local/cross-session; director note is project-visible/canonical handoff. Different job._
| `write_project_notebook` | Materializes the full artist workspace (mirrors/, drafts/, config/, journal.md, etc.) under `mirage/projects/<id>/` | keep `write_project_notebook` (registry) | Only used when artist edits files; per architecture "notebook only for file edits" | ☐ |
> _Codex: This should become debug/fallback, not normal registry. Preferred path is CLI sync via token because big notebooks through MCP payloads are exactly the context/payload problem. Keep it for blocked npm/CLI cases._
| `write_project_artifacts` | Writes specific artifact files to the workspace | keep `write_project_artifacts` (registry) | Same — file-edit-only path | ☐ |
| `write_project_sheets` | Writes structured data sheets to the workspace | keep `write_project_sheets` (registry) | Same — file-edit-only path | ☐ |
> _Codex: These two feel debug/reporting, not production registry. They are useful for developer audits and evidence sheets, but should not appear in the default artist-agent action flow._
| `read_project_notebook_file` | Reads a single file from the workspace by path | merge → resource (`mirage://projects/{id}/notebook/{path}`) | Read-only | ☐ |
| `get_project_notebook_manifest` | Returns the workspace file manifest (what files exist, when last written) | merge → resource (`mirage://projects/{id}/notebook/manifest`) | Read-only | ☐ |
| `hydrate_project_workbench` | Refreshes the workspace from current project state | absorbed by cockpit `open_project` (implicit refresh) | Setup ritual; should be automatic, not a separate agent call | ☐ |

**Net:** 9 → 4 actions + 2 resources + 2 absorbed into cockpit. -1 (get_director_session) goes to resource.

---

## 10. Project discovery / state (8 tools)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `create_project` | Creates a new project (intake from script or audio) | keep as cockpit `create_project` | Real bootstrap operation, frequent enough for cockpit | ☐ |
| `list_projects` | Returns list of projects the user owns | merge → resource (`mirage://projects`) | Read-only | ☐ |
| `resolve_project` | Maps a query/identifier (name or partial ID) to a project ID | absorbed by cockpit `open_project` (accepts id or name) | One open_project tool does both lookup + load | ☐ |
| `get_project_packet` | Returns full project state dump (the heavy one — drives most ceremony today) | merge → cockpit `get_project_state({detail})` slice 1 → resource (`mirage://projects/{id}/state`) slice 2 | Per architecture; detail modes control payload size | ☐ |
| `get_project_actions` | Returns the available actions for a project based on its current state | merge → cockpit `list_actions` | Per architecture; this IS list_actions in the new shape | ☐ |
| `get_shot_packet` | Returns full state for one specific shot | merge → resource (`mirage://projects/{id}/shots/{shotId}/packet`) OR `get_project_state({entityId})` | Read-only, smaller-scope variant of packet | ☐ |
| `list_queue` | Returns the project intake queue (jobs waiting to be picked up) | merge → resource (`mirage://queue`) | Read-only | ☐ |
| `search_catalog` | Searches the song catalog (music-led intake) | merge → resource (`mirage://catalog/{query}`) | Read-only | ☐ |

**Net:** 8 → 1 cockpit + 5 resources + 2 absorbed into cockpit.

---

## 11. Issue capture / debug (3 tools)

| Tool | Plain English | Proposal | Why | Saul's call |
|---|---|---|---|---|
| `mint_cli_token` | Mints a token for the local CLI (so `mirage upload-cast-reference` etc. can authenticate) | move to UI-only setup flow; remove from MCP | Agents don't mint tokens; artist generates once in web UI account settings | ☐ |
> _Codex: Disagree for now. `mint_cli_token` is exactly how the agent avoids pushing large notebook/upload payloads through chat. It should move out of the default catalog eventually, but until plugin/setup handles it cleanly, keep it as a hidden setup/debug tool, not UI-only._
| `lahari_capture_issue` | Captures an issue report (legacy from Lahari project) | kill | Migration leftover, never should have been ported | ☐ |
| `mirage_capture_issue` | Captures an issue report (the actual one) | merge → cockpit `capture_issue` | Real operation, frequent enough for cockpit, generalize the name | ☐ |

---

## Summary Tally

| Group | Today | Target | Bucket breakdown |
|---|---|---|---|
| Looks | 11 | 5 | 5 registry, 0 cockpit, 0 resource (resource later) |
| Concept | 1 | 1 | 1 registry |
| Script | 4 | 3 | 3 registry, -1 absorbed |
| Style | 1 | 1 | 1 registry |
| Storyboard | 12 | 8 | 6 registry + 2 resource, -4 killed/absorbed |
| Video | 3 | 2 | 2 registry, -1 killed |
| Audio | 5 | 4 | 3 registry + 1 resource, -1 absorbed |
| System | 3 | 3 | 3 registry |
| Session/Notebook | 9 | 6 | 4 registry + 2 resource, -3 absorbed/moved to cockpit |
| Project discovery | 8 | 6 | 1 cockpit + 5 resource, -2 absorbed |
| Issue/debug | 3 | 1 | 1 cockpit, -2 killed/moved |
| **Total** | **60** | **40** | **2 cockpit (+ 7 architecture cockpit = 9) + 28 registry + 11 resource** |

Plus the architecture cockpit primitives (not in the current 60-tool catalog yet):
- `open_project`, `list_actions`, `describe_action`, `run_action`, `start_job`, `get_job`, `list_results` = 7

So Codex's slice 1 cockpit ends up at: `open_project`, `list_actions`, `describe_action`, `run_action`, `start_job`, `get_job`, `list_results`, `create_project`, `capture_issue` = **9 cockpit tools.**

Registry actions: **28.**
Resources: **11.**
Killed outright: **8.**
Absorbed into cockpit primitives: **4.**

**Headline:** 60 → 9 in the agent's catalog (cockpit). 28 actions available via `list_actions`. 11 reads via resources (or slim tool reads in slice 1). The agent stops carrying 60 schemas every turn.

---

## Next steps

1. Codex: do annotation pass — add italic `> _Codex: ..._` notes below any row you disagree with.
2. Saul: read top-to-bottom, mark calls in the rightmost column. Ping in chat for ambiguous calls.
3. Claude: compile final decisions into the migration list in the architecture doc once Saul finishes.

## Open questions surfaced by the audit

These came up while doing the rows. Saul should answer:

1. **`lock_reference` vs `set_reference`?** UI says "lock" — agent doesn't see UI. Either works.
2. **`apply_*_markdown` vs structured input — which format wins?** I voted markdown for scripts and audio plans. Storyboard prompts are short strings, the markdown variant might not buy anything. Want to keep both for storyboard?
3. **`discard_candidates` — do we need a cleanup action?** No tool exists today for this. Web UI has no UI for it either. Cast/env asset garbage accumulates forever.
4. **`add_director_note` — keep or kill?** Codex has its own memory tools. Is the per-project session note still useful, or is it a leftover from when Codex didn't have memory?
5. **Are the 3 notebook write tools (`write_project_notebook`, `write_project_artifacts`, `write_project_sheets`) really three separate operations, or should they collapse into one `write_notebook({scope, files})`?** I kept them separate per current shape but they smell collapsible.
6. **`get_project_actions` is what `list_actions` becomes — but does the existing tool need to keep working during transition?** If yes, it's a slice-1 alias. If no, kill in slice 1.
