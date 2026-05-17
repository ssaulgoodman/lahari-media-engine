> **Archived.** Aspirational vision doc. Never shipped in this shape. Preserved for reference. 
# World-Class Product Plan

## Goal

Turn Lahari from a powerful internal production tool into a reliable, proactive, world-class long-form video system.

Lahari should be treated as the first strong vertical workflow, not the final product boundary.

## What "World-Class" Means Here

1. **Consistent product grammar**
   - Same mental model for status, stale, loading, error, history, retry, and completion across Blueprint, Studio, and Render.

2. **Proactive failure detection**
   - The system tells us what is breaking before artists report it.

3. **Operational visibility**
   - We can see what is running, what failed, what is stuck, and why.

4. **Recoverable UX**
   - Errors are specific, artist-facing, and actionable.

5. **Clear collaboration semantics**
   - Multi-user queue, branch/fork lineage, ownership, and publish behavior are easy to understand.

6. **Assistant-director readiness**
   - Business actions are structured enough for a persistent agent to operate safely.

7. **Domain-adaptable taste**
   - Product core supports long-form video broadly.
   - Lahari remains a strong preset/workflow layer on top.

## Main Gaps Today

### 1. Product Consistency
- Different parts of the app expose different interaction styles.
- Async behavior is not always expressed the same way.
- Prompt/ref/stale/lock semantics are powerful but not always equally legible.

### 2. Observability
- Failures can still be discovered reactively instead of proactively.
- We need stronger visibility into generation, render, queue, and callback lifecycles.

### 3. Error UX
- Better than before, but not yet fully operational.
- Errors need to be classified, surfaced clearly, and tied to recovery actions.

### 4. Collaboration Model
- Multi-user support exists, but ownership and branch/publish semantics should be more explicit in product language.

### 5. State Architecture
- Large files and broad state surfaces still make correctness fragile.
- Structural breakup is part of product quality, not just code cleanliness.

### 6. Agent Readiness
- The pipeline is close, but still needs a clean tool layer, audit trail, and risk model for a persistent Assistant Director.
- Today the system is mostly deterministic orchestration plus targeted LLM calls. That is a solid foundation.
- Agenticness should be added gradually: inspect -> propose -> apply safe edits -> orchestrate multi-step work.

## Proactive QA and Failure Detection

## Principle

Do not wait for artists to report breakage.

Every async stage should answer:
- What is happening?
- How long has it been happening?
- What failed?
- Why?
- What should the artist do?
- What should we fix?

## Build These Systems

### 1. Error Taxonomy

Every failure should be classified into a small set of buckets:

- auth
- permissions / ownership
- bad input / validation
- provider capacity
- provider safety / policy
- provider contract mismatch
- timeout
- storage / upload
- render / callback
- optimistic UI / state mismatch
- unknown internal error

Each error should record:
- `projectId`
- `sceneId` / `shotId` if relevant
- `stage`
- `endpoint`
- `provider`
- `model`
- raw internal error
- artist-facing message
- recovery suggestion

### 2. Central Event Stream

Log lifecycle events, not just failures:

- requested
- started
- succeeded
- failed
- retried
- canceled
- superseded
- published

Suggested table shape:

`lahari_job_events`
- `id`
- `project_id`
- `shot_id`
- `kind`
- `stage`
- `status`
- `provider`
- `model`
- `payload`
- `error_message`
- `created_at`

This becomes the source for dashboards, alerts, and failure review.

### 3. Trace Explorer + Quality Inbox

Do not stop at a passive dashboard.

Build:

- **Trace Explorer** — every generation, analysis, render, callback, retry, and publish path as a navigable trace
- **Quality Inbox** — grouped issues to triage:
  - new failures
  - repeated failures
  - stuck renders
  - stale-too-long items
  - post-deploy regressions
  - cost/latency anomalies

Best workflow:
- inspect trace
- label the issue
- add it to evals
- fix
- verify it no longer regresses

### 4. Synthetic Test Projects

Maintain 3-5 canonical test projects:

1. simple hard-cut project
2. continuity-heavy chained project
3. character/style-heavy project
4. render/timeline-heavy project
5. queue-start + publish roundtrip project

Run them:
- nightly
- after deploy
- optionally before major merges

Smoke path should cover:
- queue start
- analysis
- prompt writing
- one frame generation
- one video generation
- one render
- queue completion writeback

### 5. Release Canaries

After deployment:
- automatically run a minimal end-to-end workflow
- fail loudly if any stage regresses

Do not rely only on manual spot checking.

### 6. Eval Flywheel

Turn real failures into permanent regression coverage.

Workflow:
- capture bad production traces
- label them
- convert them into eval cases
- run them in CI / nightly / post-deploy

This should become a standard product loop, not an occasional cleanup task.

### 7. Failure Review Loop

Operational rhythm:

- **daily**: inspect new failures and stuck jobs
- **weekly**: fix the top recurring failure classes
- **monthly**: remove one whole category of instability

Goal: move from random bug reports to visible, shrinking failure classes.

## Product Improvements Beyond Observability

### 1. Unify Status Grammar

Use a consistent product language everywhere for:
- idle
- loading
- stale
- error
- locked
- completed
- superseded

Same visual and textual meaning across Blueprint, Studio, and Render.

### 2. Make Errors Actionable

Every visible error should answer:
- what failed
- why it likely failed
- what the artist can try next

Examples:
- switch provider/model
- retry later
- refine prompt
- regenerate prerequisite frame
- unlock shot
- remove unsupported refs

### 3. Clarify Collaboration Semantics

Make these explicit in UI and docs:
- who owns a project
- what `source_queue_id` means
- what happens when multiple users work the same song
- how forks differ from parallel user projects
- what “publish” promotes
- whether latest-completed-wins is intended

### 4. Strengthen Assistant-Director Readiness

Before a persistent project assistant ships, we should have:

- structured business-action tools
- diff/change-set model
- approval flow for paid/destructive actions
- audit trail of applied edits
- project memory/preferences
- clear risk classes: safe / review / paid / destructive

Also: do not force a "fully agentic" rewrite of the product.
Keep the deterministic pipeline backbone and add agent capability in layers on top of it.

### 5. Finish Structural Breakup

Large files are not just a developer inconvenience.
They directly reduce reliability.

Priority:
1. break up `generate.ts`
2. break up `Storyboard.tsx`
3. later break up `App.tsx`

## Suggested Near-Term Roadmap

### Phase 1: Reliability Foundation
- error taxonomy
- central event logging
- trace explorer
- quality inbox
- stuck-job visibility
- synthetic smoke tests
- eval flywheel

### Phase 2: UX Consistency
- unify status grammar
- improve error copy and recovery actions
- make queue/render/multi-user behavior explicit

### Phase 3: Structural Safety
- execute file breakup plan
- reduce state surface area
- improve async boundaries

### Phase 4: Assistant Director Platform
- tool registry
- change sets
- audit trail
- persistent project memory
- safe agent harness

### Phase 5: Agentic Gradient
- inspect and explain project state
- propose safe edits
- apply approved multi-entity changes
- orchestrate bounded generation workflows
- persist project-specific assistant memory

## Standard

The product is moving toward world-class when:

- failures are seen internally before users report them
- every async stage is inspectable
- the same rules apply everywhere
- artists know what happened and what to do next
- complex features can be changed without fear
- the assistant layer can operate on top of stable, explicit primitives
