# Lahari Media Engine — Pipeline Schematic

Every AI call, its inputs, outputs, what gets saved, and how data flows between stages.

---

## Overview

```
┌─────────────────────────────── BLUEPRINT ────────────────────────────────────┐
│                                                                              │
│  Audio ──→ Analyze ──→ Concepts ──→ Script ──→ Style ──→ Characters ──→ Environments ──→ Shot Prompts
│   │          │           │            │          │           │                │              │
│   │       lyrics      3 opts      cast[]      style     ref images       ref images     visual +
│   │       meaning     user        envs[]      DNA       per char         per env        motion
│   │       structure   picks       scenes[]    + image                                   prompts
│   │                   one         shots[]                                                per shot
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────── STUDIO ───────────────────────────────────────┐
│                                                                              │
│  Per shot (sequential within scene):                                         │
│                                                                              │
│  Start Frame ──→ End Frame ──→ Lock ──→ Video                                │
│  (all refs)      (from start)   (both    (start + end                        │
│                                  req'd)   keyframes)                         │
│                                                                              │
│  Shot N locked ──→ Shot N+1 receives Shot N's end frame as continuity ref    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────── RENDER ───────────────────────────────────────┐
│                                                                              │
│  All video clips + original audio ──→ FFmpeg WASM ──→ Final MP4              │
│  (client-side)                                                               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Stage 1: Audio Analysis

**Route:** `POST /api/projects` (upload + analyze)
**Model:** Gemini 3 Pro (`gemini-3-pro-preview`) × 3 parallel calls
**Code:** `server/services/gemini.ts` → `transcribeLyrics`, `detectStructure`, `summarizeMeaning`

### AI Calls (parallel)

| Call | Input | Output | Stored |
|------|-------|--------|--------|
| `transcribeLyrics` | Audio file (base64) | Timestamped lyrics (original language) | `projects.lyrics` |
| `detectStructure` | Audio file (base64) | Musical sections (label, timing, energy) | `projects.musical_structure` (JSON) |
| `summarizeMeaning` | Audio file (base64) | Song meaning, emotional arc, cultural context | `projects.meaning` |

**Status transition:** `uploaded` → `analyzing` → `analyzed`

---

## Stage 2: Concept Generation

**Route:** `POST /api/projects/:id/generate-concepts`
**Model:** Gemini 3 Pro (`gemini-3-pro-preview`)
**Code:** `server/services/gemini.ts` → `generateConceptOptions`

### AI Call

| Input | Output | Stored |
|-------|--------|--------|
| Lyrics + musical structure + meaning | 3 concept options (deity, mood, theme, direction, visual suggestions) | `projects.concept_options` (JSON array) |

### User Action

User selects one concept → `POST /:id/lock-concept`

**Stored:** `projects.locked_concept` (JSON)
**Status transition:** `analyzed` → `concept_locked`

---

## Stage 3: Script Planning

**Route:** `POST /api/projects/:id/generate-script`
**Model:** Claude Sonnet (`claude-sonnet-4-6`) via tool_use
**Code:** `server/services/claude.ts` → `planScenes`

### AI Call

| Input | Output |
|-------|--------|
| Locked concept + lyrics + meaning + musical structure + video mode + clip length | `{ cast[], environments[], scenes[shots[]] }` |

### What gets stored

| Data | Table | Fields |
|------|-------|--------|
| Cast members | `cast_members` | `id, project_id, name, description, sort_order` |
| Environments | `environments` | `id, project_id, name, description, sort_order` |
| Scenes | `scenes` | `id, project_id, section_label, start_time, end_time, lyrics, narrative_description, sort_order` |
| Shots | `shots` | `id, scene_id, visual_prompt` (direction placeholder), `duration, cast_ids` (JSON), `environment_id, sort_order` |

**Note:** Shots only get a `direction` placeholder at this stage. The real `visual_prompt` + `motion_prompt` are written later in the Shot Prompts stage after all creative decisions are locked.

**Status transition:** `concept_locked` → `scripted`

---

## Stage 4: Style Exploration & Lock

Multiple sub-routes. Style exploration stays on **Imagen 4** (text-only) because the style image IS the reference being created — it doesn't need reference images.

### 4a. Brainstorm Text Directions

**Route:** `POST /:id/brainstorm-styles`
**Model:** Claude Sonnet (`claude-sonnet-4-6`)
**Code:** `server/services/claude.ts` → `brainstormStyleDirections`

| Input | Output | Stored |
|-------|--------|--------|
| Concept + lyrics + meaning + structure + script summary + user notes | 4 text style directions (title + description) | Returned to client only (not persisted) |

### 4b. Visualize a Direction

**Route:** `POST /:id/visualize-style`
**Model:** Imagen 4 (`imagen-4.0-generate-001`)
**Code:** `server/services/imagen.ts` → `generateSingleStyleImage`

| Input | Output | Stored |
|-------|--------|--------|
| Style direction text + subject (deity name) | Single style image | `assets` table (category: `style`) |

### 4c. Refine Direction (optional)

**Route:** `POST /:id/refine-style-direction`
**Model:** Claude Sonnet
**Code:** `server/services/claude.ts` → `refineStyleDirection`

| Input | Output |
|-------|--------|
| Current direction text + user feedback + concept | Refined direction text |

### 4d. Analyze Uploaded Image (optional)

**Route:** `POST /:id/analyze-style-image`
**Model:** Claude Sonnet (vision)
**Code:** `server/services/claude.ts` → `analyzeImageStyle`

| Input | Output | Stored |
|-------|--------|--------|
| User-uploaded image | Style description text | `projects.style_description` |

### 4e. Lock Style

**Route:** `POST /:id/lock-style`
**Model:** Claude Sonnet (vision) for DNA enrichment
**Code:** `server/services/claude.ts` → `enrichStyleDNA`

| Input | Output | Stored |
|-------|--------|--------|
| Locked style image + short description | Enriched style DNA (flowing paragraph describing visual language) | `projects.style_asset_id`, `projects.style_description` |

**Status transition:** `scripted` → `style_locked`

### Unlock: `POST /:id/unlock-style` → reverts to `scripted`

---

## Stage 5: Character Look Development

**Route:** `POST /:id/generate-looks`
**Model:** gemini-3-pro-image-preview (multimodal — accepts reference images)
**Code:** `server/services/imagen.ts` → `generateCharacterLooks`

### AI Call

| Input | Output |
|-------|--------|
| Character name + description | 3 look options (close-up, mid-shot, full body) |
| Style DNA (text) | |
| Style image (visual ref, optional) | |
| User feedback (text, optional) | |

### Prompt Structure (per composition)

```
parts: [
  { text: "Generate a character portrait in this visual style:" }
  { inlineData: styleImage }                     ← visual reference
  { text: "Style: {styleDNA}" }
  { text: "Character: {name} — {description}" }
  { text: "Composition: Close-up portrait..." }
  { text: "Cinematic lighting, high detail..." }
  { text: "FEEDBACK: {userFeedback}" }           ← optional
]
```

### What gets stored

| Data | Table | Fields |
|------|-------|--------|
| 3 look images | `assets` | `id, project_id, category='character', file_path` |
| Locked reference | `cast_members` | `reference_asset_id` (user picks one) |

### User Action

User picks best look → `POST /:id/lock-character` → sets `cast_members.reference_asset_id`

When all cast members have references → **Status transition:** `style_locked` → `characters_locked`

---

## Stage 6: Environment Look Development

**Route:** `POST /:id/generate-environment-look`
**Model:** gemini-3-pro-image-preview
**Code:** `server/services/imagen.ts` → `generateEnvironmentLooks`

### AI Call

| Input | Output |
|-------|--------|
| Environment name + description | 3 look options (wide, medium, low-angle) |
| Style DNA (text) | |
| Style image (visual ref, optional) | |

### Prompt Structure (per framing)

```
parts: [
  { text: "Generate an environment scene in this visual style:" }
  { inlineData: styleImage }
  { text: "Style: {styleDNA}" }
  { text: "Environment: {name} — {description}" }
  { text: "Framing: Wide establishing shot..." }
  { text: "No characters, focus on environment..." }
]
```

### What gets stored

| Data | Table | Fields |
|------|-------|--------|
| 3 look images | `assets` | `id, project_id, category='environment', file_path` |
| Locked reference | `environments` | `reference_asset_id` (user picks one) |

---

## Stage 7: Shot Prompt Writing

**Route:** `POST /:id/write-shot-prompts`
**Model:** Claude Sonnet (`claude-sonnet-4-6`)
**Code:** `server/services/claude.ts` → `writeShotPrompts`

This runs AFTER all creative decisions are locked — the prompts are written with full context.

### AI Call

| Input | Output |
|-------|--------|
| Script skeleton (all shots with direction, duration, castNames, scene narrative, lyrics) | `visualPrompt` + `motionPrompt` per shot |
| Style DNA | |
| Locked character descriptions | |
| Locked concept | |

### What gets stored

| Data | Table | Fields |
|------|-------|--------|
| Image direction | `shots` | `visual_prompt` (overwrites direction placeholder) |
| Motion direction | `shots` | `motion_prompt` |

**Note:** Processes in batches of 15 shots to manage output size.

---

## Stage 8: Shot Start Frame Generation

**Route:** `POST /:id/shots/:shotId/generate-image`
**Model:** gemini-3-pro-image-preview
**Code:** `server/services/imagen.ts` → `generateShotStartFrame`

### Sequential Enforcement

Before generating shot N (N > 0), the route checks that shot N-1 in the same scene is **locked**. Returns 400 if not.

### Reference Chain (numbered index)

```
Image 1 = Character reference: Kolasura         ← from cast_members.reference_asset_id
Image 2 = Character reference: Mahalakshmi      ← from cast_members.reference_asset_id
Image 3 = Style reference                        ← from projects.style_asset_id
Image 4 = Environment reference: Vaikuntha      ← from environments.reference_asset_id
Image 5 = Last-scene continuity reference         ← from prev shot's end_image_asset_id
```

### Full Prompt Structure

```
parts: [
  // ── Reference images (numbered) ──
  { text: "Image 1 = Character reference: Kolasura" }
  { inlineData: kolasuraRefImage }
  { text: "Image 2 = Character reference: Mahalakshmi" }
  { inlineData: mahalakshmiRefImage }
  { text: "Image 3 = Style reference" }
  { inlineData: styleImage }
  { text: "Image 4 = Environment reference: Vaikuntha" }
  { inlineData: vaikunthaRefImage }
  { text: "Image 5 = Last-scene continuity reference" }
  { inlineData: prevShotEndFrame }

  // ── Reference usage instructions ──
  { text: "REFERENCE USAGE
    - Character references (Image 1, Image 2): preserve identity, face, hairstyle,
      silhouette, body proportions, and signature wardrobe details.
    - Style reference: transfer only artistic treatment, lighting logic, palette,
      texture, lens language, and finish.
    - Environment reference: transfer location design, materials, weather, ambience.
    - Continuity reference: continue the action, framing logic, emotional beat." }

  // ── Scene description ──
  { text: "SCENE DESCRIPTION\n{visualPrompt}" }
  { text: "Style DNA: {styleDNA}" }
  { text: "DIRECTOR FEEDBACK: {userFeedback}" }    ← optional

  // ── Output requirements ──
  { text: "Generate a single cinematic frame for this scene.
    The image must feel like a natural continuation of the continuity reference.
    The subject must remain clearly the same character as the character reference(s).
    The environment should clearly evoke the environment reference.
    The render should use the visual language of the style reference." }

  // ── Priority order ──
  { text: "PRIORITY ORDER
    1. Character identity
    2. Temporal continuity with the last scene
    3. Environment fidelity
    4. Style fidelity" }

  // ── Negative constraints ──
  { text: "NEGATIVE CONSTRAINTS
    - Do not borrow subject identity from the style reference.
    - Do not redesign the character.
    - Do not change the setting unless required by the scene description.
    - Do not break continuity in costume, pose progression, or major props.
    - No text, no watermark, no logos." }
]
```

### What gets stored

| Data | Table | Fields |
|------|-------|--------|
| Start frame image | `assets` | `id, project_id, category='shot_image', file_path` |
| Reference to asset | `shots` | `image_asset_id, image_status='success'` |
| Attempt counter | `shots` | `attempt_count` (incremented) |

---

## Stage 9: Shot End Frame Generation

**Route:** `POST /:id/shots/:shotId/generate-end-frame`
**Model:** gemini-3-pro-image-preview
**Code:** `server/services/imagen.ts` → `generateShotEndFrame`

### Prerequisite

Start frame must exist (`shots.image_asset_id` must be set).

### Prompt Structure

```
parts: [
  // ── Start frame as primary reference ──
  { text: "Image 1 = Start frame of this shot" }
  { inlineData: startFrame }

  // ── Style reference (optional) ──
  { text: "Image 2 = Style reference" }
  { inlineData: styleImage }

  // ── Reference usage ──
  { text: "REFERENCE USAGE
    - Image 1 (start frame): Preserve character identity, costume, environment,
      props, and spatial layout exactly. The end frame is the SAME scene moments later.
    - Image 2 (style): maintain the same artistic treatment, lighting, palette." }

  // ── Motion description ──
  { text: "MOTION DESCRIPTION\n{motionPrompt}" }

  // ── Output requirements ──
  { text: "Generate the END FRAME of this shot — what the camera sees AFTER
    the motion described above has occurred.
    Same scene, same characters, same environment as Image 1.
    Camera and/or characters have moved according to the motion description.

    PRIORITY ORDER
    1. Character identity continuity with Image 1
    2. Environment continuity with Image 1
    3. Motion fidelity
    4. Style fidelity" }
]
```

### What gets stored

| Data | Table | Fields |
|------|-------|--------|
| End frame image | `assets` | `id, project_id, category='shot_end_frame', file_path` |
| Reference to asset | `shots` | `end_image_asset_id, end_image_status='success'` |

---

## Stage 10: Shot Lock

**Route:** `POST /:id/shots/:shotId/lock`
**Model:** None (user action)

### Prerequisites

- `shots.image_asset_id` must exist (start frame)
- `shots.end_image_asset_id` must exist (end frame)

### What gets stored

| Data | Table | Fields |
|------|-------|--------|
| Lock flag | `shots` | `locked = 1` |

### Effect

Next shot in same scene becomes actionable. Its start frame generation can now access this shot's `end_image_asset_id` as the continuity reference.

---

## Stage 11: Video Generation

**Route:** `POST /:id/shots/:shotId/generate-video`
**Model:** Veo 3.1 (`veo-3.1-fast-generate-preview`)
**Code:** `server/services/veo.ts` → `generateVideo`

### Veo Input

| Input | Source |
|-------|--------|
| Start keyframe image | `shots.image_asset_id` → `assets.file_path` |
| Motion prompt | Built inline: `{motionPrompt}. {scene narrative brief}. Characters: {names}. {mood} mood` |
| End keyframe image (optional) | `shots.end_image_asset_id` → `assets.file_path` (or legacy fallback: next shot's start frame) |

**Prompt construction:** No Claude compile call. Motion prompt + brief scene context + character names + mood. Veo gets scene understanding from this, and visual understanding from the keyframes.

### What gets stored

| Data | Table | Fields |
|------|-------|--------|
| Video clip | `assets` | `id, project_id, category='shot_video', file_path` |
| Reference to asset | `shots` | `video_asset_id, video_status='success'` |

---

## Stage 12: Final Render

**Location:** Client-side (`StepRender.tsx`)
**Tool:** FFmpeg WASM

| Input | Output |
|-------|--------|
| All video clips (in scene/shot order) + original audio file | Final rendered MP4 |

---

## Database Schema

### `projects`
```sql
id TEXT PRIMARY KEY
title TEXT
status TEXT                  -- uploaded|analyzing|analyzed|concept_locked|scripted|style_locked|characters_locked
audio_path TEXT              -- storage/audio/{uuid}.mp3
lyrics TEXT                  -- full transcription
musical_structure TEXT       -- JSON: MusicalSection[]
meaning TEXT                 -- song meaning summary
concept_options TEXT         -- JSON: ConceptOption[] (3 options)
locked_concept TEXT          -- JSON: ConceptOption (user's pick)
style_description TEXT       -- enriched style DNA (text paragraph)
style_asset_id TEXT          -- FK → assets.id (locked style image)
color_palette TEXT
video_mode TEXT              -- 'montage' | 'cinematic'
target_duration INTEGER      -- clip length in seconds
cost_estimate REAL           -- running total
created_at TEXT
updated_at TEXT
```

### `cast_members`
```sql
id TEXT PRIMARY KEY
project_id TEXT              -- FK → projects.id
name TEXT                    -- e.g. "Kolasura"
description TEXT             -- physical description for image gen
reference_asset_id TEXT      -- FK → assets.id (locked look image)
sort_order INTEGER
```

### `environments`
```sql
id TEXT PRIMARY KEY
project_id TEXT              -- FK → projects.id
name TEXT                    -- e.g. "Vaikuntha Palace"
description TEXT             -- location description for image gen
reference_asset_id TEXT      -- FK → assets.id (locked look image)
sort_order INTEGER
```

### `scenes`
```sql
id TEXT PRIMARY KEY
project_id TEXT              -- FK → projects.id
section_label TEXT           -- e.g. "Verse 1", "Chorus"
start_time TEXT              -- "0:15"
end_time TEXT                -- "0:45"
lyrics TEXT                  -- lyrics for this section
narrative_description TEXT   -- what happens in this scene
sort_order INTEGER
```

### `shots`
```sql
id TEXT PRIMARY KEY
scene_id TEXT                -- FK → scenes.id
visual_prompt TEXT           -- image generation direction
motion_prompt TEXT           -- video generation direction
duration REAL                -- clip length in seconds
cast_ids TEXT                -- JSON: string[] of cast_member IDs
environment_id TEXT          -- FK → environments.id
image_asset_id TEXT          -- FK → assets.id (start frame)
image_status TEXT            -- idle|loading|success|error
end_image_asset_id TEXT      -- FK → assets.id (end frame)
end_image_status TEXT        -- idle|loading|success|error
locked INTEGER               -- 0|1 (requires both frames)
user_feedback TEXT           -- director notes for regeneration
video_asset_id TEXT          -- FK → assets.id (video clip)
video_status TEXT            -- idle|loading|success|error
critique TEXT                -- JSON: ShotCritique
attempt_count INTEGER        -- how many times regenerated
use_next_as_end_frame INTEGER -- legacy flag
sort_order INTEGER
```

### `assets`
```sql
id TEXT PRIMARY KEY
project_id TEXT              -- FK → projects.id
category TEXT                -- style|character|environment|shot_image|shot_end_frame|shot_video
file_path TEXT               -- relative to storage/ root
prompt TEXT                  -- the prompt used to generate this asset
metadata TEXT                -- JSON (optional extra data)
created_at TEXT
```

### `ai_calls` (X-Ray debug log)
```sql
id TEXT PRIMARY KEY
project_id TEXT
stage TEXT                   -- e.g. "generate-shot-start-frame"
model TEXT                   -- e.g. "gemini-3-pro-image-preview"
prompt TEXT                  -- the prompt sent to the model
reference_inputs TEXT        -- JSON: {type, label, url}[]
context_chain TEXT           -- JSON: accumulated context
response_summary TEXT        -- summary of what came back
output_asset_ids TEXT        -- JSON: string[] of asset IDs
duration_ms INTEGER
cost_estimate REAL
error TEXT
created_at TEXT
```

---

## AI Model Assignments

| Model | ID | Type | Used For |
|-------|-----|------|----------|
| Gemini 3 Pro | `gemini-3-pro-preview` | Text + vision | Audio analysis, concept gen, shot critique, director chat |
| Claude Sonnet | `claude-sonnet-4-6` | Structured text | Script planning (tool_use), style brainstorm/refine/enrich, shot prompt writing |
| Imagen 4 | `imagen-4.0-generate-001` | Text → image | Style exploration only (no ref images needed) |
| Gemini 3 Pro Image | `gemini-3-pro-image-preview` | Multimodal → image | Character looks, environment looks, shot start/end frames (with ref images) |
| Veo 3.1 | `veo-3.1-fast-generate-preview` | Image → video | Keyframe morphing with start + optional end frame |

### Why two image models?

**Imagen 4** for style exploration: The style image IS the reference being created. No input images needed. Fast, high quality for exploring visual directions.

**gemini-3-pro-image-preview** for everything else: Accepts reference images as `inlineData` parts. Characters, environments, and shot frames all need visual consistency with previously locked references.

---

## Storage Layout

```
storage/
  lahari.db                  -- SQLite database
  audio/
    {uuid}.mp3               -- uploaded audio files
  images/
    {uuid}.png               -- all generated images:
                              --   style explorations
                              --   character looks (3 per character)
                              --   environment looks (3 per environment)
                              --   shot start frames
                              --   shot end frames
  videos/
    {uuid}.mp4               -- generated video clips
```

All paths stored in `assets.file_path` relative to `storage/`. Served via `/storage/{file_path}` endpoint.

---

## Sequential Shot Flow (within a scene)

```
Scene 1
├── Shot 1 (always actionable)
│   ├── Generate start frame ← style + char refs + env ref (no continuity ref for first shot)
│   ├── Generate end frame   ← start frame + motion prompt
│   └── Lock                 ← requires both frames
│                               │
│                               ▼ end frame passes as continuity ref
├── Shot 2 (actionable after Shot 1 locked)
│   ├── Generate start frame ← style + char refs + env ref + Shot 1 end frame
│   ├── Generate end frame   ← start frame + motion prompt
│   └── Lock
│                               │
│                               ▼
├── Shot 3 (actionable after Shot 2 locked)
│   └── ...
│
Scene 2 (independent — can work in parallel with Scene 1)
├── Shot 1 (always actionable)
│   └── ...
```

---

## Feedback Loop

Any unlocked shot can be regenerated with director feedback:

1. User types feedback in the shot card (e.g. "make the sky redder")
2. Feedback saved via `PATCH /:id/shots/:shotId` → `shots.user_feedback`
3. Regenerate start frame → feedback appended as `DIRECTOR FEEDBACK: {text}` in the prompt
4. End frame regenerated from new start frame
5. Old assets remain in `assets` table (never deleted — persistence guarantee)
6. Shot `attempt_count` incremented

---

## Data Flow Summary

```
Audio File
  │
  ├──→ [Gemini × 3]  → lyrics, meaning, structure    → projects table
  │
  ├──→ [Gemini]       → 3 concept options              → projects.concept_options
  │        │
  │        └──→ user locks one                          → projects.locked_concept
  │
  ├──→ [Claude]        → cast + envs + scenes + shots   → cast_members, environments, scenes, shots
  │
  ├──→ [Claude]        → 4 style text directions        → (client state)
  │        │
  │        ├──→ [Imagen 4] → style images               → assets (category: style)
  │        │
  │        └──→ user locks one + [Claude vision]         → projects.style_asset_id + style_description
  │
  ├──→ [Gemini Pro Image] × 3 per character              → assets (category: character)
  │        │
  │        └──→ user locks one per character              → cast_members.reference_asset_id
  │
  ├──→ [Gemini Pro Image] × 3 per environment            → assets (category: environment)
  │        │
  │        └──→ user locks one per environment            → environments.reference_asset_id
  │
  ├──→ [Claude]        → visualPrompt + motionPrompt     → shots.visual_prompt, shots.motion_prompt
  │
  ├──→ [Gemini Pro Image] per shot (sequential)
  │        │
  │        ├──→ start frame                              → assets (shot_image) + shots.image_asset_id
  │        ├──→ end frame                                → assets (shot_end_frame) + shots.end_image_asset_id
  │        └──→ user locks                               → shots.locked = 1
  │
  ├──→ [Veo 3.1]      → video clip per shot             → assets (shot_video) + shots.video_asset_id
  │
  └──→ [FFmpeg WASM]   → final rendered video            → (client download)
```
