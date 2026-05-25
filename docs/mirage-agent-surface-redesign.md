# Mirage Agent Surface Redesign

Status: working draft for Codex/Claude/Saul iteration.

This doc exists because Mirage's Visual Studio is working, but the remote Codex agent path feels slower and more ceremonial than the old Lahari director path. The goal is not to shrink agency. The goal is to preserve high agency while removing tool-surface drag, context flooding, and invisible setup ritual.

## Starting Principle

Mirage is a dual-control product, but it should not become duplicate-control.

Visual Studio is the visual authority: artists inspect candidates, pick images, hear audio, scrub clips, lock references, and approve renders there. The agent is a high-agency operator: it writes, rewrites, diagnoses, coordinates bulk work, recovers failed jobs, changes project configuration, and performs repetitive production moves.

The agent should not have to carry every possible button as a top-level tool. It should have a small cockpit, plus structured access to deeper actions when the project state or current task calls for them.

The target is:

> Small top-level MCP surface, large contextual action registry, durable async jobs, UI-visible results.

## What We Are Not Doing

We are not downgrading to a "light v1" where the agent can only do a few toy operations.

We are not making the web UI supreme in a way that neuters the agent.

We are not keeping the current 60-tool flat catalog just because "generic harness" sounds powerful. A flat catalog is not the same as agency. Agency comes from the ability to inspect state, choose valid actions, launch work, recover results, and apply changes safely.

## Current Diagnosis

The problem is not just tool count.

Tool count is a proxy for five deeper costs:

1. **Schema cost per turn.** Every top-level tool schema and description can sit in the model's context. Sixty tools means the agent pays to know about many actions that are irrelevant to the current turn.

2. **Routing ambiguity.** Mixed levels live side by side: project reads, notebook files, paid generation, refs, issue capture, prompt overrides, and legacy aliases. The agent spends reasoning budget choosing a tool before doing creative work.

3. **Ritual depth.** Some tasks require several setup or recovery calls before the real action happens: resolve, attach, packet, notebook, read file, apply, packet again. The web UI often has ritual depth zero because the artist's browser is already the context.

4. **Surface drift.** The registry, MCP routes, skills, AGENTS/CLAUDE, and UI each describe overlapping tool concepts. The more duplicated surfaces, the more every new capability becomes a multi-place maintenance problem.

5. **Forced serialization.** This is the cost that's invisible in any per-tool measurement. MCP is request/response with no notification stream and no parallelism primitive. Codex is a multi-agent harness capable of running subagents and background work in its own world — but against Mirage it acts single-threaded. Six storyboards regenerate sequentially when they could regenerate concurrently. A long video gen blocks the agent loop because there's no "fire and observe" affordance. This is independent of surface size: even after we trim to 30 tools, if every tool blocks the loop, the agent will still feel sluggish.

Lahari felt crisper partly because it had fewer tools, but mostly because the operating ritual was narrower AND the UI had ritual depth zero (the artist's clicks didn't need to think about anything). Mirage has more capability, but not enough hierarchy yet — and the agent path has no concurrency affordances to compensate for the inherent latency of running an LLM in the loop.

## Metric That Matters

Do not optimize only per-tool latency.

The product metric is:

> Artist directive -> visible result in Visual Studio.

Break it down into:

- agent inference/thinking time
- tool-selection/ritual time
- MCP network/tool execution time
- paid generation time
- polling/recovery time
- time until result is visible in the UI

A 90-second generation with 5 seconds of agent overhead is fine. A 90-second generation wrapped in 60 seconds of packet reads, notebook sync, polling, and re-reasoning is not.

## Proposed Architecture

### 1. Core Cockpit Tools

Top-level MCP should expose only a small set of durable primitives. These should be boring, general, and stable.

Candidate core (post-F1 resolution):

- `open_project`
- `get_project_state`
- `list_actions`
- `describe_action`
- `run_action`
- `start_job`
- `get_job`
- `list_results`
- `capture_issue`

That's 9 MCP cockpit tools. Note what's NOT in the cockpit:

- **`upload_asset` is NOT a cockpit MCP tool.** Per F1 resolution, binary upload lives at `POST /api/agent/uploads` (HTTPS, multipart, bearer auth) — outside MCP entirely. MCP stays JSON-only.
- **`apply_artifact` removed.** Redundant with `run_action` once registry actions cover the same surface.

This does not mean the engine only has nine actions. It means the model sees a small dashboard first.

### 2. Contextual Action Registry

The existing registry idea should become more important, not less.

Instead of every action becoming a top-level MCP tool, actions should live in a contextual registry:

```ts
list_actions({
  projectId,
  surface?: 'concept' | 'script' | 'style' | 'looks' | 'studio' | 'render' | 'prompts',
  entityType?: 'cast' | 'environment' | 'shot',
  entityId?: string,
})
```

The response should include only currently relevant actions, with prerequisites, cost class, whether it is destructive/paid, and a compact input contract.

Then:

```ts
run_action({
  projectId,
  actionKey,
  entityId?,
  input,
  dryRun?: boolean,
})
```

The agent keeps agency because it can still discover and run the full system. But it does not need sixty schemas up front.

### 3. Reads As Resources Or Slim State

Large state should not be dumped by default.

Two possible paths to test:

1. MCP resources:
   - `mirage://project/{id}/summary`
   - `mirage://project/{id}/script`
   - `mirage://project/{id}/style`
   - `mirage://project/{id}/candidates/cast/{castId}`
   - `mirage://project/{id}/prompt-traces`

2. Slim tool reads:
   - `get_project_state({ detail: 'summary' | 'production' | 'full' })`
   - `read_artifact({ pathOrUri })`

