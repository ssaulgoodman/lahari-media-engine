---
name: storyboard-prompt-craft
description: Use when writing or rewriting Mirage storyboard prompts, cut plans, or keyframe motion prompts. Focus on graph-name staging, blocking, panel readability, and renderable image language.
---

# Storyboard Prompt Craft

Storyboard prompts are for image generation. They stage the shot. They are not character bibles, style bibles, or film-school camera notes.

## Do This Now

- Use canonical graph names: `The Boss`, `The Knife Orchid`, `Red Den Room`.
- Do not restate locked character appearance, costume, face, environment design, or style.
- Write blocking: who is where, what changes, what the viewer sees.
- Let Mirage bind graph names to attached reference images during render.
- Keep it short. The model should follow action, not swim through adjectives.

## Core Rules

Panels are static images. Action happens between panels. Write decisive moments, not camera moves.

Good: "Panel 1 — The Boss stops at the doorway, one hand on the frame. Panel 2 — The Knife Orchid remains seated, watching him without turning. Panel 3 — The Boss looks toward the empty desk."

Bad: "A cinematic dolly pushes through moody light as grief intensifies."

Use panel order left-to-right, then top-to-bottom. Do not ask for visible panel numbers, captions, arrows, labels, or readable text. Thin panel borders are fine.

The storyboard prompt is for the image model. The cut plan is for later video motion. Cut plans can be empty; when written, they should describe per-panel motion beats.

## Scene Drafting

For normal work, edit `storyboards/<scene>.md` and apply the scene with `apply_storyboard_prompts`. Scene-level drafting helps avoid repeated compositions and keeps adjacent shots coherent.

Use one-shot edits only for surgical fixes.

## Anti-Patterns

- repeating character wardrobe or facial descriptions after refs are locked.
- describing style again instead of relying on locked style/style notes.
- cinematic jargon: dolly, rack focus, lens size, match cut.
- generic VFX: glowing particles, magical light, abstract energy, unless the source requires it.
- inventing characters, props, or locations not in the graph.
- four centered portraits with no change in blocking.

## Motion Prompts

For keyframe video, write one short paragraph describing what changes from the start frame. No panel language. No character/style re-description. Use concrete motion over time.

Example: "The Boss pauses at the doorway, then steps inside slowly. The Knife Orchid stays seated, her gaze following him while the room remains still."
