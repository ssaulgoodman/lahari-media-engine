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
1. SRT file from Supabase (`srt_verified_san` > `srt_verified_*` > `srt_turbo_scribe`)
2. Fallback: audio transcription via Gemini

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
| **Prompt** | `"Identify the musical sections. Max 10. For each: label, startTime, endTime, energy, description."` |
| **Output** | `musicalStructure[]` — sections with timestamps + energy levels |
| **Artist control** | None before. Structure visible after but not editable. |
| **Prompt visible** | No |

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
| **Input** | title + language + lyrics + meaning + musicalStructure + optional `userNote` |
| **Output** | 3 concept options (title, deity, mood, theme). `visualSuggestions` removed from UI — visual style decided in Style phase. |
| **Artist control** | `userNote` appended as "DIRECTOR NOTE". Pick from 3 options. |
| **Prompt visible** | No (saved to `last_concept_prompt` but not exposed in UI) |
| **generation_prompt** | No |

**Hardcoded assumptions:**
- "visionary film director specializing in Indian mythological and devotional cinema"
- Forces exactly 3 options: traditional / modern / experimental
- Artist must pick one — can't write their own concept

**Two paths to a concept:**

**Path A: Preset directions** (current)
- Artist clicks "Generate concepts" → Opus generates 3 directions (traditional/modern/experimental) → artist picks one
- Good when artist wants inspiration or doesn't have a strong vision yet
- Hardcoded "devotional cinema" framing in the prompt

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

