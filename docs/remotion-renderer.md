# Remotion Renderer Service

**Status:** Ops reference. Update when the Remotion fallback renderer contract changes.

A standalone Hono service that renders the timeline editor's preview to an
mp4 using Remotion SSR. Lives at `remotion-renderer/`. Deploys as its own
Docker image so the heavy Chromium + ffmpeg footprint stays out of the main
Lahari backend.

## Why a separate service

- Remotion's `renderMedia()` spawns headless Chromium and runs ffmpeg —
  hundreds of MB of system libs the rest of the backend doesn't need.
- A long render shouldn't block the Express request loop.
- Render boxes can scale (CPU/GPU) independently from the API.

## Architecture

```
StepRender.tsx
   │  POST /api/projects/:id/render   { timeline state }
   ▼
Lahari Express backend
   │  POST <REMOTION_RENDERER_URL>/render   { projectId, timeline }
   │  header: x-renderer-secret
   ▼
remotion-renderer (Hono)
   │  bundle() → selectComposition() → renderMedia()  (cached bundle)
   │  upload mp4 → Supabase Storage (lahari-assets/videos/<projectId>/...)
   ▼
returns { videoUrl, sizeBytes, durationInFrames }
```

The project song is part of the timeline itself — it rides inside
`timeline.trackItemsMap` as an `audio` item on its own track, seeded by
`StepRender` from `project.audioPath`. The backend no longer injects audio.

The renderer **never** talks to the frontend directly. Auth, project
ownership, and queue writeback all stay in the main backend.

## Payload contract

`POST /render` (header: `x-renderer-secret: $RENDERER_SHARED_SECRET`)

```json
{
  "projectId": "abc123",
  "timeline": {
    "trackItemIds": ["item-1", "item-2", "song-item"],
    "trackItemsMap": {
      "item-1": { "type": "video", ... },
      "item-2": { "type": "video", ... },
      "song-item": { "type": "audio", "details": { "src": "https://.../song.mp3", "volume": 100 }, ... }
    },
    "transitionsMap": { "tr-1": { ...ITransition } },
    "fps": 30,
    "size": { "width": 1920, "height": 1080 },
    "durationMs": 12500
  }
}
```

The `timeline` block is exactly the render-authoritative subset of the
zustand store at `components/timeline-editor/store.ts`. UI-only fields
(`scale`, `scroll`, `activeIds`, `playerRef`, `stateManager`) MUST be
stripped client-side before POSTing.

Response on success:

```json
{
  "videoUrl": "https://....supabase.co/storage/v1/object/public/lahari-assets/videos/abc123/...mp4",
  "storagePath": "videos/abc123/1700000000000-lahari-render-uuid.mp4",
  "sizeBytes": 5234567,
  "durationInFrames": 375,
  "width": 1920,
  "height": 1080,
  "renderMs": 42180
}
```

## How the timeline files stay in sync

The renderer needs the same composition logic as the in-app editor
(`components/timeline-editor/Composition.tsx`, `effects.ts`,
`track-items-utils.ts`). To keep the renderer Docker image self-contained,
we **hard-copy** those files into `remotion-renderer/src/timeline/` rather
than reaching across folders at runtime.

After editing any of the upstream files:

```bash
cd remotion-renderer
npm run sync-timeline
```

The script copies `effects.ts` and `track-items-utils.ts` verbatim and
strips the `useStore`/`StoreComposition` wrapper from `Composition.tsx`.
Each synced file gets a `// SYNCED FROM ...` banner so it's obvious in
review when something has drifted.

If you change `Composition.tsx`'s prop interface, also update
`remotion-renderer/src/Video.tsx` (the Remotion composition wrapper) since
it imports `CompositionInput` from the synced copy.

## Local dev

```bash
cd remotion-renderer
npm install
RENDERER_SHARED_SECRET=dev \
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
npm run dev
# listening on :3030
```

Iterate on the composition itself with the Remotion Studio:

```bash
npm run studio
# opens http://localhost:3000 with hot reload
```

## How it's wired into the main backend

Already shipped. The flow:

1. `StepRender.tsx` snapshots the render-authoritative subset of the
   timeline store (`useStore.getState()`, picking `trackItemIds`,
   `trackItemsMap`, `transitionsMap`, `fps`, `size`, `duration → durationMs`)
   and calls `renderTimeline()` in `services/api.ts`.
2. Main backend route `server/routes/render.ts` (mounted at
   `/api/projects/:id/render`, behind `requireAuth` + the standard
   `router.param('id')` ownership check) forwards to the renderer with the
   `x-renderer-secret` header. No audio injection — `StepRender.tsx` already
   seeded the song as an `audio` item inside `trackItemsMap` using the public
   URL at `project.audioPath`.
3. Renderer returns `{ videoUrl, storagePath, sizeBytes, durationInFrames,
   width, height, renderMs }`.
4. `StepRender.tsx` immediately calls `publishRenderUrl()` → main backend
   route `POST /api/queue/publish-url/:projectId` (JSON body
   `{ videoUrl, storagePath }`). That hits `finalizePublish()` in
   `server/routes/queue.ts` — the same writeback logic the old multipart
   `/publish/:projectId` uses: registers the `assets` row, walks the fork
   chain, marks the originating queue row `completed`, and sets
   `projects.status = 'completed'`.

The multipart `/publish/:projectId` endpoint still exists for any client
that wants to upload a blob directly. New code should use `/publish-url`.

## Env vars

**Main backend** (`.env` + Railway service `lahari-media-engine`):

| Var | Value |
|-----|-------|
| `REMOTION_RENDERER_URL` | e.g. `https://remotion-renderer-production.up.railway.app` (no trailing slash) |
| `RENDERER_SHARED_SECRET` | any strong random string — must match the renderer's value |

**Renderer service** (its own Railway service):

| Var | Value |
|-----|-------|
| `SUPABASE_URL` | same as main backend |
| `SUPABASE_SERVICE_KEY` | same as main backend (renderer uploads to `lahari-assets`) |
| `SUPABASE_BUCKET` | optional, defaults to `lahari-assets` |
| `RENDERER_SHARED_SECRET` | same random string as the main backend |
| `PORT` | Railway sets this automatically |

## Production / deployment

- New Railway service pointing at `remotion-renderer/Dockerfile`.
- Env vars as listed above.
- Renderer is private — only the main backend should reach it. Either keep
  it on Railway's private network (recommended) or rely on the shared
  secret as the primary barrier.

The Dockerfile pre-runs `npx remotion browser ensure` so the first request
doesn't pay the ~100MB Chrome download.

## Future work

### Render progress streaming

`renderMedia()` reports per-frame progress. The current endpoint waits for
the full render before returning. To show live progress in the UI, swap
the response for SSE (`text/event-stream`) and pipe the `onProgress`
callback through.
