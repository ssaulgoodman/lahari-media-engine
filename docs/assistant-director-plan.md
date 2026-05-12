# Assistant Director Plan

## Goal

Add a persistent Assistant Director that watches the full Lahari pipeline, critiques each stage, proposes or triggers safe reruns, and leaves a visible comment trail for the artist.

This should feel less like "another chatbot" and more like a project-scoped creative operator:

- sees what was sent
- sees what came back
- judges quality against the current project context
- decides whether to greenlight, suggest changes, or rerun
- remembers what it already tried

The Assistant Director should be able to grow from:

1. critique only
2. critique + propose
3. critique + safe reruns
4. full assistant-director orchestration across the pipeline

## Recommendation

Use the **OpenAI Agents SDK (TypeScript)** as the runtime harness.

Do **not** replace Lahari's deterministic pipeline with an agent. Keep the existing Express routes, DB writes, scope checks, and stage semantics as the source of truth. The agent should sit **on top of** that system and operate through a small, typed tool layer.

That gives us:

- multi-step tool use
- handoffs/sub-agents later if needed
- guardrails
- built-in tracing
- rich run items for UI/audit
- streaming
- resumable conversation state

What the SDK does **not** replace:

- our durable project memory
- our event log
- our approval rules
- our business logic
- our project scoping and ownership checks

Those should stay in Lahari.

## Why the Agents SDK instead of raw Responses-only loops

Raw Responses API is enough for a basic agent loop, but the SDK is a better fit for this product because we want a long-lived orchestrator with tools, traces, and eventually specialists.

SDK features we actually want:

- **Agents**: one primary Assistant Director agent
- **Function tools**: typed wrappers around Lahari actions
- **Run context**: project/user/runtime dependencies available to tools and hooks
- **Results/history/newItems**: replayable run history plus detailed tool/audit items
- **Tracing**: inspect generations, tool calls, handoffs, guardrails
- **Guardrails**: approval and safety gates for paid/destructive actions
- **Handoffs or agents-as-tools**: later split into specialists if useful

This maps naturally to Lahari because the product already has:

- a structured pipeline
- typed stages
- durable DB state
- explicit prompts
- existing `ai_calls` xray logging
- project-scoped chat history

## Product shape

The Assistant Director should be a **project-scoped system** with three visible surfaces:

1. **Stage comments**
   - "Concepts are too plot-heavy for a meditative stotra."
   - "Shot 3 repeats the same slow push-in as shot 2."
   - "This environment look breaks continuity with the locked style."

2. **Action recommendations**
   - "Regenerate concepts with a note emphasizing contemplative devotional space."
   - "Rewrite shot prompts with a continuity note."
   - "Approve and continue to Style."

3. **Execution history**
   - what it saw
   - what it said
   - what it reran
   - whether the rerun improved things

## Core principle

**The agent should reason, judge, and orchestrate. The app should still execute the real work.**

That means:

- the agent does not write directly to arbitrary DB rows
- the agent does not invent pipeline semantics
- the agent uses the same approved route/service layer the artist uses
- all durable changes still flow through Lahari's business logic

## V1 architecture

### Main runtime

- **Runtime**: OpenAI Agents SDK (TypeScript)
- **Primary model**: start with a strong reasoning model for judgment and orchestration
- **Execution host**: Lahari backend process or a sibling service in the same private network
- **Conversation scope**: one thread/run lineage per project

### One agent first

Start with **one Assistant Director agent**, not a network of agents.

It should:

- read project state
- read stage input/output payloads
- critique the current stage
- decide whether to:
  - comment only
  - suggest a rerun
  - trigger a safe rerun
  - approve the next stage

### Later specialists

Do not build these first. Add only if the single agent becomes too broad.

Possible later specialists:

- `ConceptCritic`
- `ScriptCritic`
- `ShotPromptCritic`
- `ContinuityCritic`
- `ProductionCoordinator`

These can be:

- handoffs, if the specialist should temporarily take over
- agents-as-tools, if the main director stays in charge

## Event-driven integration

The agent should not poll the whole project blindly. It should react to **stage events**.

### Every important stage emits an event

Suggested stages:

- `audio_analysis`
- `concept_generation`
- `concept_refine`
- `script_generation`
- `script_refine`
- `style_brainstorm`
- `style_visualize`
- `style_lock`
- `character_generate`
- `character_lock`
- `environment_generate`
- `environment_lock`
- `write_shot_prompts`
- `refine_frame_prompt`
- `refine_motion_prompt`
- `generate_frame`
- `generate_video`
- `refresh_chained_shot_prompt`
- `render`
- `publish`

