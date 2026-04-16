# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Build & Run

```bash
npm install
npm run dev          # Backend :3003 (or PORT env), frontend :3002 (Vite proxies /api + /storage)
npm run dev:server   # Backend only
npm run dev:client   # Frontend only
npm run build        # Vite production build → dist/
npm start            # Production: Express serves dist/ + /api + /storage from one origin
```

**Env vars required:**
- `GEMINI_API_KEY` — Turiya Tier-2 key. Used for Gemini 3 Pro Image (imagen.ts) and Gemini 3 Pro audio/vision (gemini.ts). **Not used by Veo anymore** — that migrated to Vertex AI.
- `ANTHROPIC_API_KEY`
- `FAL_KEY` — optional, only needed for Seedance 2.0 video gen
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — for song catalog / queue
- `CORS_ORIGINS` — comma-separated in prod
- **Vertex AI (for Veo)**: `GCP_PROJECT_ID=turiya-462513`, `GCP_LOCATION=us-central1`, `GOOGLE_APPLICATION_CREDENTIALS_JSON` (the full service-account JSON as a single-line string). `server/index.ts` boot hook materializes that JSON to `/tmp/gcp-credentials.json` and sets `GOOGLE_APPLICATION_CREDENTIALS` so the `@google/genai` SDK auto-picks it up.

Production is deployed on Railway: https://lahari-media-engine-production.up.railway.app

## Architecture

**Lahari Media Engine** — AI-powered music video production tool for devotional songs. Integrates with a shared Supabase song catalog (see `music_video_queue` table).

- **Frontend**: React 19 + Vite (port 3002 dev). Tailwind via CDN.
- **Backend**: Express 5 + SQLite via better-sqlite3 (port 3003 dev, 3001 in prod Docker).
- **Storage**: Local `storage/{audio,images,videos}/` — persisted via Railway volume in prod.
- **DB**: SQLite for Lahari's own state (projects, shots, assets). Supabase for the song catalog + music_video_queue.

### Pipeline (4 steps)

1. **Queue** (`Dashboard.tsx`) — Songs from Supabase `music_video_queue` joined with `songs` table. Filter by deity/status, sort by duration. Click **Start** → pulls audio + SRT from Supabase Storage, creates Lahari project.
2. **Blueprint** (`AnalysisEditor.tsx`) — 5 phases lock in creative direction:
   - Concept (Claude Opus, 3 options, regen with note)
   - Script (Claude Sonnet, proposes cast + environments + scenes + shots, tagged continuity_from, regen with note)
   - Style (Claude brainstorm → Gemini 3 Pro Image visualize → Claude vision enrich DNA)
   - Characters (Gemini 3 Pro Image, 3 parallel calls per char)
   - Environments (Gemini 3 Pro Image, 3 parallel calls per env)
   - Auto-writes shot prompts (Claude Sonnet) with full context at the end.
3. **Studio** (`Storyboard.tsx`) — Per-shot:
   - Generate start frame (Gemini 3 Pro Image with full ref chain)
   - Generate video (Veo 3.1 or Seedance 2.0 via fal.ai, start keyframe only)
   - ffmpeg extracts last frame → becomes continuity ref for next shot if `continuity_from === 'prev_shot'`
   - Lock shot (requires start + video)
4. **Render** (`StepRender.tsx`) — Client-side FFmpeg WASM stitches videos + audio.

### AI Models

| Stage | Model | Service | Transport |
|-------|-------|---------|-----------|
| Audio analysis, vision describe | `gemini-3-pro-preview` | gemini.ts | Gemini Developer API (`GEMINI_API_KEY`) |
| Concept, style brainstorm | `claude-opus-4-6` | claude.ts | Anthropic API |
| Meaning, script, style refine/enrich, shot prompts, refineShotPrompt, refreshChainedShotPrompt | `claude-sonnet-4-6` | claude.ts | Anthropic API |
| All image gen | `gemini-3-pro-image-preview` | imagen.ts | Gemini Developer API |
| Video (default) | Fast → `veo-3.0-fast-generate-001`; Std → `veo-3.0-generate-001` | veo.ts | **Vertex AI** (service-account) |
| Video (optional) | Seedance 2.0 Fast / Standard via fal.ai | fal.ts | fal.ai API |

**Veo via Vertex AI**: `veo.ts` auto-detects the transport via `isVertex()` which checks `GCP_PROJECT_ID`. When present, constructs a Vertex client (`new GoogleGenAI({ vertexai: true, project, location })`) and passes `generateAudio: false` (Vertex-only param — Developer API SDK throws on it). `VEO_MODELS` carries both `id` (Developer API) and `vertexId` (Vertex GA IDs); the correct one is picked per transport. Video download path also branches: Developer API uses `?key=`, Vertex mints a bearer token via `google-auth-library`.

### Video workflow (redesigned)

No end-frame prediction. Shot = start frame + motion prompt → video plays naturally → ffmpeg extracts real last frame. Next shot optionally uses that extracted frame as continuity reference (when Claude tagged `continuity_from = 'prev_shot'`). Most shots are hard cuts and generate in parallel.

