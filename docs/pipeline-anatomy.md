# Pipeline Anatomy — Every Step, Every Prompt, Every Control Point

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

**Source:** [`server/services/claude.ts` → `planScenes`](../server/services/claude.ts) · Route: `server/routes/generate-script.ts` → `POST /:id/generate-script`

| | |
|---|---|
| **Model** | Claude Opus (claude.ts → `planScenes`) |
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

### 4c: Refine

**Source:** [`server/services/claude.ts:479`](../server/services/claude.ts#L479) · Route: `server/routes/generate-style.ts` → `POST /:id/refine-style-direction`

| | |
|---|---|
| **Model** | Claude Sonnet (claude.ts → `refineStyleDirection`) |
| **Input** | current description + feedback + concept context |
| **Output** | Rewritten title + description |
| **Artist control** | Full — feedback rewrites the description |

**Status:** Good.

### 4d: Lock + Enrich

**Source:** [`server/services/claude.ts:528`](../server/services/claude.ts#L528) · Route: `server/routes/generate-style.ts` → `POST /:id/lock-style`

| | |
|---|---|
| **Model** | Claude Sonnet vision (claude.ts → `enrichStyleDNA`) |
| **Input** | Locked style image + current style description |
| **Output** | Enriched `style_description` — visible/editable style metadata and critique context. The locked style image, not this text, is the downstream visual ground truth. |
| **Artist control** | Can edit `style_description` after enrichment |

**Status:** Good. Style description is visible and editable, but no longer injected into image-generation prompts when the style image is available.

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
- [ ] Shot writer is model-agnostic — needs model-specific best practices
- [ ] Bulk regen overwrites ALL manual edits to individual shots — no selective regen
- [ ] Could add "rewrite prompts for selected shots only"
- [x] UI: simplified to 3 tabs (First frame / Last frame / Video) + Full chain diagnostic. Motion prompt merged into Video tab.

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

## Step 10: Video Generation (per shot)

**Source:** [`server/services/segmind.ts:62`](../server/services/segmind.ts#L62) · Route: `server/routes/generate-video.ts` → `POST /:id/shots/:shotId/generate-video`

| | |
|---|---|
| **Model** | Veo 3.1 / Seedance 2.0 via Segmind (segmind.ts) |
| **Input** | start frame + motion prompt + ref images + end frame |
| **Output** | Video clip |
| **Artist control** | "Video" tab: motion prompt (editable, overrideable). AI refine rewrites motion prompt. |
| **generation_prompt** | `motionPrompt` only + ref labels when ref images attached. No mood, scene narrative, or cast names — the start frame already shows all of that. Overrideable in Video tab. |

**Refine context:** `refineMotionPrompt` — Claude sees start frame + end frame (if exists) + shot visual prompt (context) + director's feedback + current motion prompt + optional reference image. No style/scene/character context. Output: rewritten `motionPrompt` only.

**Seedance constraint:** `first_frame_url` and `reference_images` are mutually exclusive. Frame mode prioritized when start frame exists. Veo accepts all inputs together.

**Error transparency:** `last_error` column on shots — saved on failure (truncated 500 chars), cleared on success. Shown in shot card error banner.

**Version history:** `GET history` returns all versions for first frame, last frame, and video. Revert endpoints swap active pointers. Assets track `shot_id` + `category`.

**Status: DONE.** All 3 tabs have unified toolkit: Refs → Prompt (@mention) → Generate → Refine.

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

---

## Auxiliary: Shot Critique

**Source:** [`server/services/gemini.ts:136`](../server/services/gemini.ts#L136)

Auto-scores generated frames against the prompt + style + character refs. Not currently exposed in the pipeline but logged. Could power auto-refine in the future.

---

## Cross-cutting Issues

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

Cleared when: generation_prompt is regenerated/refined, or artist edits the generation_prompt directly.

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

*Last updated: 2026-04-23*
