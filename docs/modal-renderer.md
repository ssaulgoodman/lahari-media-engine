# Modal renderer deployment

How to deploy the `remotion-renderer` service to Modal and switch the main
backend over. Companion to `docs/remotion-renderer.md` (which describes the
service itself — architecture, request shape, callback contract).

## TL;DR

Everything Modal-related lives inside `remotion-renderer/`:

- `Dockerfile` — shared with CapRover, already includes Python + `modal` SDK.
- `modal_app.py` — ~100 lines, declares the Modal app + two functions (`web`, `render_job`).
- `.venv/` — created by `uv init`, git-ignored.

The Node renderer code is host-agnostic — `src/render-job.ts` is the CLI that
Modal shells into via `npx tsx`. Nothing in `src/` knows it's on Modal.

## One-time setup

### 1. Python env + modal CLI

If the `.venv` already exists (created via `uv init`) and Modal is installed:

```bash
cd remotion-renderer
uv run modal --version          # confirms Modal is installed in this env
```

If starting fresh:

```bash
cd remotion-renderer
uv init --python 3.11           # creates .venv + pyproject.toml
uv add modal runpod             # installs into .venv, updates pyproject.toml
```

### 2. Authenticate with Modal

```bash
uv run modal token new
```

Opens a browser, pairs this machine with your Modal workspace, writes
`~/.modal.toml`. One-time per machine.

### 3. Create the secret

Modal mounts secrets as environment variables inside the function containers.
This single named secret covers everything the Node subprocess needs:

```bash
uv run modal secret create lahari-renderer-secrets \
  RENDERER_SHARED_SECRET=<same value as main backend> \
  MAIN_BACKEND_URL=https://lahari-media-engine-production.up.railway.app \
  SUPABASE_URL=<supabase project url> \
  SUPABASE_SERVICE_KEY=<supabase service role key> \
  SUPABASE_BUCKET=lahari-assets \
  POSTHOG_API_KEY=<posthog project key> \
  POSTHOG_HOST=https://us.i.posthog.com
```

To update a value later, re-run with the same name — Modal overwrites:

```bash
uv run modal secret create lahari-renderer-secrets FOO=bar --force
```

Mirage uses the same renderer code but deploys as a separate Modal app with a
separate secret so Lahari production settings are not overwritten:

```bash
uv run modal secret create mirage-renderer-secrets \
  RENDERER_SHARED_SECRET=<same value as Mirage backend> \
  MAIN_BACKEND_URL=https://mirage-platform-production-05ca.up.railway.app \
  SUPABASE_URL=<Mirage Supabase project url> \
  SUPABASE_SERVICE_KEY=<Mirage Supabase service role key> \
  SUPABASE_BUCKET=mirage-assets \
  DB_TABLE_PREFIX=studio
```

## Deploy

### Production

```bash
cd remotion-renderer
uv run modal deploy modal_app.py
```

For Mirage:

```bash
MODAL_APP_NAME=mirage-remotion-renderer \
MODAL_SECRET_NAME=mirage-renderer-secrets \
uv run modal deploy modal_app.py
```

Modal builds the Dockerfile image (~5-10 min first time, fast incremental
builds after), registers the functions, and prints the web endpoint URL:

```
✓ Created web function at https://<workspace>--lahari-remotion-renderer-web.modal.run
```

Copy that URL.

### Dev / staging (hot reload)

```bash
uv run modal serve modal_app.py
```

Live-reloads on file save, prints a temporary URL that goes away when you
Ctrl+C. Good for iterating on `modal_app.py` itself.

## Switch main backend to Modal

On Railway (or wherever the main backend runs), update one env var:

```
REMOTION_RENDERER_URL=https://<workspace>--lahari-remotion-renderer-web.modal.run
```

`RENDERER_SHARED_SECRET` stays the same — both Modal and the main backend
already share it. No code change on the main backend, no route change, no
callback contract change. Drop-in swap.

Redeploy the main backend (`railway up --detach`). New renders go to Modal.

### Rollback

Flip `REMOTION_RENDERER_URL` back to the old CapRover URL and redeploy. No
Modal cleanup needed — the functions sit idle at $0/hour when nothing's
hitting them.

## Operational commands