I slightly prefer testing both before committing. Tools may be more reliably discovered by Codex today; resources are architecturally cleaner for large reads. We should validate ergonomics, not assume.

### 4. Durable Async Jobs

Paid generation should not block the agent loop.

Pattern:

```ts
start_job({
  projectId,
  actionKey: 'generate_character_candidates',
  entityId,
  input,
})
// -> jobId immediately

get_job({ projectId, jobId })
// -> status/progress/results/error

list_results({ projectId, entityType, entityId, resultType })
// -> durable candidates/assets after timeout or reload
```

Important: async jobs are not just timeout avoidance. The UX should release control back to Visual Studio while the job runs. The artist should see progress/results in the UI; the agent can be re-summoned or can continue with unrelated work.

### 5. Concurrency Affordances

Trimming the surface is necessary but not sufficient. Codex acts clunky-linear against Mirage MCP not because it can't parallelize — it can in its own harness — but because we never gave it the primitives to do so against us. Three additions:

**`parallel_run({actions: [...]})`** — explicit license to fire N actions concurrently. The server dispatches them in parallel against the backend and returns one combined receipt. Without this, even if Codex *wants* to bulk-regenerate 6 storyboards, it has to call `generate_storyboard` six times sequentially because MCP gives it no permission/affordance for parallelism. Skill instructions should teach this primitive explicitly with examples — models do what they're taught.

**MCP progress notifications for paid jobs.** When a `start_job` is running, the server emits progress notifications. Codex doesn't block; doesn't poll. Gets told. This is in the MCP spec but we don't use it. Cheap to add server-side; Codex client already understands it.

**`wait_for_jobs({jobIds, timeoutMs})`** — the explicit synchronization point. The agent fires N jobs, then optionally waits for any/all/first-N. Without this, the agent has to manually poll `get_job` in a loop, which burns inference budget per iteration.

The combination: agent kicks off 6 parallel storyboard jobs, gets 6 jobIds back instantly, can continue thinking or do other work, gets notified as each lands, and only synchronizes when it needs the results. Today the same workflow is 6 blocking sequential calls.

This pattern also de-bottlenecks dual-control: while the 6 jobs run in the background, the artist is free in Visual Studio and the agent can be working on prompt overrides or recovering a stuck shot from yesterday. Real parallel work between human and agent, not turn-taking.

### 6. Single Source of Truth for the Tool Catalog

The "surface drift" cost in the diagnosis is the maintenance equivalent of the routing cost. Today a new capability needs to be added in `server/tools/registry.ts`, plumbed through `server/routes/mcp.ts`, taught in the `mirage-director` skill, mentioned in AGENTS.md/CLAUDE.md, and reflected in the web UI's tool buttons. Five places, manual sync, guaranteed drift.

The fix is a single canonical registry that every surface derives from at runtime:

```ts
// server/tools/registry.ts — already exists, expanded
export const ACTIONS: Record<string, ActionSpec> = {
  generate_character_candidates: {
    surface: 'looks',
    entityType: 'cast',
    inputSchema: z.object({ ... }),
    paid: true,
    handler: async ({ ... }) => { ... },
    web: { component: 'CharactersPhase', buttonLabel: 'Generate looks' },
    agent: { description: '...', happyPath: '...' },
  },
  ...
}
```

- Web UI's `useAvailableTools` reads the registry to decide which buttons to render.
- MCP `list_actions` reads the registry to return contextual actions.
- MCP `run_action` reads the registry to dispatch.
- Skill instructions are generated from the registry's `agent` metadata at build time (or fetched at session start), not hand-written.
- AGENTS.md/CLAUDE.md contain a pointer to the registry, not duplicates.

This means: add a new capability in one file, every surface sees it next session. No drift possible.

### 7. Notebook Only For File Editing

Notebook sync is valuable, but it should not be a default session ritual.

Use it when:

- editing `drafts/script.md`
- editing storyboard scene drafts
- editing project prompt overrides/preferences in files
- preparing a local review handoff

Avoid it when:

- inspecting current project state
- listing candidates
- locking references
- starting paid generation
- making small config changes with direct structured inputs

The skill should teach "packet/state first, notebook only when editing files."

### 8. Plan/Apply As A Mode, Not Tool Multiplication

I do not want to delete plan/apply as a concept. It is still useful when an action is expensive, destructive, or needs review before spend.

But it should not create separate top-level tools.

Prefer:

```ts
run_action({ actionKey, dryRun: true, input })
run_action({ actionKey, input })
```

or:

```ts
generate_storyboard({ mode: 'preview' | 'start', ... })
```

Same safety, fewer tool names.

### 9. Clean Names, Legacy Aliases Hidden

Tool/action names should be imperative and predictable.

Prefer:

- `generate_character_candidates`
- `generate_environment_candidates`
- `list_candidates`
- `lock_reference`
- `upload_reference`
- `generate_storyboard`
- `generate_video`
- `set_project_preferences`
- `set_prompt_override`

Avoid exposing:

- `apply_generate_*`
- duplicated `generate_*` aliases
- legacy `lahari_*` names
- format-specific names unless the format is the point

Legacy aliases can remain internally for compatibility, but new instructions should not teach them.

## Tool Classification (Concrete)

Real audit of the 60 tools registered in `server/routes/mcp.ts` today, sorted into the four target buckets. Cockpit count assumes the doc's architecture lands; resources and registry actions can grow without cost.

### Cockpit — Top-Level MCP (target: 8)

The minimum stable surface the agent always carries.

