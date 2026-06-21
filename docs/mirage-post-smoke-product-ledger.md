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
- The render timeline has moved from basic preview toward a usable editing surface:
  server-backed local-vs-canonical saves, render preflight, media drawer, thumbnails, waveforms,
  markers, frame-accurate transport, duplicate, shortcut help, and a safer draggable playhead are
  landed locally. Remaining frontier: snapping/toggles, richer track controls, export/Premiere
  bridge, and storage/preview policy.
- The HF sketch-board technique is now the canonical storyboard planning path: black-and-white
  GPT Image 2 sketch boards by default, with final-style/rendered boards available only as a
  deliberate override.
- The best HF video payload spine is: workflow format + locked storyboard + explicit refs +
  cut plan. Shot-direction Beat text should be excluded by default for storyboard-video
  generation; artists/agents can opt it back in when it is actually useful.
- The larger product goal is an agent that gets smarter, faster, and more creative from each
  production run. Successful prompt moves, failed model calls, ref tricks, storyboard repairs,
  and render decisions should become reusable taste/workflow memory instead of dying in chat.
- Studio needs obvious manual override controls for power users: upload this storyboard exactly
  as-is, lock it, use it downstream. No ceremony.
- Mirage state should become self-explaining at the shot level. A fresh agent should not need
  chat archaeology to know the active workflow recipe, storyboard prompt provenance, payload
  slots, render/video state, and exact edit actions.
- Studio interaction polish is now part of the product loop: expanded prompt panels must not
  create huge blank scroll regions, and Lock/Generate buttons need immediate, elegant feedback
  instead of delayed/janky state changes.
- Top-bar agent/action indicators should feel refined: no crude flashing green/orange debug
  lights. Use calm spinners, progress pills, subtle motion, and clear status language.
- Render/editor is not the final creative surface. Mirage should hand shots, audio, captions,
  and metadata cleanly into a professional finishing path, ideally a Premiere Pro extension or
  export bridge, without losing Mirage shot identity.

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
- **P6 — Learning beats logging.** Audit artifacts only matter if the system can reuse them:
  promote repeated wins into recipes/style notes/personas/tool defaults, and surface candidate
  memories to the agent at generation time.
- **P7 — Pro finishing is a first-class path.** Mirage should make great clips and rough cuts,
  but the long-term editor bridge should respect professional finishing workflows.
- **P8 — Project defaults are not handcuffs.** A project can default to storyboard-mode or
  keyframe-mode, but individual shots must be able to override that choice without forking the
  project or confusing downstream eligibility.

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

### P1b — Studio Interaction Polish `[ready now]`

**Goal:** Studio controls feel immediate, stable, and professional during repeated generation
loops.

Problems observed:

- Expanded storyboard/prompt sections sometimes leave a long blank scroll region under the
  textarea/body, forcing the user to scroll through empty space before reaching the end.
- Core action buttons such as Lock and Generate can feel janky: feedback is delayed, spinner
  state is not always elegant, and button/state changes can lag the action the artist just took.
- Top-bar agent action indicators are too basic today: flashing green/orange state changes feel
  like debug telemetry instead of a polished creative tool.

Work:

- audit prompt/textarea containers for stale measured height, flex/min-height, virtualized
  scroll, or autosize bugs that leave empty vertical space after agent-written text changes
- make Lock/Generate actions optimistically show pending state immediately while still reconciling
  against canonical server success/error
- standardize disabled/loading/success/error button states across Studio shot cards and panels
- avoid layout jump when buttons change labels or spinner state
- replace flashing top-bar action notifications with refined activity indicators: quiet progress
  pills, soft spinners, smooth enter/exit transitions, and status copy that distinguishes
  running, succeeded, failed, and needs-attention states without loud color flashes

**Done when:** expanding a prompt section never creates phantom blank space, every Lock /
Generate click gives instant, calm feedback without shifting neighboring controls, and active
agent operations read as polished production status rather than blinking debug lights.

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

**Second code slice landed locally:** shots now carry `video_prompt_slots` as saved
storyboard-video segment defaults. Studio's prompt inspector can save `beat`, `refs`,
`cut_plan`, or `audio` as default/on/off for the next run, and agents use
`apply_shot_prompts.videoPromptSlots` for the same durable lever. One-off
`contextOverrides` still win for a single call and stay visible in the prompt audit.

