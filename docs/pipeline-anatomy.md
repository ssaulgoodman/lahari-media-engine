# Pipeline Anatomy — Every Step, Every Prompt, Every Control Point

**Status:** Current behavior reference. Update whenever pipeline behavior, prompt flow, or artist control points change.

Living document. Updated as we refine each step. Go back to any step, trace the flow, find the gap, fix it.

**The pattern (universal across all steps):**
1. Artist sees the prompt that will be sent
2. Artist can edit it directly OR ask the LLM to refine it
3. Both update the same field — single source of truth
4. Generate sends exactly what's visible

---

## Step 1: Audio Analysis

Three sub-steps, each with its own LLM prompt. Execution order: lyrics + structure in parallel → meaning (depends on lyrics).

**Lyrics source priority (queue start):**
1. Cached analysis from `songs` table (`cached_lyrics`, `cached_structure`, `cached_meaning`, `cached_song_type`, `cached_is_narrative`, `cached_is_meditative`) — skips all AI calls
2. SRT file from Supabase (`srt_verified_san` > `srt_verified_*` > `srt_turbo_scribe`)
3. Fallback: audio transcription via Gemini

**Queue start is fully async**: project created immediately (title + queue link only), backend responds instantly. Audio download, SRT parsing, transcription, and analysis ALL run in the background. Project always starts as `status: 'analyzing'` — background promotes to `analyzed` once audio is downloaded (cached path) or full analysis completes. Audio download failure sets `error` status. Frontend polls every 3s until status changes. Lyrics, meaning, musical structure, and song classification are cached on `songs` table for future users.

**Multi-user**: `source_queue_id` on projects. Multiple users can start the same queued song — each gets their own project. No 403 when another user's project exists.

SRT files are parsed to `[M:SS] text` format (timestamps preserved — same format as Gemini transcription output). This lets Claude align lyrics to musical sections during script writing.

### 1a: Transcribe Lyrics

