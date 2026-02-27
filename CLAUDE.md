# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm install          # Install dependencies
npm run dev          # Start both backend (port 3001) + frontend (port 3000)
npm run dev:server   # Backend only (Express + SQLite)
npm run dev:client   # Frontend only (Vite)
npm run build        # Production frontend build
npm start            # Production: serves built frontend + API from Express
```

No test framework configured. No linter configured.

Requires `GEMINI_API_KEY` and `ANTHROPIC_API_KEY` in `.env` — loaded server-side via `dotenv`. **Never exposed to client.**

## Architecture Overview

**Lahari Media Engine** — AI-powered devotional music video production tool.

See `docs/PIPELINE.md` for the comprehensive pipeline schematic with every AI call, its inputs, outputs, and storage locations. See `docs/architecture-map.html` for the visual architecture diagram.

### Client-Server Split

- **Frontend**: React 19 + TypeScript SPA (Vite, port 3000). No direct AI calls — everything goes through the API.
- **Backend**: Express 5 + SQLite (better-sqlite3) on port 3001. Holds all project state, generated assets, and makes AI API calls.
- **Proxy**: Vite proxies `/api` and `/storage` to the backend in development.
- **Storage**: Generated images/videos saved to `storage/` directory (git-ignored). Audio files also stored server-side.

Tailwind CSS loaded via CDN in `index.html`. Custom theme inline. Fonts: Outfit (body), Space Grotesk (display).

### Pipeline (4 Steps, Sequential Lock-in)

1. **Import** (`StepUpload.tsx`) → `POST /api/projects` uploads audio + runs analysis
2. **Blueprint** (`AnalysisEditor.tsx`) — 6-phase lock-in:
   - **Concept**: Choose from 3 AI-generated creative directions → lock
   - **Script**: Generate scene/shot hierarchy + propose cast + propose environments
   - **Style**: Brainstorm 4 text directions (Claude) → selectively visualize (Imagen 4) → lock + enrich DNA
   - **Characters**: Generate 3 looks per cast member (gemini-3-pro-image-preview with style ref) → lock
   - **Environments**: Generate 3 looks per environment (gemini-3-pro-image-preview with style ref) → lock
   - **Shot Prompts**: Auto-write visualPrompt + motionPrompt per shot with full locked context
3. **Studio** (`Storyboard.tsx`) — Sequential shot workflow:
   - Generate start frame (gemini-3-pro-image-preview with full reference chain)
   - Generate end frame (from start frame + motion prompt)
   - Lock shot (requires both frames) → unlocks next shot in scene
   - Generate video (Veo 3.1 with start + end keyframes)
4. **Render** (`StepRender.tsx`) — Client-side FFmpeg (WASM) stitches video clips + audio

### Backend Structure

```
server/
  index.ts              — Express entry, CORS, static serving
  db.ts                 — SQLite schema (projects, cast, environments, assets, scenes, shots, chat, ai_calls)
  storage.ts            — File I/O helpers (save/read base64, manage storage dirs)
  xray.ts               — AI call logging for debug transparency
  services/
    gemini.ts           — Text AI: audio analysis, concepts, shot critique, chat (Gemini 3 Pro)
    claude.ts           — Text AI: script planning, style brainstorm/refine/enrich, shot prompts, prompt compile (Claude Sonnet)
    imagen.ts           — Image gen: style exploration (Imagen 4), character/environment/shot frames (gemini-3-pro-image-preview)
    veo.ts              — Video gen: keyframe morphing (Veo 3.1)
  routes/
    projects.ts         — Project CRUD, cast management, environment management, shot updates, getFullProject
    generate.ts         — AI generation endpoints (styles, looks, script, shots, video, chat)