### P2b — Per-Shot Workflow Mode Overrides `[ready soon]`

**Goal:** Let one shot use keyframe mode inside a storyboard-first project, or storyboard mode
inside a keyframe-first project, without changing the whole project default.

Problem found in smoke/planning: project-wide mode is useful as a default, but real productions
need exceptions. Some shots want an exact first-frame/keyframe path; others want a sketch board
plus cut plan. Artists should not have to bend the whole project just to handle one exceptional
shot.

Work:

- expose shot-level mode as an explicit saved field/default override, not an invisible UI habit
- show the effective mode on each shot: `project default` or `shot override`
- keep downstream eligibility clear: keyframe mode needs keyframes; storyboard mode needs an
  active/locked board as appropriate
- give agents the same lever through `apply_shot_workflow_modes`
- include the mode decision in prompt/payload anatomy and local audit artifacts

**Done when:** a director can set S3.1 to keyframe mode while the project remains storyboard-first,
generate through the keyframe path, then switch only that shot back without affecting neighboring
shots.

### P3 — Storyboard Composer Audit `[ready now]`

**Goal:** Storyboard generation gets the same prompt-anatomy discipline as video.

Work:

- Make HF sketch-board generation the canonical storyboard render contract: pure white paper,
  black ink/pencil, no color, no labels, refs translated into sketch guidance rather than copied
  as final art.
- Map every storyboard prompt segment: format, style, cast refs, env refs, prior board,
  continuity, guardrails, final image prompt.
- Remove duplicate/conflicting wrapper language.
- Keep recipe-owned format language separate from universal image-generation guardrails.
- Persist attempt anatomy so the latest storyboard prompt can be inspected after generation.
- Add dry-run/describe support once the composer exists.

**Backend slice landed locally:** storyboard image rendering now uses a provenance-returning
composer. Generated/refined storyboard versions persist `metadata.promptComposition` with exact
sent text, segment sources/edit paths, attached images, provider params, and HF/default render
mode. Storyboard history exposes this object. Studio now renders the same payload inspector for
storyboard render and video payloads, and MCP/Web reads use the generic
`describe_prompt({ kind })` path.

**Read-side rule:** `describe_prompt({ kind, projectId, shotId?, entityId? })` is the canonical
inspector. `describe_video_prompt` remains only as a compatibility alias; do not add a family of
`describe_*_prompt` tools.

### P3c — Self-Explaining Shot Working Set `[backend/MCP landed locally; Studio panel pending]`

**Goal:** A fresh agent or human can open one shot and immediately understand what controls the
next storyboard/video generation.

Problem found in smoke: even after payload inspection landed, agents still reconstructed too
much from scattered state: which workflow recipe is active, whether HF was applied before or
after storyboard prompts were written, whether Beat is excluded by recipe/shot/default/one-off,
what payload was last sent, and which exact action changes each piece.

Build one shot-level working set that powers both Studio and MCP:

- effective workflow/project recipe and where it comes from: workflow default, project override,
  shot override, or one-off generation call
- saved storyboard prompt provenance: written under which recipe/version, whether it predates the
  current recipe, whether the active board was generated/refined/imported under matching prompt
  text
- storyboard render payload summary: latest prompt composition, refs, provider params, active
  board/version id, and edit paths
- video payload summary: latest prompt composition, saved `videoPromptSlots`, one-off
  `contextOverrides` from the last attempt, attached refs, provider params, and edit paths
- generation eligibility: storyboard/keyframe mode, required assets, stale flags, locked state,
  provider/model, estimated spend, and known risk state
- recommended next actions: rewrite prompts under current recipe, save slot default, dry-run
  video, generate storyboard, import board as-is, switch shot workflow mode, repair refs, or open
  the relevant payload inspector

Surfaces:

- MCP: `get_shot_context(projectId, shotId)` or equivalent lean read, summary-first with exact
  prompt bodies delegated to `describe_prompt`
- Studio: quiet "Shot state" / "Recipe & payload" panel with labels for included/excluded
  reasons: workflow default, project default, shot default, one-off override, stale, or imported
