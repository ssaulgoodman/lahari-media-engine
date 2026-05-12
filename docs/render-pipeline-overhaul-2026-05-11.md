# Render Pipeline Overhaul — Audit, Diagnosis, and Plan

**Date**: 2026-05-11
**Status**: Phase 1 deployed. Phase 2 complete on `codex/render-phase2-progress`. Phase 3 resilience in progress.
**Context**: One stuck render incident (2:40 video orphaned at `rendering` for 1h47m). Multiple reports of small clips (2–3 min) taking 15–25 min to render. Audit triggered.

---

## TL;DR

Renders are slow for one dominant reason: **cross-region asset pulls**. Modal renderer runs in US, Supabase bucket sits in `ap-southeast-2`. Chromium fetches each shot's mp4 sequentially during render — at ~200ms RTT × 22 shots × ~10MB each, the network alone burns 80+ seconds of wall-clock time per render, before encoding starts. Sometimes Chromium stalls on a slow clip and the whole render hangs.

Modal itself is configured fine (8 vCPU, 16GB, 60-min timeout). The bottleneck is **architecture, not Modal**.

Beyond performance, the original pipeline had no safety nets. Current state:
- Phase 1 watchdog is deployed: orphan `rendering` rows older than `MAX_RENDER_MINUTES` fail automatically.
- Phase 1 catches initial renderer non-2xx responses, duplicate active renders, empty outputs, and callback 404s.
- Phase 2 adds progress, stage, heartbeat, Modal call id, and error-code columns plus UI progress.
- Modal SIGKILL still needs the cancel-on-watchdog piece; Phase 3 retry/reconciler, pending-finalize watchdog, and renderer hard-cap are now in code.
- Bucket-mismatch risk is handled short-term: production Modal currently sets `SUPABASE_BUCKET=videos`, so backend delete defaults to `videos` until a planned migration moves renderer output to `lahari-assets`.

Fix plan ships in 4 phases. Phase 1 (stop the bleeding) + Phase 4 (asset pre-staging) together get us from "fails silently for hours" + "10× too slow" to "self-recovers in 2 min" + "expected 3–5 min for typical projects."

---

## What a 2:40 render *should* take

Realistic floor for a 22-shot, 160s composition with the current Modal setup:

| Stage | Floor | Notes |
|---|---|---|
| Bundle (cold container) | 15–30s | Remotion compiles the composition; cached on warm containers |
| Asset fetch (if local) | 5–15s | 22 clips, parallel, gigabit |
| Frame render | 90–180s | Chromium runs at ~1–2× realtime on 8 vCPU at this resolution |
| ffmpeg encode | 30–60s | Single pass H.264 |
| Upload final mp4 | 5–15s | ~30MB output, one shot |
| **Total** | **~3–5 min** | |

Anything beyond ~8 min means something is wrong.

## Why it's currently 15–25 min

Math for the cross-region pull bottleneck (E1 below):
- Modal US ↔ Supabase Sydney RTT: ~180–230ms minimum
- Plus TLS handshake (~3 RTT): ~700ms before first byte transfers
- Effective throughput over high-latency link: ~3–8 MB/s per connection (TCP window scaling)
- Chromium fetches each clip **when it first becomes active** — sequential, not parallel. Remotion's `<OffthreadVideo>` doesn't pre-fetch.

For 22 clips at ~10MB each:
- Per-clip: ~700ms handshake + ~2–3s transfer = **3–4s wall-clock per clip**
- Sequential: 22 × 3.5s ≈ **80s of pure network wait** during a render that should be 90–180s of actual rendering
- Worse: a single slow clip stalls the whole render until it arrives. One TCP stall of 5s for one clip blocks the next frame from rendering.

That's how a 3–5 min render becomes 15–30 min. And it's exactly why the stuck render hit Modal's old 30-min timeout — the network was eating all the budget.

---

## Section 1 — Observability + debugging gaps

