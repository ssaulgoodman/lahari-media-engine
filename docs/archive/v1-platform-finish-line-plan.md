> Archived 2026-06-13. Superseded by `docs/mirage-platform-v1-ledger.md`, which is the current v1 source of truth.

# V1 Platform Finish Line Plan

Status: draft for audit
Date: 2026-05-17
Branch: `mirage`

This doc is the earlier plan to get from the Mirage lane to a usable v1 studio for outside artists. It is superseded by `docs/mirage-platform-v1-ledger.md`, but remains useful context for why the current plan exists.

The goal is not to finish every possible workflow. The goal is to ship a clean hosted studio where:

- Users sign in through the visual studio.
- Users start a project from a workflow-specific intake.
- The project stores `seed_kind`, `workflow_key`, and `preset_key`.
- Codex attaches to that project and operates from the stored mode.
- Music video and anime both reach Studio and Render without devotional assumptions.

## Product Shape

The studio owns auth, uploads, project creation, visual review, and final approval. Codex owns director/operator work after a project exists.

The opening UX is:

```txt
Open Studio
-> Sign in
-> Start Project
-> Pick workflow card
-> Provide seed material
-> Project is created with workflow/seed/preset metadata
-> Codex attaches when the artist wants agent help
```

For v1:

```txt
Music Video
Seed: audio
Workflow: music_video
Preset: music_video_default

Anime
Seed: script
Workflow: anime_scripted
Preset: anime_default
```

Preset should be visible but secondary. The artist is choosing what they are making, not hand-editing backend enums.

## Core Concepts

`SeedKind` is the starting material:

```txt
audio
script
brief
document
idea
```

`Workflow` is the production path:

```txt
music_video
anime_scripted
```

`Preset` is taste/defaults/prompt rules/model picks:

```txt
music_video_default
anime_default
```

These are stored on the project row and exposed to the app, Codex packets, generated notebook, and skills.

## Current State

Already in this lane:

- `DB_TABLE_PREFIX` can switch between legacy `lahari_*` tables and clean `studio_*` tables.
- `SUPABASE_BUCKET` / `STORAGE_BUCKET` can switch asset buckets.
- Clean studio bootstrap migration exists at `migrations/2026-05-13_create_studio_workspace_schema.sql`.
- Runtime presets/workflows exist in `server/presets.ts`.
- Runtime prompt paths have started resolving preset from `project.preset_key`.
- Codex packets/notebooks expose workflow/preset/seed metadata.
- New project intake endpoint exists: `POST /api/projects/intake`.
- Frontend start surface has been converted to workflow-first mode cards.
- Prompt catalog is marked legacy/internal until fully regenerated.

Known doc cleanup still needed:

- `AGENTS.md` and `CLAUDE.md` still mention `Dashboard.tsx` for intake/queue in places.
- Some docs still describe anime without the Audio Blueprint phase discussed below.

## V1 Pipeline

The old high-level spine still holds:

```txt
Intake -> Blueprint -> Studio -> Render
```

But Blueprint should be workflow-aware. The v1 Blueprint phases should become:

```txt
Concept
Script
Style
Characters
Environments
Audio
```

Not every workflow needs every phase. Workflow recipes decide availability and requirement level.

For music video:

```txt
audio seed: required
audio analysis: required
Blueprint Audio phase: optional or skipped
```

For anime:

```txt
script seed: required
audio analysis: skipped
Blueprint Audio phase: available and recommended
```

## Audio Blueprint Phase

Anime production is not truly video-only. It often needs dialogue, character voices, TTS, possible lipsync, and later timeline dubbing. This should be a first-class Blueprint phase, not a hidden Studio concern.

The Audio phase should own:

- Character voice assignment.
- Dialogue plan per shot.
- Sound effect notes per shot.
- TTS generation for selected dialogue.
- Downstream use choice for each generated dialogue asset.

The important distinction is:

```txt
TTS generation happens in Blueprint.
TTS consumption happens in Studio or Render.
```

Artists may prefer:

