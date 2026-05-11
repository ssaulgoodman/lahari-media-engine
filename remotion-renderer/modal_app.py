"""Modal deployment for the Remotion renderer.

This file is pure infrastructure — it declares the container image (reusing
the existing Dockerfile) and two Modal functions that wrap the Node renderer:

  * `web`       — tiny FastAPI ASGI app. Receives POST /render from the main
                  backend, validates the shared secret, enqueues a job via
                  `render_job.spawn`, returns 202 immediately. Runs with
                  min_containers=1 so the endpoint stays warm.
  * `render_job`— the heavy render. Shells out to `npx tsx src/render-job.ts`
                  inside the same image CapRover runs. 8 CPU / 16 GB / 30 min
                  timeout. Scales 0 → N on demand; pays only while rendering.

The Node code doesn't know or care it's running on Modal — the shell-out
pattern keeps `src/render-job.ts` host-agnostic so the same binary path runs
locally, on CapRover, on Modal, and later on RunPod.

Deploy:  `modal deploy modal_app.py`       (prod)
Dev:     `modal serve modal_app.py`        (hot-reload, prints a staging URL)

Secrets: create once via
  modal secret create lahari-renderer-secrets \\
    RENDERER_SHARED_SECRET=... MAIN_BACKEND_URL=... \\
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \\
    POSTHOG_API_KEY=... POSTHOG_HOST=...
"""
import json
import subprocess

import modal


# from_dockerfile reuses the Dockerfile verbatim — same Chromium libs, ffmpeg,
# and tsx toolchain that CapRover/local use. `add_python="3.11"` is required
# because Modal's image introspection can't reliably detect Debian's
# apt-installed Python; Modal then layers in its own standalone Python build
# (used to run this file's function bodies).
#
# fastapi must be installed into Modal's Python (not the apt one) because
# `@modal.asgi_app()` imports it at runtime from the interpreter Modal spawns.
# Our apt-installed python3 + pip packages stay in the image for RunPod's
# handler and still work for CapRover/local.
image = (
    modal.Image.from_dockerfile("Dockerfile", add_python="3.11")
    .pip_install("fastapi")
)

app = modal.App("lahari-remotion-renderer", image=image)

# One named secret covers everything the Node subprocess needs. Modal mounts
# it as environment variables inside the container, so process.env.SUPABASE_URL
# etc. in the Node code resolve without any code change.
secrets = [modal.Secret.from_name("lahari-renderer-secrets")]


@app.function(
    secrets=secrets,
    cpu=8.0,            # doubles CapRover's 2 vCPU — expect ~4x wall-clock speedup
    memory=16384,       # 16 GB: Chromium + ffmpeg + bundle fit comfortably
    timeout=3600,       # 60 min ceiling; a single 5-min song renders well under this, but cross-region asset pulls + occasional Chromium hangs can blow past 30 min
    max_containers=20,  # throttle fan-out so one spike doesn't eat the budget
)
def render_job(render_id: str, project_id: str, timeline: dict) -> dict:
    """Run the Node renderer as a subprocess with stdin-piped JSON payload.

    render-job.ts emits a single JSON line on stdout with the final
    {ok, videoUrl, storagePath, ...} result. It also POSTs the same payload
    back to MAIN_BACKEND_URL/api/renders/callback/<renderId> via its own
    retry logic, so the main backend sees the result regardless of whether
    this function returns cleanly. We still return the parsed result here
    so it's visible in Modal's dashboard + function-call logs.
    """
    payload = json.dumps({
        "renderId": render_id,
        "projectId": project_id,
        "timeline": timeline,
    })
    proc = subprocess.run(
        ["npx", "tsx", "src/render-job.ts"],
        input=payload,
        text=True,
        capture_output=True,
        cwd="/app",
    )
    # Non-zero exit means the Node CLI hit an unrecoverable error *before*
    # it could even call postCallback. Surface it so Modal's dashboard shows
    # the failure (main backend will not have been notified in this case).
    if proc.returncode != 0:
        raise RuntimeError(
            f"render-job exited {proc.returncode}\nstderr:\n{proc.stderr}\nstdout:\n{proc.stdout}"
        )
    # Last line of stdout is the JSON result from runRenderJob.
    last_line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    try:
        return json.loads(last_line)
    except json.JSONDecodeError:
        # If stdout is unparseable the render likely still succeeded (postCallback
        # fires independently) — return a best-effort marker for the dashboard.
        return {"ok": True, "raw_stdout": proc.stdout[-500:]}


@app.function(secrets=secrets, min_containers=1)
@modal.asgi_app()
def web():
    """FastAPI front door. Drop-in compatible with the existing Hono endpoint
    so the main backend only needs to flip REMOTION_RENDERER_URL — no other
    code change, no new auth pattern."""
    import os

    from fastapi import FastAPI, Header, HTTPException, Request

    api = FastAPI()
    shared_secret = os.environ["RENDERER_SHARED_SECRET"]

    @api.get("/health")
    def health():
        return {"ok": True}

    @api.post("/render")
    async def render(req: Request, x_renderer_secret: str = Header(default="")):
        if x_renderer_secret != shared_secret:
            raise HTTPException(status_code=401, detail="unauthorized")

        try:
            body = await req.json()
        except Exception:
            raise HTTPException(status_code=400, detail="invalid JSON body")

        render_id = body.get("renderId")
        project_id = body.get("projectId")
        timeline = body.get("timeline")
        if not render_id or not project_id or not isinstance(timeline, dict):
            raise HTTPException(
                status_code=400,
                detail="renderId, projectId, and timeline are required",
            )

        # Fire-and-forget. Modal keeps render_job alive on its own container
        # regardless of what happens to this ASGI request. Returns a FunctionCall
        # handle we could query later; we don't need it because the Node CLI
        # POSTs the final result back to the main backend via postCallback.
        call = render_job.spawn(render_id, project_id, timeline)
        modal_function_call_id = (
            getattr(call, "object_id", None)
            or getattr(call, "function_call_id", None)
            or getattr(call, "call_id", None)
        )
        return {
            "accepted": True,
            "renderId": render_id,
            "modalFunctionCallId": modal_function_call_id,
        }

    return api
