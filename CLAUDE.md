# CLAUDE.md

Guidance for Claude Code when working in this repo. Keep this file compact. Full pipeline details live in `docs/pipeline-anatomy.md`; current Mirage v1 task state lives in `docs/mirage-platform-v1-ledger.md`; the post-v1 convergence plan lives in `docs/mirage-convergence-ledger.md` and its port backlog in `docs/lahari-divergence-audit.md`; Codex-specific primer lives in `AGENTS.md`.

## Build & Run

```bash
npm install
npm run dev          # Backend :3003 (or PORT env), frontend :3002 (Vite proxies /api + /storage)
npm run dev:server   # Backend only
npm run dev:client   # Frontend only
npm run build        # Vite production build -> dist/
npm run lahari -- setup  # legacy internal setup helper; artists use deployed Mirage /connect instead
npm start            # Production: Express serves dist/ + /api + /storage from one origin
```

Renderer validation:

```bash
cd remotion-renderer && npm run build
```

Useful checks: `npm run build`, `npx tsc --noEmit --pretty false`, `npm run check:notebook`, `npm run smoke:agent-contract -- --repeat=1`, `git diff --check`. There is no broad `npm run check`.

## Env Vars

- `GEMINI_API_KEY` - Gemini image/audio/vision and Gemini text-provider option.
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY` - GPT-5.5 text-provider option, optional GPT script-writer experiment, and direct OpenAI-image fallback where enabled. Mirage's default `gpt-image-2` storyboard provider currently routes through Segmind BYOK.
- `SCRIPT_WRITER_PROVIDER=openai` (optional) - forces script generation to GPT-5.5 globally. The normal text-provider picker does not route script writing.
- `SEGMIND_API_KEY` - default video generation; also Nano Banana and GPT Image 2 image/storyboard rendering through Segmind.
- `KIE_API_KEY` - optional BYOK alternate video provider (Kie Veo / Gemini Omni). Segmind stays default.
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` - Postgres + Storage + song catalog.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` - frontend auth.
- `DB_TABLE_PREFIX` - backend table prefix. Mirage uses `studio`; Lahari uses `lahari`.
- `VITE_DB_TABLE_PREFIX` - frontend realtime table prefix. Defaults to `studio` in this Mirage lane; set to match `DB_TABLE_PREFIX` when needed.
- `REMOTION_RENDERER_URL`, `RENDERER_SHARED_SECRET` - sibling renderer service and `x-renderer-secret`.
- `RENDER_ENGINE` (optional, default `ffmpeg`) - renderer engine. FFmpeg fast path falls back to Remotion when ineligible. Defaults: `FFMPEG_PRESET=veryfast`, `FFMPEG_CRF=23`, `FFMPEG_AUDIO_BITRATE=192k`.
- Vertex fallback: `GCP_PROJECT_ID=turiya-462513`, `GCP_LOCATION=us-central1`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`. Only Veo fallback / legacy extraction paths need this.

Production Mirage app: https://mirage-platform-production-05ca.up.railway.app

## Non-Negotiables

Auth and ownership: Supabase Auth via `requireAuth`. Project route params verify `user_id === req.userId`. Child params and body IDs must stay scoped through route params and `scope-helpers.ts`. No null-owner bypass.

Do not casually change response shapes without checking frontend expectations. The agent/MCP path now uses lean receipts: changed notebook artifacts are returned as paths + hashes, not full bodies. Full project/notebook payloads are off-path debug/fallback surfaces, not routine reads.

Artist director work happens through deployed Mirage remote MCP, not inside this engine repo. Artist workspaces use a two-tier notebook:
- Workspace root: `AGENTS.md`, `CLAUDE.md`, `.agents/skills/`, `.claude/skills/`, `config/actions/*`, `config/skills.json`.
- Per project: `mirage/projects/<projectId>/state/`, `script.md`, `audio-plan.md`, `storyboards/*.md`, project `config/`, `notebook.json`, `journal.md`.