- Seedance/native provider dialogue from text.
- Generated TTS passed to video/lipsync provider.
- Generated TTS reserved for timeline overlay/dubbing.
- Prompt-only dialogue for early visual iteration.

We should support that by storing the plan and generated assets, then letting Studio/Render choose how to consume them later.

## Minimal Audio Data Model

Do not over-normalize v1. Use enough structure for Codex and the UI to maneuver.

Add fields to cast members:

```txt
voice_provider text nullable
voice_id text nullable
voice_name text nullable
voice_notes text nullable
```

Add fields to shots:

```txt
audio_plan jsonb nullable
audio_plan_status text nullable
```

Optionally add to projects:

```txt
audio_phase_status text nullable
```

Suggested `shot.audio_plan` shape:

```json
{
  "dialogue": [
    {
      "id": "dlg_1",
      "characterId": "cast_member_id",
      "text": "You came back.",
      "startSec": 0.7,
      "endSec": 2.2,
      "emotion": "quiet disbelief",
      "delivery": "soft, restrained",
      "ttsStatus": "pending",
      "ttsAssetId": null,
      "useMode": "timeline_overlay"
    }
  ],
  "soundEffects": [
    {
      "id": "sfx_1",
      "description": "room ambience falls silent",
      "startSec": 0,
      "endSec": 1.4,
      "useMode": "prompt_only"
    }
  ]
}
```

All timing should be shot-relative. That makes it usable for video prompts, lipsync calls, and timeline overlays.

`useMode` should allow:

```txt
prompt_only
native_dialogue
audio_lipsync
timeline_overlay
disabled
```

Default for anime can start as `timeline_overlay` once TTS exists, or `prompt_only` before TTS is generated. This is one of the decisions to audit.

## Audio Backend Routes

Add:

```txt
POST /api/projects/:id/write-audio-plan
```

Reads project mode, scenes, shots, cast, and script context. Writes `audio_plan` onto shots.

For anime, the route should:

- Preserve script intent.
- Extract or write dialogue per shot.
- Add useful SFX descriptions.
- Use shot-relative timestamps.
- Fit each line inside shot duration.
- Avoid inventing plot turns or new characters unless asked.

Add:

```txt
POST /api/projects/:id/generate-dialogue-audio
```

Generates TTS for selected dialogue lines using each character's voice fields.

Body options should support:

```json
{
  "shotIds": ["..."],
  "dialogueIds": ["..."],
  "characterIds": ["..."]
}
```

The route creates normal assets with category like:

```txt
dialogue_audio
```

Then writes `ttsAssetId`, `ttsStatus`, provider metadata, and timing back into `shot.audio_plan`.

Add/update:

```txt
PATCH /api/projects/:id/cast/:memberId
```

Ensure cast voice fields can be edited from UI and by Codex apply tools.

## Studio And Render Consumption

Do not solve all provider behavior before the Audio phase exists.

Once audio plans and TTS assets exist, Studio can decide per shot:

```txt
native_dialogue: send line text/emotion to provider prompt
audio_lipsync: send TTS audio to provider/lipsync path if supported
timeline_overlay: generate visuals without baked dialogue, then overlay in render
prompt_only: use line as acting context only
disabled: ignore for this generation
```

Render eventually needs to mix:

- Existing music bed for music videos.
- Dialogue audio assets.
- Sound effect audio assets if/when generated.
- Final video clips.

For v1, it is acceptable if generated TTS assets are visible/stored and not fully mixed yet, as long as the downstream choice is explicit. The audit question is whether v1 must render dialogue overlay, or whether it only needs to prepare TTS for provider/lipsync experiments.

## Workflow-Gated Phases

Extend `WorkflowRecipe.stages` in `server/presets.ts` to include Audio:

```txt
audioAnalysis
concept
script
style
cast
environments
audio
studio
render
```

States can stay:

```txt
required
optional
generated
user_supplied
preset_supplied
skipped
```

Suggested v1:

```txt
music_video.audio = optional or skipped
anime_scripted.audio = optional or required
```

Open decision: whether anime Audio is required before Studio, or whether artists can skip it and generate silent/visual shots first.

