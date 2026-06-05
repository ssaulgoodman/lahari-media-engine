# AGENTS.md

Guidance for Codex when working in this repo. Keep this file aligned with `CLAUDE.md`, `docs/pipeline-anatomy.md`, `server/prompts/catalog.ts`, and the doctrine when pipeline behavior changes.

**Architectural context (read first):**
- `docs/codex-native-doctrine.md` — durable operating contract. Three editability tiers, MCP/CLI boundary, session-type protocol, distribution arc.
- `docs/codex-native-review-ledger.md` — current R# status, "Current State" snapshot at top, pending workstreams.

## Operating Principle

Supabase is canonical project truth. Local files in artist workspaces are desk copies and drafts for reading, editing, diffing, and handoff. `mirrors/` are read-only DB snapshots. `drafts/` are editable working copies that become production only when an apply tool persists them. `config/` is the editable project override layer.

**This repo is for engine work.** Code, prompts, infra, docs, schema, deployment. The artist-facing director surface lives in deployed Lahari — remote MCP at `/mcp`, materialized per-project workspaces via `mint_cli_token` + `npx @ssaulgoodman420/lahari-cli sync`, with `write_project_notebook` as the pure-MCP fallback. Internal MCP (`mcp/lahari.ts`) and CLI (`cli/lahari.ts`) exist here as engine-side debug + scripting tools, not as a director-session surface.

If you want to test director-session behavior, open any empty folder in Codex Desktop or Claude Code, mint a token at `/connect`, install the remote MCP. Same shape an artist gets. Don't try to do director work from inside this engine repo — that's a transitional pattern from before distribution shipped and it gives a falsely-comfortable shape.

The Lahari web app is the visual studio. Use deep links to it for visual approval moments instead of rebuilding visual review.

## Workspace Layout

`/Users/ssaulgoodman/Code/lahari-media-engine/` is a parent folder, not the git repo root. Multiple worktrees share one git history:

- `/Users/ssaulgoodman/Code/lahari-media-engine/lahari-media-engine` — main checkout, usually for Claude Code / production work on `main`. Railway deploys from `main`.
- `/Users/ssaulgoodman/Code/lahari-media-engine/lahari-codex-native` — Codex-native engine work on `codex-native-studio`. This is where most engineering happens.
- `/Users/ssaulgoodman/Code/lahari-media-engine/lahari-abstraction` — Mirage platform abstraction on the `abstraction` branch. New Supabase + Railway. See `docs/abstraction-platform-plan.md`. Engine fixes flow forward to this branch via merge; Mirage-specific work stays there.

Always confirm `pwd` and `git status --short --branch` before editing. Don't switch a worktree's branch to another worktree's branch.

## Where artists live

Artists do not use this repo. They mint a token at `https://lahari-media-engine-production.up.railway.app/connect`, paste an install snippet into Codex Desktop or Claude Code, restart their harness, open any empty folder, and ask "open <song name>." The agent attaches via remote MCP, calls `mint_cli_token`, and runs the returned shell-specific command to materialize the workspace (mirrors, drafts, config, journal, AGENTS.md, skills) inside that folder. On Windows, the returned PowerShell command wraps `npx` through `cmd /c` to avoid `npx.ps1` execution-policy blocks. If Windows/PowerShell/npm still blocks sync, the agent uses `get_project_notebook_manifest` + `read_project_notebook_file` to write the same files path-by-path. `write_project_notebook` remains the last pure-MCP fallback for small notebooks. No engine code on the artist's machine.