### Event payload shape

Each event should capture:

- `projectId`
- `stage`
- `entityType` (`project`, `scene`, `shot`, `cast_member`, `environment`)
- `entityId`
- `triggeredBy` (`user`, `agent`, `system`)
- `requestPayload`
- `responsePayload`
- `promptSnapshotId` or raw prompt text when useful
- `assetsProduced`
- `provider`
- `model`
- `status`
- `createdAt`

This should be durable in our DB, not only in SDK traces.

## Proposed data model additions

The current `lahari_ai_calls` table is useful, but not enough for a durable assistant-director workflow. We should add explicit critique/orchestration tables.

### 1. `lahari_stage_events`

Purpose: canonical log of what happened in the production pipeline.

Suggested columns:

- `id`
- `project_id`
- `stage`
- `entity_type`
- `entity_id`
- `triggered_by`
- `request_payload`
- `response_payload`
- `provider`
- `model`
- `status`
- `created_at`

### 2. `lahari_director_comments`

Purpose: visible critique trail for the artist.

Suggested columns:

- `id`
- `project_id`
- `stage`
- `entity_type`
- `entity_id`
- `comment_type` (`praise`, `warning`, `blocker`, `suggestion`, `approval`)
- `summary`
- `detail`
- `score` (optional)
- `created_by` (`assistant_director`)
- `created_at`

### 3. `lahari_director_actions`

Purpose: track what the agent proposed or executed.

Suggested columns:

- `id`
- `project_id`
- `stage`
- `entity_type`
- `entity_id`
- `action_type` (`rerun`, `refine`, `approve`, `block`, `suggest_note`)
- `input_note`
- `status` (`proposed`, `approved`, `executed`, `rejected`, `failed`)
- `result_summary`
- `created_at`
- `executed_at`

### 4. `lahari_director_memory`

Purpose: compact durable memory per project.

Suggested columns:

- `project_id`
- `summary`
- `taste_notes`
- `known_failures`
- `successful_rerun_patterns`
- `updated_at`

This is not chat history. It is a compact project summary the agent can reuse.

## What the agent should see

The Assistant Director needs a **clean context packet**, not the whole database.

For each run, provide:

### Project context

- title
- locked concept
- song meaning
- song type / `isNarrative` / `isMeditative`
- video mode
- selected image/video models
- current pipeline phase

### Stage context

- current stage name
- exact input that was sent
- exact output that came back
- current visible prompt(s)
- relevant upstream locked artifacts

### Quality context

- previous assistant comments on this entity
- whether prior reruns happened
- whether those reruns improved things
- any artist notes/preferences

### Entity context

Depending on stage:

- concept options
- scene + shot structure
- style image + style description
- character or environment candidates
- shot prompts + refs + critique + continuity info

## What the agent should not see by default

Keep the context packet lean.

Avoid automatically injecting:

- full project JSON when only one shot matters
- unrelated prior failures
- full chat history every time
- giant prompt catalog dumps

Use compact summaries and load deeper data through tools only when needed.

## Tool layer

The tool layer is the heart of the integration. Tools should be thin, typed wrappers around Lahari's existing app actions.

### Read tools

- `get_project_summary(projectId)`
- `get_stage_context(projectId, stage, entityType?, entityId?)`
- `get_stage_history(projectId, stage, entityType?, entityId?)`
- `get_shot_context(projectId, shotId)`
- `get_scene_context(projectId, sceneId)`
- `get_prompt_snapshot(projectId, kind, entityId?)`
- `list_recent_director_comments(projectId)`

### Critique tools

- `critique_concepts(projectId)`
- `critique_script(projectId)`
- `critique_style(projectId)`
- `critique_character_look(projectId, memberId)`
- `critique_environment_look(projectId, envId)`
- `critique_shot_prompts(projectId, shotId?)`
- `critique_generated_frame(projectId, shotId)`
- `critique_generated_video(projectId, shotId)`

These can be implemented as app-side wrappers that gather the right state and ask the model a bounded question, or as normal tool calls that let the main agent reason directly.

### Safe mutation tools

- `rerun_concepts(projectId, note)`
- `refine_script(projectId, note)`
- `rewrite_shot_prompts(projectId, note)`
- `refine_character_prompt(projectId, memberId, note, referenceAssetId?)`
- `refine_environment_prompt(projectId, envId, note, referenceAssetId?)`
- `refine_shot_frame_prompt(projectId, shotId, note, referenceAssetId?)`
- `refine_shot_motion_prompt(projectId, shotId, note, referenceAssetId?)`

