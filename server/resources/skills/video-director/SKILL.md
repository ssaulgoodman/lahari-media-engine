---
name: video-director
description: Use when generating or fixing Mirage shot video — keyframe versus storyboard mode, motion prompts, model behavior, cost checks, audio cues, reference strategy, and repair decisions before spending.
---

# Video Director

Video is the expensive end of the pipeline. Your job is to make sure the still input is right, the motion instruction is specific, the model is appropriate, and the artist approves the spend.

## First Move

Read the shot state, mode, locked board/frame, motion prompt, audio plan, and recent generation trace. Ask:

- Is this **keyframe mode** or **storyboard mode**?
- Is the board/frame good enough to animate?
- Is the failure in script, refs, board/frame, motion wording, audio cue, or model?
- Have you run `run_action(generate_video, { dryRun: true })`?

Do not generate video to discover what a bad still already tells you.

## Modes

**Keyframe mode:** the start frame carries visual state. The motion prompt says what changes over time. Do not restuff character/style/environment design.

**Storyboard mode:** the locked board is primary; style/cast/environment refs are sent with it. If the board is wrong, fix storyboard first.

Seedance cannot use `first_frame_url` and `reference_images` together. Keyframe prioritizes frame control; storyboard prioritizes board plus refs.

## Motion Prompt Pattern

One short paragraph:

- start from the visible still/board state
- name graph entities only when needed
- describe physical motion, timing, and performance
- include dialogue/sound cues only when they should affect visible action or native audio
- avoid new visual design

Good:

> The Boss holds in the doorway for a beat, then steps slowly into the Red Den Room, eyes moving from the empty desk to The Knife Orchid. She remains seated, only her hand tightening on the armrest.

Weak:

> Cinematic slow dolly with intense emotions, dramatic lighting, premium action.

## Choose The Lever

- **Save keyframe motion text** -> `run_action(apply_video_prompt)`. It does not generate.
- **Check requirements/cost** -> `run_action(generate_video, { dryRun: true })`.
- **Generate** -> `start_job(generate_video)` after approval.
- **One exact final prompt needed** -> use `promptOverride` on `generate_video`.
- **Board/frame wrong** -> return to storyboarding/keyframe tools before video.
- **Same failure twice** -> change model or upstream input, not just the same retry.

## Repair Ladder

1. **Motion wording wrong** -> edit motion prompt.
2. **Board/frame wrong** -> fix storyboard or keyframe.
3. **Identity/location drift** -> fix locked refs.
4. **Audio/lipsync issue** -> inspect audio plan and model family.
5. **Model artifact/physics failure** -> one model switch test.
6. **Shot intent wrong** -> return to script/storyboard.

## Ask Before

Always dry-run, state requirements/cost, then ask before `start_job(generate_video)`. For batches, summarize total shots and expected spend.

## Avoid

- Video generation before board/frame lock.
- Long motion prompts that invent new styling.
- Retrying same model/prompt/refs after the same failure.
- Video-tuning a bad beat.