| # | Gap | Fix | Effort | Priority |
|---|---|---|---|---|
| O1 | No progress signal during render. `render.ts:31` accepts `onProgress` but `render-job.ts:135` calls `renderTimeline(inputProps)` with no callback. Artist sees only "rendering…" for up to 60 min. | **Phase 2 done in code:** `renderTimeline` progress writes `lahari_renders.progress` + `stage`, throttled to ~1 update/3s. `/render-status` and StepRender surface it. | M | P0 |
| O2 | Errors only live in main-backend stdout (500-line Railway cap) + Modal's tail. PostHog captures `render_completed` / `trackError` (`render-job.ts:144,168`) but no Sentry, and no queryable error store on main backend. `lahari_renders.error` only holds *callback-delivered* errors — Modal SIGKILL / OOM never reach it. | (a) Add a `render_logs` table or reuse the planned `error_log` table; insert one row per render lifecycle event (start/upload/done/fail) from both `render-job.ts` and `render-callback.ts`. (b) Install `@sentry/node` in the renderer with `MODAL_TASK_ID` as a tag. | M | P0 |
| O3 | No queryable "what did Modal do for renderId X" trail. `modal_app.py:63` returns the result but Modal's function-call dashboard is tail-only and not joinable by `render_id`. | **Phase 2 done in code:** ASGI handler returns the spawned function-call id when Modal exposes it; main backend stamps it into `lahari_renders.modal_function_call_id`. | S | P1 |
| O4 | Failure messages shown to artist are raw exception strings (`render-callback.ts:46`, `StepRender.tsx:147`). "Supabase upload failed (0 bytes): {}" isn't actionable. | **Phase 2 done in code:** renderer classifies obvious failures into `bundle_failed`, `chromium_oom`, `asset_404`, `supabase_5xx`, `timeout`, `empty_output`, falling back to `renderer_failed`; UI maps codes to hints. | S | P1 |
| O5 | No per-asset fetch logging. When a render is slow we can't tell if it's Chromium GPU stalls, Supabase pull latency, or ffmpeg encoding. | Add `track('render_stage', ...)` markers before/after `bundle`, `selectComposition`, `renderMedia`, `uploadRender`. Same events persisted to `render_logs`. | S | P1 |
| O6 | Modal-side stdout is captured only if subprocess exits cleanly (`modal_app.py:78` uses `capture_output=True`). A SIGKILL leaves no log trail on Modal's side either — the parent Python process is also killed. | **Phase 2 done in code:** progress pings plus a 30s idle heartbeat update `last_heartbeat_at`; the last successful ping becomes the forensic anchor. | M | P0 |
| O7 | `RENDERER_SHARED_SECRET` mismatches return 401 with no log of *which* request was rejected; could mask a stale deploy on either side. | Log `[render-callback] 401 from %ip% renderId=%id%` so prod 401 spikes are visible. | S | P2 |
| O8 | Frontend swallows poll errors (`StepRender.tsx:151`). A 500 on `/render-status` looks identical to "still rendering" — for hours. | After 3 consecutive poll failures, show a yellow "lost contact with server" chip with a manual Retry button. | S | P2 |

---

## Section 2 — Failure recovery gaps

