# AGENTS.md

Guidance for Codex when working in this repo.

## Workspace Layout

`/Users/ssaulgoodman/Code/lahari-media-engine/` is a parent folder, not the git repo root.

Current worktrees:

- `/Users/ssaulgoodman/Code/lahari-media-engine/lahari-media-engine` — main Lahari app checkout, usually for Claude Code / production work on `main`.
- `/Users/ssaulgoodman/Code/lahari-media-engine/lahari-codex-native` — Codex-native assistant-director worktree on `codex-native-studio`.

Do not switch the main checkout to `codex-native-studio` for Codex-native work. Open a Codex session in this `lahari-codex-native` worktree instead. Always confirm with `pwd` and `git status --short --branch` before editing.

## Build & Run

```bash
npm install
npm run dev          # Backend :3003 (or PORT env), frontend :3002 (Vite proxies /api + /storage)
npm run dev:server   # Backend only
npm run dev:client   # Frontend only
npm run build        # Vite production build → dist/
npm run lahari       # Codex-native Lahari CLI helpers
npm run lahari:mcp   # Codex-native Lahari MCP adapter
npm start            # Production: Express serves dist/ + /api + /storage from one origin
```

**Env vars required:**
- `GEMINI_API_KEY` — Turiya Tier-2 key. Used for Gemini image generation (`imagen.ts`) and Gemini audio/vision (`gemini.ts`). Not used for video.
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY` — required only when the project image model is `gpt-image-2`.
- `SEGMIND_API_KEY` — all video generation (Veo 3.1, Seedance 2.0) routes through Segmind
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — for ALL data: Postgres DB + Storage + song catalog
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — frontend auth (hardcoded in Dockerfile for build-time access, also in `.env` for local dev)
- `CORS_ORIGINS` — comma-separated in prod
- **Vertex AI legacy**: `GCP_PROJECT_ID=turiya-462513`, `GCP_LOCATION=us-central1`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`. Video gen now routes through Segmind — Vertex vars only matter if re-enabling direct Veo calls.

Production is deployed on Railway: https://lahari-media-engine-production.up.railway.app

**Auth**: Supabase Auth with Google OAuth (`contexts/AuthContext.tsx` + `lib/supabase.ts`). Backend verifies JWT via `requireAuth` middleware (`server/middleware/auth.ts`). All `/api/projects`, `/api/queue`, `/api/prompts` routes require auth. Admin routes use `x-admin-secret`. Health check is public.

**Ownership scoping** (3 layers):
1. **Project**: `router.param('id')` on both `projectsRouter` and `generateRouter` — verifies `user_id === req.userId`. No null-owner bypass.
2. **URL child IDs**: `router.param('shotId')` (traces shot→scene→project), `router.param('sceneId')`, `router.param('memberId')`, `router.param('envId')` — all verify the child belongs to the URL project.
3. **Body child IDs**: `requireCastMember()`, `requireEnvironment()`, `requireAsset()` helpers in generate.ts — validate body-supplied IDs against the URL project. Throw `ScopeError` with proper 403/404 status codes.

Queue routes: `publish` checks `project.user_id`, `start` checks ownership before returning an existing linked project.

**Minimal responses + Optimistic UI**: Simple mutations return `{ ok: true }` (with `status` for phase changes) instead of the full project. Frontend applies changes optimistically and reverts on failure. This eliminates ~20 `getFullProject` round-trips.

Minimal response endpoints: clear-frame, clear-end-frame, clear-extracted-frame, lock/unlock shot, PATCH shot/project/scene/concept, DELETE cast/environment, lock-character, lock-environment, advance-characters/environments, all unlocks.

Full `getFullProject` still used for: all generate/refine endpoints (AI work), fork, analyze-audio, revert-video, GET /:id, queue start/publish.

## Codex-Native Studio Mode

This branch is also a Codex-native production workspace. The Lahari web app stays the visual studio; Codex Desktop is the operator/director surface. Start with `docs/codex-native-studio.md` for the vision and current tool list.

The shared service for Codex tools is `server/services/codexStudio.ts`. The CLI and MCP are adapters around that service:

