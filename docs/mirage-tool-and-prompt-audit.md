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
| `open_project` | Start a session on one project; writes notebook desk copy + mirrors. |
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

---

## Layer 2 — Actions (25 total)

Every action is agent-callable via `run_action` / `start_job`. Quick index table first, then per-action Notes blocks for audit findings.

### Index

| Key | Surface | What it does | Calls | Paid? |
|---|---|---|---|:-:|
| `apply_concept` | concept | Saves Codex-written concept JSON to DB | DB only | — |
| `apply_script` | script | Saves Codex-written script (JSON or markdown) to DB | DB only | — |
| `apply_shot_prompts` | script | Saves Codex-written visual/motion/direction text per shot | DB only | — |
| `apply_shot_workflow_modes` | script | Sets per-shot path: `auto` / `storyboard` / `keyframe` | DB only | — |
| `generate_style_candidates` | style | Renders style reference candidate batch | image model | ● |
| `identify_style` | style | Reads a style image, returns concise description | vision LLM | ● |
| `apply_style_direction` | style | Saves style description and/or locks a style asset | DB only (auto-runs `identify_style` if locking empty) | — |
| `generate_candidates` | looks | Renders 3 character/env reference candidates per entity | image model | ● |
| `list_candidates` | looks | Lists previously-generated candidates | DB read | — |
| `lock_reference` | looks | Sets canonical character/env reference | DB only | — |
| `generate_storyboard` | storyboard | Renders one storyboard image from saved prompt | image model | ● |
| `bulk_generate_storyboards` | storyboard | Renders many storyboards (per shot) | image model | ● |
| `apply_storyboard_prompts` | storyboard | Saves Codex-written storyboard prompt + cut plan | DB only | — |
| `refine_storyboard_image` | storyboard | Edits existing storyboard with narrow instruction | image edit | ● |
| `lock_storyboard` | storyboard | Approves a storyboard version for video gen | DB only | — |
| `unlock_storyboard` | storyboard | Clears storyboard approval | DB only | — |
| `generate_video` | video | Renders the video clip for one shot | video model | ● |
| `apply_video_prompt` | video | Saves Codex-written keyframe motion prompt | DB only | — |
| `generate_dialogue_audio` | audio | Renders TTS for selected dialogue lines | TTS | ● |
| `apply_audio_plan` | audio | Saves Codex-written dialogue + sound notes per shot | DB only | — |
| `apply_cast_voice` | audio | Assigns ElevenLabs voice ID to a cast member | DB only | — |
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

#### identify_style

**Notes:** _blank_

**Pass log:** none

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

**Notes:** _blank_

**Pass log:** none

#### apply_storyboard_prompts

**Notes:** _blank_

**Pass log:**
- 2026-05-27 (1661727): "Codex-written" framing + explicit cross-reference to `refine_storyboard_image` so agents pick the right tool.

#### refine_storyboard_image

**Notes:** _blank_

**Pass log:**
- 2026-05-27 (1661727): input field clarified as Codex-translated edit instruction (D27); example shows a real positive edit instruction.

#### lock_storyboard

**Notes:** _blank_

**Pass log:** none

#### unlock_storyboard

**Notes:** _blank_

**Pass log:** none

#### generate_video

**Notes:** _blank_

**Pass log:** none

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

## Layer 3 — Prompts (31 total), grouped by path tag

The `path` tag on each prompt tells you who fires it at runtime. Contracts below are quoted verbatim from the prompt builder's `coreTask` (or its inline service equivalent).

### Agent (8) — fires when an MCP action invokes a paid model

These are the prompts Codex's actions actually trigger.

#### brainstorm-style-directions `[agent]`

Proposes 4 distinct visual style directions for the project.

- Triggered by: `generate_style_candidates` when no `promptOverride` / `guideAssetId` is given
- Model: `project.text_provider`
- Inputs: concept, sourceText, meaning, scriptSummary, musicalStructure, songType, isNarrative, isMeditative, styleNotes, userNote
- Contract: *Propose 4 distinct visual style directions for this project. Each direction is one coherent visual world the project could live inside. Do not write story, scenes, characters, camera shot lists, or plot beats. Cover a real range across legitimate aesthetics for the project source and any STYLE NOTES.*
- Output: 4 directions as JSON, each `{ title, description }`

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
- Output: storyboard image (typically 2×2 or 2×3 panel grid)

