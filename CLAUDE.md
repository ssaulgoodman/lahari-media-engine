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
- `GEMINI_API_KEY` — Turiya tier-2 key
- `ANTHROPIC_API_KEY`
- `FAL_KEY` — optional, only needed for Seedance 2.0 video gen
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — for song catalog / queue
- `CORS_ORIGINS` — comma-separated in prod

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

| Stage | Model | Service |
|-------|-------|---------|
| Audio analysis, vision describe | `gemini-3-pro-preview` | gemini.ts |
| Concept, style brainstorm | `claude-opus-4-6` | claude.ts |
| Meaning, script, style refine/enrich, shot prompts, refineShotPrompt | `claude-sonnet-4-6` | claude.ts |
| All image gen | `gemini-3-pro-image-preview` | imagen.ts |
| Video (default) | `veo-3.1-fast-generate-preview` | veo.ts |
| Video (optional) | Seedance 2.0 Fast / Standard via fal.ai | fal.ts |

### Video workflow (redesigned)

No end-frame prediction. Shot = start frame + motion prompt → video plays naturally → ffmpeg extracts real last frame. Next shot optionally uses that extracted frame as continuity reference (when Claude tagged `continuity_from = 'prev_shot'`). Most shots are hard cuts and generate in parallel.

**Sequential gate:** Only shots with `continuity_from === 'prev_shot'` wait for previous shot's video. Hard-cut shots are independently actionable.

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
- `projects` — core state incl. `video_model`, `last_script_prompt`, `last_concept_prompt`
- `scenes`, `shots` (with `continuity_from`, `continuity_description`, `extracted_last_frame_asset_id`)
- `cast_members`, `environments`, `assets`, `chat_messages`, `ai_calls`

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

**Utils:** `/api/projects/:id/chat`, `GET /api/projects/:id/xray`, `PATCH /api/projects/:id/shots/:shotId`

## Express 5 quirks

- Route params return `string | string[]` — use `paramStr()` helper
- Catch-all routes: `/{*path}` not `*`

## Path aliases

`@/*` → project root (in tsconfig + vite config)

## Deployment

Railway, Dockerfile at repo root, persistent volume mounted at `/app/storage`. Push to deploy: `railway up --detach`. Project: `lahari-media-engine` (id `a2ef8e79-f9ae-4dce-80e0-114d80e0a575`).