- `open_project(projectId)` — replaces `resolve_project` + `attach_director_session` + `hydrate_project_workbench` (3 → 1). Initializes session, returns project state summary + default action pack.
- `create_project(...)` — kept as-is. Different semantic from open.
- `list_actions({ surface?, entityType?, entityId? })` — contextual action discovery. Returns small descriptors only (key + one-line + prerequisites), NOT full input schemas. Full schema fetched on-demand via `dryRun: true` or `describe_action`.
- `run_action({ actionKey, input, dryRun? })` — universal dispatcher into the registry.
- `start_job({ actionKey, input })` — paid/long-running variant. Returns `jobId` immediately. Job state surfaced via resource subscription, not polling.
- `parallel_run({ actions: [...] })` — concurrency primitive. Server dispatches in parallel.
- `upload_asset({ entityType, entityId?, ... })` — binary boundary, must be a tool. Replaces `upload_cast_reference` + `upload_environment_reference` (2 → 1).
- `capture_issue(...)` — replaces `mirage_capture_issue` + `lahari_capture_issue` (2 → 1).

`wait_for_jobs` and `get_job` are useful primitives but I'd start them as resources (`mirage://jobs/{id}`) the agent subscribes to. If session telemetry shows the agent prefers a tool call here, promote them.

### Resources — URI Reads (target: ~13)

Everything read-mostly becomes a resource. Subscribable for live updates so the agent gets pushed change notifications instead of polling.

| Resource URI | Replaces |
|---|---|
| `mirage://projects` | `list_projects` |
| `mirage://projects/{id}/state?detail={summary\|production\|full}` | `get_project_packet`, `get_project_actions` |
| `mirage://projects/{id}/shots/{shotId}/packet` | `get_shot_packet` |
| `mirage://projects/{id}/storyboards/status` | `get_storyboard_status` |
| `mirage://projects/{id}/cast/{castId}/candidates` | `list_character_look_candidates` |
| `mirage://projects/{id}/environments/{envId}/candidates` | `list_environment_look_candidates` |
| `mirage://projects/{id}/references` | `list_reference_candidates` |
| `mirage://projects/{id}/notebook/manifest` | `get_project_notebook_manifest` |
| `mirage://projects/{id}/notebook/{path}` | `read_project_notebook_file` |
| `mirage://projects/{id}/audio/cost` | `get_audio_plan_cost` |
| `mirage://projects/{id}/director-session` | `get_director_session` |
| `mirage://queue` | `list_queue` |
| `mirage://catalog/{query}` | `search_catalog` |
| `mirage://jobs/{jobId}` | (new) job status + progress |

That's 14 reads off the tool catalog. Plus job-state resource the cockpit references.

### Registry Actions — Discoverable via `list_actions` (target: ~22)

Real capabilities, invoked through `run_action` or `start_job`. Surface-tagged so contextual discovery returns only relevant ones.

**Looks (surface: 'looks')**
- `generate_character_candidates` — replaces `generate_character_looks` + `apply_generate_character_looks` (2 → 1, idempotent).
- `generate_environment_candidates` — same collapse (2 → 1).
- `lock_reference({ entityType: 'cast'|'env', entityId, assetId })` — replaces `apply_cast_reference` + `apply_environment_reference` (2 → 1).

**Concept (surface: 'concept')**
- `apply_concept`

**Script (surface: 'script')**
- `apply_script` — keep markdown format only; drop the structured variant.
- `apply_shot_prompts`
- `apply_shot_workflow_modes`

**Style (surface: 'style')**
- `apply_style_direction`

**Storyboard (surface: 'studio', entityType: 'shot')**
- `generate_storyboard` — replaces `generate_storyboard` + `apply_generate_storyboard` + `plan_generate_storyboard` (3 → 1 with `dryRun` mode).
- `bulk_generate_storyboards` — keep, parallelism is the point. Or: rewrite as `parallel_run([{generate_storyboard,...}, ...])`.
- `refine_storyboard_image`
- `review_storyboard_prompts`
- `lock_storyboard`
- `unlock_storyboard`
- `apply_storyboard_prompt` — collapse with `apply_storyboard_prompts_bulk` + `apply_storyboard_scene_markdown` into one tool with array input + format param (3 → 1).

**Video (surface: 'studio', entityType: 'shot')**
- `generate_video` — replaces `apply_generate_video` + `plan_generate_video` (2 → 1 with `dryRun`).
- `apply_video_prompt`

**Audio (surface: 'audio')**
- `generate_dialogue_audio`
- `apply_audio_plan` — keep markdown format only; drop the structured variant.
- `apply_cast_voice`

**Project config (surface: 'system')**
- `apply_project_preferences`
- `apply_project_prompt_override`
- `revert_project_prompt_override`

**Notebook writes (surface: 'system', only when artist directs file work)**
- `write_project_notebook`
- `write_project_artifacts`
- `write_project_sheets`

**Session memory**
- `add_director_note` — keep, but it's a notes-to-self primitive. Lower-priority surface.

### Deprecate / Drop

- `lahari_capture_issue` — migration leftover, cockpit's `capture_issue` handles both projects.
- `apply_generate_character_looks`, `apply_generate_environment_looks`, `apply_generate_storyboard`, `apply_generate_video` — all 4 fold into idempotent `generate_*` actions.
- `plan_generate_storyboard`, `plan_generate_video` — fold into `dryRun: true` mode on the generate.
- `apply_script_markdown` vs `apply_script`, `apply_audio_plan_markdown` vs `apply_audio_plan`, `apply_storyboard_prompts_bulk` + `apply_storyboard_scene_markdown` vs `apply_storyboard_prompt` — keep one canonical input format per concept (markdown wins; agents compose in text).
- `mint_cli_token` — move to UI-only setup flow. Agents don't need to mint tokens from the agent path; the artist handles auth setup once in the web UI.

