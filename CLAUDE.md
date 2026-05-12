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
- `GEMINI_API_KEY` — Turiya Tier-2 key. Used for Gemini 3 Pro Image (imagen.ts), Gemini 3 Pro audio/vision (gemini.ts), AND Gemini 3 Pro text (when artist picks Gemini in the text-provider picker — see "Text provider routing" below).
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY` — used by: GPT-5.5 text-provider option (concept, style, refines, storyboard prompt), Seedance storyboard image renderer when `gpt-image-2` is the provider, and the optional GPT script-writer experiment.
- `SCRIPT_WRITER_PROVIDER=openai` (optional) — opt-in switch for `generate-script` only. The text-provider picker explicitly does NOT route script-writing (uses Anthropic extended thinking + a validation loop that doesn't port cleanly). Set this env to force GPT-5.5 for script gen globally. `OPENAI_SCRIPT_MODEL` overrides the model id.
- `SEGMIND_API_KEY` — all video generation (Veo 3.1, Seedance 2.0) routes through Segmind
- `RENDER_ENGINE` (optional, defaults `ffmpeg`) — engine selection on the Modal renderer. `ffmpeg` (default) uses the fast FFmpeg concat path for eligible timelines (no transitions, no visual effects, all standard cuts) and falls back to Remotion for the rest. `remotion` forces Remotion for everything. See `remotion-renderer/src/ffmpeg-render.ts` → `canRenderWithFfmpeg`. `FFMPEG_PRESET` (default `veryfast`), `FFMPEG_CRF` (default `26`), `FFMPEG_AUDIO_BITRATE` (default `192k`) tune the encode.
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — for ALL data: Postgres DB + Storage + song catalog
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — frontend auth (hardcoded in Dockerfile for build-time access, also in `.env` for local dev)
- `CORS_ORIGINS` — comma-separated in prod
- `REMOTION_RENDERER_URL`, `RENDERER_SHARED_SECRET` — URL of the `remotion-renderer` service (sibling deployment) and the shared HMAC-style secret used for `x-renderer-secret`. See `docs/remotion-renderer.md`.
- **Vertex AI (Veo fallback)**: `GCP_PROJECT_ID=turiya-462513`, `GCP_LOCATION=us-central1`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`. Used as a continuity-preserving backup when Segmind Veo calls fail with infra errors — see "Vertex fallback" below. Also used by `extractLastFrame` ffmpeg.

Production is deployed on Railway: https://lahari-media-engine-production.up.railway.app

**Auth**: Supabase Auth with Google OAuth (`contexts/AuthContext.tsx` + `lib/supabase.ts`). Backend verifies JWT via `requireAuth` middleware (`server/middleware/auth.ts`). All `/api/projects`, `/api/queue`, `/api/prompts` routes require auth. Admin routes use `x-admin-secret`. Health check is public.

**Ownership scoping** (3 layers):
1. **Project**: `router.param('id')` on `projectsRouter`, `generateRouter`, and `renderRouter` — verifies `user_id === req.userId`. No null-owner bypass.
2. **URL child IDs**: `router.param('shotId')` (traces shot→scene→project), `router.param('sceneId')`, `router.param('memberId')`, `router.param('envId')` — all verify the child belongs to the URL project.
3. **Body child IDs**: `requireCastMember()`, `requireEnvironment()`, `requireAsset()` helpers in `scope-helpers.ts` — validate body-supplied IDs against the URL project. Throw `ScopeError` with proper 403/404 status codes. `requireAsset` walks the fork chain (parent_project_id) for legacy forked projects.

Queue routes: `publish` + `publish-url` check `project.user_id`, `start` checks ownership before returning an existing linked project.

**Minimal responses + Optimistic UI**: Simple mutations return `{ ok: true }` (with `status` for phase changes) instead of the full project. Frontend applies changes optimistically and reverts on failure. This eliminates ~20 `getFullProject` round-trips.

Minimal response endpoints: clear-frame, clear-end-frame, clear-extracted-frame, lock/unlock shot, PATCH shot/project/scene/concept, DELETE cast/environment, lock-character, lock-environment, advance-characters/environments, all unlocks.

Full `getFullProject` still used for: all generate/refine endpoints (AI work), fork, analyze-audio, revert-video, GET /:id, queue start/publish.

## Architecture

**Lahari Media Engine** — AI-powered music video production tool for devotional songs. Integrates with a shared Supabase song catalog (see `music_video_queue` table).

- **Frontend**: React 19 + Vite (port 3002 dev). Tailwind via CDN.
- **Backend**: Express 5 (port 3003 dev, 3001 in prod Docker). Stateless — no local storage or SQLite.
- **Storage**: Supabase Storage bucket `lahari-assets`. Upload/download via `server/storage.ts`.
- **DB**: Supabase Postgres (`lahari_*` prefixed tables) via `server/database.ts` async adapter. Song catalog + music_video_queue in same Supabase project.

### Backend route modules

The generate router (`server/routes/generate.ts`) is a thin composition layer that owns param validators, unlocks, and mounts the extracted route modules:

| Module | What |
|--------|------|
| `generate.ts` | Router, `param('id'/'shotId'/'sceneId')` guards, phase unlocks, legacy generate-styles, chat, mounts |
| `generate-style.ts` | Style brainstorm, visualize, refine, lock, upload-and-lock, analyze-style-image |
| `generate-looks.ts` | Character + env look gen, upload refs, lock, advance phases |
| `generate-script.ts` | Script gen (extended thinking + validation), refine, write-shot-prompts |
| `generate-shots.ts` | All shot-level: image gen, end frame, refine prompts, clear/revert, lock/unlock, scene lock, refs, history, split (largest module) |
| `generate-video.ts` | Video gen (Segmind), revert-video, chained-shot refresh |
| `scope-helpers.ts` | Shared: `paramStr`, `ScopeError`, `requireAsset/CastMember/Environment`, `parseTimestamp`, `atLeast` |

All modules mount on the same router instance — param validators and scope helpers are inherited. Other routers: `projectsRouter` (projects.ts), `queueRouter` (queue.ts), `renderRouter` (render.ts), `promptsRouter` (prompts.ts).

### Pipeline (4 steps)