```

### Key API Endpoints

**Blueprint Phase:**
- `POST /api/projects` — Upload audio + create + analyze
- `POST /api/projects/:id/generate-concepts` — Generate 3 concept options (Gemini)
- `POST /api/projects/:id/lock-concept` — Lock chosen concept
- `POST /api/projects/:id/generate-script` — Generate script + propose cast + propose environments (Claude)
- `POST /api/projects/:id/brainstorm-styles` — Brainstorm 4 text style directions (Claude)
- `POST /api/projects/:id/visualize-style` — Generate single style image (Imagen 4)
- `POST /api/projects/:id/refine-style-direction` — AI-assisted style direction refinement (Claude)
- `POST /api/projects/:id/analyze-style-image` — Upload + analyze a reference image (Claude vision)
- `POST /api/projects/:id/lock-style` — Lock style image + enrich style DNA (Claude vision)
- `POST /api/projects/:id/unlock-style` — Revert to scripted for re-exploration
- `POST /api/projects/:id/generate-looks` — Generate 3 character look options (gemini-3-pro-image-preview)
- `POST /api/projects/:id/lock-character` — Lock character reference
- `POST /api/projects/:id/generate-environment-look` — Generate 3 environment look options (gemini-3-pro-image-preview)
- `POST /api/projects/:id/lock-environment` — Lock environment reference
- `POST /api/projects/:id/write-shot-prompts` — Bulk-write visualPrompt + motionPrompt with full context (Claude)

**Studio Phase:**
- `POST /api/projects/:id/shots/:shotId/generate-image` — Generate shot start frame (gemini-3-pro-image-preview, full ref chain)
- `POST /api/projects/:id/shots/:shotId/generate-end-frame` — Generate shot end frame from start frame + motion
- `POST /api/projects/:id/shots/:shotId/lock` — Lock shot (requires both start + end frame)
- `POST /api/projects/:id/shots/:shotId/generate-video` — Generate video (Veo 3.1, start + end keyframes)

**Utilities:**
- `POST /api/projects/:id/chat` — Chat with AI director (Gemini)
- `GET /api/projects/:id/xray` — X-Ray debug panel data
- `PATCH /api/projects/:id/shots/:shotId` — Update shot prompts/feedback

**CRUD:**
- `POST/PUT/DELETE /api/projects/:id/cast/:memberId` — Cast member management
- `POST/PUT/DELETE /api/projects/:id/environments/:envId` — Environment management

### AI Models (5 models, each with a distinct role)

| Model | ID | Role | Used For |
|-------|-----|------|----------|
| **Gemini 3 Pro** | `gemini-3-pro-preview` | Text analysis + vision | Audio analysis (lyrics, structure), shot critique, chat |
| **Claude Opus** | `claude-opus-4-6` | Creative direction | Concept generation, style brainstorm |
| **Claude Sonnet** | `claude-sonnet-4-6` | Structured text + planning | Meaning summary, script planning, style refine/enrich, shot prompt writing |
| **Gemini 3 Pro Image** | `gemini-3-pro-image-preview` | Image gen (multimodal) | Style visualization, character looks, environment looks, shot start/end frames |
| **Veo 3.1** | `veo-3.1-fast-generate-preview` | Video gen | Keyframe morphing with start + end frames |

### Image Generation

**gemini-3-pro-image-preview** — used for ALL image generation. Accepts reference images as inline data for visual consistency: style visualization, character looks (with style ref), environment looks (with style ref), shot frames (with full reference chain: characters + style + environment + continuity).

### Shot Frame Reference Chain (gemini-3-pro-image-preview)

Each shot's start frame is generated with a numbered reference index:
```
Image 1 = Character reference: Kolasura        (face, costume, identity)
Image 2 = Character reference: Mahalakshmi     (face, costume, identity)
Image 3 = Style reference                       (lighting, palette, texture)
Image 4 = Environment reference: Vaikuntha     (location, materials, ambience)
Image 5 = Continuity reference                  (previous shot's end frame)
```

Priority order: Character identity > Temporal continuity > Environment fidelity > Style fidelity

### Sequential Shot Workflow

Shots within a scene generate sequentially:
1. Generate start frame for shot 1
2. Generate end frame for shot 1 (from start frame + motion prompt)
3. Lock shot 1 (requires both frames)
4. Shot 2 now actionable — receives shot 1's end frame as continuity reference
5. Repeat until all shots in scene are locked
6. Scenes are independent — can work on scene 1 and scene 5 in parallel

### Database

SQLite at `storage/lahari.db`. WAL mode enabled. Foreign keys cascade on delete.

| Table | Purpose |
|-------|---------|
| `projects` | Core state: status, audio, lyrics, concept, style DNA, style asset |
| `cast_members` | Characters with name, description, reference_asset_id |
| `environments` | Locations with name, description, reference_asset_id |
| `scenes` | Narrative sections with timing, lyrics, description |
| `shots` | Per-shot state: prompts, image/video assets, status, locked, feedback, environment |
| `assets` | All generated files (images, videos) with category + file_path |
| `chat_messages` | Director chat history |
| `ai_calls` | X-Ray debug log of every AI call with inputs, outputs, cost |

### Frontend State

Single `ApiProject` state in `App.tsx` fetched from API. Style exploration state managed internally in `AnalysisEditor.tsx`. Look candidates held in App state until locked. All mutations go through API → server updates DB → returns full project via `getFullProject()`.

### Key Types (`types.ts`)

- `ApiProject` — Full project state from API (includes cast, environments, scenes, shots)
- `ProjectPhase` — Lock-in status: uploaded → analyzed → concept_locked → scripted → style_locked → characters_locked
- `VideoShot` — Shot with start/end frames, locked status, feedback, environment reference
- `CastMember` / `Environment` — Character/location with referenceImageUrl
- `ConceptOption` — Creative direction with mood, theme, visual suggestions

### Express 5 Quirks

- Route params return `string | string[]` — use `paramStr()` helper everywhere
- Catch-all routes use `/{*path}` not `*`

### Path Aliases

`@/*` maps to project root (tsconfig + vite config).
