# Mirage Tool & Prompt Audit

Working doc for reviewing every action contract and runtime prompt template against the current architecture (D27 + style-notes + contextOverrides + graph-first).

## Purpose

Two surfaces drift independently and need periodic audit passes:

1. **Action contracts** (`server/services/actionRegistry.ts`) — the `description`/`input`/`examples` that `list_actions`/`describe_action` ship to agents (Codex, future Mirage clients). This is the agent-facing contract for each tool.
2. **Tool Recipe templates** (`server/prompts/catalog.ts`) — the artist-facing reference for what each prompt actually produces. Served by `/api/prompts` and rendered in the deployed app's `PromptsLibrary` route.

These are paired but not identical: not every action runs an LLM (e.g. `apply_concept` just persists), and not every prompt is exposed as an MCP action (e.g. `transcribe-lyrics` runs automatically on intake).

**This is the doc to read and annotate.** The sibling `docs/mirage-tool-reference.md` is the canonical zero-notes mirror — read that if you want the clean shape; read this one when you want to review and leave findings.

## How to use this doc

- Read top-to-bottom or jump by surface section.
- Leave notes in the **Notes** block under each tool. Use prose; we'll work them back into code.
- Each tool has a **Pass log** with date-stamped entries. Add a new pass line when something gets re-reviewed.
- When a finding becomes a fix, mention the commit hash in the pass log.

**Status conventions:**
- ✅ — verdict applied, looks correct against current architecture
- ⚠️ — drift or stale wording flagged, action pending
- ❌ — known wrong, change needed
- 🟡 — needs deeper review (e.g. paid call output not yet smoke-tested)

## MCP surface layout

The 25 action specs below are **not MCP tools themselves** — they dispatch through the registry layer via `run_action` / `start_job`. Active MCP surface:

| Layer | Tool count | Tools |
|---|---|---|
| Cockpit (orchestration) | 6 | `list_projects`, `open_project`, `create_project`, `get_project_state`, `get_agent_timing_summary`, `mirage_capture_issue` |
| Registry dispatch | 8 | `list_actions`, `describe_action`, `run_action`, `start_job`, `get_job`, `list_jobs`, `parallel_run`, `list_results` |
| Resources (project reads) | 3 | `get_project_notebook_manifest`, `read_project_notebook_file`, `mint_cli_token` |
| Legacy direct tools | ~50 | Hidden by default; surface only when `MIRAGE_MCP_INCLUDE_LEGACY_TOOLS=1`. |

**Active MCP surface = 17 tools.** Every action spec below is invoked through `run_action(key, input)` or `start_job(key, input)`.

## Prompt path tags

Catalog entries (`server/prompts/catalog.ts`) carry a `path` field indicating who actually fires them at runtime. The audit entries below use the same tags inline.