1. **Queue** (`Dashboard.tsx`) — Songs from Supabase `music_video_queue` joined with `songs` table. **Action-vocabulary UI**: each row has one verb button — `Start` (first time), `Continue` (your WIP exists), `Open` (your fork is published), `Needs audio` (disabled). Filter chips at the top use the same vocabulary (`All / Start / Continue / Open`) with inline counts. Per-user fork stats (`others_done`, `others_wip`, `has_active_fork`, `has_done_fork`) are computed server-side in a single aggregation over `lahari_projects` partitioned by current user. Green + amber dots in the Pipeline column show how many other artists have published / are still WIP for the same song. Click **Start** → creates Lahari project immediately (title + queue link only), responds instantly. **Everything runs in background**: audio download from Supabase Storage, SRT parsing (`[M:SS]` timestamps preserved), Gemini audio transcription fallback, structure detection, meaning summarization. Project starts as `status: 'analyzing'`; background promotes to `analyzed` once audio is downloaded (cached path) or full analysis completes. Audio download failure sets `error` status. Frontend polls until done. **Analysis caching**: lyrics/structure/meaning cached on `songs` table (`cached_lyrics`, `cached_structure`, `cached_meaning`) — subsequent users skip AI calls (still need audio download). **Multi-user**: `source_queue_id` on projects lets multiple users work on the same queued song independently. **No auto-fork**: clicking Start on a queue row where another user already has a project creates a **fresh** project for the current user — silent fork-from-another-user was removed (queue.ts comment block). When multi-user fork-from-someone-else is needed, it will live as an explicit affordance, not silent queue-Start behavior.
2. **Blueprint** (7 components, orchestrated by `AnalysisEditor.tsx`) — 5 phases lock in creative direction:
   - Concept (Claude Opus, 3 options, regen with note)
   - Script (Claude Opus with **extended thinking** — reasons through pacing math before writing. Validation loop retries if shot counts don't fit scene durations. Max 3 attempts, hard fail. **Director mode**: Montage (standalone visual moments, hard cuts) vs Cinematic (flowing continuity, connected movement) — Claude receives explicit guidance on shot style.)
   - Style (Claude brainstorm → image visualize → Claude vision enrich DNA. **Style image is ground truth** — no style DNA text sent to the image model.) **Curated style presets**: 4 pre-canned style frames (see `server/style-presets.ts`) with curated anchor preview images in Supabase at `styles/presets/<key>.png` (backed up in repo at `docs/assets/style-presets/`). **Presets lock DIRECTLY** — one click on a preset card calls `POST /lock-style-preset { presetKey }` which points a new project-scoped asset row at the preset's shared `previewImagePath` (same file_path pattern as forks) and runs the standard `/lock-style` downstream-stale logic. No visualize / re-render step. `style_description` is intentionally empty for preset locks (the curated image is ground truth; storing description prose would leak into the concept-regen hint path). The old `/visualize-style-preset` endpoint was removed — it was generating fresh images from description text and ignoring the curated PNG entirely. `/lock-style` (brainstorm slots, uploads) still marks downstream stale; first-lock is a no-op.
   - Characters — unified toolkit: Ref chips (style image) → Prompt (editable) → Generate → Refine. Description collapsed.
   - Environments — same unified toolkit pattern as characters.
   - Auto-writes shot prompts (Claude Opus) with full context at the end.
3. **Studio** (6 components, orchestrated by `Storyboard.tsx`) — Per-shot unified toolkit:
   - **First frame** — visual prompt + refs + generate (Gemini) + AI refine
   - **Last frame** — end visual prompt + generate end frame + AI refine
   - **Video** — motion prompt (editable, the video instruction sent to Veo) + generate (Veo/Seedance) + AI refine
   - **Full chain** — read-only diagnostic view of the complete prompt chain
   - **Seedance storyboard mode** — replaces keyframe tabs with `StoryboardPanel`. **Two-step pipeline**: (1) `POST /write-storyboard-prompt` runs the text planner (model picked by `project.text_provider`) → saves `shot.storyboard_prompt` (the image-render prompt, INCLUDES per-panel action descriptions inline so the image model knows what to draw in each panel) and `shot.storyboard_cut_plan` (panel beats reformatted for Seedance). Both editable inline. Prompts are deliberately short — the planner instruction caps storyboardPrompt at ~300 words and forbids "contract" bullet lists / animation rules / quality boilerplate that confused the image model. (2) `POST /generate-storyboard` renders the board via the project's `storyboard_provider` (`nano-banana-2` default, `nano-banana-pro` for Google's gemini-3-pro-image-preview, or `gpt-image-2`) using **only** the storyboard prompt + locked refs. Cut plan is NOT sent to the image renderer. Refine has two modes: **Redo** (`replan`) re-runs the planner; artist must click Generate after to render a new image. **Edit** (`edit_image`) calls the image provider directly with the previous storyboard image + current prompt + artist edit instruction; text fields untouched. Lock and image gen do NOT require a cut plan — artist can deliberately empty it to fall back to Seedance's "follow storyboard order" default. After cast/env edits in Script, `prompts_stale = true` propagates; UI surfaces an "Outdated" pill on the prompt label, an amber ring on Rewrite, and an amber dot on Generate. Rewrite clears the flag. Bulk **Board images** button regenerates any unlocked board (rendered or not); only locked shots are skipped. **Per-shot continuity (opt-in):** the chip row has a `+ Prev storyboard` button (disabled when no prev shot in scene or prev has no board) — toggles `shot.use_prev_storyboard_ref`. When on, the previous shot's locked storyboard is attached as vision input to the planner AND as an `@imageN` ref to the image renderer. Separate "Include previous cut plan as text context" checkbox (`shot.include_prev_cut_plan`, nullable for smart-default) prepends prev shot's cut plan to the planner as text. Smart default: checked when `continuity_from === 'prev_shot'` AND a prev shot exists. **Sub-tab ↔ media sync:** clicking Storyboard / Video sub-tabs (or the toolbar Storyboard / Video buttons in the shot card header) swaps both the controls AND the media displayed above. Single source of truth lifted to `ShotCard`'s `storyboardSubTab` state; toolbar and panel buttons stay in lockstep. Initial sub-tab defaults to `video` if `videoUrl` exists on mount.
   - All tabs follow same pattern: Refs → Prompt (with @mention) → Generate → Refine
   - @mention picker in prompt area: type `@` to reference Style, characters, environments
   - Version history panel with 4 tabs (First frame / Last frame / Storyboard / Clip) — revert to any previous generation
   - Lock shot (requires start + video)
