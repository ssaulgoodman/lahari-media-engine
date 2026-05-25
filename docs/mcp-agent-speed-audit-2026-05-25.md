# MCP Agent Speed Audit — 2026-05-25

Why this exists: Visual Studio feels usable, but Codex-over-MCP feels slower and more hesitant than the old Lahari path. The goal is to make tomorrow's work measurement-led, not vibes-led.

## Current Read

Mirage core is probably not globally slow. The slow-feeling path is the remote agent operating surface:

- Hosted MCP request wrapper: bearer auth, rate limits, audit, ownership, operation row writes.
- Large packet/notebook payloads: useful for truth, bad if pulled repeatedly.
- Synchronous paid media tools: character looks, storyboards, videos can run longer than the client/tool timeout.
- Recovery after timeouts: agent has to re-read packet, list candidates, inspect events, or ask the studio.
- Tool names/instructions are still too engine-shaped in places, so the agent spends reasoning budget deciding what to do.

The Lahari path felt crisper because it had a narrower ritual: one workflow, fewer aliases, fewer fallback surfaces, and fewer missing receipts after generation.

## External Best-Practice Notes

Primary docs line up with our diagnosis:

- MCP clients should avoid pushing every intermediate result through the model; programmatic/tool-brokered composition is faster because only final summaries need to hit context.
- Tool/resource surfaces should support different detail levels and avoid large repeated schema/context payloads.
- MCP resources are the right shape for large project/notebook artifacts: list/read by URI instead of dumping the full world into every tool result.
- Long-running operations should expose progress or job state. MCP has progress notifications, but a durable `jobId` plus polling/list-results is more reliable for hosted media generation and timeout recovery.
- Large lists should paginate, especially over networked integrations.
- Codex plugins are packaging/distribution. They help install skills/MCP/instructions cleanly, but they do not by themselves make remote generation faster.

Sources:
- https://modelcontextprotocol.io/docs/develop/clients/client-best-practices
- https://modelcontextprotocol.io/specification/2024-11-05/server/resources
- https://modelcontextprotocol.info/specification/2024-11-05/server/utilities/pagination/
- https://modelcontextprotocol.info/specification/draft/basic/utilities/progress/
- https://openai.com/academy/codex-plugins-and-skills/

## What To Measure First

We already have a useful spine:

- `server/routes/mcp.ts` records per-tool `durationMs`, result size, and success/error through `recordMcpAudit`.
- `server/routes/director.ts` does the same for the director API.
- `server/services/agentOperations.ts` records mutating tool operations in Supabase.
- `server/services/mirageAudit.ts` writes local JSONL audit rows under `.mirage/audit/` and shadows the same rows into `*_mcp_audit_events` for hosted durability.

Add a read-only timing surface:

```ts
get_mcp_timing_summary({
  projectId?: string,
  sinceHours?: number,
  source?: 'mcp-remote' | 'director-api',
})
```

Return:

- per tool: count, success count, error count
- p50 / p90 / max duration
- p50 / p90 result size
- timeout/error message counts
- top 10 slow calls with startedAt/tool/projectId/duration/resultSize

This will tell us whether the pain is packet reads, notebook sync, paid generation, or generic MCP overhead.

## Design Fixes

### 1. Async jobs for paid generation

Do this for character looks, environment looks, storyboards, videos, dialogue audio, and render if needed.

Preferred shape:

```ts
start_generate_character_looks({ projectId, castMemberId, promptOverride?, modelOverride? })
// -> { kind, jobId, status: 'queued' | 'running', estimatedCostUsd?, effectiveModel }

get_generation_job({ projectId, jobId })
// -> { status, progress?, message?, results?, error? }

list_character_look_candidates({ projectId, castMemberId })
// durable recovery surface
```

Why: the agent gets a receipt immediately, avoids tool timeout ambiguity, and can recover results forever.

### 2. Packet slimming

Do not make `get_project_packet` carry the whole world by default.

Add detail modes:

```ts
get_project_packet({ projectId, detail: 'summary' | 'production' | 'full' })
```

Default to `summary` for agent opening moves. Use `production` for studio work. Use `full` only when auditing or debugging.

Move large blobs to resource/read tools:

- script draft
- storyboard scene drafts
- prompt overrides
- candidate lists
- event history
- full prompt traces

### 3. Candidate/result receipts

Every paid generation result should create a durable, listable receipt:

- `jobId`
- entity id
- asset ids + URLs
- effective model/provider
- prompt hash or prompt preview
- started/finished timestamps
- error if any

Events can summarize; candidate-list/job tools must expose the actual IDs/URLs.

### 4. Tool naming pass

Make tools boring and imperative. Avoid `apply_generate_*` where possible.

Target vocabulary:

- `generate_character_candidates`
- `generate_environment_candidates`
- `generate_storyboard`
- `generate_video`
- `list_character_candidates`
- `lock_cast_reference`
- `upload_cast_reference`
- `set_project_preferences`
- `set_prompt_override`

Keep legacy aliases during transition, but agent instructions should teach only the clean names.

### 5. Instructions pass

Create a short "happy path" skill section for the remote artist agent:

1. Open packet summary.
2. Use packet data unless local file edits are needed.
3. Use notebook sync only for script/storyboard/config file edits.
4. For paid generation, start job, poll/list candidates, then lock.
5. Never re-run paid generation just because a previous call timed out; recover candidates first.

This should live in the bundled `mirage-director` skill and in AGENTS/CLAUDE only as a pointer, not a huge duplicate.

### 6. Plugin packaging

A Codex plugin is worth doing after the tool surface is clean.

Plugin should bundle:

- the Mirage director skill
- MCP install metadata
- maybe a one-command project-open flow
- possibly browser/deep-link helpers later

Plugin will improve setup, discovery, and instruction loading. It will not solve slow generation without async jobs and slim packets.

## Tomorrow Slice

Recommended order:

1. Add `get_mcp_timing_summary` and run it against today's slow sessions.
2. Slim `get_project_packet` with `detail` modes if packet reads are heavy.
3. Add async job shape for one paid path only: character looks.
4. Rename/add clean aliases for the character-look path.
5. Update `mirage-director` skill happy path.
6. Re-test the exact Codex flow: generate candidates, recover after timeout, lock reference.

Definition of done for the first pass:

- We can say which tools are actually slow with numbers.
- A timed-out character generation is recoverable in one tool call.
- Agent does not sync notebook unless it is editing local draft/config files.
- Tool names and skill instructions make the happy path obvious.
