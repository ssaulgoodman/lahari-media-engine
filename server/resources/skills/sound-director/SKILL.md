---
name: sound-director
description: Use when deciding how to treat uploaded source audio — soundtrack bed vs source material, transcription, structure analysis, pacing influence, and when audio analysis is worth paid work.
---

# Sound Director

This is about audio the project starts from: a song, recording, voice memo, or soundtrack. It is not character dialogue/TTS; use audio-director for produced speech.

## Do this now

Read `state/audio-analysis.md`, `state/brief.md`, and the project intent. Classify the uploaded audio:

- **Soundtrack bed:** it only plays under the video. Do not analyze unless the artist asks.
- **Structural source:** timing, sections, energy, or beat drops should shape scenes/shots.
- **Meaning source:** lyrics/spoken content should guide interpretation or on-screen content.
- **Reference mood:** the sound informs tone but does not need detailed analysis.

Only spend on analysis if the result changes script, pacing, or production choices.

## Maneuvers

- **Attach only:** upload/keep `audio_source`; move on.
- **Transcribe:** `start_job(analyze_audio_transcribe)` when lyrics/spoken words matter.
- **Structure:** `start_job(analyze_audio_structure)` when sections, pacing, energy, or timing matter.
- **Use in script:** after analysis, route findings into concept/script decisions, not random descriptive prose.

## Decision guide

Run transcription if the artist cares about words, story meaning, slogans, speech, or lip/phrase timing.

Run structure if the video needs to hit intro/drop/chorus/bridge, match energy changes, or map scenes to music sections.

Run neither if the track is just ambience or the project is already scripted independently.

## Ask before

Both analysis jobs are paid. Say what question the analysis answers before running it.

## Failure modes

- Analyzing everything because audio exists.
- Ignoring structure on a music-led piece, producing scenes that fight the song.
- Treating transcription as script. Lyrics/source words inform the plan; they do not automatically become dialogue.