- notebook/local sync: optional compact audit artifact, useful for debugging and handoff, not a
  blocker for authoring

2026-06-18 backend slice landed locally: `get_shot_context(projectId, shotId)` is a read-only
cockpit tool plus HTTP route that returns the one-shot working set: mode/source, refs, active
assets, prompt payload summaries, saved video slots, storyboard/video eligibility, and suggested
next actions. It intentionally omits full prompt bodies; use `describe_prompt` for exact text.

**Done when:** a new director session can open S3.1 and know: HF is applied, this storyboard
prompt predates HF, Beat is excluded by shot default, Cut Plan is included by default, the last
video used these refs, and the next correct action is to rewrite the storyboard prompt under HF.

### P3b — Upload Storyboard As-Is `[landed locally]`

**Goal:** a human or agent can bypass generation and attach an exact storyboard image without
fighting the UI.

Existing backend shape already exists through upload + `import_storyboard_image`; the missing
product work is a clean Studio button:

- upload/select image
- assign to the current shot
- optional lock immediately
- preserve provenance: uploaded-as-is, source asset id, uploader, timestamp
- no hidden prompt rewrite, no provider call, no style reinterpretation

**Done when:** in Studio, a user can click "Upload storyboard as-is", choose/drop an image, and
see it become the active board for that shot with the same downstream eligibility as generated
boards.

**Implementation note:** landed as a Studio storyboard-tab upload button plus a scoped web route
that stores a `shot_storyboard` asset, creates a `storyboard_versions` row with upload
provenance, makes it the active unlocked board, and marks video stale. The existing Lock button
remains the explicit approval step.

**Follow-up slice landed locally:** keyframe-mode shots can now upload a start frame as-is from
Studio. The route stores a normal `shot_image` asset, sets `image_status=success`, marks video
stale, and records uploaded-keyframe provenance; no provider call or prompt rewrite is involved.

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

`mirage/projects/<projectId>/state/payloads/{video,storyboard}/<shot>.json`

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

**2026-06-20 slice:** full notebook sync now writes latest per-shot `state/payloads/video/*.json`
and `state/payloads/storyboard/*.json` artifacts from `generation_attempts.request_summary` and
`storyboard_versions.metadata`. These are local/debug copies only; live Studio/MCP remains the
authoring truth.

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
- Agent/MCP-triggered generations must live-refresh Studio without a browser refresh: pending
  job state, completed storyboard/video assets, shot status, active board/video pointer, and
  render timeline eligibility should update from realtime or a targeted invalidation.
- If watching is useful, make it an explicit lightweight mode: "watch this job and notify me" or
  "poll every N seconds while I do X".
- Long-running jobs should preserve late outputs even after the user starts an alternate attempt.

**Done when:** director sessions can launch a job, continue editing another shot, and later inspect
the completed output/history in Studio without spending chat turns on serial polling or manually
refreshing the browser.

### P5c — Isolated Image Fix Workers `[ready soon]`

**Goal:** precise board/image repairs should not bloat the main director context.

Use Codex imagegen or a native Codex/Claude subagent/background worker for small visual fixes,
visual triage, continuity checks, prompt-payload audits, or export packaging. Mirage does not
coordinate the worker; the harness does. Mirage only provides clean state packets and receives
final approved uploads/imports/actions from the main director.

**Worker packet:** target project/shot/asset, exact issue, preserve constraints, allowed tools,
forbidden writes/spend, and expected receipt.

**Worker receipt:** final output path/asset id, prompt or checks run, changes made, confidence,
caveats, and suggested next Mirage action.

The main director thread carries the intent, approval, selected result, and final typed Mirage
action. It should not carry the full visual iteration transcript.

### P5d — Agent Learning Loop `[ready soon]`

**Goal:** each production run makes the next run faster and more tasteful.

Inputs worth capturing:

- prompt-composition wins and failures
- model/provider choices that worked for a workflow
- ref-bundle tricks, e.g. "include start env + destination env"
- storyboard repair notes and imagegen/import outcomes
- render/timeline adjustments
- artist final selections versus rejected candidates

Reuse paths:

- promote repeated full wrappers to workflow recipes
- promote reusable phrasing to style notes
- save reusable identities as personas
- expose prior project taste through `query_artist_memory`
- write compact per-shot final-payload artifacts for local/debug recall