| Tag | Meaning | What to look for in review |
|---|---|---|
| `agent` | Fires when an MCP action invokes a backend LLM/image/video call. Same code path serves Visual Studio and agent sessions. | Wording should be agent-readable; should not contain web-only chrome or button names. |
| `web-direct` | Web button only. In agent path Codex does the equivalent work locally (edits `drafts/*.md` or saved JSON) and calls the matching `apply_*` tool — no backend LLM. | Should be clearly labeled as legacy/web-only. Should mention what the agent equivalent is. |
| `intake` | Auto-fires at project creation before any agent session exists (lyric transcription, music structure, script seed parsing). | Source-of-truth ingestion. Should be lean; no creative direction. |
| `automatic` | Fires on system events (after a shot's video lands, etc.). Not artist- or agent-triggered. | Should be invisible to the artist; failure handling should be graceful. |
| `shared` | Used by both an active path and an automatic/web path. Rare. | Should not pretend to be one when it's actually both. |

Today's distribution: 15 web-direct, 8 agent, 4 intake, 3 automatic, 1 shared.

## Index

**The rule for reading the table:** every tool below is agent-callable. **"What happens when agent calls it"** describes the actual runtime behavior — a model call, a DB save, a read, or a lock toggle. **"Web flow on same surface"** tells you what the Visual Studio UI does instead, either calling the same action or running a separate backend LLM to write text the agent would write inline.

| Tool | What happens when agent calls it | Paid? | Web flow on same surface | Verdict |
|---|---|:-:|---|:-:|
| `apply_concept` | Saves Codex-written concept JSON to DB | — | Web "Generate concept" runs `generate-concepts` LLM, user picks, then applies | ✅ |
| `apply_script` | Saves Codex-written script (JSON or markdown) to DB | — | Web "Generate script" runs `plan-scenes` LLM, then applies (`plan-scenes-openai` is a stale GPT variant, cut candidate; `refine-script` is the web refine button) | ✅ |
| `apply_shot_prompts` | Saves Codex-written visual/motion/direction text per shot | — | Web "Rewrite all" runs `write-shot-prompts` LLM, then applies. Individual refine buttons run `refine-shot-prompt` / `refine-end-frame-prompt` / `refine-video-prompt`. `chained-shot-refresh` auto-fires after a shot's video lands. | ✅ |
| `apply_shot_workflow_modes` | Sets per-shot path: `auto` / `storyboard` / `keyframe` | — | Same — web mode toggle calls this | ✅ |
| `generate_style_candidates` | Fires image model to render style reference candidates (uses `brainstorm-style-directions` or `visualize-style` prompt internally) | ● | Same — web "Brainstorm styles" calls this exact action | ✅ |
| `identify_style` | Fires vision LLM to read a style image, returns description (no DB write) | ● | Same — also auto-fires when locking a style asset with empty text | ✅ |
| `apply_style_direction` | Saves style description and/or locks a style asset | — | Web "Refine style" runs `refine-style-direction` LLM, then applies | ✅ |
| `generate_candidates` | Fires image model to render cast/env reference candidates (uses `character-look` or `environment-look` prompt internally) | ● | Same — web "Generate look" calls this. Web also has "Refine" button that runs `refine-look-prompt` LLM separately to rewrite the saved prompt. | ✅ |
| `list_candidates` | Reads candidate URLs/asset IDs for one entity from DB | — | Same — web reads this | ✅ |
| `lock_reference` | Sets canonical character/env reference (DB toggle) | — | Same — web "Lock" calls this | ✅ |
| `generate_storyboard` | Fires image model to render storyboard from saved prompt | ● | Same — web "Generate storyboard" calls this | ✅ |
| `bulk_generate_storyboards` | Fires image model per shot for many storyboards | ● | Same — web "Generate all" calls this | ✅ |
| `apply_storyboard_prompts` | Saves Codex-written storyboard prompt + cut plan text | — | Web "Board prompts" runs `seedance-storyboard-image` planner LLM, then applies | ✅ |
| `refine_storyboard_image` | Fires image edit model with a Codex-translated narrow edit instruction | ● | Same — web "Refine" edit_image mode calls this. Web also has separate "Redo" mode that runs `seedance-storyboard-refine` LLM to rewrite saved text. | ✅ |
| `lock_storyboard` | Approves a storyboard version for video gen (DB toggle) | — | Same — web "Lock" calls this | ✅ |
| `unlock_storyboard` | Clears storyboard approval (DB toggle) | — | Same — web "Unlock" calls this | ✅ |
| `generate_video` | Fires video model (Seedance or Veo) to render shot clip | ● | Same — web "Generate video" calls this | ✅ |
| `apply_video_prompt` | Saves Codex-written keyframe motion prompt | — | Same — web "Save motion prompt" calls this. Web "Refine" button separately runs `refine-video-prompt` LLM. | ✅ |
| `generate_dialogue_audio` | Fires TTS (ElevenLabs) for dialogue lines (no LLM) | ● | Same — web "Generate dialogue" calls this | ✅ |
| `apply_audio_plan` | Saves Codex-written dialogue + sound notes per shot | — | Web "Write dialogue" runs `write-audio-plan` LLM, then applies | ✅ |
| `apply_cast_voice` | Assigns ElevenLabs voice ID to a cast member | — | Same — web voice picker calls this | ✅ |
| `apply_project_preferences` | Saves project model/provider routing | — | Same — web preferences panel calls this | ✅ |
| `apply_project_style_notes` | Saves project per-surface style notes (taste memory) | — | Same — agent-driven today; web UI not yet wired | ✅ |
| `apply_project_prompt_override` | Saves project-scoped prompt recipe override | — | Same — web prompt override editor calls this | ✅ |
| `revert_project_prompt_override` | Rolls back a project prompt override (DB toggle) | — | Same — web "Revert" calls this | ✅ |

**Quick takeaways for the audit pass:**
- Tools where **"Web flow"** says "Same — web calls this action" → only one path exists. Cleanest tools. Just audit the action's contract.
- Tools where **"Web flow"** names a separate LLM (e.g. `generate-concepts`, `plan-scenes`) → two parallel paths to the same DB surface. The named LLM is a web-only legacy that will get cut when the corresponding button is deprecated. Audit both the action contract AND whether the named LLM is still needed.
- **Cut candidates today:** `plan-scenes-openai` (stale GPT-5.5 experiment, env-flagged, never default).
- **Conditional cuts** (deprecate when web UI button goes): `generate-concepts`, `refine-concept`, `plan-scenes`, `refine-script`, `write-shot-prompts`, `refine-shot-prompt`, `refine-end-frame-prompt`, `refine-video-prompt`, `refine-look-prompt`, `refine-style-direction`, `seedance-storyboard-image` planner, `seedance-storyboard-refine` replan branch, `write-audio-plan`. 13 LLM prompts will go when the web UI is reshaped around the agent surface.

Last reviewed across the table: commit `e654790`.

**Pipeline-only prompts (no MCP action surface):**

| Recipe | Path | Stage | Purpose |
|---|---|---|---|
| `transcribe-lyrics` | intake | audio | Timestamped lyric extraction at audio intake |
| `detect-structure` | intake | audio | Musical sections + song-type classification |
| `summarize-meaning` | intake | audio | 150-word interpretive song summary |
| `critique-shot-image` | automatic | utilities | Auto-fires after a shot frame lands; 0–10 score |
| `describe-frame` | automatic | utilities | Continuity description for chained shots |
| `chat-with-director` | web-direct | utilities | Web Chat panel; no agent equivalent (agent IS the chat) |

**At-a-glance read:** of 31 catalog entries, 15 are web-direct (legacy refines and bulk-writes), 8 are agent-callable (image/video generation + style brainstorm), 4 fire at intake, 3 fire automatically on system events, 1 is shared. Audit priority: web-direct entries should clearly point at the agent-path equivalent; agent entries should be lean since Codex sees them on every relevant call.

---

## Concept

### apply_concept

**Surface:** concept | **Mutates:** yes | **Paid:** no

**Description:** Persist a Codex-written locked concept object. Reapplying is the edit path.

**Input:**
- `projectId` — string
- `concept` — `{ title, direction, description, mood? }`
- `baseHash` — optional string
- `force` — optional boolean

**Example:** `{ projectId, concept: { title: 'Quiet Signal', direction: '...', description: '...' } }`

**Runtime prompt — generate-concepts:**

- Trigger: web "Generate concept" button or initial intake. Agent path: Codex writes directly, no LLM call needed.
- Stage: blueprint
- Model: `project.text_provider`
- Builder: `server/prompts/concept.ts` → `buildGenerateConceptPrompt`
- Variables: `title`, `language`, `userNotePolicy`, `sourceText`, `meaning`, `musicalStructure`, `scriptSummary`, `songType`, `isNarrative`, `isMeditative`, `context`, `directorBrief`, `userNote`
- Template body (abridged): proposes 3 concepts (or 1 with directorBrief), forbids art-style language, USER NOTE POLICY translates conflicts to concept-layer intent.

**Runtime prompt — refine-concept:**

- Trigger: web "Refine" on locked concept. Agent path: Codex edits the concept JSON directly and calls `apply_concept` with `baseHash`.
- Stage: blueprint
- Model: `project.text_provider.refine`
- Builder: `server/prompts/concept.ts` → `buildRefineConceptPrompt`
- Variables: `lockedConcept`, `feedback`, `userNotePolicy`
- Template body: surgical refine, preserve locked fields, refuse style/medium asks at this layer.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): wording cleanup — generate-concepts USER NOTE POLICY no longer references dead "preset" constraint. Summary clarified legacy web vs agent path. apply_concept registry entry already correctly framed as "Codex-written".

