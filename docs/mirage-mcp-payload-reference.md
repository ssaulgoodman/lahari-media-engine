# Mirage MCP Payload Reference

Last audited: 2026-06-04
Source of truth: `server/routes/mcp.ts`, `server/services/actionRegistry.ts`, `server/resources/notebook/AGENTS.template.md`

This doc answers one narrow question: **what language and schemas does a director agent actually ingest from Mirage MCP?**

There are three different payload layers. Keep them separate:

1. **MCP initialize instructions** — short text sent when the MCP server connects.
2. **MCP tool cards** — tool names, descriptions, input schemas, and annotations exposed by the MCP server.
3. **Runtime tool results** — project state, action indexes, action schemas, receipts, notebook manifests, job status, etc. These are only ingested after the agent calls a tool.

The durable operating manual is not the MCP payload. It is the local workbench `AGENTS.md` generated from `server/resources/notebook/AGENTS.template.md`.

## 1. Main MCP Instructions

This is the direct instruction payload currently passed to `new McpServer(..., { instructions })`.

```text
You are operating Mirage as the director. Mirage is an AI video studio for building projects from source material into concepts, scripts, styles, references, storyboards, videos, and final renders.

Use Mirage tools to read project state and save changes. Write creative text yourself, then persist it through typed actions. Translate artist intent into exact edits: a prompt change, context override, style note, image edit instruction, lock, import, or generation request. Ask before paid generation, locks/unlocks, prompt overrides, topology rebuilds, or anything that stales approved work.

To continue work, call list_projects if needed, then open_project. To start fresh, call create_project, then open_project. For uploaded audio, create the project shell, upload with purpose=audio_source, then ask whether the audio is soundtrack-only or source material before running analysis.

Use run_action for free changes such as text edits, plans, locks, imports, and config updates. Use start_job for paid media generation such as images, storyboards, videos, and TTS; it returns a jobId. Use describe_action when you need one live input schema. Upload local images/audio with /api/agent/uploads, then pass the returned assetId into actions. Do not send bytes through MCP.

Use clear artist-facing language. The Mirage web app is the visual studio, so share returned web links for review. If a tool misbehaves or the studio disagrees with project state, call mirage_capture_issue with a short report.

If the harness has a filesystem, initialize the folder once with Mirage CLI init if needed, then call mint_cli_token to sync project files and operate from AGENTS.md. If there is no filesystem, work through these tools and use get_project_state for compact state reads.
```

Payload intent:

- Thin starter, not the full manual.
- Establishes role, source of truth, dispatch shape, approval rule, upload rule.
- Hands filesystem clients to local `AGENTS.md`.
- Does not include file layout, skill doctrine, sync troubleshooting, or craft guidance.

## 2. Tool Card Payloads

Every registered MCP tool contributes a tool card: name, title, description, input schema, and annotations. This is what the agent can see before calling the tool.

Tool annotations are generated in `toolAnnotations(name)`:

- Read-only hint for `list_*`, `get_*`, `read_*`, `plan_*`, `preview_*`, `review_*`, `open_project`, `describe_action`, `get_job`, `list_jobs`, and notebook write/read fallback tools.
- Destructive hint for `apply_script`, `apply_script_markdown`, `rollback_*`, and `revert_*`.
- Mutating/non-idempotent hint for `apply_*`, `generate_*`, `bulk_generate_*`, `refine_*`, `lock_*`, and `unlock_*`.

### Default Director Tools

These are the main hosted artist-facing tools an agent should use.