**Done when:** before a paid generation, the agent can see relevant prior wins for this artist,
workflow, model, and shot type without loading whole old projects or chat history.

### P6 — Render Timeline UX `[after P1/P2 shape is clear]`

**Goal:** Make Render feel like a real production timeline, not a basic append-only preview.

Focus areas:

- clearer local draft vs canonical saved timeline state
- clip library/media drawer as a first-class source
- toggleable Studio/Render sidebars with smooth, non-janky animation and no layout jumps
- original vs generated vs voice-changed clip/audio toggles
- trim, mute, replace, align, and recover controls
- keyboard playback ergonomics: Space toggles play/pause in Render and, where safe, Studio shot
  preview; never steal Space while focus is inside prompt editors, textareas, inputs, selects,
  or contenteditable fields
- render eligibility indicator (`FFmpeg` vs `Remotion`, with reason)
- direct access to render history and salvaged late outputs

**First render slice landed locally:** Render now shows a pre-render eligibility pill before
spend/time: `FFmpeg fast path likely` for simple timelines, or `Remotion fallback likely` with
the first reason such as transitions, visual effects, playback-rate changes, missing media
source, or overlapping visual clips. This is UI preflight only; the renderer remains
authoritative after staging.

**Timeline editor upgrade landed locally:** frame-accurate transport, audio waveforms, video
thumbnails/posters, markers, shortcut cheat sheet, duplicate, Escape-to-close drawer, docked
right-side media library, and playhead hit-target polish are implemented. Follow-up review fixed
storyboard-mode poster fallbacks, old timeline poster backfill, drawer-added poster metadata,
metadata-only video preload, and poster refresh when a board/keyframe changes without a new video
URL. This makes the timeline materially more usable for the pre-Lahari smoke; remaining P6 work
is richer editing power rather than baseline legibility.

Agent actions should follow these UI/data primitives, not precede them.

### P6b — Premiere Pro Bridge `[future, but important]`

**Goal:** Mirage can hand work into professional finishing without flattening the production graph.

Possible shapes:

- export an organized Premiere-ready package: clips, audio, captions, cut metadata, thumbnails,
  shot ids, scene ids, model/provider notes
- generate EDL/XML/FCPXML where practical, with Mirage shot ids preserved as clip names/markers
- later, a Premiere Pro extension panel that can browse Mirage project shots, pull latest clips,
  replace clips, and push selected finals back to Mirage

**Done when:** an editor can move from Mirage Studio to Premiere with all approved clips, timing,
audio, and shot identity intact, then return final/select media without manual file archaeology.

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
2. P1b Studio interaction polish for prompt panels and core action buttons.
3. P2 durable override parity for the same surface.
4. P2b per-shot workflow mode overrides.
5. P3 storyboard composer audit.
6. P3c self-explaining shot working set.
7. P4 shot-scoped agent reads and summary-first dry-run mode.
8. P5b async job watch discipline.
9. P3b upload storyboard as-is.
10. P5 local audit artifacts, P5c isolated image fix workers, and P5d agent learning loop.
11. P7 storage/render ops fix.
12. P6 timeline/sidebar/playback overhaul and then timeline agent actions.
13. P6b Premiere Pro bridge after timeline/export semantics are stable.

P1/P2 are the most valuable first slice because they turn the successful smoke maneuver into a
repeatable human/agent product surface.

## Checkpoints

- 2026-06-16 · smoke complete · — · Lingashtakam/Suprabhatam music-video smoke worked fairly
  well. Prompt/payload audit directly improved creative quality. Director feedback: live MCP
  state and decomposed prompt payloads were more useful than local workbench editing; biggest
  friction was broad `open_project` payloads and verbose dry-run prompt bodies. Render surfaced
  a storage object-size cap; local recovery produced a valid MP4.
- 2026-06-18 · P3b landed locally · — · Studio can upload a native storyboard image as-is for a
  shot. The upload becomes the active storyboard version without a provider call and stays
  unlocked until the artist explicitly locks it.
- 2026-06-20 · start-keyframe upload landed locally · — · Keyframe-mode shots can upload or
  replace the start frame as-is in Studio. The upload becomes the active `shot_image`, preserves
  provenance, and marks the shot video stale for review/regeneration.