4. **Render** (`StepRender.tsx`) — Artist arranges shots + applies effects/transitions in the timeline editor (`components/timeline-editor/`). Render button POSTs the render-authoritative subset of the editor's zustand store to `/api/projects/:id/render`, which proxies to the sibling `remotion-renderer` service (Hono + Remotion SSR + FFmpeg fast path, own Docker image).

   **Render gate** (top-nav Render tab) is data-derived — accessible the moment ANY shot has a `videoUrl`, not based on `project.status` string. Fixes the case where status drifted (forks, legacy projects) but the artist has rendered material to assemble. (`in_production` status is intentionally not gated on; `lahari_projects.status` is never updated to it server-side — known dead state.)

   **Engine selection on Modal renderer**: default `RENDER_ENGINE=ffmpeg`. The renderer calls `canRenderWithFfmpeg(inputProps)` on each job. Eligible timelines (no transitions, no visual effects, no playback-rate changes, no overlapping clips, only video/image/audio items, all srcs resolvable) take the FFmpeg concat path → `libx264 -preset veryfast -crf 26 -pix_fmt yuv420p -movflags +faststart` + amix for audio. Ineligible timelines fall back to Remotion. Asset pre-staging runs in both paths (parallel fetch into `/tmp`, served back via per-render loopback HTTP server with `#t=0.1` for thumbnails). `track('render_engine_fallback', ...)` fires on the Remotion fallback so we can measure how often the fast path covers real workloads.

   **Timeline editor controls**: horizontal scrollbar + mousewheel scroll (via `canvas.initScrollbars()`), split-at-playhead (`S` shortcut or Scissors button — frame-snapped to fps so no sub-frame drift, conservatively drops transitions that no longer fit either half), ripple delete (Trash button or Delete/Backspace — closes gaps on video/image tracks, audio bed stays put).

   **Media Library drawer** (`components/MediaLibraryDrawer.tsx`) — bottom-anchored drawer over the timeline canvas. Two layers: horizontal scene picker (S1 S2 ...) → shots in that scene as a horizontal row, each shot showing its active video (ring outline) + older versions as small chips. Click any version → appended to the timeline at the end as a fresh clip (the canonical shot data isn't modified). Self-hides on projects with no rendered material. Thumbnail strategy: `version.thumbnailUrl` if server has one (extracted last frame asset), else `posterFallback` from the shot's storyboard or start frame image (instant paint via `<video poster=...>`), else `#t=0.1` URL-fragment seek with `preload="metadata"`.

   See `docs/remotion-renderer.md` and `docs/render-pipeline-overhaul-2026-05-11.md`.

### AI Models

| Stage | Model | Service | Transport |
|-------|-------|---------|-----------|
| Audio analysis, vision describe | `gemini-3-pro-preview` | gemini.ts | Gemini Developer API (`GEMINI_API_KEY`) |
| Concept, style brainstorm, meaning, all refines, storyboard prompt writer | per-project `text_provider` — Claude Opus 4.7 (default) / GPT-5.5 / Gemini 3 Pro | claude.ts → text-provider.ts | Anthropic / OpenAI / Google (unified dispatcher) |
| Script writer (planScenes, refineScript, writeShotPrompts) | `claude-opus-4-7` — NOT routed through text-provider | claude.ts (direct Anthropic) | Anthropic API |
| Image gen — default | `gemini-3-pro-image-preview` ("Nano Banana Pro") → fallback `gemini-3.1-flash-image-preview` | imagen.ts | Gemini Developer API |
| Image gen — alternates | `nano-banana-2` (Segmind), `gpt-image-2` (OpenAI) — per-project via `image_model` | segmind-image.ts / openai-image.ts | Segmind / OpenAI |
| Script experiment | `gpt-5.5` (opt-in via `scriptProvider: "openai"` / `SCRIPT_WRITER_PROVIDER=openai`) | openai-script.ts | OpenAI Responses API structured output |
| Seedance storyboard — image step | `nano-banana-2` (default), `nano-banana-pro` (Google `gemini-3-pro-image-preview`), or `gpt-image-2` — per-project via `storyboard_provider` | storyboard.ts → imagen.ts / openai-image.ts / segmind-image.ts | Google / OpenAI / Segmind |
| Video — default | `seedance-2.0-fast` ($0.146/s) | segmind.ts | Segmind API |
| Video — alternates | `seedance-2.0` ($0.182/s), `veo-3.1-fast` ($0.10/s), `veo-3.1` ($0.20/s) | segmind.ts | Segmind API |

### Text provider routing (concept / style / refines / storyboard prompt)

One project-level setting (`project.text_provider`) controls every text-generation stage EXCEPT the script writer. Three options:

| Key | Label | Primary model | Refine model |
|---|---|---|---|
| `claude-opus` (default) | Claude Opus 4.7 | `claude-opus-4-7` | `claude-sonnet-4-6` |
| `gpt-5.5` | GPT-5.5 | `gpt-5.5` | `gpt-5.5` |
| `gemini-3-pro` | Gemini 3 Pro | `gemini-3-pro-preview` | `gemini-3.1-flash-preview` |

**Routed (responds to picker):** concept gen + refine, style brainstorm + refine, meaning summary, image-style analyzer, frame/motion/chained-shot refines, character + environment look refines, storyboard prompt writer.

**Not routed (always Claude Opus):** `planScenes`, `refineScript`, `writeShotPrompts`. The script writer stack uses Anthropic extended thinking + a validation loop with retry semantics that doesn't port cleanly to OpenAI / Gemini. The UI surfaces this as a "Script writer always uses Claude Opus." sub-label under the Text model dropdown.

**Implementation:** `server/services/text-provider.ts` is the unified dispatcher. One `generateText(providerKey, req)` API. Each provider's branch handles its native conventions: Anthropic tool_use for structured output, OpenAI `response_format: json_schema` (non-strict — schemas have optional fields), Gemini `responseSchema` + `responseMimeType`. Vision inputs accept either HTTPS URL (fetched + base64'd for Gemini; native for Anthropic/OpenAI) or inline base64 (for artist uploads).

**Refines use the cheap sibling** via `useRefineModel: true` on the request — kept the cost-tier discipline from the old Sonnet-vs-Opus split.

**All video gen via Segmind**: `segmind.ts` is the unified provider for all video models. Simple REST API — POST JSON with `x-api-key`, get video binary back. No polling. Requires `SEGMIND_API_KEY`. Veo models accept `image` + `last_frame` + `reference_images` URLs together. **Seedance constraint**: `first_frame_url` and `reference_images` are mutually exclusive. Keyframe mode prioritizes `first_frame_url`; storyboard mode intentionally sends no `first_frame_url` and sends the locked storyboard as `@image1` plus locked style/cast/environment refs as `reference_images`. `ffmpeg.ts` provides `extractLastFrame` (provider-independent). **Duration rounding**: `generateSegmindVideo` picks the smallest model duration >= shot duration (not nearest). A 5s shot on Veo Fast (8s only) sends 8s. `getModelMinDuration()` helper returns the floor for a given model key.

