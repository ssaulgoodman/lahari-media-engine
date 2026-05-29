# Mirage Tool Reference

Canonical reference for the Mirage MCP surface. Three layers: MCP tools, actions, prompts. Each layer is the format that fits it — table for tools/actions, grouped blocks for prompts.

**Read order:**
- This doc = clean current shape, no notes/history.
- `docs/mirage-tool-and-prompt-audit.md` = same content + per-action Notes blocks and Pass log for active reviews.
- `docs/mirage-composer-architecture.md` = architectural background.
- `docs/mirage-platform-v1-ledger.md` §2 = locked decisions (D1–D28).

Sources of truth this is derived from: `server/services/actionRegistry.ts`, `server/prompts/*.ts`, `server/services/{claude,gemini,storyboard,seedance-storyboard-rd}.ts`, `server/routes/mcp.ts`, `server/prompts/catalog.ts`. If this doc drifts from those files, those files win.

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

The MCP server exposes 17 tools to Codex. Action specs in Layer 2 are **not** MCP tools — they're dispatched through `run_action` / `start_job`.

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
| `list_actions` | List action-spec keys available for this project (filtered by `availableTools`/`blockedTools`). |
| `describe_action` | Full schema + example for one action. |
| `run_action` | Synchronous dispatch by `actionKey`; returns result. |
| `start_job` | Async dispatch; returns `jobId` for paid actions. |
| `get_job` | Poll job state. |
| `list_jobs` | List recent jobs. |
| `parallel_run` | Small parallel batch (independent non-paid actions, cap 8). |
| `list_results` | List recent generation results (durable URLs/asset IDs). |

### Resources (3) — project file reads

| Tool | Purpose |
|---|---|
| `get_project_notebook_manifest` | List files in the project workbench. |
| `read_project_notebook_file` | Read one workbench file by path. |
| `mint_cli_token` | Issue shell-specific sync command for notebook materialization. |

**Legacy:** ~50 direct tools hidden by default; set `MIRAGE_MCP_INCLUDE_LEGACY_TOOLS=1` to surface for compatibility debugging only.

---

## Layer 2 — Actions (27 live registry actions; 26 materialized for agents)

Every action is agent-callable via `run_action(actionKey, input)` or `start_job(actionKey, input)`. **"Calls"** column tells you what runs when the agent invokes it.

| Key | Surface | What it does | Calls | Paid? |
|---|---|---|---|:-:|
| `apply_concept` | concept | Saves Codex-written concept JSON to DB | DB only | — |
| `apply_script` | script | Saves Codex-written script (JSON or markdown) to DB | DB only | — |
| `apply_shot_prompts` | script | Saves Codex-written visual/motion/direction text per shot | DB only | — |
| `apply_shot_workflow_modes` | script | Sets per-shot path: `auto` / `storyboard` / `keyframe` | DB only | — |
| `generate_style_candidates` | style | Renders style reference candidate batch | image model | ● |
| `identify_style` | style | Reads a style image, returns concise description | project.text_provider.refine (with image input); hidden from materialized agent action files | ● |
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
| `analyze_audio_transcribe` | audio | Opt-in audio transcription | audio analysis model | ● |
| `analyze_audio_structure` | audio | Opt-in musical structure detection | audio analysis model | ● |
| `generate_dialogue_audio` | audio | Renders TTS for selected dialogue lines | TTS | ● |
| `apply_audio_plan` | audio | Saves Codex-written dialogue + sound notes per shot | DB only | — |
| `apply_cast_voice` | audio | Assigns ElevenLabs voice ID to a cast member | DB only | — |
| `apply_project_preferences` | system | Saves project model/provider routing | DB only | — |
| `apply_project_style_notes` | system | Saves project per-surface style notes (taste memory) | DB only | — |
| `apply_project_prompt_override` | system | Saves project-scoped prompt recipe override | DB only | — |
| `revert_project_prompt_override` | system | Rolls back a project prompt override | DB only | — |

---

## Layer 3 — Prompts (28 total), grouped by path tag

The `path` tag on each Layer 3 prompt tells you who fires it at runtime. Contracts below are quoted verbatim from the prompt builder's `coreTask` (or its inline service equivalent).

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
- Output: storyboard image (typically 2×2 or 2×3 panel grid)

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

- Triggered by: Web "Generate script" button (music_led). **Agent path:** Codex writes `drafts/script.md` and `apply_script({ markdown })`.
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
- Inputs: shots[], cast[], concept, videoModel, previousBatchTail, userNote
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

- Triggered by: Web "Write dialogue" or audio-phase rewrites. **Agent path:** Codex writes `drafts/audio-plan.md` → `apply_audio_plan({ markdown })`.
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

#### detect-structure `[intake]`

Detects musical sections.

- Triggered by: `analyze_audio_structure` or the web "Analyze structure" button
- Model: `audio.analysis` (Gemini 3 Pro)
- Inputs: audioBase64, mimeType
- Contract: identifies sections (intro/verse/chorus/etc.) with timestamps and energy descriptions. It does not classify song type or infer narrative/meditative traits.
- Output: `{ sections[] }`

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

That's 13 prompts queued for deprecation. The 7 `[agent]`-tagged prompts stay; they're the actual production engines.

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

### Notebook drift detection

The `actionsHash` field on `get_project_state`, `open_project`, and project packets carries a hash of the action registry. Compare against the `version` field at the top of `config/actions/index.json` to detect schema drift. Re-sync via `mint_cli_token` if mismatch.
