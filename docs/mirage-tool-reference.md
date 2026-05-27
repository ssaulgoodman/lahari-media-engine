# Mirage Tool Reference

Canonical reference for every Mirage MCP action and runtime prompt. Describes the current shape — what each tool does, what it accepts, what prompt (if any) runs, and where its code lives.

**Read order:**
- **This doc** = canonical zero-notes mirror. Read here when you want the clean current shape of the system.
- **`docs/mirage-tool-and-prompt-audit.md`** = working/audit doc with the same content plus per-tool Notes blocks and Pass log. Read there when you're doing a review pass and want to leave findings.
- **`docs/mirage-composer-architecture.md`** = architectural background.
- **`docs/mirage-platform-v1-ledger.md`** §2 = locked decisions (D1–D27).

**Sources of truth this is derived from:**
- Action contracts: `server/services/actionRegistry.ts`
- Runtime prompt builders: `server/prompts/*.ts`
- Catalog metadata: `server/prompts/catalog.ts`
- MCP wiring: `server/routes/mcp.ts`

If this doc drifts from those files, those files win. Re-derive after material changes.

## Mental model

Three classes of MCP-callable action:

1. **`apply_*` — graph writes.** Persist Codex-authored text or structured data into the project graph. Cheap. No LLM call inside Mirage. Agent path: Codex writes, Mirage validates and persists.
2. **`generate_*` — paid worker calls.** Spend money: image/video/audio generation, style brainstorm, candidate batches. `dryRun: true` returns cost/requirements without spending. Most accept `contextOverrides` for per-call ref/style-note control and `promptOverride` for one-off exact prompt swaps.
3. **`refine_*` — media edits.** Edit an existing generated asset using a Codex-translated edit instruction. Not a regenerate from scratch — preserves everything except the requested change.

Cross-cutting controls available on most generate calls:

- **`contextOverrides`** — per-call include/exclude/swap of attached refs and style-note buckets. Cheaper than a `promptOverride` when you only need to drop one ref or include a different style asset.
- **`promptOverride`** — exact final prompt the worker receives. Highest-leverage agent control; use when graph data + overrides aren't enough.
- **`modelOverride`** — swap the routed model for this call only (image/video/storyboard provider).

Project-level mechanisms (lighter to heavier):

- **`apply_project_style_notes`** — per-surface taste/technique memory (image, storyboard, motion, script, dialogue, audio). Composer reads selected buckets into a `STYLE NOTES` section. Use for repeated phrasing/technique.
- **`apply_project_prompt_override`** — complete prompt recipe for one declared kind. Composer reads into a `PROJECT OVERRIDE` section. Use for repeated complete recipes.
- **`apply_project_preferences`** — model/provider routing (textProvider, imageModel, storyboardProvider, videoModel).

## MCP surface layout

Mirage's MCP server exposes three concentric layers. The 25 action specs in the index below are **not MCP tools themselves** — they're dispatched through the registry layer via `run_action` / `start_job`.

**Cockpit (orchestration — 6 tools):**

| Tool | Purpose |
|---|---|
| `list_projects` | List projects you can access |
| `open_project` | Start a session on one project; writes notebook desk copy + mirror snapshots |
| `create_project` | Create a non-audio project from intake |
| `get_project_state` | Current project graph snapshot |
| `get_agent_timing_summary` | Quick perf snapshot |
| `mirage_capture_issue` | Capture artist-reported issue |

**Registry dispatch (action invocation — 8 tools):**

| Tool | Purpose |
|---|---|
| `list_actions` | List action-spec keys available for this project |
| `describe_action` | Full schema + example for one action |
| `run_action(actionKey, input)` | Synchronous dispatch; returns result |
| `start_job(actionKey, input)` | Async dispatch; returns `jobId` |
| `get_job(jobId)` | Poll job state |
| `list_jobs({ projectId? })` | List recent jobs |
| `parallel_run({ calls[] })` | Small parallel batch (independent non-paid) |
| `list_results({ projectId? })` | Recent generation results |

