# Mirage Tool & Prompt Audit

Working doc for reviewing every action contract and runtime prompt against the current architecture (D27 + style-notes + contextOverrides + graph-first). **This is the doc to read and annotate.** Sibling `docs/mirage-tool-reference.md` is the canonical zero-notes mirror.

## How to use this doc

- Read top-to-bottom or jump by surface section.
- Leave findings in the **Notes** block under each Layer 2 action. Use prose; we'll work them back into code.
- Each action has a **Pass log** with date-stamped entries. Add a new line when re-reviewed.
- When a finding becomes a fix, mention the commit hash in the pass log.

**Status conventions:**
- ✅ — verdict applied, looks correct against current architecture
- ⚠️ — drift or stale wording flagged, action pending
- ❌ — known wrong, change needed
- 🟡 — needs deeper review (e.g. paid call output not yet smoke-tested)

---

## How the layers connect

```
Codex
  │
  │  calls MCP tool (Layer 1)
  ↓
MCP tool (e.g. run_action)
  │
  │  dispatches to an action by key (Layer 2)
  ↓
Action (e.g. apply_concept)
  │
  │  may fire 0..N LLM/image/video prompts (Layer 3)
  ↓
Prompt (e.g. character-look) — or no prompt for pure persistence
```

**Worked example — agent applies a concept:**
1. Codex calls MCP tool `run_action({ actionKey: 'apply_concept', input: { projectId, concept: {...} } })`
2. `run_action` dispatcher routes to the `apply_concept` action handler
3. Handler validates input, writes concept JSON to DB
4. Returns result. **No Layer 3 prompt fires** because `apply_concept` is pure persistence

**Compare — web user clicks "Generate concept":**
1. Backend HTTP route fires the `generate-concepts` Layer 3 prompt (web-direct tag) via the LLM
2. User picks one of the 3 returned directions
3. Backend route then calls the same `apply_concept` action internally to persist
4. Same DB write, but a Layer 3 prompt ran along the way

---

## Layer 1 — MCP tools (17 active)

### Cockpit (6) — orchestration

| Tool | Purpose |
|---|---|
| `list_projects` | List projects accessible to this auth token. |
| `open_project` | Start a session on one project; writes notebook desk copy: `state/`, root editable artifacts, `config/`, actions, skills. |
| `create_project` | Create a non-audio project from intake. |
| `get_project_state` | Current project graph snapshot. Includes `actionsHash` for schema drift detection. |
| `get_agent_timing_summary` | Quick perf snapshot. |
| `mirage_capture_issue` | Capture an artist-reported issue. |

### Registry dispatch (8) — action invocation

| Tool | Purpose |
|---|---|
| `list_actions` | List action-spec keys available for this project. |
| `describe_action` | Full schema + example for one action. |
| `run_action` | Synchronous dispatch by `actionKey`; returns result. |
| `start_job` | Async dispatch; returns `jobId` for paid actions. |
| `get_job` | Poll job state. |
| `list_jobs` | List recent jobs. |
| `parallel_run` | Small parallel batch (independent non-paid actions, cap 8). |
| `list_results` | List recent generation results. |

### Resources (3) — project file reads

| Tool | Purpose |
|---|---|
| `get_project_notebook_manifest` | List files in the project workbench. |
| `read_project_notebook_file` | Read one workbench file by path. |
| `mint_cli_token` | Issue shell-specific sync command for notebook materialization. |

**Legacy:** ~50 direct tools hidden behind `MIRAGE_MCP_INCLUDE_LEGACY_TOOLS=1`.

### Workbench artifact layout

**Notes:** _blank_

**Pass log:**
- 2026-05-29 (b2e089e): backlog #3 — collapsed editable `mirrors/` + `drafts/` pairs into single root artifacts (`script.md`, `audio-plan.md`, `storyboards/<scene>.md`); surviving read-only projections now live under `state/`.
- 2026-05-30 (86239c1, 02f4c3d): always-on surface consolidated — `AGENTS.md` is the single durable operator base, the `mirage-director` skill dissolved into it, `HOSTED_MCP_INSTRUCTIONS` trimmed ~600→~290 words to a thin starter that hands the file workflow off to AGENTS.md.
- 2026-05-30 (b6a80c1, 92ec9e7, d932cb4): response-payload audit — `open_project` now returns the `production` working set by default with `detail='full'` opt-in (the only fat-by-default tool); `list_actions` → lean index pointing at local `config/actions/<surface>.json`; `list_jobs` → status only (dropped per-job result bodies). `detail='full'` reframed as an off-path debug escape hatch.
- 2026-05-30 (9f5d11a Claude, c21f5f1 Codex): two-tier workspace layout — each NotebookFile declares `scope`; workspace-shared files (`AGENTS.md`/`CLAUDE.md`, skills, `config/actions/*`, `config/skills.json`) materialize at the workspace root, project files under `mirage/projects/<id>/`. CLI `@ssaulgoodman420/mirage-cli@0.1.3` syncs the split, skips identical shared root files across projects, and prunes old per-project copies.

---

## Layer 2 — Actions (29 live registry actions; 27 materialized for agents)

Every action is agent-callable via `run_action` / `start_job`. Quick index table first, then per-action Notes blocks for audit findings.

### Index

| Key | Surface | What it does | Calls | Paid? |
|---|---|---|---|:-:|
| `apply_concept` | concept | Saves Codex-written concept JSON to DB | DB only | — |
| `apply_script` | script | Saves Codex-written script (JSON or markdown) to DB | DB only | — |
| `apply_text_edits` | script | Safely edits existing scene title / shot direction / dialogue text without topology changes | DB only | — |
| `apply_shot_prompts` | script | Saves Codex-written visual/motion/direction text per shot | DB only | — |
| `apply_shot_workflow_modes` | script | Sets per-shot path: `auto` / `storyboard` / `keyframe` | DB only | — |
| `generate_style_candidates` | style | Renders style reference candidate batch | image model | ● |
| `identify_style` | style | Reads a style image, returns concise description | project.text_provider.refine (with image input); hidden from materialized agent action files | ● |
| `apply_style_direction` | style | Saves style description and/or locks a style asset | DB only (auto-runs `identify_style` if locking empty) | — |
| `generate_candidates` | looks | Renders 3 character/env reference candidates per entity | image model | ● |
| `list_candidates` | looks | Lists previously-generated candidates | DB read | — |
| `lock_reference` | looks | Sets canonical character/env reference | DB only | — |
| `generate_storyboard` | storyboard | Renders one storyboard image from saved prompt | image model | ● |
| `bulk_generate_storyboards` | storyboard | Renders many storyboards (per shot); hidden from materialized agent action files until async batch fan-out exists | image model | ● |
| `apply_storyboard_prompts` | storyboard | Saves Codex-written storyboard prompt + cut plan | DB only | — |
| `refine_storyboard_image` | storyboard | Edits existing storyboard with narrow instruction | image edit | ● |
| `import_storyboard_image` | storyboard | Imports an uploaded/native image as a storyboard version | DB only | — |
| `lock_storyboard` | storyboard | Approves a storyboard version for video gen | DB only | — |
| `unlock_storyboard` | storyboard | Clears storyboard approval | DB only | — |
| `generate_video` | video | Renders the video clip for one shot | video model | ● |
| `apply_video_prompt` | video | Saves Codex-written keyframe motion prompt | DB only | — |
| `analyze_audio_transcribe` | audio | Opt-in audio transcription | audio analysis model | ● |
| `analyze_audio_structure` | audio | Opt-in musical structure detection | audio analysis model | ● |
| `generate_dialogue_audio` | audio | Renders TTS for selected dialogue lines | TTS | ● |
| `apply_audio_plan` | audio | Saves Codex-written dialogue + sound notes per shot | DB only | — |
| `apply_cast_voice` | audio | Assigns ElevenLabs voice ID to a cast member | DB only | — |
| `rename_project` | system | Renames the project shell title (lists/sidebar/header); graph content untouched | DB only | — |
| `apply_project_preferences` | system | Saves project model/provider routing | DB only | — |
| `apply_project_style_notes` | system | Saves project per-surface style notes (taste memory) | DB only | — |
| `apply_project_prompt_override` | system | Saves project-scoped prompt recipe override | DB only | — |
| `revert_project_prompt_override` | system | Rolls back a project prompt override | DB only | — |

