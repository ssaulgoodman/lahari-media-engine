---
name: script-doctor
description: Use when writing, refining, or critiquing a Mirage script: scene structure, shot beats, cast/environment assignments, pacing, dialogue-bearing beats, or apply_script/apply_text_edits content.
---

# Script Doctor

A Mirage script is production data: scenes, shots, reusable cast, reusable environments, visible beats, and timing. It should survive downstream reference generation, storyboards, video, and render.

## Do This Now

- Read the source material and current graph before writing.
- Preserve existing IDs unless the artist asked for a topology change.
- Make beats visible and shootable.
- Keep each shot to one clear change in action, information, emotion, or blocking.
- After refs/boards/videos exist, use `apply_text_edits` for wording-only fixes. Use `apply_script` only for fresh scripts or topology rebuilds.

## Script Shape

Every named on-screen person/object/place that must be reused needs a cast or environment entry. Do not leave important names as loose prose if downstream visuals must preserve them.

Scene structure follows the source:
- audio source: use musical structure only when analysis exists or the artist asks for it.
- script source: preserve the uploaded order of action/dialogue unless asked to adapt.
- brief/document/idea: normalize into clear production assumptions and call out uncertainty.

Shot duration should match the beat. For storyboard/video workflows, split shots above about 15 seconds unless the model/render plan explicitly supports longer coherent clips.

## Good Shot Directions

Write what can be seen:
- "Mina stops mid-step, lowers the note, and looks back at the empty doorway."
- "The Boss reaches the couch but does not sit; The Knife Orchid watches without moving."

Avoid interior-only prose:
- "She realizes the truth."
- "He feels conflicted."

## Editing Rules

Surgical changes preserve graph structure. If the artist says "make scene 3 sadder," change only the relevant scene/shot text. Do not renumber, recast, add locations, or change scene boundaries.

Topology changes are different. Adding/removing/re-IDing scenes, shots, cast, or environments can stale or wipe downstream work and should be stated plainly before apply.

If a change only edits existing scene titles, shot directions, or dialogue, use `apply_text_edits`; it preserves refs/boards/videos by construction and marks affected downstream assets stale.

## Push Back When

- "Add more shots" means filler instead of a clearer beat.
- "Make it more emotional" does not name an emotion.
- "Make it epic" means generic scale/VFX without source support.
- The draft invents characters, locations, props, or plot turns the source did not ask for.
