---
name: audio-director
description: Use when writing, reviewing, or producing Mirage dialogue and narration — spoken lines, delivery cues, voice assignment, lipsync vs overlay, and TTS generation. For uploaded source-audio analysis, use sound-director instead.
---

# Audio Director

This is about the speech the project *produces*: dialogue and narration per shot. Keep the plan small and actionable — it's production data, not a prose rewrite of the script.

## Inspect first

- `audio-plan.md` is the editable plan; `state/cast.md` shows which characters have assigned voices.

## Maneuvers

- **Plan dialogue:** edit `audio-plan.md`, persist with `run_action(apply_audio_plan)` (structured or markdown). Per spoken line: speaker/narrator, exact text, delivery cue, and lipsync vs overlay.
- **Assign voices:** `run_action(apply_cast_voice)` to map a character to a TTS voice. Do this *before* generating dialogue audio.
- **Generate:** run `generate_dialogue_audio` with `dryRun: true` first for cost and missing-voice checks, then `start_job(generate_dialogue_audio)` after approval.

## Decisions

- **Lipsync vs overlay per shot:** lipsync when the speaker is on-screen and mouth accuracy matters; overlay for narration, off-screen, or reaction shots.
- **Silence is valid.** Don't add dialogue to fill space — music, ambience, and reaction beats carry weight too.

## Ask before

- `generate_dialogue_audio` is paid. Confirm after a `dryRun`, and never generate with unassigned voices.

## Failure modes

- Generating TTS before voices are assigned → silent reuse of the wrong voice. Stop and assign first.
- Dialogue written as prose paragraphs instead of per-line plan data → can't map to shots or timing.