**Resources (project file/data reads — 3 tools):**

| Tool | Purpose |
|---|---|
| `get_project_notebook_manifest` | List files in the project workbench |
| `read_project_notebook_file` | Read one file by path |
| `mint_cli_token` | Issue shell-specific sync command for notebook materialization |

**Legacy** (~50 direct tools): hidden by default; surface only when `MIRAGE_MCP_INCLUDE_LEGACY_TOOLS=1`. For backward-compat debugging.

**Total active MCP surface:** 17 tools. Everything else flows through `run_action` / `start_job` with one of the action keys below.

## How prompts get fired

Catalog entries in `server/prompts/catalog.ts` carry a `path` tag indicating who triggers them at runtime. The reference below uses the same tags inline (e.g. `character-look [agent]`).

| Tag | What it means |
|---|---|
| `agent` | Fires when an MCP action invokes a backend LLM/image/video call. Both Visual Studio buttons and agent sessions hit the same code. |
| `web-direct` | Fires only on Visual Studio buttons. In agent path, Codex does the equivalent work locally (edits `drafts/*.md` or saved JSON) and calls the matching `apply_*` tool — **no backend LLM call.** |
| `intake` | Fires at project creation before any agent session exists (lyric transcription, music structure analysis, script seed parsing). |
| `automatic` | Fires on system events — after a shot's video lands (continuity refresh), after a frame lands (critique). Not artist- or agent-triggered. |
| `shared` | Used by both paths; rare. Today only `seedance-storyboard-refine` because its replan branch is web-direct and its edit_image branch is agent-callable. |

Web-direct prompts will eventually be deprecated as the agent surface displaces the corresponding Visual Studio buttons. Until then they coexist; the tag tells you which path to expect.

## Index

**Reading note:** all 25 actions are agent-callable through `run_action` / `start_job`. The **Kind** column tells you what happens when the agent invokes it:

- **`persistence`** — write Codex-authored data to the DB. No backend LLM call. Most `apply_*`. Some have related web-only recipes that exist for Visual Studio's flow, not the agent's.
- **`generation`** — fires a paid model call (LLM, image, video, or media edit) when invoked. `generate_*` and `refine_storyboard_image`.
- **`analysis`** — fires a paid model call but doesn't mutate (e.g. `identify_style` reads an image, returns text).
- **`read`** — list/get; no mutation, no model call.
- **`control`** — lock/unlock/revert; mutation but no model call.

| Key | Surface | Kind | Mutates | Paid | One-liner |
|---|---|---|:-:|:-:|---|
| `apply_concept` | concept | persistence | ● | — | Persist Codex-written locked concept. |
| `apply_script` | script | persistence | ● | — | Persist cast/environments/scenes/shots from JSON or markdown. |
| `apply_shot_prompts` | script | persistence | ● | — | Persist Codex-written visual/motion/direction/continuity per shot. |
| `apply_shot_workflow_modes` | script | persistence | ● | — | Persist per-shot workflow path: auto/storyboard/keyframe. |
| `generate_style_candidates` | style | generation | ● | ● | Paid style reference candidate batch. |
| `identify_style` | style | analysis | — | ● | Analyze locked style asset; return concise style text. |
| `apply_style_direction` | style | persistence | ● | — | Persist style text and/or lock a style asset. |
| `generate_candidates` | looks | generation | ● | ● | Paid cast/environment reference candidate batch. |
| `list_candidates` | looks | read | — | — | List candidate URLs/asset IDs for one entity. |
| `lock_reference` | looks | control | ● | — | Set canonical character/environment reference. |
| `generate_storyboard` | storyboard | generation | ● | ● | Render storyboard image for one shot. |
| `bulk_generate_storyboards` | storyboard | generation | ● | ● | Render storyboards for many shots. |
| `apply_storyboard_prompts` | storyboard | persistence | ● | — | Persist Codex-written storyboard prompt + cut plan. |
| `refine_storyboard_image` | storyboard | generation | ● | ● | Image-edit the current storyboard with a narrow instruction. |
| `lock_storyboard` | storyboard | control | ● | — | Approve a storyboard version for video gen. |
| `unlock_storyboard` | storyboard | control | ● | — | Clear storyboard approval. |
| `generate_video` | video | generation | ● | ● | Render the video clip for one shot. |
| `apply_video_prompt` | video | persistence | ● | — | Persist Codex-written keyframe motion prompt. |
| `generate_dialogue_audio` | audio | generation | ● | ● | Generate ElevenLabs TTS for dialogue lines. |
| `apply_audio_plan` | audio | persistence | ● | — | Persist Codex-written dialogue + sound notes per shot. |
| `apply_cast_voice` | audio | persistence | ● | — | Assign ElevenLabs voice ID to a cast member. |
| `apply_project_preferences` | system | persistence | ● | — | Persist model/provider routing for the project. |
| `apply_project_style_notes` | system | persistence | ● | — | Persist per-surface project taste/technique memory. |
| `apply_project_prompt_override` | system | persistence | ● | — | Persist a project-scoped complete prompt recipe. |
| `revert_project_prompt_override` | system | control | ● | — | Roll back a project prompt override. |

