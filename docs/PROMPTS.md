# Prompt Bible — Lahari Media Engine

> Historical prompt notes. Some examples here still reflect older style-DNA-heavy payloads and pre-cleanup prompt contracts. For the current prompt source of truth, use [`server/prompts/catalog.ts`](../server/prompts/catalog.ts) and the living pipeline trace in [`docs/pipeline-anatomy.md`](./pipeline-anatomy.md).

Every AI prompt in the pipeline, in execution order. Edit here, then inject back into code.

---

## Stage 1: Audio Transcription
**Model**: Gemini 3 Pro (`gemini-3-pro-preview`)
**File**: `server/services/gemini.ts` → `transcribeLyrics`
**Inputs**: audio (base64), language
**Output**: timestamped lyrics string

```
Transcribe the lyrics of this audio. Language: {language}.

Format:
[M:SS] Line of lyrics

Rules:
- Original language ONLY — do not translate
- One line per phrase with timestamp
- Clean and simple
```

**Notes**: This is fine. Simple and functional.

---

## Stage 2: Musical Structure Detection
**Model**: Gemini 3 Pro (`gemini-3-pro-preview`)
**File**: `server/services/gemini.ts` → `detectStructure`
**Inputs**: audio (base64)
**Output**: JSON array of sections

```
Identify the musical sections of this audio (maximum 10 sections).

For each section provide:
- label: Intro, Verse, Chorus, Bridge, Interlude, or Outro
- startTime: "M:SS"
- endTime: "M:SS"
- energyLevel: Low, Medium, or High
- description: 5-word mood/feel summary

Return ONLY a JSON array. No explanation.
```

**Notes**: Fine. Could add "no overlapping timestamps" as a rule.

---

## Stage 3: Meaning Summary
**Model**: Claude Sonnet (`claude-sonnet-4-6`)
**File**: `server/services/claude.ts` → `summarizeMeaning`
**Inputs**: song title, language, lyrics (text), any user-provided context
**Output**: prose summary (under 150 words)

```
Song: {title} ({language})
{context ? "Context: " + context : ""}

LYRICS:
{lyrics}

Summarize the meaning of this song.

Cover:
1. What is the song about? (2-3 sentences)
2. Who is it addressed to?
3. Emotional arc
4. Cultural/spiritual context

Under 150 words. Write in English.
```

**Changes from current**:
- No audio input — just lyrics + metadata. The transcription already happened.
- Moved from Gemini to Claude Sonnet — better at nuanced cultural interpretation.
- Takes text inputs only, no vision/audio needed.

---

## Stage 4: Concept Generation (3 directions)
**Model**: Claude Opus (`claude-opus-4-6`)
**File**: `server/services/claude.ts` → `generateConceptOptions`
**Inputs**: song title, language, lyrics, meaning summary, musicalStructure, user context
**Output**: 3 concept objects

```
You are a visionary film director specializing in Indian mythological and devotional cinema.

SONG: {title} ({language})
{context ? "CONTEXT: " + context : ""}

LYRICS:
{lyrics}

MEANING:
{meaning}

MUSICAL STRUCTURE:
{musicalStructure}

Generate EXACTLY 3 creative directions for a music video:
1. Traditional/classical — rooted in culture, devotional storytelling
2. Modern/contemporary — fresh visual language, cinematic realism
3. Bold/experimental — unexpected, artistic, boundary-pushing

For each direction provide:
- title: 2-4 word creative title
- deity: the primary divine figure
- mood: one distinct emotional keyword (different per direction)
- theme: the core narrative idea (1 sentence)
- conceptDirection: traditional / modern / experimental
- visualSuggestions: { artStyle, colorPalette }

Return ONLY JSON array. No explanation.
```

**Changes from current**:
- Moved from Gemini to Claude Opus — concept generation is the creative foundation, worth the best model
- Now receives the meaning summary from Stage 3 (richer context for concept ideation)
- "Rooted in culture" instead of "rooted in temple art, scripture, devotional iconography" — less prescriptive