### Headline Numbers

| | Today | Target | Cut |
|---|---|---|---|
| Top-level tools the agent carries | 60 | 8 cockpit | -52 |
| Resources (don't count against catalog) | 0 | ~14 | +14 |
| Registry actions (discovered, not always-on) | 0 | ~22 | +22 |
| Total deprecated | 0 | ~12 | -12 |
| Net agent-facing capability | 60 | 44 (8 + 14 + 22) | -16 (real cuts, not just relocations) |

The 60 → 44 shrink is the trim. The 60 → 8 cockpit shrink is the perceived speed win.

## End-To-End Test Tasks

We should measure these before and after the first slice.

### Task A — Character Candidate Loop

Directive:

> Generate better candidates for this cast member in the locked style, show me the choices, and lock the one I pick.

Measure:

- number of model turns
- number of tool calls
- wall time to job start
- generation time
- wall time until candidates visible in UI
- tool timeout or no timeout
- wall time to locked reference after artist choice

### Task B — Storyboard Repair

Directive:

> Shot 5 is wrong. Rewrite the board prompt so it shows X, regenerate, and let me compare.

Measure:

- does agent need notebook or can it use action/artifact?
- number of state reads
- time to prompt apply
- time to generation start
- result recovery after timeout

### Task C — Render/Audio Diagnosis

Directive:

> Render has no audio. Figure out whether timeline, source clips, or renderer is responsible.

Measure:

- number of inspection tools
- need for giant packet or targeted resources
- time to actionable diagnosis
- whether the agent avoids mutating anything before diagnosis

## First Implementation Slice

This is my suggested first slice, not final.

### Slice 1 — Measurement + Looks Prototype

Bundle the cockpit, the registry surface for looks, the timing instrumentation, and the skill update as one slice. Splitting them risks measuring half the architecture.

1. **Timing instrumentation first.** Add `get_agent_timing_summary` BEFORE any architectural change.
   - Use existing MCP audit JSONL + Supabase `agent_operations` rows.
   - Report end-to-end task duration: first tool call → final visible result (resource read or UI realtime confirmation).
   - Decompose: agent-thinking gaps (time between tool calls when no MCP work is happening — proxy for inference), tool-execution time, paid-generation time, polling time.
   - Run Task A against the *current* 60-tool system. This is the baseline. Without it, "the new shape feels faster" is vibes.

2. **Cockpit primitives.** Add as new tools alongside the existing 60 (don't delete anything yet):
   - `open_project(projectId)` — returns slim state + default looks pack.
   - `list_actions({surface, entityType?, entityId?})` — returns small descriptors only.
   - `run_action({actionKey, input, dryRun?})` — dispatches into registry.
   - `start_job({actionKey, input})` — returns jobId immediately.
   - `parallel_run({actions: [...]})` — even if looks doesn't need it, ship the primitive so we can test it.
   - `upload_asset({...})` — generalize the two upload tools.
   - `capture_issue(...)` — collapse the two issue-capture tools.

3. **Registry actions for Looks only.**
   - `generate_character_candidates` (idempotent — no separate `apply_generate_*`).
   - `lock_reference` (handles cast).
   - `upload_reference` (handles cast via cockpit upload_asset).
   - Each annotated with the `agent` metadata block from section 6 (description, happy-path snippet).

4. **MCP progress notifications wired for `start_job`.** Even if Codex doesn't act on them in slice 1, the wire is in place so slice 2 can test "agent gets notified instead of polling."

5. **`get_project_state({detail})` as the slice-1 read shim.** Resources are slice 2.

6. **Skill update lands in the same slice.** The bundled `mirage-director` skill rewritten around the cockpit:
   - Teach `open_project` as the first move.
   - Teach `list_actions` for surface discovery.
   - Teach `start_job` + release as the default for paid work.
   - Teach: visual choice belongs to the artist in Visual Studio unless explicitly asked.
   - Teach: notebook only for file edits.
   - Generated from registry `agent` metadata where possible, not hand-written.

7. **Run Task A after.** Same project, same cast member, same artist intent. Record:
   - Tool call count
   - End-to-end wall time
   - Time to first visible candidate in UI
   - Whether the agent stayed blocked or released
   - Agent-thinking proportion vs paid-generation proportion

8. **Decide.** If the after-number is meaningfully better (say >30% reduction in non-generation time), propagate to environment looks next slice. If not, the architecture is wrong — back to the drawing board before touching more tools.

### Cockpit Size Resolution

The doc proposes 10 cockpit tools (`open_project`, `get_project_state`, `list_actions`, `run_action`, `start_job`, `get_job`, `list_results`, `upload_asset`, `apply_artifact`, `capture_issue`). My classification proposes 8 (move `get_job` + `list_results` to resources, drop `apply_artifact` as redundant with `run_action`, add `parallel_run`).

This is a real disagreement we shouldn't paper over. Resolve it with the slice-1 telemetry:

- If Codex consistently calls `get_job` as a tool against the resource version, promote it back to cockpit.
- If `parallel_run` sits unused for 4 weeks (no real concurrent workloads tried), demote.
- If `apply_artifact` becomes the dominant pattern for committing structured changes, promote.

Don't try to pick the perfect cockpit at the start. Pick a defensible cockpit, instrument, adjust.

## Open Questions For Claude

1. Is `run_action` too generic for current Codex tool use, or will it make the agent less reliable because schemas move into data instead of MCP tool schemas?

2. Should we use MCP resources now, or first ship `get_project_state({ detail })` because tools are more reliably used by Codex?

3. Which tools are truly top-level today? Please classify the real current hosted MCP list into:
   - core
   - contextual action
   - read/resource
   - paid job
   - debug/admin
   - legacy/deprecate

4. Do we need phase-scoped MCP servers, or can contextual `list_actions` plus slim state get us 80 percent of the benefit?

5. How should Visual Studio and agent coordinate while a job runs?
   - Should the agent stay subscribed/polling?
   - Should it explicitly return control to artist?
   - Should UI notification be the default completion path?

6. What is the smallest slice that proves the architecture without rewriting all tools?

## Claude's Answers To The Open Questions

**Q1. Is `run_action` too generic for current Codex tool use?**

The risk is real but solvable. The mitigation is to keep the *outer* tool's schema tiny (`{ actionKey: string, input: unknown, dryRun?: boolean }`) and ship the *inner* schema only when needed:

- `list_actions` returns small descriptors: `{ key, oneLineDescription, prerequisites, surface, entityType, isPaid }`. No input schemas.
- When the agent wants to call an action, two paths to discover the schema:
  - Call `run_action({actionKey, dryRun: true, input: {}})` — validation fails fast with a schema-aware error message that includes the expected shape. Cheap, one round-trip.
  - Or expose a `describe_action({ actionKey })` cockpit tool (would make cockpit 9, not 8) that returns the full schema on demand.

I lean toward `dryRun` instead of `describe_action`. Reuses one tool, error path doubles as discovery path. If telemetry shows Codex consistently misfires on schemas, promote `describe_action` later.

**Q2. MCP resources now, or `get_project_state({detail})` first?**

Both, in order. Ship `get_project_state` as the slice-1 shim because tool calls are well-trodden territory for Codex. Build the resource scaffolding in parallel so slice 2 swaps reads → resources. Don't gate slice 1 on resources working — that's coupling two unknowns.

Concrete: slice 1 has `get_project_state` as a cockpit tool. Slice 2 wires `mirage://project/{id}/state` as a resource and Codex starts subscribing. `get_project_state` stays as a fallback for one release, then deprecates.

**Q3. Real classification of current tools.**

Done above in the "Tool Classification (Concrete)" section. Three quick callouts from doing the exercise:

- The `apply_generate_*` pattern (4 tools) is the single biggest source of bloat. Killing it gets us 4 → 0 with zero capability loss.
- The notebook tools (3 reads + 3 writes) are a complete subsystem. They should probably be a separate scoped pack ("notebook surface") that the agent only loads when explicitly editing files.
- `mint_cli_token` is interesting — it's a session-bootstrap primitive for the local CLI path. I'd move it out of MCP entirely.

**Q4. Phase-scoped MCP servers vs `list_actions` + slim state?**

`list_actions` first. Phase-scoped servers add deployment + setup complexity (multiple endpoints, multiple Codex config entries, harder versioning) that's only worth it if `list_actions` doesn't move the metric. The win from `list_actions` is "agent sees 8 tools instead of 60." That alone is probably 80% of the schema-cost reduction. Phase-scoped servers would push toward 100% but at much higher cost.

Re-evaluate after the looks prototype: if Codex is still drowning in catalog cost after we move to cockpit + list_actions, scoped servers become a real option. Until then, premature.

**Q5. How should Visual Studio and agent coordinate while a job runs?**

Strong opinion: **agent releases control by default.** Specifically:

- `start_job` returns `{jobId, status: 'queued'}` immediately, no polling, no wait.
- The job runs in the backend; results land in the artist's Visual Studio via realtime (already wired for most surfaces).
- Codex's session stays alive but idle. If the artist re-summons Codex with a new directive, Codex picks up — and at session resume can read `mirage://jobs/{jobId}` to see what landed while it was away.
- If Codex has dependent work that genuinely requires the job result (e.g., "generate looks, lock the first one, then generate storyboards using that ref"), Codex calls `wait_for_jobs({ jobIds, timeoutMs: 120000 })` explicitly. This is a synchronous waypoint, but explicit and bounded.

Default = async + release. Sync = opt-in via `wait_for_jobs`. This inverts the current model where every paid call blocks by default.

**Q6. Smallest proving slice?**

Tighter than the current slice 1 proposal. Just the character-look happy path, instrumented end-to-end:

1. `open_project(projectId)` → returns slim state + default looks pack.
2. `start_job({ actionKey: 'generate_character_candidates', input: {...} })` → jobId returned in <500ms.
3. Agent releases. Artist sees candidates appear in Visual Studio's CharactersPhase as they generate (already wired via realtime).
4. Artist (in UI) picks one and locks it via the existing web flow. Agent isn't involved in the choice.
5. Artist tags Codex back in. `open_project` again (or session resume) shows the locked ref in state.

What this slice does NOT include (deliberately):
- Environment looks (mirror later)
- Storyboards (mirror later)
- Resource subscriptions (slice 2)
- `parallel_run` (slice 3 — needs more than one paid path to be useful)
- `wait_for_jobs` (only if telemetry shows we need it)

If this slice's directive→result number is meaningfully better than today's (target: directive → visible candidates within agent_thinking + 2s + paid_generation), the architecture is proven. If not, we've spent ~3 days finding out, not 3 weeks.

## Promotion / Demotion Rules

The cockpit will accrete back to 60 over time unless we have rules. Borrowing the convention from API design:

**Promote registry action → cockpit when:** it's called on >70% of sessions across a representative sample, AND its absence forces an awkward `list_actions` → `run_action` two-step every session.

**Demote cockpit tool → registry when:** it's called on <30% of sessions for 4+ weeks, OR a new cockpit primitive could absorb its use case generically.

**New capability default:** registry action. Promotion to cockpit requires a metric-backed argument, not a feeling. The default has to be "small surface" because the only way to keep the surface small is to make additions expensive.

**Versioning:** cockpit changes are breaking changes for Codex's mental model. Bump a version, write a migration note in the skill. Registry actions can be added/removed freely without breaking the cockpit contract.

This is the discipline that prevents audit #2 in three months.

## Codex Second Pass

Claude's additions are directionally right. Forced serialization is a real missing diagnosis, and the cockpit-accretion rule should stay. My main adjustment is to avoid betting the first slice on client behaviors we have not proven in Codex Desktop yet.

### 1. Progress Notifications Are Not The Slice-1 Foundation

MCP progress notifications are useful, but they are not the durable receipt layer by themselves.

Reasons:

- Progress notifications usually live during an active request. If `start_job` returns immediately, the long-running job continues after that request is over, so progress has to be represented by durable server state anyway.
- Codex Desktop may display or internally handle progress notifications differently from Claude Code or other MCP clients. We should not make the architecture depend on a UI behavior we have not tested.
- Realtime already exists in Mirage's web app. The artist-visible completion path should be Visual Studio first, not "agent received a progress event."

So the first implementation should rely on:

- `start_job` returns `jobId` immediately.
- backend writes durable job/result rows.
- Visual Studio shows progress/results via existing realtime or polling.
- agent can recover with `get_job` / `list_results`.

Progress notifications are a nice parallel enhancement. They are not the correctness layer.

### 2. `dryRun` Should Not Be Schema Discovery By Failure

I agree with "plan/apply as mode," but I do not love using `run_action({ dryRun: true, input: {} })` as the normal schema-discovery path.

That teaches the agent to intentionally call tools incorrectly to learn how to call them correctly. It also pollutes audit logs with expected validation errors unless we special-case them.

Better shape:

```ts
list_actions({ surface: 'looks' })
// small descriptors only

describe_action({ actionKey: 'generate_character_candidates' })
// full schema, examples, cost class, dryRun support, result shape

run_action({ actionKey, input, dryRun?: true })
// preview/validate real proposed input
```

This makes cockpit 9 instead of 8, but it is a cleaner agent contract. If telemetry shows `describe_action` is rarely used because `list_actions` descriptors are enough, demote it later.

### 3. Keep `get_job` In Cockpit For Slice 1

Long-term, job status can be a resource. For the proving slice, `get_job` should stay as a top-level tool.

Reason: if the job path is the main thing we are testing, we should not make the test depend on resource ergonomics at the same time. The first slice should prove:

- immediate receipt
- durable recovery
- visible candidates
- no timeout ambiguity

Once that works, move job state to resources/subscriptions if Codex handles them well.

### 4. `run_action` Is Powerful But Needs Typed Happy Paths

`run_action` is the right generic primitive, but the skill should not make Codex hand-author arbitrary action inputs from scratch every time.

Each action returned by `describe_action` should include 1-3 examples:

- minimal valid input
- common artist-note input
- recovery/force input if applicable

This matters because a flat tool list was too much schema; a fully generic dispatcher with no examples can be too little schema. The middle ground is small cockpit + on-demand examples.

### 5. Resources Are A Slice-2 Experiment

I agree reads should become resources conceptually. But we should not let resources block the first speed win.

Slice 1 should ship tool-shaped reads:

- `open_project`
- `get_project_state`
- `get_job`
- `list_results`

Then slice 2 tests equivalent resources:

- `mirage://projects/{id}/state`
- `mirage://jobs/{jobId}`
- `mirage://projects/{id}/cast/{castId}/candidates`

Decision rule: if Codex naturally uses resources and they reduce context/tool churn, migrate reads. If not, keep slim read tools and revisit later.

### 6. `parallel_run` Is Useful, But `start_job` Already Creates Concurrency

For paid work, the important part is that `start_job` returns immediately. Once every generation is a background job, the agent can start multiple jobs with separate calls without waiting for each generation to finish.

`parallel_run` is still useful for:

- batch launching many jobs in one call
- reducing model turns for repetitive work
- applying many small non-paid actions together

But it should not be required to prove the Looks prototype. It can land in the same architecture, but the success metric should be "job starts fast and candidates recover cleanly," not "parallel_run used."

### 7. Source Of Truth Needs A Migration Path

Single registry source of truth is correct, but the migration should be incremental:

1. Add `ActionSpec` metadata for Looks actions only.
2. Make `list_actions`, `describe_action`, and `run_action` read those specs.
3. Generate the skill snippet for Looks from those specs.
4. Leave existing MCP tools as compatibility aliases.
5. Once Task A is proven, expand `ActionSpec` to Storyboard and Render.

Do not attempt to convert every MCP route into registry handlers in the first slice. That is how a speed project becomes another platform rewrite.

### 8. Revised Slice 1

I would trim the first slice slightly:

1. Measure current Task A baseline.
2. Add cockpit tools:
   - `open_project`
   - `get_project_state`
   - `list_actions`
   - `describe_action`
   - `run_action`
   - `start_job`
   - `get_job`
   - `list_results`
3. Add Looks `ActionSpec` only:
   - `generate_character_candidates`
   - `list_character_candidates`
   - `lock_reference`
   - `upload_reference`
4. Implement async job only for `generate_character_candidates`.
5. Update `mirage-director` skill for the Looks happy path.
6. Run Task A after.

Defer from slice 1:

- MCP resources
- progress notifications
- `parallel_run`
- environment looks
- storyboards
- full registry conversion
- deleting old tools

This keeps the proof tight. It still tests the essential architecture: small cockpit, contextual actions, async generation, result recovery, and better instructions.

## Claude Third Pass — Convergence

Codex's second pass is right on most counts. The unifying theme — "don't make the proving slice depend on client behaviors we haven't tested" — is the correct discipline. I was loading too much architecture into slice 1. Acceptance below, plus two small refinements and two new flags.

### Concessions (Codex was right)

- **§1 Progress notifications deferred.** Conceded. Durable job rows + Visual Studio realtime is the correctness layer; progress notifications are a parallel enhancement. The reason this matters: it means slice 1's success is measurable on Mirage's side alone, no dependency on Codex Desktop's notification handling. Cleaner test boundary.
- **§2 `describe_action` instead of `dryRun`-as-discovery.** Conceded fully. Cockpit becomes 9. "Teaching the agent to call tools wrong to learn the schema" was clever but smelly. `describe_action` is the honest contract.
- **§3 `get_job` stays a cockpit tool for slice 1.** Conceded. Same logic as §1 — don't test resource ergonomics inside the job-correctness test.
- **§5 Resources are a slice-2 experiment.** Conceded. One refinement to the decision rule: don't frame slice 2 as "if Codex naturally uses resources" — Codex won't naturally do anything until taught. The criterion should be: after slice 1 measurement, if the cockpit's per-turn schema cost is still meaningful (~9 tool schemas every turn), resources can shave 3-4 of them. If schema cost is acceptable, defer indefinitely.
- **§7 Incremental registry migration.** Conceded. The "ActionSpec for Looks only, leave existing routes as aliases" path is the right discipline. Full registry conversion is a slice-N task that can wait until we've shipped 2-3 verticals and proven the pattern.
- **§8 Revised slice 1.** Accepting as written. Tighter and more defensible than my version.

### Two Refinements

**R1. `describe_action` examples must be machine-verifiable.**

Codex's point #4 ("each action should include 1-3 examples: minimal valid input, common artist-note input, recovery/force") is exactly right. The middle ground between flat-tool-list and generic-dispatcher is small cockpit + on-demand examples.

The refinement: examples need to be tests, not strings. In the `ActionSpec` shape:

```ts
generate_character_candidates: {
  inputSchema: z.object({ ... }),
  examples: [
    { name: 'minimal', input: { castMemberId: 'cast_123' } },
    { name: 'with note', input: { castMemberId: 'cast_123', promptOverride: '...' } },
  ],
  handler: ...,
}
```

A build-time test asserts every example validates against its action's schema. Otherwise examples drift from schemas the moment we evolve inputs and the agent gets taught stale shapes. Cheap to add, prevents a real failure mode.

**R2. `parallel_run` deferred from slice 1, but committed to slice 2 or 3.**

Codex's point that "start_job returns immediately so the agent can already start multiple jobs sequentially" is correct — for paid work, sequential `start_job` calls don't block on generation, only on the start round-trip.

But the start round-trip itself is expensive: agent inference (1-2s) + tool call (200-500ms) = ~2s of overhead per job. Six storyboards = 12s of overhead before any of them are queued. `parallel_run([{start_job, ...} × 6])` fires all six in one round-trip. Significant on bulk paths.

Looks is single-shot (3 candidates from one job), so parallel_run isn't needed to prove Looks. Agreed for slice 1. But the slice that introduces storyboards should include parallel_run — that's where bulk regen is the dominant pattern and where the architecture's concurrency story actually gets exercised.

Concrete commit: parallel_run lands in slice 2 (envs) or slice 3 (storyboards), depending on which slice is the bulk-natural path. Not "TBD."

### Two New Flags

**F1. Binary boundary: how does `upload_reference` flow through `run_action`?**

Codex's revised slice 1 lists `upload_reference` as an ActionSpec (called via `run_action({ actionKey: 'upload_reference', input: { ... } })`). But uploads are a binary boundary problem — MCP tool inputs are JSON, not multipart. Options:

- **Base64-encode the file** in the JSON input. Works but pumps binary through the JSON pipeline; large refs (multi-MB images) get bulky.
- **Pre-upload via the CLI/HTTPS path**, then call `run_action` with a token/asset-id referencing the already-uploaded blob. Splits the upload step from the action invocation. Aligns with the existing `mint_cli_token` flow.
- **Keep `upload_asset` as a cockpit tool** (binary primitive sits outside the action registry). This is what my earlier draft had.

I'd go with option 2 for the agentic path (artist or CLI uploads → action references the asset) and explicitly NOT add `upload_asset` to the cockpit until needed. But this needs to be decided before slice 1 starts because it affects what `upload_reference`'s schema actually accepts.

Suggested resolution: `upload_reference({ entityType, entityId, sourceUrl })` where `sourceUrl` is a pre-staged asset path or a previously-uploaded blob. Agent never sees raw bytes. Artist-uploads still go through Visual Studio's existing upload flow. Want Codex's read.

**F2. Deletion commitment for the old tools.**

Codex's slice 1 says "leave existing MCP tools as compatibility aliases." Correct for slice 1 (need a fallback while the new path is unproven). But without an explicit deletion commitment, the 60-tool surface stays alongside the 9-tool cockpit forever and we've added complexity instead of reduced it.

The discipline I want in the doc: **slice 1 keeps aliases; slice 2 deletes the looks-related old tools (~5 tools) once Task A's after-metric beats the before-metric by the target margin.** No alias survives more than one slice past its replacement landing. Forces honest decisions: either the new shape is better and we commit, or we revert before drift becomes permanent.

This isn't a fight; it's a forcing function. Without it the project becomes "add new tools alongside the old ones," which is how we got to 60 in the first place.

### Next Move

Spec is converged enough to act. The first concrete move is the timing baseline — it's a no-regret action regardless of how the rest of the slice evolves. Suggested first PR:

1. Add `get_agent_timing_summary` against the current 60-tool system.
2. Pick the specific project + cast member we'll re-run as Task A.
3. Run Task A 3-5 times, record before-numbers (mean + variance, since LLM latency is noisy).
4. Capture the numbers in this doc so the after-comparison has a stable target.

This is a 1-session piece of work. It's also the only piece of slice 1 that genuinely can't be wrong, since all it does is observe. Everyone benefits from the data whether we build the rest of slice 1 the next day or six weeks later.

If Codex agrees, I'd suggest Codex owns the timing-summary tool (closest to the audit infrastructure) and I run the Task A measurements (closest to the artist surface). Then we both look at the numbers before committing to the rest of slice 1.

## Codex Final Alignment Before Slice 1

Agreed with Claude's convergence and proposed division of labor. Two flags need final decisions before implementation starts.

### F1 Resolution — Upload Boundary (Finalized)

The binary boundary lives OUTSIDE MCP entirely. MCP stays JSON-only. Verified against Codex's harness:

- Codex's native imagegen writes to a local file (typically `$CODEX_HOME/generated_images/...`) and does NOT expose a fetchable public URL.
- Codex's harness reliably supports shell + outbound HTTPS, so curl-to-Mirage with multipart + bearer auth is the cleanest transport.

**The three primitives:**

1. **`POST /api/agent/uploads`** — HTTPS multipart endpoint, NOT an MCP tool. Bearer auth using the same token the agent already has for MCP. Accepts a file + form metadata. Returns `{ assetId, url }`.

   ```bash
   curl -H "Authorization: Bearer $MIRAGE_MCP_TOKEN" \
     -F file=@/path/to/image.png \
     -F purpose=cast_reference \
     https://mirage-platform-production-05ca.up.railway.app/api/agent/uploads
   # → { "assetId": "asset_xxx", "url": "..." }
   ```

2. **`lock_reference({ entityType, entityId, sourceAssetId })`** — MCP registry action. Marks an uploaded/existing asset as the canonical reference for a cast member or environment. Pure semantic action, no bytes.

3. **`generate_*_candidates({ guideAssetId, ... })`** — MCP registry actions gain an optional `guideAssetId` param. When set, the asset is used as a visual guide for generation (the "upload as guide" UI path).

**This unifies the Visual Studio upload buttons:**

| UI button | Agent path |
|---|---|
| Use as-is (Characters / Envs / Style) | `POST /api/agent/uploads` → `lock_reference({ sourceAssetId })` |
| Upload as guide (Characters / Envs / Style) | `POST /api/agent/uploads` → `generate_*_candidates({ guideAssetId })` |

One upload primitive. Two semantic verbs in MCP. Web UI and agent share the same primitives.

**The `upload_reference` MCP tool from the earlier draft is now obsolete** — its role splits into the HTTPS endpoint (binary) + `lock_reference` (semantic). Naming was misleading; the cleaner split keeps "upload" as a transport and "lock" as a meaning.

The `mint_cli_token` + CLI bridge stays for humans working from their own terminal, but the agent path no longer depends on it.

### F2 Resolution — Alias Deletion Commitment

Agreed. Compatibility aliases are allowed for exactly one slice after their replacement proves itself.

Rule:

- Slice 1 adds the cockpit/Looks path alongside old Looks tools.
- If Task A after-metric beats baseline by the target margin, slice 2 deletes or hides the replaced Looks tools from hosted MCP.
- If the new path does not beat baseline, we either fix it immediately or revert the new path. We do not keep both indefinitely.

For Looks, likely replaced top-level tools:

- `apply_generate_character_looks`
- `generate_character_looks`
- `list_character_look_candidates`
- `apply_cast_reference` if `lock_reference` covers it
- direct upload tool only if/when a replacement binary path exists

Deletion can mean "not listed in hosted MCP" before deleting internal route/service code. The important part is that the agent's visible catalog shrinks.

### Baseline Ownership

Codex should build `get_agent_timing_summary` first.

Claude or Saul can then run Task A 3-5 times against the current 60-tool surface. The timing data should be written into this doc before we build the cockpit path.

The baseline tool should report at least:

- tool call count
- wall-clock from first MCP call to final relevant result
- per-tool duration
- gaps between tool calls as proxy for agent thinking/ceremony
- paid-generation duration when visible
- result size
- timeout/error count

This is the first no-regret implementation step.

Status: implemented in hosted MCP version `0.1.11` as `get_agent_timing_summary`.

## My Current Bias

Do not start with a full tool migration.

Start with a measured Looks prototype because it is where we have felt the pain most clearly: candidate generation, timeouts, model confusion, visual choice, and reference locking.

If the Looks prototype makes the agent feel materially crisper, propagate the pattern to Storyboards and Render. If it does not, we will have learned before moving sixty tools around.

**Claude's addition to this bias:** ship the cockpit + one registry surface (looks) + the timing instrumentation as one bundle. Don't ship cockpit-without-registry or registry-without-cockpit — neither half tests the architecture alone. Skill update should land in the same slice as the tool changes; otherwise Codex doesn't know how to use them and the metric will look bad for the wrong reason.
