# docs/

Agents should start at the repository root `AGENTS.md`. That file is the front door and current operating map. This file is only an index so humans and future agents can find the right deeper reference without reading the whole folder.

Anything in `docs/archive/` is historical. Do not treat archived docs as current unless a living doc explicitly links one for provenance.

## Current Source Of Truth

| File | What it is |
|---|---|
| [`mirage-platform-v1-ledger.md`](./mirage-platform-v1-ledger.md) | Mirage v1 decisions, active tracks, contracts, checkpoints, and operational state. This wins over older v1/platform plans. |
| [`mirage-convergence-ledger.md`](./mirage-convergence-ledger.md) | Post-v1 plan for Lahari-as-tenant convergence, workspaces, packs, queue shape, and sequencing. |
| [`codex-native-doctrine.md`](./codex-native-doctrine.md) | Durable operating contract for source of truth, MCP/CLI boundary, editability tiers, distribution, and session protocol. |
| [`agent-working-method.md`](./agent-working-method.md) | Practical agent working discipline and review habits. |

## Pipeline And Tool Surface

| File | What it is |
|---|---|
| [`pipeline-anatomy.md`](./pipeline-anatomy.md) | Backend pipeline behavior truth. Update when pipeline behavior changes. |
| [`mirage-tool-reference.md`](./mirage-tool-reference.md) | Current agent-visible action/tool reference. |
| [`mirage-tool-and-prompt-audit.md`](./mirage-tool-and-prompt-audit.md) | Active audit/backlog for tool and prompt-surface gaps. |
| [`mirage-workflow-recipes.md`](./mirage-workflow-recipes.md) | Named repeatable workflow recipes and prompt-override patterns. |
| [`mirage-mcp-payload-reference.md`](./mirage-mcp-payload-reference.md) | Payload reference for MCP/client surfaces. |
| [`mirage-composer-architecture.md`](./mirage-composer-architecture.md) | Reference architecture for graph-first prompt composition. |
| [`mirage-composer-audit.md`](./mirage-composer-audit.md) | Historical composer audit with current caveats; read through the architecture doc. |
| [`seedance-storyboard-workflow.md`](./seedance-storyboard-workflow.md) | Seedance storyboard mode baseline. |
| [`button-feedback-audit.md`](./button-feedback-audit.md) | Active UI feedback backlog. |

## Convergence And Taste Backlog

| File | What it is |
|---|---|
| [`lahari-divergence-audit.md`](./lahari-divergence-audit.md) | Differential backlog for useful Lahari commits to port/adapt/skip. |
| [`lahari-taste-harvest-audit.md`](./lahari-taste-harvest-audit.md) | Lahari taste, prompt, and preset harvest notes for packs/workflows. |
| [`mirage-lahari-tenant-port-plan.md`](./mirage-lahari-tenant-port-plan.md) | Tenant-port plan when convergence moves from planning to implementation. |
| [`mirage-beta-workspace-preset-packs.md`](./mirage-beta-workspace-preset-packs.md) | Product sketch for accounts, workspaces, and preset packs. |

## Ops And Reference

| File | What it is |
|---|---|
| [`studio-db-bootstrap.md`](./studio-db-bootstrap.md) | Fresh Supabase setup and clean `studio_*` schema notes. |
| [`modal-renderer.md`](./modal-renderer.md) | Modal renderer infra reference. |
| [`remotion-renderer.md`](./remotion-renderer.md) | Remotion renderer infra reference. |
| [`video-model-comparison.md`](./video-model-comparison.md) | Practical model/provider reference. |
| [`database.sql`](./database.sql) | Schema reference snapshot. |
| [`assets/`](./assets/) | Diagrams and reference images. |

## Future / Architecture Targets

| File | What it is |
|---|---|
| [`mirage-agent-platform-api-architecture.md`](./mirage-agent-platform-api-architecture.md) | Target architecture for a cleaner Core HTTP API + small MCP cockpit. |
| [`mirage-codex-plugin-prototype.md`](./mirage-codex-plugin-prototype.md) | Plugin packaging notes and prototype shape. |

## Archive Discipline

- Root docs should describe what is true now or track active work.
- Archived docs stay frozen except for a short header explaining why they were archived and where the current truth lives.
- Do not add a second orientation doc. Keep orientation in root `AGENTS.md`; keep this file as an index.