---

## Stage 5: Script Planning (cast + environments + scenes + shots)
**Model**: Claude Sonnet (`claude-sonnet-4-6`) via tool_use
**File**: `server/services/claude.ts` → `planScenes`
**Inputs**: lyrics, meaning, musicalStructure, concept, videoMode, basePacing
**Output**: { cast[], environments[], scenes[] }

```
You are a music video director planning a {videoMode} for a devotional song.

CONCEPT: {concept.deity} — {concept.theme}
Mood: {concept.mood}
{concept.conceptDirection}

LYRICS:
{lyrics}

MEANING: {meaning}

MUSICAL STRUCTURE:
{musicalStructure}

CLIP LENGTH: All shots are fixed at {pacing} seconds. You decide creative content, not duration.

Plan the full music video using the plan_music_video tool.

CAST rules:
- Include the deity and key mythological figures by their proper names
- Description = physical appearance for image generation: face, skin tone, build, costume, ornaments, weapons/props. 2-3 sentences.
- Include cultural context: "{name}, the {role} from {tradition}" — e.g. "Kolasura, an asura king from Vaishnavite mythology"
- No art style in descriptions — just what the character looks like

ENVIRONMENT rules:
- Only 2-3 key locations that define the visual world
- Description = physical space: architecture, landscape, scale, lighting conditions, atmosphere. 2 sentences.
- Include cultural reference: "inspired by {source}" — e.g. "inspired by Chola-era temple architecture" or "the cosmic ocean (Kshira Sagara) from Puranic cosmology"
- No art style — just the place itself

SCENE rules:
- One scene per musical section
- narrativeDescription: what happens, 1-2 sentences
- Each shot: direction (5-10 word creative idea), castNames (from cast list), environmentName (from environment list)
```

**Tool schema** (same structure, key changes):
- cast.description: `"Physical appearance + cultural identity for image generation. 2-3 sentences. Start with who they are in mythology. No art style."`
- environments.description: `"Physical space + cultural reference. 2 sentences. No art style."`
- shots.environmentName: **now required** (was optional)

**Changes from current**:
- Cast descriptions now require cultural grounding ("Kolasura, an asura king from Vaishnavite mythology")
- Environment descriptions now require cultural reference
- Environments capped at 2-4 (not unbounded)
- environmentName required per shot

---

## Stage 6: Style Brainstorm (4 text directions)
**Model**: Claude Opus (`claude-opus-4-6`) via tool_use
**File**: `server/services/claude.ts` → `brainstormStyleDirections`
**Inputs**: lyrics, musicalStructure, meaning, concept, userNotes (optional), scriptSummary (optional)
**Output**: 4 style directions [{title, description}]

```
You are a Director of Photography designing the visual language for an Indian devotional music video.

The audience is Indian. The imagery must feel culturally authentic, not generic fantasy.
These descriptions will be used as prompts for Gemini image generation.

SONG: {concept.deity} — {concept.theme}
Mood: {concept.mood}
Language: {concept.language}

LYRICS:
{lyrics}

MUSICAL STRUCTURE:
{musicalStructure}

MEANING:
{meaning}

{scriptSummary ? "SCRIPT OVERVIEW:\n" + scriptSummary : ""}
{userNotes ? "USER DIRECTION: All 4 must be variations within this preference:\n" + userNotes : ""}

Propose 4 distinct visual style directions using the propose_style_directions tool.

Each direction should feel like a different film — different DP, era, artistic movement.

For each: a title (2-5 words) and description (3-4 sentences).

Description covers ONLY transferable visual treatment:
- Lighting quality, direction, color temperature
- Color palette (specific colors, not vague)
- Texture and medium (film grain, oil paint, digital, etc.)
- Mood and atmosphere
- Cultural/artistic references (specific artists, movements, eras)

Do NOT describe characters, scenes, environments, or narrative in the description.
These descriptions will be used as image generation prompts — be vivid and concrete.

QUALITY GUIDELINES for the image generation downstream:
- Avoid overly AI/CGI/fantasy look — should feel cinematic and grounded
- Avoid excessive intricate details that muddy the image — every element should have clear intention
- If stylized, it should be tasteful and deliberate, not generic digital art
- Think film stills, not concept art
```