**Why Segmind over Vertex**: Vertex AI's RAI safety filter silently blocks AI-generated frames (especially faces). Segmind proxies the same models with a different safety policy. Veo 3.1 Fast costs $0.10/s (vs $0.08/s on Vertex) — 25% premium for actually working. Seedance on Segmind is cheapest across all providers ($0.146/s Fast, $0.182/s Std).

**Vertex fallback** (`server/services/video-provider.ts`): `generateVideoWithFallback` wraps Segmind. If Segmind throws and the request meets all of these conditions, it retries on Vertex Veo:
1. Model is a Veo variant (`veo-3.1-fast` or `veo-3.1`) — Seedance has no Vertex equivalent and never falls back.
2. Vertex is configured (`hasVertexVideoConfig()` checks `GCP_PROJECT_ID`).
3. Error looks like infra trouble OR billing exhaustion: `errorCategory` in `{model_unavailable, insufficient_credits}`, status in `[402, 403, 408, 409, 425, 429, 500, 502, 503, 504]`, or message matches `fetch failed | network | timeout | unavailable | overloaded | bad gateway | gateway timeout | internal server error | insufficient credit(s) | out of credits | not enough credits | payment required | billing`.

Safety blocks (`errorCategory === 'safety'`) explicitly never fall back — Vertex's RAI filter is stricter, so retrying there would just fail again. Segmind classifies HTTP 402 / "insufficient credits" / "payment required" / 403+billing as `errorCategory === 'insufficient_credits'`, which triggers the Vertex retry. Vertex fallback drops shot-level `referenceImagePaths` (image-to-video mode only) — it preserves start frame, end frame, and motion prompt.

### Video workflow (redesigned)

No end-frame prediction. Shot = start frame + motion prompt (video instruction) → Veo animates → ffmpeg extracts real last frame. The video prompt is just `motionPrompt` + ref labels (when ref images attached) — no mood, scene narrative, or cast names. The start frame already shows all of that. Next shot optionally uses the extracted frame as continuity reference (when Claude tagged `continuity_from = 'prev_shot'`). Most shots are hard cuts and generate in parallel.

**Sequential gate:** Only shots with `continuity_from === 'prev_shot'` wait for previous shot's video. Hard-cut shots are independently actionable.

**Bulk fan-out (throttled, multi-pass)**: `App.tsx` exposes three bulk actions — `Write prompts`, `Generate all frames (N)`, `Generate all videos (N)`. Under the hood `runWithConcurrency` caps parallel execution at **5 for videos**, **10 for frames**. Both bulk handlers use a **multi-pass loop**: after each pass completes, project state is refreshed from the server and newly unblocked `prev_shot` items are picked up automatically. Failed shots (ERROR status) are excluded from automatic requeue — artist sees them in UI and can retry manually.

**Chained-shot prompt refresh**: when a shot's video lands, if the *next* shot is tagged `prev_shot`, Claude Sonnet sees the extracted last frame + the shot's `direction` (creative intent) + current draft prompts + character/env names, and rewrites `visual_prompt` / `motion_prompt` to flow from what actually happened while honoring the shot's intent. Marks `refined_from_prev_frame = 1`. Cleared on manual prompt edit or user-feedback refine.

**Seedance storyboard mode:** Seedance ignores the old continuity chain entirely. Studio does not block on `prev_shot`, `generate-image` skips continuity refs/gates for Seedance, and `generate-video` skips chained prompt refresh when using a locked storyboard. A Lahari shot becomes one 4-15s storyboard-controlled edited clip; internal cuts live in the storyboard/cut plan, not in chained keyframes.

**Storyboard contract:** future boards are ordered, not visibly numbered. Panels read left-to-right, then top-to-bottom. Do not print panel numbers, captions, arrows, labels, or readable text into the storyboard image; Seedance can render those marks into final footage. The Seedance video prompt defensively tells the model to treat any legacy numbers/labels/borders as sequencing guides only and not reproduce them.

**Bulk stop semantics:** Studio bulk buttons can stop queued work and abort browser requests. Already-started provider calls may still finish server-side and appear later; the UI says "Stop queue" / "Stop waiting" instead of promising hard cancellation.

**Pacing**: Uses `ceil(scene_duration / pacing)` for shot count. A 21s scene at 8s pacing → 3 shots (8+8+5), not 2 (8+13). Validation enforces exact count via extended thinking + retry loop. Duration assignment: all shots get base pacing, last shot gets remainder (clamped at 2× pacing as safety net). Both first-gen and refine paths use identical ceil+remainder logic.

**Model-aware durations**: Claude's prompt includes the video model's minimum clip length (via `getModelMinDuration()` from `segmind.ts`) as informational context — it doesn't distort shot count. At video generation time, Segmind picks the smallest model duration >= shot duration (e.g. 5s shot on Veo Fast → sends 8s). If shot exceeds all model durations, the largest is used. Render timeline handles trimming.

**Shot splitting**: Artist can split any shot >4s in the script phase. Creates a new shot at `sort_order + 1`, divides duration in half, copies cast/env/direction, empty prompt (artist writes new visual/motion). Both halves marked stale.

**Shot editing in script phase**: Cast assignment (toggle buttons per character), environment (custom dropdown), direction (contentEditable text). Duration is **read-only** — only changeable via pacing selection (regenerates script), split button, or model change. All changes trigger staleness and "Saved" flash.

### Character generation

Character look generation produces **reusable neutral reference portraits** — no props in hands, no actions, no scene-specific elements. Neutral pose, plain/blurred background. The portrait is used as identity reference across all shots. Script writer is also instructed to keep cast descriptions action-free (face, costume, ornaments, crown — no "holding a lamp").

**Image gen fallback**: `gemini-3-pro-image-preview` (Nano Banana Pro) → `gemini-3.1-flash-image-preview` (Nano Banana 2) on 503/429/UNAVAILABLE. Only retries on capacity errors — bad prompts and auth errors propagate immediately.

### Reference chain for shot start frame

Numbered inline images sent to Gemini 3 Pro Image:
- `Image N = Character: {name}` for each cast ref
- `Image N = Style reference`
- `Image N = Environment reference: {name}`
- `Image N = Director reference` (user-uploaded shot refs — composition, mood, or element references)
- `Image N = Last-scene continuity reference` (only if continuity_from === prev_shot)
- `Image N = PREVIOUS ATTEMPT (rejected). Problems: {feedback}` (only on regen with feedback)

Priority: character identity > continuity > environment > director refs > style. Explicit note: when style text conflicts with style image, follow the image.

