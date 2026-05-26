# Mirage Composer Audit

Date: 2026-05-26
Branch: `mirage`
Purpose: inspect the prompt composer, preset taste additives, and runtime prompt builders for vague or bloated instruction layers before the next deployed agent smoke test.
Status: merged — Codex's table-structured analysis (`8fbf4a4`) + Claude's Pattern 7 finding and architectural proposal.

> **Read this audit through `docs/mirage-composer-architecture.md`.** The latest direction is graph-first: presets/workflows are intake hints, the composer is editable plumbing, and `contextOverrides` are a first-class missing primitive. Verdicts in this audit that pre-date that decision are marked **⚠️ provisional** below. A full row-by-row re-verdict happens after the open calls in the architecture doc settle.

## Executive Read

The composer shape is mostly right. The bloat is not coming from `composePrompt()` itself; it is coming from a few contributors using the composer as a dumping ground for doctrine, examples, model lore, and output schema all at once.

**Four findings:**

1. **`writeShotPrompts` is the clear offender.** A one-shot anime prompt renders at about **7,002 chars / ~1,751 tokens** before the model sees one real shot. It repeats the same anti-vagueness idea in core task, model guidance, preset taste, and output contract. This is the likely source of "vague but long" shot/video downstream behavior.

2. **Preset taste is earning its place, but** `anime_default.style.rules` and `anime_default.looks.qualityRules` are reused across style, character, environment, storyboard, and image prompts. Useful for medium guard, but should be compressed into smaller per-surface rules instead of carrying the full anti-photoreal doctrine everywhere.

3. **Output contracts are doing too much prose.** Several contracts explain the system rather than simply state the response shape and hard constraints. We should separate "what to return" from "why this layer exists."

4. **Project prompt overrides are half-wired.** The `apply_project_prompt_override` schema declares 8 override kinds but only 2 (`storyboard`, `video`) are actually consumed by any prompt builder. The other 6 are dead text in the database. The skill instruction we ship ("promote a repeated promptOverride") is currently truthful for only 2 of 8 surfaces. **See Pattern 7 / Cleanup C5.**

## Pattern 7 — Half-Wired DB Overrides

This is the finding that landed via grep of `getProjectPromptOverride` consumption sites. Surfaced after Codex's initial audit was committed.

### What's declared vs what's consumed

The `apply_project_prompt_override` schema accepts 8 kinds. Only 2 flow back into prompts:

| Override kind | Schema accepts | Stored in DB | Consumed by prompt builder? |
|---|---|---|---|
| `storyboard` | ✅ | ✅ | ✅ (appended to presetTaste in storyboard.ts) |
| `video` | ✅ | ✅ | ✅ (read in videoGeneration.ts) |
| `concept` | ✅ | ✅ | ❌ never consumed |
| `script` | ✅ | ✅ | ❌ never consumed |
| `shot_prompts` | ✅ | ✅ | ❌ never consumed |
| `character_looks` | ✅ | ✅ | ❌ never consumed |
| `environment_looks` | ✅ | ✅ | ❌ never consumed |
| `audio_plan` | ✅ | ✅ | ❌ never consumed |

The skill we shipped ("if the same per-call promptOverride keeps working, suggest promoting it with apply_project_prompt_override") currently does nothing for the bottom six. Agent stores them. No prompt builder reads them.

### What this changes about the composer

Today, the composer has no concept of "project override." Each prompt builder ad-hoc decides where to fold the override string in. Storyboard appends to `presetTaste`. Video reads it elsewhere. The other six don't read it at all. This is inconsistent AND incomplete.

### Two options

**Option A: Wire all 8 properly.** Composer gets a new `projectOverride?: string` field (slots between presetTaste and userNotePolicy). Every prompt builder calls `getProjectPromptOverride(projectId, kind)` and passes it in. Honest version of the feature. Skill instruction becomes truthful for every surface.

**Option B: Narrow the schema to what works.** Reduce `promptOverrideKindSchema` enum to just `storyboard` + `video`. Apply tool throws for the other six. Skill instruction qualified to "only for storyboard and video."