| Tool | Direct card language | Input payload | Runtime result shape |
|---|---|---|---|
| `list_projects` | Lists recent Mirage projects for the authenticated artist. | `limit?` | Lean project rows: ids, titles, status, model/provider labels, timestamps. |
| `mirage_doctor` | Coherence oracle for onboarding and deploy checks. The headline verdict is the thing to act on. | Optional raw local `mirage status` / `mirage doctor` JSON. | Read-only verdict comparing live MCP version, production-served CLI pin, npm latest CLI, canonical skills/actions hashes, and optional local status. |
| `create_project` | Creates a project shell. No paid call runs. Audio seeds require upload/analysis opt-in. | title, workflow/preset/seed hints, source asset/script/brief/runtime fields | Created project plus initial project object. |
| `open_project` | Opens a project session and returns production working set. `detail=full` is heavy debug only. | `projectId`, `detail?`, `sinceSeq?`, `note?` | Production working set, actions, recent events, web URL. |
| `get_project_state` | Compact state by default; `full` is debug. Prompt bodies should come from notebook files. | `projectId`, `detail?` | Summary, production, or full project packet depending on detail. |
| `list_actions` | Lean index of registry actions. Full schema is `describe_action`. | `projectId`, `surface?` | Key/surface/paid/mutates/summary/detail tool, not full schemas. |
| `describe_action` | Returns one action's input contract, examples, and semantics. | `actionKey` | One full action spec from `actionRegistry.ts`. |
| `run_action` | Runs a registry action by key. | `actionKey`, `input` | Lean normalized receipt. `changedArtifacts` bodies are stripped to paths/hashes. |
| `start_job` | Starts one paid action in background and returns `jobId`. | `actionKey`, `input` | Job start receipt; result is polled with `get_job`. |
| `parallel_run` | Runs up to 8 registry actions concurrently. | `actions[]` | Combined lean receipt, recursively normalized. |
| `get_job` | Returns durable status/result/error for one job. | `projectId`, `jobId` | Single job status plus result/error. Result may be meaningful; this is an explicit fetch. |
| `list_jobs` | Lists recent jobs status-only. | `projectId`, `status?`, `limit?` | Job rows without result bodies; use `get_job` for one result. |
| `list_results` | Lists recoverable results for an entity; currently looks candidates. | `resultType`, `projectId`, `entityType`, `entityId` | Candidate list via `list_candidates`. |
| `mint_cli_token` | Issues short-lived project token for CLI sync and direct HTTPS uploads. | `projectId`, `ttlMinutes?` | Token plus sync/upload commands. Bodies stay outside MCP. |
| `get_project_notebook_manifest` | Returns notebook file metadata without bodies. | `projectId` | Paths, modes, scopes, hashes, sizes. |
| `read_project_notebook_file` | Returns one notebook file body by path. | `projectId`, `path` | One file body plus hash/metadata. |
| `write_project_notebook` | Final fallback returning all notebook file bodies. Prefer CLI sync or manifest+single-file reads. | `projectId` | Full notebook body payload. Heavy by design, off happy path. |
| `get_agent_timing_summary` | Summarizes recent MCP timing/size logs. | `projectId`, `sinceHours?`, `source?`, `limit?` | Aggregated timing/size diagnostics. |
| `mirage_capture_issue` | Captures an issue for engine debugging. | `projectId`, `severity`, `summary`, `suggestedFix?`, `recentToolCalls?` | Issue capture acknowledgement. |

### Compatibility / Remote-Gap Tools

The codebase still contains older direct tools and unsupported remote-gap aliases. Some harnesses may list them if legacy tools are enabled or cached, but they are not the intended director path.

Examples:

- `preview_rewrite_script`
- `preview_rewrite_shot_prompts`
- `preview_rewrite_storyboard_prompt`
- `plan_apply_*_preview`
- `apply_*_preview`
- `rollback_*_preview`
- legacy direct generation/apply tools such as `apply_script_markdown`, `apply_storyboard_scene_markdown`, `generate_character_looks`, etc.

Policy:

- The happy path is cockpit + action registry.
- If a remote-gap tool says to use another path, use the other path.
- Do not teach artists or agents to rely on legacy direct tools unless the task is engine compatibility debugging.

## 3. Action Registry Payloads

The action registry is not the same as the MCP tool list.

MCP exposes a few generic dispatch tools:

- `list_actions`
- `describe_action`
- `run_action`
- `start_job`
- `parallel_run`

