# R29 Project Config Design

Status: first-pass design
Date: 2026-05-13

## Goal

Give each Lahari project an editable config surface that Codex can own without mutating engine truth. Phase 1 covers only:

- project preferences: selected text/image/storyboard/video models and small workflow defaults
- project prompt overrides: storyboard prompt recipe and video prompt recipe

This is tier 1 from `docs/codex-native-doctrine.md`: Codex may edit local desk-copy files freely, but production behavior changes only after typed apply tools validate and persist them to Supabase.

## Non-Goals

R29 phase 1 does not implement a general memory system, taste bible, glossary, decision log, prompt marketplace, or per-shot prompt editing surface.

Per-shot storyboard prompts, video prompts, script rows, concepts, scenes, and assets remain tier 2 project state. They must still move through apply tools with validation and director events.

Global prompts in `server/prompts/catalog.ts` and runtime prompt-building code stay tier 3 engine truth. Director sessions must not edit them.

## Local Desk Copy

New artifacts should live under the unified project folder:

```text
.lahari/projects/<projectId>/config/
  preferences.json
  prompts/
    storyboard.md
    video.md
  hashes.json
```

`preferences.json` is structured JSON:

```json
{
  "textProvider": "gpt-5.5",
  "imageModel": "nano-banana-2",
  "storyboardProvider": "nano-banana-pro",
  "videoModel": "seedance-2.0-fast",
  "storyboard": {
    "defaultVariant": "adaptive_numbered_storyboard",
    "usePrevStoryboardRefDefault": false,
    "includePrevCutPlanDefault": "smart"
  },
  "video": {
    "defaultMode": "storyboard",
    "preferLockedStoryboard": true
  }
}
```

Prompt override files are plain Markdown with frontmatter:

```md
---
kind: storyboard
scope: project
status: active
---

Write concise storyboard image prompts for this project...
```

Codex can edit these files directly during a director session. They are still desk copies until applied.

## Supabase Canonical Shape

Phase 1 should add two small canonical surfaces.

`lahari_project_config`

```sql
project_id uuid primary key references lahari_projects(id) on delete cascade,
preferences jsonb not null default '{}',
updated_at timestamptz not null default now(),
updated_by uuid null
```

`lahari_project_prompt_overrides`

```sql
id uuid primary key default gen_random_uuid(),
project_id uuid not null references lahari_projects(id) on delete cascade,
kind text not null check (kind in ('storyboard', 'video')),
scope_type text not null default 'project' check (scope_type in ('project', 'scene', 'shot')),
scope_id uuid null,
body text not null,
metadata jsonb not null default '{}',
active boolean not null default true,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
updated_by uuid null,
unique(project_id, kind, scope_type, scope_id)
```

For phase 1, only `scope_type = 'project'` is required. The scoped columns exist so scene/shot overrides can land later without a table rewrite.

## Inheritance

Prompt and preference resolution should be explicit and boring.

| Config | Precedence |
|---|---|
| model preference | project config preference -> `lahari_projects` field -> engine default |
| storyboard prompt recipe | shot override -> scene override -> project override -> global builder/catalog |
| video prompt recipe | shot override -> scene override -> project override -> global video prompt builder |
| workflow defaults | project config preference -> current UI/backend default |

Phase 1 implements only project-level prompt override lookup. The helper should still accept scope arguments so later phases do not change call sites.

## Apply Tools

`apply_project_preferences`

Input:

```json
{
  "projectId": "uuid",
  "preferences": {},
  "baseHash": "sha256 of current canonical preferences"
}
```

Validation:

- reject unknown top-level keys
- validate provider keys against current registries
- validate enum values for workflow defaults
- compare `baseHash` against canonical current hash; fail on drift

Output:

```json
{
  "kind": "lahari.apply.project_preferences",
  "projectId": "uuid",
  "changed": ["textProvider", "storyboardProvider"],
  "directorEventSeq": 123,
  "webUrl": "..."
}
```

`apply_project_prompt_override`

Input:

```json
{
  "projectId": "uuid",
  "kind": "storyboard",
  "scopeType": "project",
  "scopeId": null,
  "body": "prompt recipe text",
  "metadata": {},
  "baseHash": "sha256 of current canonical override or global seed"
}
```