**Claude's vote:** Option A. The skill already teaches the promotion pattern. If only 2 of 8 promotions persist, the agent learns a half-true rule. Either commit to the feature or shrink the API to honest size. | ☐ Saul's call

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
| **NEW: `projectOverride`** | DB-stored per-project override body for this kind | Lets artist taste persist across calls per Pattern 7 | Currently fictional for 6 of 8 surfaces | **Add as first-class composer section** (between presetTaste and userNotePolicy) | ☐ |
| `inspectComposedPrompt` | Reverse parser for X-Ray | Debug transparency | Yes as debug-only | Keep; edge case noted: exact header lines inside user text can mis-split | ☐ |

## Preset Additives

> **⚠️ All "Keep" verdicts below are provisional.** They were written under the old assumption that presets keep injecting taste into prompts at runtime. Under the graph-first architecture, most of these get **relocated**, not kept: text-prompt taste flows from `project.styleDescription`; image-prompt invariants move to action handler constants; the rest go away. Re-verdict pass scheduled after C0/C2 land.

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
| `concept.ts / buildGenerateConceptPrompt` | ~2.3k chars | Concept task, source, preset concept rules, user-note policy, JSON contract | Healthy length. Some duplicate "no style/camera/palette" appears in core + preset + contract, but it protects layer separation. Missing `projectOverride` consumption per Pattern 7 | Keep, minor trim later; add override read | ☐ |
| `concept.ts / buildRefineConceptPrompt` | medium | Surgical refinement contract | Good. Could shorten user-note policy | Keep | ☐ |
| `styleBrainstorm.ts` | medium | 4 directions, range, medium guard, user-note hard constraint | Good. Polaroid example is useful once, not in every style/refine prompt | Keep, compress repeated conflict example | ☐ |
| `refineStyle.ts` | medium | Surgical style refine | Good but repeats same medium-conflict paragraph | Keep, share shorter policy | ☐ |
| `visualizeStyle.ts` | image prompt | Style image generation, style direction, preset taste + quality rules | Mostly good. May carry too much anime anti-photoreal doctrine for simple style image | Keep, use short image taste | ☐ |
| `lookPrompts.ts / buildCharacterLookPrompt` | ~1.8k chars | Style ref extraction, entity description, preset style + character + quality rules | Much better than old long character prompt. Main risk: "Extract style" not strong enough for known artist-style references without semantic note. Missing `projectOverride` per Pattern 7 | Keep; improve style-intent note generation separately; add override read | ☐ |
| `lookPrompts.ts / buildEnvironmentLookPrompt` | similar | Env ref generation | Good. Missing `projectOverride` per Pattern 7 | Keep; add override read | ☐ |
| `parseScript.ts` | medium | Script extraction, preset script rules, JSON/tool contract | Good, practical | Keep | ☐ |
| `planScenes.ts` | medium-large | Music-led planner, pacing, source signals, cast/env/shot rules | Only for music-led, so title/core okay. Do not reuse for scripted narrative. Missing `projectOverride` per Pattern 7 | Keep; add override read | ☐ |
| `refineScript.ts` | large | Full current script JSON, surgical policy, pacing, rules | Large but expected. Risk: output contract says `plan_music_video` even when generic surfaces call it. Missing `projectOverride` per Pattern 7 | Keep for now; rename tool text later; add override read | ☐ |
| `shotPrompts.ts / buildWriteShotPromptsPrompt` | **~7.0k chars** | Art direction doctrine, examples, model guidance, cast, previous tail, all shots, output contract | **Main bloat offender.** Too much meta-instruction before actual shots. Duplicates renderable guidance across core, examples, model guidance, contract. Missing `projectOverride` per Pattern 7 | **Cut hard. Target <3.5k for 1-3 shots.** Add override read | ☐ |
| `storyboard.ts / buildStoryboardPlannerPrompt` | ~2.8k chars | Storyboard prompt + cut plan, source brief, preset style/storyboard rules, JSON contract | Reasonable. Output contract long but earns tokens because storyboard prompt shape matters. `projectOverride` consumption already in place ✅ | Keep, minor trim | ☐ |
| `audioPlan.ts / buildAudioPlanPrompt` | medium-large | One-shot dialogue/audio data, allowed cast, raw source payload, preset audio rules | Good conceptually. Risk: raw source payload capped at 6k even for one tiny shot. Missing `projectOverride` per Pattern 7 | Keep, reduce raw source cap or include only relevant source slice; add override read | ☐ |
| `seedance-storyboard-rd.ts / buildSeedanceStoryboardVideoPrompt` | outside composer | Final video prompt from storyboard + refs + cut plan | Already trimmed and specific. `projectOverride` consumption already in place ✅ | Keep | ☐ |
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
| User-note policy restated per-file | Yes | concept, shotPrompts, storyboard, refineScript, refineStyle | 80% same text; should be one shared constant in `_shared.ts` |
| **Override mechanism half-wired (Pattern 7)** | **Yes** | **6 of 8 declared kinds never consumed** | **DB stores them; no builder reads them. Skill instruction is half-truth.** |