| What | Command |
|------|---------|
| Deploy prod | `uv run modal deploy modal_app.py` |
| Dev / staging | `uv run modal serve modal_app.py` |
| Tail logs from a running app | `uv run modal app logs lahari-remotion-renderer` |
| List all deployed apps | `uv run modal app list` |
| Stop the app (takes it offline) | `uv run modal app stop lahari-remotion-renderer` |
| Show secret names | `uv run modal secret list` |
| Update secret | `uv run modal secret create lahari-renderer-secrets KEY=val --force` |

## Architecture inside Modal

```
  POST /render                    ┌────────────────────────────┐
  (main backend →)               │ web   @modal.asgi_app()     │
  x-renderer-secret          ───▶│  FastAPI, min_containers=1   │  <1s
  JSON {renderId, ...}            │  validates secret,           │
                                  │  render_job.spawn(...)       │
                                  └──────────────┬───────────────┘
                                                 │ spawn()
                                                 ▼
                                  ┌────────────────────────────┐
                                  │ render_job                  │
                                  │   cpu=8, memory=16384,       │  5–30 min
                                  │   timeout=1800,              │
                                  │   max_containers=20          │
                                  │                              │
                                  │   subprocess: npx tsx        │
                                  │    src/render-job.ts         │
                                  │                              │
                                  │   render → upload → callback │
                                  └──────────────┬───────────────┘
                                                 │
                     POST /api/renders/callback/:renderId
                            (main backend)
```

- `web` stays warm (`min_containers=1`) so the API-side latency for the main
  backend is sub-second. Without it, cold start on the web endpoint would
  add 10-20 s to the first render after idle.
- `render_job` scales 0 → N on demand. No idle cost. `max_containers=20`
  caps fan-out so a burst of renders can't blow the budget.
- The Node subprocess uses the same `postCallback` retry logic as on CapRover.
  Main backend's `/api/renders/callback/:renderId` handler is the single source
  of truth for render state — doesn't care which host did the work.

## Monitoring

Web dashboard: https://modal.com/apps/<workspace>/main/deployed/lahari-remotion-renderer

Shows:
- Function invocations + durations
- Per-run logs (stdout/stderr from the Node subprocess)
- Error traces (Python exceptions from `render_job`)
- Cost per invocation

PostHog events (`renderer_benchmark`, `render_completed`) continue to fire
from inside the subprocess. Same events, different host.

## Expected wall-clock improvement

Baseline on CapRover (2 vCPU, 4 GB, single process, `concurrency: '100%'`):
- 1:40 song (~3000 frames, 1080p) ≈ 8 min

Projected on Modal (8 CPU, 16 GB, single container):
- 1:40 song ≈ 2-3 min
- Cold start adds ~20-30 s on first render after idle (image pull + Remotion
  bundle). Subsequent renders in the same container reuse both.

## Troubleshooting

**Deploy fails: `from_dockerfile context not found`.**
Run `modal deploy` from the `remotion-renderer/` directory. Modal's context
dir defaults to the Dockerfile's directory.

**Function crashes immediately with `RENDERER_SHARED_SECRET` KeyError.**
The secret isn't mounted. Confirm with `uv run modal secret list` that
`lahari-renderer-secrets` exists and that the env var names inside it match
what the code reads.

**Render runs on Modal but main backend never flips from `rendering` to `completed`.**
Modal executed the job fine, but `postCallback` couldn't reach the main
backend. Check:
- `MAIN_BACKEND_URL` inside the secret points at the correct Railway URL.
- `RENDERER_SHARED_SECRET` on Modal exactly matches the one on Railway.
- Railway isn't blocking outbound traffic from Modal's IP range.

Watch `uv run modal app logs lahari-remotion-renderer` — failed callbacks
log `[render <id>] callback attempt N/M failed <status>: <body>` with
the exact HTTP error.

**"Target crashed" errors during renderMedia.**
Modal's default `/dev/shm` is small. Chromium needs more. Add
`chromiumOptions: { gl: 'swiftshader', ... }` in `render.ts` is already set;
if crashes continue, append `disableWebSecurity: true` or pass
`--disable-dev-shm-usage` via Remotion's Chromium flags.

**Slow cold start (>60 s).**
First build pulls the entire image (~2 GB). Subsequent deploys only push
changed layers. If cold start is consistently slow after idle, raise
`min_containers=1` on `render_job` to keep one warm (costs ~$20-40/mo of
idle CPU time depending on workspace plan).