**Shot-level ref uploads**: Artist can upload reference images per shot via `+ Ref` button in the prompt area. Only shown when the video model supports refs alongside frames (`refsWithFrames` flag — Veo=true, Seedance=false). Refs are stored as `shot_ref` category assets and passed to both Gemini (image gen) and Segmind (video gen, up to 9 total).

### Frontend Studio components

The Studio UI is split into 6 components (was a single 1546-line `Storyboard.tsx`):

| Component | What |
|-----------|------|
| `Storyboard.tsx` | Orchestrator: state management, ref helpers, scene loop, modal, solo-play |
| `ShotCard.tsx` | Per-shot: expandable header, media display (4 layout variants), overlays, composes PromptToolkit + ShotVersionHistory |
| `PromptToolkit.tsx` | Prompt tabs, @mention picker, ref chips, generate button, refine section, full chain view |
| `StoryboardPanel.tsx` | Seedance storyboard-mode toolkit. Two-step flow: editable storyboard prompt + cut plan (planner step) → generate image → refine (replan / edit_image modes) → lock. Video sub-tab with locked refs preview. Reads cached plan/prompt directly from `shot` columns; useEffect deps narrowed so unrelated project refreshes don't clobber uncommitted local edits. |
| `StudioHeader.tsx` | Scene pills with lock toggles, progress stats, story/prompts popovers, bulk actions |
| `ShotVersionHistory.tsx` | Tabbed version history (First frame / Last frame / Storyboard / Clip) with revert |

### Frontend Blueprint components

The Blueprint UI is split into 7 components (was a single 2858-line `AnalysisEditor.tsx`):

| Component | What |
|-----------|------|
| `AnalysisEditor.tsx` | Orchestrator: state (viewPhase, envLooks, envGenerating, actionError), phase switch, modal |
| `BlueprintContextBar.tsx` | Sticky header: title, audio player, **always-on render-params row** (Aspect / Resolution / Image model / Storyboard image / Video model — 5 dropdowns visible at all times, no popover), analysis chip with full-readability checkmarks, phase tabs, launch button. Exports shared helpers: `Phase`, `PHASE_ORDER`, `phaseIndex`, `getActivePhase`, `isLockedPhase` |
| `ConceptPhase.tsx` | Concept options, lock, director brief, custom vision mode, refine |
| `ScriptPhase.tsx` | Director mode toggle, pacing, scene/shot cards with inline editing, split |
| `StylePhase.tsx` | Style brainstorm, visualize, refine, lock, upload. `StyleRow` at module scope |
| `CharactersPhase.tsx` | Cast sidebar + detail panel: generate/lock/refine/upload, per-entity unlock |
| `EnvironmentsPhase.tsx` | Env sidebar + detail panel: generate/lock/refine/upload, per-entity unlock |
| `UnlockPill.tsx` | Shared unlock button used across all phases |

### Unified prompt toolkit (Studio)

Every shot tab (First frame / Last frame / Video) follows the same pattern:

1. **Ref chips** — context-aware references attached to this generation (cast, env, style, continuity, keyframes)
2. **Prompt textarea** — editable, with `@mention` picker (type `@` → dropdown with Style, characters, environments). What you see is what gets sent.
3. **Generate button** — tracks dirty state. Shows "Regenerate" when prompt unchanged, full label when edited.
4. **Refine** — text feedback + optional reference image (photo icon button). Claude (Sonnet) sees the current prompt plus the relevant images for that task and rewrites the prompt. Frame refine uses the current prompt + failed/generated image + optional director reference. Video refine uses current motion prompt + shot visual prompt + start frame + optional end frame/reference. Same image attach pattern is available on Blueprint character/environment refines.

Refine context per tab:
- **First frame**: failed image + visual prompt + scene + env + cast + style
- **Last frame**: end frame image (if exists) + end visual prompt + scene + env + cast + style
- **Video**: start frame + end frame (if exists) + motion prompt + scene + env + cast + style

**Reverse chain**: "Use as prev shot's end" copies start frame image AND `visual_prompt` → prev shot's `end_image_asset_id` + `end_visual_prompt`.

### Generation prompt pattern (Blueprint)

Characters and environments follow the same two-mode pattern:

1. **Direct edit** — artist edits the `generation_prompt` field directly.
2. **Refine** — artist writes feedback, Claude rewrites `generation_prompt` from scratch.

`generation_prompt` is the single source of truth. On first gen, it's auto-built from a default template (`buildCharacterPrompt` / `buildEnvironmentPrompt` in `imagen.ts`) + description, with the locked style image used as the visual ground truth during generation. When `prompts_stale` is true (style or description changed upstream), the prompt is force-rebuilt from template on next generation — the stale flag is cleared after rebuild.

### Error transparency

`last_error` column on `lahari_shots` — saved on image/video gen failure (truncated to 500 chars), cleared on success. Shown in the shot card error banner so the artist sees exactly what went wrong (e.g. Segmind model 404, RAI block).

**Blueprint action feedback**: All async actions in `AnalysisEditor.tsx` surface errors via a dismissible red banner below the sticky context bar (auto-clears after 8s). No more silent `console.error` or empty `catch {}` patterns. Shared feedback hooks in `hooks/useActionFeedback.ts` (`useActionFeedback` for single actions, `useKeyedActionFeedback` for per-item lists) + `components/ActionFeedback.tsx` (`ActionError`, `ActionSpinner`) — available for adoption in Studio components.

### Custom Dropdown

`components/Dropdown.tsx` — replaces all native `<select>` elements for cross-platform dark UI consistency. Native selects render with OS theme (white on Windows). Custom dropdown matches our surface styles. Features: keyboard navigation (Arrow Up/Down, Enter/Space, Escape, Tab), ARIA roles (combobox/listbox/option), divider support, size variants (`sm`/`xs`), disabled state. Used for: aspect ratio, resolution, video model, environment picker in script shot cards.

### Staleness detection

When upstream fields change, downstream `prompts_stale` flags are set. UI shows amber "Outdated" indicator. No auto-overwrite — artist decides when to rewrite. Cleared on regenerate/refine.

| Change | What goes stale |
|---|---|
| Lock style | All cast + envs + all shots |
| Edit scene narrative | All shots in that scene |
| Edit cast description | Shots referencing that character |
| Edit env description | Shots referencing that environment |
| Change shot cast assignment | That shot |
| Change shot environment | That shot |
| Change shot duration | That shot |
| Split shot | Both halves (original + new) |

Linear flow never triggers staleness — only going back and changing upstream data.

### Pipeline anatomy

Full step-by-step trace of every prompt, every dependency, every control point: **[`docs/pipeline-anatomy.md`](docs/pipeline-anatomy.md)**. Living doc — update as pipeline evolves.

### Database