Pipeline-only prompts (not MCP-callable): `transcribe-lyrics`, `detect-structure`, `summarize-meaning`, `critique-shot-image`, `describe-frame`, `chat-with-director`.

---

## Concept

### apply_concept

Persist a Codex-written locked concept object. Reapplying is the edit path.

```
Input  { projectId, concept: { title, direction, description, mood? }, baseHash?, force? }
Output mirage.apply.concept
```

No LLM call. Concept body is Codex-authored before this call; for web-direct intake the `generate-concepts` prompt produces options the user picks among.

**Related runtime prompts:**
- `generate-concepts` `[web-direct]` — `server/prompts/concept.ts:buildGenerateConceptPrompt`. Web brainstorm of 3 directions.
- `refine-concept` `[web-direct]` — `server/prompts/concept.ts:buildRefineConceptPrompt`. Surgical refine via web button. **Agent path:** Codex edits the concept JSON and re-calls `apply_concept`.

---

## Script

### apply_script

Persist project cast, environments, scenes, and shots. Accepts structured script JSON or one Mirage script markdown draft.

```
Input  { projectId, script?, markdown?, baseFingerprint?, force? }
Output mirage.apply.script
```

Atomic. Drift-checked via `baseFingerprint`. Use `force: true` only when intentionally overwriting drift.

**Related runtime prompts:**
- `plan-scenes` `[web-direct]` — `server/prompts/planScenes.ts:buildPlanScenesPrompt`. Initial script generation via web button (music_led). Extended thinking + validation loop. **Agent path:** Codex writes the script in `drafts/script.md` and applies.
- `plan-scenes-openai` `[web-direct]` — Same composed prompt, GPT-5.5 worker (experimental, env-flagged; cut candidate).
- `parse-script-intake` `[intake]` — `server/prompts/parseScript.ts:buildParseScriptPrompt`. Auto-fires when an artist uploads a script seed at project creation. Agent intake (Codex-driven) bypasses this — Codex reads the source itself.
- `refine-script` `[web-direct]` — `server/prompts/refineScript.ts:buildRefineScriptPrompt`. Surgical refine via web button. **Agent path:** Codex edits `drafts/script.md` and re-applies with markdown.

### apply_shot_prompts

Persist Codex-written visual, motion, direction, or continuity prompt text for one or more shots. This is the prompt-edit path; use it when the artist asks for a tonal/wording change rather than a media regenerate.

```
Input  { projectId, shots: [{ shotId, visualPrompt?, motionPrompt?, direction?, continuityFrom?, baseHash? }], force? }
Output mirage.apply.shot_prompts
```