### Approval / state tools

- `approve_stage(projectId, stage, entityType?, entityId?)`
- `block_stage(projectId, stage, reason)`
- `post_director_comment(projectId, ...)`
- `record_director_memory(projectId, summaryPatch)`

### High-risk tools later

Do not expose these in V1 without explicit approval gates:

- `fork_project`
- `lock_concept`
- `generate_script`
- paid image/video regeneration loops
- destructive overwrites

## Safe autonomy model

The Assistant Director should not start with full autonomy.

### V1: critique only

- observes stage events
- posts comments
- recommends next action
- no automatic reruns

### V2: auto-rerun safe text stages

Allowed without approval:

- concept regeneration
- script refine
- shot prompt rewrite
- prompt-only refines

Not allowed without approval:

- paid image/video generation
- destructive resets
- fork/overwrite decisions

### V3: approval-gated execution

The agent can propose:

- "Rewrite all shot prompts with this note"
- "Regenerate these two concept options"
- "Refine this environment prompt"

But execution requires either:

- explicit user approval
- or a project setting that allows safe auto-execution for certain actions

## UI surface

The Assistant Director should appear inside the existing project, not as a detached console.

### 1. Per-stage comment rail

For each stage, show:

- latest assistant verdict
- short summary
- optional score
- "why" expander
- "rerun with note" suggestion chip

Examples:

- **Concept**: "Too plot-heavy for a meditative stotra."
- **Script**: "Strong spiritual arc, but shots 3 and 4 repeat the same dramatic logic."
- **Studio**: "Shot 5 breaks geography established by the previous frame."

### 2. Project-level Assistant Director panel

Should show:

- current status
- latest observations
- queued recommendations
- run history
- approvals needed

### 3. Inline action chips

Examples:

- `Approve and continue`
- `Rerun with suggested note`
- `Apply rewrite`
- `Dismiss`

### 4. Audit details

For power users:

- what input was judged
- what the assistant said
- what action it took
- what changed after rerun

## Memory model

This is where people overcomplicate things. We do not need mystical memory.

We need three layers:

### 1. Canonical state in Lahari DB

This is the real source of truth:

- current prompts
- locked choices
- outputs
- comments
- actions
- stage events

### 2. Compact project summary

Persist a compact, rewritten project memory:

- "Artist prefers restrained devotional imagery."
- "Avoid modern urban concepts for this song family."
- "Previous concept rerun succeeded when note emphasized contemplative darshan."

This should be stored in `lahari_director_memory`.

### 3. Optional SDK conversation continuity

The SDK can maintain run history and tracing, but that should be treated as runtime convenience, not the only durable memory.

If a service restarts, Lahari should still know:

- what the assistant said
- what it tried
- what worked

## Critique workflow by stage

### Concept

Agent checks:

- does the concept fit song type and mood?
- is it over-plotted for meditative material?
- is "modern" being interpreted as visual treatment or wrong setting?
- do the 3 options feel meaningfully distinct?

Possible actions:

- comment only
- rerun concepts with note
- greenlight

### Script

Agent checks:

- does pacing fit the song?
- does the scene arc feel coherent?
- is it devotional cinema or screenplay-brain?
- are cast and environments reasonable and reusable?
- do shot directions describe beats rather than camera instructions?

Possible actions:

- comment only
- refine script with note
- greenlight

### Style

Agent checks:

- does the style image match the concept and song form?
- is the style too synthetic or generic?
- is it likely to support good downstream image generation?

Possible actions:

- comment
- rerun brainstorm or visualize
- greenlight

### Looks

Agent checks:

- character identity clarity
- environment coherence
- alignment with style
- consistency with devotional world

Possible actions:

- comment
- regenerate candidate set
- refine generation prompt
- greenlight

### Shot prompts

Agent checks:

- sequence rhythm
- geography
- repetition of camera verbs
- too much literal spectacle
- continuity choices
- whether the prompts honor the shot direction

Possible actions:

- comment
- rewrite all prompts with note
- refine one shot
- greenlight

### Generated frames/videos

Agent checks:

- identity
- geography
- continuity
- compositional clarity
- whether the output achieved the intended beat

Possible actions:

- comment
- suggest prompt rewrite
- rerun specific shot
- approve shot

## How stage automation should work

The clean loop:

1. User or system triggers a stage action
2. Lahari runs the normal route/service
3. Lahari records a `stage_event`
4. Assistant Director wakes up on that event
5. Assistant Director:
   - loads compact context
   - critiques result
   - writes comment
   - optionally proposes or executes next action