Remote MCP auth is OAuth-first where the harness supports it (`codex mcp login mirage` opens Mirage `/connect`). Bearer-token setup remains the fallback for clients without MCP OAuth. For file sync, use logged-in `mirage sync <projectId>` when the standalone CLI has a stored account token; otherwise call `mint_cli_token` and run the returned short-lived command. On Windows/Codex, install the CLI once so `npx` is not downloading code while holding a live token. `write_project_notebook` is a heavy fallback for no-shell harnesses. `state/` is read-only Supabase snapshots. `script.md` is editable for pre-visual scripts and broad topology rebuilds; apply it with `run_action(apply_script)` using markdown. Once refs, boards, or videos exist, use `run_action(apply_text_edits)` for wording-only scene title, shot direction, or dialogue edits, and `run_action(add_shot)` / `run_action(delete_shot)` for one-shot insert/delete inside an existing scene so visual groundwork survives.

Prompt source-of-truth discipline:
- Runtime prompt/action changes must keep the registry/composer/tool-recipe surfaces aligned: `server/services/actionRegistry.ts` for agent-visible actions, `server/resources/workflows/*` for named workflow recipes, `server/tools/registry.ts` for web availability, `server/prompts/*`, `/api/prompts`, `components/PromptsLibrary.tsx`, and the secondary reference `server/prompts/catalog.ts`.
- Agent-native intent is not a raw `userNote` pipe. Codex/Claude must translate artist chat into exact graph/spec edits, `contextOverrides`, precise `promptOverride`, `callInstruction`, `editInstruction`, or a project override before calling Mirage actions. `userNote` is legacy/web-direct only.
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

Start: `StartProject.tsx` is Mirage's primary intake surface. `music_led` projects start from uploaded audio. `scripted_narrative` projects, including the anime preset, start from pasted/uploaded script or related source material. The legacy queue adapter still exists behind `music_video_queue` + `songs`, but it is not the main Mirage frontend entry. To reuse prior work instead of re-asking the artist, `query_artist_memory` (prior projects: taste/format/model clues) and `search_artist_assets` (prior refs/renders/audio) are read-only, user-scoped cross-project tools.

Blueprint: `AnalysisEditor.tsx` now behaves as asset shelves for Concept, Script, Style, Characters, Environments, and Audio where available. Tool availability comes from `server/tools/registry.ts` and project `availableTools` / `blockedTools`, not status-stage branching. Mirage v1 does not expose legacy Lahari curated style presets. If clean workflow-specific curated styles return, `server/style-presets.ts` owns them; preset image is ground truth and `style_description` stays intentionally empty. Characters/environments use editable generation prompts and the locked style image as the visual anchor.

Studio: `Storyboard.tsx` orchestrates per-shot production. Keyframe mode uses `PromptToolkit` for first frame / last frame / video. Seedance mode uses `StoryboardPanel` and the two-step storyboard workflow below.

Render: `StepRender.tsx` posts the render-authoritative timeline snapshot to `/api/projects/:id/render`. Main backend inserts a prefix-mapped renders row and calls the sibling renderer. Frontend polls `/render-status`.

## Providers

| Stage | Provider/model | Code |
|---|---|---|
| Audio transcription / structure | Gemini 3 Pro | `gemini.ts` |
| Concept/style/meaning/refines/storyboard planner | project `text_provider`: `claude-opus`, `gpt-5.5`, `gemini-3-pro` | `text-provider.ts` |
| Script writer | Claude Opus direct; optional GPT env/body experiment | `claude.ts`, `openai-script.ts` |
| Image default | Gemini 3 Pro Image ("Nano Banana Pro") with flash fallback | `imagen.ts` |
| Image alternates | `nano-banana-2`, `gpt-image-2` | `segmind-image.ts`, `openai-image.ts` |
| Storyboard image | project `storyboard_provider`: default `gpt-image-2`; alternates `nano-banana-2`, `nano-banana-pro` | `storyboard.ts` |
| Video | Segmind Seedance/Veo (default); optional BYOK Kie (`kie-veo3`, `kie-veo3-fast`, `kie-gemini-omni-video`); Vertex fallback for Veo infra/billing only | `video-provider.ts`, `segmind.ts`, `kie-video.ts` |

Text-provider routing does **not** include script writing. `planScenes`, `refineScript`, and `writeShotPrompts` stay on Claude Opus because they rely on extended thinking and validation/retry semantics.

## Prompt / Tool Recipes

The current architecture is registry + composer, not a pile of fat prompt templates.