#### shot-video-assembly `[agent]`

Composes the final keyframe-mode video prompt sent to the video provider.

- Triggered by: `generate_video` in keyframe workflow mode
- Model: `project.video_model` (Seedance / Veo)
- Inputs: motionPrompt (saved), refLabels (auto-appended when ref images attached)
- Contract: `{{motionPrompt}}. {{refLabels}}` — minimal composition. Start frame + ref images carry visual state.
- Output: video clip

#### seedance-storyboard-video `[agent]`

Composes the Seedance prompt for video gen from a locked storyboard.

- Triggered by: `generate_video` in storyboard workflow mode
- Model: `project.video_model` (Seedance variants only)
- Inputs: storyboardImage (@image1), referenceImages (@image2+), rows/cols, cutPlanText, clipDuration, mood, clipDirection, lipsyncEnabled
- Contract: animates the locked storyboard panels left-to-right, top-to-bottom as one continuous edited shot. Preserves character identity + environment geometry across panels. No panel borders/numbers in output.
- Output: video clip

#### analyze-image-style `[agent]`

Reads a style image and returns a concise style description.

- Triggered by: `identify_style`; also auto-fires from `apply_style_direction` when locking an asset with empty text
- Model: `project.text_provider.refine` (vision input)
- Inputs: image
- Contract: *Analyze this image and describe its "Art Style" in detail. Return a concise prompt fragment (2-3 sentences) covering: lighting, color palette, texture/medium, composition, mood. Be concrete and specific — this will be used as an image generation style reference. Return ONLY the style fragment text. No quotes, no JSON, no markdown.*
- Output: 2–3 sentence style description, plain text

---

### Web-direct (15) — fires only from Visual Studio buttons

These are legacy refine/generate helpers. **The agent never fires them.** In the agent path, Codex writes the equivalent text inline and uses the matching `apply_*` action to persist. All 15 are cut candidates when the corresponding web UI buttons get deprecated.

#### generate-concepts `[web-direct]`

Proposes 3 narrative concept directions (or 1 if a director brief is set).

- Triggered by: Web "Generate concept" button. **Agent path:** Codex writes concept JSON inline → `apply_concept`.
- Model: `project.text_provider`
- Inputs: title, language, sourceText, meaning, musicalStructure, scriptSummary, songType, isNarrative, isMeditative, directorBrief, context, userNote
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

- Triggered by: Web "Generate script" button (music_led). **Agent path:** Codex writes `drafts/script.md` and `apply_script({ markdown })`.
- Model: `project.script_writer` (Claude Opus with extended thinking + validation loop)
- Inputs: concept, lyrics, meaning, musicalStructure, basePacing, minShotDuration, videoModel, songType, isNarrative, isMeditative, userNote
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

- Triggered by: Web "Refine script" button. **Agent path:** Codex edits `drafts/script.md` and re-calls `apply_script({ markdown, baseFingerprint })`.
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
- Inputs: shots[], cast[], concept, videoModel, songType, isNarrative, isMeditative, previousBatchTail, userNote
- Contract: *You are an art director / shot writer. The script writer planned what happens in each shot — you decide how it looks on screen and how it moves. Outputs go directly to an image model (visualPrompt) and a video model (motionPrompt). Every sentence must name a visible subject, an action or change, and a spatial or timing anchor. Translate emotion into physical evidence; do not write metaphor, inner state, or invisible causes. The visual medium is locked separately via the project's style reference image. Do not dictate art style, color palette, or "cinematic" framing in words.* (Source includes GOOD/BAD examples per axis.)
- Output: per-shot JSON via `write_shot_prompts` tool — `{ id, visualPrompt, motionPrompt, continuityFrom }`

#### seedance-storyboard-image `[web-direct]` (planner only — the render step is agent-tagged)

Plans one storyboard board + cut plan.

