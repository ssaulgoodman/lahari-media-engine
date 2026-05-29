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
GET  /api/projects
POST /api/projects
GET  /api/projects/:projectId/state

GET  /api/projects/:projectId/actions
POST /api/projects/:projectId/actions/run

POST /api/projects/:projectId/jobs/start
GET  /api/projects/:projectId/jobs/:jobId
GET  /api/projects/:projectId/jobs

POST /api/projects/:projectId/assets/upload
GET  /api/projects/:projectId/assets
GET  /api/projects/:projectId/results

POST /api/projects/:projectId/renders/start
GET  /api/projects/:projectId/renders/:renderId

POST /api/projects/:projectId/notebook/sync-token
GET  /api/projects/:projectId/notebook/manifest
GET  /api/projects/:projectId/notebook/files/*
```

The existing services already contain much of this logic. The work is to formalize the API boundary and route every surface through it.

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

## Migration Plan

### Phase 0: Finish Current Audit

Do not start the API migration until the action and prompt audit lands.

Completion criteria:

- every action has a clear contract
- worker invariants are separated from project style notes
- prompt catalog reflects real runtime behavior
- legacy prompt/template language is scrubbed or clearly marked

### Phase 1: Name the Core API

Add HTTP endpoints that wrap the existing action/job dispatcher:

- `GET /api/projects/:id/actions`
- `POST /api/projects/:id/actions/run`
- `POST /api/projects/:id/jobs/start`
- `GET /api/projects/:id/jobs/:jobId`
- `POST /api/projects/:id/assets/upload`

Keep MCP behavior unchanged externally, but internally have MCP call the same dispatcher used by these endpoints.

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
- idempotency keys
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

1. Should `run_action` and `start_job` be one endpoint with `mode: "sync" | "async"`, or separate endpoints?
2. Should action schemas remain JSON files generated from `actionRegistry.ts`, or should OpenAPI become the source and generate action files?
3. What auth scopes do enterprise clients need: project read, project write, media generate, render, admin?
4. What is the minimum webhook contract for jobs and renders?
5. Should notebook sync remain CLI-token based, or become a first-class API endpoint with signed artifact manifests?
6. When do we collapse editable mirrors/drafts into single artifacts?

## Near-Term Next Step

After the action/prompt audit:

1. Pick Looks or Storyboard as the first surface.
2. Add canonical HTTP endpoints for action discovery, action run, job start, job status, and upload.
3. Generate OpenAPI for that subset.
4. Make MCP call the same handlers.
5. Confirm Web Studio and Codex produce identical graph mutations through the same path.

That is the proof slice for the enterprise platform shape.
