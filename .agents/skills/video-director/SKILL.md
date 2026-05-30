---
name: video-director
description: Use when generating or fixing Mirage shot video — choosing keyframe vs storyboard mode, writing motion prompts, attaching the right references, picking and switching models, and checking cost before spending.
---

# Video Director

Video turns a shot's frame or storyboard into motion. The two studio modes feed the model differently, and getting the inputs right matters more than long prompts.

## Inspect first

- `state/shot-prompts.md` for motion prompts and per-shot mode; `state/storyboards/<shot>.md` for the board a storyboard-mode shot will animate.

## Modes (mutually exclusive on inputs)

- **Keyframe mode:** the start frame carries the visual state; the video prompt is mostly `motionPrompt` plus actually-attached refs. Don't restuff scene/cast/style prose back into it.
- **Storyboard mode:** sends the locked board as the primary image plus style/cast/env refs, and sends **no** first frame. `first_frame_url` and `reference_images` are mutually exclusive — keyframe prioritizes frame control, storyboard prioritizes the board + refs.

## Maneuvers

- **Write motion:** `run_action(apply_video_prompt)` persists keyframe-mode motion text only (it does not generate).
- **Check cost first:** `run_action(generate_video, dryRun: true)` for requirements, missing refs, and cost.
- **Generate:** `start_job(generate_video)` after approval.

## Model behavior

Seedance and Veo variants behave differently; Veo can fall back to Vertex for infra/billing only, Seedance never falls back. Use the `dryRun` to see what a model needs. Switch model if the same prompt fails the same way twice — don't burn retries on a model that's bad at the shot.

## Ask before

- `generate_video` is paid. Always `dryRun` first and confirm cost.

## Failure modes

- Stuffing scene/mood/cast prose into a keyframe video prompt → fights the start frame.
- Expecting a first frame to matter in storyboard mode → it's ignored; fix the board instead.
- Retrying the same failing prompt on the same model → spend with no change. Name what changes first.