```bash
npm run lahari -- project list [limit]
npm run lahari -- project packet <projectId>
npm run lahari -- shot packet <projectId> <shotId>
npm run lahari -- project report <projectId> [out.md]
npm run lahari -- project contact-sheet <projectId> [out.html]
npm run lahari -- session attach <projectId> [note...]
npm run lahari -- session state <projectId>
npm run lahari -- session note <projectId> <note...>
npm run lahari -- session journal <projectId>
npm run lahari -- preview rewrite-shot-prompts <projectId> [note...]
npm run lahari -- apply-plan rewrite-shot-prompts <preview.json>
npm run lahari -- apply rewrite-shot-prompts <preview.json>
```

Generated local artifacts live under `.lahari/` and are intentionally ignored:

- `.lahari/codex/` — director reports and contact sheets
- `.lahari/sessions/<projectId>/` — `state.json` and `journal.md`
- `.lahari/previews/<projectId>/` — preview JSON/Markdown/runtime prompts

Permission boundary:

- Read-only inspection and local artifacts are safe to run.
- `preview rewrite-shot-prompts` is non-mutating but calls Claude, so ask before running it autonomously.
- `apply rewrite-shot-prompts` mutates Supabase and must be an explicit user-approved command. It requires a valid `SUPABASE_SERVICE_KEY`; Codex tools may fall back to `VITE_SUPABASE_ANON_KEY` for read-only work, but apply tools refuse anon fallback.
- Ask before paid generation, DB writes, lock/unlock changes, deletes, publish, or destructive rewrites.

Recommended fresh-session start:

1. `git status --short --branch`
2. Read `docs/codex-native-studio.md`.
3. `npm run lahari -- project list 10`
4. `npm run lahari -- session attach <projectId> "starting Codex director session"`
5. Generate a report/contact sheet before proposing any mutation.

## Architecture

**Lahari Media Engine** — AI-powered music video production tool for devotional songs. Integrates with a shared Supabase song catalog (see `music_video_queue` table).

- **Frontend**: React 19 + Vite (port 3002 dev). Tailwind via CDN.
- **Backend**: Express 5 (port 3003 dev, 3001 in prod Docker). Stateless — no local storage or SQLite.
- **Storage**: Supabase Storage bucket `lahari-assets`. Upload/download via `server/storage.ts`.
- **DB**: Supabase Postgres (`lahari_*` prefixed tables) via `server/database.ts` async adapter. Song catalog + music_video_queue in same Supabase project.

### Pipeline (4 steps)

1. **Queue** (`Dashboard.tsx`) — Songs from Supabase `music_video_queue` joined with `songs` table. Filter by deity/status, sort by duration. Click **Start** → creates a Lahari project quickly, then background work downloads audio/SRT, runs Gemini analysis when needed, and promotes to `analyzed`. Analysis cache on `songs` includes lyrics, structure, meaning, and song classification (`cached_song_type`, `cached_is_narrative`, `cached_is_meditative`).
2. **Blueprint** (orchestrated by `AnalysisEditor.tsx`) — 5 phases lock in creative direction:
   - Concept (Claude Opus, 3 options, regen with note)
   - Script (Claude Opus with extended thinking + validation, proposes cast + environments + scenes + shots)
   - Style (Claude brainstorm → image model visualize → style image lock; style image is ground truth)
   - Characters (image model, candidate history persisted)
   - Environments (image model, candidate history persisted)
   - Auto-writes shot prompts (Claude Opus) with full context at the end.
3. **Studio** (`Storyboard.tsx`) — Per-shot:
   - Generate start frame (Gemini 3 Pro Image with full ref chain)
   - Generate video (Veo 3.1 or Seedance 2.0 via Segmind)
   - ffmpeg extracts last frame → becomes continuity ref for next shot if `continuity_from === 'prev_shot'`
   - Lock shot (requires start + video)
4. **Render** (`StepRender.tsx`) — Timeline editor → `/api/projects/:id/render` → sibling Remotion renderer service → Supabase Storage → publish back to queue.

### AI Models