- 2026-06-18 · P3 backend composer landed locally · — · Storyboard image render prompts now
  persist a provenance-annotated composition object on storyboard version metadata and expose it
  through storyboard history.
- 2026-06-18 · new UX/control backlog captured · — · Added per-shot workflow mode overrides,
  smooth toggleable sidebars, and guarded Space play/pause controls to the post-smoke roadmap.
- 2026-06-18 · Studio polish backlog captured · — · Added the expanded-prompt blank-scroll bug
  and delayed/janky Lock/Generate button feedback as first-class Studio interaction work.
- 2026-06-18 · Studio live-refresh backlog captured · — · Added automatic realtime refresh for
  agent/MCP-triggered generations so Studio reflects completed boards/videos without browser
  refresh or agent polling loops.
- 2026-06-20 · P5b async watch discipline landed locally · — · `start_job` / `get_job`
  descriptions, AGENTS/CLAUDE templates, and paid-generation skills now tell agents to return
  the job id and continue useful work unless the artist explicitly asks to watch/poll.
- 2026-06-18 · top-bar activity polish captured · — · Added refined agent/action indicators to
  Studio polish: calm spinners/progress pills, soft transitions, and no flashing debug colors.
- 2026-06-18 · P1b first UI polish landed locally · — · Autosizing prompt textareas now refit on
  external writes/layout changes, top-bar activity uses a refined status pill, and Studio shot
  header / storyboard panel actions get immediate spinner feedback with steadier button widths.
- 2026-06-18 · self-explaining shot state captured · — · Added P3c: one shot-level working set
  should reveal workflow recipe, storyboard prompt provenance, storyboard/video payload summaries,
  saved slot defaults, generation eligibility, and exact edit actions so fresh agents can operate
  without chat archaeology.
- 2026-06-18 · P3c backend/MCP slice landed locally · — · Added `get_shot_context` as the
  summary-first shot working set for agents and HTTP callers. Studio's visible "Shot state /
  Recipe & payload" panel remains the next P3c product slice.
- 2026-06-20 · first four post-smoke control slices landed locally · 2e4ee6b, f942ac1,
  8de2dc1, 4323d3f · Studio now has per-shot workflow mode controls, shot-row realtime refresh
  for agent/MCP generations, summary-first video dry-runs, and guarded Space play/pause plus
  clearer render readiness/status in the render timeline.
- 2026-06-20 · render preflight eligibility landed locally · — · Render now previews likely
  FFmpeg fast path versus Remotion fallback with the first visible reason before the artist
  starts a render. The renderer remains authoritative once the job stages assets.
- 2026-06-20 · media library drawer motion landed locally · — · Render's media drawer now
  opens/closes with a short eased transition instead of snapping between the handle and full
  panel, preserving the same library data/loading behavior.
- 2026-06-20 · render playhead polish landed locally · — · The timeline playhead is now a
  larger draggable target with a visible head/stem and drag-time readout, replacing the old
  bare 2px line while preserving the existing seek behavior.
