# CLAUDE.md

Guidance for Claude Code when working in this repo. Keep this file compact. Full pipeline details live in `docs/pipeline-anatomy.md`; prompt inventory lives in `server/prompts/catalog.ts`; Codex-specific primer lives in `AGENTS.md`.

## Build & Run

```bash
npm install
npm run dev          # Backend :3003 (or PORT env), frontend :3002 (Vite proxies /api + /storage)
npm run dev:server   # Backend only
npm run dev:client   # Frontend only
npm run build        # Vite production build -> dist/
npm run lahari -- setup  # validate env/Supabase and register Lahari MCP in Codex + Claude Code
npm start            # Production: Express serves dist/ + /api + /storage from one origin
```

Renderer validation:

```bash
cd remotion-renderer && npm run build
```

Useful checks: `npm run build`, `npx tsc --noEmit`, `git diff --check`. There is no `npm run check`.

## Env Vars

- `GEMINI_API_KEY` - Gemini audio/vision and Gemini text-provider option. Not used for active image/video generation.
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY` - GPT-5.5 text-provider option and optional GPT script-writer experiment. Not used for active image/video generation.
- `SCRIPT_WRITER_PROVIDER=openai` (optional) - forces script generation to GPT-5.5 globally. The normal text-provider picker does not route script writing.
- `SEGMIND_API_KEY` - all active image/video generation: Nano Banana 2 images/storyboards/looks/frames and Seedance/Veo video.
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` - Postgres + Storage + song catalog.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` - frontend auth.
- `REMOTION_RENDERER_URL`, `RENDERER_SHARED_SECRET` - sibling renderer service and `x-renderer-secret`.
- `RENDER_ENGINE` (optional, default `ffmpeg`) - renderer engine. FFmpeg fast path falls back to Remotion when ineligible. Defaults: `FFMPEG_PRESET=veryfast`, `FFMPEG_CRF=23`, `FFMPEG_AUDIO_BITRATE=192k`.
- `GCP_PROJECT_ID`, `GCP_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS_JSON` - legacy only. Vertex video fallback is removed from the active path; `VIDEO_PROVIDER=vertex` / GCP creds must not route Lahari video calls to Vertex.

Production: https://lahari-media-engine-production.up.railway.app

## Non-Negotiables

Auth and ownership: Supabase Auth via `requireAuth`. Project route params verify `user_id === req.userId`. Child params and body IDs must stay scoped through route params and `scope-helpers.ts`. No null-owner bypass.

Simple mutations usually return `{ ok: true }` and frontend applies optimistic updates. AI/generate/refine/fork/analyze/fetch-style actions still return full project snapshots. Do not casually convert one shape to the other without checking frontend expectations.

Artist director work happens through deployed remote MCP, not inside this engine repo. `write_project_notebook` materializes an artist workspace with `mirrors/`, `drafts/`, `config/`, `journal.md`, AGENTS/CLAUDE files, and skills. `mirrors/` are read-only Supabase snapshots. `drafts/script.md` is editable; apply it with `apply_script_markdown`, which parses the strict markdown format, checks `scriptFingerprint` drift, validates references/durations, and persists through the atomic script apply path. `drafts/storyboards/<scene>.md` is the scene-level storyboard prompt + Seedance cut-plan surface; apply it with `apply_storyboard_scene_markdown` so prompt writing stays coherent across adjacent shots. `add_extra_shot` appends contextual inserts/B-roll as out-of-band `is_extra` shots under `Extra Shots`; `delete_extra_shot` is the safe removal path for unwanted inserts, not `apply_script`. Use the normal storyboard/video workflow afterward and place resulting videos manually from the Media Library. Remote MCP also exposes the paid visual reference lane: `generate_style_reference` / `lock_style_reference`, `generate_character_look` / `lock_character_look`, and `generate_environment_look` / `lock_environment_look`.

Prompt source-of-truth discipline:
- Runtime prompt changes must be reflected in `server/prompts/catalog.ts`.
- Pipeline behavior changes must update `docs/pipeline-anatomy.md`.
- Keep `CLAUDE.md` short; do not paste full prompt bodies or long endpoint inventories here.

## Route Ownership

`server/routes/generate.ts` is the composition layer. Param guards and scope helpers flow into mounted modules.

| Module | Owns |
|---|---|
| `generate.ts` | router composition, param guards, phase unlocks |
| `generate-style.ts` | style brainstorm/visualize/refine/lock/presets/upload |
| `generate-looks.ts` | character/env look gen, upload refs, lock/advance |
| `generate-script.ts` | script gen/refine/write-shot-prompts |
| `generate-shots.ts` | shot image/end-frame/storyboard/history/refs/split/lock |
| `generate-video.ts` | Segmind video gen, revert-video, chained prompt refresh |
| `scope-helpers.ts` | `paramStr`, `ScopeError`, `requireAsset/CastMember/Environment`, `atLeast` |

Other high-value routers: `projects.ts`, `queue.ts`, `render.ts`, `render-callback.ts`, `admin.ts`, `prompts.ts`.

## Pipeline Shape

Queue: `Dashboard.tsx` starts from `music_video_queue` + `songs`. Starting a row creates a project immediately, then background-runs audio download, SRT parse, transcription fallback, structure detection, and meaning summary. Analysis caches back onto `songs`. Multiple users can start the same queue item; `source_queue_id` links their own projects.

Blueprint: `AnalysisEditor.tsx` orchestrates Concept, Script, Style, Characters, Environments. Style presets in `server/style-presets.ts` lock curated Supabase images directly; preset image is ground truth and `style_description` is intentionally empty. Characters/environments use editable generation prompts and the locked style image as the visual anchor.

Studio: `Storyboard.tsx` orchestrates per-shot production. Keyframe mode uses `PromptToolkit` for first frame / last frame / video. Seedance mode uses `StoryboardPanel` and the two-step storyboard workflow below.

Render: `StepRender.tsx` posts the render-authoritative timeline snapshot to `/api/projects/:id/render`. Main backend inserts `lahari_renders` and calls the sibling renderer. Frontend polls `/render-status`.

## Providers

| Stage | Provider/model | Code |
|---|---|---|
| Audio transcription / structure | Gemini 3 Pro | `gemini.ts` |
| Concept/style/meaning/refines/storyboard planner | project `text_provider`: `claude-opus`, `gpt-5.5`, `gemini-3-pro` | `text-provider.ts` |
| Script writer | Claude Opus direct; optional GPT env/body experiment | `claude.ts`, `openai-script.ts` |
| Image generation | Segmind Nano Banana 2 for style refs, character/env looks, start/end frames | `segmind-image.ts`, `image-provider.ts` |
| Storyboard image | Segmind Nano Banana 2; legacy stored provider keys normalize to `nano-banana-2` | `storyboard.ts` |
| Video | Segmind Seedance/Veo variants | `video-provider.ts`, `segmind.ts` |

Text-provider routing does **not** include script writing. `planScenes`, `refineScript`, and `writeShotPrompts` stay on Claude Opus because they rely on extended thinking and validation/retry semantics.

## Seedance Storyboard Mode

This is a two-step pipeline.

1. `POST /write-storyboard-prompt` runs the text planner and saves `shot.storyboard_prompt`, `shot.storyboard_cut_plan`, and prompt status.
2. `POST /generate-storyboard` renders exactly the saved `storyboard_prompt` with `project.storyboard_provider` and locked refs. It does not re-plan.
3. `refine-storyboard` has two modes:
   - `replan` rewrites saved text only; artist clicks Generate afterward.
   - `edit_image` renders from current board + current prompt + artist instruction; text fields stay untouched.

Storyboard prompt rules:
- Keep prompts short and image-native.
- Per-panel action descriptions belong inside `storyboard_prompt`.
- Do not ask for visible panel numbers, captions, arrows, labels, or readable text.
- Thin borders are fine.
- `storyboard_cut_plan` may be empty; lock/image generation do not require it.

Storyboard mode ignores the old extracted-frame continuity chain and does not block on `prev_shot`. Optional continuity controls: `use_prev_storyboard_ref` and `include_prev_cut_plan`.

## Video Generation

All active video generation goes through Segmind. There is no active Vertex fallback; Segmind credit, rate-limit, model, or safety failures should surface honestly for the artist/operator to fix.

Seedance constraint: `first_frame_url` and `reference_images` are mutually exclusive. Keyframe mode prioritizes frame control. Storyboard mode sends no `first_frame_url`; it sends locked storyboard as `@image1` plus style/cast/environment refs.

Keyframe video prompt should stay mostly `motionPrompt` plus actually-attached ref labels. The start frame carries visual state; avoid stuffing scene/mood/cast prose back into the video prompt.

## Render Pipeline

Default `RENDER_ENGINE=ffmpeg`. FFmpeg is eligible only for video/image/audio items with standard cuts: no transitions, no visual effects, no custom positioning/transforms, no playback-rate changes, no overlapping visual clips. Ineligible timelines fall back to Remotion.

FFmpeg output: `libx264`, preset `veryfast`, CRF `23`, yuv420p, faststart, AAC audio. Asset pre-staging fetches remote media into `/tmp` and serves via loopback HTTP.

Render rows move through `lahari_renders` (`rendering`, `pending_finalize`, `completed`, `failed`) with progress/stage/error metadata. Use `/api/admin/active-renders` before renderer deploys when possible.

MCP/Director API calls write best-effort rows to `lahari_mcp_call_traces`. Use `/api/admin/mcp-traces?projectId=<id>&hours=24` when artist agents feel slow. Large `duration_ms` points to Lahari/tool/model latency; large `gap_since_previous_ms` points to Codex/Claude reasoning, file editing, notebook sync, or harness time between calls.

Timeline editor features currently include media library, video uploads, split-at-playhead, ripple delete, horizontal scroll, version append, and render history. Timeline drafts are sacred: regenerated shot clips and extra-shot videos feed the Media Library as new takes instead of rebuilding the artist's saved edit. Extra inserts/B-roll are created as out-of-band `is_extra` shots through `add_extra_shot`, then moved through the normal storyboard/video workflow; their videos are not auto-seeded into the render timeline. The render Media Library has a sidebar entry point, badges/new markers for clips not yet in the timeline, upload-to-library for external video clips, soft-hide for unwanted takes, and version append into the timeline. If timeline composition code changes, sync renderer copies with:

```bash
cd remotion-renderer && npm run sync-timeline
```

## Staleness

Upstream changes mark downstream `prompts_stale`; UI shows amber "Outdated". No auto-overwrite. Artist chooses rewrite/regenerate. Linear forward flow should not create noisy stale states.

Known caveat: `lahari_shots.prompts_stale` is shared by keyframe `visual_prompt` and storyboard `storyboard_prompt`. Rewriting one clears the shared flag. Future schema should split `visual_prompt_stale` and `storyboard_prompt_stale`.

## Database Pointers

Project fields to remember: `image_model`, `storyboard_provider`, `text_provider`, `video_model`, `source_queue_id`, `style_exploration`, `aspect_ratio`, `video_resolution`.

Shot fields to remember:
- keyframe: `visual_prompt`, `motion_prompt`, `end_visual_prompt`, `extracted_last_frame_asset_id`
- storyboard: `storyboard_prompt`, `storyboard_cut_plan`, `storyboard_prompt_status`, `storyboard_asset_id`, `storyboard_version_id`, `storyboard_locked`, `excluded_refs`, `use_prev_storyboard_ref`, `include_prev_cut_plan`
- shared: `direction`, `continuity_from`, `prompts_stale`, `last_error`

`lahari_storyboard_versions` still has legacy OpenAI-specific columns. Generic provider metadata is the important path now. Canonical cut-plan text lives on `lahari_shots.storyboard_cut_plan`; `metadata.cutPlanText` is legacy.

## Frontend Map

Blueprint:
- `AnalysisEditor.tsx` orchestrates phases.
- `BlueprintContextBar.tsx` owns top controls, including Text model / Image model / Storyboard image / Video model selectors.
- `ConceptPhase.tsx`, `ScriptPhase.tsx`, `StylePhase.tsx`, `CharactersPhase.tsx`, `EnvironmentsPhase.tsx`, `UnlockPill.tsx`.

Studio:
- `Storyboard.tsx` orchestrates scenes, bulk work, and modal state.
- `ShotCard.tsx` owns per-shot layout/media/action icons.
- `PromptToolkit.tsx` owns keyframe prompt tabs and @mention flow.
- `StoryboardPanel.tsx` owns Seedance prompt/image/video sub-tabs.
- `StudioHeader.tsx` owns scene pills, bulk actions, and stats.
- `ShotVersionHistory.tsx` owns frame/storyboard/video history tabs.

Use `components/Dropdown.tsx`; avoid native `<select>` in dark UI.

## Fork / Unlock Semantics

Phase unlocks are pure navigation. They rewind status and do not delete data.

Individual look unlocks clear one cast/env reference, expose persisted candidates, and mark dependent shots stale.

Destructive events happen on active mutation:
- `lock-concept` with changed concept and existing scenes can wipe downstream data or fork.
- `generate-script` rerun can wipe cast/scenes/prompts or fork.

Forks deep-copy project DB rows while sharing asset file paths. `forkProject()` lives in `server/routes/projects.ts`.

## Deployment

Railway project: `lahari-media-engine` (`a2ef8e79-f9ae-4dce-80e0-114d80e0a575`).

```bash
~/.local/bin/lahari-deploy
```

Migrations are additive. Apply migrations before deploying code that reads new columns. The deploy wrapper uses `RAILWAY_TOKEN_LAHARI` from `~/.zshrc`, so do not use raw `railway up` unless you intentionally want interactive Railway OAuth.

Current deploy source: `/Users/ssaulgoodman/Code/lahari-media-engine/lahari-codex-native` on `main`. The older `/Users/ssaulgoodman/Code/lahari-media-engine/lahari-media-engine` checkout is parked on `archive/old-main-worktree-20260613` and should not be used for production deploys.

## UI System

Use the typography/color tiers in `index.html`.

- Size tiers: `text-[11px]`, `text-xs`, `text-sm`, `text-lg`, `text-2xl`.
- Text colors: `text-white`, `text-zinc-300`, `text-zinc-400`.
- Avoid `zinc-500+` for body text on the dark background.

## Express / TS Notes

- Route params can be `string | string[]`; use `paramStr()`.
- Catch-all route is `/{*path}`, not `*`.
- Path alias: `@/*` -> project root.