### Audit findings per action

#### apply_concept

**Notes:** _blank_

**Pass log:**
- 2026-05-27 (1661727): wording cleanup — "Codex-written" framing added to description; `generate-concepts` USER NOTE POLICY no longer references dead "preset" constraint.

#### apply_script

**Notes:** _blank_

**Pass log:**
- 2026-05-27 (1661727): wording cleanup — markdown intake path documented; `plan-scenes-openai` flagged as cut candidate.

#### apply_shot_prompts

**Notes:** _blank_

**Pass log:**
- 2026-05-27 (1661727): "Codex-written" framing added; description distinguishes prompt-edit path vs media regenerate.

#### apply_shot_workflow_modes

**Notes:** _blank_

**Pass log:** none

#### generate_style_candidates

**Notes:** _blank_

**Pass log:**
- 2026-05-27 (1661727): added `styleNoteSections` to `contextOverrides` example for consistency with looks/storyboard.
- 2026-05-29 (f97ca4c): backlog #6 — added `directions[]` agent-native input. When present, backend skips `brainstorm-style-directions` and renders each Codex-written direction directly.

#### identify_style

**Notes:**
- Redundant for agent path. Codex sees images natively and can write a 2-3 sentence style description directly into `apply_style_direction({ style: { styleDescription, sourceAssetId } })`. Paying for a separate `project.text_provider.refine` call with image input when Codex can inspect the image is waste. The Layer 3 prompt `analyze-image-style` has the same redundancy.
- Honest agent flow: when locking a style asset, Codex writes the description in the same turn as the apply. The C4 auto-identify fallback (auto-fires `analyze-image-style` inside `apply_style_direction` when text is empty) was built for cases where the apply caller doesn't bother to describe — but in agent path Codex always should.
- Hidden from materialized agent-facing `config/actions/style.json`; server-side C4 auto-identify stays as fallback for callers that lock a style asset without text.

**Pass log:**
- 2026-05-29 (this commit): backlog #11 terminology cleanup — replaced fake separate-vision-model label with `project.text_provider.refine (with image input)`.
- 2026-05-29 (this commit): backlog #8 agent-surface cleanup — removed from materialized agent action files; `analyze-image-style` is now web-direct/fallback only.

#### apply_style_direction

**Notes:** _blank_

**Pass log:** none

#### generate_candidates

**Notes:** _blank_

**Pass log:**
- 2026-05-27 (e2e18a6): `styleNoteSections` wired into contextOverrides; selected style-note buckets ship into character-look / environment-look.

#### list_candidates

**Notes:** _blank_

**Pass log:** none

#### lock_reference

**Notes:** _blank_

**Pass log:** none

#### generate_storyboard

**Notes:** _blank_

**Pass log:**
- 2026-05-27 (e2e18a6): style notes (image + storyboard buckets) wired into the planner prompt.

#### bulk_generate_storyboards

**Notes:** Live registry action, but hidden from materialized agent action files. Agents should use per-shot `start_job(generate_storyboard)` until async batch fan-out exists.

**Pass log:**
- 2026-05-30: Hidden from materialized agent surface after smoke showed blocking/sequential bulk calls were the wrong director-session primitive.

#### apply_storyboard_prompts

**Notes:** _blank_

**Pass log:**
- 2026-05-27 (1661727): "Codex-written" framing + explicit cross-reference to `refine_storyboard_image` so agents pick the right tool.

#### refine_storyboard_image

**Notes:**
- Carries half of the `seedance-storyboard-refine` shared template (the `edit_image` branch). The other half (`replan` branch) is a backend-LLM text rewrite — web-direct only; agent path bypasses by editing `storyboards/<scene>.md` and calling `apply_storyboard_prompts`.
- The "shared" tag on `seedance-storyboard-refine` is mechanical (same builder file) not semantic — the two branches do genuinely different operations.
- `refine_storyboard_image` is now pure image edit with narrow delta: previous board image + locked refs + edit instruction. It does not resend the saved storyboard prompt or cut plan. `apply_storyboard_prompts` is the Codex-written prompt rewrite path; `generate_storyboard` is fresh render.
- **Final boundary pass tracked under backlog #13** — re-review Layer 3 templates after #9 / #10 / #12 land. Likely outcome: split `seedance-storyboard-refine` into two distinct templates or collapse `replan` into the `web-direct` cut list.

**Pass log:**
- 2026-05-27 (1661727): input field clarified as Codex-translated edit instruction (D27); example shows a real positive edit instruction.
- 2026-05-29 (526844d): backlog #9 — edit-image refine no longer sends saved storyboard prompt; it sends previous image + refs + exact edit instruction.

#### lock_storyboard

**Notes:** _blank_

**Pass log:** none

#### unlock_storyboard

**Notes:** _blank_

**Pass log:** none

#### generate_video

**Notes:**
- **🟡 Smoke pending for the 2026-06-10 prompt hardening:** run 3-5 representative storyboard-mode clips to confirm the two new instruction blocks reduce ref-frame intrusion / style drift without introducing new artifacts. Paid run — Saul to trigger.