- 2026-06-20 · legibility lane scoped down after grounding · — · Audited current state before
  starting buckets 2 (storyboard composer maturity) + 3 (self-explaining shot state). Finding:
  the BACKENDS for both largely already exist from the landed slices, so neither is a build from
  scratch. (a) Storyboard render composition is already provenance-annotated
  (`storyboardPromptComposition.ts`: segments with source/editPath/included, images with
  assetId/excludableKey) and readable via `describe_prompt({kind:'storyboard_render'})`. (b)
  `get_shot_context` already returns per-slot `videoPromptSlots.{value,source,editPath}`,
  storyboard ref-exclusion state (`excludedRefs.storyboard` + `shotRefKeyExcluded`), storyboard
  provenance (`hasComposition`, version, locked), blockers/prerequisites, and a storyboard-aware
  next-action ladder. The remaining work is therefore mostly FRONTEND legibility plus one real
  manipulability gap, NOT a composer rewrite. Slice ladder:
  - L1 (frontend) Self-explaining panel completion: surface the slot `source`/`editPath` the
    panel currently drops (saved-override vs inherited-default chips), show storyboard ref bind/
    exclude state, and a storyboard provenance line (version/locked/hasComposition). Already-
    returned data; no backend.
  - L2 (frontend+reuse) Storyboard manipulability parity: storyboard inspector ref-toggle chips
    that write the existing `excludedRefs.storyboard` mechanism, mirroring video slot controls.
    Reuses existing persistence; no new column.
  - L3 (frontend) First-class payload chip vocabulary (#1): one shared origin tag —
    default / saved override / one-off (dry-run only) / excluded — used in both the panel chips
    and the inspector segments, reading existing `source`/`included`.
  - L4 (backend, optional refinement) Slot source precedence detail: distinguish recipe-default
    vs engine-default in the slot `source` (today it is binary saved-override vs composer default).
    Only if L1-L3 surface a real ambiguity.
- 2026-06-20 · storyboard payload preview/control slice landed locally · — ·
  `generate_storyboard` dry-run now returns the exact storyboard render prompt composition,
  refs, provider params, and prompt text before spend, using the same composer as paid render.
  Studio's shared payload inspector can now toggle excludable storyboard refs from the Images
  chips, writing the existing `excludedRefs.storyboard` shot field through the normal owned shot
  update path.
- 2026-06-20 · payload origin vocabulary landed locally · — · The shared prompt payload inspector
  now labels slots and images with the same first-class vocabulary: `default`, `saved override`,
  `one-off`, or `excluded`. The raw source/edit path remains available, but humans no longer have
  to infer the meaning of a payload chip from internal source strings.
- 2026-06-21 · render timeline editor lane landed locally · `464ef25`, `e84988c`, `100dbed`,
  `9e4b6fc`, `18b561b`, `50f110c`, `9b2698c`, `d0d3a9f`, `1b2a0b9`, `15022a0`, `7e7fad7`,
  `7f4467c` · Timeline now has frame-accurate keyboard transport, audio waveforms, video
  thumbnails/posters, markers, shortcut help, duplicate, Escape-to-close drawer, docked media
  library, safer playhead hit targets, and completed thumbnail behavior for storyboard-mode,
  drawer-added, old saved, and poster-refreshed clips. Cross-review passed; build + tsc green.

## Render Timeline — Editor Capability Audit (2026-06-20)

Artists spend real time in the render timeline; it should be decent-to-world-class. Audit of the
current `components/timeline-editor/*` toolkit (built on `@designcombo` timeline/state/player)
against what a competent NLE provides. **Scoping note:** several gaps below may be partially
supported by `@designcombo` already and just unwired — check the SDK before building each item,
do not rebuild what the library gives us.

**What we have today:** video/image/audio tracks; split-at-playhead (`S`); delete + ripple-delete
(`Del`/`Backspace`); clip drag + trim; session undo/redo (`Cmd+Z` / `Cmd+Shift+Z`); play/pause
(`Space`); draggable playhead with timecode chip; multi-step zoom slider + Fit; per-clip volume +
muted flag; a `fade` transition; per-clip filter effects (brightness/blur/opacity/contrast/
saturate/grayscale/sepia/hueRotate/invert); media library + upload; server-backed
save/restore/reset with version history.

### Tier 1 — music-video table stakes (felt daily, highest leverage)
- **Audio waveforms** on audio + unmuted video clips. None exist today. You cannot cut to the beat
  without seeing the waveform — this is the core motion of a music-video edit. Single highest-value item.
- **Snapping / magnetic edges.** No snap logic exists. Snap clips and the playhead to clip edges,
  the playhead, and markers, with a toggle and a momentary-disable modifier (hold to bypass).
- **Markers.** None exist. Drop (`M`), navigate prev/next, and ideally auto beat-markers derived
  from the song so artists can plan cuts to musical structure.
- **Clip thumbnails / filmstrip.** Clips render as plain colored blocks. Show poster/filmstrip
  frames so artists can see a clip's content at a glance.
- **Frame-accurate navigation.** Left/Right step one frame, Shift+arrow jumps, Home/End to ends,
  and jump-between-cut-points (`[` / `]` or Up/Down). Today only Space and playhead drag exist.

### Tier 2 — standard NLE editing operations
- **Copy / Cut / Paste / Duplicate** clips (`Cmd+C/X/V/D`). None exist.
- **Marquee/box select + Shift-click range + Select-all (`Cmd+A`).** `activeIds` is already an
  array (multi-select is supported in data); the selection affordances are missing.
- **Right-click context menu** on clips (split / delete / duplicate / speed / properties). No
  `onContextMenu` handlers exist anywhere in the editor.
- **Arrow-key nudge** of the selected clip (1 frame; Shift = larger step).
- **Ripple / roll / slip / slide trim** and an explicit close-gap. Only basic trim + ripple-delete exist.
- **Audio fade handles** (drag in/out clip corners), volume rubber-band/keyframes, and audio
  scrubbing while dragging the playhead. Only a static per-clip volume exists.

### Tier 3 — track management + creative surface
- **Track headers** with mute/solo/lock, add/remove/reorder tracks, adjustable track height.
  Today muted is per-clip; there is no per-track solo/lock or track management.
- **Clip speed / time-remap UI.** `playbackRate` is plumbed through items and render eligibility
  but is hardcoded to 1 and never exposed to the artist.
- **Clip transform** (position/scale/rotate/crop) for PiP/reframe. NOTE: this also needs renderer
  work — `hasNonDefaultLayout` is currently a stub returning false and `Composition.tsx` renders
  every clip as `AbsoluteFill`/`objectFit:contain`, ignoring layout. This is a render-pipeline
  change, not just a timeline UI add.
- **Text / title overlays** (no text track today).
- **In/out range + loop playback** for reviewing a section.
- **Keyboard-shortcut cheat sheet** for discoverability (the shortcuts that exist are invisible).

### Upstream-port strategy (2026-06-20, supersedes "build from scratch")

The timeline editor was lifted from the open-source **designcombo/react-video-editor**
(github.com/designcombo/react-video-editor) — same `@designcombo/*` engine packages, a CapCut/
Canva-style editor on Remotion. We ported the engine + a deliberately **stripped** set of item
classes: our `components/timeline-editor/items.ts` registers `{ Text, Image, Audio, Video }`, each
`extends Trimmable` with a `_render` that draws only a label on a colored block. Upstream ships the
rich versions of these same classes plus more. So most of the Tier-1/2/3 gaps are a **port +
adapt**, not a greenfield build.

What upstream has under `src/features/editor/` that we did not take:
- **Audio waveforms** — `timeline/items/{wave,lineal,radial,hill}-audio-bars.ts` + `player/items/
  audio-bars/`. Four waveform styles as item renderers. (Our `Audio` item draws a bare label.)
- **Thumbnails / richer clips** — full `timeline/items/{video,image}.ts` (vs our label-only).
- **More item types** — `timeline/items/{caption,text,shape}.ts`.
- **Properties / controls panel** — `control-item/`, `control-list.tsx`, `menu-list*.tsx` (likely
  clip speed, transform, volume, fades — i.e., our Tier-3 speed/transform UI).
- **Scene interactions** — `scene/interactions.tsx`, `scene/droppable.tsx`, `hooks/
  use-pointer-drag.tsx`, `hooks/use-timeline-offset.ts`.

Caveats for the port:
- Version drift: our `@designcombo/timeline` is 5.5.8 and our `Trimmable` base is finicky (we
  already patch it via `assignTrimmableProps` because the base does not assign props). Upstream
  item classes need adapting to our version + our data shape (`metadata.displayName`, our store),
  not copy-paste.
- Waveforms/thumbnails still need a **data source**: peak extraction for audio and poster/sprite
  frames for video. Confirm whether upstream precomputes these or derives them client-side, and
  whether Mirage should precompute peaks server-side at upload (cheaper, cacheable) when we port.
- **Snapping is likely already on.** The compiled SDK contains `Snap`/`Snapping`/`magnetic`/
  `snapThreshold`/`guideLine`; our integration does not disable it. Confirm in the running app —
  if it snaps, that backlog item is a visible toggle + momentary-disable key, not a build.

Recommended next step: clone the upstream repo to a scratch dir, do a file-by-file port audit, and
port the high-value items (waveforms, then thumbnails) adapted to our 5.5.8 item classes — rather
than re-implement canvas rendering we can lift.