**Changes from current**:
- Moved from Sonnet to Opus — this is a creative direction step, worth the best model
- Added audience context: "The audience is Indian. Culturally authentic, not generic fantasy."
- Added quality guidelines that flow into the style descriptions
- Explicit instruction: "Do NOT describe characters, scenes, environments, or narrative"

---

## Stage 7: Style Visualization
**Model**: Gemini 3 Pro Image (`gemini-3-pro-image-preview`) — text only (no refs needed, but consistent model)
**File**: `server/services/imagen.ts` → `generateSingleStyleImage`
**Inputs**: styleDescription (from brainstorm), subject (deity name)
**Output**: image path

```
Cinematic film still showcasing a specific visual style. {styleDescription}. The scene evokes the world of {subject}. Focus entirely on lighting, atmosphere, color, texture, and visual style. High production value, no text, no watermark.

Avoid: overly AI/CGI look, excessive intricate details, generic fantasy aesthetic. Should feel like a real film frame.
```

**Changes from current**:
- Switched from Imagen 4 to gemini-3-pro-image-preview for consistency — same model across the entire image pipeline
- Added negative guidance: no AI/CGI look, no excessive detail, no generic fantasy

---

## Stage 8: Style DNA Enrichment (on lock)
**Model**: Claude Sonnet (`claude-sonnet-4-6`) with vision
**File**: `server/services/claude.ts` → `enrichStyleDNA`
**Inputs**: locked style image (base64), short description from brainstorm
**Output**: 30-50 word style fragment

```
Analyze this locked style reference image.

The user chose it based on this direction: "{shortDescription}"

Write a STYLE DNA fragment — 30-50 words of dense keywords and short phrases. NOT prose. This fragment gets injected into every image generation prompt downstream, so it must be pure transferable visual treatment.

Format: keyword phrases separated by commas. Like a image generation prompt, not a paragraph.

Include: lighting type, color temperature, dominant palette colors, texture/medium, grain, mood keyword, artistic reference if clear.

Do NOT include: the subject/character, the scene/environment/architecture, narrative, composition, camera angle.

Example output:
"warm amber chiaroscuro, deep burgundy-gold palette, oil painting texture, visible brushwork, film grain, sacred stillness, Caravaggio lighting, Tanjore gold leaf finish"

Return ONLY the keywords. No quotes, no JSON, no markdown.
```

**Changes from current**:
- Reduced to 30-50 words (was 100-150 — way too long, model has the actual pixels)
- Keyword format, not prose — crisp and injected cleanly into prompts
- Explicit "Do NOT include" list — kills the scene-content-bleeding problem
- Example output shows the format clearly

---

## Stage 9: Character Look Generation
**Model**: Gemini 3 Pro Image (`gemini-3-pro-image-preview`) — multimodal with style ref
**File**: `server/services/imagen.ts` → `generateCharacterLooks`
**Inputs**: character {name, description}, styleDNA, styleImagePath, userFeedback (optional)
**Output**: 3 image paths — same prompt, 3 attempts, pick best quality

```
[Image 1 = Style reference]

Render this character in the visual style of Image 1.

{character.name} — {character.description}

Mid-shot character portrait, upper body and face visible, detailed costume and ornaments.

Style: {styleDNA}

{userFeedback ? "Director note: " + userFeedback : ""}

Cinematic character portrait. No text, no watermark.
Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy. Should feel like a film still. Follow image reference and style.
```