---

## Script

### apply_script

**Surface:** script | **Mutates:** yes | **Paid:** no

**Description:** Persist project cast, environments, scenes, and shots. Accepts structured script JSON or one Mirage script markdown draft.

**Input:**
- `projectId` — string
- `script` — optional structured script object
- `markdown` — optional `mirage-script-v1` markdown
- `baseFingerprint` — optional string
- `force` — optional boolean

**Example:** `{ projectId, markdown: '---\nformat: mirage-script-v1\n...' }`

**Runtime prompts:**

- **plan-scenes** — Initial script generation. Builder: `server/prompts/planScenes.ts` → `buildPlanScenesPrompt`. Model: `project.script_writer`. Extended thinking + validation loop. Used when Codex needs the engine to generate from scratch (rare in agent path).
- **plan-scenes-openai** — GPT-5.5 alternative; same composed prompt, different worker.
- **parse-script-intake** — Conversion path when user uploads a script seed. Builder: `server/prompts/parseScript.ts`.
- **refine-script** — Surgical refine. Builder: `server/prompts/refineScript.ts`. Preserves IDs, no rename of cast/env.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): plan-scenes summary no longer says "preset rules"; parse-script-intake summary now reads "reads the project graph for extraction/planning targets."

---

### apply_shot_prompts