**Sequential gate:** Only shots with `continuity_from === 'prev_shot'` wait for previous shot's video. Hard-cut shots are independently actionable.

**Bulk fan-out (throttled)**: `App.tsx` exposes three bulk actions — `Write prompts`, `Generate all frames (N)`, `Generate all videos (N)`. Under the hood `runWithConcurrency` caps parallel execution at **5 for videos**, **10 for frames** — a worker-pool that queues the rest. Sized for Vertex default ~60 RPM on Veo Fast and comfortable inside Tier-2 Gemini image RPM. Raise as Google auto-scales your quota.

**Chained-shot prompt refresh**: when a shot's video lands, if the *next* shot is tagged `prev_shot`, Claude Sonnet is called with the extracted last frame as an image input and rewrites the next shot's `visual_prompt` / `motion_prompt` so the hand-off is grounded in what really happened. Marks `refined_from_prev_frame = 1`. Cleared on manual prompt edit or user-feedback refine.

### Reference chain for shot start frame

Numbered inline images sent to Gemini 3 Pro Image:
- `Image N = Character: {name}` for each cast ref
- `Image N = Style reference`
- `Image N = Environment reference: {name}`
- `Image N = Last-scene continuity reference` (only if continuity_from === prev_shot)
- `Image N = PREVIOUS ATTEMPT (rejected). Problems: {feedback}` (only on regen with feedback)

Priority: character identity > continuity > environment > style. Explicit note: when style text conflicts with style image, follow the image.

### Database

SQLite tables (see `server/db.ts`):
- `projects` — core state incl. `video_model`, `aspect_ratio`, `video_resolution`, `parent_project_id` (fork lineage), `last_*_prompt` cached prompts, `style_exploration`
- `scenes`, `shots` (with `continuity_from`, `continuity_description`, `extracted_last_frame_asset_id`)
- `cast_members`, `environments`, `assets`, `chat_messages`, `ai_calls`

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

`handleLaunchStudio` in `App.tsx` skips `/write-shot-prompts` entirely if every shot already has `visualPrompt` set — clicking Launch Studio after returning from Blueprint no longer burns a Claude batch call. Deliberate bulk regen lives in the Studio header's "Rewrite all" button.

**Supabase tables (read-only from Lahari):**
- `songs` — 1490 songs with `audio_storage_url` / `drive_audio_url`
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
- `POST /api/projects/:id/shots/:shotId/refine-prompt` (vision + rewrite based on feedback)
- `POST /api/projects/:id/shots/:shotId/lock` / `unlock`

**Utils:** `/api/projects/:id/chat`, `GET /api/projects/:id/xray`, `PATCH /api/projects/:id/shots/:shotId`, `POST /api/projects/:id/fork`, `POST /api/projects/:id/analyze-audio` (re-run analysis), `POST /api/projects/:id/shots/:shotId/use-prev-last-frame`, `POST /api/projects/:id/shots/:shotId/clear-frame`, `POST /api/projects/:id/upload-and-lock-style`, `POST /api/projects/:id/upload-character-reference`, `POST /api/projects/:id/upload-environment-reference`, `POST /api/queue/publish/:projectId` (multipart — uploads final render, walks fork chain, marks owning queue row `completed`)

**Admin diagnostics** (all behind `x-admin-secret: $ADMIN_UPLOAD_SECRET`):
- `GET /api/admin/env` — which env vars are set (values redacted). Primary tool for diagnosing Vertex/auth issues — confirms the running container sees `GCP_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, and whether the creds file was materialized.
- `GET /api/admin/usage?hours=N` — aggregates `ai_calls` by model+stage with totals and error counts.
- `GET /api/admin/errors?limit=N` — most recent error messages verbatim. Fastest way to tell what Veo (or anything) is rejecting.
- `POST /api/admin/restore` — multipart tarball upload → extract to `/app/storage`. Kept around for migrations.

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

Registry lives in `constants/videoModels.ts` and must stay in sync with `server/services/veo.ts` (`VEO_MODELS`) and `server/services/fal.ts` (`FAL_VIDEO_MODELS`). Four keys:
- `veo-3.1-fast` — 8s fixed, cheapest
- `veo-3.1` — 4s/6s/8s variable, higher quality
- `seedance-2.0-fast` — 5s/10s via fal.ai
- `seedance-2.0` — 5s/10s via fal.ai, higher quality

Pacing buttons in the Script phase are derived from the selected model's `durations`.

## Express 5 quirks

- Route params return `string | string[]` — use `paramStr()` helper
- Catch-all routes: `/{*path}` not `*`

## Path aliases

`@/*` → project root (in tsconfig + vite config)

## Deployment

Railway, Dockerfile at repo root, persistent volume mounted at `/app/storage`. Push to deploy: `railway up --detach`. Project: `lahari-media-engine` (id `a2ef8e79-f9ae-4dce-80e0-114d80e0a575`).
