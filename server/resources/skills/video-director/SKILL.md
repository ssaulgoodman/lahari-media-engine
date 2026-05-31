---
name: video-director
description: Use when generating or fixing Mirage shot video — keyframe vs storyboard mode, motion prompts, model behavior, cost checks, reference strategy, and repair decisions before spending.
---

# Video Director

Video is the expensive end of the pipeline. The job is to make sure the still input is right, the motion instruction is specific, the model is appropriate, and the artist approves the spend.

## Do this now

Read `state/shot-prompts.md`, `state/storyboards/<shot>.md`, and the shot’s mode. Then ask:

- Is this **keyframe mode** or **storyboard mode**?
- Is the still input already good enough to animate?
- Is the failure actually in the script, board/frame, locked refs, motion prompt, or model?
- Have you run `run_action(generate_video, dryRun: true)` before spending?

Do not generate video to discover what a bad board/frame already told you.

## Modes

**Keyframe mode:** the start frame carries visual state. The motion prompt should describe what changes over time. Do not restuff character/style/environment prose; it fights the frame.

**Storyboard mode:** the locked board is the primary image plus style/cast/env refs. No first frame is sent. If the board is wrong, fix the board before touching video.

Seedance treats `first_frame_url` and `reference_images` as mutually exclusive. Keyframe prioritizes frame control; storyboard prioritizes board + refs.

## Motion prompt craft

A good motion prompt is one short paragraph:

- starts from the visible still/board state
- names the character/environment by graph name
- describes physical motion, timing, and emotional performance
- avoids new visual design
- avoids camera-school jargon unless it has visible meaning

Good: “The Boss holds in the doorway for a beat, then steps into the Red Den Room slowly, eyes moving from the empty desk to The Knife Orchid. She remains seated, only her hand tightening on the armrest.”

Weak: “Cinematic slow dolly with intense emotions, dramatic lighting, premium action.”

## Maneuvers

- **Persist keyframe motion text:** `run_action(apply_video_prompt)`. It does not generate.
- **Cost/requirements:** `run_action(generate_video, dryRun: true)`.
- **Generate:** `start_job(generate_video)` only after approval.
- **Switch model:** if the same prompt fails the same way twice, try another model rather than paying for identical retries.
- **Return upstream:** if motion fails because the board/frame is wrong, fix storyboard/keyframe first.

## Repair ladder

1. **Motion wording wrong:** edit motion prompt.
2. **Still input wrong:** fix storyboard or keyframe.
3. **Identity/location drift:** fix locked refs before video retries.
4. **Model artifact or physics failure:** switch model for one test.
5. **Shot intent wrong:** use script/storyboard skills; do not video-tune a bad beat.

## Model behavior

Seedance is useful for storyboard-driven clips and fast iteration, but may over-follow board layout. Veo can be stronger for natural motion/camera behavior but may need cleaner input and can fall back to Vertex only for infra/billing. Seedance never falls back to Vertex. Treat dryRun as the truth for requirements/cost.

## Ask before

Always dry-run, state cost/requirements, then ask before `start_job(generate_video)`. For batches, summarize total shots and expected spend.

## Failure modes

- Generating video before board/frame lock.
- Long motion prompt that invents new styling.
- Retrying same model/prompt/refs after the same failure.
- Fixing video when the storyboard is the real weak link.