## Codex Harness Requirements

Codex should not guess the workflow from the chat. It should read the project packet/notebook.

Packets/notebooks should expose:

- `workflow_key`
- `preset_key`
- `seed_kind`
- workflow stage availability
- cast voice fields
- missing voice IDs
- shot audio plans
- dialogue lines without TTS
- dialogue lines with TTS assets
- useMode per dialogue line

Then Codex can say concrete things:

```txt
Audio phase is available for this anime project.
Mina has no voice_id yet.
Shot 3 has two dialogue lines, both pending TTS.
Shot 4 is set to timeline_overlay, so generated video does not need lipsync input.
```

## Frontend Requirements

Already done or in progress:

- Replace queue Dashboard with Start Project surface.
- Music Video card uploads audio.
- Anime card accepts script.
- Project header shows workflow/preset/seed mode.

Next frontend work:

- Fix copy mismatch if any button says "Open Studio" but routes to Blueprint.
- Update Blueprint to show/hide phases by workflow.
- Add Audio phase after Environments.
- Add character voice fields in the character editor.
- Add per-shot audio plan view/editor.
- Add Write Audio Plan button.
- Add Generate TTS buttons:
  - all dialogue
  - selected lines
  - selected character
  - selected shot
- Show `ttsStatus`, `voice_id` missing warnings, and `useMode`.
- Allow "Skip Audio" or "Mark Audio Ready" depending on workflow rules.

## Database And Infra Requirements

Use a fresh Supabase project for non-Lahari users. Do not point outside artists at the Lahari production DB.

New platform deployment should use:

```txt
DB_TABLE_PREFIX=studio
SUPABASE_BUCKET=studio-assets
```

The existing clean bootstrap migration should be updated with Audio fields before the new project is treated as stable. If the migration has already been run, add a follow-up additive migration.

Required infra checks:

- Studio app uses new Supabase URL/anon key.
- Backend uses new Supabase service key.
- Google OAuth redirect URLs point at new Railway/domain.
- `/connect` mints MCP tokens from `studio_mcp_tokens`.
- Hosted MCP endpoint points at new Railway URL.
- Codex can attach to a `studio_*` project.

## Prompt Work Still Needed

Prompt abstraction is only partially done.

Still needed before public/product prompt library:

- Regenerate or rewrite `server/prompts/catalog.ts` so it reflects current runtime prompts.
- Add audio-plan prompt to catalog once route exists.
- Keep prompt composition modular:

```txt
core task contract
+ workflow module
+ seed module
+ preset module
+ provider/model module
+ project overrides
```

Audio prompt should be workflow-aware:

- Anime: derive dialogue/SFX from script and shot plan.
- Music video: probably skipped by default; optional performance adlibs/SFX later.
- Future ads/reels: dialogue/VO may be first-class.

## Implementation Sequence

### Phase 0: Clean Current Lane

- Update `AGENTS.md` and `CLAUDE.md` references from `Dashboard.tsx` to `StartProject.tsx`.
- Fix any frontend copy mismatch around Anime routing to Blueprint vs Studio.
- Re-run `npx tsc --noEmit`, `npm run build`, and `git diff --check`.

### Phase 1: Audio Schema

- Add cast voice fields.
- Add `shots.audio_plan`.
- Add `shots.audio_plan_status`.
- Decide whether `projects.audio_phase_status` is needed now.
- Update `migrations/2026-05-13_create_studio_workspace_schema.sql`.
- Add a follow-up migration if the beta Supabase has already run the earlier schema.
- Update DB types/read/write helpers as needed.

### Phase 2: Workflow Recipe Update

- Add `audio` to `WorkflowRecipe.stages`.
- Set music video and anime availability.
- Expose audio stage state in project packets.
- Update notebook `AGENTS.md` generation to mention Audio phase availability.

### Phase 3: Audio Plan Backend

- Add `write-audio-plan` route.
- Add prompt builder/service for audio planning.
- Store per-shot `audio_plan`.
- Log AI call.
- Add Codex apply/preview shape if we want agent-side editing before write.

