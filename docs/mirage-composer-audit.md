# Mirage Composer Audit

Date: 2026-05-26
Branch: `mirage`
Purpose: inspect the prompt composer, preset taste additives, and runtime prompt builders for vague or bloated instruction layers before the next deployed agent smoke test.

## Executive Read

The composer shape is mostly right. The bloat is not coming from `composePrompt()` itself; it is coming from a few contributors using the composer as a dumping ground for doctrine, examples, model lore, and output schema all at once.

Biggest finding: `writeShotPrompts` is the clear offender. A one-shot anime prompt renders at about **7,002 chars / ~1,751 tokens** before the model sees one real shot. It repeats the same anti-vagueness idea in core task, model guidance, preset taste, and output contract. This is the likely source of "vague but long" shot/video downstream behavior.

Second finding: preset taste is earning its place, but `anime_default.style.rules` and `anime_default.looks.qualityRules` are reused across style, character, environment, storyboard, and image prompts. That is useful for medium guard, but it should be compressed into smaller per-surface rules instead of carrying the full anti-photoreal doctrine everywhere.

Third finding: output contracts are doing too much prose. Several contracts explain the system rather than simply state the response shape and hard constraints. We should separate "what to return" from "why this layer exists."

## Composer Sections

| Contributor | What it injects | Why it exists | Is it earning tokens? | Verdict | Saul's call |
|---|---|---|---|---|---|
| `coreTask` | The task body before any header | Main instruction, highest-priority task | Yes, but several files overuse it for doctrine/examples | Keep, cap at 3-6 lines for most tools | ☐ |
| `workflowContext` | One or two sentences: scripted narrative vs music-led | Prevents wrong graph assumptions without enum labels | Mostly yes; small and cheap | Keep, but drop from image-gen prompts if final prompt is already visually specific | ☐ |
| `inputs` | Project/source/shot/cast/style data | Grounding; prevents generic output | Yes, but raw source caps are sometimes too large for tiny edits | Keep; tighten per tool | ☐ |
| `presetTaste` | Preset source/style/look/studio/audio rules | Medium guard and taste | Yes, but repeated full blocks are costly | Keep, split into small per-surface taste fragments | ☐ |
| `userNotePolicy` | How artist feedback interacts with contract/taste | Prevents "note as vague nudge" drift | Yes for generate/refine tools; verbose in repeated examples | Keep, replace repeated Polaroid/live-action examples with a shared short rule | ☐ |
| `outputContract` | Required response shape and hard rules | Enforces JSON/tool shape | Yes, but too many contracts explain content philosophy | Keep, cut to schema + 5-8 hard rules | ☐ |
| `userNote` | Raw artist note | Direction | Yes | Keep | ☐ |
| `inspectComposedPrompt` | Reverse parser for X-Ray | Debug transparency | Yes as debug-only | Keep; edge case noted: exact header lines inside user text can mis-split | ☐ |

## Preset Additives