Supabase Postgres tables (all prefixed `lahari_`, see `server/database.ts` for the async adapter):
- `lahari_projects` — core state incl. `user_id` (auth ownership), `video_model`, `aspect_ratio`, `video_resolution`, `image_model`, `storyboard_provider` (storyboard image renderer: `nano-banana-2` | `nano-banana-pro` | `gpt-image-2`), `text_provider` (text-stage model: `claude-opus` | `gpt-5.5` | `gemini-3-pro` — see "Text provider routing"), `parent_project_id` (fork lineage), `source_queue_id` (links project to queue item for multi-user support), `style_exploration` JSON (legacy `presetSlots` cache; new preset locks bypass this entirely — see "Style (Blueprint)")
- `lahari_scenes`, `lahari_shots` (with `direction`, `continuity_from`, `continuity_description`, `extracted_last_frame_asset_id`, `end_image_asset_id`, `end_visual_prompt`, `end_user_feedback`, `storyboard_asset_id`, `storyboard_version_id`, `storyboard_locked`, `storyboard_status`, `storyboard_prompt`, `storyboard_cut_plan`, `storyboard_prompt_status`, `storyboard_prompt_user_feedback`, `excluded_refs` JSONB `{storyboard, video}` for per-step ref exclusion in storyboard mode, `use_prev_storyboard_ref` boolean (continuity vision ref), `include_prev_cut_plan` nullable boolean (continuity text context, null = smart default from `continuity_from`), `prompts_stale`)
- `lahari_storyboard_versions` — storyboard history per shot. Columns include `openai_response_id`, `openai_image_call_ids`, `reasoning_model` (legacy OpenAI-specific; null on Nano Banana 2 / Nano Banana Pro / non-OpenAI runs), plus the generic `image_model`, `prompt`, `refs`, `parent_version`, `locked` flag, `metadata.cutPlanText` (legacy — canonical text now lives on the shot row).
- `lahari_song_notes` — per-user mnemonic notes shown next to song names on the queue dashboard. Composite PK `(user_id, song_id)`. Note text capped at 200 chars by CHECK constraint. Empty/whitespace updates delete the row (see `PUT /api/queue/notes/:songId`).
- `lahari_cast_members` (with `generation_prompt`, `prompts_stale`), `lahari_environments` (with `generation_prompt`, `prompts_stale`), `lahari_assets` (with `shot_id` for video history; `category: 'pickup_clip'` reserved for the future Media Library pickup uploads), `lahari_chat_messages`, `lahari_ai_calls`
- All DB access goes through `server/database.ts`. Legacy `db.ts`, `veo.ts`, `fal.ts` have been deleted.

### Fork system

Fork deep-copies all DB rows under a new id with `parent_project_id = source`; asset file_paths are shared (zero disk bloat). Sidebar groups forks indented under parents with timestamps + delete. Helper: `forkProject(sourceId)` in `server/routes/projects.ts`. UI dialog: `DestructiveAction` state in `App.tsx` (`mode: 'fork'` for 3-button Fork/Overwrite/Cancel, `mode: 'simple'` for 2-button Confirm/Cancel).

**Unlock system (two levels):**

1. **Phase unlocks** (`unlock-script`, `unlock-style`, `unlock-characters`, `unlock-environments`) — pure rewind, allowed from any later status via `atLeast()`. Rewinds status to the previous phase. No data deleted. Artist can go back to tweak one thing without unwinding every later phase in sequence.

2. **Individual look unlocks** (`unlock-character-look`, `unlock-environment-look`) — clears `reference_asset_id` on one cast member or environment. Fetches persisted candidates from DB so artist can pick a different one without regeneration. Marks dependent shots `prompts_stale`.

**Look candidates are persisted**: saved as assets with category `character_candidate` / `environment_candidate` and metadata containing the entity ID. On unlock, candidates are fetched from DB — no API cost.

**Unlock button visibility** uses `isLockedPhase(phase)` (derived from project status). Environments special-cased as terminal phase. Phase unlock pills show at top of phase tab; individual unlock padlock shows next to each "Locked" badge.
- **Destructive events happen on the active mutation**:
  - `lock-concept` with `{ fork?: boolean }` — if the new concept differs from the previous `locked_concept` AND scenes exist, server wipes scenes/cast/environments/style (or does so on the fork).
  - `generate-script` with `{ fork?: boolean }` — on re-run (scenes already exist), wipes cast + scenes + prompts.

**Fork-capable endpoints:** `lock-concept`, `generate-script` (re-run), `analyze-audio`. First-time gens and unlocks never open the dialog.

**Non-destructive** (no fork needed): all unlocks, `generate-concepts` (replaces options), `lock-style`, `generate-looks` / `generate-environment-look`, `write-shot-prompts`.

### Launch Studio shortcut

`handleLaunchStudio` in `App.tsx` skips `/write-shot-prompts` entirely if every shot already has `visualPrompt` set — clicking Launch Studio after returning from Blueprint no longer burns a Claude batch call. Deliberate bulk regen lives in the Studio header's "Rewrite all" button.

