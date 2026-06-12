---
name: storyboarding
description: Use when writing, generating, repairing, or importing Mirage storyboards. Covers multi-panel board prompts, cut plans, reference-aware staging, context fixes, image refine, native image import, and cross-shot coherence.
---

# Storyboarding

You write multi-panel storyboard prompts for one Mirage shot. A board is a visual plan for video generation: blocking, geography, character positions, and action beats.

Mirage renders the prompt with locked style, character, and environment references. Use exact project names for those references; Mirage binds those names to the attached images at render time. Describe what happens in the shot; only add appearance/style detail when correcting a specific failure.

## First Move

Read the shot direction, assigned cast/environment, locked refs, and adjacent shots. If no draft exists, write from the shot. If fixing a generated board, read the current board state and the relevant generation trace before guessing.

## Prompt Pattern

1. **Layout:** choose a 2×2, 2×3, or 3×3 grid. Use 2×2 (4 panels) for most shots, 2×3 (6 panels) for a longer beat, and 3×3 (9 panels) only for dense action. Use 16:9 panels, thin borders, and a neutral background. Panels read left-to-right, top-to-bottom.
2. **Setup:** one sentence naming the location and present characters by project name.
3. **Panels:** one clear action moment per panel. Format: `Panel 1: <framing/staging> — <visible action>`.
4. **Continuity:** one sentence naming what must stay consistent: positions, screen direction, light, prop placement, doorway, or room geography.
5. **No text:** end with no captions, numbers, labels, arrows, speech bubbles, subtitles, readable text, logos, or watermarks.

Style wording should come from the locked style reference. Use at most one short style phrase when it helps the image model read the board; do not invent a separate genre, palette, lighting scheme, or finish that could fight the reference.

Keep the prompt under ~220 words. Make the board easy to understand at a glance: clear staging, visible action, readable positions, and sensible geography.

Example:

> A 2×2 grid of four 16:9 storyboard panels, thin borders, read left-to-right then top-to-bottom.
> Setup: The Boss enters the Red Den Room; The Knife Orchid is already seated.
> Panel 1: wide doorway view — The Boss stops at the threshold, one hand on the frame.
> Panel 2: medium over his shoulder — The Knife Orchid stays seated, watching without turning.
> Panel 3: close on The Boss — his eyes find the empty desk.
> Panel 4: wide reverse — he crosses toward the desk; she has not moved.
> The doorway, desk, and seated position stay consistent across all panels.
> No captions, numbers, labels, arrows, speech bubbles, subtitles, readable text, logos, or watermarks.

## Cut Plan

The cut plan guides video motion after the board exists. Use the same beats, one line per panel:

`Panel 1 — slow lean into the doorway, breath held`

It can be empty when the board order is enough.

## HF Music Planning

When the artist asks for HF/Supercomputer-style music-video planning, do not make that the global storyboard style. Use `run_action(list_workflows)` and `run_action(apply_project_workflow, { name: "hf_music_video" })` first. That recipe makes storyboard boards black-and-white sketch planning sheets: pure white paper, ink/pencil, no color, no labels, no captions. Panels should map to song beats, lyric sections, camera moments, or choreography rather than final-render beauty frames. The final video style still comes from locked style/cast/environment refs.

## Check The Board

Before locking, check whether the board actually stages the shot:

- each panel shows a distinct moment
- action progresses logically from panel to panel
- character positions and room geography make sense
- adjacent shots preserve screen direction and handoff state
- framing varies enough that the scene does not become repeated centered portraits

## Repair Ladder

1. **Written beat is wrong** → edit `storyboards/<scene>.md`, then `run_action(apply_storyboard_prompts)`. Free.
2. **No board exists yet** → `start_job(generate_storyboard)` after approval; lock after review.
3. **The board premise is wrong** → fix the saved prompt first with `apply_storyboard_prompts`, then regenerate after approval.
4. **Board is close, one visual detail is wrong** → `start_job(refine_storyboard_image)` with a narrow edit instruction.
5. **Wrong refs/context are attached** → regenerate with `contextOverrides` to exclude/swap refs, style image, or previous-board context.
6. **Native or artist image is better** → upload with `purpose=storyboard_image`, then `run_action(import_storyboard_image)`.
7. **A repeatable phrasing works** → promote it with `apply_project_style_notes` in the storyboard bucket or a project prompt override.

Switch storyboard provider only after the prompt and attached context are sound and the same failure repeats.

## Avoid

- 3-panel boards or any layout other than 2×2, 2×3, or 3×3.
- Visible panel numbers, labels, captions, arrows, speech bubbles, subtitles, readable text, logos, or watermarks.
- Rewriting faces, outfits, environments, or style when locked references already carry them.
- Vague mood/style language without visible staging.
- Overpacking one board; use 9 panels only when the action genuinely needs it.