**Surface:** script | **Mutates:** yes | **Paid:** no

**Description:** Persist Codex-written visual, motion, direction, or continuity prompt text for one or more shots. This is the prompt-edit path; use it when the artist asks for a tonal/wording change rather than a media regenerate.

**Input:**
- `projectId` — string
- `shots` — array of `{shotId, visualPrompt?, motionPrompt?, direction?, continuityFrom?, baseHash?}`
- `force` — optional boolean

**Example:** `{ projectId, shots: [{ shotId, motionPrompt: 'Slow push-in.' }] }`

**Runtime prompts:**

- **write-shot-prompts** — Bulk shot prompt writing. Builder: `server/prompts/shotPrompts.ts`. Composed via composePrompt. USER NOTE POLICY translates conflicts with locked style ref / project data.
- **refine-shot-prompt** — Single-shot visual prompt refine. Builder: `server/services/claude.ts` → `refineFramePrompt`.
- **refine-end-frame-prompt** — End-frame prompt surgical refine. Same builder.
- **refine-video-prompt** — Motion prompt refine; sees start/end frames, not style/scene.
- **chained-shot-refresh** — Automatic prev-frame-grounded rewrite (keyframe mode only). Builder: `server/services/claude.ts` → `refreshChainedShotPrompt`.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): apply_shot_prompts contract reframed as "prompt-edit path vs media regenerate." write-shot-prompts summary + USER NOTE POLICY body no longer reference dead "preset rules."

---

### apply_shot_workflow_modes

**Surface:** script | **Mutates:** yes | **Paid:** no

**Description:** Persist per-shot workflow path overrides: auto, storyboard, or keyframe.

**Input:**
- `projectId` — string
- `shots` — array of `{shotId, workflowMode, note?}`

**Example:** `{ projectId, shots: [{ shotId, workflowMode: 'storyboard' }] }`

**No runtime prompt** — pure DB write.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): no change needed; already clean.

---

## Style

### generate_style_candidates

**Surface:** style | **Mutates:** yes | **Paid:** yes

**Description:** Generate reusable style reference candidates. Use guideAssetId after uploading an image as visual guidance, note for soft direction, or promptOverride for one exact candidate.

**Input:**
- `projectId` — string
- `note` — optional string
- `promptOverride` — optional exact final style prompt; returns one candidate
- `guideAssetId` — optional uploaded style guide asset id
- `count` — optional 1-4
- `contextOverrides` — `{ includeConcept?, includeProjectStyleDescription?, includeGuideAsset?, styleNoteSections? }`

**Example:** `{ projectId, guideAssetId, note: 'keep the crude flat cartoon look' }`

**Runtime prompts:**

- **brainstorm-style-directions** — Text brainstorm of 4 style directions. Builder: `server/prompts/styleBrainstorm.ts`. Uses styleNotes when learned. Range = variety inside the user note.
- **visualize-style** — One reusable style reference frame from a locked direction. Builder: `server/prompts/visualizeStyle.ts`. Action invariants (no text, no watermark) live in OUTPUT CONTRACT.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): contextOverrides example now includes `styleNoteSections` for consistency. visualize-style summary fixed (was referencing dead "preset style/quality rules").

---

### identify_style

**Surface:** style | **Mutates:** no | **Paid:** yes

**Description:** Analyze the locked or provided style asset and return a concise style description for artist confirmation.

**Input:**
- `projectId` — string
- `assetId` — optional style asset id; defaults to locked style

**Example:** `{ projectId }`

**Runtime prompt — analyze-image-style:**

- Trigger: when locked style asset has no/weak description; auto-fires on lock per C4.
- Stage: utilities
- Model: `project.text_provider.refine`
- Builder: `server/services/claude.ts` → `analyzeImageStyle`
- Output: 2-3 sentence style fragment.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): already clean.

---

### apply_style_direction