- Triggered by: Web "Board prompts" or per-shot "Write prompt". **Agent path:** Codex writes `drafts/storyboards/<scene>.md` → `apply_storyboard_prompts({ markdown })`.
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
- Model: `project.text_provider.refine` (vision)
- Inputs: feedback, currentPrompt, failedImage (optional), referenceImage (optional)
- Contract: *Apply the director's feedback to the current prompt. Keep what works, change what they asked for. 1-3 sentences. This prompt goes to an image model — just describe what should be in the frame.*
- Output: `{ visualPrompt }` via `rewrite_frame_prompt` tool

#### refine-end-frame-prompt `[web-direct]`

Same shape as `refine-shot-prompt`, applied to the end-frame prompt.

- Triggered by: Web "Refine" on end-frame prompt. **Agent path:** Codex edits saved `end_visual_prompt` and calls `apply_shot_prompts`.
- Model: `project.text_provider.refine` (vision)
- Inputs: feedback, currentPrompt, failedImage, referenceImage
- Contract: same as `refine-shot-prompt`, applied to the end-frame text.
- Output: `{ visualPrompt }`

#### refine-look-prompt `[web-direct]`

Rewrites a character or environment look-generation prompt using feedback.

- Triggered by: Web refine note before regenerating looks. **Agent path:** Codex rewrites the saved `generation_prompt` and re-runs `generate_candidates` with `promptOverride`.
- Model: `project.text_provider.refine` (vision)
- Inputs: feedback, currentPrompt, lockedLook, referenceImage
- Contract: same shape as `refine-shot-prompt`. Apply feedback to the reusable look prompt. Preserve identity and production usefulness. 1-3 sentences.
- Output: `{ visualPrompt }`

#### refine-video-prompt `[web-direct]`

Rewrites a shot's motion prompt using feedback + start/end frame context.

- Triggered by: Web "Refine" on motion prompt. **Agent path:** Codex edits saved `motion_prompt` and calls `apply_video_prompt`.
- Model: `project.text_provider.refine` (vision)
- Inputs: feedback, currentMotionPrompt, shotVisualPrompt, startFrame, endFrame, referenceImage
- Contract: *Apply the director's feedback to the motion prompt. This prompt goes to a video model alongside the start frame — it tells the model what to animate. 1-2 sentences, action + camera.*
- Output: `{ motionPrompt }` via `rewrite_motion_prompt` tool

#### write-audio-plan `[web-direct]`

Writes structured per-shot dialogue + sound notes from script + scene context.

- Triggered by: Web "Write dialogue" or audio-phase rewrites. **Agent path:** Codex writes `drafts/audio-plan.md` → `apply_audio_plan({ markdown })`.
- Model: `project.text_provider`
- Inputs: project (title/source_payload), scene (label/narrative/lyrics), shot (id/duration/direction/visualPrompt/castIds), cast (with voice state), projectOverride
- Contract: *Write production audio data for one shot. Write spoken dialogue lines and restrained sound notes for this shot only. This is structured production data that drives dialogue context for video generation and optional TTS for overlay renders. It is not prose and it is not a script rewrite.*
- Output: structured audio-plan JSON — `{ dialogue: [{ characterId, text, order, targetSec? }], soundNotes? }`

#### chat-with-director `[web-direct]`

Answers user questions with project analysis context in view.

- Triggered by: Web Chat panel only. No agent equivalent — the agent IS the chat.
- Model: utility text (Gemini)
- Inputs: analysisContext, userMessage, history
- Contract: provides advice on prompts and pipeline with project analysis context. Light utility prompt, no production action.
- Output: plain text response

---

### Intake (4) — auto-fires at project creation, before any agent session

These run automatically when a project is first created (audio uploaded, or script seed pasted). No agent or user trigger.

#### transcribe-lyrics `[intake]`

Extracts timestamped lyrics from an uploaded audio file.

- Triggered by: audio upload at project creation
- Model: `audio.analysis` (Gemini 3 Pro)
- Inputs: audioBase64, mimeType, optional language hint
- Contract: timestamped lyric extraction with English transliteration where applicable
- Output: structured lyrics with timestamps

#### detect-structure `[intake]`

