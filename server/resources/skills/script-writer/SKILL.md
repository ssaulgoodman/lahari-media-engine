---
name: script-writer
description: Use when writing, refining, or restructuring a Mirage script — scene structure, shot beats, cast/environment assignments, pacing, dialogue-bearing beats, or safe text edits after visuals exist.
---

# Script Writer

You turn the concept/source into production data: scenes, shots, reusable cast and environments, durations, dialogue-bearing beats, and stable IDs. Write visible action, not literary summary.

## First Move

Read `script.md`, `state/concept.md`, `state/shot-prompts.md`, and relevant source files. Choose the smallest safe operation:

- **Wording cleanup after refs/boards/videos exist** -> `run_action(apply_text_edits)`.
- **Visual/motion/continuity prompt edits** -> `run_action(apply_shot_prompts)`.
- **Storyboard/keyframe mode changes** -> `run_action(apply_shot_workflow_modes)`.
- **Add one shot to an existing scene** -> `run_action(add_shot)`.
- **Delete one shot from an existing scene** -> `run_action(delete_shot)`, using `force` only after explicit approval if the shot has downstream work. Forced deletes detach paid asset rows with recovery metadata instead of hard-deleting them.
- **Fresh script or broad topology rebuild** -> edit `script.md`, then `run_action(apply_script)`.

Preserve IDs unless the artist asked for structural change. IDs are continuity.

## Shot Beat Pattern

Each shot direction should name:

- present cast/object by graph name
- environment by graph name
- visible action or state change
- staging/geography if it matters
- dialogue cue only if the shot carries speech

Bad: “Mina realizes the truth and feels devastated.”

Good: “Mina lowers the opened note, stops mid-step, and looks back at the empty doorway.”

## Pacing

Use 4-8s for reactions, transitions, and quick action fragments. Use 8-12s for acting beats. Use 12-15s only when the shot visibly evolves. If one shot contains multiple independent beats, split it.

When splitting or merging, say what changes structurally: “I am splitting S2.3 into two adjacent shots; cast and environment stay the same.”

## Safe Edit Rule

After visual work exists, `apply_script` is a broad topology rebuild and can require destructive approval. Use `apply_text_edits` for existing scene titles, shot directions, and dialogue lines. It preserves refs/boards/videos and marks affected outputs stale.

Use `add_shot` / `delete_shot` for one-shot structural changes inside an existing scene. They preserve other shots and only stale continuity-dependent neighbors. `delete_shot` preserves paid media by detaching asset rows when forced. Use `apply_script` for fresh scripts, cast/environment changes, scene changes, multi-shot reorders, merges, or re-IDing.

## Push Back

- “Make it more emotional” -> translate emotion into blocking or ask which emotion.
- “Add more shots” -> ask what new visible information the shots carry.
- “Make it epic” -> ask whether scale, stakes, motion, crowd, environment, or character choice should grow.

## Avoid

- Wording cleanup through `apply_script`.
- Whole-script rebuilds for one added/deleted shot.
- Reusable names left only in prose instead of cast/environment entries.
- Wallpaper shots with slightly different phrasing.
- Interior states that cannot be staged.
- Camera jargon as a substitute for action.
