# Mirage Post-Smoke Product Ledger

**Date opened:** 2026-06-17  
**Status:** Active product ledger — smoke-derived Mirage maturity work  
**Horizon:** after the first serious music-video smoke, before Lahari tenant convergence

## Purpose

This ledger tracks product work discovered from operating Mirage end to end on real music-video
material. It is not the Lahari convergence ledger. Convergence stays about workspaces, tenant
shape, Lahari queue/data cutover, and shared-codebase decisions. This doc owns what the smoke
revealed about making Mirage itself better: visible payloads, durable overrides, leaner
shot-scoped agent reads, local audit artifacts, timeline UX, and render ops.

## Fast Read

- The end-to-end music-video loop is usable. The next frontier is not "make it basically work";
  it is making the system legible, controllable, and hard to misuse.
- Prompt/payload auditing materially improved creative output during the smoke. That power
  should become a Studio product surface, not remain an agent-only debug trick.
- The local workbench was useful mostly for AGENTS/skills and as a conceptual/audit substrate.
  Live MCP state and shot-scoped actions did the real production work. The workbench should
  become a durable audit cache and optional large-text editing surface, not the default
  production surface for every move.
- The agent slowed down on broad reads (`open_project`) and repeated full dry-run prompt bodies.
  Next reads should be shot-scoped and summary-first, with exact payloads available on demand.
- The render timeline works, but it is still basic. It needs clearer clip/audio controls,
  canonical-vs-local state, render eligibility, and storage/preview policy.
- The HF sketch-board technique is a winning music-video storyboard path. It should be the
  canonical board-planning mode for HF/music-led projects, with normal rendered boards still
  available for other workflows.
- The best HF video payload spine is: workflow format + locked storyboard + explicit refs +
  cut plan. Shot-direction Beat text should be excluded by default for HF music-video video
  generation; artists/agents can opt it back in when it is actually useful.

## Locked Product Calls

- **P0 — Canonical state remains live Mirage.** MCP/API state is the production truth.
  Workbench files are desk copies, local memory, and audit artifacts.
- **P1 — Prompt power must be inspectable.** If a model sees it, an agent or human should be
  able to inspect where it came from and whether it was included.
- **P2 — One-off overrides stay one-off until deliberately saved.** `contextOverrides` are
  generation-call controls by default. "Save as shot default" or "save as project/workflow
  override" must be explicit.
- **P3 — Summary first, exact payload on demand.** Routine agent reads should be compact.
  Exact final prompts, full project packets, and notebook-wide manifests are pull-only debug
  surfaces.
- **P4 — Timeline power comes after timeline clarity.** Do not add broad agent timeline actions
  until the timeline has clean canonical/local state, clip controls, and render eligibility.
- **P5 — Do not poll by habit.** After launching a paid async generation, return the job id and
  let Studio/realtime or an explicit user request drive status polling. Polling should be a
  conscious watch mode, not the default agent loop.

## Tracks

### P1 — Studio Payload Inspector `[ready now]`

**Goal:** Studio users can see and edit the same generation payload anatomy the agent sees.

**First surface:** storyboard-mode video generation.

Show composed sections:

- `format`
- `animation`
- `beat`
- `refs`
- `cut_plan`
- `audio`
- `guardrail`
- final provider prompt

For each section, show:

- included/excluded state
- source (`workflow recipe`, `shot direction`, `locked refs`, `storyboard/cut plan`,
  `audio analysis/source song`, `project override`, `contextOverrides`, `promptOverride`)
- edit path or owner
- compact body preview, expandable to full text

**Manipulation:** humans can remove or restore safe sections before spending: remove Beat,
suppress Cut Plan, exclude Refs, hide Audio, or inspect exact final prompt. The dry run updates
before the paid call.

**Done when:** a human can open a shot in Studio, inspect the full effective payload, toggle one
section, dry-run, and generate with exactly the visible payload.

### P2 — Durable Override Parity `[ready now]`

**Goal:** Agent and Studio do not silently diverge after an override.

Problem found in smoke: Codex can generate with `contextOverrides.includeShotBeat=false`, but a
later Studio click falls back to default shot-direction inclusion unless that choice is visible
or persisted. For HF music-video, the better default is no Beat segment at all — the cut plan
and refs own staging. `contextOverrides.includeShotBeat=true` is the opt-in escape hatch.

Rules:

- Per-call `contextOverrides` remain ephemeral and visible as ephemeral.
- Studio can explicitly persist useful choices as:
  - shot default
  - project prompt override
  - workflow recipe/project metadata
- Studio should show whether the current payload differs from project defaults.

**Done when:** if an agent excludes Beat or Cut Plan for a shot, Studio either shows that as a
one-off prior generation or offers a clear "save this behavior" path. A Studio regeneration no
longer surprises the user by silently reintroducing a previously removed segment.

**First code slice:** HF music-video storyboard video generation excludes the `beat` segment by
default while preserving the segment in the audit as not-included. Studio and MCP both inherit
that behavior because it lives in the composer/prompt path, not in an agent habit.

### P3 — Storyboard Composer Audit `[ready now]`

**Goal:** Storyboard generation gets the same prompt-anatomy discipline as video.

Work:

- Make HF sketch-board generation the canonical storyboard render contract for HF/music-led
  projects: pure white paper, black ink/pencil, no color, no labels, refs translated into
  sketch guidance rather than copied as final art.
- Map every storyboard prompt segment: format, style, cast refs, env refs, prior board,
  continuity, guardrails, final image prompt.