| Stage | Model | Service | Transport |
|-------|-------|---------|-----------|
| Audio analysis, vision describe | `gemini-3-pro-preview` | gemini.ts | Gemini Developer API (`GEMINI_API_KEY`) |
| Concept, script, script refine, style brainstorm, shot prompts | `claude-opus-4-7` | claude.ts | Anthropic API |
| Meaning, style refine, refineFramePrompt, refineMotionPrompt, refreshChainedShotPrompt | `claude-sonnet-4-6` | claude.ts | Anthropic API |
| Image gen default | `gemini-3-pro-image-preview` → fallback `gemini-3.1-flash-image-preview` | imagen.ts | Gemini Developer API |
| Image gen alt | `gpt-image-2` (`gpt-image-1.5` runtime) | openai-image.ts | OpenAI Images API |
| Video (default) | `veo-3.1-fast` ($0.10/s); `veo-3.1` ($0.20/s) | segmind.ts | Segmind API |
| Video (alt) | `seedance-2.0-fast` ($0.146/s); `seedance-2.0` ($0.182/s) | segmind.ts | Segmind API |

**All video gen via Segmind**: `segmind.ts` is the unified provider for all video models. Simple REST API — POST JSON with `x-api-key`, get video binary back. No polling. Requires `SEGMIND_API_KEY`. Veo models accept `image` + `last_frame` + `reference_images` URLs together. **Seedance constraint**: `first_frame_url` and `reference_images` are mutually exclusive — when start frame exists, frame mode is used and reference images are skipped. `ffmpeg.ts` provides `extractLastFrame` (provider-independent). Duration is rounded up to the smallest valid model duration.

**Why Segmind over Vertex**: Vertex AI's RAI safety filter silently blocks AI-generated frames (especially faces). Segmind proxies the same models with a different safety policy. Veo 3.1 Fast costs $0.10/s (vs $0.08/s on Vertex) — 25% premium for actually working. Seedance on Segmind is cheapest across all providers ($0.146/s Fast, $0.182/s Std).

### Video workflow (redesigned)

No end-frame prediction. Shot = start frame + motion prompt → video plays naturally → ffmpeg extracts real last frame. Next shot optionally uses that extracted frame as continuity reference (when Claude tagged `continuity_from = 'prev_shot'`). Most shots are hard cuts and generate in parallel.

**Sequential gate:** Only shots with `continuity_from === 'prev_shot'` wait for previous shot's video. Hard-cut shots are independently actionable.

**Bulk fan-out (throttled, multi-pass)**: `App.tsx` exposes three bulk actions — `Write prompts`, `Generate all frames (N)`, `Generate all videos (N)`. Under the hood `runWithConcurrency` caps parallel execution at **5 for videos**, **10 for frames**. Both bulk handlers use a **multi-pass loop**: after each pass completes, project state is refreshed from the server and newly unblocked `prev_shot` items are picked up automatically. Failed shots (ERROR status) are excluded from automatic requeue — artist sees them in UI and can retry manually.

**Chained-shot prompt refresh**: when a shot's video lands, if the *next* shot is tagged `prev_shot`, Claude Sonnet is called with the extracted last frame as an image input and rewrites the next shot's `visual_prompt` / `motion_prompt` so the hand-off is grounded in what really happened. Marks `refined_from_prev_frame = 1`. Cleared on manual prompt edit or user-feedback refine.

### Reference chain for shot start frame

Numbered inline images sent to Gemini 3 Pro Image:
- `Image N = Character: {name}` for each cast ref
- `Image N = Style reference`
- `Image N = Environment reference: {name}`
- `Image N = Last-scene continuity reference` (only if continuity_from === prev_shot)
- `Image N = PREVIOUS ATTEMPT (rejected). Problems: {feedback}` (only on regen with feedback)

Priority: character identity > continuity > environment > style. Explicit note: when style text conflicts with style image, follow the image.

### Generation prompt pattern (universal)

Every generatable entity (characters, environments, shots, end frames) follows the same two-mode edit pattern:

1. **Direct edit** — artist edits the `generation_prompt` field directly. What you see is what gets sent.
2. **Refine** — artist writes feedback, Claude (Sonnet) rewrites the `generation_prompt` from scratch. The rewritten prompt is saved and visible — artist can further edit before generating.

`generation_prompt` is the single source of truth. On first gen, it's auto-built from a default template (`buildCharacterPrompt` / `buildEnvironmentPrompt` in `imagen.ts`) + description + style DNA. After that, any edit or refine updates the saved prompt.

### Staleness detection

When upstream fields change (style DNA, concept, scene narrative, cast/env description), downstream `prompts_stale` flags are set. UI shows amber "Outdated" indicator. No auto-overwrite — artist decides when to rewrite. Cleared on regenerate/refine. Only fires when going back — linear flow never triggers.

