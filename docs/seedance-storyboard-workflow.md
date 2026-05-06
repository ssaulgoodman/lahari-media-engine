# Seedance Storyboard Workflow Research

Research date: 2026-05-05

This note captures the current X/Grok sweep on ChatGPT plus Seedance storyboarding workflows and the first Lahari embedding decision.

## What The Tweets Are Converging On

The useful pattern is not a single magic prompt. It is a production-board loop:

1. Use ChatGPT or GPT Image to make a timed storyboard, often a 3x3 grid or 3 shots of 5 seconds each.
2. Convert the board into a Seedance prompt with explicit time slices, action, camera, lighting, and consistency locks.
3. Feed the storyboard/keyframe image into Seedance as the visual reference.
4. Generate short clips, then stitch/edit over music.

High-signal tweets from the search:

- @Studio_Tora_lab: GPT Images2 x Seedance 2.0 workflow, with idea plus prompt, GPT storyboard, reference in Seedance, refined prompt back into Seedance. https://x.com/Studio_Tora_lab/status/2046944835739799944
- @IamEmily2050: senior AI-video storyboard director prompt with 3 shots of 5 seconds, keyframe prompts, Seedance final prompt, and consistency lock. https://x.com/IamEmily2050/status/2048147198869946855
- @GumVue: custom GPT that generates cinematic Seedance prompts with timestamped scenes, film camera shots/movements, expressions, and dialogue. https://x.com/GumVue/status/2044201155786375492
- @harboriis: GPT Image 2 plus Seedance 2.0 K-pop clip framed around 16 clean counts and on-beat motion. https://x.com/harboriis/status/2050238800534835475
- @JordanMaruszak: trailer workflow using ChatGPT custom GPT for shot list and prompt refinement, Seedance/Veo for video, and music layered separately. https://x.com/JordanMaruszak/status/2051295402012426322
- @GumVue: music creator GPT with Suno and Seedance, emphasizing BPM and trailer-style structure. https://x.com/GumVue/status/2050640100477026573
- @0xInk_: timed Seedance 2 workflow template using second-by-second cinematic setup and audio cues. https://x.com/0xInk_/status/2037234396626116661

The repeatable parts for Lahari are: timed boards, reference-first prompting, consistency locks, visible beat cues, and short physically plausible camera/action instructions.

## Fit With Lahari

Lahari already has the right primitives:

- Audio analysis creates timestamped lyrics and musical sections.
- Script generation creates scenes and shot directions aligned to those sections.
- `writeShotPrompts` turns each direction into `visual_prompt` and `motion_prompt`.
- Studio generates start frames, videos, extracts last frames, and refreshes chained prompts.

So this should embed as an upgrade to Step 7, not as a separate pipeline. The shot writer should become model-aware and, for Seedance, behave more like a storyboard-to-video prompt compiler.

Important boundary: our Segmind Seedance calls currently set `generate_audio=false`. Lahari should not ask Seedance to synthesize music, dialogue, SFX, or VO. The song remains the source of truth, and the final render adds the original audio. Seedance prompts can still use visual rhythm cues such as "on the vocal phrase", "on the drum accent", or "as the chant resolves".

## First Implementation Pass

Implemented in this pass:

- `writeShotPrompts` now receives `project.video_model`.
- When the selected model is Seedance, the prompt writer gets explicit Seedance guidance:
  - write production-board style motion prompts
  - include subject, visible change, camera, and timing
  - use song rhythm as visible editorial timing, not generated audio
  - maintain identity/wardrobe/geometry positively
  - avoid multi-shot language inside one Lahari shot

This directly addresses the existing pipeline gap: "Shot writer is model-agnostic - needs model-specific best practices."

## Next Embed Candidates

The stronger version is a proper Storyboard Treatment layer between script and prompt writing:

- Store per-shot `beat_cue`, `frame_intent`, `motion_intent`, and `continuity_lock`.
- Generate optional 3x3 storyboard sheets per scene using the existing start-frame model.
- Let artists approve the scene board before bulk video generation.
- Use board/keyframe references to make Seedance prompts more stable.

The smallest shippable next step is probably just adding `beat_cue` to the shot writer output and UI, because it makes the music-driven workflow inspectable without forcing a new storyboard asset system.