- Remove duplicate/conflicting wrapper language.
- Keep recipe-owned format language separate from universal image-generation guardrails.
- Persist attempt anatomy so the latest storyboard prompt can be inspected after generation.
- Add dry-run/describe support once the composer exists.

**Read-side rule:** `describe_video_prompt` is only the prototype. When storyboard becomes the
second composed surface, design `describe_prompt({ kind, projectId, shotId?, entityId? })`
instead of adding a family of `describe_*_prompt` tools.

### P4 — Shot-Scoped Agent Reads `[ready now]`

**Goal:** Avoid using broad project packets for local shot decisions.

Director smoke feedback:

- `open_project(detail:"production")` is useful but too broad for repeated per-shot work.
- Dry-run payload is excellent but too full by default when the agent only needs included
  sections, refs, params, and model choice.
- Notebook manifests are too chunky when the agent already knows the target shot/file.

Candidate tools/modes:

- `get_shot_context(projectId, shotId)` — shot id, label, scene, board/video status, refs,
  prompt state, stale flags, available actions.
- `read_storyboard_state(projectId, shotId)` — storyboard prompt, cut plan, locked version,
  candidates/history summary.
- `generate_video({ dryRun: true, dryRunSummary: true })` — sections/params/refs by default;
  exact final prompt only when requested.
- Filtered notebook manifest or direct path readers for common shot artifacts.

**Done when:** a director session can operate shot-by-shot without repeatedly loading the full
project graph or full prompt bodies.

### P5 — Local Audit Artifacts `[ready soon]`

**Goal:** Make the workbench genuinely useful after each generation.

The useful missing artifact is a compact, durable local record per generated shot:

`mirage/projects/<projectId>/state/generation-traces/<shot>-final-payload.json`

or a paired `prompt-recipe.md` with:

- job id / attempt id
- model/provider params
- storyboard/keyframe asset ids
- refs included/excluded
- segments with source/edit path
- exact final prompt if requested
- output asset id / video id / board version
- source hashes

**Done when:** after a generation, an agent can diagnose "why did this happen?" from one local
artifact instead of re-querying project state, job status, and prompt composition separately.

**Workbench role after smoke:** useful for audit/export/debug and large-text handoff; not the
primary creative loop. Do not make every Studio/MCP action depend on a fresh local sync. The
local artifact should be written opportunistically when sync happens, not become a serial blocker
for creative iteration.

### P5b — Async Job Watch Discipline `[ready now]`

**Goal:** paid async jobs should not freeze the director session.

Rules:

- `start_job` returns the job id and the agent should move on unless the user explicitly asks it
  to watch/poll.
- Studio realtime and the visual timeline are the default progress surface.
- If watching is useful, make it an explicit lightweight mode: "watch this job and notify me" or
  "poll every N seconds while I do X".
- Long-running jobs should preserve late outputs even after the user starts an alternate attempt.

**Done when:** director sessions can launch a job, continue editing another shot, and later inspect
the completed output/history without spending chat turns on serial polling.

### P5c — Isolated Image Fix Workers `[ready soon]`

**Goal:** precise board/image repairs should not bloat the main director context.

Use Codex imagegen or a subagent/background worker for small visual fixes, then import the result
through the existing upload/import actions (`import_storyboard_image`, `lock_storyboard`) with a
compact receipt. The main director thread should carry the intent, selected asset id, and result,
not the full visual iteration transcript.

### P6 — Render Timeline UX `[after P1/P2 shape is clear]`

**Goal:** Make Render feel like a real production timeline, not a basic append-only preview.

Focus areas:

- clearer local draft vs canonical saved timeline state
- clip library/media drawer as a first-class source
- original vs generated vs voice-changed clip/audio toggles
- trim, mute, replace, align, and recover controls
- render eligibility indicator (`FFmpeg` vs `Remotion`, with reason)
- direct access to render history and salvaged late outputs

Agent actions should follow these UI/data primitives, not precede them.

### P7 — Render Ops + Storage Policy `[ready now]`

**Goal:** Long final renders should not fail at upload time.

Smoke finding: a 74.8 MB FFmpeg render completed successfully but failed Supabase upload because
the storage project rejected the object size. Local recovery worked, but this is not an artist
path.

Decisions needed:

- upgrade/use storage that accepts long final MP4s
- or add explicit preview compression policy for long renders
- or split preview/final buckets with different quality/cap expectations

**Done when:** long music-video renders have a predictable destination, and Studio tells the
artist before rendering if the expected output may exceed the current storage cap.

## Sequencing

Recommended order:

1. P1 video payload inspector.
2. P2 durable override parity for the same surface.
3. P3 storyboard composer audit.
4. P4 shot-scoped agent reads and summary-first dry-run mode.
5. P5b async job watch discipline.
6. P5 local audit artifacts and P5c isolated image fix workers.
7. P7 storage/render ops fix.
8. P6 timeline overhaul and then timeline agent actions.

P1/P2 are the most valuable first slice because they turn the successful smoke maneuver into a
repeatable human/agent product surface.

## Checkpoints

- 2026-06-16 · smoke complete · — · Lingashtakam/Suprabhatam music-video smoke worked fairly
  well. Prompt/payload audit directly improved creative quality. Director feedback: live MCP
  state and decomposed prompt payloads were more useful than local workbench editing; biggest
  friction was broad `open_project` payloads and verbose dry-run prompt bodies. Render surfaced
  a storage object-size cap; local recovery produced a valid MP4.