| # | Gap | Fix | Effort | Priority |
|---|---|---|---|---|
| **F1** | **No orphan-render watchdog.** Confirmed: nothing in `server/` schedules anything; `lahari_renders` rows can sit at `status='rendering'` forever (your incident). | Add a `setInterval` (or Railway cron-equivalent endpoint hit by a scheduled task) that flips any `rendering` row older than `MAX_RENDER_MINUTES + 5` to `failed` with `error='watchdog: exceeded max render time'`. Run every 2 min. | S | **P0** |
| F2 | Modal hard-timeout (60 min ceiling, `modal_app.py:60`) gives no callback. Even after F1, the artist sees "Render failed: watchdog" with no path forward. | Pending-finalize rows now have their own 15-min watchdog. Still pending: when watchdog flips a row, call `render_job.cancel(modal_function_call_id)` if possible so we stop paying for a hung container. | S | P1 |
| F3 | `postCallback` retries cover 404/408/429/5xx (`render-job.ts:83`) but cap at 5 retries over ~31s. A Railway redeploy can take 60–90s. After exhaustion the result is lost — only PostHog has it. | **Phase 3 done in code:** retry budget is ~5 min with jitter. On exhaustion, renderer writes `pending_finalize` terminal fallback data to `lahari_renders`; backend reconciler runs `finalizePublish` and marks completed. | M | P0 |
| F4 | No size sanity check on uploaded mp4. `storage.ts:30` happily uploads a 0-byte file if `renderMedia` produced one (it shouldn't, but a Chromium hang at frame 0 could). | Check the file size before upload, and fail the render if `sizeBytes < 1024` or `durationInFrames === 0`. Stamp `error_code='empty_output'` once that column exists. | S | P0 |
| F5 | If `uploadRender` throws mid-upload, `runRenderJob`'s catch posts a failure callback (`render-job.ts:164`) — good. But it leaves the tmp mp4 to be cleaned only in the `finally` of *this* run; if process is killed before, nothing else GCs. | Add a one-line `rm -rf /tmp/lahari-render-*.mp4` older than 1h on container boot. Cheap and forgettable. | S | P2 |
| F6 | Project deletion cascade (`migrations/2026-04-21:11`: `on delete cascade`) drops the render row, so a late callback hits 404 (`render-callback.ts:31`). Renderer treats 404 as retriable (`render-job.ts:83` allows it). | Make 404 non-retriable in `postCallback`. Also: if the Modal call references a deleted project, exit early in `render-job.ts` after a precheck `selectOne('projects',...)`. | S | P1 |
| F7 | **Double-click Render** creates two `lahari_renders` rows; both fan out to Modal. Both will try to finalize; one of them updates `music_video_queue.video_url`, the other overwrites it (latest-wins per `finalizePublish` at `queue.ts:325`). Wasteful, not technically broken. | At `/render` POST, reject (`409`) if a row exists for this project with `status='rendering'` younger than X min. Frontend already disables button while `phase==='rendering'` but reload escapes that. | S | P1 |
| F8 | Renderer ASGI front-door secret check throws *before* it can persist the failure (`modal_app.py:122`). Misconfigured secret → main backend's fetch wrapper sees a 401, but the render row stays `rendering` forever (only `.catch` flips it; a 401 response doesn't throw). | In `server/routes/render.ts:61`, check `response.ok` (not just promise rejection). Flip row to failed on non-2xx. | S | **P0** |
| F9 | `finalizePublish` (`queue.ts:325`) does 4 sequential DB writes with no transaction. Partial failure leaves inconsistent state. | Wrap in a Supabase RPC `finalize_render(project_id, video_path, video_url)` or at minimum: do project update first (cheap, local) and queue update last, then compensating delete on the assets row if queue update fails. | M | P2 |
| **F10** | **Bucket mismatch risk**: code defaults can drift from the renderer's `SUPABASE_BUCKET`. Production Modal currently writes final renders to bucket `videos`; existing render history also lives there. | Short term: keep backend delete default at `videos` and/or set Railway `RENDER_STORAGE_BUCKET=videos`. Long term: if we want `lahari-assets`, change Modal secret + redeploy renderer + copy existing objects from `videos` to `lahari-assets` preserving keys. | S | **P0** |

---

## Section 3 — Efficiency gaps

