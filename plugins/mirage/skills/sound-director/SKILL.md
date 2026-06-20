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
- **Canonical words available** -> `run_action(apply_source_lyrics)`; do not spend on transcription just to rediscover known lyrics or source text.
- **Words matter** -> `start_job(analyze_audio_transcribe)` after approval.
- **Timing/energy matters** -> `start_job(analyze_audio_structure)` after approval.
- **Both matter** -> run transcription and structure, then fold findings into concept/script.

Uploading audio does not automatically analyze it.

## Use The Result

Transcription and applied source lyrics are source material, not automatic dialogue. Structure is pacing evidence, not a mandatory scene list. Convert the analysis into concrete decisions: scene boundaries, shot duration, visual emphasis, lyric references, or what to ignore.

If a long-track transcription is partial, regresses, or stops far before the structure end time, preserve the better source and use `apply_source_lyrics` with canonical/artist-provided text. Do not keep rerunning paid transcription blindly.

## Ask Before

Audio analysis is paid. State the question first: “Do we need lyrics meaning?” or “Do we need section timing for scene pacing?”

After an audio-analysis `start_job`, return the job id and keep working unless the artist explicitly asks you to watch or poll. Studio realtime is the default progress surface; use `get_job` for deliberate checks/watch mode, not habit loops.

## Avoid

- Analyzing every uploaded audio file.
- Rerunning transcription after a partial/regressed result when canonical lyrics are available.
- Ignoring structure on a music-led project.
- Turning lyrics into literal on-screen text by default.
- Treating source audio as produced dialogue; that is audio-director territory.