The concrete creative operations live in `server/services/actionRegistry.ts`.

Current surfaces:

- `concept`
- `script`
- `style`
- `looks`
- `storyboard`
- `video`
- `audio`
- `system`

How the agent should ingest action details:

1. Use `list_actions` for a scan-sized index.
2. Use `describe_action(actionKey)` for the one full live schema you are about to call.
3. Do not expect local `config/actions/*` files in the workbench; actions are control-plane truth served by MCP.

This keeps full action schemas out of the initial MCP payload.

### Registry Index Shape

`list_actions` returns a lean index, not all full schemas:

```json
{
  "kind": "mirage.actions.index",
  "projectId": "project_uuid",
  "surface": "storyboard",
  "version": "actions_hash",
  "actions": [
    {
      "key": "generate_storyboard",
      "title": "Generate storyboard",
      "surface": "storyboard",
      "paid": true,
      "mutates": true,
      "summary": "Render a storyboard board for one shot from its saved storyboard prompt...",
      "detailTool": "describe_action",
      "detailInput": { "actionKey": "generate_storyboard" }
    }
  ]
}
```

### Full Action Spec Shape

`describe_action` returns one action spec:

```json
{
  "kind": "mirage.action.description",
  "action": {
    "key": "generate_storyboard",
    "title": "Generate storyboard",
    "surface": "storyboard",
    "mutates": true,
    "paid": true,
    "description": "Render a storyboard board for one shot from its saved storyboard prompt. dryRun returns the plan without spending.",
    "input": {
      "projectId": "string",
      "shotId": "string",
      "dryRun": "optional boolean",
      "artistNote": "optional soft direction for image generation",
      "modelOverride": "optional storyboardProvider override",
      "contextOverrides": "optional per-call ref/style-note controls..."
    },
    "examples": [
      { "projectId": "project_uuid", "shotId": "shot_uuid", "dryRun": true }
    ]
  }
}
```

## 4. Runtime Result Payloads

Runtime results are not preloaded. They enter context only when the agent calls the tool.

### Lean Reads

`open_project` default:

- production working set
- scene/shot tree
- looks/locked refs
- diagnosis/weak links
- available actions
- recent events
- web studio URL

`get_project_state` default:

- summary counts/flags
- compact project status

Both have `detail='full'`, but full is a debug escape hatch.

### Notebook Bodies

Preferred body path:

- `mint_cli_token`
- run the returned CLI sync command
- read local files

No-shell fallback:

- `get_project_notebook_manifest`
- `read_project_notebook_file` for one path at a time

Last fallback:

- `write_project_notebook`

The last fallback intentionally returns all file bodies. It should be rare.

### Action Receipts

Action results pass through `normalizeLeanActionReceipt`.

Important behavior:

- `changedArtifacts` file bodies are removed.
- paths, hashes, sizes, and summaries remain.
- nested action receipts inside `parallel_run` are also normalized.

This is why action calls can say what changed without dumping scripts, prompts, or notebook files into MCP context.

### Jobs

`start_job` returns immediately with a job id.

`list_jobs` is status-only.

`get_job` returns one job result/error. This can include the result because the agent explicitly asked for that one job.

## 5. What Should Not Be In MCP Payloads

These belong in local files, skills, web UI, or server internals, not the initial MCP handshake:

- Full operating manual.
- Full skill bodies.
- Full action schemas for every surface.
- Prompt catalogs.
- Prompt/body histories.
- Notebook file bodies.
- Image/audio bytes.
- Model provider secrets.
- Web Studio implementation details.

## 6. Current Review Questions

Use this checklist when auditing the payload language:

- Does the MCP initialize text still read like a thin doorway, or did it become a manual again?
- Do tool descriptions point agents toward lean reads and local files?
- Does any list tool return full result bodies?
- Does any "fallback" language invite eager fallback during normal operation?
- Are paid/mutating tools clearly separated from read-only orientation tools?
- Are action schemas discoverable without dumping every schema into context?
- Are compatibility tools clearly off happy path?
