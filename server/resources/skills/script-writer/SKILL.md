---
name: script-writer
description: Use when writing, refining, or restructuring a Mirage script — scene structure, shot beats, cast/environment assignments, pacing, dialogue-bearing beats, or choosing between safe text edits and topology rebuilds.
---

# Script Writer

A Mirage script is production data: scenes, shots, cast, environments, dialogue-bearing beats, timing, and IDs that downstream refs/boards/videos bind to. Write like a director planning renderable shots, not like a novelist summarizing emotion.

## Do this now

Read `script.md`, `state/concept.md`, `state/shot-prompts.md`, and any source material in `state/brief.md` / `state/audio-analysis.md`. Then choose the smallest operation:

- **Text-only cleanup after visuals exist:** `run_action(apply_text_edits)`.
- **Per-shot visual/motion prompt edits:** `run_action(apply_shot_prompts)`.
- **Mode changes:** `run_action(apply_shot_workflow_modes)`.
- **Fresh script/topology rebuild:** edit `script.md`, then `run_action(apply_script)` only when adding/removing/re-IDing scenes, shots, cast, or environments.

Preserve IDs unless the artist asked for structural change. IDs are continuity.

## What a good script does

- **Honors the source.** Do not invent genre, lore, characters, or plot unless the source asks for adaptation.
- **Defines reusable entities.** Every recurring person, creature, object, and location that needs visual continuity gets a cast/environment entry.
- **Makes beats visible.** Write what changes on screen: posture, position, gaze, object state, reveal, movement, entrance, exit.
- **Has one primary change per shot.** If a shot contains three beats, split it.
- **Uses duration honestly.** Long shots need continuous action or a hold worth holding; otherwise split.
- **Carries geography.** Adjacent shots should preserve screen direction, location logic, and who is where.

Bad: “Mina realizes the truth and feels devastated.”
Good: “Mina lowers the opened note, stops mid-step, and looks back at the empty doorway.”

## Pacing and topology

For storyboard/video production, prefer cohesive clips up to about 15 seconds. Use 4-8s for reactions, transitions, and quick action fragments; 8-12s for acting beats; 12-15s for mini-sequences that visibly evolve. Avoid shots above 15s unless the render plan truly supports them.

If a duration fix changes shot count, say it plainly: “I am splitting S2.3 into two adjacent shots; cast and environment stay the same.” If you also change cast, location, or story meaning, it is no longer duration surgery.

## Safe edit rule

After refs/boards/videos exist, `apply_script` is dangerous by design. Use `apply_text_edits` for existing scene titles, shot directions, and dialogue lines. It preserves refs/boards/videos and marks affected outputs stale. Use `apply_script` only for true topology rebuilds, and only with explicit artist approval if downstream visual work would be wiped.

## Writing shot directions

Each direction should contain:

- who/what is present by canonical graph name
- where they are
- visible action or state change
- staging/geography if it matters
- optional dialogue cue if the shot carries speech

Avoid camera jargon as the beat. “Close-up” is not a shot unless paired with visible information.

## Push back

- “Make it more emotional” → ask which emotion, then translate it into blocking.
- “Add more shots” → ask what new information or action the added shots carry.
- “Make it epic” → ask whether scale, stakes, motion, crowd, environment, or character choice should grow.

## Failure modes

- Using `apply_script` for wording cleanup.
- Leaving reusable names in prose instead of cast/environment entries.
- Repeating wallpaper shots with slightly different phrasing.
- Writing interior states that cannot be staged.
- Adding cinematic filler that does not move the source or scene.