| # | Gap | Fix | Impact | Effort | Priority |
|---|---|---|---|---|---|
| **E1** | **Cross-region asset pulls.** Modal US ↔ Supabase ap-southeast-2 = ~180–230ms RTT per HTTP, ×N shot videos fetched serially by Chromium during render. For a 50-shot timeline at ~10 MB/clip that's 500 MB pulled over a slow link before encoding even starts. Comment at `render.ts:50` already flags this. | (a) Pre-stage: before `renderMedia`, fetch every remote media item in `trackItemsMap` — video, image, and audio — in parallel (Promise.all with concurrency=16) into `/tmp/lahari-render-<id>/`, validate status/content/size, rewrite URLs to `file://`, and clean the directory in `finally`. (b) Long-term: co-locate Supabase + Modal region. | (a) cuts 50-shot wall time by est. 4–8 min. (b) cuts further ~30%. | (a) M, (b) L | **P0** |
| E2 | Composition bundle is cached per-process (`render.ts:11-20`), but each Modal container is fresh — first render on new container pays the bundle cost (~10–30s). `min_containers=1` keeps ASGI warm but `render_job` cold-starts. | Bake the bundled `out/` directory into the Dockerfile (`@remotion/bundler` at build time), have `render.ts` skip `bundle()` if it exists. | ~15s/cold-start | M | P1 |
| E3 | `max_containers=20` is fine for current usage; not urgent. But there's no scaledown signal — if a hung container is paid-for while watchdog is missing (F1), cost piles up. | Once F1+F2 land, `render_job.cancel()` solves this. | $$ | (covered) | — |
| E4 | Renderer concurrency: `concurrency: '100%'` (`render.ts:56`) on 8 vCPU. Fine, but at 16GB RAM, 50-shot timelines with simultaneously decoded video clips have risked OOM in similar Remotion deployments. No monitoring of peak RSS. | Add `track('render_peak_rss', ...)` reading `process.resourceUsage().maxRSS` post-render. If we ever see >12GB regularly, drop concurrency to a number. | S | P2 |
| E5 | Re-render with no change → still re-bundles, re-fetches, re-encodes. There's no content hash on `{trackItemsMap, transitionsMap}`. | Compute SHA-256 of the canonicalized timeline. If a `lahari_renders` row with `status='completed'` exists for that hash, short-circuit and copy `(video_url, storage_path)` to a new row. | Saves $0.40–$1.00 + 5–15min per duplicate render | M | P1 |
| E6 | `selectComposition` timeout = 120s, `renderMedia` timeout = 120s (`render.ts:39,52`). Per-frame fetch timeout, not total. Fine, but no upper bound on total render — Modal's 60min is the only ceiling. | **Phase 3 done in code:** `renderTimeline` is wrapped in a renderer-side hard cap (`RENDER_HARD_CAP_MINUTES`, default 50), so timeout failures can callback before Modal SIGKILL. | S | P0 |

---

## Section 4 — Other gaps

| # | Gap | Fix | Effort | Priority |
|---|---|---|---|---|
| X1 | **Huge timeline payload.** 50 shots × ~2 KB JSON = ~100KB, comfortable. But signed Supabase URLs in `trackItemsMap` can balloon if every clip carries embedded `presignedUrl`. Express server limit is 50MB (`server/index.ts:43`), Modal default body limit also ample. Not urgent but worth a guardrail. | Log `req.body` byte size on `/render` and reject if >5MB with clear error. | S | P2 |
| X2 | `RENDERER_SHARED_SECRET` is a single static string used in both directions. No rotation flow. Leak = full forge of either side. | Support comma-separated `RENDERER_SHARED_SECRET=new,old`; renderer accepts either, main sends `new`. Rotate via deploy-both-then-deploy-new pattern. | S | P2 |
| X3 | Render history UI exists (`StepRender.tsx:278`, `projects.ts:1180`) but is per-project. No "all my renders" admin view, no aggregate cost/time. | Add `/api/admin/renders?hours=N` aggregating by status, mean render_ms, p95, totals. Aligns with existing `/api/admin/usage` pattern. | S | P2 |
| X4 | Frontend "Render" button can fire while editor still has unsaved changes (`StepRender.tsx:183` reads zustand store directly). If autosave to `loadSnapshot` hasn't fired, render uses in-memory state user can't reload later. Render is correct but editor state on next open won't match. | Force `persistSnapshot(project.id)` synchronously before `startRender`. | S | P2 |
| X5 | Resume-after-navigate works (`StepRender.tsx:158`) but only for `rendering` status. A render that *just* completed while away never shows the success banner — user sees "idle" and has to check History. | Pass a session timestamp; if `latest.status='completed'` AND `updated_at > sessionStart`, show banner once. | S | P2 |
| X6 | `deleteRender` on the currently-published render clears `queue.video_url` but doesn't roll the project back from `status='completed'` (`projects.ts:1244`). Queue row + project state diverge silently. | Either also flip project back to `rendered`/`analyzed`, or block delete of the current render unless user confirms "this will unpublish the queue row." | S | P2 |
| X7 | Shared secret is logged into the renderer subprocess environment and survives in stdout if anything ever does `console.log(process.env)`. No code does this today but it's a sharp edge. | Redact `RENDERER_SHARED_SECRET` from any error-formatter that might serialize env. | S | P3 |