**Related runtime prompts:**
- `write-shot-prompts` `[web-direct]` — `server/prompts/shotPrompts.ts:buildWriteShotPromptsPrompt`. Bulk shot prompt writing via web "Rewrite all" button. **Agent path:** Codex writes per-shot prompts inline and applies.
- `refine-shot-prompt` / `refine-end-frame-prompt` / `refine-video-prompt` `[web-direct]` — `server/services/claude.ts:refineFramePrompt`/`refineMotionPrompt`. Web refine buttons. **Agent path:** Codex edits the saved prompt text and calls `apply_shot_prompts` / `apply_video_prompt`.
- `chained-shot-refresh` `[automatic]` — `server/services/claude.ts:refreshChainedShotPrompt`. Auto-fires after a shot's video lands when next shot is `prev_shot`. Not artist- or agent-triggered.

### apply_shot_workflow_modes

Persist per-shot workflow path overrides: auto, storyboard, or keyframe.

```
Input  { projectId, shots: [{ shotId, workflowMode, note? }] }
Output mirage.apply.shot_workflow_modes
```

No LLM call.

---

## Style

### generate_style_candidates

Generate reusable style reference candidates. Use `guideAssetId` after uploading an image as visual guidance, `note` for soft direction, or `promptOverride` for one exact candidate.

```
Input  { projectId, note?, promptOverride?, guideAssetId?, count? (1-4),
         contextOverrides?: { includeConcept?, includeProjectStyleDescription?, includeGuideAsset?, styleNoteSections? } }
Output mirage.generate.style_candidates
```

For local-image upload, POST multipart to `/api/agent/uploads` with the Mirage bearer token to get an `assetId`, then pass as `guideAssetId`.

**Related runtime prompts:**
- `brainstorm-style-directions` `[agent]` — `server/prompts/styleBrainstorm.ts:buildStyleBrainstormPrompt`. Text brainstorm of 4 directions when no guide. Includes selected style-note buckets when learned.
- `visualize-style` `[agent]` — `server/prompts/visualizeStyle.ts:buildVisualizeStylePrompt`. Renders one direction into a style reference frame. Action invariants (no text, no watermark, single image) in OUTPUT CONTRACT.

### identify_style

Analyze the locked or provided style asset and return a concise style description for artist confirmation.

```
Input  { projectId, assetId? (defaults to locked style) }
Output mirage.style.identification
```

Auto-fires on `apply_style_direction` when locking an asset with empty/weak style text (per C4).

**Related runtime prompt:**
- `analyze-image-style` `[agent]` — `server/services/claude.ts:analyzeImageStyle`. Returns 2-3 sentence style fragment.

### apply_style_direction

Persist style direction text and/or lock an existing style asset as the project style. When locking a style asset with empty style text, Mirage auto-identifies a concise style description.

```
Input  { projectId, style: { styleDescription?, styleGenerationPrompt?, colorPalette?, sourceAssetId? }, baseHash?, force? }
Output mirage.apply.style_direction
```

**Related runtime prompt:**
- `refine-style-direction` `[web-direct]` — `server/prompts/refineStyle.ts:buildRefineStylePrompt`. Surgical refine via web button. **Agent path:** Codex edits the saved direction text and re-calls `apply_style_direction`.

---

## Looks

### generate_candidates

Generate reusable character or environment reference candidates. Use `note` for soft direction, `promptOverride` for an exact final prompt, and `guideAssetId` after uploading an image as a visual guide.

```
Input  { projectId, entityType: "cast" | "environment", entityIds: string[],
         note?, promptOverride?, guideAssetId?,
         contextOverrides?: { includeStyleImage?, includeProjectStyleDescription?, styleNoteSections? } }
Output mirage.generate.candidates
```

`promptOverride` requires a single `entityId`. Style-note default bucket: `image` (with per-model phrases for the active image model).