**Changes from current**:
- **3 variants of the same prompt** instead of 3 different compositions — user picks best quality, not best framing
- Fixed composition: mid-shot (good balance of face detail + costume visibility for downstream reference)
- Massively shortened. Removed: REFERENCE USAGE block, OUTPUT REQUIREMENTS block, PRIORITY ORDER block.
- Style DNA is now 30-50 keyword words — inject directly
- Cultural context comes from the character description itself (fixed in Stage 5)
- Added negative guidance (anti-slop)

---

## Stage 10: Environment Look Generation
**Model**: Gemini 3 Pro Image (`gemini-3-pro-image-preview`) — multimodal with style ref
**File**: `server/services/imagen.ts` → `generateEnvironmentLooks`
**Inputs**: environment {name, description}, styleDNA, styleImagePath
**Output**: 3 image paths — same prompt, 3 attempts, pick best quality

```
[Image 1 = Style reference]

Render this environment in the visual style of Image 1. No characters or figures.

{environment.name} — {environment.description}

Wide establishing shot, full environment visible.

Style: {styleDNA}

Cinematic environment, empty scene. No text, no watermark.
Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy. Should feel like a film still.
```

**Changes from current**:
- **3 variants of the same prompt** instead of 3 different framings — user picks best quality
- Fixed framing: wide establishing shot (best for showing the full environment as reference)
- "No characters or figures" repeated for emphasis — model tends to add people
- Anti-slop negative guidance added

---

## Stage 11: Shot Prompt Writing
**Model**: Claude Sonnet (`claude-sonnet-4-6`) via tool_use
**File**: `server/services/claude.ts` → `writeShotPrompts`
**Inputs**: shots[], context { styleDNA, cast[], concept, lyrics }
**Output**: per shot { visualPrompt, motionPrompt }

```
You are a cinematographer writing shot-by-shot prompts for a devotional music video.

STYLE DNA (for context, do NOT include in prompts):
{styleDNA}

CHARACTERS:
{castList}

CONCEPT: {concept.deity} — {concept.theme}. Mood: {concept.mood}.

SHOTS:
{shotList}

For EACH shot, write using the write_shot_prompts tool:

- visualPrompt: What we SEE in the frame. 1-2 sentences.
  Include: composition, character physical details (from cast list), environment, action/pose.
  Reference characters by their mythological identity.
  Do NOT include art style, lighting, or color — the style system handles that.

- motionPrompt: How the camera and characters MOVE. 1 sentence.
  Example: "Slow dolly in as Mahalakshmi raises her abhaya mudra, lotus petals drift across frame"
```

**Changes from current**:
- Added "Reference characters by their mythological identity" — so prompts say "Kolasura the asura" not just "the warrior"
- Added "devotional music video" context
- Otherwise this prompt is solid, minimal changes needed

---

## Stage 12: Shot Start Frame Generation
**Model**: Gemini 3 Pro Image (`gemini-3-pro-image-preview`) — multimodal, full ref chain
**File**: `server/services/imagen.ts` → `generateShotStartFrame`
**Inputs**: visualPrompt, styleDNA, styleImagePath, characterRefs[], environmentRef, prevShotEndFramePath, userFeedback
**Output**: image path

```
[Image 1 = Character: {name}]
[Image 2 = Character: {name}]
[Image 3 = Style reference]
[Image 4 = Environment: {name}]
[Image 5 = Previous shot end frame — match continuity]

Scene: {visualPrompt}

Style keywords: {styleDNA}

Preserve character identity from character references. Match environment from environment reference. Continue visual flow from previous shot. Render in the style of the style reference.

{userFeedback ? "Director note: " + userFeedback : ""}

Single cinematic frame. No text, no watermark.
Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy. Should feel like a film still.
```