---

## Implementation plan — phased

### Setup: worktree

Recommended. Reasons:
- Multi-file across main backend, Modal renderer, frontend, and DB migration (`lahari_renders` new columns: `progress`, `stage`, `last_heartbeat_at`, `modal_function_call_id`, `error_code`).
- Codex may still be active on `main` (lipsync/storyboard work).
- Modal deploy is filesystem-bound — `modal deploy modal_app.py` deploys from cwd. Worktree prevents accidental prod deploy.
- DB migration coordination — migration must land with the code that needs it, not before/after.

Commands when ready:
```bash
git worktree add -b render-pipeline-v2 ../lahari-render-pipeline e2391c2  # or current main HEAD
cd ../lahari-render-pipeline
```

Local Vite dev (port 3002 pointed at Railway prod) stays running in the main checkout — gives a "before" view while building the "after."

### Phase 1 — Stop the bleeding (1 PR, half-day's work)

Backend-only changes. No migration. No Modal deploy. Safe to merge anytime.

1. **F10 / Bucket mismatch** — Phase 1 keeps production reality: Modal writes to bucket `videos`, so backend delete defaults to `videos`. Optional belt-and-suspenders: set Railway `RENDER_STORAGE_BUCKET=videos`.
2. **F1 watchdog** — `setInterval` on backend boot in `server/index.ts`. Every 2 min, query `lahari_renders WHERE status='rendering' AND created_at < NOW() - 65 min`, flip to `failed` with `error='watchdog: exceeded max render time'`. ~30 lines.
3. **F8 non-2xx response check** — `server/routes/render.ts:61`, inspect the fire-and-forget fetch response. On non-2xx, flip the row to failed immediately with the HTTP status/body.
4. **F4 empty-output guard** — `remotion-renderer/src/render-job.ts` checks output file size before upload and rejects `sizeBytes < 1024 || durationInFrames === 0`. ~10 lines.
5. **F7 double-click guard** — `/render` POST, reject 409 if a `rendering` row younger than X min exists. ~10 lines.
6. **F6 callback 404** — treat callback 404 as non-retriable so deleted projects/renders do not burn retry time.

After Phase 1: orphan renders self-recover, silent 401/500s fail loudly, 0-byte mp4s caught, double-click dedup.

### Phase 2 — Artist visibility (1 PR, 1 day)

Status: in progress on `codex/render-phase2-progress`.

Needs DB migration. Needs Modal redeploy + main backend redeploy in lockstep.

Migration `migrations/2026-XX-XX_render_observability.sql`:
```sql
ALTER TABLE lahari_renders
  ADD COLUMN IF NOT EXISTS progress REAL,
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS modal_function_call_id TEXT,
  ADD COLUMN IF NOT EXISTS error_code TEXT;
```

