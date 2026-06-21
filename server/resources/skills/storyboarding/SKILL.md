---
name: storyboarding
description: Use when writing, generating, repairing, or importing Mirage storyboards. Covers multi-panel board prompts, cut plans, reference-aware staging, context fixes, image refine, native image import, and cross-shot coherence.
---

# Storyboarding

You write multi-panel storyboard prompts for one Mirage shot. A board is a visual plan for video generation: blocking, geography, character positions, and action beats.

Mirage renders the prompt with locked style, character, and environment references. Use exact project names for those references; Mirage binds those names to the attached images at render time. Describe what happens in the shot; only add appearance/style detail when correcting a specific failure.

## First Move

Start with `get_shot_context(projectId, shotId)` when available. It shows the shot direction, assigned cast/environment, locked refs, current board state, latest storyboard render payload summary, video payload summary, and exact edit paths without loading full prompt bodies. If no draft exists, write from the shot. If fixing a generated board, read the current board state and the relevant payload summary before guessing; use `run_action(generate_storyboard, { dryRun: true })` to preview the exact next storyboard render payload before spending, and use `describe_prompt({ kind: "storyboard_render" })` only when you need exact text from an already-generated board.

## Prompt Pattern

1. **Layout:** choose a 2×2, 2×3, or 3×3 grid. Use 2×2 (4 panels) for most shots, 2×3 (6 panels) for a longer beat, and 3×3 (9 panels) only for dense action. Use 16:9 panels, thin borders, generous gaps, and a pure white paper background. Panels read left-to-right, top-to-bottom.
2. **Setup:** one sentence naming the location and present characters by project name.
3. **Panels:** one clear action moment per panel. Format: `Panel 1: <framing/staging> — <visible action>`.
4. **Continuity:** one sentence naming what must stay consistent: positions, screen direction, light, prop placement, doorway, or room geography.
5. **No text:** end with no captions, numbers, labels, arrows, speech bubbles, subtitles, readable text, logos, or watermarks.

Canonical Mirage storyboards are black-and-white sketch planning sheets, not final production art. Ask for strict black ink/pencil linework on pure white paper, optional gray shading only, and no color or final-render texture. Locked references still matter, but the renderer converts them into sketch guidance for identity, geography, and composition. Final video style comes later from the locked style/cast/environment refs.

Keep the prompt under ~220 words. Make the board easy to understand at a glance: clear staging, visible action, readable positions, and sensible geography.

Example:

> A 2×2 grid of four 16:9 storyboard panels on pure white paper, thin black borders, read left-to-right then top-to-bottom. Strictly black-and-white pen-and-pencil sketch style with optional gray shading only.
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

## HF / Sketch Planning

HF/Supercomputer-style sketch planning is now the canonical Mirage storyboard technique. The default storyboard renderer enforces black-and-white sketch boards, and GPT Image 2 is the default storyboard provider. For music-led projects, use `run_action(list_workflows)` and `run_action(apply_project_workflow, { name: "hf_music_video" })` when the artist wants the full HF music-video workflow: it adds music-section/video recipe defaults on top of the same sketch-board base. If the artist explicitly wants storyboards rendered in the same final style as the video, treat that as a deliberate override, not the default.

## Check The Board

Before locking, check whether the board actually stages the shot:

- each panel shows a distinct moment
- action progresses logically from panel to panel
- character positions and room geography make sense
- adjacent shots preserve screen direction and handoff state
- framing varies enough that the scene does not become repeated centered portraits

## Repair Ladder

1. **Written beat is wrong** → edit `storyboards/<scene>.md`, then `run_action(apply_storyboard_prompts)`. Free.
2. **No board exists yet** → `run_action(generate_storyboard, { dryRun: true })` to inspect the exact prompt/refs, then `start_job(generate_storyboard)` after approval; lock after review.
3. **The board premise is wrong** → fix the saved prompt first with `apply_storyboard_prompts`, then regenerate after approval.
4. **Board is close, one visual detail is wrong** → `start_job(refine_storyboard_image)` with a narrow edit instruction.
5. **Wrong refs/context are attached** → dry-run with `contextOverrides` to exclude/swap refs, style image, or previous-board context; generate only after the payload shows the intended refs.
6. **Native or artist image is better** → upload with `purpose=storyboard_image`, then `run_action(import_storyboard_image)`.
7. **A repeatable phrasing works** → promote it with `apply_project_style_notes` in the storyboard bucket or a project prompt override.

## Native Image Workers

Use a Codex/Claude native subagent or background worker named `Image Repair Worker` when a board/keyframe needs precise imagegen repair and the iteration would bloat the main director context. The worker is a harness-native helper, not a Mirage actor.

Use the native-worker packet/receipt contract from `docs/agent-working-method.md`. For storyboard work, the packet should include the target shot, current board/keyframe image, exact repair, preserve constraints, allowed tool (`imagegen` or local inspection), and the intended import path. The worker should not call paid Mirage jobs, lock/unlock, edit project text, or write Supabase state.

The receipt must say whether the result is import-ready and include the final image path, prompt used, changes made, caveats, and suggested Mirage action. The main director then shows the result if needed, uploads it with `purpose=storyboard_image` or `purpose=keyframe_image`, and calls `import_storyboard_image` or `import_keyframe_image`. Lock only after artist approval or when the instruction explicitly allowed locking.

After any storyboard `start_job`, return the job id and keep working unless the artist explicitly asks you to watch or poll. Studio realtime is the default progress surface; use `get_job` for deliberate checks/watch mode, not habit loops.

Keep `gpt-image-2` as the storyboard provider unless the artist explicitly asks to test another model or GPT Image 2 fails repeatedly with a clear provider-specific issue.

## Avoid

- 3-panel boards or any layout other than 2×2, 2×3, or 3×3.
- Visible panel numbers, labels, captions, arrows, speech bubbles, subtitles, readable text, logos, or watermarks.
- Rewriting faces, outfits, environments, or style when locked references already carry them.
- Vague mood/style language without visible staging.
- Overpacking one board; use 9 panels only when the action genuinely needs it.