**Changes from current**:
- Removed the verbose REFERENCE USAGE, OUTPUT REQUIREMENTS, NEGATIVE CONSTRAINTS, and PRIORITY ORDER blocks
- Replaced with 4 short instruction sentences
- `styleDNA_condensed` instead of full DNA dump
- Numbered image labels are still there (critical for the model to know what each image IS)
- Much shorter overall

---

## Stage 13: Shot End Frame Generation
**Model**: Gemini 3 Pro Image (`gemini-3-pro-image-preview`) — multimodal
**File**: `server/services/imagen.ts` → `generateShotEndFrame`
**Inputs**: startFramePath, visualPrompt, motionPrompt, styleImagePath, styleDNA
**Output**: image path

```
[Image 1 = Start frame of this shot]
[Image 2 = Style reference]

Scene: {visualPrompt}

Motion: {motionPrompt}

Style: {styleDNA}

Image 1 is the start frame of this shot. Generate the ending frame — what the camera sees after the motion described above. Same characters, same costumes, same environment, moments later.

No text, no watermark.
Avoid: overly AI/CGI look, excessive intricate detail, generic fantasy.
```

**Changes from current**:
- Added scene context (visualPrompt) and style DNA — model needs to know WHAT the scene is, not just guess from pixels
- Removed OUTPUT REQUIREMENTS and PRIORITY ORDER blocks
- If this doesn't work well enough, we add the Claude translation step (translateMotionToEndState) as a fallback

---

## Stage 14: Video Generation
**Model**: Veo 3.1 (`veo-3.1-fast-generate-preview`)
**File**: `server/services/veo.ts` → `generateVideo`
**Inputs**: startImagePath (base64), motionPrompt, endImagePath (optional, as lastFrame)
**Output**: video path (MP4)

**Prompt** (assembled in generate.ts route):
```
{motionPrompt}. {brief scene narrative}. Characters: {castNames}. {mood} mood
```

**Notes**: This was already simplified. Veo gets keyframes as images — the prompt just needs to describe the motion. Keep it simple.

---

## Stage 15: Shot Critique
**Model**: Gemini 3 Pro (`gemini-3-pro-preview`) with vision
**File**: `server/services/gemini.ts` → `critiqueShotImage`
**Inputs**: generated image (base64), reference images, prompt, styleDNA
**Output**: { score, reasoning, isConsistent, suggestions }

```
You are an Art Director reviewing a generated frame for a devotional music video.

THE PROMPT WAS: {compiledPrompt}

STYLE DNA: {styleDNA}

Score 0-10:
- 9-10: Publication ready
- 7-8: Minor issues
- 5-6: Noticeable mismatches
- 3-4: Major problems
- 0-2: Failed

Evaluate:
1. STYLE ADHERENCE (40%): Does the image match the locked style?
2. PROMPT FIDELITY (30%): Does it depict what was described?
3. CHARACTER CONSISTENCY ({hasRefs ? '20' : '0'}%): Do characters match references?
4. TECHNICAL QUALITY ({hasRefs ? '10' : '30'}%): Artifacts, anatomy, lighting issues?

Return JSON: { score, reasoning (1-2 sentences), isConsistent (bool), suggestions (specific actionable fixes) }
```

**Notes**: This is fine. The weighted scoring is useful.

---

## Key Design Principle: Style DNA is Short Keywords

Style DNA is now 30-50 words of keyword phrases (Stage 8). No condensation needed — inject directly into all image generation prompts. The model already has the style image as pixels. The text just reinforces key attributes (palette, grain, mood).

---

## Duplicate Functions to Remove

Both `gemini.ts` and `claude.ts` have copies of:
- `brainstormStyleDirections` — keep Claude version (uses tool_use for structured output)
- `refineStyleDirection` — keep Claude version
- `enrichStyleDNA` — keep Claude version (vision quality is better)
- `analyzeImageStyle` — keep Claude version
- `planScenes` — keep Claude version (has environments)

The Gemini duplicates in `gemini.ts` are dead code from before the Claude migration. Remove them.