Code:
6. **O6 heartbeat foundation** — `render-job.ts` sends progress pings to `POST /api/renders/progress/:renderId`; main backend updates `last_heartbeat_at`.
7. **O1 progress callback** — Remotion's `onProgress` updates `lahari_renders.progress` + `lahari_renders.stage`, throttled to ~1 update/3s.
8. **O4 error classification** — Renderer maps obvious failures to `bundle_failed`, `chromium_oom`, `asset_404`, `supabase_5xx`, `timeout`, `empty_output`, or `renderer_failed`; backend-only failures use `renderer_rejected`, `renderer_unreachable`, `callback_failed`, `watchdog_timeout`.
9. **UI progress bar** — `StepRender.tsx` renders a thin bar and stage card fed by `/render-status`.
10. **O3 stamp `modal_function_call_id`** — In `modal_app.py`, capture the spawned `FunctionCall` id when Modal exposes one and return it to main backend; `/render` stamps it on the row.

After Phase 2: artists see live progress, we can join Modal dashboard logs to render rows by `modal_function_call_id`, every render lifecycle event is recoverable from DB alone.

### Phase 3 — Resilience (1 PR, ~1 day)

Builds on Phase 2 columns.

11. **F3 callback retry budget** — Bump `CALLBACK_RETRY_DELAYS_MS` to ~5 min total with jittered exponential backoff. Done in code.
12. **F3 renderer-side direct Supabase fallback + backend reconciler** — If `postCallback` exhausts all retries, the renderer writes a terminal fallback row/result. A backend reconciler later runs the normal `finalizePublish` path. Do not duplicate queue/project/asset business logic inside the renderer. Done in code.
13. **F2 cancel-on-watchdog** — When watchdog flips a row, if `modal_function_call_id` is set, call `modal.FunctionCall.from_id(...).cancel()`. Stops paying for the hung container. Still pending; needs a safe Node/Railway-to-Modal cancel path.
14. **F6 404 non-retriable in `postCallback`** — and precheck `selectOne('projects',...)` in `render-job.ts` to exit early if the project was deleted mid-render. Done in code, with `project_deleted` error code.
15. **E6 renderer-side 50min hard cap** — `Promise.race(runRenderJob(), timeout(50 * 60 * 1000))`. Lets us send a clean failure callback before Modal's 60min SIGKILL. Done in code for `renderTimeline`.

After Phase 3: callbacks survive Railway redeploys, the renderer can self-report completion even when main backend is down, hung Modal containers get cancelled (cost savings), deleted projects don't leak renders, the 60-min hard cap is replaced with a 50-min soft cap that gives us a callback path.

### Phase 4 — Efficiency (separate PR, ~1 day)

The big visible win for artists.

16. **E1 asset pre-staging** — Before `renderMedia` in `render-job.ts`, walk `trackItemsMap`, parallel-fetch (concurrency=16) every remote video/image/audio URL into `/tmp/lahari-render-<renderId>-*`, validate HTTP status/content length/content type, serve staged files over loopback HTTP for Remotion, and clean the temp dir in `finally`. Done in code. Result: one parallel burst replaces serialized network waits during render.
17. **E2 bake bundle into Dockerfile** — Run `@remotion/bundler` at Docker build time, save `out/` into the image. Skip `bundle()` in `render.ts` if `out/` exists. Done in code. Saves ~15s on cold renders.
18. **E5 timeline-hash dedup** — Compute SHA-256 of canonicalized timeline. If a completed row exists for that hash within last N days, short-circuit and copy `(video_url, storage_path)` to the new row. Optional save-mode setting if artists want to force re-render.

After Phase 4: typical 22-shot 2:40 render goes from 15–25 min → expected 3–5 min.

### Phase 5 — Polish (deferrable)

Pick from Section 4 as time allows. None are blocking.

---

## Top 5 to ship first (if not doing all 4 phases at once)