## Proposed Cleanup Slice

Do not rewrite every prompt at once. Start where the audit says the pain is.

Architecture-step crossrefs (per `mirage-composer-architecture.md` 7-step migration):
- **C0** = architecture step 1 (establish `ContextOverride` contract)
- **C5** = architecture step 2 (fix project overrides)
- **C1** = architecture step 3 (cut `writeShotPrompts`)
- **C2** = architecture steps 4-6 (remove preset doctrine from text prompts, move invariants to actions, shrink presets)
- **C3** = part of architecture step 4 (user-note policy goes with text-prompt doctrine cleanup)
- **C4** = supports the graph-first taste anchor (project.styleDescription backfill)

### C0 — Establish `ContextOverride` primitive (architecture step 1)

The audit was framed before `contextOverrides` was identified as the missing primitive. It's a prerequisite for the rest:

- Add a shared `ContextOverride` type. Fields: `includeStyleImage`, `styleAssetId`, `includeCastRefs`, `excludeCastRefs`, `includeEnvironmentRefs`, `excludeEnvironmentRefs`, `includeAudioAnalysis`, `includeSoundtrack`, `includeSourceScript`, `includeProjectStyleDescription`.
- Action specs for looks, style, storyboard, video declare which fields apply to them.
- Composer respects the include/exclude flags at assembly time.
- X-Ray trace shows what was included/excluded per call so the composer is debuggable as plumbing.

Without this, the trim work in C1-C5 can only remove text — not give Codex per-call control over which context attaches. C0 unlocks "make character without the locked style image for one experiment" and "use uploaded audio as soundtrack only, skip music-structure analysis."

### C1 — Cut `writeShotPrompts` hard (architecture step 3)

Target: reduce one-shot sample from ~7,000 chars to **under 3,500 chars** without losing correctness.

Specific cuts:
- Core task: replace long doctrine + examples with 6-8 hard lines.
- Move GOOD/BAD examples into docs/tests, not runtime prompt.
- Keep only one anti-vagueness rule: "Every sentence must name a visible subject, action/change, and spatial or timing anchor."
- Compress Seedance guidance to 5 lines.
- Compress output contract to schema + required content.
- Keep `previousBatchTail`, but cap lower and include only last visual/motion when continuity is likely.

### C2 — Relocate preset taste out of runtime prompts (architecture steps 4-6)

Original framing was "split by surface," but the graph-first architecture changes the answer: don't split, **relocate**.

Three destinations for what's in `preset.*.rules` today:

- **Text-prompt taste** → moves to `project.styleDescription` (the runtime taste anchor). No injection of preset doctrine into concept/script/shot-prompt/audio-plan calls. Codex carries taste in its reasoning; the project carries taste as data.
- **Image-prompt invariants** ("no text in panels", "neutral character pose", "no watermark") → moves to action handler constants. These are worker contracts, not workflow taste.
- **Common-knowledge restatements** ("anime is hand-illustrated", "music videos can be mixed media") → dropped entirely. Text models already know.

After C2, `PIPELINE_PRESETS` shrinks to intake suggestions + default model/provider config + optional starter style description text. No `*.rules` fields injected at runtime.

Helper-level only first — no schema migration. Action handlers absorb their constants; preset .ts files shrink; composer stops reading `preset.*.rules`.

### C3 — Shorten repeated user-note conflict policy

Replace repeated paragraphs like the Polaroid/live-action example with one shared constant in `_shared.ts`:

```text
If the note conflicts with TASTE or the tool layer, keep the valid intent and translate the invalid medium/layer request into the closest safe analogue.
```

Per-file override only when there's a genuinely domain-specific tail. Keep concrete examples in tests/docs, not every runtime prompt.

### C4 — Backfill style semantics after upload-as-is

Use the new `identify_style` action when locked style has an image but empty/weak `styleDescription`. This keeps character/environment prompts compact while giving image models a semantic style anchor.