Validation:

- `kind` is `storyboard` or `video`
- phase 1 only accepts `scopeType = project`
- body is non-empty and below a generous cap, for example 12k chars
- no engine-only placeholders unless explicitly allowed
- compare `baseHash`; fail on drift with current canonical hash and summary

Output:

```json
{
  "kind": "lahari.apply.project_prompt_override",
  "projectId": "uuid",
  "promptKind": "storyboard",
  "scopeType": "project",
  "active": true,
  "directorEventSeq": 124,
  "webUrl": "..."
}
```

Both tools record `lahari_director_events` with `source = 'codex'`.

## Read Path

`attach_director_session` should include config in its response so Codex does not need a separate first call:

```json
{
  "projectConfig": {
    "preferences": {},
    "promptOverrides": [
      {
        "kind": "storyboard",
        "scopeType": "project",
        "active": true,
        "hash": "..."
      }
    ],
    "localPaths": {
      "preferences": ".lahari/projects/<id>/config/preferences.json",
      "storyboardPrompt": ".lahari/projects/<id>/config/prompts/storyboard.md",
      "videoPrompt": ".lahari/projects/<id>/config/prompts/video.md"
    }
  }
}
```

`hydrateProjectWorkbench` should write the config files and `hashes.json`.

## Backend Integration

Add one helper:

```ts
getProjectPromptOverride({
  projectId,
  kind,
  scopeType,
  scopeId,
}): Promise<string | null>
```

Phase 1 callers:

- storyboard prompt planning reads `kind = 'storyboard'`
- video prompt building reads `kind = 'video'`

The helper handles fallback internally:

1. exact shot override, future
2. exact scene override, future
3. active project override
4. null, meaning use global builder

Model preference reads should use a separate helper:

```ts
getProjectPreferences(projectId): Promise<ProjectPreferences>
```

This helper merges `lahari_project_config.preferences` over existing project row fields and registry defaults. It should not silently accept invalid provider keys; invalid persisted keys should produce a warning in packets/status and fall back to the project row/default.

## Drift Rules

Every local config file gets a hash when written:

```json
{
  "preferences": {
    "canonicalHash": "sha256",
    "writtenAt": "2026-05-13T00:00:00.000Z"
  },
  "prompts/storyboard.md": {
    "canonicalHash": "sha256",
    "writtenAt": "2026-05-13T00:00:00.000Z"
  }
}
```

Apply tools compare the submitted `baseHash` to the current canonical hash. On mismatch, they refuse and return:

```json
{
  "error": "config_drift",
  "message": "Project storyboard prompt override changed since local desk copy was written.",
  "currentHash": "sha256",
  "next": "Reattach or hydrate the project, merge edits, then apply again."
}
```

No silent overwrites.

## Relationship To R28

R28 handles apply-only content tools for project state, especially storyboard prompts and video prompts. R29 handles reusable project config and prompt recipes.

The distinction:

- R28 `apply_storyboard_prompt` writes the actual saved prompt for a shot.
- R29 `apply_project_prompt_override(kind='storyboard')` writes the recipe Codex uses to produce future shot prompts.

Both are needed. R29 makes the project smarter; R28 applies concrete generated content.

## Phase 1 Implementation Order

1. Add migrations for `lahari_project_config` and `lahari_project_prompt_overrides`.
2. Add read helpers and hash helpers.
3. Extend `hydrateProjectWorkbench` and `attachDirectorSession` to write/include config.
4. Add `apply_project_preferences`.
5. Add `apply_project_prompt_override`.
6. Wire storyboard planner/video prompt builder to read project overrides.
7. Add MCP tools and CLI smoke commands.
8. Smoke on the current director-test project without changing global prompts.

## Open Questions

- Should model preferences eventually move fully out of `lahari_projects`, or should project config override them while the old columns remain UI-compatible?
- Should prompt overrides support inactive history rows from day one, or is one active row per scope enough for phase 1?
- Should the web studio expose these project config files directly, or should it only show a compact "Codex overrides active" badge for now?