Current notebook contract:
- `mirrors/` are overwritten from Supabase and should not be hand-edited.
- `drafts/script.md` is the editable script working copy. Agents should make surgical file edits there, then call `apply_script_markdown`; the tool parses the draft, checks `scriptFingerprint` drift, validates references/durations, and applies through the atomic script RPC.
- `drafts/storyboards/<scene>.md` files are editable storyboard prompt + Seedance cut-plan working copies. Agents should write storyboard text scene-by-scene, then call `apply_storyboard_scene_markdown`; use single-shot JSON apply only for surgical fixes or automation payloads.
- `config/prompts/*.md` and `config/preferences.json` are project-level runtime overrides. Prompt kinds are `concept`, `script`, `shot_prompts`, `storyboard`, `video`, `character_looks`, and `environment_looks`. Edit locally, then persist with `apply_project_prompt_override` or `apply_project_preferences`.
- `apply_style_direction` lets director agents write style text natively and persist it before visualization. `generate_style_reference` / `lock_style_reference` and `generate_character_look` / `lock_character_look` / `generate_environment_look` / `lock_environment_look` expose the same paid visual reference flow artists use in Studio. `apply_shot_workflow_modes` lets agents set per-shot `auto | storyboard | keyframe` mode without changing whole-project defaults.
- `add_extra_shot` appends contextual inserts/B-roll as out-of-band `is_extra` shots under `Extra Shots`; agents should then use the normal storyboard/video workflow. `delete_extra_shot` is the only safe path for removing unwanted inserts; never use `apply_script` just to delete an extra shot. Extra-shot videos are media-library takes for manual timeline placement, not automatic timeline rebuild inputs.
- `journal.md` is local operator memory. Append concise decisions; do not treat it as canonical project state.
- Remote MCP exposes read-only artist memory tools: `query_artist_memory` for broad prior-work questions and `search_artist_assets` for style/storyboard/look/video assets. They are scoped to the authenticated artist and return curated evidence, not raw SQL.

Director-session work in *this engine repo* is a developer-only path — used for debugging, testing internal MCP changes, or operating against the canonical engine without going through Railway. Identical tool surface to remote, identical apply discipline.

## Build & Run

```bash
npm install
npm run dev          # Backend :3003 (or PORT env), frontend :3002 (Vite proxies /api + /storage)
npm run dev:server   # Backend only
npm run dev:client   # Frontend only
npm run build        # Vite production build -> dist/
npm run lahari -- setup  # validate env/Supabase and register Lahari MCP in Codex + Claude Code
npm run lahari       # Codex-native Lahari CLI helpers
npm run lahari:mcp   # Codex-native Lahari MCP adapter
npm start            # Production: Express serves dist/ + /api + /storage from one origin
```

Renderer validation:

```bash
cd remotion-renderer && npm run build
```

Useful checks in this repo: `npm run build`, `npx tsc --noEmit`, `git diff --check`. There is no `npm run check`.

## Env Vars