| Contributor | What it injects | Current use | Finding | Verdict | Saul's call |
|---|---|---|---|---|---|
| `music_video_default.source.rules` | Audio/lyrics/structure are source of truth | Plan scenes, concept/style | Earns tokens for music-led tools | Keep | ☐ |
| `music_video_default.concept.rules` | Concept should avoid style/palette/camera | Concept gen/refine | Good and compact | Keep | ☐ |
| `music_video_default.script.*Rules` | Cast/env/scene production planning rules | Plan scenes/refine | Mostly good, but examples may be enough instead of long prose | Keep, minor trim later | ☐ |
| `music_video_default.style.rules` | Medium-permissive music-video taste | Style brainstorm/visualize/look prompts | Useful because music-led can be mixed media | Keep | ☐ |
| `music_video_default.style.brainstormTaste` | Range across medium/lighting/texture | Style brainstorm | Good; directly fixes samey outputs | Keep | ☐ |
| `music_video_default.looks.qualityRules` | Anti-AI generic look | Look/style image prompts | Useful but broad | Keep; consider shorter image-specific version | ☐ |
| `music_video_default.studio.*Rules` | Shot/storyboard/video discipline | Shot/storyboard/video prompts | Earns tokens | Keep | ☐ |
| `anime_default.source.rules` | Script is source, preserve story | Script/concept/audio | Good | Keep | ☐ |
| `anime_default.concept.rules` | Concept is production brief, not replacement story | Concept | Good | Keep | ☐ |
| `anime_default.script.*Rules` | Character sheets/background boards/scene planning | Parse/refine/script | Good, practical | Keep | ☐ |
| `anime_default.style.rules` | Anime medium guard and anti-photoreal doctrine | Style, visualize, look, storyboard | Important, but currently too long for repeated image calls | Keep but create compressed variants: `mediumGuardShort`, `styleBrainstormTaste`, `imageQualityBans` | ☐ |
| `anime_default.style.brainstormTaste` | Range across anime aesthetics | Style brainstorm | Earns tokens; fixes narrow anime style | Keep | ☐ |
| `anime_default.looks.characterRules` | Reusable anime character ref guidance | Character look prompts | Good and targeted | Keep | ☐ |
| `anime_default.looks.environmentRules` | Reusable anime background board guidance | Env look prompts | Good and targeted | Keep | ☐ |
| `anime_default.looks.qualityRules` | Avoid photoreal, 3D plastic, noise, text, collage | Look/style image prompts | Good, but "avoid photoreal" blocks photoreal only because preset is anime. Correct for anime; do not globalize it | Keep for anime, allow other presets to differ | ☐ |
| `anime_default.studio.shotPromptRules` | Acting/story/emotional change guidance | Shot prompts | Good but duplicates shotPrompt core task | Keep, cut duplicate core text | ☐ |
| `anime_default.studio.storyboardRules` | Anime layout/key pose board rules | Storyboard | Good and specific | Keep | ☐ |
| `anime_default.studio.videoPromptRules` | Preserve refs, no live-action artifacts | Seedance video | Good | Keep | ☐ |
| `anime_default.audio.*Rules` | Dialogue/sound/project-level strategy | Audio plan | Good, currently compact | Keep | ☐ |

## Prompt File Audit

| File / builder | Approx shape | What it injects | Finding | Verdict | Saul's call |
|---|---:|---|---|---|---|
| `_composer.ts` | tiny | Section order and rendering | Clean. The `OUTPUT CONTRACT` header is a prompt-body change but generally helpful | Keep | ☐ |
| `_shared.ts` | tiny | `workflowContextFor`, `clip`, `conceptSubject` | Good. Context is small and human-readable | Keep | ☐ |
| `concept.ts / buildGenerateConceptPrompt` | ~2.3k chars in sample | Concept task, source, preset concept rules, user-note policy, JSON contract | Healthy length. Some duplicate "no style/camera/palette" appears in core + preset + contract, but it protects layer separation | Keep, minor trim later | ☐ |
| `concept.ts / buildRefineConceptPrompt` | medium | Surgical refinement contract | Good. Could shorten user-note policy | Keep | ☐ |
| `styleBrainstorm.ts` | medium | 4 directions, range, medium guard, user-note hard constraint | Good. Polaroid example is useful once, not in every style/refine prompt | Keep, compress repeated conflict example | ☐ |
| `refineStyle.ts` | medium | Surgical style refine | Good but repeats same medium-conflict paragraph | Keep, share shorter policy | ☐ |
| `visualizeStyle.ts` | ~image prompt | Style image generation, style direction, preset taste + quality rules | Mostly good. It may carry too much anime anti-photoreal doctrine for a simple style image | Keep, use short image taste | ☐ |
| `lookPrompts.ts / buildCharacterLookPrompt` | ~1.8k chars in sample | Style ref extraction, entity description, preset style + character + quality rules | Good. This is much better than old long character prompt. Main risk is "Extract style" language still not strong enough for known artist-style references without a semantic note | Keep, improve style-intent note generation separately | ☐ |
| `lookPrompts.ts / buildEnvironmentLookPrompt` | similar | Env ref generation | Good | Keep | ☐ |
| `parseScript.ts` | medium | Script extraction, preset script rules, JSON/tool contract | Good, practical | Keep | ☐ |
| `planScenes.ts` | medium-large | Music-led planner, pacing, source signals, cast/env/shot rules | Only for music-led, so title/core are okay. Do not reuse for scripted narrative | Keep | ☐ |
| `refineScript.ts` | large | Full current script JSON, surgical policy, pacing, rules | Large but expected because it must preserve full script. Risk: output contract says `plan_music_video` even when generic surfaces call it | Keep for now; rename tool text later | ☐ |
| `shotPrompts.ts / buildWriteShotPromptsPrompt` | **~7.0k chars sample** | Art direction doctrine, examples, model guidance, cast, previous tail, all shots, output contract | Main bloat offender. Too much meta-instruction before the actual shots. Duplicates renderable guidance across core, examples, model guidance, contract | Cut hard. Target <3.5k for 1-3 shots | ☐ |
| `storyboard.ts / buildStoryboardPlannerPrompt` | ~2.8k chars sample | Storyboard prompt + cut plan, source brief, preset style/storyboard rules, JSON contract | Reasonable. Output contract is long but earns tokens because storyboard prompt shape matters | Keep, minor trim | ☐ |
| `audioPlan.ts / buildAudioPlanPrompt` | medium-large | One-shot dialogue/audio data, allowed cast, raw source payload, preset audio rules | Good conceptually. Risk: raw source payload capped at 6k even for one tiny shot | Keep, reduce raw source cap or only include relevant source slice | ☐ |
| `seedance-storyboard-rd.ts / buildSeedanceStoryboardVideoPrompt` | outside composer | Final video prompt from storyboard + refs + cut plan | Already trimmed and specific. This is not the current bloat source | Keep | ☐ |
| `catalog.ts` | UI/reference metadata | Prompt library docs, not runtime prompt body | Must stay truthful but does not affect LLM quality | Keep synced | ☐ |

