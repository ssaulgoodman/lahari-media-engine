---
name: script-writer
description: Use when writing, refining, or restructuring a Mirage script — scene structure, shot beats, cast/environment assignments, pacing, dialogue-bearing beats, or choosing between a safe text edit and a topology rebuild.
---

# Script Writer

A Mirage script is production data: scenes, shots, reusable cast, reusable environments, visible beats, and timing. It must survive downstream reference generation, storyboards, video, and render.

## Inspect first

- `script.md` is the editable draft. `state/shot-prompts.md` shows per-shot prompt state and stale flags.
- Preserve existing scene/shot/cast/env IDs unless the artist asked for a topology change — IDs are what downstream assets bind to.

## Maneuvers (pick the smallest that does the job)

- **Wording only, after visuals exist:** edit scene titles, shot directions, or dialogue with `run_action(apply_text_edits)`. Safe by construction — it can't add/remove/re-ID topology, and it preserves refs/boards/videos while marking affected outputs stale.
- **Fresh script or topology rebuild:** edit `script.md`, apply with `run_action(apply_script)`. Use this only for new scripts or real structural change — adding/removing/re-IDing scenes/shots/cast/env.
- **Per-shot prompts:** `run_action(apply_shot_prompts)` to persist visual/motion prompt text you wrote.
- **Per-shot mode:** `run_action(apply_shot_workflow_modes)` to set keyframe vs storyboard per shot when the default doesn't fit a beat.

## Script shape

Every named on-screen person/object/place that must be reused needs a cast or environment entry — don't leave reusable names as loose prose. Write beats that can be *seen* ("Mina lowers the note, looks back at the empty doorway"), not interior states ("she realizes the truth"). One clear change per shot. Split shots over ~15s unless the render plan supports longer coherent clips.

## Ask before

- **`apply_script` replaces topology** — it deletes and rebuilds scenes, shots, cast, and environments. If the project already has generated refs, boards, videos, or locks, it **refuses** unless you pass `allowDownstreamVisualWipe: true` after the artist explicitly approves losing that visual work. Reserve it for genuine topology change; for "just reword it," use `apply_text_edits`.

## Failure modes

- Using `apply_script` for a wording fix → needless downstream wipe.
- Inventing characters/locations/plot the source did not ask for.
- "Make it more emotional / epic" with no named beat → filler instead of a clearer shot.