### C5 — Wire project overrides as a first-class composer section (architecture step 2 / Pattern 7 fix)

**This is the architectural one.** Today each prompt builder ad-hoc decides where to inject the override. 6 of 8 declared kinds aren't injected anywhere. Fix:

1. Add `projectOverride?: string` to `ComposePromptParts` in `_composer.ts`. New section title `PROJECT OVERRIDE`. Slots between `presetTaste` and `userNotePolicy`.
2. Every prompt builder calls `getProjectPromptOverride(projectId, kind)` and passes the result in.
3. Storyboard's current "append to presetTaste" pattern moves to the new section instead. Behavior unchanged for storyboard; new behavior available for the other 6.
4. Skill instruction ("promote a repeated promptOverride") becomes truthful across all surfaces.

Alternative (smaller scope, dishonest API): Option B — narrow schema to just `storyboard` + `video`. Saves implementation work; kills the agentic promotion pattern as a generalization. Codex's audit assumed the current ad-hoc shape; this audit revisits.

## Priority Verdict

- **P0:** `ContextOverride` primitive (C0) — prerequisite for the rest; unlocks per-call context control
- **P0:** `shotPrompts.ts` trim (C1) — biggest single win, biggest source of vague output
- **P1:** Project overrides wired into composer (C5) — architecture step 2
- **P1:** Preset taste relocation (C2) — architecture steps 4-6
- **P2:** User-note policy collapse (C3)
- **P3:** Style description backfill (C4)

Everything else can wait until after the full deployed smoke test.

## Open Questions for Saul

The audit reaches conclusions on most rows. These are the calls that need your verdict:

1. **Pattern 7 — Option A or Option B?**
   - A: Wire all 8 override kinds properly (one slice; honest API; ~half-day of prompt-builder edits).
   - B: Narrow schema to just `storyboard` + `video` (smaller scope; kill the agentic promotion pattern as a general capability).
   - Claude vote: A. Codex's audit was pre-Pattern-7 so no opinion.

2. **WorkflowContext — Codex says "keep but drop from image-gen prompts"; Claude initially voted kill entirely.** Real cost is ~30 tokens per call. Codex's middle ground is defensible. Acceptable to defer to Codex's call here.

3. **Examples in CORE_TASK** — `shotPrompts.ts` has GOOD/BAD examples. C1 proposes moving them to docs/tests, not runtime prompt. Risk: GOOD/BAD examples may be the single most useful anchor for non-vague output. If we strip them, the cuts might over-correct toward terse and lose the show-don't-tell anchor.
   - Claude vote: keep ONE GOOD/BAD pair in CORE_TASK. Move the others to docs.

4. **One canonical USER_NOTE_POLICY** — C3 proposes one shared constant. Per-file override allowed for genuinely domain-specific tails. Agree?

5. **Slice ordering** — C1 first (P0) is obvious. After that, the question is: C5 (override wiring, finishes a half-built feature) vs C2 (preset taste helpers, more mechanical). Claude leans C5 next because Pattern 7 affects the agentic skill we already shipped.

6. **OUTPUT CONTRACT vs OUTPUT QUALITY split** — separating "JSON shape required" from "content quality rules"? Claude proposes splitting; Codex's analysis keeps them combined under OUTPUT CONTRACT. Worth deciding.

7. **Trim aggressively now or conservative + iterate?** Codex's C1 target ("under 3,500 chars for 1-3 shots") is aggressive — 50% reduction. Safer would be a 25% first cut then re-measure. Aggressive saves a deploy cycle; conservative protects against tripping unknown dependencies.

## Notes on this merge

Codex's audit (`8fbf4a4`) was the table-structured backbone. Claude's draft added:
- Pattern 7 (half-wired DB overrides) — only finding genuinely new
- C5 cleanup slice (wire overrides into composer)
- New row in Composer Sections table for `projectOverride`
- New row in Failure Modes table for "Override mechanism half-wired"
- Updated Prompt File Audit rows to flag where `projectOverride` consumption is missing
- Open Questions block for Saul's verdict on contested decisions

Where Codex and Claude differed, Codex's call took precedence by default since their analysis was more thorough on the per-row classification. Where Claude found something Codex didn't (Pattern 7), it was added as a new finding. The open-questions block is where the contested decisions live for Saul to arbitrate.