### Phase 4: TTS Backend

- Pick first TTS provider integration.
- Add `generate-dialogue-audio` route.
- Resolve voice fields from cast.
- Generate selected/all dialogue audio.
- Store assets as `dialogue_audio`.
- Write `ttsAssetId` and status back into `audio_plan`.
- Decide failure behavior per line: partial success should be allowed.

### Phase 5: Blueprint Audio UI

- Add Audio phase tab/section after Environments.
- Show cast voice editor.
- Show per-shot dialogue/SFX table.
- Add Write Audio Plan.
- Add Generate TTS.
- Add useMode control per dialogue line or per shot.
- Add warnings for missing voices.

### Phase 6: Codex Harness

- Add audio plan and voice data to project and shot packets.
- Add notebook sections for Audio phase.
- Update skills to understand audio status and not assume silent anime.
- Add apply tools if direct agent edits to audio plan are needed.

### Phase 7: Studio Consumption

- Update video prompt generation to include dialogue plan depending on `useMode`.
- For `native_dialogue`, send dialogue text/delivery in prompt.
- For `audio_lipsync`, pass TTS asset only when provider supports it.
- For `timeline_overlay`, keep TTS out of video provider and reserve it for render.
- Preserve per-shot override; do not make one global setting.

### Phase 8: Render Audio Mix

- Decide whether v1 render must mix generated dialogue.
- If yes, add dialogue tracks from `audio_plan` into render timeline.
- Keep SFX generation out unless needed; SFX descriptions can remain prompt context.

### Phase 9: Golden Path Tests

Music video:

```txt
Start Project -> Music Video -> upload audio
-> analysis
-> concept
-> script
-> style/cast/env
-> Studio shot generation
-> render
```

Anime:

```txt
Start Project -> Anime -> paste script
-> parsed scenes/shots/cast/env
-> assign voice IDs
-> write audio plan
-> generate TTS
-> generate at least one storyboard/video shot
-> choose one consumption path
-> render or verify stored assets
```

Codex harness:

```txt
Connect MCP
-> list projects
-> attach anime project
-> packet includes mode + audio phase
-> packet reports missing voices / pending TTS
-> notebook generation includes audio plan
```

## Open Decisions For Audit

1. Should anime Audio be required before Studio, or optional/skippable?
2. What is the default `useMode` after TTS generation: `timeline_overlay`, `audio_lipsync`, or manual choice?
3. Which TTS provider is first?
4. Are voice IDs raw provider IDs pasted by the user, or selected from a managed voice library?
5. Do we need `projects.audio_phase_status`, or are shot-level statuses enough?
6. Should audio plan live only on shots as JSON for v1, or should dialogue lines become their own table immediately?
7. Does v1 need final render overlay for dialogue, or just TTS asset generation plus Studio/lipsync experiments?
8. Should sound effects remain descriptive prompt context only for v1?
9. Do we let the audio plan rewrite dialogue text, or should it only preserve/extract script dialogue unless explicitly asked?
10. How much of Audio phase should Codex own versus the frontend UI?
11. Should music video expose Audio phase at all in v1?
12. Should anime style be fully preset-supplied, or should Style remain an editable Blueprint phase before Audio?

## Non-Goals For V1

- No ads/reels implementation.
- No generic workflow marketplace.
- No Lahari production DB migration.
- No complex tenant/white-label model.
- No full normalized audio graph unless JSON proves insufficient.
- No SFX audio generation unless a real client need appears.
- No assumption that every video provider supports lipsync or native dialogue.

## Definition Of V1 Done

V1 is done when:

- A new artist can sign in to the clean studio deployment.
- They can create a music-video project from audio.
- They can create an anime project from script.
- Both projects store correct workflow/seed/preset metadata.
- Blueprint adapts enough that anime does not feel like a broken music-video flow.
- Anime supports character voice IDs, audio plan generation, and TTS generation.
- Codex can attach to the clean DB project and understand mode + audio state.
- At least one anime shot can be generated with a clear dialogue strategy.
- Render path still works for music video and does not regress existing Studio/Render behavior.
