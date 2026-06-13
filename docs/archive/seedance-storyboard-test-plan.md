> Archived. Historical test plan; current Seedance storyboard behavior lives in `docs/seedance-storyboard-workflow.md` and `docs/pipeline-anatomy.md`.

# Seedance Storyboard Test Plan

Branch: `seedance-storyboard-workflow`

Purpose: prove the prompt workflow before product wiring. We are testing whether GPT Image 2 can produce a useful storyboard seed, and whether Seedance 2.0 follows that storyboard better with text-only, storyboard+timing, or storyboard+audio prompting.

## Provider Facts To Bake In

Current Segmind docs list Seedance 2.0 and Seedance 2.0 Fast as supporting:

- durations: 4, 5, 6, 8, 10, 12, 15 seconds
- multi-shot prompt syntax: `Shot 1:`, `Shot 2:`
- up to 9 reference images
- up to 3 reference audio files
- explicit reference bindings in the prompt, such as `@image1` and `@audio1`
- first/last frame mode is mutually exclusive with `reference_images`

For Lahari storyboard mode, use `reference_images` / `reference_audios`, not `first_frame_url` / `last_frame_url`.

## What We Are Testing

### 1. Script Writer Prompt

Question: can the script writer plan Seedance storyboard clips instead of old continuous shots?

Variants in `server/services/seedance-storyboard-rd.ts`:

- `clip_blocks`: prefer 15s clips, allow shorter supported durations
- `clip_blocks_combine_short`: combine adjacent tiny musical sections when musically natural
- `clip_blocks_freeform`: maximum freedom to vary duration for taste

Winner should:

- avoid monotonous uniform clips
- use 15s when the music phrase can hold a mini-scene
- use 4/5/6/8/10/12 when musically cleaner
- describe internal cuts as intentional edited beats
- preserve scene/music structure instead of flattening everything into one montage

### 2. GPT Image Storyboard Prompt

Question: what board shape gives Seedance the best seed?

Variants:

- `four_panel_clean`: opening, movement, peak, landing
- `six_panel_music_video`: more angles and faster edit language
- `filmstrip_minimal_cuts`: calmer, fewer internal cuts

Winner should:

- avoid text, labels, subtitles, logos, and watermarks
- keep character identity, costume, environment, and style consistent
- make the internal cut sequence legible
- feel like production previsualization, not poster art
- provide a strong opening and landing frame

### 2b. Natural Language Storyboard Refinement

Question: can an artist steer the board conversationally until it matches intent?

Test:

- generate an initial storyboard from locked style, cast, environments, scene context, musical segment, and shot direction
- refine it with short natural-language notes like "make the cuts more minimal", "hold on Lahari longer", or "make the temple reveal clearer"
- check whether Responses preserves the original cast/env/style identity while obeying the refinement
- save every generation and refinement as a version with prompt, artist note, parent version, response id, asset id, and lock state
- promote the UX only if the version history makes it easy to go back, compare, and lock the winning board

### 3. Seedance Prompt Without Audio

Question: does Seedance follow the board best from the board alone, timing alone, or both?

Variants:

- `follow_board_only`
- `shot_timing_only`
- `board_plus_timing`

Expected winner: `board_plus_timing`, but test it.

### 4. Seedance Prompt With Audio

Question: does the real Lahari song segment improve timing, cuts, or lip movement?

Variants:

- `board_plus_timing` without audio
- `board_plus_audio_rhythm` with extracted audio
- `board_plus_audio_lipsync` with extracted audio

Use lipsync only when a mouth is visible and singing/chanting is part of the shot. Otherwise it may create uncanny face movement.

## Harness Commands

Generate a prompt pack for one real shot:

```bash
npm run seedance:rd -- --mode prompt-pack --project-id PROJECT_ID --shot-id SHOT_ID --duration 15
```

Extract the matching audio segment:

```bash
npm run seedance:rd -- --mode extract-audio --project-id PROJECT_ID --shot-id SHOT_ID --duration 15
```

Generate a GPT Image storyboard:

```bash
npm run seedance:rd -- --mode generate-storyboard --project-id PROJECT_ID --shot-id SHOT_ID --duration 15 --variant four_panel_clean
```

Generate a Seedance test video from a storyboard:

```bash
npm run seedance:rd -- --mode seedance-test --project-id PROJECT_ID --shot-id SHOT_ID --duration 15 --storyboard-path images/STORYBOARD.png --variant board_plus_timing
```

Generate a Seedance test video with audio as rhythm reference:

```bash
npm run seedance:rd -- --mode seedance-test --project-id PROJECT_ID --shot-id SHOT_ID --duration 15 --storyboard-path images/STORYBOARD.png --audio-path audio/CLIP.mp3 --variant board_plus_audio_rhythm
```

Outputs go under `.lahari/seedance-rd/<projectId>/<shotId>/` and generated media is uploaded to Supabase Storage so we can inspect public URLs.

## Decision Rubric

Score each output 1-5:

- storyboard legibility
- character/environment consistency
- music/phrase fit
- internal cut taste
- motion quality
- devotional/cultural fit
- prompt reliability

Promote a template only if it wins on multiple shots, not one lucky generation.

## Product Wiring After Prompts Win

Only after the winning templates are clear:

1. Add project/shot schema for storyboard mode.
2. Add conditional Storyboard tab for GPT Image 2 + Seedance.
3. Add `Generate / Refine / Lock Storyboard`, with natural-language refinement and version history.
4. Add Seedance storyboard video path that uses reference images/audio instead of first/last frames.
5. Add model-aware script planning for storyboard clips.
