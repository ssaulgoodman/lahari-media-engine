> Archived 2026-06-13. Current prompt/tool doctrine lives in `docs/mirage-platform-v1-ledger.md`, `docs/codex-native-doctrine.md`, `docs/mirage-tool-reference.md`, and `docs/mirage-workflow-recipes.md`.

# Preset Prompt Abstraction Ledger

Working ledger for scrubbing the Lahari-shaped prompt stack into a clean preset/workflow platform. This is the task list to keep future agents aligned while the abstraction is implemented.

## Strategy

Do not build a completely separate prompt catalog per preset, and do not flatten every prompt into one generic template with a few nouns swapped in.

Use three layers:

1. **Core engine contract** - output shape, reference discipline, renderability rules, continuity rules, panel ordering, no text/watermark rules, apply-tool validation.
2. **Workflow context** - what the project starts from and how timing is understood. Music video uses audio, lyrics, musical structure, and rhythm. Anime uses script beats, acting, dialogue/action timing, and continuity. Ads/reels later get their own context.
3. **Preset taste** - model defaults, tool name, style bible, look rules, shot/storyboard/video prompt rules, examples, and negative constraints.

The runtime code should resolve the preset from the project row first (`project.preset_key`), with request-body override only as a compatibility escape hatch.

## Current Audit

### Looks

Files:
- `server/routes/generate-looks.ts`
- `server/services/imagen.ts`
- `server/services/segmind-image.ts`
- `server/services/openai-image.ts`

Core is good: reusable character/environment references, neutral character pose, full environment reference, style ref as ground truth, no text/watermarks.

Status:
- Done: route prompts resolve project preset first.
- Done: service fallbacks accept/pass preset when building style/character/environment prompts.
- Done: obvious deity-shaped identity vocabulary was replaced with generic reusable-reference language.
- Remaining: deeper image-frame generation prompts still have old generic quality negatives that should eventually move fully into presets.

### Visualize Style

Files:
- `server/routes/generate-style.ts`
- `server/services/imagen.ts`
- `server/services/segmind-image.ts`
- `server/services/openai-image.ts`

Best existing pattern: `buildStylePrompt(styleDescription, subject, preset)` already composes core style-reference instructions with preset `style.subjectPrompt` and preset quality/taste rules.

Status:
- Done: style brainstorm/visualize/refine resolves project preset first.
- Done: fallback image services accept preset for single style image generation.
- Remaining: old `generate-styles` option-grid path still needs preset-aware style option generation or deprecation behind the newer brainstorm/visualize path.

### Storyboard Prompt Writing And Cut Plan

Files:
- `server/services/storyboard.ts`
- `server/services/seedance-storyboard-rd.ts`

Core is good: short image-native board prompt, per-panel action descriptions inline, no panel labels/text/arrows, inter-panel consistency, JSON output with `storyboardPrompt` and `cutPlanText`.

Status:
- Done: hardcoded devotional planner identity removed.
- Done: project preset is passed into `StoryboardRdInput`.
- Done: default concept fallback is neutral.
- Done: cut plan remains the shared `Panel N — <action>` format.
- Remaining: add anime-specific examples once the first anime golden path exists.

### Seedance Storyboard / Video Prompting

Files:
- `server/services/seedance-storyboard-rd.ts`
- `server/services/videoGeneration.ts`

Core is close: follows @image1 board, preserves locked refs, uses `preset.toolName` and `preset.studio.videoPromptRules` in important places.

Status:
- Done: context labels switch by workflow (`Song`/lyrics for music video, `Project`/source excerpt for scripted work).
- Done: default devotional mood removed from Seedance context.
- Done: script clip planner now switches beat-cue language by workflow.
- Done: video override label is neutral.
- Remaining: replace legacy default motion prompt `"Cinematic camera movement"` across route/status surfaces.

### Concept / Script / Shot Prompt Writing

Files:
- `server/services/claude.ts`
- `server/services/openai-script.ts`
- `server/prompts/catalog.ts`

Highest-risk remaining Lahari leak.

Status:
- Done: concept generation/refine requires `subject`, with `deity` only as a legacy-compatible optional alias.
- Done: Claude/OpenAI script planner prompt language is generic and preset-driven.
- Done: Claude/OpenAI shot-prompt writers keep core renderability rules and inject preset shot rules without devotional examples.
- Done: prompt catalog is explicitly marked legacy/internal.
- Remaining: fully regenerate/sync `server/prompts/catalog.ts` from runtime builders before exposing a public Prompt Library.

## Implementation Order

1. Done: Resolve project preset centrally and thread it through style, looks, storyboard, and video paths.
2. Done: Scrub storyboard planner and Seedance context labels so project preset/workflow controls the identity and source framing.
3. Done: Split `writeShotPrompts` into core renderability rules plus workflow/preset blocks.
4. Done: Replace concept `deity` contract with generic subject fields while preserving legacy reads.
5. Guarded: `server/prompts/catalog.ts` is quarantined as legacy/internal until fully synced.
6. Next: Prove two golden paths: music video from audio, anime from script/notebook apply.