**Related runtime prompts:**
- `character-look` `[agent]` — `server/prompts/lookPrompts.ts:buildCharacterLookPrompt`. Action invariants (neutral pose, plain background, no scene action) in OUTPUT CONTRACT.
- `environment-look` `[agent]` — `server/prompts/lookPrompts.ts:buildEnvironmentLookPrompt`. Whole space visible, no characters unless tiny for scale.
- `refine-look-prompt` `[web-direct]` — `server/services/claude.ts` via `refineFramePrompt`. **Agent path:** Codex rewrites the saved look prompt and re-runs `generate_candidates` with `promptOverride`.

### list_candidates

List generated candidate image URLs and asset IDs for one cast member or environment.

```
Input  { projectId, entityType, entityId }
Output mirage.list.candidates
```

### lock_reference

Set an existing Mirage asset as the canonical character or environment reference. Use after `list_candidates` or `/api/agent/uploads`.

```
Input  { projectId, entityType, entityId, sourceAssetId }
Output mirage.apply.locked_reference
```

---

## Storyboard

### generate_storyboard

Render a storyboard board for one shot from its saved storyboard prompt. `dryRun: true` returns the plan without spending.

```
Input  { projectId, shotId, dryRun?, artistNote?, modelOverride?,
         contextOverrides?: { includeStyleImage?, excludeCastRefs?, includePreviousStoryboard?, styleNoteSections? } }
Output mirage.generate.storyboard | mirage.dryrun.storyboard
```

Sends saved `storyboardPrompt` + locked refs to the active storyboard provider. Cut plan is NOT sent here (it drives downstream Seedance video). In edit_image refine mode, previous storyboard is prepended.

**Related runtime prompt:**
- `render-seedance-storyboard-image` `[agent]` — `server/services/storyboard.ts:generateStoryboardVersion`.

### bulk_generate_storyboards

Generate missing/stale/error storyboard boards for selected shots. Use `parallel_run` for custom parallel batches.

```
Input  { projectId, shotIds?, force?, artistNote?, modelOverride?, contextOverrides? }
Output mirage.bulk.storyboards
```

Same runtime template as `generate_storyboard`; `contextOverrides` applied to every shot in the batch.

### apply_storyboard_prompts

Persist Codex-written storyboard prompt and cut-plan text. Accepts either structured `shots[]` or one scene markdown draft. **Edit the saved text here when "make it brighter" / "less grungy" is really a prompt change; do not use `refine_storyboard_image` for prompt rewrites.**

```
Input  { projectId, shots?, markdown?, force? }
Output mirage.apply.storyboard_prompts
```

**Related runtime prompt (the planner that authors the persisted prompt):**
- `seedance-storyboard-image` `[web-direct]` — `server/prompts/storyboard.ts:buildStoryboardPlannerPrompt`. Fires when web "Board prompts" is clicked. STYLE NOTES (image + storyboard buckets, per-model phrases) + PROJECT OVERRIDE wired. **Agent path:** Codex writes the storyboard prompt inline in `drafts/storyboards/<scene>.md` and applies via `apply_storyboard_prompts`.

### refine_storyboard_image

Edit the current storyboard image using a narrow positive edit instruction (image-edit mode, not prompt rewrite). Codex translates raw artist chat into a concrete one-axis change before calling this; do not forward "make it less grungy" / "make it brighter" style notes verbatim. **If the prompt itself is wrong, use `apply_storyboard_prompts` instead.**

```
Input  { projectId, shotId, feedback, previousVersionId?, modelOverride? }
Output mirage.refine.storyboard
```

`feedback` is the Codex-translated edit instruction — e.g. "Keep composition, characters, panel layout. Brighten lighting one stop; clean up the dirty grungy texture into a cleaner matte finish."

**Related runtime prompt:**
- `seedance-storyboard-refine` `[shared]` — `server/services/storyboard.ts:generateStoryboardVersion`. Two branches: `edit_image` is agent-callable (this action); `replan` is web-direct (web "Refine" → rewrites saved storyboardPrompt + cutPlan; in agent path Codex edits the text and calls `apply_storyboard_prompts`).