**Pass log:**
- 2026-06-10 (this commit): Seedance storyboard-video prompt hardening landed (both additions from Saul's production observations, in one slice as specced). The Identity refs block now ends with "Reference images are guides, not frames. Never insert them into the video — even briefly, even for a single frame — between or during panels." (targets the ~25% ref-frame intrusion); a new "Style discipline" paragraph after preserve-identity pins rendering/palette/line/texture to @image1 + the locked style ref and forbids mid-clip drift toward photoreal/generic (targets style drift). `board_plus_timing` variant only. Catalog template + `mirage-tool-reference.md` contract synced.

#### apply_video_prompt

**Notes:** _blank_

**Pass log:** none

#### generate_dialogue_audio

**Notes:** _blank_

**Pass log:** none

#### apply_audio_plan

**Notes:** _blank_

**Pass log:**
- 2026-05-27 (1661727): "Codex-written" framing added.

#### apply_cast_voice

**Notes:** _blank_

**Pass log:** none

#### rename_project

**Notes:** _blank_

**Pass log:**
- 2026-06-10 (this commit): action created (smoke feedback item 15 P1 "project-visible title sync"). Renames the project shell title only; refuses empty/oversize titles; no-op receipt when unchanged; records `project_renamed` director event + journal entry; receipt refreshes the brief notebook mirror. Concept/graph content untouched — title sync is explicit, not a hidden side effect of `apply_concept`.

#### apply_project_preferences

**Notes:** _blank_

**Pass log:** none

#### apply_project_style_notes

**Notes:** _blank_

**Pass log:**
- 2026-05-27 (e2e18a6): action created — per-surface style-note buckets persisted in DB.
- 2026-05-27 (1661727): description dropped dead `presetTaste` reference; framed as lighter alternative to `apply_project_prompt_override`.

#### apply_project_prompt_override

**Notes:** _blank_

**Pass log:**
- 2026-05-27 (1661727): description now cross-references style notes as the lighter alternative for phrasing fragments.

#### revert_project_prompt_override

**Notes:** _blank_

**Pass log:** none

---

## Layer 3 — Prompts (28 total), grouped by path tag

The `path` tag on each prompt tells you who fires it at runtime. Contracts below are quoted verbatim from the prompt builder's `coreTask` (or its inline service equivalent).

### Agent (6) — fires when an MCP action invokes a paid model

These are the prompts Codex's actions actually trigger.

#### visualize-style `[agent]`

Renders one selected text style direction into a reusable style reference frame.

- Triggered by: `generate_style_candidates` (per direction render step)
- Model: `project.image_model`
- Inputs: styleDescription, subject, styleNotes
- Contract: *Generate one reusable visual style reference frame for this project. The frame should demonstrate the style system clearly — lighting behavior, color palette, texture or medium, rendering approach, atmosphere — using a simple motif, anonymous figure, prop vignette, environment detail, or production-design element that belongs to the project. This is not a character design sheet, storyboard panel, poster, collage, or title card.*
- Output: image. High production value. No text. No watermark.

#### character-look `[agent]`

Renders one reusable character or object reference for production continuity.

- Triggered by: `generate_candidates({ entityType: 'cast' })`
- Model: `project.image_model`
- Inputs: character.name, character.description, styleImage, styleDescription, userRefImage, styleNotes, projectOverride
- Contract: *Generate one reusable character or object reference for production continuity.*
- Output: one isolated image. Neutral pose, plain/soft background. No collage, grid, text, or scene-specific props.

#### environment-look `[agent]`

Renders one reusable environment reference.

- Triggered by: `generate_candidates({ entityType: 'environment' })`
- Model: `project.image_model`
- Inputs: environment.name, environment.description, styleImage, styleDescription, userRefImage, styleNotes, projectOverride
- Contract: *Generate one reusable environment reference for production continuity.*
- Output: one isolated image. Whole space visible, no scene-specific action, no characters unless tiny for scale.

#### render-seedance-storyboard-image `[agent]`

Renders the storyboard image for one shot from the saved storyboard prompt.

- Triggered by: `generate_storyboard`, `bulk_generate_storyboards`
- Model: `project.storyboard_provider` (nano-banana-2 / nano-banana-pro / gpt-image-2)
- Inputs: storyboardPrompt (saved), locked style/cast/env refs, optional artist edit instruction in refine mode
- Contract: image-only render. Sends saved `storyboardPrompt` text plus attached refs to the storyboard image provider. Cut plan is NOT sent — that's for the downstream Seedance video step.
- Output: storyboard image (2×2, 2×3, or 3×3 grid; 4, 6, or 9 panels)

#### shot-video-assembly `[agent]`

Composes the final keyframe-mode video prompt sent to the video provider.

- Triggered by: `generate_video` in keyframe workflow mode
- Model: `project.video_model` (Seedance / Veo)
- Inputs (text): motionPrompt (saved), refLabels (auto-appended when ref images attached)
- Inputs (API params, not text): start frame via `first_frame_url`, ref images via `reference_images` array
- Contract: prompt text is `{{motionPrompt}}. {{refLabels}}` — minimal because the video API contract treats start frame + refs as structural inputs. Prompt only describes the motion delta (what changes during the clip).
- Output: video clip

#### seedance-storyboard-video `[agent]`

Composes the Seedance prompt for video gen from a locked storyboard.

- Triggered by: `generate_video` in storyboard workflow mode
- Model: `project.video_model` (Seedance variants only)
- Inputs: storyboardImage (@image1), referenceImages (@image2+), rows/cols, cutPlanText, clipDuration, mood, clipDirection, lipsyncEnabled
- Contract: animates the locked storyboard panels left-to-right, top-to-bottom as one continuous edited shot. Preserves character identity + environment geometry across panels. No panel borders/numbers in output.
- Output: video clip

### Web-direct (16) — fires only from Visual Studio buttons

These are legacy refine/generate helpers. **The agent never fires them.** In the agent path, Codex writes the equivalent text inline and uses the matching `apply_*` action to persist. All 16 are cut candidates when the corresponding web UI buttons get deprecated.

#### brainstorm-style-directions `[web-direct]`

Proposes 4 distinct visual style directions for the project.

- Triggered by: `generate_style_candidates` when no `directions[]`, `promptOverride`, or `guideAssetId` is given.
- Model: `project.text_provider`
- Inputs: concept, sourceText, meaning, scriptSummary, musicalStructure, styleNotes, userNote
- Contract: *Propose 4 distinct visual style directions for this project. Each direction is one coherent visual world the project could live inside. Do not write story, scenes, characters, camera shot lists, or plot beats. Cover a real range across legitimate aesthetics for the project source and any STYLE NOTES.*
- Output: 4 directions as JSON, each `{ title, description }`

#### analyze-image-style `[web-direct]`

Reads a style image and returns a concise style description.

- Triggered by: legacy `identify_style`; also auto-fires from `apply_style_direction` when locking an asset with empty text
- Model: `project.text_provider.refine` (with image input)
- Inputs: image
- Contract: *Analyze this image and describe its "Art Style" in detail. Return a concise prompt fragment (2-3 sentences) covering: lighting, color palette, texture/medium, composition, mood. Be concrete and specific — this will be used as an image generation style reference. Return ONLY the style fragment text. No quotes, no JSON, no markdown.*
- Output: 2–3 sentence style description, plain text

#### generate-concepts `[web-direct]`

Proposes 3 narrative concept directions (or 1 if a director brief is set).

- Triggered by: Web "Generate concept" button. **Agent path:** Codex writes concept JSON inline → `apply_concept`.
- Model: `project.text_provider`
- Inputs: title, language, sourceText, meaning, musicalStructure, scriptSummary, directorBrief, context, userNote
- Contract: *Propose creative narrative directions for this project. Each direction is one coherent idea — what the viewer follows, what visibly happens, the emotional arc, the world the work lives in. Focus on story, beats, and what visibly happens. Visual style, palette, and cinematography are decided in later phases. Do not include art-style language, camera directions, or color palette in any field — those belong to the style phase, not the concept phase.*
- Output: 3 (or 1) concepts as JSON, each `{ title, subject, mood, theme, conceptDirection, description }`

#### refine-concept `[web-direct]`

Surgical refine of a locked concept using director feedback.

- Triggered by: Web "Refine" button on locked concept. **Agent path:** Codex edits concept JSON and re-calls `apply_concept` with `baseHash`.
- Model: `project.text_provider.refine`
- Inputs: lockedConcept, feedback, userNotePolicy
- Contract: *Revise the locked concept using the director's feedback. This is a refinement, not a replacement — preserve the core identity. Update only the fields the feedback addresses; leave the rest unchanged. Visual style, palette, and cinematography belong to later phases. Do not introduce art-style language, camera directions, or color palette here.*
- Output: refined concept JSON, all fields populated

#### plan-scenes `[web-direct]`

Plans cast, environments, scenes, and shots from concept + source.

- Triggered by: Web "Generate script" button (music_led). **Agent path:** Codex writes `script.md` and `apply_script({ markdown })`.
- Model: `project.script_writer` (Claude Opus with extended thinking + validation loop)
- Inputs: concept, lyrics, meaning, musicalStructure, basePacing, minShotDuration, videoModel, userNote
- Contract: *Plan the production structure for a music-led video. Create cast, environments, scenes, and shot directions. A later prompt decides visual framing and camera language, so focus on what happens: visible action, performance, emotional movement, scene progression, and musical response.*
- Output: structured plan via `plan_music_video` tool — cast, environments, scenes (with shots)

#### plan-scenes-openai `[web-direct]` **(cut candidate)**

GPT-5.5 variant of `plan-scenes`. Same composed prompt, different worker.

- Triggered by: `SCRIPT_WRITER_PROVIDER=openai` env flag or per-request `scriptProvider: 'openai'`. Experimental; never the default.
- Model: GPT-5.5 (Responses API structured output)
- Inputs: same as `plan-scenes`
- Contract: same as `plan-scenes`
- Output: same as `plan-scenes`
- **Cut now:** experimental dead branch; deleting saves the env flag + the OpenAI-specific code path.

#### refine-script `[web-direct]`

Surgical refine of a full production script using director feedback.

- Triggered by: Web "Refine script" button. **Agent path:** Codex edits `script.md` and re-calls `apply_script({ markdown, baseFingerprint })`.
- Model: `project.script_writer`
- Inputs: currentScript, feedback, concept, sourceText, meaning, musicalStructure, basePacing, minShotDuration, videoModel
- Contract: *Refine the existing production script using the director's feedback. This is SURGICAL refinement, not rewriting from scratch. Think editor, not new writer. Preserve what works; scope changes to what the feedback asks for; respect existing cast and environments (they may already have locked reference images); maintain source structure (section labels and timestamps are fixed). The visual medium is decided separately via the locked style reference. Do not add cinematography, camera, or color-palette directions to the script.*
- Output: complete updated script via `plan_music_video` tool

#### refine-style-direction `[web-direct]`

Surgical refine of one style direction's text.

- Triggered by: Web "Refine" button on a brainstormed style direction. **Agent path:** Codex edits saved style description and re-calls `apply_style_direction`.
- Model: `project.text_provider.refine`
- Inputs: currentDescription, currentTitle, feedback, concept, styleNotes
- Contract: *Revise the current style direction text using the director's feedback. This is a surgical refinement, not a replacement. Preserve the direction's core identity. Update only the aspects the feedback addresses; leave the rest of the description intact.*
- Output: refined direction JSON `{ title, description }`

#### write-shot-prompts `[web-direct]`

Bulk-writes visualPrompt + motionPrompt pairs per shot, plus continuity tags.

- Triggered by: Web "Rewrite all" or end-of-Blueprint auto-fire. **Agent path:** Codex writes prompts per shot inline → `apply_shot_prompts`.
- Model: `project.script_writer`
- Inputs: shots[], cast[], concept, videoModel, previousBatchTail, userNote
- Contract: *You are an art director / shot writer. The script writer planned what happens in each shot — you decide how it looks on screen and how it moves. Outputs go directly to an image model (visualPrompt) and a video model (motionPrompt). Every sentence must name a visible subject, an action or change, and a spatial or timing anchor. Translate emotion into physical evidence; do not write metaphor, inner state, or invisible causes. The visual medium is locked separately via the project's style reference image. Do not dictate art style, color palette, or "cinematic" framing in words.* (Source includes GOOD/BAD examples per axis.)
- Output: per-shot JSON via `write_shot_prompts` tool — `{ id, visualPrompt, motionPrompt, continuityFrom }`

#### seedance-storyboard-image `[web-direct]` (planner only — the render step is agent-tagged)

Plans one storyboard board + cut plan.

- Triggered by: Web "Board prompts" or per-shot "Write prompt". **Agent path:** Codex writes `storyboards/<scene>.md` → `apply_storyboard_prompts({ markdown })`.
- Model: `project.text_provider.refine`
- Inputs: sourceBrief, currentPrompt (refine), currentCutPlan (refine), artistNote, hasArtistReference, hasPreviousStoryboardRef, previousCutPlanTail, styleNotes, projectOverride
- Contract (write mode): *Plan one storyboard board and cut plan for a two-step storyboard workflow. The first output, storyboardPrompt, is the prompt that the storyboard image model will read. The second output, cutPlanText, is the matching panel-beat list that the video model will read later. The panel actions must appear in both outputs: the image model needs them inline to know what to draw, and the video model needs them as a clean beat list.*
- Contract (refine mode): *Refine one saved storyboard render prompt and cut plan using the director's feedback. This is a surgical rewrite of storyboard production text, not a new shot.*
- Output: `{ storyboardPrompt, cutPlanText }`

#### shot-start-frame `[web-direct]`

Generates a shot's start frame using the full reference chain.

- Triggered by: Web frame icon or "Generate all frames". **Agent path:** generally use `generate_video` directly (start frame is auto-handled internally) or call image gen with `promptOverride`.
- Model: `project.image_model`
- Inputs: visualPrompt, styleImage, characterRefs, environmentRef, prevShotEndFrame, continuityDescription, userFeedback, failedImage
- Contract: render start frame matching visual prompt + reference chain. Priority order: character identity > continuity > environment > style.
- Output: start frame image

#### refine-shot-prompt `[web-direct]`

Rewrites one shot's visual prompt using director feedback + failed image.

- Triggered by: Web "Refine" on shot visual prompt. **Agent path:** Codex edits saved `visual_prompt` and calls `apply_shot_prompts`.
- Model: `project.text_provider.refine` (with image input)
- Inputs: feedback, currentPrompt, failedImage (optional), referenceImage (optional)
- Contract: *Apply the director's feedback to the current prompt. Keep what works, change what they asked for. 1-3 sentences. This prompt goes to an image model — just describe what should be in the frame.*
- Output: `{ visualPrompt }` via `rewrite_frame_prompt` tool

#### refine-end-frame-prompt `[web-direct]`

Same shape as `refine-shot-prompt`, applied to the end-frame prompt.

- Triggered by: Web "Refine" on end-frame prompt. **Agent path:** Codex edits saved `end_visual_prompt` and calls `apply_shot_prompts`.
- Model: `project.text_provider.refine` (with image input)
- Inputs: feedback, currentPrompt, failedImage, referenceImage
- Contract: same as `refine-shot-prompt`, applied to the end-frame text.
- Output: `{ visualPrompt }`

#### refine-look-prompt `[web-direct]`

Rewrites a character or environment look-generation prompt using feedback.

- Triggered by: Web refine note before regenerating looks. **Agent path:** Codex rewrites the saved `generation_prompt` and re-runs `generate_candidates` with `promptOverride`.
- Model: `project.text_provider.refine` (with image input)
- Inputs: feedback, currentPrompt, lockedLook, referenceImage
- Contract: same shape as `refine-shot-prompt`. Apply feedback to the reusable look prompt. Preserve identity and production usefulness. 1-3 sentences.
- Output: `{ visualPrompt }`

#### refine-video-prompt `[web-direct]`

Rewrites a shot's motion prompt using feedback + start/end frame context.

- Triggered by: Web "Refine" on motion prompt. **Agent path:** Codex edits saved `motion_prompt` and calls `apply_video_prompt`.
- Model: `project.text_provider.refine` (with image input)
- Inputs: feedback, currentMotionPrompt, shotVisualPrompt, startFrame, endFrame, referenceImage
- Contract: *Apply the director's feedback to the motion prompt. This prompt goes to a video model alongside the start frame — it tells the model what to animate. 1-2 sentences, action + camera.*
- Output: `{ motionPrompt }` via `rewrite_motion_prompt` tool

#### write-audio-plan `[web-direct]`

Writes structured per-shot dialogue + sound notes from script + scene context.

- Triggered by: Web "Write dialogue" or audio-phase rewrites. **Agent path:** Codex writes `audio-plan.md` → `apply_audio_plan({ markdown })`.
- Model: `project.text_provider`
- Inputs: project (title/source_payload), scene (label/narrative/lyrics), shot (id/duration/direction/visualPrompt/castIds), cast (with voice state), projectOverride
- Contract: *Write production audio data for one shot. Write spoken dialogue lines and restrained sound notes for this shot only. This is structured production data that drives dialogue context for video generation and optional TTS for overlay renders. It is not prose and it is not a script rewrite.*
- Output: structured audio-plan JSON — `{ dialogue: [{ characterId, text, order, targetSec? }], soundNotes? }`

---

### Intake (3) — fires only from explicit intake/action choices

Audio upload no longer runs analysis automatically. Transcription and structure detection are explicit actions; script parsing still fires for the web-direct script intake path.

#### transcribe-lyrics `[intake]`

Extracts timestamped lyrics from an uploaded audio file.

- Triggered by: `analyze_audio_transcribe` or the web "Transcribe audio" button
- Model: `audio.analysis` (Gemini 3 Pro)
- Inputs: audioBase64, mimeType, optional language hint
- Contract: timestamped lyric extraction with English transliteration where applicable
- Output: structured lyrics with timestamps

**Pass log:**
- 2026-05-29 (188ab8b): backlog #1/#12 audio-intake cleanup — audio uploads now persist only; transcription is an explicit action/web button.

#### detect-structure `[intake]`

Detects musical sections.

- Triggered by: `analyze_audio_structure` or the web "Analyze structure" button
- Model: `audio.analysis` (Gemini 3 Pro)
- Inputs: audioBase64, mimeType
- Contract: identifies sections (intro/verse/chorus/etc.) with timestamps and energy descriptions. It does not classify song type or infer narrative/meditative traits.
- Output: `{ sections[] }`

**Pass log:**
- 2026-05-29 (188ab8b): backlog #1/#12 audio-intake cleanup — structure detection is now an explicit action/web button; backend meaning summary was removed.
- 2026-05-29 (99f29ce): backlog #5 — audio classification tags removed from structure output and runtime prompt inputs.

#### parse-script-intake `[intake]`

Converts uploaded script/treatment into structured cast/env/scenes/shots.

- Triggered by: script-first project creation from direct intake (PDF/text upload)
- Model: `project.script_writer`
- Inputs: scriptText, title, directorBrief, targetRuntime, pacing
- Contract: *Convert the uploaded script into a production-ready scene and shot plan. This is extraction and production planning, not story rewriting. Preserve story intent, scene order, character actions, and dialogue order unless the director brief explicitly asks for adaptation.*
- Output: structured plan via `parse_scripted_narrative` tool

---

### Automatic (2) — fires on system events

These fire as side effects of other operations, not by direct user or agent invocation.

#### chained-shot-refresh `[automatic]`

Rewrites the next shot's prompts when the previous shot's video lands.

- Triggered by: a shot's video gen completing when the next shot is tagged `continuity_from: prev_shot`
- Model: `project.text_provider.refine` (with image input)
- Inputs: prevFrame, shotDirection, currentVisualPrompt, currentMotionPrompt, characterNames, environmentName
- Contract: *The image is the last frame of the previous shot. The next shot was drafted before this frame existed. Rewrite its prompts so they flow from what actually happened while honoring the shot's intent. Keep the shot intent. Rewrite so the first moment matches the frame — same characters, same state, natural continuation. Visual: 1-3 sentences. Motion: 1-2 sentences.*
- Output: `{ visualPrompt, motionPrompt }` via `rewrite_chained_shot` tool. Skipped in Seedance storyboard mode.

#### describe-frame `[automatic]`

Short factual description of a video frame for continuity stitching.

- Triggered by: continuity description requests (typically before chained-shot-refresh in the legacy path)
- Model: `project.text_provider.refine` (with image input)
- Inputs: image
- Contract: *Describe this single video frame factually for shot continuity. 2-3 sentences max. Focus on: subject position/pose/expression, camera framing + angle, lighting mood, what action is mid-motion. Do NOT speculate about narrative or use flowery language. Write like a script supervisor noting continuity.*
- Output: 2–3 sentence factual description, plain text

**Pass log:**
- 2026-05-29 (this commit): backlog #10 utility cleanup — cut unused `critique-shot-image` and `chat-with-director`, then rerouted `describe-frame` through `project.text_provider.refine` with image input.

---

### Shared (1) — multiple code paths into same template

The only entry that genuinely straddles. Same prompt template, two callers.

#### seedance-storyboard-refine `[shared]`

Refine path for Seedance storyboards. Two branches:

- **`replan` branch** (`[web-direct]`): rewrites the saved storyboardPrompt + cutPlanText via `project.text_provider.refine` LLM. Fires from web "Redo". Agent path: edit local file → `apply_storyboard_prompts`.
- **`edit_image` branch** (`[agent]`): renders a new storyboard image via `project.storyboard_provider` using the current image + a narrow edit instruction. Fires from `refine_storyboard_image` action and from web "Refine".

Inputs: artistNote (required), refineMode, currentPrompt, currentCutPlan (replan), baseStoryboardPrompt (replan), referenceImages, artistReferenceImage (optional)

Contract differs by branch — replan rewrites text; edit_image edits the image.

---

## Cut candidates

**Immediate cut today:** `plan-scenes-openai` — experimental GPT-5.5 variant, env-flagged, never the default. Removing it cleans up the OpenAI script-provider branch entirely.

**Conditional cuts** (deprecate when the corresponding Visual Studio buttons are reshaped around the agent surface):

| Prompt | Web button that fires it | Agent equivalent |
|---|---|---|
| `generate-concepts` | "Generate concept" | Codex writes JSON → `apply_concept` |
| `refine-concept` | "Refine" on concept | Codex edits JSON → `apply_concept` |
| `plan-scenes` | "Generate script" | Codex writes `script.md` → `apply_script` |
| `refine-script` | "Refine script" | Codex edits `script.md` → `apply_script` |
| `write-shot-prompts` | "Rewrite all" | Codex writes prompts inline → `apply_shot_prompts` |
| `refine-shot-prompt` | "Refine" on visual prompt | Codex edits → `apply_shot_prompts` |
| `refine-end-frame-prompt` | "Refine" on end-frame | Codex edits → `apply_shot_prompts` |
| `refine-look-prompt` | "Refine" on look | Codex edits → `generate_candidates({ promptOverride })` |
| `refine-style-direction` | "Refine" on style | Codex edits → `apply_style_direction` |
| `refine-video-prompt` | "Refine" on motion | Codex edits → `apply_video_prompt` |
| `seedance-storyboard-image` planner | "Board prompts" | Codex writes `storyboards/<scene>.md` → `apply_storyboard_prompts` |
| `seedance-storyboard-refine` replan | "Redo" storyboard | Codex edits storyboard markdown → `apply_storyboard_prompts` |
| `write-audio-plan` | "Write dialogue" | Codex writes `audio-plan.md` → `apply_audio_plan` |

That's 13 prompts queued for deprecation. The 7 `[agent]`-tagged prompts stay; they're the actual production engines.

---

## Future cleanup backlog

**This is the single canonical work queue.** Forward plans in `docs/mirage-agent-platform-api-architecture.md` (Phase 0.5) and `docs/mirage-platform-v1-ledger.md` checkpoints reference this list; they do not restate it. When an item ships, move its findings into the relevant Layer 2 action's Pass log and delete the item here.

### Open work — grouped index

Scannable view of everything ahead. Detailed entries with the same IDs follow below.

**A · Finish current round (smoke stabilization P0s) → then thorough test**
- ✅ Reliable sync (isolated cache + lean receipts + CLI 0.1.3 two-tier workspace sync)
- ✅ `apply_text_edits` — narrow safe text-only edit (preserves refs/boards by construction)
- ✅ Local/native storyboard import — `purpose=storyboard_image` upload + `import_storyboard_image` action
- ✅ Versioned notebook skills — skills as hashed synced artifacts, stale-aware (mechanism for single-source skills)
- ✅ **Skill content audit** (item 17) — old skill set replaced by 8 node skills (concept/script/art/casting/sound/audio/storyboarding/video), all behavior claims code-verified. `npm run check:notebook` guards packaged/local pair identity; content quality remains a read-and-review responsibility, not a regex gate.
- ☐ **Thorough test** of the full agent-native chain (skills now clean — measures the system, not skill rot)

**B · Post-test friction wins (P1, small/high-ROI)**
- ☐ Stronger action examples (make `entityIds[]` impossible to miss)
- ☐ `get_project_state({ detail: "agent_working_set" })` — compact loop state
- ✅ `rename_project` / title sync (shell title vs concept title divergence) — shipped 2026-06-10

**C · Product quality (the real lever — currently unmeasured)**
- ☐ Output quality harness — generate N candidates → judge → surface weak (style drift, ref intrusion, bad blocking) → feed fixes back into prompts/refs/style-notes. Doubles as the first parallel/sub-agent workflow.

**D · Use Codex/Claude power (orchestration)**
- ☐ Fan-out generation — concurrent looks/storyboards/candidates instead of sequential
- ☐ Worker sub-agents — visual triage, continuity check, audit sweep (item 15 P3 "selective worker agents")
- ☐ Director orchestration pattern — one agent fans out to N workers, synthesizes

**E · Deferred architecture (durable, demand-driven, not smoke-blocking)**
- ☐ HTTP data plane + plugin/local bridge (sync facet) — kill `npx` entirely; HTTPS read endpoints (manifest, file-by-path) under a local bridge (item 15 deferred entry)
- ☐ Plugin packaging / distribution (product facet) — ship Mirage as a Codex plugin: stable generic skills + MCP config + onboarding glue; "artist installs once." Production bundles stay server data, NOT plugin payload (api-architecture Phase 5)
- ☐ Production bundles — user/team/project/public-scoped package of style notes + prompt overrides + reusable skills + examples/model phrases + optional reusable refs/assets, applied as editable `config/` + `.agents/skills/` copies, via `save_project_as_bundle` / `list_production_bundles` / `apply_production_bundle` (item 16; downstream of versioned skills + style notes stable)
- ☐ Diff-by-ID topology apply — the "add/remove one shot without wiping the rest" middle case
- ☐ `workflow_key` cleanup (item 2)
- ☐ Per-project filtering of materialized action schemas (item 4)
- ☐ Fallback strategy when agents unavailable (item 7)
- ☐ Web UI audit (item 13)
- ☐ Durable issue capture (item 14)

**F · Polish (P2/P3, later)**
- ☐ Reference remap/relock workflow
- ☐ Shorten skill entry blocks (5-line "do this now" header per skill)

---

Numbering below is stable IDs, not sequential — gaps (1, 3, 5, 6, 8–12) are items that already shipped during Tier 1–3; their history lives in the Pass logs above. Two clusters of detailed entries remain:

- **Original audit backlog** (items 2, 4, 7, 13, 14): deferred-after-smoke architectural cleanups. Take when the abstraction earns it.
- **Smoke feedback queue** (item 15): the active P0–P3 list from the first agent-native Blueprint smoke. This is what the current round of fixes pulls from. Work P0s first.

### 2. `workflow_key` as runtime branch is mostly legacy

**Problem:** `workflow_key` (`music_led` / `scripted_narrative`) was the *backend planner* discriminator under the old LLM-as-planner model. In agent-native Mirage, Codex IS the planner — it reads what's in the project (audio? script? brief?) and proceeds without needing a typed enum to route between backend prompts.

**Where it still earns its keep:**
- Auto-intake chain ("if source is audio, transcribe + analyze") — can be derived from source type, doesn't need an explicit workflow key
- Per-project `availableTools` / `blockedTools` filtering — can be derived from source assets
- Web-direct planner prompts (`plan-scenes` vs `parse-script-intake`) — cuttable when those web prompts go

**Slice (eventual):** replace `workflow_key` with a `seed_kind` derived property (or fold into source-asset existence). Most call sites collapse to "does this project have audio? does it have a script?" rather than a typed branching enum.

**Why deferred:** real refactor; cuts run deep. Make web-direct planner prompts deprecated first (#3 below), then workflow_key cleanup is the natural follow-up.

### 4. Per-project filtering of materialized action schemas

**Problem:** `config/actions/index.json` and `config/actions/<surface>.json` currently contain the full materialized agent action set (24 actions after `identify_style` is hidden), not filtered by per-project `availableTools` / `blockedTools`. MCP `list_actions` does filter, so the file and the live tool can disagree.

**Today this doesn't bite** because `availableTools` filtering isn't actively gating actions in production. Will bite when it does.

**Slice:** apply per-project filtering when materializing the action files. Small change in `buildActionsArtifacts()`.

**Why deferred:** no active per-project filtering today, so no real drift to fix yet. Add when per-project gating becomes a real feature.

### 7. Fallback strategy when agents are unavailable

**Problem:** If we fully cut web-direct prompts (the 13 conditional cuts), Mirage operates only through agents. If Codex is down and no alternate agent is reachable, artists can't operate the system. This is the operational SLA question.

**Three realistic fallback layers:**
1. **Multi-agent compatibility (primary).** Codex isn't the only MCP client. Claude / Claude Code / future agents can drive the same surface. If Codex is down, point another agent at the MCP server. Natural resilience.
2. **Manual entry web (secondary).** Artist can type concept JSON / script markdown / etc. directly into web forms and hit Apply. No backend LLM. Engineer-friendly fallback.
3. **Thin admin/emergency LLM (tertiary).** Backend LLM layer gated behind a feature flag, not artist-facing by default. Used only when 1+2 are both unavailable. Tiny surface, mostly dormant.

**Why deferred:** the question matters before fully cutting web-direct prompts but doesn't block agent-native work today. Decide before the Phase 3 / 4 deprecation lands. Likely the answer is "multi-agent + manual entry; no emergency LLM layer" — Mirage's SLA becomes agent availability.

### 13. Web UI audit deferred — pin and review later

**Reminder for Saul.** This audit pass skipped the Visual Studio (web UI) surface entirely. The web flow has many of the same Pattern 7 issues (backend LLM helpers where the user could write directly, dual-shape buttons, refine vs regenerate confusion, intake auto-fire UX). Plus reshaping web UI around the agent surface is the precondition for cutting the 13 web-direct prompts and for backlog items 12 (intake decoupling) and 1 (audio intake).

**When:** after the current agent-path smoke testing lands and basic agent-native production flow works. Then a deliberate Visual Studio audit pass: per-component review, identify which buttons map to which Layer 2 actions, which are pure UI sugar, which have to stay legacy.

**Also re-review Layer 3 prompts after backlog #10 + #12 land.** Once intake auto-fire is killed (#12) and the utility prompts are cleaned (#10 cuts critique-shot-image + chat-with-director, reroutes describe-frame), the remaining Layer 3 surface shifts meaningfully. Do a fresh read of the prompts section to confirm what survives, what's still needed, and what should still be retagged. Saul has asked to be explicitly reminded — don't skip this.

**Don't forget to do this.** Easy to defer indefinitely; that's how legacy chrome accumulates.

### 14. Durable issue capture — ✅ DONE

**Pass log:**
- 2026-06-10 (this commit): prefix-mapped `*_issues` table landed (`migrations/2026-06-10_add_issues_table.sql`, both prefixes, RLS owner-read, `project_id` ON DELETE SET NULL so issues outlive deleted projects). `captureMirageIssue` is now DB-first: inserts `project_id`, `user_id`, `source` (`mcp` / `director-api` / `web`), severity, summary, suggested fix, redacted tool tail, and `status='open'`; returns `issueRef` (row id) + `storage:'db'`. Local `.mirage/issues/` JSON survives only as the fallback when the DB insert fails or Supabase isn't configured (dev), flagged `storage:'filesystem'` + ephemeral note. Both callers thread identity: hosted MCP `mirage_capture_issue` passes `auth.userId`/`'mcp'`, `/api/director/issues/capture` passes `req.userId`/`'director-api'`. Triage read: `GET /api/admin/issues?status=&limit=` (admin-secret gated).

### 15. Smoke feedback queue from first Blueprint agent run

Ranked findings from the first real agent-native Blueprint smoke. These are product-surface improvements, not prompt-audit theory.

**Design law for this round:** one confident path per operation. Fallbacks are automatic/invisible or explicitly off-path. Do not make agents choose between happy-path forks during creative work.

**P0 before deeper smoke: safe post-visual script text edits.**
First guard landed: `force` no longer authorizes a downstream visual wipe by itself. Product decision after smoke: do not make `apply_script` smart-preserve every case yet. Add a narrow `apply_text_edits` action that edits only existing scene titles, shot directions, and dialogue line text keyed by existing IDs. It cannot add/delete/re-ID topology. Direction changes mark shot prompts/storyboard/video stale; dialogue changes mark audio stale. `apply_script` stays the rare topology rebuild path guarded by `allowDownstreamVisualWipe`. Eventual target, if needed: diff-based script apply by stable entity/scene/shot IDs for middle cases like "add one shot without wiping the rest."

Pass log:
- 2026-05-30 Codex: `apply_text_edits` shipped. Agents now have a low-blast-radius wording path for existing scene titles, shot directions, and dialogue lines; `apply_script` remains topology-only after visual work exists.

**P1 soon: project-visible title sync.**
The shell title and concept title can diverge (`Neon Afterimage` vs `Beautiful Killers`) with no obvious agent action to rename the visible project. Add `rename_project`, or let `apply_concept` optionally sync the shell title.

Pass log:
- 2026-06-10: `rename_project` shipped as a system-surface registry action (explicit rename, not an `apply_concept` side effect). See its Layer 2 pass log.

**P1 soon: compact agent working set.**
Add `get_project_state({ detail: "agent_working_set" })` for the common loop: checkpoint, entities with IDs/locked refs, shots with cast/env IDs, stale flags, weak links, and next legal actions. Current production state is useful but still larger than needed for many turns.

**P1 soon: clean batch receipts.**
`parallel_run` correctly applies state, but receipts from many actions mutating the same files can look like partial truth. This is the same mechanism as receipt-driven sync: action responses should return compact outcomes plus changed paths + hashes, not every artifact body. The bridge pulls changed files; the receipt summarizes graph mutations (`7 refs locked`, mapping, stale counts, errors) and tells the agent when to refresh canonical state.

Pass log:
- 2026-05-30 Codex: MCP action/job/parallel receipts now normalize `changedArtifacts` to `{ path, hash, size, mode, writePolicy, description }` plus `changedArtifactSummary`; file bodies no longer travel in action receipts.

**P1 soon: stronger action examples.**
Action schemas need exact happy-path examples for each common mode. `generate_candidates` must make `entityIds[]` impossible to miss, with separate cast/env examples including `guideAssetId` and `promptOverride`.

**Substantially resolved for smoke (was P0): reliable local workbench sync.**
The first smoke test exposed the sync seam: `mint_cli_token -> mirage-cli sync` failed because `npx` hit a root-owned global npm cache, so the agent fell back to MCP file reads, which bloats context and can't do a full refresh. The CLI bridge is now hardened enough that this is no longer a smoke blocker. What remains is the durable architecture move (kill npx entirely), demoted to the deferred tier below.

Pass log:
- 2026-05-30 Codex: `mint_cli_token` commands isolate npm cache from ambient `~/.npm` (slice 1, 1954f50). Fallback wording tightened — sync command is the trusted path, retried once on error; MCP file reads only when no shell/npx exists, not on recoverable failures (cc7aa31).
- 2026-05-30 Codex: lean receipts — action responses return changed paths + hashes, never file bodies, uniformly at the MCP boundary (slice 2, 471b297).
- 2026-05-30 Codex: CLI `0.1.2` shipped (62c7fb7) — changed-only sync via manifest hash-diff (skips unchanged files), local-vs-server conflict + untracked-file + removed-remote detection, sync-lock owner metadata + 15-min TTL + stale-lock move-aside, lock release on recoverable errors. Published, Railway `MIRAGE_CLI_PACKAGE` pinned to `0.1.2`, live `mint_cli_token` verified.
- 2026-05-30 Claude+Codex: CLI `0.1.3` completed the two-tier workspace split (9f5d11a, c21f5f1) — workspace-shared files live at root and are tracked in `.mirage-workspace-state.json`; project files stay under `mirage/projects/<projectId>/` with per-project `.sync-state.json`; old per-project `config/actions/*` and `config/skills.json` are pruned; `mint_cli_token` now defaults to `@ssaulgoodman420/mirage-cli@0.1.3`.

Net: isolated cache + changed-only diff + conflict-awareness + lock safety + lean receipts are all in. The CLI bridge is now confident enough to re-smoke and operate on. The only remaining sync work is the durable shape (item below), which is no longer blocking.

**Deferred (durable shape, no longer smoke-blocking): replace npx bridge with HTTP data plane + local plugin bridge.**
The CLI 0.1.3 is robust but still depends on `npx` per session. The durable shape is a Codex-plugin local bridge over plain HTTPS read endpoints (`GET notebook manifest`, `GET file?path=`) so sync never touches npx/npm at all — the same binary-boundary pattern as `/api/agent/uploads`. The HTTP read endpoints are also the substrate the plugin bridge sits on, so they are not wasted work. Build this when the CLI bridge proves insufficient under real use, or alongside the plugin packaging milestone — not as a smoke blocker now that 0.1.3 holds.

**P0 before Studio smoke continues: local/native storyboard import.**
Codex can create or edit a stronger storyboard image with native imagegen, but Mirage has no way to upload that PNG as a storyboard version and lock it. Add `purpose=storyboard_image` to `/api/agent/uploads`, then an `import_storyboard_image({ shotId, sourceAssetId, lock? })` action that creates the storyboard asset/version, updates the shot, and optionally locks it.

Pass log:
- 2026-05-30 Codex: `purpose=storyboard_image` + `import_storyboard_image` shipped locally. Native imagegen outputs can now be uploaded over HTTP, attached as storyboard versions, optionally locked, and used without rerendering through Mirage.

**P0 before Studio smoke continues: versioned notebook skills.**
Bad local skill guidance directly caused bad storyboard prompting during smoke. Treat materialized skills as first-class synced artifacts with versions/hashes. When server guidance changes, the workbench should know it is stale and refresh skills through the same changed-artifact path as project files.

Pass log:
- 2026-05-30 Codex: materialized Mirage skills now publish `config/skills.json` plus `notebook.json.skillsHash`. The notebook records per-skill hashes/versions/paths, and workspace instructions tell agents to sync and restart/open a fresh harness session when skill hashes or behavior are stale.

**P2 after Studio smoke: reference remap/relock workflow.**
Real creative work often means "these assets are good but labels are wrong; remap refs, regenerate one, rewrite script to match." Capture this as a first-class recipe/action plan so agents can do it deliberately instead of improvising many small calls.

**P2 after Studio smoke: shorten skill entry blocks.**
Project skills are useful but long. Each should open with a tiny "do this now" block (5 lines max), with doctrine below.

**P3 later: selective worker agents.**
Useful workers: visual triage, continuity check, scene-level prompt drafting, issue/audit summarizer. Do not spawn workers for every action; use them for candidate review and multi-shot rewrite loops where parallel judgment pays for itself.

### 16. User/team production bundles for reusable taste, overrides, refs, and skills

**Problem:** a strong project can currently accumulate useful style notes, project prompt overrides, locked refs, examples/model phrases, and even rewritten local skills. But there is no clean way to reuse that earned production language across Mirage projects. The choices today are bad: copy project notebook files by hand, promote something into global platform skills too early, or ask every new agent to rediscover the same taste.

**Slice:** add a `production_bundles` product object and actions such as `save_project_as_bundle`, `list_production_bundles`, and `apply_production_bundle`. A bundle should be scoped to user/team/project/public and include selected style-note buckets, prompt overrides, reusable skills, examples/model phrases, and optional reusable refs/assets. Applying a bundle seeds the new project's editable `config/` and `.agents/skills/` copies; it does not make the bundle hidden runtime doctrine.

**Why deferred:** this is downstream of versioned notebook skills, style notes, and prompt overrides all being stable. Build after smoke proves the loop and after we see one real "episode 1 worked, make episode 2" harvest case. This is the clean home for reusable artist taste; it should not block current Studio stabilization.

### 17. Skill system content audit (2026-05-30) — ✅ DONE (9449f35)

**Pass log:**
- 2026-05-30 (9449f35): executed on the single-source state. `mirage-director` rewritten (legacy/hidden tools → cockpit+actions, "Opening IT SAID OH" corruption deleted, `mirrors/`→`state/`, shard table completed, `apply_text_edits` added). All skills de-Bhakti'd (Shantamma/sari/lamp/priest/temple/devotional → generic) and de-jargoned (Saul/R28/Doctrine §/dated-fix-notes removed). `script-doctor` wired to `apply_text_edits` + `allowDownstreamVisualWipe`. `render-triage` trigger tightened from over-broad to a hard cost-gate. `continuity-auditor` cost-ladder dedup with render-triage deferred as cosmetic. Validation: check:notebook + smoke:agent-contract --repeat=5 + tsc + build + git diff --check all green.
- 2026-05-30 (8ad6ff2, follow-up): removed the banned-string skill lint as a hard gate. It caught one leftover example, but it was the wrong abstraction for skill quality: `check:notebook` now remains the structural pair-identity check, while skill content stays a deliberate read-and-review pass when the action surface changes.
- 2026-05-30 (e6baac0, d3162e0, 07a12f2): rebuilt the skills as 8 intuitive node skills (concept-writer, script-writer, art-director, casting-director, sound-director, audio-director, storyboarding, video-director), each teaching the maneuver/repair ladder + model behavior + failure modes ("schemas are the buttons; skills are how to play them"). `continuity-auditor` and `render-triage` dropped as standalone — neither is a graph node — and their content absorbed into the node skills. Full code-verification of action-behavior claims caught five false claims and corrected them against source: `applyConcept` marks shot prompts stale (not wipe/fork); `includeConcept` only acts in `generate_style_candidates`; looks generation does not honor `excludeCastRefs`; `bulk_generate_storyboards` is hidden (`materializeForAgent:false`); `contextOverrides` is not honored by video generation. The other three skills (sound-director, audio-director, video-director) verified clean against the registry contracts + provider code. `.gitignore` fixed to track `.agents/skills/` (new copies were silently untracked — `check:notebook` passed locally but a fresh clone would fail). New standing rule in `docs/agent-working-method.md`: skill behavior claims are code-verified, not doc-assumed.

Original findings (kept for history):

The 7 skills (`mirage-director`, `storyboard-prompt-craft`, `render-triage`, `script-doctor`, `style-ref-critic`, `continuity-auditor`, `audio-director`) were written ~May 15–21 for the pre-cockpit surface and **never re-audited after the cockpit+registry+actions redesign or the composer/style-notes/text-edits work.** They're the highest-leverage artifact in the system — they shape every agent decision before any tool fires — and they were the one surface we never reviewed. Do NOT patch the shipped copies until versioned-skills gives a single source of truth (today `.agents/skills/` and `server/resources/skills/` have drifted; fixes land in one and miss the other — that's why the storyboard graph-names fix never reached artists).

**Systemic findings:**

1. **Two-copy drift.** `.agents/skills/` (engine Codex) vs `server/resources/skills/` (ships to artists). `storyboard-prompt-craft` (114 vs 102 lines) and `mirage-director` (176 vs 154) have drifted; shipped copies are stale. Versioned-skills (the P0) must make these one hashed source.

2. **Lahari/Bhakti domain leak — a whole class, not one line.** Devotional-music examples are scattered through the skills: "Shantamma, elderly Tamil grandmother… faded cotton sari," lamps, blessings, temple thresholds, "if the song is meditative let shots breathe." Same Lahari-domain leak we ripped out of runtime prompts (isMeditative/songType/devotional), survived here because we never looked. General-machine skills need generic or example-light guidance.

3. **Written for the OLD surface.** Legacy/renamed tools throughout, especially `mirage-director`.

4. **Internal jargon leaked into artist-facing skills:** "Saul's existing instinct," "R28," "Doctrine §4/§5," "since 2026-05-12 fix," and a corrupted placeholder `"Opening IT SAID OH…"`.

**Per-skill execute list (post-versioning):**

- **`mirage-director` — ❌ rewrite (ship-stopper, loads first every session):** rip out legacy tools (`resolve_project`, `attach_director_session`, `get_director_session`, `get_project_packet` → `list_projects`/`open_project`/`get_project_state`); legacy reference flow (`list_character_look_candidates`, `apply_cast_reference`, `mirage upload-cast-reference` CLI → `generate_candidates`/`lock_reference`/`/api/agent/uploads`); **delete the `"Opening IT SAID OH…"` corruption (line 41)**; fix "mirrors are read-only" → `state/`; complete the shard table (missing `audio-director`); update apply-tool table (add `apply_text_edits`, etc.).
- **`storyboard-prompt-craft` — ⚠️ sync + fix:** push the graph-names fix into the shipped copy; **delete the contradicting "restate appearance" guidance** (line 32 — fights the ref-binding contract); strip leaks (Saul/2026-05-12/R28); de-Bhakti the examples.
- **`render-triage` — 🟡 reframe:** content is good but it's a judge/worker rubric over-deployed as an always-on director shard (over-triggers — Saul observed the model loading it constantly). Move to an on-demand worker-agent skill (the "visual triage worker" from Group D) OR tighten the trigger hard. Strip hardcoded dollar costs + "Doctrine §5."
- **`script-doctor` — 🟡 light:** point at `apply_text_edits` for wording-only (predates it); drop "Doctrine §4"; de-Bhakti examples.
- **`style-ref-critic` — 🟡 light:** drop "R28," "Doctrine §4."
- **`continuity-auditor` — 🟡 light:** dedup cost-ladder with render-triage; drop hardcoded costs.
- **`audio-director` — ✅ best-maintained:** minimal; verify `delivery`/`paceHint` match the live audio-plan schema.

**Discipline going forward:** every skill is an artist-facing product surface. No internal jargon, no legacy tool names, no Lahari/devotional examples, no placeholder text. Re-audit skills whenever the tool/action surface changes — they drifted because nobody did.

---

## Appendix

### Upload boundary

Local images do not go through MCP. POST multipart to `/api/agent/uploads` with the Mirage bearer token; pass the returned `assetId` as `sourceAssetId` (lock as-is) or `guideAssetId` (use as visual guide).

Purposes: `style_guide`, `style_reference`, `cast_guide`, `cast_reference`, `env_guide`, `env_reference`, `storyboard_image`, `audio_source`.

### Async jobs

Paid actions can be fired async via cockpit:

```
start_job(actionKey, input)  → { jobId }
get_job(jobId)               → { status, result?, error? }
list_jobs({ projectId? })    → [{ jobId, status, ... }]
```

Job state persists in `studio_agent_operations`. Visual Studio realtime listener picks up the agent pill automatically.

### Composer section order

Every composer-built prompt assembles in this order (sections with no content are omitted):

```
<coreTask>                  ← top of hierarchy
INPUTS
<formatted project graph data + refs>
STYLE NOTES                 ← selected project style-note buckets
PROJECT OVERRIDE            ← project-scoped recipe override, if set
USER NOTE POLICY            ← legacy/web-direct flows only
OUTPUT CONTRACT
USER NOTE                   ← legacy/web-direct only
```

See `server/prompts/_composer.ts` for the typed `ComposePromptParts` contract.
