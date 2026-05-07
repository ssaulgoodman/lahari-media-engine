# Seedance Storyboard Workflow

Current implementation contract for the Seedance storyboard branch.

## Product Shape

Seedance storyboard mode changes the meaning of a Lahari shot.

In the old keyframe workflow, a shot is one continuous clip driven by a first frame and a motion prompt. In Seedance storyboard mode, a shot is an edited 4-15 second mini-sequence. The storyboard image defines the internal cuts, camera progression, blocking, and screen direction for that one shot. The final video still lands back in the same Studio card and Render flow.

This is Seedance-only for now. Veo stays on the keyframe path.

## Script Contract

`server/services/claude.ts -> planScenes` is model-aware by default. `server/services/openai-script.ts -> planScenesOpenAI` is available as an opt-in GPT-5.5 experiment via `scriptProvider: "openai"` or `SCRIPT_WRITER_PROVIDER=openai`.

When `project.video_model` starts with `seedance`, the script writer is told:

- a Lahari shot is a storyboard clip, not one continuous camera take
- each shot may contain internal edits, multiple angles, and beat hits
- prefer 15s shots when the musical phrase supports a mini-scene
- allow shorter 4-15s shots for transitions, refrains, or short phrases
- shot durations must add exactly to the scene duration
- each `shot.direction` should describe what happens across the edited mini-sequence

Validation enforces:

- every Seedance storyboard shot duration is 4-15 seconds
- all shot durations in a scene add exactly to the scene duration

`server/routes/generate-script.ts` preserves Opus-provided durations for Seedance shots and only uses fixed pacing/remainder logic for non-Seedance models.

The GPT-5.5 script-writer experiment uses the same JSON shape and backend validation loop. Its prompt is intentionally more practical and shootable, avoiding pompous or invisible prose unless it maps to visible action.

## Storyboard Generation

Main service: `server/services/storyboard.ts`

Prompt template: `server/services/seedance-storyboard-rd.ts -> buildStoryboardPrompt`

Image call: `server/services/openai-image.ts -> generateOpenAIImageWithResponses`

The storyboard generator builds context from:

- project title, concept, mood, song type
- scene label, scene timestamps, scene narrative, scene lyrics
- matching musical-structure cue from Gemini audio analysis
- exact shot direction and shot duration
- locked cast references for that shot
- locked environment reference
- locked style reference

The default prompt variant is still named `adaptive_numbered_storyboard` for API compatibility, but the visual contract is now ordered, not visibly numbered.

The storyboard image contract:

- one board for the exact shot, not the whole scene
- 3-6 panels depending on pacing
- panel order is left-to-right, then top-to-bottom
- do not print panel numbers, labels, arrows, captions, subtitles, speech bubbles, logos, watermarks, or any readable text into the storyboard image
- stable spatial map and coherent screen direction across cuts
- all objects and gestures must come from the shot, refs, and devotional context

The Responses API text output is stored as the cut plan:

```text
Storyboard cut plan:
Panel 1 [00:00-..] - camera: ...; action: ...; Seedance cue: ...
Panel 2 [...] - camera: ...; action: ...; Seedance cue: ...

Continuity notes: ...
```

This text is not cosmetic. It is saved on the storyboard version and is reused in the Seedance video prompt.

## Storyboard Persistence

Migration: `migrations/2026-05-06_add_storyboard_versions.sql`

Shot columns:

- `storyboard_asset_id`
- `storyboard_version_id`
- `storyboard_status`
- `storyboard_locked`
- `storyboard_user_feedback`

History table:

- `lahari_storyboard_versions`
- one row per generated/refined storyboard image
- stores OpenAI response chain IDs, image tool call IDs, prompt, refs, artist note, locked state, and metadata
- `metadata.cutPlanText` is the canonical editable cut plan used by video generation

`getFullProject` resolves storyboard URLs into each shot:

- `storyboardUrl`
- `storyboardAssetId`
- `storyboardVersionId`
- `storyboardStatus`
- `storyboardLocked`
- `storyboardUserFeedback`

## API Endpoints

All routes are under `/api/projects/:id/shots/:shotId`.