6. UI updates with comment and recommendation
7. If rerun happens, that rerun also becomes a new `stage_event`

This keeps the orchestration legible.

## Approval model

We should explicitly categorize actions:

### Safe and cheap

Can be auto-run later:

- concept reruns
- script refine
- prompt rewrites
- text-only refines

### Paid or artist-sensitive

Require approval:

- image generation
- video generation
- batch rewrites that affect many locked assets

### Destructive

Always require approval:

- overwrite/fork decisions
- anything that wipes downstream
- relock operations that can invalidate major work

## Guardrails

Use SDK guardrails for:

- preventing unauthorized/destructive actions
- requiring approval before expensive tools
- blocking runaway rerun loops

Suggested tripwires:

- more than `N` automatic reruns for one entity
- more than `M` paid generations without approval
- attempt to mutate a locked/destructive stage without consent

## Observability

The SDK's tracing is valuable, but it is not enough by itself.

We want both:

1. **OpenAI trace**
   - model/tool/handoff debug visibility

2. **Lahari event log**
   - business-level truth
   - project-specific auditability
   - durable UI history

Best practice:

- keep SDK tracing enabled in server runtimes
- tag runs with project/stage metadata
- also persist our own stage/comment/action records

## Suggested implementation phases

### Phase 0: groundwork

- add event/comment/action/memory tables
- define typed stage payload builders
- define critique schemas
- identify safe tools

### Phase 1: critique-only Assistant Director

- one agent
- one tool bundle for reads
- triggered after concept/script/style/shot-prompt stages
- posts visible comments only

Success criteria:

- comments are useful
- no accidental mutations
- artists trust the notes

### Phase 2: safe reruns

- add rerun tools for concept/script/prompt stages
- approval-free only for text/safe stages
- track whether reruns improved outcomes

Success criteria:

- reruns save real manual work
- no thrashing loops

### Phase 3: Studio critique

- critique generated frames/videos
- recommend prompt edits or reruns
- show per-shot comments in Studio

Success criteria:

- catches continuity and taste failures before artist frustration

### Phase 4: real Assistant Director

- project-level panel
- approvals queue
- persistent memory
- optional specialist agents
- production-quality event tracing

## Concrete first build

If we want the fastest path to value, build this:

### First target

**Assistant Director for Blueprint only**

Watches:

- concept generation
- script generation
- style visualization
- write shot prompts

Capabilities:

- critique result
- post comments
- suggest rerun note
- optionally trigger safe rerun for concept/script/prompt rewrite

Why this first:

- highest leverage
- mostly text/cheap operations
- least destructive
- directly improves taste before expensive image/video spend

## Technical fit with current Lahari

This plan fits the current architecture well because Lahari already has:

- explicit routes for each stage
- durable prompt snapshots (`last_*_prompt`)
- `lahari_ai_calls`
- `xray`
- project-scoped chat/messages
- clear phase semantics
- scoped mutations

The missing layer is not raw capability. It is:

- event capture
- visible critique records
- safe agent tools
- project memory
- approval rules

## Open questions

These should be decided before implementation:

1. Should the Assistant Director live inside the main backend process or as a sibling service?
2. Do we want automatic wake-up on every stage event, or only on selected stages at first?
3. What actions are approval-free in V2?
4. Should the first model be a single general director, or do we want one specialist critic from day one?
5. Do we want artist-facing scores, or only comments/verdicts?

## Recommendation summary

Build the Assistant Director.

Build it with the **OpenAI Agents SDK**.

But build it the Lahari way:

- DB is source of truth
- routes/services remain authoritative
- agent uses tools, not raw DB writes
- stage events drive the loop
- comments are visible in product
- autonomy grows gradually

That gives us a clean path from today's deterministic pipeline to a real assistant-director system without turning the product into agentic mush.

## Reference reading

Official OpenAI docs worth keeping nearby while implementing:

- Agents SDK overview: <https://platform.openai.com/docs/guides/agents-sdk/>
- JS agents guide: <https://openai.github.io/openai-agents-js/guides/agents>
- Running agents: <https://openai.github.io/openai-agents-js/guides/running-agents/>
- Results/history/newItems: <https://openai.github.io/openai-agents-js/guides/results/>
- Context management: <https://openai.github.io/openai-agents-js/guides/context/>
- Tools: <https://openai.github.io/openai-agents-js/guides/tools>
- Handoffs: <https://openai.github.io/openai-agents-js/guides/handoffs/>
- Guardrails: <https://openai.github.io/openai-agents-js/guides/guardrails/>
- Tracing: <https://openai.github.io/openai-agents-js/guides/tracing/>