**Source:** [`server/services/claude.ts:156`](../server/services/claude.ts#L156) · Route: [`server/routes/generate.ts:789`](../server/routes/generate.ts#L789) → `POST /:id/generate-script`

| | |
|---|---|
| **Model** | Claude Sonnet (claude.ts → `planScenes`) |
| **Input** | locked_concept + lyrics + meaning + musicalStructure + videoMode + pacing + `userNote` |
| **Output** | `cast[]` + `environments[]` + `scenes[shots[]]` |
| **Artist control** | Direct edit (scene narratives + shot directions inline, saves on blur with "Saved" flash). LLM refine. Full regenerate. Prompt viewable via toggle. |
| **Prompt visible** | Yes (saved to `last_script_prompt`, toggle in UI) |
| **generation_prompt** | No — complex system prompt, not artist-editable. But outputs (narratives, directions) are directly editable. |

**Pacing enforcement (extended thinking + validation loop):**
Both `planScenes` and `refineScript` use extended thinking (8K budget) so Claude reasons through pacing math before writing. Shot count formula: `ceil(scene_duration / pacing)` — e.g. 21s at 8s → 3 shots (8+8+5), not 2 (8+13). Validation enforces EXACT count (not just max). If wrong, errors are sent back as `tool_result` in the same conversation — Claude self-corrects. Max 3 attempts, hard fail. Last shot gets the remainder.

**Shot splitting + duration editing (post-script):**
Artist can split any shot >4s in the script phase (↕ button). Creates a new shot with half the duration, empty prompt, same cast/env. Both halves marked stale. Duration is also directly editable per shot. Endpoint: `POST /:id/shots/:shotId/split`.

**Director mode (Montage vs Cinematic):**
Claude receives explicit guidance based on the chosen mode:
- **Montage**: "dynamic cuts, varied angles, visual variety — each shot is a self-contained moment." Shot directions written as standalone compositions.
- **Cinematic**: "smooth visual continuity — camera movement continues, characters transition between actions." Shot directions written to flow into each other. Backend sets `use_next_as_end_frame = 1` for chained continuity.

**Two generation modes:**

1. **Refine** (Claude Opus + extended thinking) — Claude sees the FULL current script + director's feedback. Surgical refinement with 5 preservation rules. Same validation loop.
2. **Regenerate** (Claude Sonnet + extended thinking) — fresh generation from concept + lyrics. Same validation loop.

**Style image as ground truth:** Style DNA text removed from all Gemini image gen prompts. Gemini receives only the style reference image and is told to match it exactly.

**Gaps (remaining):**
- [ ] No manual scene/shot add/remove/reorder in script phase
- [ ] Cast/env assignments per shot could use dropdown selector

**Status: DONE** — pacing validated, extended thinking, validation loop.

---

## Step 4: Style

### 4a: Brainstorm

**Source:** [`server/services/claude.ts:397`](../server/services/claude.ts#L397) · Route: [`server/routes/generate.ts:79`](../server/routes/generate.ts#L79) → `POST /:id/brainstorm-styles`

| | |
|---|---|
| **Model** | Claude Opus (claude.ts → `brainstormStyleDirections`) |
| **Input** | locked_concept + optional userNotes |
| **Output** | 4 style directions (title + description) |
| **Artist control** | userNotes, edit descriptions after generation |
| **Prompt visible** | No (not saved) |

**Hardcoded:** "Think film stills, not concept art", 4 directions forced.

### 4b: Visualize

**Source:** [`server/services/imagen.ts:149`](../server/services/imagen.ts#L149) (buildStylePrompt) · [`server/services/imagen.ts:153`](../server/services/imagen.ts#L153) (generateSingleStyleImage) · Route: [`server/routes/generate.ts:134`](../server/routes/generate.ts#L134) → `POST /:id/visualize-style`

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

**Source:** [`server/services/claude.ts:479`](../server/services/claude.ts#L479) · Route: [`server/routes/generate.ts:191`](../server/routes/generate.ts#L191) → `POST /:id/refine-style-direction`

| | |
|---|---|
| **Model** | Claude Sonnet (claude.ts → `refineStyleDirection`) |
| **Input** | current description + feedback + concept context |
| **Output** | Rewritten title + description |
| **Artist control** | Full — feedback rewrites the description |

**Status:** Good.

### 4d: Lock + Enrich

**Source:** [`server/services/claude.ts:528`](../server/services/claude.ts#L528) · Route: [`server/routes/generate.ts:223`](../server/routes/generate.ts#L223) → `POST /:id/lock-style`

| | |
|---|---|
| **Model** | Claude Sonnet vision (claude.ts → `enrichStyleDNA`) |
| **Input** | Locked style image + current style description |
| **Output** | Enriched `style_description` (the Style DNA used everywhere downstream) |
| **Artist control** | Can edit `style_description` after enrichment |

**Status:** Good. Style DNA is visible and editable.

---

## Step 5: Characters

**Source:** [`server/services/imagen.ts:177`](../server/services/imagen.ts#L177) (buildCharacterPrompt) · [`server/services/imagen.ts:196`](../server/services/imagen.ts#L196) (generateCharacterLooks) · Route: [`server/routes/generate.ts:421`](../server/routes/generate.ts#L421) → `POST /:id/generate-looks`

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

**Source:** [`server/services/imagen.ts:272`](../server/services/imagen.ts#L272) (buildEnvironmentPrompt) · [`server/services/imagen.ts:291`](../server/services/imagen.ts#L291) (generateEnvironmentLooks) · Route: [`server/routes/generate.ts:629`](../server/routes/generate.ts#L629) → `POST /:id/generate-environment-look`

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

**Source:** [`server/services/claude.ts:301`](../server/services/claude.ts#L301) · Route: [`server/routes/generate.ts:943`](../server/routes/generate.ts#L943) → `POST /:id/write-shot-prompts`

| | |
|---|---|
| **Model** | Claude Sonnet (claude.ts → `writeShotPrompts`) |
| **Input** | All shots with direction + cast + scene context + style DNA + optional `userNote` |
| **Output** | `visual_prompt` + `motion_prompt` + `continuityFrom` per shot |
| **Artist control** | `userNote` on bulk gen. Individual shot prompts editable after. Individual refine with feedback. |
| **Prompt visible** | Saved to `last_write_shots_prompt` |

**Status: DONE** — clears `prompts_stale` on each shot after writing. The OUTPUTS (individual visual/motion prompts) are the artist's workspace.

**Critical insight — model-aware prompting:**
The shot writer writes `visual_prompt` and `motion_prompt` with generic instructions ("1-2 sentences, what we see"). These go directly to Gemini/Veo with NO second LLM call to optimize them. The quality of every frame and video depends on how well Claude writes for these specific models.

**Fix plan — model best practices injection:**
- Define best practices per model in a single config — Gemini image gen techniques, Veo/Seedance motion prompt patterns
- Inject into ALL prompt builders: `buildCharacterPrompt`, `buildEnvironmentPrompt`, `buildStylePrompt`, `generateShotStartFrame`, `generateShotEndFrame`, `writeShotPrompts` (shot writer), video prompt builder
- Currently each has hardcoded boilerplate ("cinematic lighting", "no watermark", "avoid AI look") — extract into the shared config
- One place to edit → flows everywhere. Team refines as they learn what works per model.
- Future: auto-learn from prompt→output quality data (the autoresearch loop)
- No extra LLM call needed — just better instructions to existing calls

**Gaps:**
- [ ] Shot writer is model-agnostic — needs model-specific best practices
- [ ] Bulk regen overwrites ALL manual edits to individual shots — no selective regen
- [ ] Could add "rewrite prompts for selected shots only"
- [x] UI: simplified to 3 tabs (First frame / Last frame / Video) + Full chain diagnostic. Motion prompt merged into Video tab.

---

## Step 8: Frame Generation (per shot)

**Source:** [`server/services/imagen.ts:364`](../server/services/imagen.ts#L364) · Route: [`server/routes/generate.ts:1132`](../server/routes/generate.ts#L1132) → `POST /:id/shots/:shotId/generate-image`

Refine: [`server/services/claude.ts:601`](../server/services/claude.ts#L601) (refineShotPrompt) · Route: [`server/routes/generate.ts:1049`](../server/routes/generate.ts#L1049) → `POST /:id/shots/:shotId/refine-prompt`

| | |
|---|---|
| **Model** | Gemini 3 Pro Image (imagen.ts → `generateShotStartFrame`) |
| **Input** | visual_prompt + character refs + style image + env ref + continuity frame + feedback |
| **Output** | Start frame image |
| **Artist control** | Full — edit visual_prompt in "First frame" tab, @mention cast/env/style, refine with plain text feedback |
| **generation_prompt** | `visual_prompt` IS the prompt (plus refs chain) |

**Refine context:** Claude Sonnet sees failed image + visual prompt + motion prompt + style DNA + scene narrative + environment description + cast descriptions. Output: 1-3 short sentences (visual), 1 sentence (motion, only if feedback mentions movement).

**Hardcoded in template:** "Preserve character identity from character references", "Render in the style of the style reference image", "Single cinematic frame. No text, no watermark."

**Status: DONE** — clears `prompts_stale` on generate + refine. Prompt visible in "First frame" tab + "Full chain" tab.

---

## Step 9: End Frame (per shot)

**Source:** [`server/services/imagen.ts:448`](../server/services/imagen.ts#L448) · Route: [`server/routes/generate.ts:1376`](../server/routes/generate.ts#L1376) → `POST /:id/shots/:shotId/generate-end-frame`

Refine: Route: [`server/routes/generate.ts:1445`](../server/routes/generate.ts#L1445) → `POST /:id/shots/:shotId/refine-end-frame-prompt`

| | |
|---|---|
| **Model** | Gemini 3 Pro Image (imagen.ts → `generateShotEndFrame`) |
| **Input** | start frame + end_visual_prompt + motion_prompt + style + feedback |
| **Output** | End frame image (target for video gen) |
| **Artist control** | `end_visual_prompt` — visible/editable in "Last frame" tab, AI refine with feedback |
| **generation_prompt** | `end_visual_prompt` on the shot |

**Refine context:** Same as start frame — Claude sees end frame image (if exists) + end visual prompt + scene + env + cast + style. Works without existing end image (prompt-only refine).

**Reverse chain:** "Use as prev shot's end" copies start frame image AND `visual_prompt` → prev shot's `end_image_asset_id` + `end_visual_prompt`.

**Last frame tab:** Shows `endVisualPrompt` (editable), or "Extracted from video — no prompt" for ffmpeg frames. Generate end frame button. AI refine section. Artist can create an end frame from scratch.

**Status: DONE.**

---

## Step 10: Video Generation (per shot)

**Source:** [`server/services/segmind.ts:62`](../server/services/segmind.ts#L62) · Route: [`server/routes/generate.ts:1594`](../server/routes/generate.ts#L1594) → `POST /:id/shots/:shotId/generate-video`

| | |
|---|---|
| **Model** | Veo 3.1 / Seedance 2.0 via Segmind (segmind.ts) |
| **Input** | start frame + motion prompt + ref images + end frame |
| **Output** | Video clip |
| **Artist control** | "Video" tab: motion prompt (editable) + compiled video prompt (editable, overrideable). AI refine rewrites motion prompt. |
| **generation_prompt** | Auto-built from motion_prompt + scene context + cast + mood. Overrideable in Video tab. |

**Refine context:** Claude sees start frame + end frame (if exists) + motion prompt + scene + env + cast + style. Focus on camera movement, pacing, action. Output: rewrites motion prompt only.

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

**Source:** [`server/services/claude.ts:712`](../server/services/claude.ts#L712) · Triggered automatically after video gen in [`server/routes/generate.ts`](../server/routes/generate.ts)

| | |
|---|---|
| **Model** | Claude Sonnet vision (claude.ts → `refreshChainedShotPrompt`) |
| **Input** | Extracted last frame + next shot's current prompts |
| **Output** | Rewritten visual_prompt + motion_prompt for next shot |
| **Artist control** | Marks `refined_from_prev_frame`. Artist can override. |

**Status: DONE** — clears `prompts_stale` on the refreshed shot. Automatic but non-destructive — artist sees the `refined_from_prev_frame` flag and can undo.

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
- Bulk shot prompts ([generate.ts](../server/routes/generate.ts) → `POST /:id/write-shot-prompts`) — still overwrites all manual edits
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

*Last updated: 2026-04-17*