**Source:** [`server/services/gemini.ts:67`](../server/services/gemini.ts#L67) · Route: [`server/routes/projects.ts` → `POST /:id/analyze-audio`](../server/routes/projects.ts) and [`server/routes/queue.ts` → `POST /:queueId/start`](../server/routes/queue.ts)

| | |
|---|---|
| **Model** | Gemini 3 Pro (gemini.ts → `transcribeLyrics`) |
| **Input** | Audio file + language hint (if provided) |
| **Prompt** | `"Transcribe the lyrics of this audio. Language: {detect/provided}. Format: [M:SS] lyrics. Original language ONLY."` |
| **Output** | Timestamped lyrics text (`[0:00] First line\n[0:15] Second line`) |
| **Artist control** | Language hint at upload. Lyrics editable after in StepUpload. |
| **Prompt visible** | No |
| **When it runs** | Direct upload: always. Queue start: only if no SRT file found. Re-analysis: only if lyrics are missing. |

### 1b: Detect Musical Structure

**Source:** [`server/services/gemini.ts:95`](../server/services/gemini.ts#L95)

| | |
|---|---|
| **Model** | Gemini 3 Pro (gemini.ts → `detectStructure`) |
| **Input** | Audio file |
| **Prompt** | Analyze audio → sections (label/time/energy/description) + `songType` (enum: stotra, chant, bhajan, kirtan, song, unknown) + `isNarrative` (boolean) + `isMeditative` (boolean) |
| **Output** | `{ sections[], songType, isNarrative, isMeditative }` — structure + classification stored on project |
| **Artist control** | None before. Structure visible after but not editable. |
| **Prompt visible** | No |

**Song classification**: Gemini classifies the song from what it hears — not from lyrics or heuristics. The `songType` enum covers devotional forms (stotra, chant, bhajan, kirtan) plus a general `song` category. Boolean axes `isNarrative` and `isMeditative` are independent — a bhajan can be both. Classification flows to concept generation as context.

### 1c: Summarize Meaning

**Source:** [`server/services/claude.ts:19`](../server/services/claude.ts#L19)

| | |
|---|---|
| **Model** | Claude Sonnet (claude.ts → `summarizeMeaning`) |
| **Input** | title + language + lyrics + optional context |
| **Prompt** | `"Summarize the meaning. Cover: what it's about, who it's addressed to, emotional arc, cultural context. Under 150 words."` |
| **Output** | `meaning` — English summary |
| **Artist control** | Context provided at upload. Meaning not directly editable (yet). |
| **Prompt visible** | No |
| **Dependency** | Requires lyrics — runs after 1a completes, never in parallel with it. |

**"Fill missing" button:** UI shows which items are missing (Lyrics, Structure, Meaning) and runs only the missing steps. Lyrics + structure in parallel, then meaning chained after lyrics.

**Gaps:**
- [ ] Musical structure not editable after detection (can't add/remove/fix sections)
- [ ] Meaning not editable after generation
- [ ] If transcription gets language wrong, no way to correct and re-run with "this is Tamil"

**Status: DONE** — lyrics from SRT or audio transcription, timestamps preserved, meaning properly chained.

---

## Step 2: Concept Generation

**Source:** [`server/services/claude.ts:55`](../server/services/claude.ts#L55) · Route: [`server/routes/projects.ts:483`](../server/routes/projects.ts#L483) → `POST /:id/generate-concepts`

| | |
|---|---|
| **Model** | Claude Opus (claude.ts → `generateConceptOptions`) |
| **Input** | title + language + lyrics + meaning + musicalStructure + songType + isNarrative + isMeditative + optional `userNote` |
| **Output** | 3 concept options (title, deity, mood, theme). `visualSuggestions` removed from UI — visual style decided in Style phase. |
| **Artist control** | `userNote` appended as "DIRECTOR NOTE". Pick from 3 options. |
| **Prompt visible** | No (saved to `last_concept_prompt` but not exposed in UI) |
| **generation_prompt** | No |

**Song-type-aware concepts:** Claude receives `SONG TYPE (from audio analysis): stotra, meditative` as context. No hardcoded direction labels — Claude adapts all 3 directions to the song's nature. A stotra gets contemplative concepts, a kirtan gets energetic ones. Musical structure included as human-readable summary.

**Two paths to a concept:**

**Path A: Preset directions**
- Artist clicks "Generate concepts" → Opus generates 3 directions adapted to song type → artist picks one
- Good when artist wants inspiration or doesn't have a strong vision yet

**Path B: Director's brief** (new)
- Artist writes freeform text: "dreamy underwater sequence, Vishnu on cosmic ocean, deep blues and golds, slow and meditative"
- Same Opus call with same song context (lyrics, meaning, structure) but different instruction:
  - Instead of "generate 3 directions", says "generate ONE concept matching the director's brief"
  - Skips the traditional/modern/experimental slots
  - Opus fills the same structured fields (deity, mood, theme, direction, visualSuggestions) so downstream pipeline works identically
- Same "devotional cinema" framing as Path A (this is Lahari's tool — universal platform is a future fork)
- Result: one concept card, artist locks it or refines

**Both paths produce the same `locked_concept` structure. Everything downstream is identical.**

**After locking — edit + refine:**

The locked concept is NOT frozen. Three ways to adjust:

1. **Direct edit** — click any field (deity, mood, theme, direction) inline. Dashed underline shows editability. Saves on blur via `PATCH /:id/concept`. "Saved" flash confirms. No LLM, instant.
2. **Refine via LLM** — "make it darker, more nocturnal" → Claude Sonnet sees current concept + feedback, rewrites the fields. `POST /:id/refine-concept`. Same pattern as character/env refine.
3. **Swap concept** — unlock and pick a different option. ONLY this path wipes downstream (scenes/cast/env). Editing/refining within the same concept does NOT wipe.

**Source:** Refine: [`server/routes/projects.ts` → `POST /:id/refine-concept`](../server/routes/projects.ts) · [`server/services/claude.ts` → `refineConceptDirection`](../server/services/claude.ts)

**Changes made:**
- `visualSuggestions` (artStyle, colorPalette) removed from concept UI — those belong in Style phase, not here. Still in tool schema for backward compat but Claude told "do NOT include art style or color palette."
- "I have a vision" toggle available both on first gen AND on regenerate screen.
- Unlock is instant (no loading spinner). Re-locking the current concept skips "Generating concepts..." overlay.

**Gaps (remaining):**
- [ ] "Devotional cinema" still hardcoded in Path A — future: move to preset config

**Status: DONE** — both generation paths + post-lock edit/refine + visualSuggestions removed from concept.

---

## Step 3: Script Generation

**Source:** [`server/services/claude.ts` → `planScenes`](../server/services/claude.ts) by default; optional [`server/services/openai-script.ts` → `planScenesOpenAI`](../server/services/openai-script.ts) via `scriptProvider: "openai"` / `SCRIPT_WRITER_PROVIDER=openai` · Route: `server/routes/generate-script.ts` → `POST /:id/generate-script`

| | |
|---|---|
| **Model** | Claude Opus by default. GPT-5.5 is available as an opt-in script-writer experiment for more practical, less literary plans. |
| **Input** | locked_concept + lyrics + meaning + musicalStructure + videoMode + pacing + minShotDuration + `userNote` |
| **Output** | `cast[]` + `environments[]` + `scenes[shots[]]` |
| **Artist control** | Direct edit (scene narratives + shot directions inline, saves on blur with "Saved" flash). LLM refine. Full regenerate. Prompt viewable via toggle. |
| **Prompt visible** | Yes (saved to `last_script_prompt`, toggle in UI) |
| **generation_prompt** | No — complex system prompt, not artist-editable. But outputs (narratives, directions) are directly editable. |

**Pacing enforcement (extended thinking + validation loop):**
Both `planScenes` and `refineScript` use extended thinking (8K budget) so Claude reasons through pacing math before writing. Shot count formula: `ceil(scene_duration / pacing)` — e.g. 21s at 8s → 3 shots (8+8+5), not 2 (8+13). Validation enforces EXACT count (not just max). If wrong, errors are sent back as `tool_result` in the same conversation — Claude self-corrects. Max 3 attempts, hard fail. Last shot gets the remainder. Both first-gen and refine paths use identical ceil+remainder logic for DB insertion.

**Model-aware duration**: Prompt includes `minShotDuration` (from `getModelMinDuration()`) as informational context — Claude doesn't distort shot count because of it. At video generation time, Segmind picks the smallest model duration >= shot duration. Render timeline handles trimming.

**Shot `direction` field:**
Each shot's creative intent (e.g. "Priya breaks down at her desk, surrenders her pride") is preserved in a dedicated `direction` column. Script gen writes it alongside `visual_prompt` (which starts as a copy). When `writeShotPrompts` later overwrites `visual_prompt` with a start-frame description, the original intent survives in `direction`. Used by `writeShotPrompts` (as input), `refreshChainedShotPrompt` (as context), and shown in Studio as a read-only "Beat" line.

**Shot splitting (post-script):**
Artist can split any shot >4s in the script phase (↕ button). Creates a new shot with half the duration, empty prompt, same cast/env, same `direction`. Both halves marked stale. Duration is **read-only** — only changeable via pacing selection (regenerates script), split button, or model change. Endpoint: `POST /:id/shots/:shotId/split`.

**Director mode (Montage vs Cinematic):**
Claude receives explicit structural guidance based on the chosen mode:
- **Montage**: rhythmic, many discrete moments, broader coverage of the emotional and spiritual world
- **Cinematic**: fewer, more sustained moments, stronger continuity, deeper immersion
`planScenes` is told to decide **what happens**, not camera movement. Backend still sets `use_next_as_end_frame = 1` for cinematic continuity handling.

**Two generation modes:**

1. **Refine** (Claude Opus + extended thinking) — Claude sees the FULL current script + director's feedback. Surgical refinement with 5 preservation rules. Same validation loop.
2. **Regenerate** (Claude Opus + extended thinking) — fresh generation from concept + lyrics. Same validation loop.

**GPT-5.5 experiment:** `openai-script.ts` uses Responses API structured output with the same JSON shape and the same backend validation loop. It is intentionally opt-in only while we compare script taste against Opus. The prompt biases toward concrete, shootable devotional action and avoids pompous/non-renderable prose.

**Style image as ground truth:** Style DNA text removed from all Gemini image gen prompts. Gemini receives only the style reference image and is told to match it exactly.

**Gaps (remaining):**
- [ ] No manual scene/shot add/remove/reorder in script phase
- [ ] Cast/env assignments per shot could use dropdown selector

**Status: DONE** — pacing validated, extended thinking, validation loop.

---

## Step 4: Style

### 4a: Brainstorm

**Source:** [`server/services/claude.ts:397`](../server/services/claude.ts#L397) · Route: `server/routes/generate-style.ts` → `POST /:id/brainstorm-styles`

| | |
|---|---|
| **Model** | Claude Opus (claude.ts → `brainstormStyleDirections`) |
| **Input** | locked_concept + optional userNotes |
| **Output** | 4 style directions (title + description) |
| **Artist control** | userNotes, edit descriptions after generation |
| **Prompt visible** | No (not saved) |

**Hardcoded:** "Think film stills, not concept art", 4 directions forced.

### 4b: Visualize

**Source:** [`server/services/imagen.ts:149`](../server/services/imagen.ts#L149) (buildStylePrompt) · [`server/services/imagen.ts:153`](../server/services/imagen.ts#L153) (generateSingleStyleImage) · Route: `server/routes/generate-style.ts` → `POST /:id/visualize-style`

| | |
|---|---|
| **Model** | Gemini 3 Pro Image (imagen.ts → `generateSingleStyleImage`) |
| **Input** | style description + subject |
| **Output** | Style reference image |
| **Artist control** | `style_generation_prompt` — visible and editable |
| **generation_prompt** | Yes (saved to `style_generation_prompt` on project) |

**Hardcoded in template:** "Cinematic film still showcasing a specific visual style", "No text, no watermark", "Avoid: overly AI/CGI look"

**Changes made:**
- Compiled generation prompt visible via "View generation prompt" collapsible in each style slot
- Refining a style direction now clears `style_generation_prompt` so next visualize rebuilds from the refined description
- Legacy `/storage/` URLs in `styleExploration` auto-converted to Supabase URLs on read

**Status:** Fixed. Prompt visible, refine clears stale prompts, legacy URLs handled.

### 4b.5: Curated Style Presets (direct-lock — no AI step)

**Source:** [`server/style-presets.ts`](../server/style-presets.ts) · Route: `server/routes/generate-style.ts` → `GET /:id/style-presets`, `POST /:id/lock-style-preset`

| | |
|---|---|
| **Model** | None — zero AI calls. |
| **Input** | `{ presetKey }` |
| **Output** | A new project-scoped `lahari_assets` row pointing at the preset's shared curated `previewImagePath`; `style_asset_id` set; `style_description: ''` (empty on purpose). Downstream marked stale. |
| **Artist control** | Click any of the four preset cards in the Style phase → one-shot lock. No visualize / regenerate step. |
| **generation_prompt** | None — the curated PNG is the ground truth. |

Mirage v1 does not expose legacy Lahari curated styles. If curated styles return, they must be workflow/preset-specific clean assets registered in `server/style-presets.ts`.

**Important:** the old `POST /:id/visualize-style-preset` endpoint was **removed**. That path was generating a fresh image from the description text and ignoring the curated PNG entirely — it produced drift, not the curated look. The new `lock-style-preset` route points the project's style asset directly at the curated file_path (same shared-asset pattern as forks), runs the standard `/lock-style` downstream-stale logic, and skips any text-to-image work.

`style_description` is intentionally left empty for preset locks (the curated image is ground truth; storing description prose would leak into the concept-regen hint path).

**Status:** DONE — preset locking is one click, no AI cost, no drift.

### 4c: Refine

**Source:** [`server/services/claude.ts:479`](../server/services/claude.ts#L479) · Route: `server/routes/generate-style.ts` → `POST /:id/refine-style-direction`

| | |
|---|---|
| **Model** | Claude Sonnet (claude.ts → `refineStyleDirection`) |
| **Input** | current description + feedback + concept context |
| **Output** | Rewritten title + description |
| **Artist control** | Full — feedback rewrites the description |

**Status:** Good.

### 4d: Lock (no enrich)

**Source:** Route: `server/routes/generate-style.ts` → `POST /:id/lock-style`

| | |
|---|---|
| **Model** | None — pure DB mutation. |
| **Input** | `{ assetId }` (from brainstorm slot, upload, or preset) |
| **Output** | `style_asset_id` set, downstream cast/env/shots marked `prompts_stale`. |
| **Artist control** | Pick a brainstorm slot, upload, or click a preset card. |

The old `enrichStyleDNA` Claude vision call was deleted on 2026-04-24 — it was producing prose that nothing downstream actually consumed (the image-gen prompts stopped reading `style_description` once the locked image became ground truth). `style_description` survives as an editable text field but plays no role in generation; it's there for artist notes only. Preset locks deliberately leave it empty.

**Status:** DONE. Style image is the sole visual ground truth.

---

## Step 5: Characters

**Source:** [`server/services/imagen.ts:177`](../server/services/imagen.ts#L177) (buildCharacterPrompt) · [`server/services/imagen.ts:196`](../server/services/imagen.ts#L196) (generateCharacterLooks) · Route: `server/routes/generate-looks.ts` → `POST /:id/generate-looks`

| | |
|---|---|
| **Model** | Gemini 3 Pro Image (imagen.ts → `generateCharacterLooks`), fallback Nano Banana 2 on 503 |
| **Input** | description + style image (no style DNA text) + optional user ref image |
| **Output** | 3 reusable neutral reference portraits → pick one → locked reference image |
| **Key design** | Portraits are REUSABLE — neutral pose, no props in hands, no actions, plain/blurred background. Focus on identity: face, costume, ornaments, crown. |
| **Artist control** | Unified toolkit: Ref chips (style image) → Prompt (editable) → Generate → Refine |
| **generation_prompt** | Yes (saved to `cast_members.generation_prompt`) |

**Unified toolkit (matches Studio pattern):**
- Ref chips showing style image with hover preview
- Description collapsed into expandable detail (from script, editable)
- Prompt textarea (editable, saves on blur)
- Explicit Generate/Regenerate button
- Refine section (plain text feedback → Claude rewrites prompt → artist reviews → then generates)
- Style image is ground truth — no style DNA text in Gemini prompts

**Status: DONE**

---

## Step 6: Environments

**Source:** [`server/services/imagen.ts:272`](../server/services/imagen.ts#L272) (buildEnvironmentPrompt) · [`server/services/imagen.ts:291`](../server/services/imagen.ts#L291) (generateEnvironmentLooks) · Route: `server/routes/generate-looks.ts` → `POST /:id/generate-environment-look`

| | |
|---|---|
| **Model** | Gemini 3 Pro Image (imagen.ts → `generateEnvironmentLooks`) |
| **Input** | description + style image (no style DNA text) + optional user ref image |
| **Output** | 3 look variants → pick one → locked reference image |
| **Artist control** | Same unified toolkit as characters |
| **generation_prompt** | Yes (saved to `environments.generation_prompt`) |

**Status: DONE** — full parity with characters, same unified toolkit.

---

## Step 7: Shot Prompts (Bulk Write)

**Source:** [`server/services/claude.ts` → `writeShotPrompts`](../server/services/claude.ts) · Route: `server/routes/generate-script.ts` → `POST /:id/write-shot-prompts`

| | |
|---|---|
| **Model** | Claude Opus (claude.ts → `writeShotPrompts`) |
| **Input** | All shots with direction + duration + cast + scene narrative + scene lyrics + songType/isNarrative/isMeditative + optional `userNote` + previousBatchTail |
| **Output** | `visual_prompt` + `motion_prompt` + `continuityFrom` per shot |
| **Artist control** | `userNote` on bulk gen. Individual shot prompts editable after. Individual refine with feedback. |
| **Prompt visible** | Saved to `last_write_shots_prompt` |

**Status: DONE** — clears `prompts_stale` on each shot after writing. The OUTPUTS (individual visual/motion prompts) are the artist's workspace.

**Current prompt contract:**
Claude writes:
- `visual_prompt` = start-frame description for the image model
- `motion_prompt` = action + camera instruction for the video model
- `continuity_from` = `cut` vs `prev_shot`

The prompt now stays intentionally lean:
- no style DNA
- no full lyrics dump
- no heavy concept block beyond mood + song-type signal
- meditative guidance only when `isMeditative = true`
- "cinematic but renderable" calibration: prompts must be visual/animateable, not literary, but also not schematic
- good/bad examples teach the boundary between renderable cinema and vague prose or diagram-like blocking
- functional lighting is allowed when it defines the frame; style/palette language is still left to the reference image
- micro-rule avoids phrases like "seems to", "as if", or invisible causes such as grace, breath, presence, warmth, or devotion
- explicit sequence checks avoid invented geography, repeated camera verbs, schematic composition shortcuts, mystical VFX, all-cuts defaulting, and static restatement of the same beat

**Gaps:**
- [x] Shot writer is model-aware for Seedance — `writeShotPrompts` receives `video_model` and adds production-board/timing guidance when the selected model is Seedance. See [`docs/seedance-storyboard-workflow.md`](seedance-storyboard-workflow.md).
- [ ] Bulk regen overwrites ALL manual edits to individual shots — no selective regen
- [ ] Could add "rewrite prompts for selected shots only"
- [x] UI: simplified to 3 tabs (First frame / Last frame / Video) + Full chain diagnostic. Motion prompt merged into Video tab.

---

## Step 7.5: Seedance Storyboards (per shot)

**Source:** [`server/services/storyboard.ts`](../server/services/storyboard.ts) · Prompt templates: [`server/services/seedance-storyboard-rd.ts`](../server/services/seedance-storyboard-rd.ts) · Route: `server/routes/generate-shots.ts`

| | |
|---|---|
| **Planner model** | Routes through `project.text_provider` refine tier — Claude Sonnet 4.6 (default) or GPT-5.5. Was hardcoded to OpenAI Responses + `gpt-5.5` before the text-provider picker shipped (2026-05-12). |
| **Renderer model** | Project `storyboard_provider`: `nano-banana-2`, `nano-banana-pro`, or `gpt-image-2`; all route through Segmind BYOK in Mirage. |
| **Input** | Exact shot direction + duration + scene context + musical cue + locked style/cast/environment refs. **Per-shot continuity (opt-in):** when `shot.use_prev_storyboard_ref` is true the prev shot's locked storyboard is attached as vision input to the planner AND as `@imageN` to the renderer. Separate `shot.include_prev_cut_plan` checkbox (nullable; smart-default checked when `continuity_from === 'prev_shot'`) prepends prev shot's cut plan as text context to the planner. |
| **Saved outputs before image** | `shot.storyboard_prompt` (image-render prompt with per-panel actions baked INLINE — the image model knows what to draw per panel from this field alone) + `shot.storyboard_cut_plan` (text motion/cut guide for Seedance) + `storyboard_prompt_status` |
| **Rendered output** | Ordered storyboard image/version in `lahari_storyboard_versions`, with provider/model metadata |
| **Artist control** | Write/Rewrite prompt, edit prompt/cut plan directly, refine in Redo or Edit mode, generate/regenerate image, lock/unlock, history. Per-shot `+ Prev storyboard` toggle + "Include previous cut plan as text context" checkbox. |
| **generation_prompt** | Two fields: `storyboard_prompt` is the image-render prompt; `storyboard_cut_plan` is the text motion/cut guide used later by Seedance |

**Prompt size discipline (trimmed 2026-05-12):** the planner instruction caps `storyboardPrompt` at ~300 words and forbids "storyboard contract" bullet lists, animation rules, and style/quality boilerplate that the artist called "absolute dog shit" before. Source brief went from ~4300 chars to ~750. Critical fix: per-panel actions now live INSIDE `storyboardPrompt` (not just in `cutPlanText`) so the image renderer doesn't have to infer what each panel shows. The downstream Seedance video prompt was trimmed from ~80 lines to ~10 in the same pass — the long "animation contract" was confusing Seedance more than helping.

**Storyboard contract:** one board per Lahari shot, not one scene board. The board may contain internal cuts and camera angles, but it remains one cohesive 4-15s Seedance clip. Panels are ordered left-to-right, then top-to-bottom; visible panel numbers, captions, labels, and other readable text are not allowed because video models can render them into the final clip.

**Two-step flow:**
1. `POST /write-storyboard-prompt` converts the canonical source brief into a saved image prompt + cut plan. This is text-only and cheap relative to image rendering.
2. `POST /generate-storyboard` renders exactly the saved prompt with the selected storyboard provider. It does not re-plan.

**Refine modes:**
- `replan` rewrites `storyboard_prompt` + `storyboard_cut_plan` only. Artist renders again explicitly.
- `edit_image` uses the current storyboard image plus refs and the artist note to render a new storyboard version. Optional attached reference images are accepted for both refine modes.

**API endpoints:** `write-storyboard-prompt`, `generate-storyboard`, `refine-storyboard`, `lock-storyboard`, `unlock-storyboard`, `storyboard-plan`, `storyboard-history`.

**UI:** In Seedance storyboard mode, `ShotCard` swaps the keyframe `PromptToolkit` for `StoryboardPanel`. The panel has Storyboard and Video sub-tabs: Storyboard handles ordered cut-plan editing, generate/refine/lock, and history; Video previews `@image1 = locked storyboard` plus bound refs and fires Seedance only after the storyboard is locked.

**Status: DONE / ARTIST TESTING** — backend, UI, history, editable prompt + cut plan, lock/save race guard, no-empty-plan guard, provider swap, and Seedance prompt integration are wired.

---

## Step 8: Frame Generation (per shot)

**Source:** [`server/services/imagen.ts` → `generateShotStartFrame`](../server/services/imagen.ts) · Route: `server/routes/generate-shots.ts` → `POST /:id/shots/:shotId/generate-image`

Refine: [`server/services/claude.ts`](../server/services/claude.ts) (`refineFramePrompt`) · Route: `server/routes/generate-shots.ts` → `POST /:id/shots/:shotId/refine-prompt`

| | |
|---|---|
| **Model** | Gemini 3 Pro Image (imagen.ts → `generateShotStartFrame`) |
| **Input** | visual_prompt + character refs + style image + env ref + continuity frame + feedback |
| **Output** | Start frame image |
| **Artist control** | Full — edit visual_prompt in "First frame" tab, @mention cast/env/style, refine with plain text feedback |
| **generation_prompt** | `visual_prompt` IS the prompt (plus refs chain) |

**Refine context:** Claude Sonnet sees failed/generated image + director's feedback + current prompt + optional reference image. No extra style/scene/character dump — Claude applies the edit directly to the prompt text. Output: rewritten `visualPrompt` (1-3 sentences). Uses `refineFramePrompt`.

**Hardcoded in template:** "Preserve character identity from character references", "Render in the style of the style reference image", "Single cinematic frame. No text, no watermark."

**Status: DONE** — clears `prompts_stale` on generate + refine. Prompt visible in "First frame" tab + "Full chain" tab.

---

## Step 9: End Frame (per shot)

**Source:** [`server/services/imagen.ts` → `generateShotEndFrame`](../server/services/imagen.ts) · Route: `server/routes/generate-shots.ts` → `POST /:id/shots/:shotId/generate-end-frame`

Refine: Route: `server/routes/generate-shots.ts` → `POST /:id/shots/:shotId/refine-end-frame-prompt`

| | |
|---|---|
| **Model** | Gemini 3 Pro Image (imagen.ts → `generateShotEndFrame`) |
| **Input** | start frame + end_visual_prompt + motion_prompt + style image + optional refs + feedback |
| **Output** | End frame image (target for video gen) |
| **Artist control** | `end_visual_prompt` — visible/editable in "Last frame" tab, AI refine with feedback |
| **generation_prompt** | `end_visual_prompt` on the shot |

**Refine context:** Same refine helper as start frame. Claude sees the end frame image (if it exists) + director feedback + current prompt + optional reference image. Works without an existing end image (prompt-only refine).

**Reverse chain:** "Use as prev shot's end" copies start frame image AND `visual_prompt` → prev shot's `end_image_asset_id` + `end_visual_prompt`.

**Last frame tab:** Shows `endVisualPrompt` (editable), or "Extracted from video — no prompt" for ffmpeg frames. Generate end frame button. AI refine section. Artist can create an end frame from scratch.

**Status: DONE.**

---

## Step 9.5: Storyboard Generation (per shot)

**Source:** [`server/services/storyboard.ts`](../server/services/storyboard.ts) · Routes: `server/routes/generate-shots.ts` storyboard prompt/write/render/refine endpoints · Agent actions: `apply_storyboard_prompts`, `generate_storyboard`, `refine_storyboard_image`, `import_storyboard_image`, `lock_storyboard`

Storyboard generation has two distinct prompt surfaces:

| Surface | Model | Owns | Output |
|---|---|---|---|
| **Planner prompt** | project text provider via `generateText` | Writes/repairs saved `storyboard_prompt` + `storyboard_cut_plan` | Text only |
| **Renderer prompt** | storyboard image provider (`gpt-image-2`, Nano Banana, etc.) | Turns saved board prompt + refs into an image asset/version | Storyboard image |

### Planner Prompt Audit

The planner prompt is built by [`buildStoryboardPlannerPrompt`](../server/prompts/storyboard.ts) after `loadStoryboardContext` gathers project/scene/shot context.

| Slot | Current owner | Source | Edit path |
|---|---|---|---|
| `core_task` | engine | `WRITE_CORE_TASK` / `REFINE_CORE_TASK` in `server/prompts/storyboard.ts` | code only |
| `source_brief` | engine + shot graph | `buildStoryboardPrompt(ctx.input, variant)` from `seedance-storyboard-rd.ts` using title, concept, scene label/timestamps/lyrics, shot direction, duration, cast names, environment name, preset storyboard rule | edit concept/script/shot text, workflow recipe, or code |
| `current_board` | shot state | existing `shots.storyboard_prompt` when refining | `apply_storyboard_prompts` |
| `current_cut_plan` | shot state | existing `shots.storyboard_cut_plan` when refining | `apply_storyboard_prompts` |
| `previous_continuity` | shot state + previous shot | previous cut-plan tail when `include_prev_cut_plan` resolves true; previous storyboard image when `use_prev_storyboard_ref` is true | shot workflow/continuity settings |
| `style_notes` | project config | selected `image` + `storyboard` style-note buckets | `apply_project_style_notes` |
| `project_override` | project config | `project_prompt_overrides.kind='storyboard'`, e.g. HF sketch-board recipe | `apply_project_workflow` / `apply_project_prompt_override` |
| `artist_note` | per call | refinement/generation note | action input |
| `output_contract` | engine | JSON schema + storyboard hard rules | code only |

Planner vision refs are intentionally narrow: artist attached ref, previous storyboard continuity ref, and locked style image. Cast/environment refs are **not** sent to the text planner; they bind downstream in the image renderer. This is a deliberate split: planner writes graph-name staging, renderer attaches identity/location images.

### Renderer Prompt Audit

The renderer prompt is built in `generateStoryboardVersionUnlocked`:

`renderPrompt = workflowRenderContract + refBindingContract + saved storyboard prompt`

For edit-image refine mode, the prompt becomes an edit instruction against the previous storyboard image instead of resending the full saved prompt/cut plan.

When the active project storyboard override is the `hf_music_video` recipe, the renderer adds the HF sketch-board contract at paid image-call time. That contract is canonical for both fresh board generation and edit-image refine: boards must be pure black-and-white ink/pencil planning sheets, refs are converted into sketch guidance, and color/final-render texture from existing refs or previous boards is explicitly stripped. Normal non-HF projects keep the default renderer behavior.

| Slot | Current owner | Source | Edit path |
|---|---|---|---|
| `workflow_render_contract` | workflow recipe + engine | active `project_prompt_overrides.kind='storyboard'`; currently `hf_music_video` enables the black-and-white sketch-board render contract | `apply_project_workflow` / `apply_project_prompt_override` |
| `ref_binding_contract` | engine | `buildStoryboardRefBindingContract(refMeta)` from attached refs | ref locks / `contextOverrides` / shot excluded refs |
| `board_prompt` | shot state | `shots.storyboard_prompt` or edit instruction | `apply_storyboard_prompts` / `refine_storyboard_image` |
| `refs` | project/shot graph | locked style, active cast refs, environment ref, optional previous storyboard, optional artist ref | `lock_reference`, storyboard ref exclusions, `contextOverrides`, upload/import |
| `context_trace` | action input + shot exclusions | included/excluded/replaced ref keys | `contextOverrides` |
| `provider/model` | project prefs or per-call model override | `preferences.storyboardProvider` / `modelOverride.storyboardProvider` | `apply_project_preferences` / action input |

The renderer now persists a provenance-annotated composition object on
`storyboard_versions.metadata.promptComposition` and mirrors it through storyboard history. The
composition has `segments`, `images`, `params`, and exact `text` sent to the image model. This is
the storyboard-render equivalent of video prompt composition: every text segment carries a
source and edit path, so a bad board can be diagnosed without reconstructing the payload from
logs.

### Next Composer Slice

Storyboard generation should get the same auditability as storyboard video, but as a separate slice:

1. Add `composeStoryboardPlannerPrompt` for the planner surface with segments: `core_task`, `source_brief`, `current_board`, `current_cut_plan`, `continuity`, `style_notes`, `project_override`, `artist_note`, `output_contract`, `planner_refs`.
2. ✅ Extend the current `composeStoryboardRenderPrompt` into a provenance-returning composer for the image-render surface with segments: `workflow_render_contract`, `ref_binding_contract`, `board_prompt`, and `edit_instruction`, plus images and provider params.
3. ✅ Persist the render composition on storyboard version metadata; keep routine receipts lean.
4. ✅ Add Studio payload UI for storyboard render and fold read access into the general `describe_prompt({ kind })` action instead of adding sibling `describe_storyboard_prompt`.

Open questions for that slice: whether planner and renderer should share one `kind` with `phase: planner|render`, or separate kinds (`storyboard_planner`, `storyboard_render`); and whether `promptOverride` on storyboard render should bypass only `board_prompt` or the whole renderer composition.

---

## Step 10: Video Generation (per shot)

**Source:** [`server/services/segmind.ts:62`](../server/services/segmind.ts#L62) · Route: `server/routes/generate-video.ts` → `POST /:id/shots/:shotId/generate-video`

| | |
|---|---|
| **Model** | Veo 3.1 / Seedance 2.0 via Segmind (segmind.ts) |
| **Input** | Keyframe mode: start frame + motion prompt + ref images + end frame. Seedance storyboard mode: locked storyboard as `@image1` + exact style/cast/environment refs + saved cut plan text. |
| **Output** | Video clip |
| **Artist control** | "Video" tab: motion prompt/edit prompt in keyframe mode. In storyboard mode, the saved storyboard cut plan drives the prompt after storyboard lock. |
| **generation_prompt** | Keyframe mode: `motionPrompt` + ref labels. Storyboard mode: generated Seedance prompt from locked storyboard, refs, and saved cut plan text. |

**Refine context:** `refineMotionPrompt` — Claude sees start frame + end frame (if exists) + shot visual prompt (context) + director's feedback + current motion prompt + optional reference image. No style/scene/character context. Output: rewritten `motionPrompt` only.

**Seedance constraint:** `first_frame_url` and `reference_images` are mutually exclusive. Keyframe mode prioritizes frame control when a start frame exists. Storyboard mode intentionally sends no `first_frame_url`; it sends the locked storyboard and refs through `reference_images` so `@image1` is the storyboard source of truth.

**Storyboard text/no-number guard:** Seedance can copy visible storyboard marks into footage. Storyboard prompts now forbid visible panel numbers, labels, borders, captions, and readable text; panel order is left-to-right, then top-to-bottom. The video prompt also says any legacy numbers/labels/borders in `@image1` are sequencing guides only and must not appear in the final video.

**Storyboard video prompt composition:** the storyboard-mode video prompt is built by [`composeStoryboardVideoPrompt`](../server/services/videoPromptComposition.ts) as a list of provenance-annotated segments — one owner per slot, guardrails emitted once. The slots: `format` (board treatment + clip kind), `animation` (engine), `beat` (`shots.direction`), `refs` (locked version refs), `cut_plan` (`shots.storyboard_cut_plan`), `audio`, and a universal `guardrail`. The text sent to the model is the render of the *included* segments; the same segment list IS the audit object the director agent reads — each segment carries `source` (where it came from) and `editPath` (the exact action that changes it).

Board treatment lives in the **format slot**, not the guardrail. When a project video recipe/override is present it owns the format segment (e.g. `hf_music_video` declares the board a sketch plan and points the finish at the style ref); otherwise the engine emits a default "match the board's finish" line. The engine guardrail is universal and makes no board-finish claim, so it can never contradict the recipe. Recipes own format intent only — they no longer restate the universal guardrails.

Audit is pull, not push: the composition is **persisted** on the generation attempt's `requestSummary.promptComposition` (off the routine receipt so it never bloats agent context) and surfaced on demand — `run_action(generate_video, dryRun: true)` returns the composition that *would* be sent (no spend, no side effects), and `run_action(describe_prompt, { kind: "video" })` returns what *was* sent for the shot's last generation. `contextOverrides` (`includeShotBeat`, `includeCutPlan`, …) drive per-slot include/exclude; excluded slots stay in the audit marked not-included. HF music-video excludes the `beat` segment by default because the cut plan + refs own staging; pass `contextOverrides.includeShotBeat=true` only when the shot direction should be sent. Storyboard-mode video also honors ref controls such as `includeEnvironmentRefs`, `includeCastRefs`, `includeStyleImage`, and `includePreviousStoryboard`; the dry-run `composition.images` list is the proof of what will be attached before spend. Standalone callers (`buildSeedanceStoryboardVideoPrompt('board_plus_timing')`) delegate to the same composer. Guarded by `npm run check:video-prompt-composition`.

`describe_prompt({ kind })` is the canonical read-side inspector. It currently supports `kind: "video"` and `kind: "storyboard_render"`; `describe_video_prompt` remains a compatibility alias only. Do not add sibling actions such as `describe_storyboard_prompt` or `describe_look_prompt`; add new composed surfaces as new `kind` values after their payloads are persisted in the same composition shape.

**Error transparency:** `last_error` column on shots — saved on failure (truncated 500 chars), cleared on success. Shown in shot card error banner.

**Version history:** `GET history` returns all versions for first frame, last frame, and video. Revert endpoints swap active pointers. Assets track `shot_id` + `category`.

**Status: DONE.** Keyframe mode uses the unified toolkit. Storyboard mode uses the locked storyboard + cut plan as the video prompt source.

---

## Step 11: Last Frame Extraction

**Source:** [`server/services/ffmpeg.ts:16`](../server/services/ffmpeg.ts#L16)

| | |
|---|---|
| **Tool** | ffmpeg (ffmpeg.ts → `extractLastFrame`) |
| **Input** | Generated video |
| **Output** | PNG of the last frame → continuity ref for next shot |
| **Artist control** | None needed — mechanical extraction |

**Status:** Fine.

---

## Step 12: Chained Shot Prompt Refresh

**Source:** [`server/services/claude.ts` → `refreshChainedShotPrompt`](../server/services/claude.ts) · Triggered automatically after video gen in `server/routes/generate-video.ts`

| | |
|---|---|
| **Model** | Claude Sonnet vision (claude.ts → `refreshChainedShotPrompt`) |
| **Input** | Extracted last frame + next shot's `direction` (intent) + current visual/motion prompts + character names + environment name |
| **Output** | Rewritten visual_prompt + motion_prompt for next shot |
| **Artist control** | Marks `refined_from_prev_frame`. Artist can override. |

**Status: DONE** — clears `prompts_stale` on the refreshed shot. Automatic but non-destructive — artist sees the `refined_from_prev_frame` flag and can undo. Uses `direction` field to honor the shot's creative intent while adjusting for visual continuity. No style/mood/scene narrative — just frame + drafts + intent + names.

**Seedance exception:** chained-shot prompt refresh is skipped when video generation uses a locked storyboard. Seedance storyboard mode does not wait on `prev_shot`; continuity is handled inside the ordered storyboard/cut plan instead of through the old extracted-frame chain.

---

## Step 13: Final Render

**Source:** [`server/routes/render.ts`](../server/routes/render.ts), [`server/routes/render-callback.ts`](../server/routes/render-callback.ts), [`server/render-watchdog.ts`](../server/render-watchdog.ts), [`remotion-renderer/src/render-job.ts`](../remotion-renderer/src/render-job.ts), [`remotion-renderer/src/render.ts`](../remotion-renderer/src/render.ts) · UI: [`components/StepRender.tsx`](../components/StepRender.tsx)

| | |
|---|---|
| **Renderer** | Sibling `remotion-renderer` Modal service running Remotion SSR + Chromium |
| **Input** | Render-authoritative timeline snapshot: `trackItemIds`, `trackItemsMap`, `transitionsMap`, `fps`, `size`, `durationMs` |
| **Output** | Final mp4 uploaded to Supabase Storage, registered as `final_render`, and published back to the queue row |
| **Artist control** | Timeline editor arrangement, trims, transitions, effects, then Render |

Render is async because Railway cannot hold long HTTP requests. `/render` inserts a `lahari_renders` row, returns `202`, and fire-and-forgets to the renderer. The renderer sends progress/heartbeat pings during bundling, frame rendering, upload, and finalization, then uploads the mp4 and calls `/api/renders/callback/:renderId`; the frontend polls `/render-status` every 4s.

**Phase 1 safety rails now in code:**
- Duplicate active renders for the same project are rejected with `409`.
- If Modal rejects the initial render request with non-2xx, the render row is immediately marked failed.
- A watchdog marks stale `rendering` rows older than `MAX_RENDER_MINUTES` (default 65) failed.
- Renderer refuses to upload empty outputs (`<1024` bytes or zero frames).
- Callback `404` is non-retriable.
- Render delete bucket default matches current production renderer bucket: `videos`.

**Phase 2 visibility now in code:**
- `lahari_renders` carries `progress`, `stage`, `last_heartbeat_at`, `modal_function_call_id`, and `error_code`.
- `/render-status` exposes those fields to the Render UI progress bar.
- `/api/admin/active-renders` shows active rows before deploys, including stage/progress/Modal call id.

**Phase 3 resilience now in code:**
- Renderer callback retry budget is ~5 minutes with jitter.
- If callback delivery exhausts, the renderer writes a `pending_finalize` terminal fallback row; the backend reconciler runs the normal `finalizePublish` path and marks the render completed.
- Renderer prechecks that the project still exists and applies a 50 minute default hard cap before Modal's 60 minute timeout.

**Phase 4 efficiency now in code:**
- Renderer pre-stages every remote video/image/audio URL from `trackItemsMap[*].details.src` into `/tmp/lahari-render-<renderId>-*`, serves those staged files over a loopback HTTP server for Remotion, and cleans the temp files in `finally`.
- Docker pre-bundles the Remotion composition so cold containers can skip the runtime bundler pass when the baked bundle is present.
- **FFmpeg fast path** (`RENDER_ENGINE=ffmpeg`, default): the renderer calls `canRenderWithFfmpeg(inputProps)` on each job. Eligible timelines (no transitions, no visual effects, no playback-rate changes, no overlapping clips, only video/image/audio items, all srcs resolvable) take the FFmpeg concat path → `libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart` + amix for audio. Order-of-magnitude faster than Remotion SSR for plain timelines. Ineligible timelines fall back to Remotion automatically; `track('render_engine_fallback', ...)` fires so we can measure how often the fast path covers real workloads. See `remotion-renderer/src/ffmpeg-render.ts`.

**Phase nav never locks** (sidebar rail) — Blueprint/Studio/Render are all accessible the moment a project is loaded, never gated on `project.status` or generated content. Each phase owns its own empty state instead: Studio shows a "write a script first" notice when no shot plan exists, and Render's button gates on the timeline containing at least one visual clip (uploaded clips count, so upload-only renders work before any shot video exists).

**Media Library drawer** (`components/MediaLibraryDrawer.tsx`) — bottom-anchored drawer over the timeline canvas. Two layers: uploaded clips row, then horizontal scene picker (S1 S2 ...) → shots in that scene as a horizontal row, each shot showing its active video (ring outline) + older versions as small chips. Click any generated version or uploaded clip → appended to the timeline at the end as a fresh clip (canonical shot data is not modified). Uploaded clips (`POST /api/projects/:id/media-library/uploads`, asset category `media_library_video`) are library takes only — never canonical shot state, never mark shots stale; hiding one is a soft metadata flag, not a delete. The drawer stays available even before shot videos exist so artists can upload external clips, and cards show new / in-timeline / added feedback. Three-tier thumbnail strategy for generated takes: server-extracted last-frame asset → shot's storyboard or start frame poster (instant paint via `<video poster=...>`) → `#t=0.1` URL-fragment seek with `preload="metadata"`.

**Still planned:** cancel-on-watchdog and timeline-hash dedup (E5). See [`docs/archive/render-pipeline-overhaul-2026-05-11.md`](archive/render-pipeline-overhaul-2026-05-11.md).

---

## Auxiliary: Shot Critique

**Source:** [`server/services/gemini.ts:136`](../server/services/gemini.ts#L136)

Auto-scores generated frames against the prompt + style + character refs. Not currently exposed in the pipeline but logged. Could power auto-refine in the future.

---

## Cross-cutting Issues

### Text provider routing (2026-05-22)

One project-level setting (`project.text_provider`) controls the artist-facing text path, including concept/style, script planning/refine, shot prompts, storyboard prompt writing, and audio-plan writing where applicable. v1 only exposes providers that can cover that full path.

| Key | Label | Primary model | Refine model |
|---|---|---|---|
| `claude-opus` (default) | Claude Opus 4.7 | `claude-opus-4-7` | `claude-sonnet-4-6` |
| `gpt-5.5` | GPT-5.5 | `gpt-5.5` | `gpt-5.5` |

Gemini text remains implemented in `server/services/text-provider.ts`, but is hidden from the Blueprint picker until script planning has a real Gemini retry/validation loop. Do not expose a provider that silently falls back for script work.

**Implementation:** `server/services/text-provider.ts` is the unified dispatcher for concept/style/refine/storyboard/audio text calls. Script planning has provider-specific entrypoints (`claude.ts`, `openai-script.ts`) because validation/retry mechanics differ by vendor. Refines use the cheap sibling via `useRefineModel: true` where supported.

### Hardcoded "devotional" framing
Present in: concept prompt ([claude.ts:66](../server/services/claude.ts#L66)), script prompt ([claude.ts:162](../server/services/claude.ts#L162)), style brainstorm ([claude.ts:397](../server/services/claude.ts#L397)), critique ([gemini.ts:161](../server/services/gemini.ts#L161)).
**Fix:** Extract into a preset JSON loaded per project. Devotional = one preset. Anime, ads, short films = other presets. Same pipeline, different prompts.

### "All or nothing" regeneration
- ~~Script~~ — **FIXED**: surgical refine via Claude Opus (keeps unchanged scenes, preserves cast/env refs)
- Concept — **FIXED**: direct edit + LLM refine on locked concept (no wipe)
- Bulk shot prompts (`generate-script.ts` → `POST /:id/write-shot-prompts`) — still overwrites all manual edits
**Remaining fix:** Add selective shot prompt regen ("rewrite prompts for selected shots only")

### Staleness detection
When an upstream field changes after downstream work exists, downstream entities get `prompts_stale = true`. The UI shows an amber "Outdated" indicator. The artist decides when to rewrite — no auto-overwrite.

| Upstream change | Downstream marked stale |
|---|---|
| `style_description` edited | All cast_members + environments + all shots |
| `locked_concept` edited/refined | All shots |
| `scenes.narrative_description` edited | All shots in that scene |
| `cast_members.description` edited | All shots referencing that cast member |
| `environments.description` edited | All shots referencing that environment |

Cleared when: generation_prompt is regenerated/refined, artist edits the generation_prompt directly, or the storyboard planner rewrites `storyboard_prompt` + `storyboard_cut_plan`.

**Known caveat:** `lahari_shots.prompts_stale` is currently shared by keyframe prompts and storyboard prompts. In storyboard mode, rewriting the storyboard prompt clears the shared flag because the planner has re-read cast/env refs. If the artist later switches back to keyframe mode, the old `visual_prompt` can look fresh even though it was not rewritten. Future schema should split this into `visual_prompt_stale` and `storyboard_prompt_stale`.

**Only fires when going back** — linear flow (concept → script → style → chars → envs → studio) never triggers staleness. This is specifically for the "go back and tweak upstream" workflow.

### Template framing in generation prompts
"Mid-shot portrait, eye-level, cinematic lighting" etc. are sensible defaults but not always right.
**Fix (current):** Make visible and editable via generation_prompt.
**Fix (future):** Claude suggests per-entity framing based on story context.

---

---

## Future: Assistant Director Agent

All the edit/refine endpoints, staleness detection, and prompt templates documented above become **tools** for a persistent chat agent. The artist chats naturally — "make scene 3 warmer, Arjun should look older" — and the agent:

1. Knows which fields to update (from this doc)
2. Calls the right endpoints (`refineScript`, `updateCastMember`, etc.)
3. Understands downstream impact (staleness graph)
4. Offers to regenerate affected outputs
5. Loads model best practices per target model

The pipeline anatomy IS the agent's knowledge base. Every field mapping, every dependency, every prompt template we've documented is what the agent needs to make precise edits instead of vague suggestions.

**Prerequisites (all done or in progress):**
- [x] Every field mapped with source links
- [x] Every dependency traced (staleness graph)
- [x] generation_prompt pattern on all entities
- [x] Direct edit + LLM refine on all entities
- [x] Surgical script refine (not all-or-nothing)
- [ ] Model best practices config (single source, flows everywhere)
- [ ] Persistent chat per project (chat_messages table exists)

---

## Data Layers — Where Things Live, How They're Modified

Foundational reference for "where is this data, who can change it, how." Sister doc to `mirage-composer-architecture.md` (graph-first vision) — this section is the factual mechanics that vision builds on.

### Four layers, four modification paths

```
LAYER 1: CODE TEMPLATES
  server/prompts/*.ts, action handler constants, skill files
  Modified via: code commits

LAYER 2: PROJECT-SCOPED CONFIG
  project_prompt_overrides table
  project_config.style_notes
  Modified via: apply_project_prompt_override / apply_project_style_notes

LAYER 3: PROJECT DATA (graph state)
  concept text, script JSON, style description, refs, scenes, shots, etc.
  Modified via: apply_concept, apply_script, apply_style_direction, ...

LAYER 4: PER-CALL INPUT
  user note, promptOverride, contextOverrides, modelOverride
  Modified via: run_action / start_job input fields (transient)
```

The composer's job is to assemble the right slice from layers 1-3 for one action, optionally modified by layer 4. Each layer has its own modification path; mixing them is what created the override-confusion the composer architecture doc addresses.

### Per-concept mapping — Concept

| Thing | Layer | Where stored | Modified via | Example |
|---|---|---|---|---|
| Core task template for generate-concept | 1 | `server/prompts/concept.ts` `GENERATE_CORE_TASK` | code commit | "Propose creative narrative directions..." |
| Concept project override | 2 | `project_prompt_overrides`, kind='concept' | `apply_project_prompt_override({kind:'concept'})` | (currently dead — declared but not consumed) |
| The actual locked concept | 3 | `projects.locked_concept` column | `apply_concept({concept})` | "A solarpunk love story set in Mumbai monsoon..." |
| Per-call user note | 4 | not stored | `run_action({input: {userNote: "..."}})` | "make it more grounded, less metaphysical" |

### Per-concept mapping — Style

| Thing | Layer | Where stored | Modified via | Example |
|---|---|---|---|---|
| Style brainstorm core task | 1 | `server/prompts/styleBrainstorm.ts` | code commit | "Generate 4 distinct style directions..." |
| Style image-gen invariants | 1 (after migration) | `generate_style_candidates` handler constants | code commit | "No text or watermarks. No collage." |
| Style project override | 2 | `project_prompt_overrides`, kind='style' (not declared today; would be added with composer C5) | `apply_project_prompt_override({kind:'style'})` | "for this project, prefer harsh high-contrast graphic looks" |
| Style description text | 3 | `projects.style_description` column | `apply_style_direction({description})` | "Vintage anime cels, soft watercolor textures, pastel palette" |
| Style reference asset | 3 | `assets` table, locked via `projects.style_asset_id` | `apply_style_direction({sourceAssetId})` OR upload+lock | (image URL) |
| Per-call style override | 4 | not stored | `run_action({input: {promptOverride: "..."}})` | "for this one generation, ignore the locked style and try noir" |

### Per-concept mapping — Shot prompts

| Thing | Layer | Where stored | Modified via | Example |
|---|---|---|---|---|
| Shot prompts core task + examples | 1 | `server/prompts/shotPrompts.ts` | code commit | "You are an art director / shot writer..." + GOOD/BAD examples |
| Shot prompts project override | 2 | `project_prompt_overrides`, kind='shot_prompts' | `apply_project_prompt_override({kind:'shot_prompts'})` | (currently dead — declared but not consumed) |
| Saved visualPrompt / motionPrompt per shot | 3 | `shots.visual_prompt`, `shots.motion_prompt` columns | `apply_shot_prompts({shots: [{shotId, visualPrompt, motionPrompt}]})` | "Medium side shot: Mina stops at the classroom doorway..." |
| Per-call shot generation override | 4 | not stored | `run_action({input: {promptOverride: "..."}})` | (one-shot experiment with different motion phrasing) |

### What the composer does given these layers (per action)

For a given action call (say `generate_storyboard` for `shotId X`):

1. **Code template (Layer 1):** composer pulls the slim core-task constant for storyboard generation.
2. **Project override (Layer 2):** composer reads `getProjectPromptOverride(projectId, 'storyboard')`. If present, injects as `PROJECT OVERRIDE` section.
3. **Project data (Layer 3):** composer reads `project.style_asset_id`, char ref URLs for cast in this shot, env ref URL, the storyboard prompt text saved on the shot, the cut plan, and selected project style-note buckets. Assembles as `PROJECT DATA` + `REFERENCES` + `STYLE NOTES`.
4. **Per-call input (Layer 4):** if Codex shipped `promptOverride`, composer is bypassed entirely. If Codex shipped `contextOverrides` (e.g. `includeStyleImage: false`), composer respects the include/exclude flags. If neither, default assembly.

The composer should never inject taste rules from preset config at runtime. Those should live in graph data (`project.style_description` and `project_config.style_notes`) or in action handler constants (image-gen worker invariants), never as a preset doctrine blob that's re-read on every call.

### Pattern 7 (from composer audit) — Half-wired overrides

The `apply_project_prompt_override` schema declares 8 override kinds but only 2 are actually consumed by any prompt builder:

| Override kind | Schema accepts | Stored in DB | Consumed by prompt builder? |
|---|---|---|---|
| `storyboard` | ✅ | ✅ | ✅ (`PROJECT OVERRIDE` section in composer) |
| `video` | ✅ | ✅ | ✅ (read in videoGeneration.ts) |
| `concept` | ✅ | ✅ | ❌ never consumed |
| `script` | ✅ | ✅ | ❌ never consumed |
| `shot_prompts` | ✅ | ✅ | ❌ never consumed |
| `character_looks` | ✅ | ✅ | ❌ never consumed |
| `environment_looks` | ✅ | ✅ | ❌ never consumed |
| `audio_plan` | ✅ | ✅ | ❌ never consumed |

Currently 6 of 8 declared override kinds are dead text in the database. Fix tracked in composer audit C5 + architecture doc.

---

*Last updated: 2026-05-12*