Detects musical sections + classifies song type + flags narrative/meditative traits.

- Triggered by: audio upload at project creation, after `transcribe-lyrics`
- Model: `audio.analysis` (Gemini 3 Pro)
- Inputs: audioBase64, mimeType
- Contract: identifies sections (intro/verse/chorus/etc.) with timestamps and tags audio classification flags
- Output: `{ sections[], songType, isNarrative, isMeditative }`

#### summarize-meaning `[intake]`

150-word interpretive summary of song meaning + cultural context.

- Triggered by: audio upload at project creation, after structure detection
- Model: `project.text_provider`
- Inputs: lyrics, songType, structure
- Contract: under 150 words covering narrative arc, central message/metaphor, emotional progression, cultural/spiritual context. English.
- Output: short interpretive prose

#### parse-script-intake `[intake]`

Converts uploaded script/treatment into structured cast/env/scenes/shots.

- Triggered by: script-first project creation from direct intake (PDF/text upload)
- Model: `project.script_writer`
- Inputs: scriptText, title, directorBrief, targetRuntime, pacing
- Contract: *Convert the uploaded script into a production-ready scene and shot plan. This is extraction and production planning, not story rewriting. Preserve story intent, scene order, character actions, and dialogue order unless the director brief explicitly asks for adaptation.*
- Output: structured plan via `parse_scripted_narrative` tool

---

### Automatic (3) — fires on system events

These fire as side effects of other operations, not by direct user or agent invocation.

#### chained-shot-refresh `[automatic]`

Rewrites the next shot's prompts when the previous shot's video lands.

- Triggered by: a shot's video gen completing when the next shot is tagged `continuity_from: prev_shot`
- Model: `project.text_provider.refine` (vision)
- Inputs: prevFrame, shotDirection, currentVisualPrompt, currentMotionPrompt, characterNames, environmentName
- Contract: *The image is the last frame of the previous shot. The next shot was drafted before this frame existed. Rewrite its prompts so they flow from what actually happened while honoring the shot's intent. Keep the shot intent. Rewrite so the first moment matches the frame — same characters, same state, natural continuation. Visual: 1-3 sentences. Motion: 1-2 sentences.*
- Output: `{ visualPrompt, motionPrompt }` via `rewrite_chained_shot` tool. Skipped in Seedance storyboard mode.

#### critique-shot-image `[automatic]`

Scores a generated shot frame 0–10 with actionable suggestions.

- Triggered by: a shot frame generation completing
- Model: utility vision (Gemini)
- Inputs: image, referenceImages (character refs), compiledPrompt, styleDNA
- Contract: scores style adherence (40%), prompt fidelity (30%), character consistency (20%), technical quality (10%). Returns score, reasoning, suggestions.
- Output: `{ score, reasoning, isConsistent, suggestions }`

#### describe-frame `[automatic]`

Short factual description of a video frame for continuity stitching.

- Triggered by: continuity description requests (typically before chained-shot-refresh in the legacy path)
- Model: utility vision (Gemini)
- Inputs: image
- Contract: *Describe this single video frame factually for shot continuity. 2-3 sentences max. Focus on: subject position/pose/expression, camera framing + angle, lighting mood, what action is mid-motion. Do NOT speculate about narrative or use flowery language. Write like a script supervisor noting continuity.*
- Output: 2–3 sentence factual description, plain text

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
| `plan-scenes` | "Generate script" | Codex writes `drafts/script.md` → `apply_script` |
| `refine-script` | "Refine script" | Codex edits `drafts/script.md` → `apply_script` |
| `write-shot-prompts` | "Rewrite all" | Codex writes prompts inline → `apply_shot_prompts` |
| `refine-shot-prompt` | "Refine" on visual prompt | Codex edits → `apply_shot_prompts` |
| `refine-end-frame-prompt` | "Refine" on end-frame | Codex edits → `apply_shot_prompts` |
| `refine-look-prompt` | "Refine" on look | Codex edits → `generate_candidates({ promptOverride })` |
| `refine-style-direction` | "Refine" on style | Codex edits → `apply_style_direction` |
| `refine-video-prompt` | "Refine" on motion | Codex edits → `apply_video_prompt` |
| `seedance-storyboard-image` planner | "Board prompts" | Codex writes `drafts/storyboards/<scene>.md` → `apply_storyboard_prompts` |
| `seedance-storyboard-refine` replan | "Redo" storyboard | Codex edits storyboard markdown → `apply_storyboard_prompts` |
| `write-audio-plan` | "Write dialogue" | Codex writes `drafts/audio-plan.md` → `apply_audio_plan` |

