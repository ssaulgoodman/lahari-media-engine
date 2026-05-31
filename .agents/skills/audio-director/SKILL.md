---
name: audio-director
description: Use when writing, reviewing, or producing Mirage dialogue and narration — spoken lines, delivery cues, voice assignment, lipsync vs overlay, and TTS generation. For uploaded source-audio analysis, use sound-director.
---

# Audio Director

This is about speech the project produces: dialogue, narration, delivery, voices, and generated audio. It should be clean production data, not prose commentary on the script.

## Do this now

Read `audio-plan.md`, `state/cast.md`, and the relevant script shots. Decide:

- Which shots actually need speech?
- Is each line on-screen lipsync, off-screen, narration, or overlay?
- Does every speaking cast member have a voice?
- Would silence, music, or reaction staging be stronger than words?

Then edit `audio-plan.md` and persist with `run_action(apply_audio_plan)`.

## Writing the plan

Each line should have:

- speaker or narrator
- exact spoken text
- shot mapping
- delivery cue
- strategy: lipsync or overlay

Keep lines short and actable. Dialogue should reveal choice, pressure, or relationship. Narration should clarify structure or tone, not describe what the viewer already sees.

## Maneuvers

- **Plan speech:** `run_action(apply_audio_plan)` with markdown or structured data.
- **Assign voices:** `run_action(apply_cast_voice)` before generation.
- **Dry run:** `run_action(generate_dialogue_audio, { dryRun: true })` for cost and missing voices.
- **Generate:** `start_job(generate_dialogue_audio)` after approval.

## Lipsync vs overlay

Use **lipsync** when the speaker is visibly talking and mouth accuracy matters. Use **overlay** for narration, off-screen speech, memory, commentary, or reaction shots. If a line does not need a visible mouth, overlay is usually safer.

## Judgment

Good speech is sparse and timed to the shot. It should not fight the storyboard or fill every quiet beat. If the visual beat already communicates the point, cut the line.

## Ask before

TTS is paid. Always dry-run first, then confirm. Never generate with missing or uncertain voices.

## Failure modes

- Generating before voice assignment.
- Writing paragraphs instead of line-level production data.
- Using dialogue to explain an emotion the shot should stage.
- Choosing lipsync for shots where the mouth is hidden or irrelevant.
