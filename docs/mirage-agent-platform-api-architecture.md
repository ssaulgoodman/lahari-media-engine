# Mirage Agent Platform API Architecture

Date: 2026-05-28
Status: Post-audit target architecture

This document captures the enterprise/product shape we want after the prompt and action-contract audit is clean. It is not a replacement for the current slice. Finish the action/prompt audit first; then use this as the next architectural move.

## Thesis

Mirage should be a production-graph API first.

MCP should stay, but only as a small agent cockpit over that API. The web studio, Codex, Claude Code, OpenClaw, Hermes, CLI, and future enterprise integrations should all converge on the same HTTP action/job/asset contract.

The desired shape:

```txt
Mirage Core API + OpenAPI
        |
Project graph + jobs + assets + audit trail
        |
Web Studio        MCP cockpit        CLI / Codex plugin / external agents
```

## Why This Matters

This makes Mirage an enterprise-capable platform instead of a web app with a bespoke MCP surface.

The benefits are practical:

- One backend contract for web UI, agents, CLI, and integrations.
- Cleaner upload and asset handling through normal multipart HTTP instead of MCP/base64 payloads.
- Cleaner async generation: `start job -> jobId -> realtime/webhook/result`, instead of blocking agent calls.
- Easier support for Codex, Claude, OpenClaw, Hermes, and future agents through standard HTTP docs.
- Better debugging: one request ID/job ID/action key across web, MCP, logs, Supabase events, and UI.
- Better enterprise posture: auth scopes, rate limits, audit logs, idempotency, webhooks, OpenAPI, SDK generation.
- Less tool-list/context pressure inside Codex: MCP stays tiny; richer action schemas live in local files and OpenAPI.

This does not make image/video models themselves faster. It makes the orchestration around them much cleaner and often faster-feeling.

## Core Principle

The project graph is canonical.

Prompts are worker calls over selected graph state. Actions mutate or advance the graph. Jobs run slow/paid work. Assets move through HTTP upload/storage. MCP is an adapter, not the source of truth.

## Ideal Runtime Layers

### 1. Core HTTP API

Canonical endpoints:

```txt
GET  /api/v1/projects
POST /api/v1/projects
GET  /api/v1/projects/:projectId/state

GET  /api/v1/projects/:projectId/actions
POST /api/v1/projects/:projectId/actions/run

POST /api/v1/projects/:projectId/jobs/start
GET  /api/v1/projects/:projectId/jobs/:jobId
GET  /api/v1/projects/:projectId/jobs

POST /api/v1/projects/:projectId/assets/upload
GET  /api/v1/projects/:projectId/assets
GET  /api/v1/projects/:projectId/results

POST /api/v1/projects/:projectId/renders/start
GET  /api/v1/projects/:projectId/renders/:renderId

POST /api/v1/projects/:projectId/notebook/sync-token
GET  /api/v1/projects/:projectId/notebook/manifest
GET  /api/v1/projects/:projectId/notebook/files/*
```

The existing services already contain much of this logic. The work is to formalize the API boundary and route every surface through it.

Use `/api/v1` from the first externalized route. Breaking changes need a version story before enterprise clients or plugins depend on the contract.

Keep sync and async separate:

- `POST /api/v1/projects/:projectId/actions/run` is synchronous and returns the action result or a structured error.
- `POST /api/v1/projects/:projectId/jobs/start` is asynchronous and returns a job ID immediately.

Do not fold these into a `mode: "sync" | "async"` flag. They have different timeout semantics, retry behavior, response envelopes, and user expectations.

For mutating or paid endpoints, accept an `Idempotency-Key` header. Store keys for at least 24 hours per account/project/action. If the same key is replayed with the same request body, return the original response; if the body differs, return an idempotency conflict. This belongs in Phase 1 because it prevents duplicate paid generations from network retries.

### 2. OpenAPI Contract

OpenAPI is a machine-readable description of the HTTP API: paths, methods, auth, request schemas, response schemas, and errors.

For Mirage, OpenAPI should cover:

- project creation and state
- action discovery and action execution
- job lifecycle
- asset upload/list/retrieve
- candidates/results
- renders
- notebook sync
- error shapes

Why we want it:

- generated TypeScript client for the web app
- generated SDKs later
- better docs for enterprise integrators
- machine-readable context for agents
- contract tests against the implementation
- one place to explain auth, idempotency, rate limits, and job semantics

OpenAPI does not replace MCP. It describes the canonical HTTP API that MCP calls.

Source of truth:

- `server/services/actionRegistry.ts` remains the source for action schemas.
- OpenAPI is generated from the registry plus route metadata.
- Do not reverse-generate the registry from OpenAPI; that creates a second action contract to drift.