**Surface:** style | **Mutates:** yes | **Paid:** no

**Description:** Persist style direction text and/or lock an existing style asset as the project style. When locking a style asset with empty style text, Mirage auto-identifies a concise style description.

**Input:**
- `projectId` — string
- `style` — `{ styleDescription?, styleGenerationPrompt?, colorPalette?, sourceAssetId? }`
- `baseHash` — optional string
- `force` — optional boolean

**Example:** `{ projectId, style: { sourceAssetId, styleDescription: 'soft luminous anime portrait style' } }`

**Runtime prompt — refine-style-direction:**

- Trigger: web "Refine" on a style direction. Agent path: Codex edits direction text and calls `apply_style_direction`.
- Stage: blueprint
- Model: `project.text_provider.refine`
- Builder: `server/prompts/refineStyle.ts` → `buildRefineStylePrompt`
- USER NOTE POLICY: surgical, preserve identity, translate medium conflicts to safe analogue.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): refine-style-direction template uses STYLE NOTES not TASTE. Auto-identify on lock (C4) referenced in description.

---

## Looks

### generate_candidates

**Surface:** looks | **Mutates:** yes | **Paid:** yes

**Description:** Generate reusable character or environment reference candidates. Use note for soft direction, promptOverride for an exact final prompt, and guideAssetId after uploading an image as a visual guide.

**Input:**
- `projectId` — string
- `entityType` — `"cast" | "environment"`
- `entityIds` — string[]
- `note` — optional string
- `promptOverride` — optional string; only one entityId may be used
- `guideAssetId` — optional existing Mirage asset id
- `contextOverrides` — `{ includeStyleImage?, includeProjectStyleDescription?, styleNoteSections? }`

**Example:** `{ projectId, entityType: 'cast', entityIds: ['cast_uuid'], note: 'make the outfit simpler...' }`

**Runtime prompts:**

- **character-look** — Builder: `server/prompts/lookPrompts.ts` → `buildCharacterLookPrompt`. Action invariants (neutral pose, plain bg, no scene action) live in OUTPUT CONTRACT. Style comes from style image + style-notes image bucket.
- **environment-look** — Same builder, `buildEnvironmentLookPrompt`. Whole space visible. No characters unless tiny for scale.
- **refine-look-prompt** — Web-direct path. Rewrites the reusable cast/env prompt text. Agent path: Codex edits the prompt and re-runs generate_candidates with promptOverride.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): character-look + environment-look TASTE blocks swapped to STYLE NOTES + PROJECT OVERRIDE. Variables synced to actual builder signature.

---

### list_candidates

**Surface:** looks | **Mutates:** no | **Paid:** no

**Description:** List generated candidate image URLs and asset IDs for one cast member or environment.

**Input:** `{ projectId, entityType, entityId }`

**No runtime prompt** — pure DB read.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): already clean.

---

### lock_reference

**Surface:** looks | **Mutates:** yes | **Paid:** no

**Description:** Set an existing Mirage asset as the canonical character or environment reference. Use after list_candidates or /api/agent/uploads.

**Input:** `{ projectId, entityType, entityId, sourceAssetId }`

**No runtime prompt** — pure DB write.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): already clean.

---

## Storyboard

### generate_storyboard

**Surface:** storyboard | **Mutates:** yes | **Paid:** yes

**Description:** Render a storyboard board for one shot from its saved storyboard prompt. dryRun returns the plan without spending.

**Input:**
- `projectId` — string
- `shotId` — string
- `dryRun` — optional boolean
- `artistNote` — optional soft direction for image generation
- `modelOverride` — optional storyboardProvider override
- `contextOverrides` — `{ includeStyleImage?, excludeCastRefs?, includePreviousStoryboard?, styleNoteSections? }`

**Example:** `{ projectId, shotId, dryRun: true }`

**Runtime prompt — render-seedance-storyboard-image:**

- Stage: studio
- Model: `project.storyboard_provider` (nano-banana-2 / nano-banana-pro / gpt-image-2)
- Builder: `server/services/storyboard.ts` → `generateStoryboardVersion`
- Sends saved `storyboardPrompt` + locked refs. Cut plan is NOT sent here (it's for downstream video).
- In edit_image refine mode, the previous storyboard image is prepended.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): no change needed.

---

### bulk_generate_storyboards

**Surface:** storyboard | **Mutates:** yes | **Paid:** yes

**Description:** Generate missing/stale/error storyboard boards for selected shots. Use parallel_run for custom parallel batches.