### lock_storyboard / unlock_storyboard

```
lock_storyboard   { projectId, shotId, versionId? }
unlock_storyboard { projectId, shotId }
```

No LLM call. `lock_storyboard` marks the active version approved so `generate_video` can consume it. `unlock` clears approval.

---

## Video

### generate_video

Generate the video clip for one shot. `dryRun: true` returns requirements, provider, and cost without spending.

```
Input  { projectId, shotId, dryRun?, promptOverride?, modelOverride? }
Output mirage.generate.video | mirage.dryrun.video
```

Two paths depending on shot's workflow mode:
- **Keyframe** — uses saved `motionPrompt` and attached ref labels via `shot-video-assembly`.
- **Storyboard** — animates locked storyboard panels via `seedance-storyboard-video`; consumes saved cut plan.

**Related runtime prompts:**
- `shot-video-assembly` `[agent]` — `server/routes/generate-video.ts`. `{motionPrompt}. {refLabels}`.
- `seedance-storyboard-video` `[agent]` — `server/services/seedance-storyboard-rd.ts:buildSeedanceStoryboardVideoPrompt`.

### apply_video_prompt

Persist a Codex-written keyframe-mode motion prompt. This does not generate video.

```
Input  { projectId, shotId, motionPrompt, baseHash?, force? }
Output mirage.apply.video_prompt
```

Keyframe mode only. Storyboard mode consumes the saved cut plan from `apply_storyboard_prompts`, not this field.

---

## Audio

### generate_dialogue_audio

Generate ElevenLabs TTS for selected pending/error dialogue lines. `dryRun: true` returns cost and missing voices without spending.

```
Input  { projectId, dryRun?, shotIds?, dialogueIds?, characterIds? }
Output mirage.generate.dialogue_audio | mirage.dryrun.dialogue_audio
```

No LLM call. Dialogue text being spoken comes from `apply_audio_plan`; cast voice IDs from `apply_cast_voice`.

### apply_audio_plan

Persist Codex-written per-shot dialogue lines, sound notes, and lipsync/overlay strategy. Accepts structured `shots[]` or one audio-plan markdown draft.

```
Input  { projectId, shots?, markdown?, force? }
Output mirage.apply.audio_plan
```

**Related runtime prompt:**
- `write-audio-plan` `[web-direct]` — `server/prompts/audioPlan.ts:buildAudioPlanPrompt`. Composed via composePrompt. Generates structured audio-plan JSON on web "Write dialogue" click. **Agent path:** Codex writes the audio plan inline in `drafts/audio-plan.md` and applies.

### apply_cast_voice

Assign an ElevenLabs voice ID to one cast member for overlay TTS generation.

```
Input  { projectId, castMemberId, voiceProvider: "elevenlabs", voiceId, voiceName?, baseHash?, force? }
Output mirage.apply.cast_voice
```

---

## System

### apply_project_preferences

Persist project-level model/provider preferences such as `textProvider`, `imageModel`, `storyboardProvider`, and `videoModel`.

```
Input  { projectId, preferences: { textProvider?, imageModel?, storyboardProvider?, videoModel? }, baseHash? }
Output mirage.apply.project_preferences
```

### apply_project_style_notes

Persist per-surface project style notes learned during production — the editable taste/technique memory the project graph carries into every relevant call. Use this when the same phrasing or technique keeps improving outputs and should become project data rather than a per-call note. Lighter than `apply_project_prompt_override` (that one carries a full recipe; this one carries phrasing fragments).

```
Input  { projectId,
         styleNotes: {
           image?, storyboard?, motion?, script?, dialogue?, audio?,
           modelPhrases?: { [modelKey]: string[] }
         },
         baseHash? }
Output mirage.apply.project_style_notes
```

Composer reads selected buckets into a `STYLE NOTES` section. Currently consumed at runtime: `image` (look/style/storyboard), `storyboard` (storyboard planner). `motion`, `script`, `dialogue`, `audio` are accepted by the schema but not yet read by any builder (forward-compat).

