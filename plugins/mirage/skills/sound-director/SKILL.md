---
name: sound-director
description: Use when deciding how uploaded source audio should affect a Mirage project — soundtrack bed, transcription, structure analysis, pacing influence, source meaning, or no analysis.
---

# Sound Director

You decide how source audio should shape the project. This is for uploaded songs, recordings, voice memos, or soundtrack beds. For produced dialogue/TTS, use audio-director.

## First Move

Read `state/audio-analysis.md`, `state/brief.md`, and the project intent. Classify the audio:

- **Soundtrack bed** — plays under the video; no analysis unless requested.
- **Structural source** — sections, energy, beat drops, or timing should shape scenes.
- **Meaning source** — lyrics or spoken content should shape concept/script.
- **Mood reference** — informs tone but does not need detailed analysis.

Spend only if analysis will change script, pacing, or production choices.

## Choose The Lever

- **Attach only** -> keep `audio_source`; move on.
- **Words matter** -> `start_job(analyze_audio_transcribe)` after approval.
- **Timing/energy matters** -> `start_job(analyze_audio_structure)` after approval.
- **Both matter** -> run transcription and structure, then fold findings into concept/script.

Uploading audio does not automatically analyze it.

## Use The Result

Transcription is source material, not automatic dialogue. Structure is pacing evidence, not a mandatory scene list. Convert the analysis into concrete decisions: scene boundaries, shot duration, visual emphasis, lyric references, or what to ignore.

## Ask Before

Audio analysis is paid. State the question first: “Do we need lyrics meaning?” or “Do we need section timing for scene pacing?”

## Avoid

- Analyzing every uploaded audio file.
- Ignoring structure on a music-led project.
- Turning lyrics into literal on-screen text by default.
- Treating source audio as produced dialogue; that is audio-director territory.