- `GEMINI_API_KEY` - Gemini audio/vision (`gemini.ts`) and Gemini text when the artist picks Gemini in the text-provider picker. Not used for active image/video generation.
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY` - GPT-5.5 text-provider option and optional GPT script-writer experiment. Not used for active image/video generation.
- `SCRIPT_WRITER_PROVIDER=openai` (optional) - forces `generate-script` to GPT-5.5 globally. Script writing is otherwise Claude Opus and is intentionally not routed through the text-provider picker.
- `SEGMIND_API_KEY` - all active image/video generation: Nano Banana 2 images/storyboards/looks/frames and Seedance/Veo video.
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` - Postgres + Storage + song catalog.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` - frontend auth.
- `CORS_ORIGINS` - comma-separated in prod.
- `REMOTION_RENDERER_URL`, `RENDERER_SHARED_SECRET` - sibling renderer service URL and `x-renderer-secret`.
- `RENDER_ENGINE` (optional, default `ffmpeg`) - Modal renderer engine. `ffmpeg` uses the fast FFmpeg concat path for eligible timelines and falls back to Remotion. `remotion` forces Remotion for everything. `FFMPEG_PRESET` default `veryfast`, `FFMPEG_CRF` default `23`, `FFMPEG_AUDIO_BITRATE` default `192k`.
- `GCP_PROJECT_ID`, `GCP_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS_JSON` - legacy only. Vertex video fallback is removed from the active path.

Production app: https://lahari-media-engine-production.up.railway.app

## Engine Session Protocol

**Before substantive work, read `docs/codex-native-doctrine.md`** for the operating contract (editability tiers, MCP/CLI boundary, harness-native vs tool-call, permission model, source-of-truth rules, distribution arc, discipline list). Cross-reference `docs/codex-native-review-ledger.md` "Current State" snapshot at the top for what's actually shipped and what's pending.

Sessions in this repo are engine sessions only — improving Lahari itself (code, prompts, infra, docs, schema, deployment). Director-session work (operating Lahari on a specific song) happens in artist-shaped workspaces against deployed Lahari, not here. See "Operating Principle" above.

### Engine Session Opening Move

1. `pwd` + `git status --short --branch` — confirm which worktree and which branch.
2. Skim the "Current State" snapshot at the top of `docs/codex-native-review-ledger.md` — know what's shipped, what's pending operationally, what the next workstream is.
3. Skim recent captured issues if any (`lahari_issues` table or `.lahari/issues/`).
4. Then ask the user what to build, fix, or review.

### When an engineer wants to experience director-session behavior

Open any empty folder in Codex Desktop or Claude Code, mint a token at `/connect` against your own Lahari account, paste the install snippet, restart the harness, ask "open <song name>." Same path an artist takes. That's the surface to test — not the internal MCP from inside this repo (the internal path bypasses real auth, real rate limits, real network conditions, and presents a falsely-comfortable shape).

### Full Operating Skill

The full director rubric (taste checks for concept/script/style/shots/assets, permission rules, output style examples) lives at `.agents/skills/lahari-director/SKILL.md`. Read it when giving creative feedback or proposing changes — it captures the production language and refusal patterns to follow.

## Internal Debug Surfaces

The shared service for Codex tools is `server/services/codexStudio.ts`. The CLI and MCP are adapters around that service:

```bash
npm run lahari -- project list [limit]
npm run lahari -- project packet <projectId>
npm run lahari -- project actions <projectId>
npm run lahari -- project hydrate <projectId> [outputDir]   # internal desk-copy primitive
npm run lahari -- project storyboard-review <projectId>
npm run lahari -- shot packet <projectId> <shotId>
npm run lahari -- project report <projectId> [out.md]
npm run lahari -- project sheet <projectId> <overview|style|references|storyboard|renders> [out.html]
npm run lahari -- project contact-sheet <projectId> [out.html]
npm run lahari -- session attach <projectId> [note...]
npm run lahari -- session state <projectId>
npm run lahari -- session note <projectId> <note...>
npm run lahari -- session journal <projectId>
npm run lahari -- preview rewrite-script <projectId> [note...]
npm run lahari -- preview rewrite-shot-prompts <projectId> [note...]
npm run lahari -- preview rewrite-storyboard-prompt <projectId> <shotId> [note...]
npm run lahari -- plan generate-storyboard <projectId> <shotId>
npm run lahari -- plan generate-video <projectId> <shotId>
npm run lahari -- apply-plan rewrite-script <preview.json>
npm run lahari -- apply-plan rewrite-shot-prompts <preview.json>
npm run lahari -- apply-plan rewrite-storyboard-prompt <preview.json>
npm run lahari -- apply rewrite-script <preview.json>
npm run lahari -- apply rewrite-shot-prompts <preview.json>
npm run lahari -- apply rewrite-storyboard-prompt <preview.json>
npm run lahari -- rollback rewrite-script <preview.json>
npm run lahari -- rollback rewrite-shot-prompts <preview.json>
npm run lahari -- rollback rewrite-storyboard-prompt <preview.json>
npm run lahari -- apply generate-storyboard <projectId> <shotId> [artist note...]
npm run lahari -- apply generate-video <projectId> <shotId> [prompt override...]
npm run lahari -- apply shot-prompts <projectId> <shots.json> [force]
npm run lahari -- apply storyboard-prompt <projectId> <shotId> <prompt.md> [cut-plan.md] [baseHash]
npm run lahari -- apply storyboard-prompts-bulk <projectId> <shots.json> [force]
npm run lahari -- apply storyboard-scene-markdown <projectId> <scene.md> [force]
npm run lahari -- apply concept <projectId> <concept.json> [baseHash]
npm run lahari -- apply video-prompt <projectId> <shotId> <motion-prompt.md> [baseHash]
npm run lahari -- apply script <projectId> <script.json> [baseFingerprint|force]
```

Generated local artifacts from internal debug commands live under `.lahari/` and are intentionally ignored:

- `.lahari/codex/` - director reports and contact sheets
- `.lahari/projects/<projectId>/` - local Codex workbench mirror (`brief.md`, `audio-analysis.md`, `script.md`, `storyboard-prompts.md`, snapshots)
- `.lahari/sessions/<projectId>/` - `state.json` and `journal.md`
- `.lahari/previews/<projectId>/` - preview JSON/Markdown/runtime prompts

Durable artist/operator decisions are written to Supabase `lahari_director_events`. Internal `session attach` reads new events since the last monotonic `seq` cursor and appends them into `.lahari/sessions/<projectId>/journal.md`; this is a developer/debug mirror, not the artist distribution path.

Remote artist notebooks use `lahari/projects/<projectId>/` instead of `.lahari/`. That folder is created by `npx @ssaulgoodman420/lahari-cli sync` using a short-lived project-scoped token, by the manifest + per-file MCP fallback, or by `write_project_notebook` final fallback, not by this repo's internal CLI.

**Realtime transport is shipped (R36):** `lahari_agent_operations` table tracks every non-readonly tool call (`status: running | success | error`, scoped to project/scene/shot), wired into both `/api/director/*` and `/mcp` `audited` wrappers. Web studio subscribes via Supabase realtime channel per project; renders a quiet pill in the header. See doctrine §6 reference. Frontend already subscribes to `postgres_changes` across 13 project-relevant tables for cascade refresh.

Permission boundary:

- Read-only inspection and local artifacts are safe to run.
- Preview commands are non-mutating but may call paid models, so ask before running them autonomously.
- Apply commands mutate Supabase and must be explicit user-approved commands. They require a valid `SUPABASE_SERVICE_KEY`; Codex tools may fall back to `VITE_SUPABASE_ANON_KEY` for read-only work, but apply tools refuse anon fallback.
- Ask before paid generation, DB writes, lock/unlock changes, deletes, publish, or destructive rewrites.

The CLI and in-process MCP are engine-side debugging surfaces — useful for scripts, audit inspection, disaster recovery, and one-off operations. They are **not** the director-session surface. The director surface for artists lives at deployed Lahari over remote MCP. Don't shoehorn director work through CLI here unless you are explicitly debugging the engine path.

## Architecture

**Lahari Media Engine** is an AI-assisted music-video production tool. It currently serves Lahari/devotional workflows, but do not hardcode future abstractions around Bhakti-only assumptions unless the product surface demands it.

- Frontend: React 19 + Vite, Tailwind via CDN.
- Backend: Express 5, stateless, Supabase-backed.
- Storage: Supabase Storage bucket `lahari-assets`; final renders currently live under `videos/<projectId>/...` in the configured render bucket.
- DB: Supabase Postgres, `lahari_*` tables via `server/database.ts`.

Auth: Supabase Auth with Google OAuth. Backend uses `requireAuth`. Project ownership is enforced at route params. Child URL/body IDs are scoped through route params and `scope-helpers.ts`. No null-owner bypass.

Generate router modules:

| Module | Owns |
|---|---|
| `generate.ts` | router composition, params, unlocks, mounts |
| `generate-style.ts` | style brainstorm/visualize/refine/lock/presets/upload |
| `generate-looks.ts` | character/env look gen, refs, lock/advance |
| `generate-script.ts` | script gen/refine/write-shot-prompts |
| `generate-shots.ts` | shot image/end-frame/storyboard/history/refs/split/lock |
| `generate-video.ts` | Segmind video gen, revert-video, chained prompt refresh |
| `scope-helpers.ts` | shared scoping helpers |

## Pipeline

1. **Queue** (`Dashboard.tsx`) - Supabase `music_video_queue` + `songs`. Start creates a project immediately and background-runs audio download, SRT parse, transcription fallback, structure detection, and meaning summary. Analysis caches onto `songs` so future users skip repeat AI calls. Multiple users can start the same queue item; `source_queue_id` links their own projects.

2. **Blueprint** (`AnalysisEditor.tsx`) - Concept, Script, Style, Characters, Environments.
   - Concept/style/refines use the project `text_provider` via `server/services/text-provider.ts`.
   - Script writing remains Claude Opus direct (`planScenes`, `refineScript`, `writeShotPrompts`) because it uses extended thinking plus a validation loop.
   - Style presets lock directly from curated Supabase images in `server/style-presets.ts`; preset style image is ground truth and `style_description` is intentionally empty.
   - Characters/environments use editable generation prompts and the locked style image as the visual ground truth.

3. **Studio** (`Storyboard.tsx`) - Per-shot production.
   - Keyframe mode: First frame / Last frame / Video / Full chain using `PromptToolkit`.
   - Seedance storyboard mode: `StoryboardPanel` replaces keyframe tabs with a two-step board workflow.
   - Shot-level refs, @mention prompt editing, generation/refine buttons, version history, lock/unlock all live here.

4. **Render** (`StepRender.tsx`) - Timeline editor sends a render-authoritative zustand snapshot to `/api/projects/:id/render`. Main backend creates a `lahari_renders` row and calls the sibling `remotion-renderer` service. Frontend polls `/render-status`.

## AI Models And Providers

| Stage | Model/provider | Code |
|---|---|---|
| Audio transcription / structure | Gemini 3 Pro | `gemini.ts` |
| Concept/style/meaning/refines/storyboard planner | Project `text_provider`: `claude-opus`, `gpt-5.5`, `gemini-3-pro` | `claude.ts` -> `text-provider.ts` |
| Script writer | Claude Opus 4.7 direct; optional GPT via env/body experiment | `claude.ts`, `openai-script.ts` |
| Image generation | Segmind Nano Banana 2 for style refs, character/env looks, start/end frames | `segmind-image.ts`, `image-provider.ts` |
| Storyboard image | Segmind Nano Banana 2; legacy stored provider keys normalize to `nano-banana-2` | `storyboard.ts` |
| Video | Segmind: Seedance 2.0 / Veo 3.1 variants | `segmind.ts`, `video-provider.ts` |

### Text Provider Routing

`project.text_provider` controls concept generation/refine, style brainstorm/refine, meaning summary, image-style analysis, frame/motion/chained refines, character/env look refines, and storyboard prompt writing.

It does **not** control script writing. Keep that as implementation knowledge, not persistent helper text under the Text model dropdown, unless the script stack is explicitly ported.

Implementation notes:
- `server/services/text-provider.ts` is the unified dispatcher.
- Anthropic uses tool-use for structured output.
- OpenAI uses JSON schema output; keep schemas compatible with OpenAI requirements.
- Gemini uses `responseSchema`/JSON mode and inline data for vision when needed.
- Refines use cheaper sibling models through `useRefineModel: true`.

## Seedance Storyboard Workflow

This is now a two-step pipeline, matching frame generation shape.

1. `POST /write-storyboard-prompt` runs the text planner and saves:
   - `shot.storyboard_prompt` - image-render prompt, including per-panel action descriptions inline.
   - `shot.storyboard_cut_plan` - panel beats for Seedance video.
   - `storyboard_prompt_status`.
2. `POST /generate-storyboard` renders exactly the saved `storyboard_prompt` with the selected `storyboard_provider` and locked refs. It does not re-plan.
3. `refine-storyboard` has two modes:
   - `replan` rewrites saved text only; artist renders explicitly afterward.
   - `edit_image` uses current board + refs + artist note to render a new board; text fields stay untouched.

Prompt rules:
- Keep storyboard prompts short and image-native. Per-panel actions belong inside `storyboard_prompt`; long "contract" bullet lists, animation rules, and quality boilerplate made outputs worse.
- Board panels are ordered left-to-right, then top-to-bottom.
- Do not ask for visible panel numbers, captions, arrows, labels, or readable text. Seedance can copy those into video.
- Thin panel borders are acceptable; they standardize boards.
- `storyboard_cut_plan` may be empty. Lock/image gen do not require it; empty cut plan means Seedance relies more on the board order.

Continuity:
- Storyboard mode ignores the old extracted-frame chain and does not block on `prev_shot`.
- Optional previous storyboard ref: `use_prev_storyboard_ref`.
- Optional previous cut-plan text context: `include_prev_cut_plan` (nullable means smart default from `continuity_from`).

## Video Generation

All active video generation goes through Segmind. There is no active Vertex fallback; Segmind credit, rate-limit, model, or safety failures should surface honestly for the artist/operator to fix.

Seedance constraint: `first_frame_url` and `reference_images` are mutually exclusive. Keyframe mode prioritizes frame control. Storyboard mode sends no `first_frame_url`; it sends locked storyboard as `@image1` plus style/cast/environment refs.

Keyframe video prompt is mostly `motionPrompt` plus actually-attached ref labels. Do not stuff scene/mood/cast prose into the video prompt; the start frame already carries the visual state.

## Render Pipeline

Render is async because real renders can exceed Railway request limits.

Flow:
1. `StepRender` posts timeline snapshot to `/api/projects/:id/render`.
2. Main backend inserts `lahari_renders`, returns `202`, and calls renderer service.
3. Renderer stages remote media to `/tmp`, serves it over loopback HTTP, renders, uploads mp4 to Supabase, and calls `/api/renders/callback/:renderId`.
4. Frontend polls status. Watchdog/reconciler handle stale rows and callback fallback.

Renderer engines:
- Default `RENDER_ENGINE=ffmpeg`.
- FFmpeg eligible: only video/image/audio items, no transitions, no visual effects, no custom positioning/transforms, no playback-rate changes, no overlapping visual clips.
- FFmpeg output: `libx264`, preset `veryfast`, CRF `23`, yuv420p, faststart, audio mixed with AAC.
- Ineligible timelines fall back to Remotion. Keep Remotion for future text effects, transitions, and richer layout work.

Timeline editor features include media library, video uploads, split-at-playhead, ripple delete, horizontal scroll, version append, and render history. Treat timeline drafts as sacred: regenerated shot clips and extra-shot videos should appear as new media-library takes, not overwrite or rebuild the artist's saved timeline. Extra inserts/B-roll are created as out-of-band `is_extra` shots through `add_extra_shot`, then moved through the normal storyboard/video workflow; their videos are not auto-seeded into the render timeline. The render Media Library has a sidebar entry point, badges/new markers for clips not yet in the timeline, upload-to-library for external video clips, soft-hide for unwanted takes, and version append into the timeline. Sync renderer timeline copies with `cd remotion-renderer && npm run sync-timeline` after changing upstream timeline composition code.

## Staleness

Upstream changes mark downstream `prompts_stale`; UI shows amber "Outdated". No auto-overwrite. Artist chooses rewrite/regenerate. Cleared when generation/refine/direct prompt edit updates the relevant prompt.

Known caveat: `lahari_shots.prompts_stale` is shared by keyframe `visual_prompt` and storyboard `storyboard_prompt`. Rewriting one clears the shared flag. Future schema should split `visual_prompt_stale` and `storyboard_prompt_stale`.

## Prompt Sources

`server/prompts/catalog.ts` is the read-only prompt catalog. It must stay in sync with runtime prompt changes in:

- `server/services/claude.ts`
- `server/services/openai-script.ts`
- `server/services/storyboard.ts`
- `server/services/seedance-storyboard-rd.ts`
- `server/routes/generate-video.ts`

`docs/pipeline-anatomy.md` is the step-by-step control-flow doc. Update it with any pipeline behavior change, especially prompt ownership, hidden dependencies, provider routing, and artist-visible control changes.

## Database Notes

Important project fields:
- `image_model`
- `storyboard_provider`
- `text_provider`
- `video_model`
- `source_queue_id`
- `style_exploration`
- render settings: `aspect_ratio`, `video_resolution`

Important shot fields:
- keyframe: `visual_prompt`, `motion_prompt`, `end_visual_prompt`, `extracted_last_frame_asset_id`
- storyboard: `storyboard_prompt`, `storyboard_cut_plan`, `storyboard_prompt_status`, `storyboard_asset_id`, `storyboard_version_id`, `storyboard_locked`, `excluded_refs`, `use_prev_storyboard_ref`, `include_prev_cut_plan`
- shared: `direction`, `continuity_from`, `prompts_stale`, `last_error`

`lahari_storyboard_versions` still has legacy OpenAI-specific fields (`openai_response_id`, `openai_image_call_ids`, `reasoning_model`) but generic provider metadata is now the important path. Canonical cut-plan text lives on `lahari_shots.storyboard_cut_plan`; `metadata.cutPlanText` is legacy.

## Key API Endpoints

Queue:
- `GET /api/queue`
- `POST /api/queue/:queueId/start`
- `PATCH /api/queue/:queueId`
- `PUT /api/queue/notes/:songId`

Blueprint:
- `POST /api/projects/:id/generate-concepts`, `refine-concept`
- `POST /api/projects/:id/generate-script`, `refine-script`
- `POST /api/projects/:id/brainstorm-styles`, `visualize-style`, `refine-style-direction`, `lock-style`, `lock-style-preset`, `upload-and-lock-style`
- `POST /api/projects/:id/generate-looks`, `generate-environment-look`, lock/advance/upload endpoints
- `POST /api/projects/:id/write-shot-prompts`

Studio:
- `POST /api/projects/:id/shots/:shotId/generate-image`
- `POST /api/projects/:id/shots/:shotId/generate-video`
- `POST /api/projects/:id/shots/:shotId/write-storyboard-prompt`
- `POST /api/projects/:id/shots/:shotId/generate-storyboard`
- `POST /api/projects/:id/shots/:shotId/refine-storyboard`
- `POST /api/projects/:id/shots/:shotId/lock-storyboard`, `unlock-storyboard`
- `PATCH /api/projects/:id/shots/:shotId/storyboard-plan`
- `GET /api/projects/:id/shots/:shotId/storyboard-history`
- `GET /api/projects/:id/shots/:shotId/history`
- `POST /api/projects/:id/shots/:shotId/split`
- shot ref upload/delete, frame clears, revert endpoints, scene lock-all/unlock-all

Render:
- `POST /api/projects/:id/render`
- `GET /api/projects/:id/render-status`
- `GET /api/projects/:id/renders`
- `POST /api/queue/publish/:projectId`
- `POST /api/queue/publish-url/:projectId` where available/preferred.

Admin diagnostics behind `x-admin-secret`:
- `/api/admin/env`
- `/api/admin/usage`
- `/api/admin/errors`
- `/api/admin/active-renders`
- `/api/admin/mcp-traces` — server-side MCP/Director API call trace with durations, response sizes, and between-call gaps. Use when artist agents feel slow; large `duration_ms` means Lahari/tool latency, large `gap_since_previous_ms` means agent/harness/file-editing time between calls.

## Deployment

Railway project: `lahari-media-engine` (`a2ef8e79-f9ae-4dce-80e0-114d80e0a575`). Deploy with:

```bash
~/.local/bin/lahari-deploy
```

This wrapper deploys from the main worktree with the project-scoped `RAILWAY_TOKEN_LAHARI` from `~/.zshrc`, so it does not depend on Railway's interactive OAuth session. If the wrapper is missing, run `source ~/.zshrc && lahari-deploy`. Before render-service deploys, check active renders via `/api/admin/active-renders` if possible.

Migrations are additive. Apply new migrations before deploying code that reads new columns (`text_provider`, storyboard prompt fields, render progress fields, etc.).

## UI System

Use the typography/color tiers in `index.html`.

- Size tiers: `text-[11px]`, `text-xs`, `text-sm`, `text-lg`, `text-2xl`.
- Text colors: `text-white`, `text-zinc-300`, `text-zinc-400`.
- Avoid native `<select>`; use `components/Dropdown.tsx`.
- Keep dark UI readable; avoid `zinc-500+` for body text.

## Express 5 / TS Notes

- Route params can be `string | string[]`; use `paramStr()`.
- Catch-all route is `/{*path}`, not `*`.
- Path alias: `@/*` -> project root.