Canonical error envelope:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Human-readable summary.",
    "field": "optional.field",
    "details": {},
    "requestId": "req_..."
  }
}
```

Use the existing structured-error style as the implementation base. Every generated SDK, MCP adapter, and web client should see the same envelope.

Minimum auth scopes for Phase 1:

```txt
project:read
project:write
media:generate
render:run
admin
```

Endpoint design should encode these from the start. `project:write` is not enough for paid media generation, and render execution deserves its own boundary.

### 3. MCP Cockpit

MCP should expose only the small set of tools that make Codex/Claude ergonomic:

```txt
open_project
get_project_state
run_action
start_job
get_job
list_jobs
upload_asset or create_upload_url
sync_notebook / mint_cli_token
capture_issue
```

MCP should not grow back into a 60-tool platform surface. Rich action schemas live in:

- `config/actions/index.json`
- `config/actions/<surface>.json`
- OpenAPI
- optional `list_actions` fallback

### 4. Local Notebook / Workbench

The notebook is Codex's local working set.

It should contain dynamic project state and editable project artifacts:

```txt
AGENTS.md
project.json
config/actions/index.json
config/actions/<surface>.json
config/style-notes.json
config/prompts/*.md
script.md
audio-plan.md
storyboards/*.md
state/*.json or state/*.md
journal.md
```

Current cleanup landed: editable workbench surfaces are single root artifacts (`script.md`, `audio-plan.md`, `storyboards/*.md`), while read-only project projections live under `state/`.

Product law after the first smoke test:

- Supabase remains canonical truth.
- The local workbench remains the primary agent editing surface.
- MCP is the control plane: state summaries, action/job calls, issue capture, sync/upload instructions.
- HTTP is the data plane: file sync, asset upload, native image import, notebook materialization.
- Large file bodies should not move through MCP in the happy path. Manifest/file-read tools are fallback diagnostics, not the normal sync loop.

The current `mint_cli_token -> npx @ssaulgoodman420/mirage-cli sync` path is a temporary bridge, not the final product shape. The smoke-test failure mode was concrete: `npx` hit a root-owned global npm cache and the agent fell back to MCP file reads, which made the local workbench stale and context-heavy. That is a bridge reliability bug, not a reason to abandon the local workbench.

The near-term bridge must be:

- install-free during a session, or isolated from global npm state
- able to refresh only changed artifacts
- explicit about freshness: `fresh`, `stale`, or `unknown`
- able to upload local/native assets through HTTP and return asset IDs
- able to import a local/native storyboard image into a shot and optionally lock it
- receipt-driven: apply/job responses return changed paths + hashes, and the bridge pulls only those files
- lock-safe: sync locks carry owner metadata, created time, and TTL/expiry so stale lock files do not trap the agent
- skill-versioned: materialized skills are first-class files with versions/hashes because bad skill guidance directly affects production output

The long-term bridge is a Codex plugin/local helper that owns local file sync and upload. It can use the Core HTTP API and OpenAPI under the hood, but the agent should experience one confident workflow: edit local files, apply graph changes, sync changed artifacts, upload/import native files.

### 5. Web Studio

Web Studio is the visual operator surface.

It should show:

- current project graph
- action availability
- active jobs
- candidates/results
- locks and stale state
- render timeline
- agent activity/audit trail

It should not implement a separate production workflow. Web buttons and agent actions call the same Core API.

### 6. Codex Plugin

A Codex plugin is packaging, not the platform protocol.

It can ship:

- Mirage skills
- MCP config
- helper scripts for upload/sync
- stable agent doctrine
- marketplace metadata

Project-specific state still comes from the notebook. Live mutation still goes through Core API/MCP.

Notebook sync stays CLI-token based for v1 only as a compatibility bridge. First-class signed-manifest sync and a local plugin/helper are part of the product direction, because agent-native editing depends on reliable local files.

## Migration Plan

### Phase 0: Finish Current Audit

Do not start the API migration until the action and prompt audit lands.

Completion criteria:

- every action has a clear contract
- worker invariants are separated from project style notes
- prompt catalog reflects real runtime behavior
- legacy prompt/template language is scrubbed or clearly marked

### Phase 0.5: Stabilize Agent Smoke Path

Before the broader Core API migration, fix the product seams the first smoke test exposed. This phase proves the core agent loop before we invest in the full enterprise API shape — it is not a detour from it.

The seams cluster around the control-plane / data-plane split this doc defines: the smoke failure was a *data-plane* (local workbench sync) reliability bug, not a control-plane logic bug. The fixes preserve the local-workbench-first model rather than abandoning it.

**The ranked, actionable item list is the single source of truth in `docs/mirage-tool-and-prompt-audit.md` → backlog item 15 ("Smoke feedback queue").** Do not restate it here; it would drift. Architecture intent lives in this doc; the work queue lives there.

In brief, the phase covers: reliable workbench sync isolated from global npm state, receipt-driven changed-file refresh, lock TTL/owner metadata, an agent-sized state packet, local/native storyboard import, preserve-refs on script apply, versioned notebook skills, and lean batch receipts. The first guards (script-apply downstream protection, graph-name storyboard prompt craft, reference binding contract) have already landed.

### Phase 1: Name the Core API

Add HTTP endpoints that wrap the existing action/job dispatcher:

- `GET /api/v1/projects/:id/actions`
- `POST /api/v1/projects/:id/actions/run`
- `POST /api/v1/projects/:id/jobs/start`
- `GET /api/v1/projects/:id/jobs/:jobId`
- `POST /api/v1/projects/:id/assets/upload`

Keep MCP behavior unchanged externally, but internally have MCP call the same dispatcher used by these endpoints.

Phase 1 must also establish:

- `Idempotency-Key` on paid/mutating POSTs.
- the canonical structured error envelope.
- request IDs in responses/logs.
- the first auth-scope checks.

### Phase 2: Add OpenAPI

Create `openapi.json` for the core endpoints.

Minimum contract:

- bearer auth
- project scoping
- action run schema
- job start/status schema
- asset upload response
- standard error envelope

Add an `llms.txt` page that points agents to:

- OpenAPI
- action-schema files
- integration examples
- upload/job lifecycle docs

### Phase 3: Route Web UI Through the Core API

Gradually replace bespoke web routes with action/job endpoints where it makes sense.

Do this surface by surface:

1. Looks
2. Style
3. Storyboard
4. Video
5. Audio
6. Script/Concept
7. Render

Do not delete old routes until the new path is used by both web and MCP.

### Phase 4: Durable Jobs + Realtime

Strengthen job lifecycle:

- persistent job rows
- restart watchdog
- structured progress
- realtime updates to Visual Studio
- optional webhooks for enterprise/API clients

This is the Krea-style developer experience: submit, get job ID, watch completion.

### Phase 5: Plugin Packaging

Once the API/action contracts are stable:

- package Mirage as a Codex plugin
- ship stable skills and MCP config
- reduce notebook instruction payload
- keep project-specific action schemas in notebook files

## What We Would Not Do

- Do not delete MCP. Demote it to the agent cockpit.
- Do not make OpenAPI expose raw prompt templates as the product contract.
- Do not let web UI and MCP mutate graph state through different code paths.
- Do not push binary payloads through MCP when HTTP upload exists.
- Do not make the Codex plugin the source of runtime truth.
- Do not rebuild the old preset/workflow doctrine under a new API name.
- Do not expose prompt template internals, model-routing logic, or billing computation as stable API contracts. Those are implementation details behind actions/jobs.

Asset lifecycle rule for v1:

- uploaded assets persist while the project exists
- locked/reference assets are retained with the project
- orphaned uploads should be cleaned after a short window, default 7 days
- enterprise contracts can later add explicit retention/data-residency controls

## Relationship To Krea's API Move

Krea's API is a good external reference because it treats the model platform as a normal developer API:

- bearer auth
- OpenAPI
- async jobs
- webhooks
- asset upload/list/retrieve
- agent-readable docs
- shared app/API credits

Mirage is not the same product. Krea exposes model generation. Mirage exposes a production graph: concept, script, style, cast, environments, shots, storyboards, video, audio, renders.

But the developer-experience lesson applies: make the contract legible through HTTP and docs, then let agents consume it through their preferred harness.

## Open Questions

Resolved now:

1. `run_action` and `start_job` stay separate endpoints.
2. `actionRegistry.ts` stays the action-schema source of truth; OpenAPI is generated from it.
3. Phase 1 scopes are `project:read`, `project:write`, `media:generate`, `render:run`, and `admin`.
4. Notebook sync stays CLI-token based for v1; signed artifact manifests are Phase 5.
5. Editable mirrors/drafts are already collapsed into root artifacts plus `state/`.

Still open:

1. What is the minimum webhook contract for jobs and renders?
2. What asset-retention controls are required for the first enterprise deployment?

## Near-Term Next Step

After the action/prompt audit:

1. Pick Looks or Storyboard as the first surface.
2. Add canonical HTTP endpoints for action discovery, action run, job start, job status, and upload.
3. Generate OpenAPI for that subset.
4. Make MCP call the same handlers.
5. Confirm Web Studio and Codex produce identical graph mutations through the same path.

That is the proof slice for the enterprise platform shape.

Phase 3 risk: routing Web Studio through the Core API is the load-bearing migration. It touches many current bespoke `/api/projects/:id/...` routes. Treat it as its own sub-plan when the time comes: choose thin wrappers first, migrate one surface at a time, and delete old routes only after web + MCP are both using the shared action/job path.