**Input:**
- `projectId` — string
- `shotIds` — optional string[]
- `force` — optional boolean
- `artistNote` — optional soft direction
- `modelOverride` — optional storyboardProvider override
- `contextOverrides` — applied per shot

**Example:** `{ projectId, shotIds: ['shot_a', 'shot_b'], force: true }`

**Same runtime template as generate_storyboard.**

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): no change needed.

---

### apply_storyboard_prompts

**Surface:** storyboard | **Mutates:** yes | **Paid:** no

**Description:** Persist Codex-written storyboard prompt and cut-plan text. Accepts either structured shots[] or one scene markdown draft. Edit the saved text here when "make it brighter" / "less grungy" is really a prompt change; do not use refine_storyboard_image for prompt rewrites.

**Input:**
- `projectId` — string
- `shots` — optional array of `{shotId, storyboardPrompt, storyboardCutPlan?, baseHash?}`
- `markdown` — optional `mirage-storyboard-scene-v1` markdown
- `force` — optional boolean

**Example:** `{ projectId, shots: [{ shotId, storyboardPrompt: '...', storyboardCutPlan: '...' }] }`

**Runtime prompt — seedance-storyboard-image (the planner that writes the persisted prompt):**

- Stage: studio
- Model: `project.text_provider.refine`
- Builder: `server/prompts/storyboard.ts` → `buildStoryboardPlannerPrompt`
- STYLE NOTES + PROJECT OVERRIDE wired. Per-model phrases included for active storyboard provider.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): description now explicitly cross-references refine_storyboard_image so agents pick the right tool. Template TASTE block replaced with STYLE NOTES + PROJECT OVERRIDE.

---

### refine_storyboard_image

**Surface:** storyboard | **Mutates:** yes | **Paid:** yes

**Description:** Edit the current storyboard image using a narrow positive edit instruction (image-edit mode, not prompt rewrite). Codex translates raw artist chat into a concrete one-axis change before calling this; do not forward "make it less grungy" / "make it brighter" style notes verbatim. If the prompt itself is wrong, use apply_storyboard_prompts instead.

**Input:**
- `projectId` — string
- `shotId` — string
- `feedback` — concise positive edit instruction written by Codex from artist intent — describes the specific visual change to apply while preserving everything else
- `previousVersionId` — optional string
- `modelOverride` — optional storyboardProvider override

**Example:** `{ projectId, shotId, feedback: 'Keep composition, characters, panel layout. Brighten lighting one stop; clean up the dirty grungy texture into a cleaner matte finish.' }`

**Runtime prompt — seedance-storyboard-refine (edit_image mode):**

- Builder: `server/services/storyboard.ts` → `generateStoryboardVersion` (edit_image branch)
- Sends previous storyboard image + saved prompt + the edit instruction.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): D27 hardening — input is no longer ambiguous "feedback"; it's a typed Codex-translated edit instruction. Example shows real Codex-written language.

---

### lock_storyboard / unlock_storyboard

**Surface:** storyboard | **Mutates:** yes | **Paid:** no

**Descriptions:**
- `lock_storyboard` — Mark one storyboard version as approved so current video generation can use it.
- `unlock_storyboard` — Clear storyboard approval so the board can be regenerated or replaced.

**No runtime prompts** — pure DB writes.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): already clean.

---

## Video

### generate_video

**Surface:** video | **Mutates:** yes | **Paid:** yes

**Description:** Generate the video clip for one shot. dryRun returns requirements, provider, and cost without spending.

**Input:**
- `projectId` — string
- `shotId` — string
- `dryRun` — optional boolean
- `promptOverride` — optional exact final video prompt
- `modelOverride` — optional videoModel override

**Example:** `{ projectId, shotId, dryRun: true }`

**Runtime prompts (one of two paths depending on shot mode):**

- **shot-video-assembly** — Keyframe mode. Just `{motionPrompt}. {refLabels}`. Action contract: motion prompt is the video instruction, ref labels are appended only when refs are attached.
- **seedance-storyboard-video** — Storyboard mode. Animates @image1 (locked storyboard) with @image2+ identity refs, follows cut plan panel-to-panel.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): contract is clean. **Open question:** generate_video does not currently document `contextOverrides`. Probably should — for parity with looks/storyboard/style and to allow Codex to exclude refs per call. Flag for next pass.

---

### apply_video_prompt

**Surface:** video | **Mutates:** yes | **Paid:** no