### Pipeline anatomy

Full step-by-step trace of every prompt, every dependency, every control point: **[`docs/pipeline-anatomy.md`](docs/pipeline-anatomy.md)**. Living doc — update as pipeline evolves.

### Database

Supabase Postgres tables (all prefixed `lahari_`, see `server/database.ts` for the async adapter):
- `lahari_projects` — core state incl. `user_id` (auth ownership), `image_model`, `video_model`, `aspect_ratio`, `video_resolution`, `parent_project_id` (fork lineage), `source_queue_id`
- `lahari_scenes`, `lahari_shots` (with `direction`, `continuity_from`, `continuity_description`, `extracted_last_frame_asset_id`, `end_image_asset_id`, `end_visual_prompt`, `end_user_feedback`, `prompts_stale`)
- `lahari_cast_members` (with `generation_prompt`, `prompts_stale`), `lahari_environments` (with `generation_prompt`, `prompts_stale`), `lahari_assets` (with `shot_id` for video history), `lahari_chat_messages`, `lahari_ai_calls`
- All DB access goes through `server/database.ts`. Legacy `db.ts`, `veo.ts`, `fal.ts` have been deleted.

### Fork system

Fork deep-copies all DB rows under a new id with `parent_project_id = source`; asset file_paths are shared (zero disk bloat). Sidebar groups forks indented under parents with timestamps + delete. Helper: `forkProject(sourceId)` in `server/routes/projects.ts`. UI dialog: `DestructiveAction` state in `App.tsx` (`mode: 'fork'` for 3-button Fork/Overwrite/Cancel, `mode: 'simple'` for 2-button Confirm/Cancel).

**Unlock vs. switch semantics (important):**
- **All `unlock-*` endpoints are pure navigation** — they revert the phase marker only. No data is wiped. A user can unlock concept to browse alternatives without losing anything.
- **Destructive events happen on the active mutation**:
  - `lock-concept` with `{ fork?: boolean }` — if the new concept differs from the previous `locked_concept` AND scenes exist, server wipes scenes/cast/environments/style (or does so on the fork).
  - `generate-script` with `{ fork?: boolean }` — on re-run (scenes already exist), wipes cast + scenes + prompts.

**Fork-capable endpoints:** `lock-concept`, `generate-script` (re-run), `analyze-audio`. First-time gens and unlocks never open the dialog.

**Non-destructive** (no fork needed): all unlocks, `generate-concepts` (replaces options), `lock-style`, `generate-looks` / `generate-environment-look`, `write-shot-prompts`.

### Launch Studio shortcut

`handleLaunchStudio` in `App.tsx` skips `/write-shot-prompts` entirely if every shot already has `visualPrompt` set — clicking Launch Studio after returning from Blueprint no longer burns a Claude batch call. Script generation must leave `visual_prompt` empty; `direction` holds the narrative beat until `writeShotPrompts` writes the actual start-frame prompt. Deliberate bulk regen lives in the Studio header's "Rewrite all" button.

