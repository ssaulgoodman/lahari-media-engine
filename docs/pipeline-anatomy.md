# Pipeline Anatomy — Every Step, Every Prompt, Every Control Point

Living document. Updated as we refine each step. Go back to any step, trace the flow, find the gap, fix it.

**The pattern (universal across all steps):**
1. Artist sees the prompt that will be sent
2. Artist can edit it directly OR ask the LLM to refine it
3. Both update the same field — single source of truth
4. Generate sends exactly what's visible

---

## Step 1: Audio Analysis

| | |
|---|---|
| **Model** | Gemini 3 Pro (gemini.ts) |
| **Input** | Audio file (from upload or Supabase queue) |
| **Output** | `lyrics`, `meaning`, `musicalStructure` (sections with timestamps) |
| **Artist control** | Title, context, language at upload |
| **Prompt visible** | No — auto-analysis, no creative decision |
| **generation_prompt** | N/A |

**Status:** Fine as-is. This is extraction, not generation.

---

## Step 2: Concept Generation

| | |
|---|---|
| **Model** | Claude Opus (claude.ts → `generateConceptOptions`) |
| **Input** | title + language + lyrics + meaning + musicalStructure + optional `userNote` |
| **Output** | 3 concept options (title, deity, mood, theme, visualSuggestions) |
| **Artist control** | `userNote` appended as "DIRECTOR NOTE". Pick from 3 options. |
| **Prompt visible** | No (saved to `last_concept_prompt` but not exposed in UI) |
| **generation_prompt** | No |

**Hardcoded assumptions:**
- "visionary film director specializing in Indian mythological and devotional cinema"
- Forces exactly 3 options: traditional / modern / experimental
- Artist must pick one — can't write their own concept

**Gaps:**
- [ ] No "write your own concept" option — if artist has a vision, they can only hint via userNote
- [ ] Concept is frozen after locking — can't edit deity, mood, theme individually
- [ ] "Devotional cinema" hardcoded — blocks universal platform use

**Fix plan:**
- Add "Custom concept" — artist fills a form (deity/subject, mood, theme, direction) → saves directly to `locked_concept`
- Make locked concept fields individually editable (click to edit mood, theme, etc.)
- Move "devotional cinema" framing into a preset config (future)

---

## Step 3: Script Generation

| | |
|---|---|
| **Model** | Claude Sonnet (claude.ts → `planScenes`) |
| **Input** | locked_concept + lyrics + meaning + musicalStructure + videoMode + pacing + `userNote` |
| **Output** | `cast[]` + `environments[]` + `scenes[shots[]]` |
| **Artist control** | `userNote` as "DIRECTOR NOTE (must follow)". Prompt viewable via toggle. |
| **Prompt visible** | Yes (saved to `last_script_prompt`, toggle in UI) |
| **generation_prompt** | No — complex system prompt, not artist-editable |

**Hardcoded assumptions:**
- "music video director planning a {mode} for a devotional song"
- CAST rules: "deity and key mythological figures", "cultural context"
- ENVIRONMENT rules: "Only 2-3 key locations", "cultural reference"
- All shots fixed at `basePacing` seconds (from video model)

**Gaps:**
- [ ] ALL OR NOTHING — full regen wipes cast + environments + all scenes
- [ ] No scene-level refine — can't say "keep scenes 1-4, redo scene 5"
- [ ] No shot-level surgical add/remove/reorder in script phase
- [ ] Cast descriptions generated here feed into character image gen but that link isn't visible
- [ ] "Devotional song" hardcoded

**Fix plan:**
- Add "refine script" mode: Claude sees current script + feedback, edits only flagged parts
- Add manual scene/shot manipulation (add, delete, reorder, merge)
- Show the description → generation_prompt connection for characters explicitly
- Move "devotional song" into preset

---

## Step 4: Style

### 4a: Brainstorm

| | |
|---|---|
| **Model** | Claude Opus (claude.ts → `brainstormStyleDirections`) |
| **Input** | locked_concept + optional userNotes |
| **Output** | 4 style directions (title + description) |
| **Artist control** | userNotes, edit descriptions after generation |
| **Prompt visible** | No (not saved) |

**Hardcoded:** "Think film stills, not concept art", 4 directions forced.

### 4b: Visualize

| | |
|---|---|
| **Model** | Gemini 3 Pro Image (imagen.ts → `generateSingleStyleImage`) |
| **Input** | style description + subject |
| **Output** | Style reference image |
| **Artist control** | `style_generation_prompt` — visible and editable |
| **generation_prompt** | Yes (saved to `style_generation_prompt` on project) |

**Hardcoded in template:** "Cinematic film still showcasing a specific visual style", "No text, no watermark", "Avoid: overly AI/CGI look"

**Status:** Fixed. generation_prompt pattern applied.

### 4c: Refine

| | |
|---|---|
| **Model** | Claude Sonnet (claude.ts → `refineStyleDirection`) |
| **Input** | current description + feedback + concept context |
| **Output** | Rewritten title + description |
| **Artist control** | Full — feedback rewrites the description |

**Status:** Good.

### 4d: Lock + Enrich

| | |
|---|---|
| **Model** | Claude Sonnet vision (claude.ts → `enrichStyleDNA`) |
| **Input** | Locked style image + current style description |
| **Output** | Enriched `style_description` (the Style DNA used everywhere downstream) |
| **Artist control** | Can edit `style_description` after enrichment |

**Status:** Good. Style DNA is visible and editable.

---

## Step 5: Characters