### apply_project_prompt_override

Persist a project-scoped complete prompt recipe override for one declared kind. Use when the same complete per-call `promptOverride` keeps working and should become the project default. For repeated phrasing or per-surface taste fragments, prefer `apply_project_style_notes` (lighter, graph-data, composer-injected).

```
Input  { projectId, kind, body, baseHash? }
Output mirage.apply.project_prompt_override
```

Declared kinds: `concept`, `script`, `style`, `character_looks`, `environment_looks`, `storyboard`, `video`, `audio_plan`. **Currently consumed at runtime:** `storyboard`, `video`, `character_looks`, `environment_looks`. The other four are declared but not yet wired (Pattern 7 — tracked in composer audit).

### revert_project_prompt_override

Remove or roll back a project-scoped prompt recipe override so the engine uses the previous active recipe or global default.

```
Input  { projectId, kind, baseHash? }
Output mirage.revert.project_prompt_override
```

---

## Pipeline-only prompts

Not exposed as agent-callable MCP actions. Fire either at intake, on system events, or via Visual Studio surfaces.

| Id | Path | Stage | Model | Builder | Purpose |
|---|---|---|---|---|---|
| `transcribe-lyrics` | `intake` | audio | audio.analysis | `server/services/gemini.ts` | Timestamped lyric extraction at intake. |
| `detect-structure` | `intake` | audio | audio.analysis | `server/services/gemini.ts:detectStructure` | Musical sections + song-type classification. |
| `summarize-meaning` | `intake` | audio | project.text_provider | `server/services/claude.ts` | 150-word interpretive song summary. |
| `critique-shot-image` | `automatic` | utilities | utility.vision | `server/services/gemini.ts` | Auto-fires after a shot frame lands; 0–10 score + suggestions. |
| `describe-frame` | `automatic` | utilities | utility.vision | `server/services/gemini.ts` | Continuity description for chained shots. |
| `chat-with-director` | `web-direct` | utilities | utility.text | `server/services/gemini.ts` | Web Chat panel only — no agent equivalent (agent IS the chat). |

---

## Composer section order

Every composer-built prompt assembles in this order. Sections that have no content are omitted (not rendered as empty headers).

```
<coreTask>                  ← action contract (top of hierarchy)

INPUTS
<formatted project graph data + refs the tool received>

STYLE NOTES
<selected per-surface project style-note buckets, optional model-phrase list>

PROJECT OVERRIDE
<per-project recipe override body for this kind, if set>

USER NOTE POLICY                ← legacy/web-direct only
<how this tool's USER NOTE interacts with contract/data; absent in agent path>

OUTPUT CONTRACT
<required response shape and hard rules>

USER NOTE                       ← legacy/web-direct only
<raw artist note; agent sessions translate before calling MCP>
```

Section names referenced in this doc map to those headers. Builders pass typed `ComposePromptParts` — see `server/prompts/_composer.ts`.

## Upload boundary

Local image upload uses an HTTPS endpoint, not MCP. Do not send bytes through MCP tools.

```
POST /api/agent/uploads
  Authorization: Bearer <mirage_token>
  Content-Type: multipart/form-data
  fields: projectId, purpose, file

Returns: { assetId, ... }
```

Purposes: `style_guide`, `style_reference`, `cast_guide`, `cast_reference`, `env_guide`, `env_reference`. Then pass the returned `assetId` as `sourceAssetId` (lock as-is) or `guideAssetId` (use as visual guide for generation).

## Async jobs

Paid actions can be fired async via the cockpit:

```
start_job(actionKey, input)  → { jobId }
get_job(jobId)               → { status, result?, error? }
list_jobs({ projectId? })    → [{ jobId, status, ... }]
```

Job state persists in `studio_agent_operations`. Visual Studio realtime listener picks up the agent pill automatically.
