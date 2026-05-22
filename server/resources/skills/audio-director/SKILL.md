---
name: audio-director
description: Use when writing, reviewing, or applying per-shot audio plans: spoken dialogue lines, soundNotes, character voice mapping, and project-level lipsync vs overlay mode. Triggered by "write audio plan," "generate dialogue," "who needs voices," "lipsync this shot," or when calling apply/generate audio tools.
---

# Audio Director

Audio planning is production data for the video engine. It is not a prose rewrite of the script and it is not a full sound-design pass. Your job is to make the smallest useful graph: who speaks, what text TTS should speak, and what ambient/sound context the video prompt should know.

Read the project packet first:

- `workflow_key` tells you whether Audio is part of the workflow. `music_video` normally skips Audio; `anime_scripted` uses it.
- `preset_key` gives the taste/defaults. Follow preset audio rules when present.
- `production.audioPhase` tells you state, missing voices, pending TTS lines, and stale audio-plan shot IDs.
- Cast entries carry `voice.assigned`, `voice.provider`, `voice.id`, and look/reference state.

Do not assume lyrics, a music queue, deity, temple, devotional context, or existing audio unless the project says so.

## Audio Plan Shape

Each shot may have:

- `dialogue[]`: ordered spoken lines
- `soundNotes`: restrained ambient/SFX guidance for video prompting

Dialogue text is exactly what TTS will speak. Do not put speaker names, delivery labels, camera notes, parentheticals, or stage directions inside `text`.

Do not create separate delivery/pace prose. If the exact acting is important, keep it in the script/shot direction where the artist can see it, not as hidden audio metadata.

## Preserve The Source

If the seed was a script or document with dialogue, preserve dialogue as close to verbatim as possible. Clean formatting, remove parenthetical directions from spoken text, and split long exchanges into shot-local lines, but do not casually rewrite character intent.

If the seed only has action beats or a brief, write dialogue only when the shot clearly calls for speech. Silence is allowed. Many anime shots are acting, reaction, motion, or atmosphere.

Never invent a new speaking character. Use only cast IDs already present in the project. If a line needs a character that does not exist, stop and propose adding cast first.

## Project Mode

Dialogue video mode is project-level, not per-shot.

Use `lipsync` when generated TTS should be passed into video generation for mouth movement. All dialogue lines in a lipsync shot need generated TTS before video generation.

Use `overlay` when the video model should perform the dialogue natively and generated TTS is mixed into the final render.

When unsure, prefer `overlay`. It is more forgiving and can be mixed during render.

## Voice Mapping

Voice identity belongs to cast. If a character lacks a voice ID, leave their dialogue pending and make it visible as a missing prerequisite. Do not block other characters' ready lines.

A good voice label helps future operators: "soft teen lead", "older gravelly mentor", "dry narrator". The provider ID is the operational key; the label is for humans.

## Sound Notes

Use `soundNotes` as broad production context, not a Foley timeline:

- Good: "distant train brakes, low station murmur, rain under dialogue"
- Good: "classroom air conditioner hum, pencil taps, muffled hallway chatter"
- Bad: "00:01 footstep, 00:02 chair scrape, 00:03 cloth rustle"

For v1, sound effects are usually described to the video model or reserved for later render work. Do not over-plan exact SFX timing unless the user explicitly asks.

## Staleness

If script direction, scene narrative, cast assignment, environment, duration, or cast/environment descriptions changed after an audio plan was written, treat `audioPlanStale` as real. Review and rewrite only the affected shots. Preserve usable lines unless the source beat changed.

When applying a revised plan, keep existing `ttsAssetId` only if the line text and speaker are still the same. If the spoken text changes, reset that line to pending so stale audio is not reused.

## Harness Posture

Think like Codex operating a graph:

- Generate or apply only what has prerequisites.
- Leave missing voices as visible tasks.
- Ask before paid TTS generation.
- Do not turn the Audio phase into a DAW or a giant tracker.
- Keep the graph simple enough that an artist can see what is ready, what is waiting, and what to do next.

## Cross-References

- `script-doctor`: source beat, cast, and shot intent.
- `storyboard-prompt-craft`: when `soundNotes` should inform visible action or atmosphere.
- `continuity-auditor`: when lipsync/overlay choice affects shot-to-shot continuity.