1. **F1 — Orphan-render watchdog.** Directly addresses the stuck-render incident. Without it every other observability fix still leaves rows wedged at `rendering`. Smallest blast radius, biggest user-visible win.
2. **F8 — Detect renderer non-2xx response and flip row to failed.** Two-line change. Closes the silent-401/500 failure mode that F1 only papers over.
3. **F3 — Bolster postCallback + add renderer terminal fallback + backend reconciler.** Removes the single most fragile link in the pipeline (an HTTP hop to a Railway box mid-deploy) without duplicating `finalizePublish` logic inside the renderer.
4. **F4 + F7 — Empty-output guard + dedup-on-render-row.** Both tiny, both close real edge cases. Bundle with #2.
5. **O1 + O6 — Render progress + heartbeat.** Same plumbing (`lahari_renders.progress`, `lahari_renders.last_heartbeat_at`). Unlocks observability for the next incident *and* gives the artist a moving bar.

(E1 — asset pre-staging — is the highest-leverage *efficiency* fix and probably P0 by Q3, but ship the recovery rail first because cost ≠ correctness.)

---

## Explicit out-of-scope (do not do)

- **Splitting `render_job` into bundle/render/upload Modal functions.** Tempting for fault isolation but introduces network hops between stages, more state to sync, and Modal billing for orchestration. The single-function model is right.
- **Streaming progress via SSE/WebSocket** instead of 4s polling. The poll is fine — 50 polls × 4s during a 3-min render is nothing. SSE only matters at 100+ concurrent artists.
- **Rewriting `finalizePublish` as a transactional saga.** Three writes, single user, recovery is "redo finalize" not "compensate." Add an SQL function (F9) if/when it bites, not preemptively.
- **Multi-region renderer fleet.** Supabase → Mumbai migration (already on the future-work list) is the real fix. Renderer fleet sharding is premature until that lands.
- **Replacing PostHog with full Sentry rollout for the main backend.** Sentry on the *renderer* (O2) is high-value because that's where crashes hide. The main backend's failures are already visible.
- **Render queue with explicit priorities.** No evidence artists are queueing; `max_containers=20` is well above current concurrent demand.
- **WASM ffmpeg / in-browser render.** Different architecture, not a gap fix.

---

## Critical files for implementation

- `server/routes/render.ts` — `/render` POST, `/render-status` GET
- `server/routes/render-callback.ts` — `/api/renders/callback/:renderId`
- `server/routes/queue.ts` — `finalizePublish()` writeback
- `server/index.ts` — where the F1 watchdog `setInterval` would live
- `remotion-renderer/modal_app.py` — Modal app, ASGI front door
- `remotion-renderer/src/render-job.ts` — Node CLI, `postCallback`
- `remotion-renderer/src/render.ts` — `renderTimeline`, `selectComposition`, `renderMedia`
- `remotion-renderer/src/storage.ts` — Supabase upload, bucket config
- `components/StepRender.tsx` — frontend render UI + polling
- `migrations/` — new file for `lahari_renders` columns

---

## Deploy order (when shipping all 4 phases)

1. **Phase 1** → merge to main → `railway up --detach`. Watchdog active immediately.
2. **Phase 2 migration** → run via Supabase Management API. Verify columns exist.
3. **Phase 2 code** → merge to main. Deploy main backend (`railway up`) and renderer (`modal deploy`) in either order; Phase 2 backend code tolerates missing heartbeat/progress (just shows static "rendering").
4. **Phase 3** → merge + deploy both. Tested by intentionally killing a render mid-flight.
5. **Phase 4** → merge + `modal deploy` only (renderer-only changes mostly). Verify with a fresh render on a typical project — should drop from 15+ min to 3–5 min.

---

## Open questions to resolve before starting

1. **Which bucket is canonical?** Resolved for Phase 1: production renderer writes to `videos`, so backend delete defaults to `videos`. Future cleanup can migrate renderer output and existing objects to `lahari-assets`.
2. **What's `MAX_RENDER_MINUTES`?** Currently Modal hard-caps at 60. Watchdog needs to know when to flip. Suggest 65 min (5 min grace after Modal would have given up).
3. **Should E5 timeline-hash dedup be opt-in or default?** Default = fast iteration. Opt-in = artist trust. Suggest default with an explicit "Force re-render" checkbox.
4. **Sentry account exists?** O2 assumes we have one. Confirm before Phase 2.