That's 13 prompts queued for deprecation. The 8 `[agent]`-tagged prompts stay; they're the actual production engines.

---

## Future cleanup backlog

Pinned items that surfaced during audit but aren't blocking. Take after smoke test passes so we know which abstractions earned their keep under real use.

### 1. Audio intake via agent path

**Problem:** `create_project` MCP today says "non-audio only." Audio projects still go through the legacy queue. That violates the general-machine principle — the agent should be able to start any project type from any seed.

**Slice:**
- Extend `/api/agent/uploads` with `audio_source` purpose (binary upload, same pattern as image purposes)
- Extend `create_project` MCP to accept `sourceAssetId` for audio
- Backend auto-fires the intake chain (`transcribe-lyrics` → `detect-structure` → `summarize-meaning`) when source is audio

**Why deferred:** small slice but not blocking. Bhakti / current production users still use the queue. Land after smoke test confirms agent-native intake works for non-audio projects first.

### 2. `workflow_key` as runtime branch is mostly legacy

**Problem:** `workflow_key` (`music_led` / `scripted_narrative`) was the *backend planner* discriminator under the old LLM-as-planner model. In agent-native Mirage, Codex IS the planner — it reads what's in the project (audio? script? brief?) and proceeds without needing a typed enum to route between backend prompts.

**Where it still earns its keep:**
- Auto-intake chain ("if source is audio, transcribe + analyze") — can be derived from source type, doesn't need an explicit workflow key
- Per-project `availableTools` / `blockedTools` filtering — can be derived from source assets
- Web-direct planner prompts (`plan-scenes` vs `parse-script-intake`) — cuttable when those web prompts go

**Slice (eventual):** replace `workflow_key` with a `seed_kind` derived property (or fold into source-asset existence). Most call sites collapse to "does this project have audio? does it have a script?" rather than a typed branching enum.