## Worked Examples

These were generated locally from the real builders with `anime_default`.

### Example A — Concept generation

Rendered size: **2,308 chars / ~577 tokens**.

Sections:
`CORE TASK -> CONTEXT -> INPUTS -> TASTE -> USER NOTE POLICY -> OUTPUT CONTRACT`

What the LLM sees first:

```text
Propose creative narrative directions for this project.

Each direction is one coherent idea — what the viewer follows, what visibly happens, the emotional arc, the world the work lives in. Focus on story, beats, and what visibly happens.

Visual style, palette, and cinematography are decided in later phases. Do not include art-style language, camera directions, or color palette in any field — those belong to the style phase, not the concept phase.
```

Intent vs actual:
- Intent: concept only, no style leakage.
- Actual: matches intent. The no-style rule appears in core, preset taste, and output contract. Slight duplication, but acceptable because concept/style separation is a common failure.
- Cut now? No. This prompt is not the vague/bloated culprit.

### Example B — Storyboard planner

Rendered size: **2,799 chars / ~700 tokens**.

Sections:
`CORE TASK -> CONTEXT -> INPUTS -> TASTE -> OUTPUT CONTRACT`

What the LLM sees first:

```text
Plan one storyboard board and cut plan for a two-step storyboard workflow.

The first output, storyboardPrompt, is the prompt that the storyboard image model will read. The second output, cutPlanText, is the matching panel-beat list that the video model will read later. The panel actions must appear in both outputs...
```

Intent vs actual:
- Intent: produce lean storyboard image prompt and matching cut plan.
- Actual: mostly aligned. It explains the two-step workflow because the output feeds two models. The output contract is long, but the shape is fragile enough to justify it.
- Cut now? Minor only. Keep the `under 330 words` rule; it is doing real work.

### Example C — Write shot prompts

Rendered size for one shot: **7,002 chars / ~1,751 tokens**.

Sections:
`CORE TASK -> CONTEXT -> INPUTS -> TASTE -> USER NOTE POLICY -> OUTPUT CONTRACT`

What the LLM sees first:

```text
You are an art director / shot writer. The script writer planned what happens in each shot — you decide how it looks on screen and how it moves. Outputs go directly to an image model (visualPrompt) and a video model (motionPrompt).

WRITE PROMPTS THAT ARE RENDERABLE.

The visual medium is locked separately via the project's style reference image...
```