**Supabase tables (shared with other services):**
- `songs` — 1490 songs with `audio_storage_url` / `drive_audio_url` + `cached_lyrics`, `cached_structure`, `cached_meaning` (written by Lahari on first analysis, read on subsequent starts)
- `files` — SRT files, etc. (Google Drive URLs)
- `music_video_queue` (Lahari's domain table) — song_id, priority, status, lahari_project_id, video_url, `assigned_to` (column exists, currently unused — reserved for future explicit-claim affordance)

### Key API Endpoints

**Queue:**
- `GET /api/queue` — list with joined song data + the current user's per-song mnemonic notes (`user_note` field, null when unset).
- `POST /api/queue/:queueId/start` — pull audio + SRT, create Lahari project (responds immediately, analysis runs in background). Uses `source_queue_id` to find existing project for this user. Caches analysis on `songs` table for future users.
- `PATCH /api/queue/:queueId` — update status / video_url
- `PUT /api/queue/notes/:songId` — set/clear the current user's mnemonic note for a song. Empty/whitespace body deletes the row. 200-char cap.

**Blueprint:**
- `POST /api/projects/:id/generate-concepts` (userNote optional)
- `POST /api/projects/:id/generate-script` (userNote optional; experimental `scriptProvider: "openai"` switches to GPT-5.5)
- `POST /api/projects/:id/brainstorm-styles`, `refine-style-direction`, `analyze-style-image`, `lock-style` (always marks downstream stale), `unlock-style`, `upload-and-lock-style`
- `GET  /api/projects/:id/style-presets` — returns 4 curated presets each with `previewImageUrl` resolved from Supabase
- `POST /api/projects/:id/lock-style-preset` — body: `{ presetKey }`. Locks the curated preset image directly as the project style. No visualization step. Inserts a project-scoped `assets` row pointing at the shared `preset.previewImagePath`, sets `style_asset_id` + `style_description: ''` + status `style_locked`, marks downstream stale. Returns the full updated project.
- `POST /api/projects/:id/generate-looks`, `lock-character`, `advance-characters`
- `POST /api/projects/:id/generate-environment-look`, `lock-environment`, `advance-environments`
- `POST /api/projects/:id/write-shot-prompts`

**Studio:**
- `POST /api/projects/:id/shots/:shotId/generate-image`
- `POST /api/projects/:id/shots/:shotId/generate-video` (accepts `promptOverride`)
- `POST /api/projects/:id/shots/:shotId/write-storyboard-prompt` — planner step (cheap text-only). Writes `shot.storyboard_prompt` + `shot.storyboard_cut_plan`. Body: `{ feedback?, variant? }`. Both fields are also editable inline via `PATCH /storyboard-plan`.
- `POST /api/projects/:id/shots/:shotId/generate-storyboard`, `refine-storyboard` (modes: `replan` | `edit_image`), `lock-storyboard`, `unlock-storyboard`
- `PATCH /api/projects/:id/shots/:shotId/storyboard-plan`, `GET /api/projects/:id/shots/:shotId/storyboard-history`
- `POST /api/projects/:id/shots/:shotId/generate-end-frame`
- `POST /api/projects/:id/shots/:shotId/refine-prompt` (Claude rewrites visual prompt — sees failed image + scene + env + cast + style)
- `POST /api/projects/:id/shots/:shotId/refine-end-frame-prompt` (same context, end frame focus)
- `POST /api/projects/:id/shots/:shotId/refine-video-prompt` (Claude rewrites motion prompt — sees start + end frames + scene + cast)
- `POST /api/projects/:id/shots/:shotId/lock` / `unlock`
- `GET /api/projects/:id/shots/:shotId/history` (returns `{ firstFrame, lastFrame, video }` version arrays)
- `POST /api/projects/:id/shots/:shotId/revert-frame` / `revert-end-frame` / `revert-video`

**Render:**
- `POST /api/projects/:id/render` — body: `{ timeline: { trackItemIds, trackItemsMap, transitionsMap, fps, size, durationMs } }`. Proxies to `remotion-renderer` (env `REMOTION_RENDERER_URL`, header `x-renderer-secret: $RENDERER_SHARED_SECRET`), which uploads the mp4 to Supabase and returns `{ videoUrl, storagePath, sizeBytes, durationInFrames, renderMs }`.
- `POST /api/queue/publish-url/:projectId` — body: `{ videoUrl, storagePath }`. Registers the asset, walks the fork chain, marks the owning queue row `completed`. Shares `finalizePublish()` with the multipart variant.

**Utils:** `/api/projects/:id/chat`, `GET /api/projects/:id/xray`, `PATCH /api/projects/:id/shots/:shotId` (accepts visualPrompt, motionPrompt, castIds, environmentId, duration, continuityFrom, endVisualPrompt, userFeedback), `POST /api/projects/:id/shots/:shotId/split` (splits shot into two, divides duration, copies cast/env), `POST /api/projects/:id/shots/:shotId/upload-ref` (upload reference image for shot), `POST /api/projects/:id/shots/:shotId/delete-ref` (remove shot ref), `POST /api/projects/:id/scenes/:sceneId/lock-all` / `unlock-all` (batch lock/unlock all shots in scene), `POST /api/projects/:id/fork`, `POST /api/projects/:id/analyze-audio` (fills missing analysis — transcribes lyrics if missing + structure in parallel → meaning chained after lyrics), `POST /api/projects/:id/shots/:shotId/use-prev-last-frame`, `POST /api/projects/:id/shots/:shotId/clear-frame`, `POST /api/projects/:id/shots/:shotId/clear-end-frame`, `POST /api/projects/:id/shots/:shotId/clear-extracted-frame`, `POST /api/projects/:id/upload-and-lock-style`, `POST /api/projects/:id/upload-character-reference`, `POST /api/projects/:id/upload-environment-reference`, `POST /api/queue/publish/:projectId` (legacy multipart — uploads final render blob, walks fork chain, marks owning queue row `completed`; prefer `/publish-url` above)

**Admin diagnostics** (all behind `x-admin-secret: $ADMIN_UPLOAD_SECRET`):
- `GET /api/admin/env` — which env vars are set (values redacted). Primary tool for diagnosing Vertex/auth issues — confirms the running container sees `GCP_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, and whether the creds file was materialized.
- `GET /api/admin/usage?hours=N` — aggregates `ai_calls` by model+stage with totals and error counts.
- `GET /api/admin/errors?limit=N` — most recent error messages verbatim. Fastest way to tell what Veo (or anything) is rejecting.
- Migration endpoint removed — was `POST /api/admin/migrate-to-supabase`, used once on 2026-04-16.

### Queue completion writeback

Render is **async** because Railway's edge proxy kills HTTP requests after ~5 min but real renders take 15+ min. Every `/render` call creates a `lahari_renders` row (status: `rendering` → `completed` / `failed`), so stale callbacks from superseded jobs can't clobber fresh state. Flow:

1. `StepRender` → `POST /api/projects/:id/render` — main backend inserts a `lahari_renders` row, returns `202 { renderId, status: 'rendering' }` immediately, fires fire-and-forget call to `remotion-renderer` with `{ renderId, projectId, timeline }`.
2. Renderer responds `202` to main, runs the render in the background, uploads the mp4 to Supabase at `videos/<projectId>/...`.
3. Renderer `POST`s result to `MAIN_BACKEND_URL/api/renders/callback/:renderId` (guarded by `x-renderer-secret`). On success: `finalizePublish()` + stamp the render row `status='completed'`, `video_url`, `storage_path`, `render_ms`. On failure: `status='failed'`, `error`. Already-finalized rows are idempotent — duplicate callbacks return `{ ok: true, alreadyFinalized: true }`.
4. `StepRender` polls `GET /api/projects/:id/render-status` every 4s (returns the latest render row for the project) until `completed` or `failed`. Survives page reloads — on mount the component checks status and resumes polling if a render is in-flight.

Legacy publish endpoints (multipart `/publish/:projectId` and JSON `/publish-url/:projectId`) still exist and share `finalizePublish()` in `server/routes/queue.ts`:

1. Registers an `assets` row (category `final_render`) pointing at the Supabase storage key.
2. Walks up `parent_project_id` locally to collect the fork-lineage.
3. Finds the Supabase `music_video_queue` row where `lahari_project_id` matches any id in that chain.
4. Updates that row: `status = 'completed'`, `video_url = <public url>`, `lahari_project_id = <this fork's id>` (latest-completed-wins).
5. Sets the local project's status to `'completed'` too.

If you want to change the resolution policy later, swap step 4 for: first-completed-wins (skip if already completed), or explicit-promote-only (no auto-update).

### Remotion renderer service

Sibling deployment at `remotion-renderer/` — Hono + `@remotion/renderer` + headless Chromium. Rebuilds the timeline editor's Remotion composition server-side from the zustand store snapshot. Files under `remotion-renderer/src/timeline/` are hard-copied from `components/timeline-editor/` (keeps the renderer's Docker context self-contained) — re-run `cd remotion-renderer && npm run sync-timeline` after editing the upstream editor. `Composition.tsx` is prop-driven (`CompositionInput` interface), with a thin `StoreComposition` default export for the in-app `<Player>`. Full details: `docs/remotion-renderer.md`.

