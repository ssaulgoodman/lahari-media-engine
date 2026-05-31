---
name: storyboarding
description: Use when creating or fixing Mirage storyboards — writing storyboard prompts and cut plans, generating or refining boards, importing native images, and keeping adjacent shots coherent. Covers the full repair ladder, not just prompt writing.
---

# Storyboarding

Storyboards stage each shot as a static image. The prompt is image-native blocking — who is where, what changes, what the viewer sees — not a character bible, style bible, or camera-school note. Mirage binds graph names to attached reference images at render, so you name, you don't re-describe.

## Inspect first

- `storyboards/<scene>.md` are the editable prompt/cut-plan drafts; `state/storyboards/<shot>.md` shows the current board, lock, and status.

## Write the prompt

A storyboard prompt has a fixed shape. The image model reads text, so build it in this order — this is literally what produces the board:

1. **Layout line.** State the grid: a 2×2 grid of four 16:9 panels (or a single row of 3), thin borders, read left-to-right then top-to-bottom. The borders only separate panels; nothing else should read as a graphic element.
2. **One-line setup.** Where we are and who's present, in canonical graph names — `The Boss enters the Red Den Room; The Knife Orchid is already seated.` Do **not** restate appearance, costume, or style — the locked refs carry that.
3. **Per-panel beats, inline, one short sentence each, in reading order.** Panels are moments in *time*: panel 1 is the first beat, the last panel the final beat; the action happens *between* panels and each panel is a decisive still. Write each exactly as `Panel 1: <framing/staging> — <visible action>`.
4. **Continuity.** Note what carries across panels — position, screen direction, light — so the four read as one moment, not four unrelated shots.
5. **No text in panels.** End with the rule: no captions, numbers, labels, arrows, speech bubbles, subtitles, readable text, logos, or watermarks. Storyboard models render those literally, and the board ends up looking like a teaching diagram.

Keep the whole prompt under ~220 words. No character/environment/style design prose, no "cinematic film still" language.

Example:

> A 2×2 grid of four 16:9 storyboard panels, thin borders, read left-to-right then top-to-bottom.
> Setup: The Boss enters the Red Den Room; The Knife Orchid is already seated.
> Panel 1: wide, low angle — The Boss stops in the doorway, one hand on the frame.
> Panel 2: medium, over his shoulder — The Knife Orchid stays seated, watching without turning.
> Panel 3: close on The Boss — his eyes find the empty desk.
> Panel 4: wide, reverse — he crosses toward the desk; she has not moved.
> No captions, numbers, labels, arrows, or readable text.

Bad version:

> A cinematic noir shot of The Boss, a sharp-dressed man with intense eyes, entering a moody red room in dramatic lighting, dolly in, tense atmosphere, beautiful premium anime style.

Why bad: it restates identity/style, gives one vague shot instead of panel beats, uses camera words the image model will not stage, and gives no temporal change.

## Cut plan

The cut plan is for the video model that animates the board later, not the image model. Same panel beats, one line per panel, exactly `Panel N — <action>` (e.g. `Panel 1 — slow lean into the doorway, breath held`). It may be empty — then the video model uses board order alone.

## Repair ladder (when a board is wrong, climb from cheapest)

1. **Prompt/spec wrong** → edit `storyboards/<scene>.md`, re-apply with `run_action(apply_storyboard_prompts)`. Free.
2. **Close, needs a visual tweak** → `start_job(refine_storyboard_image)` with an edit instruction — keeps the current board, no re-plan.
3. **Refs are causing drift** → regenerate with `contextOverrides` to exclude/swap the offending cast/env/style refs (`excludeCastRefs`, `includeStyleImage: false`, etc.).
4. **Native image is faster/better** → make it with your own imagegen, upload via `/api/agent/uploads` (`purpose=storyboard_image`), then `run_action(import_storyboard_image)` to attach that exact board.
5. **A phrase/recipe keeps working** → promote it: `apply_project_style_notes` (storyboard bucket) or a project prompt override.
- **Generate from scratch:** `start_job(generate_storyboard)` (paid); lock with `run_action(lock_storyboard)`.

Use the ladder precisely. If the board has wrong geography, rewrite prompt/cut plan. If the board is almost right but the hand position is off, refine image. If the board keeps changing a character's identity, stop and inspect the locked ref. If the model cannot follow the style after two tries, try provider/context change rather than adding prose.

## Cross-shot coherence (check before locking a sequence)

Adjacent boards should preserve geography, screen direction, and the 180-degree line, and the run should read as one world. If shot N+1 jumps despite each board being fine on its own, the fix is staging/continuity, not a better single prompt.

Scene-level habit: write or review a whole scene's boards together when possible. Vary framing across adjacent shots; do not make every board a centered confrontation. Carry handoff state forward: who was seated, who crossed the room, which doorway they used, where the light source is.

## Model behavior

The default storyboard provider handles most boards; switch provider (`nano-banana-pro` / `nano-banana-2` / `gpt-image-2`) only if the same prompt fails the same way twice.

## Ask before

- `generate_storyboard` and `refine_storyboard_image` are paid. Confirm before generating. For a batch, run `parallel_run` over per-shot `generate_storyboard` calls.

## Failure modes

- Re-describing wardrobe/face/style after refs are locked → fights the binding contract.
- Cinematic jargon (dolly, rack focus, lens size) or generic VFX (glowing particles) the source did not ask for.
- Four centered portraits with no change in blocking — vary the framing panel to panel.
- Cramming more than ~4 beats into one board → the panels blur together; split the shot instead.