Intent vs actual:
- Intent: write concise visual and motion prompts for specific shots.
- Actual: the first ~1,000 chars are doctrine before any shot. It includes good/bad examples, anti-poetry guidance, anti-layout guidance, emotion translation guidance, Seedance model lore, plus a large output checklist.
- Why this causes vague output: the prompt spends more time telling the model how not to think than naming the concrete shot. The model may comply with the ceremony while still writing safe generic prompts.
- Cut now? Yes. This is P0 in the composer cleanup.

### Example D — Character look

Rendered size: **1,856 chars / ~464 tokens**.

Sections:
`CORE TASK -> CONTEXT -> INPUTS -> TASTE -> OUTPUT CONTRACT`

What the LLM/image model sees first:

```text
Generate one reusable character or object reference for production continuity.

CONTEXT
This is a scripted narrative project...

INPUTS
Style reference image: Image 1
Extract medium, line, palette, texture, lighting, and finish. Do not copy its subject, layout, background, or crop.
Style intent note: soft luminous anime portrait style with delicate linework
```

Intent vs actual:
- Intent: generate compact reusable character reference, anchored to style image + semantic note.
- Actual: much improved. The prompt is compact and readable.
- Risk: semantic note quality matters. If `styleDescription` is empty, the model only sees "extract style from Image 1." That is sometimes enough, sometimes not. The new `identify_style` action should backfill this text after upload-as-is.

## Failure Modes Found

| Failure mode | Present? | Where | Notes |
|---|---|---|---|
| Too many hedging instructions | Yes | `shotPrompts.ts`, some `storyboard.ts` contract lines | "Avoid X, but don't become Y, but translate Z" piles up |
| Meta-instructions overwhelming task | Yes | `shotPrompts.ts` | Doctrine + examples dominate the prompt before actual shot data |
| Duplicated guidance across sections | Yes | Concept no-style rule, shot renderability rules, anime medium guard | Some duplication is protective; shot prompts crosses the line |
| Verbose context dumps for tiny tasks | Yes | `audioPlan.ts`, `refineScript.ts` by necessity, `shotPrompts.ts` previous tail | Need relevance caps rather than global caps |
| Output contracts describe shape more than content | Yes | `shotPrompts.ts`, `storyboard.ts` | Storyboard earns it more than shot prompts |
| Preset taste blocks overused | Mild | anime image prompts | Need per-surface taste fragments |

## Proposed Cleanup Slice

Do not rewrite every prompt at once. Start where the audit says the pain is.

### C1 — Cut `writeShotPrompts` hard

Target: reduce one-shot sample from ~7,000 chars to **under 3,500 chars** without losing correctness.

Specific cuts:
- Core task: replace long doctrine + examples with 6-8 hard lines.
- Move GOOD/BAD examples into docs/tests, not runtime prompt.
- Keep only one anti-vagueness rule: "Every sentence must name a visible subject, action/change, and spatial or timing anchor."
- Compress Seedance guidance to 5 lines.
- Compress output contract to schema + required content.
- Keep `previousBatchTail`, but cap lower and include only last visual/motion when continuity is likely.

### C2 — Split preset taste by surface

Add helpers instead of stuffing entire preset fields into every prompt:
- `styleMediumGuard(preset, 'short' | 'full')`
- `lookQualityRules(preset)`
- `storyboardTaste(preset)`
- `shotPromptTaste(preset)`

No schema migration needed; this can be helper-level first.

### C3 — Shorten repeated user-note conflict policy

Replace repeated paragraphs like the Polaroid/live-action example with:

```text
If the note conflicts with TASTE or the tool layer, keep the valid intent and translate the invalid medium/layer request into the closest safe analogue.
```

Keep concrete examples in tests/docs, not every runtime prompt.

### C4 — Backfill style semantics after upload-as-is

Use the new `identify_style` action when locked style has an image but empty/weak `styleDescription`. This keeps character/environment prompts compact while giving image models a semantic style anchor.

## Priority Verdict

P0: `server/prompts/shotPrompts.ts`

P1: compressed anime medium/taste helpers for image prompts

P2: repeated user-note-policy copy

P3: `audioPlan.ts` source payload cap

Everything else can wait until after the full deployed smoke test. The composer architecture is sound; the cleanup is token discipline, not a ground-up redesign.