| | |
|---|---|
| **Model** | Gemini 3 Pro Image (imagen.ts → `generateCharacterLooks`) |
| **Input** | description + style DNA + style image + optional user ref image |
| **Output** | 3 look variants → pick one → locked reference image |
| **Artist control** | `generation_prompt` — visible, editable, LLM refine rewrites it |
| **generation_prompt** | Yes (saved to `cast_members.generation_prompt`) |

**Default template includes:** "Mid-shot character portrait, upper body and face visible, detailed costume and ornaments. Eye-level framing, natural cinematic lighting."

**Status:** Fixed. Full generation_prompt pattern.

**Remaining gaps:**
- [ ] Template framing (mid-shot, eye-level, cinematic lighting) is generic — could be per-character
- [ ] Future: Claude suggests framing based on character role in story

---

## Step 6: Environments

| | |
|---|---|
| **Model** | Gemini 3 Pro Image (imagen.ts → `generateEnvironmentLooks`) |
| **Input** | description + style DNA + style image + optional user ref image |
| **Output** | 3 look variants → pick one → locked reference image |
| **Artist control** | `generation_prompt` — visible, editable, LLM refine rewrites it |
| **generation_prompt** | Yes (saved to `environments.generation_prompt`) |

**Default template includes:** "Wide establishing shot, full environment visible, empty scene."

**Status:** Fixed. Same pattern as characters.

---

## Step 7: Shot Prompts (Bulk Write)

| | |
|---|---|
| **Model** | Claude Sonnet (claude.ts → `writeShotPrompts`) |
| **Input** | All shots with direction + cast + scene context + style DNA + optional `userNote` |
| **Output** | `visual_prompt` + `motion_prompt` + `continuityFrom` per shot |
| **Artist control** | `userNote` on bulk gen. Individual shot prompts editable after. Individual refine with feedback. |
| **Prompt visible** | Saved to `last_write_shots_prompt` |

**Status:** Mostly fine. The OUTPUTS (individual visual/motion prompts) are the artist's workspace. Bulk regen is "start fresh with a nudge."

**Gaps:**
- [ ] Bulk regen overwrites ALL manual edits to individual shots — no selective regen
- [ ] Could add "rewrite prompts for selected shots only"

---

## Step 8: Frame Generation (per shot)

| | |
|---|---|
| **Model** | Gemini 3 Pro Image (imagen.ts → `generateShotStartFrame`) |
| **Input** | visual_prompt + character refs + style image + env ref + continuity frame + feedback |
| **Output** | Start frame image |
| **Artist control** | Full — edit visual_prompt, refine with feedback + ref image upload |
| **generation_prompt** | `visual_prompt` IS the prompt (plus refs chain) |

**Hardcoded in template:** "Preserve character identity from character references", "Render in the style of the style reference image", "Single cinematic frame. No text, no watermark."

**Status:** Good. Prompt visible in "Full chain" tab.

---

## Step 9: End Frame (per shot)

| | |
|---|---|
| **Model** | Gemini 3 Pro Image (imagen.ts → `generateShotEndFrame`) |
| **Input** | start frame + end_visual_prompt + motion_prompt + style + feedback |
| **Output** | End frame image (target for video gen) |
| **Artist control** | `end_visual_prompt` — visible, editable, LLM refine rewrites it |
| **generation_prompt** | `end_visual_prompt` on the shot |

**Status:** Fixed.

---

## Step 10: Video Generation (per shot)

| | |
|---|---|
| **Model** | Veo 3.1 / Seedance 2.0 via Segmind (segmind.ts) |
| **Input** | start frame + motion prompt + ref images + end frame |
| **Output** | Video clip |
| **Artist control** | Video prompt override tab (editable). Model selector. |
| **generation_prompt** | Auto-built from motion_prompt + scene context + ref notes. Overrideable. |

**Status:** Good. Override is visible in "Video prompt" tab.

---

## Step 11: Last Frame Extraction

| | |
|---|---|
| **Tool** | ffmpeg (ffmpeg.ts → `extractLastFrame`) |
| **Input** | Generated video |
| **Output** | PNG of the last frame → continuity ref for next shot |
| **Artist control** | None needed — mechanical extraction |

**Status:** Fine.

---

## Step 12: Chained Shot Prompt Refresh

| | |
|---|---|
| **Model** | Claude Sonnet vision (claude.ts → `refreshChainedShotPrompt`) |
| **Input** | Extracted last frame + next shot's current prompts |
| **Output** | Rewritten visual_prompt + motion_prompt for next shot |
| **Artist control** | Marks `refined_from_prev_frame`. Artist can override. |

**Status:** Fine. Automatic but non-destructive — artist sees the flag and can undo.

---

## Cross-cutting Issues

### Hardcoded "devotional" framing
Present in: concept prompt, script prompt, style brainstorm, character/env descriptions.
**Fix:** Extract into a preset JSON loaded per project. Devotional = one preset. Anime, ads, short films = other presets. Same pipeline, different prompts.

### "All or nothing" regeneration
Present in: concept (3 options), script (full wipe), bulk shot prompts (overwrites all).
**Fix:** Add surgical refine at each level — script scene-level, shot prompt selective regen.

### Template framing in generation prompts
"Mid-shot portrait, eye-level, cinematic lighting" etc. are sensible defaults but not always right.
**Fix (current):** Make visible and editable via generation_prompt.
**Fix (future):** Claude suggests per-entity framing based on story context.

---

*Last updated: 2026-04-17*
