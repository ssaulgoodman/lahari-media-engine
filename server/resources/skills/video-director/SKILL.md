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
- Have you run `run_action(generate_video, { dryRun: true })` and inspected the prompt composition?
- Is there a project workflow recipe already applied for this format?

Do not generate video to discover what a bad still already tells you.

## Modes

**Keyframe mode:** the start frame carries visual state. The motion prompt says what changes over time. Do not restuff character/style/environment design.

**Storyboard mode:** the locked board is primary; style/cast/environment refs are sent with it. If the board is wrong, fix storyboard first.

If an uploaded/native image should be the start frame, upload with `purpose=keyframe_image`, then call `run_action(import_keyframe_image)`. Use `apply_shot_workflow_modes` only when the shot must force keyframe or storyboard instead of auto.

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
- **Use an existing/native image as start frame** -> `run_action(import_keyframe_image)`.
- **Check requirements/cost/prompt composition** -> `run_action(generate_video, { dryRun: true })`.
- **Generate** -> `start_job(generate_video)` after approval.
- **Previous provider outcome unknown/pending** -> do not retry until the artist acknowledges the risk; pass `acknowledgePreviousChargeRisk: true` only after that approval.
- **One exact final prompt needed** -> use `promptOverride` on `generate_video`.
- **One storyboard-video prompt segment is hurting the call** -> use `contextOverrides` on `generate_video` dry-run first, e.g. `{ includeShotBeat: false }` or `{ includeCutPlan: false }`, then generate only after the composition reads clean.
- **Need to know what was actually sent last time** -> `run_action(describe_video_prompt)`.
- **Repeatable format needed** -> `run_action(list_workflows)`, then `run_action(apply_project_workflow)` if a named recipe fits. After that, fill the stored recipe's slots with `recipeSlots` and project dialogue; do not rewrite the wrapper.
- **Native dialogue voice needs character match** -> generate the raw native-audio clip first, review it, then use `voice_change_video` from the audio surface. Do not solve this with TTS unless the artist wants overlay.
- **Board/frame wrong** -> return to storyboarding/keyframe tools before video.
- **Same failure twice** -> change model or upstream input, not just the same retry.

For `hf_music_video`, keep the final video prompt full-frame and music-led. Use the sketch board as a camera/choreography plan only, not final style. When useful, pass `recipeSlots` such as `musicSection`, `beatTiming`, `choreography`, and `audioPolicy` on `generate_video`. The uploaded song remains the authoritative final audio; use source-audio lipsync only when a shot explicitly needs singing or mouth timing.

In storyboard mode, dry-run returns the composed prompt as segments: `format`, `animation`, `beat`, `refs`, `cut_plan`, `audio`, and `guardrail`. Read those segments before paid generation when output quality is sensitive. The segment `source` tells where the text came from; `editPath` tells what action changes it. Prefer dropping a bad segment with `contextOverrides` over hand-writing a full `promptOverride`.

## Repair Ladder

1. **Motion wording wrong** -> edit motion prompt.
2. **Board/frame wrong** -> fix storyboard or keyframe.
3. **Identity/location drift** -> fix locked refs.
4. **Audio/lipsync issue** -> inspect audio plan and model family.
5. **Native voice wrong but mouth timing works** -> voice-change the video; for two speakers, pass explicit segment cut ranges.
6. **Model artifact/physics failure** -> one model switch test.
7. **Shot intent wrong** -> return to script/storyboard.

## Ask Before

Always dry-run, state requirements/cost, then ask before `start_job(generate_video)`. For batches, summarize total shots and expected spend.

## Avoid

- Video generation before board/frame lock.
- Long motion prompts that invent new styling.
- Retrying same model/prompt/refs after the same failure.
- Video-tuning a bad beat.
- Generating TTS before native-dialogue tests when the goal is visible regional-language lipsync.