**Supabase tables (read-only from Lahari):**
- `songs` — 1490 songs with `audio_storage_url` / `drive_audio_url` plus cached Lahari analysis fields
- `files` — SRT files, etc. (Google Drive URLs)
- `music_video_queue` (Lahari's domain table) — song_id, priority, status, lahari_project_id, video_url

### Key API Endpoints

**Queue:**
- `GET /api/queue` — list with joined song data
- `POST /api/queue/:queueId/start` — pull audio + SRT, create Lahari project
- `PATCH /api/queue/:queueId` — update status / video_url

**Blueprint:**
- `POST /api/projects/:id/generate-concepts` (userNote optional)
- `POST /api/projects/:id/generate-script` (userNote optional)
- `POST /api/projects/:id/brainstorm-styles`, `visualize-style`, `refine-style-direction`, `analyze-style-image`, `lock-style`, `unlock-style`
- `POST /api/projects/:id/generate-looks`, `lock-character`, `advance-characters`
- `POST /api/projects/:id/generate-environment-look`, `lock-environment`, `advance-environments`
- `POST /api/projects/:id/write-shot-prompts`

**Studio:**
- `POST /api/projects/:id/shots/:shotId/generate-image`
- `POST /api/projects/:id/shots/:shotId/generate-video` (accepts `promptOverride`)
- `POST /api/projects/:id/shots/:shotId/refine-prompt` (vision + rewrite based on feedback, accepts multipart with referenceImage)
- `POST /api/projects/:id/shots/:shotId/refine-end-frame-prompt` (same pattern for end frame)
- `POST /api/projects/:id/shots/:shotId/lock` / `unlock`

**Utils:** `/api/projects/:id/chat`, `GET /api/projects/:id/xray`, `PATCH /api/projects/:id/shots/:shotId`, `POST /api/projects/:id/fork`, `POST /api/projects/:id/analyze-audio` (re-run analysis), `POST /api/projects/:id/shots/:shotId/use-prev-last-frame`, `POST /api/projects/:id/shots/:shotId/clear-frame`, `POST /api/projects/:id/shots/:shotId/clear-end-frame`, `POST /api/projects/:id/shots/:shotId/clear-extracted-frame`, `POST /api/projects/:id/upload-and-lock-style`, `POST /api/projects/:id/upload-character-reference`, `POST /api/projects/:id/upload-environment-reference`, `POST /api/queue/publish/:projectId` (multipart — uploads final render, walks fork chain, marks owning queue row `completed`)

**Admin diagnostics** (all behind `x-admin-secret: $ADMIN_UPLOAD_SECRET`):
- `GET /api/admin/env` — which env vars are set (values redacted). Primary tool for diagnosing Vertex/auth issues — confirms the running container sees `GCP_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, and whether the creds file was materialized.
- `GET /api/admin/usage?hours=N` — aggregates `ai_calls` by model+stage with totals and error counts.
- `GET /api/admin/errors?limit=N` — most recent error messages verbatim. Fastest way to tell what Veo (or anything) is rejecting.
- Migration endpoint removed — was `POST /api/admin/migrate-to-supabase`, used once on 2026-04-16.

### Queue completion writeback

When a render finishes in `StepRender`, the "Publish to queue" button POSTs the final mp4 blob to `/api/queue/publish/:projectId`. The server:

1. Saves the video to `/storage/videos/` and registers an `assets` row (category `final_render`).
2. Walks up `parent_project_id` locally to collect the fork-lineage.
3. Finds the Supabase `music_video_queue` row where `lahari_project_id` matches any id in that chain.
4. Updates that row: `status = 'completed'`, `video_url = <public url>`, `lahari_project_id = <this fork's id>` (latest-completed-wins).
5. Sets the local project's status to `'completed'` too.

If you want to change the resolution policy later, swap step 4 for: first-completed-wins (skip if already completed), or explicit-promote-only (no auto-update).

## Typography + color system

The `index.html` `<style>` block has a commented spec. Short version:
- **Size tiers (5)**: `text-[11px]` micro · `text-xs` small · `text-sm` body+tabs · `text-lg` heading · `text-2xl` display. No other sizes.
- **Color tiers (3)**: `text-white` primary · `text-zinc-300` body · `text-zinc-400` muted. Anything darker (zinc-500+) disappears on the dark bg — don't use for text.
- **Bg**: `#141418` (warm near-black, one step up from pure 950).

## Video models

Registry lives in `constants/videoModels.ts` and must stay in sync with `server/services/segmind.ts` (`SEGMIND_MODELS`). All four models route through Segmind:
- `veo-3.1-fast` — 8s fixed, $0.10/s, supports last frame
- `veo-3.1` — 4s/6s/8s, $0.20/s, supports last frame
- `seedance-2.0-fast` — 5s/10s, $0.146/s, supports last frame + up to 9 ref images
- `seedance-2.0` — 5s/10s, $0.182/s, supports last frame + up to 9 ref images

Pacing buttons in the Script phase are derived from the selected model's `durations`.

## Express 5 quirks

- Route params return `string | string[]` — use `paramStr()` helper
- Catch-all routes: `/{*path}` not `*`

## Path aliases

`@/*` → project root (in tsconfig + vite config)

## Deployment

Railway, Dockerfile at repo root. Stateless — all storage via Supabase. Push to deploy: `railway up --detach`. Project: `lahari-media-engine` (id `a2ef8e79-f9ae-4dce-80e0-114d80e0a575`). Dockerfile hardcodes `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (anon key is public) for Vite build-time access. Uses `--legacy-peer-deps` for Remotion/designcombo peer dep conflict.
