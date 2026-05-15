# V1 Preset + Workflow Plan

This lane turns the existing production code into a clean video platform for outside artists. The old deployment and database shape are useful as a starting point, but the v1 product should read as a fresh studio product.

The near-term product target is two-lane:

- `music_video`: audio-first, close to the current pipeline shape, but scrubbed into a general music-video workflow.
- `anime_scripted`: script-first, built for the first client use case, with no lyrics/audio-analysis requirement.

## Core Split

The platform needs three separate concepts:

1. **Seed**: how the project starts. Examples: `audio`, `script`, `brief`, `document`, `idea`.
2. **Workflow recipe**: which stages run. Examples: `music_video`, `anime_scripted`.
3. **Preset**: taste and defaults. Examples: `music_video_default`, `anime_default`.

Presets should not own the whole pipeline. Recipes own flow. Seeds own intake. Presets own taste, render profile, examples, forbidden patterns, QA criteria, and model defaults.

## Stable Engine Contract

All workflows should normalize into the same downstream shape:

```txt
Seed -> ProjectBrief -> CreativePlan -> ProductionBible -> ShotPlan -> Assets -> Render
```

For music video, that currently looks like:

```txt
audio/SRT -> lyrics/meaning/structure -> concepts -> script/shot plan -> style -> cast/env refs -> studio -> render
```

For anime, v1 should look like:

```txt
script/episode brief -> parse scenes/shots -> preset style bible -> cast/env refs -> studio -> render
```

The Studio and Render steps should not care whether a shot came from a song, an anime script, or a future ad brief. They need scenes, shots, cast, environments, style/render profile, and assets.

## V1 Workflow Recipes

### `music_video`

Primary seed: `audio`

Accepted seeds: `audio`, `brief`, `document`, `idea`

Stages:

| Stage | State |
| --- | --- |
| Audio analysis | required |
| Concept | generated |
| Script / shot plan | generated |
| Style | generated |
| Cast | generated |
| Environments | generated |
| Studio | required |
| Render | required |

Rules:

- The track supplies timing, rhythm, sections, and render audio.
- Concepts and shot plans must be general music-video language.
- Existing queue/catalog tables are legacy adapters, not the general entry point.

### `anime_scripted`

Primary seed: `script`

Accepted seeds: `script`, `brief`, `document`, `idea`

Stages:

| Stage | State |
| --- | --- |
| Audio analysis | skipped |
| Concept | optional |
| Script / shot plan | user supplied, then parsed |
| Style | preset supplied |
| Cast | generated from script |
| Environments | generated from script |
| Studio | required |
| Render | required |

Rules:

- The uploaded script is source of truth.
- Do not require audio, lyrics, song sections, or music-video structure.
- Do not invent a different story unless the director asks.
- The preset provides an anime style bible by default.
- Audio/dialogue/music can become a later workflow stage; it should not block the first Studio path.

## Prompt Architecture

Each prompt should be composed from modules instead of cloned per preset:

```txt
core task contract
+ preset module
+ seed module
+ model/provider module
+ render profile
+ project/director overrides
```

Prompt families:

| Family | Ownership |
| --- | --- |
| Intake prompts | seed-specific |
| Concept/script/style prompts | core + workflow + preset |
| Look prompts | core + preset + render profile |
| Studio prompts | core + preset examples + model/provider rules |
| QA prompts | core rubric + preset-specific criteria |

This keeps the hard-won pipeline contracts stable while letting anime, ads, reels, and future modes change taste and flow.

## Current Prompt Audit

Highest-priority scrub points:

| Area | Current issue | V1 treatment |
| --- | --- | --- |
| Concept generation | Subject is still stored in a legacy concept field for compatibility | Prompt calls it preset subject; DB field can stay as compatibility until schema work |
| Script planning | Current planner mixed music timing with old domain examples | Keep timing/schema validation, move examples/rules to preset |
| Style generation | Old identity was domain-specific DP language | Default is now general music-video DP language; anime uses style bible |
| Character refs | Some rules assume old iconography | Preset controls identity details; core only requires reusable neutral refs |
| Environment refs | Mostly reusable, but live-action realism leaks through | Render profile controls realism/anime wording |
| Shot prompts | Renderability rules are good; examples were domain-specific | Core keeps renderable/visible/actionable contract; examples come from preset |
| Storyboard/video prompts | Mostly provider mechanics | Keep as model module with preset rules inserted |
| Critique prompt | QA rubric still has old domain criteria | Needs split into core QA + preset QA criteria |

## Implementation Path

1. Replace the old preservation-oriented preset scaffold with `music_video_default` and `anime_default`.
2. Add `WorkflowRecipe` definitions for `music_video` and `anime_scripted`.
3. Keep DB untouched while the contracts settle.
4. Route existing prompt builders through clean preset language.
5. Add script-intake parsing for anime that outputs the same scene/shot/cast/environment contract as the music-video planner.
6. Make UI/API stages recipe-aware: music video starts from audio; anime starts from script import/review.
7. Validate two golden paths: one clean music video and one anime script reaching Studio.

## Non-Goals For V1

- No generic agentic pipeline planner.
- No full marketplace of presets.
- No production DB migration in this lane.
- No ad/reel workflow until music video + anime prove the abstraction.
- No requirement that every workflow has lyrics, audio analysis, generated concepts, or generated style.
