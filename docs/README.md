# docs/

This folder holds living engineering documentation. Anything stale, superseded, or done is in `docs/archive/` — don't read those unless you need history.

## Read this first (in this order)

| File | When to read | What it is |
|---|---|---|
| [`codex-native-doctrine.md`](./codex-native-doctrine.md) | Before any substantive engineering pass | Durable operating contract. Three editability tiers, MCP/CLI boundary, harness-native vs tool-call, permission model, source-of-truth rules, distribution arc, discipline list, session-type protocol. Sections only change when the architecture genuinely changes. |
| [`codex-native-review-ledger.md`](./codex-native-review-ledger.md) | At session start and whenever a change ships | Append-only status tracking. **"Current State" snapshot at the top** tells you what's shipped, what's pending operationally, what the next workstream is. R# items each have a status. |

## Active workstream

| File | What it is |
|---|---|
| [`abstraction-platform-plan.md`](./abstraction-platform-plan.md) | The Mirage platform abstraction design. SeedKind / Workflow / Preset decomposition. Lives on the `abstraction` branch in a separate worktree. Engine fixes flow `codex-native-studio → abstraction` via merge. |

## Reference (engine internals)

| File | What it is |
|---|---|
| [`pipeline-anatomy.md`](./pipeline-anatomy.md) | Backend control-flow truth. Every pipeline stage traced: input → prompt → output → artist control → gaps. Update when pipeline behavior changes. |
| [`seedance-storyboard-workflow.md`](./seedance-storyboard-workflow.md) | Current Seedance two-step storyboard mode reference. |
| [`video-model-comparison.md`](./video-model-comparison.md) | Practical reference for adding new video model providers. |
| [`modal-renderer.md`](./modal-renderer.md) | Modal renderer infra reference. |
| [`remotion-renderer.md`](./remotion-renderer.md) | Remotion renderer infra reference. |
| [`database.sql`](./database.sql) | Schema reference. |
| [`assets/`](./assets/) | Diagrams and reference images. |

## Archive

[`docs/archive/`](./archive/) holds historical material. Don't treat anything there as current. Categories:

- **Shipped R# design docs** (r17, r28, r29, audit) — implementation lives in the codebase; the ledger entry is the durable record of what shipped. Design docs preserved for "why we built it this way" reference.
- **Superseded plans and vision docs** (assistant-director-plan, codex-native-studio, world-class-plan, learning-loop-plan, editable-prompts-plan, ui-polish-plan) — early thinking, replaced by what shipped. Each carries a header note pointing at the current source of truth.
- **Dated fix lists / audits** (fix-list-2026-04-22, cinematic-leak-audit-2026-05-12, openai-storyboard-cost-audit-2026-05-11, render-pipeline-overhaul-2026-05-11) — snapshots in time; the work is done.
- **Drafts and research** (grok-prompt-ressearch, storyboard-prompt-draft, seedance-storyboard-test-plan, preset-abstraction-ledger) — preserved for context; results applied.
- **Deprecated templates** (AGENTS-template-deprecated) — obsoleted by `write_project_notebook` generating per-project AGENTS.md.

## Discipline

- Living docs (this folder, excluding `archive/`) should accurately describe what's true right now. If a doc drifts from reality, fix it or archive it.
- Archived docs stay frozen except for the header note. Don't update archived content — write a new entry in the ledger or doctrine instead.
- New R# design docs should land here when raised, then move to `archive/` with a ledger-pointing header note once implementation ships and the ledger entry has the durable record.
- Keep `CLAUDE.md` and `AGENTS.md` at the repo root pointing at these docs, not duplicating them.