- `server/services/actionRegistry.ts` is the agent-visible action contract. `server/tools/registry.ts` is the older web/tool-availability registry. Keep both truthful when capability or availability changes.
- `server/prompts/*` and `server/prompts/_composer.ts` build worker-call context from explicit sources: task, selected project data, selected references, project override, call override, and output contract. Raw artist notes are for legacy web-direct helpers, not the agent-preferred path.
- `components/PromptsLibrary.tsx` is the Tool Recipes UI. It should show artist-readable tool behavior first; raw prompt/template references are secondary/debug.
- Avoid injecting workflow/preset enum labels into LLM prompt bodies. Logs may carry keys; prompts should receive human production language.
- Named workflow recipes live under `server/resources/workflows/*`. `list_workflows` / `apply_project_workflow` apply those recipes to a project; prompt overrides remain the under-the-hood save slot, not the workflow library.
- Saved personas are reusable identity seeds, not workflow recipes. `list_personas` / `save_persona` / `create_project_from_persona` own the WHO (character ref, style ref, voice, tone notes); the workflow recipe still owns the HOW.

## Seedance Storyboard Mode

This is a two-step pipeline.

1. `POST /write-storyboard-prompt` runs the text planner and saves `shot.storyboard_prompt`, `shot.storyboard_cut_plan`, and prompt status.
2. `POST /generate-storyboard` renders exactly the saved `storyboard_prompt` with `project.storyboard_provider` and locked refs. It does not re-plan.
3. `refine-storyboard` has two modes:
   - `replan` rewrites saved text only; artist clicks Generate afterward.
   - `edit_image` renders from current board + refs + a focused edit instruction; text fields stay untouched.

Storyboard prompt rules:
- Canonical Mirage storyboards are black-and-white sketch planning sheets: pure white paper, black ink/pencil, optional gray shading only. They are not final production art.
- Keep prompts short and image-native.
- Per-panel action descriptions belong inside `storyboard_prompt`.
- Do not ask for visible panel numbers, captions, arrows, labels, or readable text.
- Thin borders are fine.
- `storyboard_cut_plan` may be empty; lock/image generation do not require it.

Storyboard mode ignores the old extracted-frame continuity chain and does not block on `prev_shot`. Optional continuity controls: `use_prev_storyboard_ref` and `include_prev_cut_plan`.

## Video Generation

Routing is by provider-owned model spec (`resolveVideoModelSpec`). Segmind stays the default: Segmind model keys go to Segmind first (Veo may fall back to Vertex for infra/billing failures when configured; Seedance never does). `kie-*` model keys route to the Kie BYOK provider instead (no Vertex fallback).

Seedance constraint: `first_frame_url` and `reference_images` are mutually exclusive. Keyframe mode prioritizes frame control. Storyboard mode sends no `first_frame_url`; it sends locked storyboard as `@image1` plus style/cast/environment refs. Treat storyboard boards as sketch plans for staging/geography/timing; final video finish comes from locked style/cast/environment refs, not from the board's paper/ink treatment.

Keyframe video prompt should stay mostly `motionPrompt` plus actually-attached ref labels. The start frame carries visual state; avoid stuffing scene/mood/cast prose back into the video prompt.

## Render Pipeline

Default `RENDER_ENGINE=ffmpeg`. FFmpeg is eligible only for video/image/audio items with standard cuts: no transitions, no visual effects, no custom positioning/transforms, no playback-rate changes, no overlapping visual clips. Ineligible timelines fall back to Remotion.

FFmpeg output: `libx264`, preset `veryfast`, CRF `23`, yuv420p, faststart, AAC audio. Asset pre-staging fetches remote media into `/tmp` and serves via loopback HTTP.

Render rows move through `lahari_renders` (`rendering`, `pending_finalize`, `completed`, `failed`, `cancelled`) with progress/stage/error metadata. Status writes are compare-and-swap on current status, so a cancel isn't clobbered by a late finish; a render that completes after cancel is saved to history, not published. Use `/api/admin/active-renders` before renderer deploys when possible.