**Description:** Persist a Codex-written keyframe-mode motion prompt. This does not generate video.

**Input:** `{ projectId, shotId, motionPrompt, baseHash?, force? }`

**Example:** `{ projectId, shotId, motionPrompt: 'Slow push-in; Ren barely breathes.' }`

**No standalone runtime prompt** — text is the persisted artifact that downstream `generate_video` consumes.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): already correctly framed as "Codex-written."

---

## Audio

### generate_dialogue_audio

**Surface:** audio | **Mutates:** yes | **Paid:** yes

**Description:** Generate ElevenLabs TTS for selected pending/error dialogue lines. dryRun returns cost and missing voices without spending.

**Input:**
- `projectId` — string
- `dryRun` — optional boolean
- `shotIds` — optional string[]
- `dialogueIds` — optional string[]
- `characterIds` — optional string[]

**Example:** `{ projectId, dryRun: true, shotIds: ['shot_uuid'] }`

**No LLM prompt** — direct TTS call. The dialogue text being spoken comes from `apply_audio_plan`.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): already clean.

---

### apply_audio_plan

**Surface:** audio | **Mutates:** yes | **Paid:** no

**Description:** Persist Codex-written per-shot dialogue lines, sound notes, and lipsync/overlay strategy. Accepts structured shots[] or one audio-plan markdown draft.

**Input:** `{ projectId, shots?, markdown?, force? }`

**Example:** `{ projectId, markdown: '# Audio Plan Draft\n...' }`

**Runtime prompt — write-audio-plan:**

- Stage: audio
- Model: `project.text_provider`
- Builder: `server/prompts/audioPlan.ts` → `buildAudioPlanPrompt`
- Generates structured audio-plan JSON: dialogue array + soundNotes.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): write-audio-plan dead `preset` variable replaced with `projectOverride`. apply_audio_plan framed as "Codex-written."

---

### apply_cast_voice

**Surface:** audio | **Mutates:** yes | **Paid:** no

**Description:** Assign an ElevenLabs voice ID to one cast member for overlay TTS generation.

**Input:** `{ projectId, castMemberId, voiceProvider, voiceId, voiceName?, baseHash?, force? }`

**Example:** `{ projectId, castMemberId, voiceProvider: 'elevenlabs', voiceId: 'eleven_voice_id' }`

**No runtime prompt** — pure DB write.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): already clean.

---

## System

### apply_project_preferences

**Surface:** system | **Mutates:** yes | **Paid:** no

**Description:** Persist project-level model/provider preferences such as textProvider, imageModel, storyboardProvider, and videoModel.

**Input:** `{ projectId, preferences: { textProvider?, imageModel?, storyboardProvider?, videoModel? }, baseHash? }`

**Example:** `{ projectId, preferences: { videoModel: 'seedance-2.0-fast' } }`

**No runtime prompt** — pure DB write.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): already clean.

---

### apply_project_style_notes

**Surface:** system | **Mutates:** yes | **Paid:** no

**Description:** Persist per-surface project style notes learned during production — the editable taste/technique memory the project graph carries into every relevant call. Use this when the same phrasing or technique keeps improving outputs and should become project data rather than a per-call note. Lighter than apply_project_prompt_override (that one carries a full recipe; this one carries phrasing fragments).

**Input:** `{ projectId, styleNotes: { image?, storyboard?, motion?, script?, dialogue?, audio?, modelPhrases? }, baseHash? }`

**Example:** `{ projectId, styleNotes: { image: 'Flat deadpan anime lighting, clean gray bunker palette, crisp simple shadows.', storyboard: 'Use readable 2x3 panel boards with restrained blocking and no decorative camera drama.' } }`

**No runtime prompt** — but the persisted text feeds into every relevant composer call (look, style, storyboard so far; video and audio buckets exist but aren't yet read at runtime).

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): description rewritten — dropped dead `presetTaste` reference, now explains the hierarchy vs apply_project_prompt_override.
- **Open follow-up:** `motion` / `script` / `dialogue` / `audio` buckets are accepted by the schema but not yet read by any runtime builder. They're forward-compat slots. Either wire them or document them as "not yet consumed" in the next pass.

---

### apply_project_prompt_override

**Surface:** system | **Mutates:** yes | **Paid:** no

**Description:** Persist a project-scoped complete prompt recipe override for one declared kind. Use when the same complete per-call promptOverride keeps working and should become the project default. For repeated phrasing or per-surface taste fragments, prefer apply_project_style_notes (lighter, graph-data, composer-injected).