| Endpoint | Body | Purpose |
| --- | --- | --- |
| `POST /generate-storyboard` | `{ variant?: "adaptive_numbered_storyboard" }` | Generate a new storyboard version from shot, scene, refs, and musical context. |
| `POST /refine-storyboard` | `{ feedback, previousVersionId?, variant? }` | Natural-language refinement using the prior OpenAI response chain when available. |
| `POST /lock-storyboard` | `{ versionId? }` | Lock the selected/current storyboard version for video generation. |
| `POST /unlock-storyboard` | none | Unlock the storyboard while keeping the active version. |
| `PATCH /storyboard-plan` | `{ cutPlanText }` | Save edited cut-plan text on the active storyboard version. Video generation uses this text. |
| `GET /storyboard-history` | none | Return generated versions with image URLs, model IDs, notes, lock state, and cut plan text. |

Client helpers live in `services/api.ts`:

- `generateStoryboard`
- `refineStoryboard`
- `lockStoryboard`
- `unlockStoryboard`
- `updateStoryboardPlan`
- `getStoryboardHistory`

## Seedance Video Prompt

Video route: `server/routes/generate-video.ts`

Prompt template: `server/services/seedance-storyboard-rd.ts -> buildSeedanceStoryboardVideoPrompt`

When the selected video model is Seedance and the shot has a locked storyboard, video generation switches to storyboard mode.

Reference ordering is important:

- `@image1` is always the locked ordered storyboard
- `@image2+` are the exact style, cast, and environment refs used to create the storyboard
- frontend video refs are ignored in storyboard mode so `@imageN` stays deterministic

The generated Seedance prompt says:

- follow `@image1` panels left-to-right, then top-to-bottom
- treat `@image1` as source of truth for composition, blocking, screen direction, cut order, and camera progression
- if an old storyboard contains panel numbers, labels, borders, or guide marks, treat them only as sequencing guides and do not render them into the video
- use all other images only as consistency anchors
- use the saved cut plan text as the motion/cut guide
- do not replace storyboard composition with a composition from reference images
- do not invent a different devotional object or character blocking than the storyboard
- do not generate audio, panel numbers, subtitles, text, logos, watermarks, or storyboard borders

Seedance is called with `startImagePath = undefined` in storyboard mode, so `reference_images` carries storyboard plus refs. This avoids the Segmind Seedance mutual-exclusion rule between `first_frame_url` and `reference_images`.

Seedance storyboard mode also ignores the old keyframe continuity chain: Studio does not block on `prev_shot`, start-frame generation skips continuity gates for Seedance, and video generation skips chained prompt refresh when a locked storyboard is driving the clip.

## UI Handoff For Claude Code

Do not keep storyboard as a separate card above the shot. The current UI contract is:

- Studio header has a mode toggle: `Storyboard | Keyframe`
- Storyboard mode is enabled only for Seedance models; gray it out for Veo
- In Storyboard mode, `ShotCard` swaps the keyframe `PromptToolkit` for `StoryboardPanel`
- `StoryboardPanel` has Storyboard and Video sub-tabs
- `Video` stays in the same shot card, same place as today
- The storyboard sub-tab owns:
  - refs chips show the locked refs being used
  - main prompt/text area displays the active cut plan text when available
  - editing the cut plan calls `api.updateStoryboardPlan`
  - Generate calls `api.generateStoryboard`
  - Refine calls `api.refineStoryboard`
  - Lock/Unlock calls `api.lockStoryboard` / `api.unlockStoryboard`
  - History calls `api.getStoryboardHistory`
- Do not show the old "No start frame" placeholder while Storyboard mode is active and no video exists
- Bulk `Storyboards` generation belongs in the Studio header when Storyboard mode is active
- Bulk `Videos` should enable only for shots with `storyboardLocked && storyboardUrl`

Implementation note: the old throwaway `ShotStoryboardPanel` spike has been removed. The current implementation is `components/StoryboardPanel.tsx`, not a separate card.

## Test Path

Backend/manual test order:

1. Use a Seedance project with locked style, cast, environment, and script.
2. `POST /generate-storyboard` for one shot.
3. `GET /storyboard-history` and confirm `cutPlanText` exists.
4. `PATCH /storyboard-plan` with a small edited cut plan.
5. `POST /lock-storyboard`.
6. `POST /generate-video`.
7. Confirm the logged Seedance prompt binds `@image1` to the ordered storyboard, includes the edited cut plan, and forbids visible panel numbers/text from appearing in the final video.