The render timeline is server-backed: browser edits autosave as a local draft, **Save** promotes the cut to the shared project timeline (`*_project_timelines`) with immutable version history, and **Restore**/**Reset** work off that history (timeline routes in `server/routes/render.ts`; Mirage keeps its shotId-keyed `reconcileSnapshotWithInitialClips`). Editor features include media library, split-at-playhead, ripple delete, horizontal scroll, and render history. If timeline composition code changes, sync renderer copies with:

```bash
cd remotion-renderer && npm run sync-timeline
```

## Staleness

Upstream changes mark downstream `prompts_stale`; UI shows amber "Outdated". No auto-overwrite. Artist chooses rewrite/regenerate. Linear forward flow should not create noisy stale states.

Known caveat: `lahari_shots.prompts_stale` is shared by keyframe `visual_prompt` and storyboard `storyboard_prompt`. Rewriting one clears the shared flag. Future schema should split `visual_prompt_stale` and `storyboard_prompt_stale`.

## Database Pointers

Canonical workflow values are `music_led` and `scripted_narrative`. Legacy rows may still contain `music_video` or `anime_scripted`; normalize at read boundaries and do not emit legacy keys in new artist-facing UI or MCP packets.

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

Reference-image bridge tools: in materialized artist notebooks, read root `config/actions/index.json` first, then the relevant surface file such as `config/actions/looks.json`; use `list_actions` only if those files are missing/stale or you need live server truth. Use `run_action` with `generate_candidates`, `list_candidates`, and `lock_reference` for cast/env references. For paid image generation, use `start_job` after artist approval. Style/look/storyboard generation supports different `contextOverrides` by handler: style and looks honor style/guide/style-note controls such as `includeStyleImage`, `styleAssetId`, `includeProjectStyleDescription`, and `styleNoteSections`; storyboard generation also honors cast/env/previous-board controls such as `excludeCastRefs`, `excludeEnvironmentRefs`, and `includePreviousStoryboard`. Video generation supports slot-level `contextOverrides` such as `includeShotBeat: true/false`, `includeCutPlan: false`, `includeRefs: false`, `includeFormat: false`, and `includeAudio: false`, and storyboard-mode video can also select attached refs with `includeEnvironmentRefs`, `excludeEnvironmentRefs`, `includeCastRefs`, `excludeCastRefs`, `includeStyleImage`, and `includePreviousStoryboard`; preview with `generate_video` dry-run before spending. Use `contextOverrides` for one call only; persist future shot defaults with `apply_shot_prompts({ videoPromptSlots })`. For style images, use `generate_style_candidates` and `apply_style_direction`; `identify_style` is hidden from the materialized agent surface and is only for live-MCP confirmation cases. For local/native images, POST multipart to `/api/agent/uploads` with the Mirage bearer token, then pass the returned `assetId` as `sourceAssetId` for use-as-is or `guideAssetId` for upload-as-guide. Legacy MCP tools are hidden by default; set `MIRAGE_MCP_INCLUDE_LEGACY_TOOLS=1` only for compatibility debugging.

Async job discipline: after `start_job`, return the job id and keep working unless the artist explicitly asks you to watch/poll. Studio realtime is the default progress surface; use `get_job` for deliberate checks, not habit loops.

Concept/script/style action bridge: prefer `run_action` for `apply_concept`, `apply_script`, `apply_text_edits`, `add_shot`, `delete_shot`, `apply_shot_prompts`, `apply_shot_workflow_modes`, `generate_style_candidates`, and `apply_style_direction`. `apply_script` accepts either structured `script` JSON or markdown from `script.md`; use it for fresh/broad topology, not post-visual wording cleanup or one-shot insert/delete. `apply_text_edits` only edits existing text fields and preserves refs/boards/videos while marking affected outputs stale. `add_shot` / `delete_shot` preserve other shots and only stale continuity-dependent neighbors; `delete_shot` refuses downstream work unless forced after approval, and forced deletes detach paid asset rows with recovery metadata instead of hard-deleting them. For uploaded style images, use `apply_style_direction({ style: { sourceAssetId } })` to lock the asset; Mirage auto-identifies style text when the project style description is empty/weak. Use hidden `identify_style` only through live MCP when you need artist confirmation before locking.

Storyboard action bridge: prefer `run_action` for `apply_storyboard_prompts`, `import_storyboard_image`, `lock_storyboard`, and `unlock_storyboard`. For local/native storyboard PNGs created by Codex imagegen, POST to `/api/agent/uploads` with `purpose=storyboard_image`, then call `import_storyboard_image({ shotId, sourceAssetId, lock: true })` to attach and approve that exact board. For paid storyboard generation/refine, use `run_action(generate_storyboard, { dryRun: true })` to inspect exact prompt/refs/params before spend when context matters, then `start_job` with `generate_storyboard` or `refine_storyboard_image` after artist approval. `bulk_generate_storyboards` is hidden from the materialized agent surface until proper async batch fan-out exists. Use `contextOverrides` on storyboard generation when the agent needs a one-off ref bundle rather than the shot's default style/cast/env/previous-board refs.

Video action bridge: for shot-specific diagnosis or generation prep, call `get_shot_context(projectId, shotId)` first; it returns the shot mode, refs, prompt payload summaries, saved slot defaults, generation eligibility, and next actions without full prompt bodies. Use `run_action(generate_video, dryRun: true)` for requirements/cost and the composed prompt anatomy, then `start_job(generate_video)` after approval. For storyboard-mode video, the dry-run composition shows `format`, `animation`, `beat`, `refs`, `cut_plan`, `audio`, and `guardrail` segments with source/edit paths; use `contextOverrides` to drop a segment or select refs for one call. Persist shot-level defaults for future Studio/agent regenerations with `apply_shot_prompts({ shots: [{ shotId, videoPromptSlots: { includeShotBeat: false, includeCutPlan: true } }] })`. HF music-video excludes the `beat` segment by default; pass `contextOverrides.includeShotBeat=true` only when the shot direction should be sent once, or persist `videoPromptSlots.includeShotBeat=true` when that shot should always send it. Example: `{ includeEnvironmentRefs: ["start_env_id", "destination_env_id"] }` attaches those env references to the storyboard video payload. Use `describe_prompt({ kind: "video" })` or `describe_prompt({ kind: "storyboard_render" })` to inspect exact full text that was actually sent on the latest generation/render. `describe_video_prompt` is a legacy alias only. `promptOverride` remains the exact final prompt escape hatch. `apply_video_prompt` only persists keyframe-mode motion prompt text; it does not generate media.

Paid-generation safety: a duplicate paid generation for the same shot is rejected with `409 generation_already_running` while one is in flight (`inFlightGeneration.ts`) — don't blindly retry. In-flight shot image/video generation can be locally cancelled (`cancel-image` / `cancel-video`); a provider output that lands after cancel is saved as a recoverable version, not promoted to the active frame/video.

Audio action bridge: prefer `run_action` for `apply_source_lyrics`, `apply_audio_plan`, and `apply_cast_voice`. Use `apply_source_lyrics` when canonical/artist-provided lyrics are better than a partial transcript, or when a long transcription regresses. Use `run_action(generate_dialogue_audio, { dryRun: true })` for TTS cost/missing voices, then `start_job(generate_dialogue_audio)` after approval. For native-dialogue video whose mouth timing works but voice is wrong, review the raw clip, run `run_action(voice_change_video, { dryRun: true })`, then `start_job(voice_change_video)` after approval; pass one whole-clip segment or explicit speaker cut ranges. `apply_audio_plan` accepts either structured `shots[]` or markdown from `audio-plan.md`.

System config action bridge: prefer `run_action` for `list_workflows`, `apply_project_workflow`, `apply_project_preferences`, `apply_project_style_notes`, `apply_project_prompt_override`, and `revert_project_prompt_override`. Use workflow recipes for named repeatable production formats such as Yapper or HF music-video sketch planning; the workflow action writes the project recipe/metadata through the existing config paths. If the same phrasing/technique keeps improving outputs, suggest promoting it to the relevant project style-note bucket; if the same complete recipe keeps working but is not a named format, suggest a project prompt override.

Destructive events happen on active mutation:
- `apply_script` is the broad topology rebuild path. After visual work exists, downstream wipes require the explicit `allowDownstreamVisualWipe` flag. Use `add_shot` / `delete_shot` for one-shot scene edits.
- `apply_concept` updates concept state and marks shot prompts stale; it is not a wipe/fork operation.

Forks deep-copy project DB rows while sharing asset file paths. `forkProject()` lives in `server/routes/projects.ts`.

## Deployment

Railway project: `lahari-media-engine` (`a2ef8e79-f9ae-4dce-80e0-114d80e0a575`).

```bash
railway up --detach
```

Migrations are additive. Apply migrations before deploying code that reads new columns. Railway CLI auth may expire; use `railway login` in a TTY if needed.

## UI System

Use the typography/color tiers in `index.html`.

- Size tiers: `text-[11px]`, `text-xs`, `text-sm`, `text-lg`, `text-2xl`.
- Text colors: `text-white`, `text-zinc-300`, `text-zinc-400`.
- Avoid `zinc-500+` for body text on the dark background.

## Express / TS Notes

- Route params can be `string | string[]`; use `paramStr()`.
- Catch-all route is `/{*path}`, not `*`.
- Path alias: `@/*` -> project root.