**Why deferred:** real refactor; cuts run deep. Make web-direct planner prompts deprecated first (#3 below), then workflow_key cleanup is the natural follow-up.

### 3. Collapse `mirrors/` + `drafts/` into single editable artifacts

**Problem:** The two-file pattern is inherited cruft. Editable surfaces (script, audio-plan, storyboard prompts) currently have both a read-only `mirrors/` snapshot and an editable `drafts/` copy. In agent-native flow, Codex's apply response already returns the refreshed artifact inline; the disk file just needs auto-refresh from the sync layer.

**Slice (per Codex's read on this):**
- Collapse only the editable surfaces — `mirrors/script.json` + `drafts/script.md` → single editable `script.md`. Same for audio-plan, storyboard drafts.
- Keep `state/` (renamed from surviving `mirrors/`) for read-only DB projections: cast, environments, asset manifest, render history, event log. These aren't authored content; they're DB-computed.
- Apply tools' `changedArtifacts` response field carries the refreshed content; CLI sync layer writes it.

**Why deferred:** workbench file restructure with downstream ripples (CLI sync, MCP notebook builder, AGENTS.md, every codex reference). Do it after the audit pass is complete so notes don't get harder to apply mid-restructure.

### 4. Per-project filtering of materialized action schemas

**Problem:** `config/actions/index.json` and `config/actions/<surface>.json` currently contain the full 25-action registry, not filtered by per-project `availableTools` / `blockedTools`. MCP `list_actions` does filter, so the file and the live tool can disagree.

**Today this doesn't bite** because `availableTools` filtering isn't actively gating actions in production. Will bite when it does.

**Slice:** apply per-project filtering when materializing the action files. Small change in `buildActionsArtifacts()`.

**Why deferred:** no active per-project filtering today, so no real drift to fix yet. Add when per-project gating becomes a real feature.

### 5. Cut audio-classification tags (`isNarrative`, `isMeditative`, `songType`)

**Problem:** Lahari-era devotional-music domain leakage. Used in `detect-structure` output, concept.ts, planScenes.ts, shotPrompts.ts (`meditativeGuidance` injects ~7 lines of "favor stillness, patience" doctrine when meditative=true), styleBrainstorm.ts. Auto-injected preset doctrine is exactly what the style-notes architecture replaces.

**Slice:**
- Drop `is_narrative` / `is_meditative` / `song_type` columns from project + audio_analysis tables
- Remove conditional branches in 5 prompt builders
- Simplify `detect-structure` LLM output (return only sections + lyrics, no traits)
- If an artist wants meditative pacing, they write it into `style-notes.image` / `style-notes.motion` as a one-time bible note — ships into every relevant call automatically

**Why deferred:** clean cleanup with no behavior loss for the general machine. Defer until music_led pipelines have been smoke-tested without these flags (or confirmed unused by current Bhakti projects).

### 6. Split `generate_style_candidates` into brainstorm + render

**Problem:** Today `generate_style_candidates` does two things in one action: fires `brainstorm-style-directions` LLM to write 4 direction texts, then fires `visualize-style` per direction to render images. In agent-native flow, Codex writes the direction texts itself; only the image render is genuinely paid work that needs a backend action.

**Workaround today:** Codex calls the action 4 times with 4 different `promptOverride` values to bypass brainstorm. Functional but ugly.

**Slice:**
- Add `directions?: Array<{ title, description }>` input to `generate_style_candidates`
- When provided, skip brainstorm and render each direction
- When absent, fire brainstorm as today (web flow)
- Retag `brainstorm-style-directions` `[web-direct]`; the only remaining `[agent]`-tagged style prompt becomes `visualize-style`

**Why deferred:** the workaround works; not blocking. Land alongside web-direct deprecation pass.

### 7. Fallback strategy when agents are unavailable

**Problem:** If we fully cut web-direct prompts (the 13 conditional cuts), Mirage operates only through agents. If Codex is down and no alternate agent is reachable, artists can't operate the system. This is the operational SLA question.

**Three realistic fallback layers:**
1. **Multi-agent compatibility (primary).** Codex isn't the only MCP client. Claude / Claude Code / future agents can drive the same surface. If Codex is down, point another agent at the MCP server. Natural resilience.
2. **Manual entry web (secondary).** Artist can type concept JSON / script markdown / etc. directly into web forms and hit Apply. No backend LLM. Engineer-friendly fallback.
3. **Thin admin/emergency LLM (tertiary).** Backend LLM layer gated behind a feature flag, not artist-facing by default. Used only when 1+2 are both unavailable. Tiny surface, mostly dormant.

**Why deferred:** the question matters before fully cutting web-direct prompts but doesn't block agent-native work today. Decide before the Phase 3 / 4 deprecation lands. Likely the answer is "multi-agent + manual entry; no emergency LLM layer" — Mirage's SLA becomes agent availability.

### 8. Hide `identify_style` from agent-facing action surface

**Problem:** `identify_style` is the one Layer 2 action where Codex's native vision genuinely overlaps the action's job. Every other generate_* fires a model Codex can't run (image/video/TTS/edit). Codex can see images directly and write a 2-3 sentence style description into `apply_style_direction` without calling `identify_style` at all.

**Slice:**
- Filter `identify_style` out of `config/actions/style.json` when materializing for agent
- Keep server-side auto-fire behavior inside `apply_style_direction` (C4 auto-identify when locking with empty text)
- Web UI keeps calling it via legacy route

**Why deferred:** tiny saving (1 action shaved). Principled, not urgent.

---

## Appendix

### Upload boundary

Local images do not go through MCP. POST multipart to `/api/agent/uploads` with the Mirage bearer token; pass the returned `assetId` as `sourceAssetId` (lock as-is) or `guideAssetId` (use as visual guide).

Purposes: `style_guide`, `style_reference`, `cast_guide`, `cast_reference`, `env_guide`, `env_reference`.

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