## Typography + color system

The `index.html` `<style>` block has a commented spec. Short version:
- **Size tiers (5)**: `text-[11px]` micro · `text-xs` small · `text-sm` body+tabs · `text-lg` heading · `text-2xl` display. No other sizes.
- **Color tiers (3)**: `text-white` primary · `text-zinc-300` body · `text-zinc-400` muted. Anything darker (zinc-500+) disappears on the dark bg — don't use for text.
- **Bg**: `#141418` (warm near-black, one step up from pure 950).

## Video models

Registry lives in `constants/videoModels.ts` and must stay in sync with `server/services/segmind.ts` (`SEGMIND_MODELS`). All four models route through Segmind. **First entry is the default** for new projects:
- `seedance-2.0-fast` — 4/5/6/8/10/12/15s, $0.146/s. Default. Storyboard-mode workhorse. Frame URLs OR ref images (mutually exclusive).
- `seedance-2.0` — same durations, $0.182/s. Higher quality.
- `veo-3.1-fast` — 8s fixed, $0.10/s, supports last frame + refs together.
- `veo-3.1` — 4/6/8s, $0.20/s, supports last frame + refs together.

Pacing default is **15s** (matches Seedance Fast's longest clip; one storyboard-controlled shot per ~15s scene segment). Pacing buttons in the Script phase are derived from the selected model's `durations`.

### Version history

Unified history panel with 4 tabs: First frame | Last frame | Storyboard | Clip. Each shows all past generations for that shot as horizontal thumbnails (latest first). Revert button swaps the active asset/version pointer — no data is lost. Frame/video assets track `shot_id` + `category` (`shot_image`, `shot_end_frame`, `shot_video`); storyboards are tracked in `lahari_storyboard_versions`.

Endpoints: `GET /:id/shots/:shotId/history` (frame/video categories), `GET /:id/shots/:shotId/storyboard-history`, `POST revert-frame`, `POST revert-end-frame`, `POST revert-video`, and `POST lock-storyboard` for storyboard version switching.

## Future work

- **Genre system** — extract bhakti-specific prompts into configurable presets. Enable fork for anime, short films, etc.
- **App.tsx breakup** — extract `useProjectHandlers`, `useBulkGeneration` hooks. Not critical but growing.
- **UI polish** — glass surface system, shot card redesign (compact overview cards), spring animations.
- **Infra: Supabase → Mumbai** (ap-south-1) + **Railway → Singapore** — artists are in India, current setup crosses the Pacific twice per query.
- **Refine chat history** — multi-turn refinement (store conversation per shot/tab so Claude remembers prior attempts)
- **Video auto-fallback** — Veo RAI block → Seedance + ffmpeg trim. Error classification done, retry logic needed.
- **Route script writer through text-provider** — planScenes / refineScript / writeShotPrompts are the only stages still hardcoded to Claude Opus. The extended-thinking + validation-loop pattern doesn't port cleanly to OpenAI / Gemini without a per-provider re-implementation of the retry semantics. ~4-6 hrs to do properly. Surface as an artist option once shipped.
- **OpenAI strict-mode schema normalizer** — text-provider.ts ships with `strict: true` OFF on OpenAI structured outputs because our concept/style/refine schemas have optional fields like `language` and `lyricsSummary` that fail strict's all-required + additionalProperties:false requirements. Future cleanup: write a recursive normalizer that auto-adds `additionalProperties: false` and converts optional fields to `type: ["string", "null"]`. Then flip strict back on.
- **Pickup Generator + Media Library tab 2** — current Media Library is read-only (existing shot video versions). Phase 2 adds a Pickups tab with upload + a "Generate pickup" form (single-shot generation with custom refs, model, duration, count). Plan in chat history; design locked but not built.
- **Render pipeline Phase 4 — E5 timeline-hash dedup** — short-circuit re-renders of identical timelines. E1 (asset pre-staging) and E2 (Docker bundle bake) shipped. Notes in `docs/render-pipeline-overhaul-2026-05-11.md`.
- **Split `prompts_stale`** — currently shared by keyframe `visual_prompt` and storyboard `storyboard_prompt`. Rewriting one clears it for both; if the artist switches modes the other can look fresh when it isn't. Future schema: `visual_prompt_stale` + `storyboard_prompt_stale`.
- **`in_production` status is dead state** — no server code currently writes this value to `lahari_projects.status`. Render gate works around it by being data-derived (`some shot has video`). Either delete the enum value or wire something to set it (probably first lock-storyboard / first video gen).
- **Wire Runway Gen-4 Turbo** ($0.05/s) and/or **Kling 3.0** ($0.084/s) as direct-API models.
- **X-Ray overhaul** — current panel is a log dump. Needs visual flow graph, prompt archaeology, cost dashboard.
- **Assistant director agent** — persistent chat agent with access to all edit/refine endpoints as tools.
- **Persistent error logging** — DB table for all 4xx/5xx responses (Railway wipes logs on redeploy).

## Express 5 quirks

- Route params return `string | string[]` — use `paramStr()` helper
- Catch-all routes: `/{*path}` not `*`

## Path aliases

`@/*` → project root (in tsconfig + vite config)

## Deployment

Railway, Dockerfile at repo root. Stateless — all storage via Supabase. Push to deploy: `railway up --detach`. Project: `lahari-media-engine` (id `a2ef8e79-f9ae-4dce-80e0-114d80e0a575`). Dockerfile hardcodes `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (anon key is public) for Vite build-time access. Uses `--legacy-peer-deps` for Remotion/designcombo peer dep conflict.