**Input:** `{ projectId, kind, body, baseHash? }`

**Example:** `{ projectId, kind: 'character_looks', body: 'Keep character references compact and faithful to the locked style.' }`

**No runtime prompt** — body is injected into PROJECT OVERRIDE section by every builder that calls `getProjectPromptOverride(projectId, kind)`.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): cross-references style notes as the lighter alternative.
- **Open follow-up from Pattern 7 (composer audit):** 8 override kinds are declared but only `storyboard`, `video`, `character_looks`, `environment_looks` are actually read by builders. `concept`, `script`, `style`, `audio_plan` still aren't wired. Either wire or document/remove.

---

### revert_project_prompt_override

**Surface:** system | **Mutates:** yes | **Paid:** no

**Description:** Remove or roll back a project-scoped prompt recipe override so the engine uses the previous active recipe or global default.

**Input:** `{ projectId, kind, baseHash? }`

**Example:** `{ projectId, kind: 'storyboard' }`

**No runtime prompt** — pure DB write.

**Notes (your audit):**

_blank_

**Pass log:**
- 2026-05-27 (`1661727`): already clean.

---

## Utilities (no MCP action surface)

These prompts fire automatically in the pipeline — they're not callable as actions. Listed here for review completeness.

### transcribe-lyrics

- Stage: audio | Model: `audio.analysis` | Builder: `server/services/gemini.ts:67-93`
- Fires at intake when no SRT/cached analysis exists.
- Output: timestamped lyrics in `[M:SS]` format, original language only.

**Notes:** _blank_

### detect-structure

- Stage: audio | Model: `audio.analysis` | Builder: `server/services/gemini.ts:detectStructure`
- Fires in parallel with transcription.
- Output: JSON with `sections`, `songType` (stotra/chant/bhajan/kirtan/song/unknown), `isNarrative`, `isMeditative`.

**Notes:** _blank_

### summarize-meaning

- Stage: audio | Model: `project.text_provider` | Builder: `server/services/claude.ts:19-51`
- Chains after lyrics.
- Output: 150-word interpretive summary in English.

**Notes:** _blank_

### critique-shot-image

- Stage: utilities | Model: `utility.vision` | Builder: `server/services/gemini.ts:136-201`
- Auto-fires after a shot frame lands.
- Scores 0-10 on style/prompt/character/technical; returns actionable suggestions.

**Notes:** _blank_

### describe-frame

- Stage: utilities | Model: `utility.vision` | Builder: `server/services/gemini.ts:210-224`
- Builds continuity description for chained shots.
- Output: 2-3 factual sentences, script-supervisor tone.

**Notes:** _blank_

### chat-with-director

- Stage: utilities | Model: `utility.text` | Builder: `server/services/gemini.ts:228-242`
- Web Chat panel only.
- Output: prompt/pipeline advice.

**Notes:** _blank_

---

## Cross-cutting open items (carried from prior audits)

These aren't tied to a single tool — they affect the whole surface.

1. **Pattern 7 — half-wired project prompt overrides.** 6 of 8 declared override kinds not consumed by any builder. (composer audit C5, in flight.)
2. **Image-worker invariants still in `preset.looks.qualityRules` etc.** Architecture step 5: sort each `preset.*Rules` line into "action invariant" (→ handler constant) vs "style note" (→ bible section, possibly empty). (Deferred to post-smoke.)
3. **`userNotePolicy` is still a first-class composer field.** Per D27 it's legacy/web-direct only — but the `ComposePromptParts` type doesn't say so. Future agents reading the type will treat it as a peer field. One-line type comment fixes it.
4. **`generate_video` lacks `contextOverrides`.** Looks/style/storyboard all have it. Video should too — Codex needs a way to exclude refs per call.
5. **Style-note buckets `motion` / `script` / `dialogue` / `audio` accepted but not yet consumed at runtime.** Forward-compat — wire or document.

---

## How to add a new pass

When you re-review a tool, append under its **Pass log**:

```
- 2026-MM-DD: <one-line summary of what changed or what was found>. <commit hash if applicable>
```

When you leave notes under a tool's **Notes** block, prefix with `SAUL:` so the diff is greppable for what's yours vs. what's auto-generated:

```
**Notes (your audit):**

SAUL: this description still feels off — "Codex-written" reads weird for the
agent. Maybe just drop the framing and let the description describe behavior.
```
