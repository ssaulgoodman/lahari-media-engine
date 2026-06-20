---
name: audio-director
description: Use when writing, reviewing, or producing Mirage dialogue and narration — spoken lines, delivery cues, voice assignment, native lipsync, voice change, TTS, and timeline overlay.
---

# Audio Director

You plan produced speech: dialogue, narration, delivery, voice assignment, native lipsync, voice change, and timeline overlay. Keep it as production data, not commentary.

## First Move

Read `audio-plan.md`, `state/cast.md`, and the relevant script shots. Decide:

- Which shots need speech?
- Is each line lipsync, off-screen, narration, or overlay?
- Does every speaking cast member have a voice?
- Should visible dialogue be generated natively by the video model, then voice-changed?
- Would silence, music, or reaction staging be stronger?

Edit `audio-plan.md`, then persist with `run_action(apply_audio_plan)`.

## Audio Plan Pattern

Each dialogue line needs:

- speaker/cast member
- exact spoken text
- shot mapping
- delivery cue
- strategy: `lipsync` or `overlay`

Keep lines short and actable. Dialogue should reveal choice, pressure, or relationship. Narration should clarify structure or tone, not describe what the viewer already sees.

## Choose The Lever

- **Plan or revise speech** -> `run_action(apply_audio_plan)`.
- **Assign voice** -> `run_action(apply_cast_voice)`.
- **Choose ElevenLabs model** -> set project default with `run_action(apply_project_preferences, { preferences: { ttsModel: "eleven_multilingual_v2" | "eleven_v3" } })`, or pass `voiceModel` on one `generate_dialogue_audio` run.
- **Check cost/missing voices** -> `run_action(generate_dialogue_audio, { dryRun: true })`.
- **Generate TTS** -> `start_job(generate_dialogue_audio)` after approval.
- **Generate native dialogue/lipsync** -> write the audio plan, then use `generate_video` with native audio enabled. The video generator reads dialogue/timing cues.
- **Voice-change native dialogue video** -> after reviewing the raw native-dialogue clip, call `run_action(voice_change_video, { dryRun: true })`, then `start_job(voice_change_video)` after approval. One segment can cover the whole clip; multi-speaker shots need explicit cut ranges.

## Lipsync vs Overlay

Use **lipsync** when the speaker is visible and mouth accuracy matters. Use **overlay** for narration, off-screen speech, memory, commentary, or shots where the mouth is hidden.

If the line does not need a visible mouth, overlay is usually safer.

## Native Dialogue Path

For regional-language visible dialogue, prefer native video dialogue first, then voice change:

1. Save dialogue lines and optional timing in the audio plan.
2. Generate video with native audio so the model creates speech and mouth movement together.
3. Review the raw clip.
4. Voice-change the clip with `voice_change_video`.
5. Use explicit segment ranges for two speakers; write shots to avoid rapid back-and-forth inside one clip.

Do not generate TTS for this path unless the artist specifically wants TTS overlay or a model-supported audio-input experiment.

## Ask Before

TTS is paid. Dry-run first, report missing voices/cost, then ask. Never generate with missing or uncertain voices.

After any paid audio `start_job`, return the job id and keep working unless the artist explicitly asks you to watch or poll. Studio realtime is the default progress surface; use `get_job` for deliberate checks/watch mode, not habit loops.

## Avoid

- Generating paid speech or voice-change before voice assignment.
- Paragraphs instead of line-level data.
- Dialogue that explains an emotion the shot should stage.
- Lipsync for hidden mouths or irrelevant mouths.
- Filling every quiet beat with speech.
