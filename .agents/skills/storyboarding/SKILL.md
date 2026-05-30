---
name: storyboarding
description: Use when creating or fixing Mirage storyboards — writing storyboard prompts and cut plans, generating or refining boards, importing native images, and keeping adjacent shots coherent. Covers the full repair ladder, not just prompt writing.
---

# Storyboarding

Storyboards stage each shot as a static image. The prompt is image-native blocking — who is where, what changes, what the viewer sees — not a character bible, style bible, or camera-school note. Mirage binds graph names to attached reference images at render, so you name, you don't re-describe.

## Inspect first

- `storyboards/<scene>.md` are the editable prompt/cut-plan drafts; `state/storyboards/<shot>.md` shows the current board, lock, and status.

## Prompt rules

- Use canonical graph names (`The Boss`, `Red Den Room`); do **not** restate locked appearance, costume, or style — the refs and locked style carry that.
- Write decisive moments as panels, left-to-right then top-to-bottom. No visible panel numbers, captions, arrows, labels, or readable text; thin borders are fine.
- The cut plan is for later video motion and may be empty.

## Repair ladder (when a board is wrong, climb from cheapest)

1. **Prompt/spec wrong** → edit `storyboards/<scene>.md`, re-apply with `run_action(apply_storyboard_prompts)`. Free.
2. **Close, needs a visual tweak** → `start_job(refine_storyboard_image)` with an edit instruction — keeps the current board, no re-plan.
3. **Refs are causing drift** → regenerate with `contextOverrides` to exclude/swap the offending cast/env/style refs (`excludeCastRefs`, `includeStyleImage: false`, etc.).
4. **Native image is faster/better** → make it with your own imagegen, upload via `/api/agent/uploads` (`purpose=storyboard_image`), then `run_action(import_storyboard_image)` to attach that exact board.
5. **A phrase/recipe keeps working** → promote it: `apply_project_style_notes` (storyboard bucket) or a project prompt override.
- **Generate from scratch:** `start_job(generate_storyboard)` (paid); lock with `run_action(lock_storyboard)`.

## Cross-shot coherence (check before locking a sequence)

Adjacent boards should preserve geography, screen direction, and the 180-degree line, and the run should read as one world. If shot N+1 jumps despite each board being fine on its own, the fix is staging/continuity, not a better single prompt.

## Model behavior

The default storyboard provider handles most boards; switch provider (`nano-banana-pro` / `nano-banana-2` / `gpt-image-2`) only if the same prompt fails the same way twice.

## Ask before

- `generate_storyboard`, `bulk_generate_storyboards`, and `refine_storyboard_image` are paid. Confirm before generating.

## Failure modes

- Re-describing wardrobe/face/style after refs are locked → fights the binding contract.
- Cinematic jargon (dolly, rack focus, lens size) or generic VFX (glowing particles) the source did not ask for.
- Four centered portraits with no change in blocking.
