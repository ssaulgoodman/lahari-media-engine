# R28 Apply-Only Text Generation Design

Status: first-pass design
Date: 2026-05-13
Companion to: `docs/codex-native-doctrine.md` §4, `docs/r29-project-config-design.md`

## Goal

Add a set of apply-only MCP tools that take pre-written structured content from Codex, validate against constraints, persist to Supabase, and record director events. No LLM call inside the tool. Codex writes the content using the relevant skill shard; the tool is the constraint enforcer and the persistence seam.

This is doctrine §4 made real: text-writing operations move from backend LLM wrappers to harness-native Codex authorship. Image generation, video generation, audio analysis, and other media tasks stay as tool calls.

## Scope

Six apply-only tools, ordered by leverage:

1. `apply_shot_prompts` — visual + motion prompts for one or more shots
2. `apply_storyboard_prompt` — storyboard prompt + cut plan for one shot
3. `apply_storyboard_prompts_bulk` — same, multi-shot
4. `apply_script` — full cast + environments + scenes + shots replacement
5. `apply_concept` — locked concept object
6. `apply_video_prompt` — motion prompt (keyframe mode) for one shot

Also covered: deprecation path for the two transitional tools from R25 (`write_storyboard_prompt`, `bulk_write_storyboard_prompts`).

## Non-Goals

R28 does NOT implement:

- A preview-with-AI step. Codex IS the preview. The skill shards (`storyboard-prompt-craft`, `script-doctor`) are what shape quality. There's no `preview_apply_*` companion.
- Image, video, render, or audio generation. Those stay as tool calls (existing `generate_*`, `refine_*`, `bulk_generate_*`).
- Rollback variants beyond what already exists. The existing `rollback_*_preview` tools work against preview JSON; apply-only tools deal with content that doesn't have an LLM-preview origin, so the rollback story is different (see Rollback section).
- Project-level prompt recipe overrides. That's R29's lane.

## Why Apply-Only (Doctrine §4)

When Codex has the relevant skill shard loaded, it can write better content than a backend LLM call because:

- Codex has the full project packet in working memory (concept, locked style, cast refs, env refs, previous shots).
- The skill is the rubric — sharper than the catalog prompt template.
- No double-hop: harness already pays for the LLM via its own subscription.
- Constraint validation runs at apply time as a feedback loop — schema rejection lets Codex retry with the error as guidance.

The web studio retains existing backend `generate-*` / `refine-*` endpoints for non-Codex users. Two paths converge at the same persistence layer.

## Tool Specifications

### 1. `apply_shot_prompts`

**Most-used tool. Per-shot or bulk visual + motion prompt updates.**

Input:

```ts
{
  projectId: string;
  shots: Array<{
    shotId: string;
    visualPrompt?: string;        // first-frame image prompt
    motionPrompt?: string;        // keyframe-mode video prompt
    direction?: string;           // shot's creative intent (rare to update via this)
    continuityFrom?: 'cut' | 'prev_shot';
    baseHash?: string;            // sha256 of current (visualPrompt|motionPrompt|continuityFrom)
  }>;
  force?: boolean;                // skip drift refusal; requires explicit approval
}
```

Validation per shot:

- `shotId` resolves to a shot in this project
- `visualPrompt` non-empty when provided; ≤ 4000 chars
- `motionPrompt` non-empty when provided; ≤ 2000 chars
- `direction` ≤ 500 chars
- `continuityFrom` matches enum
- At least one of visualPrompt/motionPrompt/direction/continuityFrom is provided
- `baseHash` matches current per-shot hash, unless `force: true`

Behavior:

- Update only the fields provided. Leave other fields untouched.
- Set `prompts_stale: false` on every updated shot (Codex just wrote these, they're current).
- Set `refined_from_prev_frame: 0` if visualPrompt or motionPrompt changes (Codex wrote it, not chained refresh).
- Record one `shot_prompts_applied` director event per shot (or one bulk event with shot IDs — see "Audit Symmetry" below).

Error responses (structured for retry):

```json
{
  "error": "validation_failed",
  "shotId": "abc",
  "field": "visualPrompt",
  "message": "Length 5120 exceeds cap 4000. Compress description and retry."
}
```

```json
{
  "error": "drift_detected",
  "shotId": "abc",
  "field": "visualPrompt",
  "currentHash": "sha256...",
  "submittedBaseHash": "sha256...",
  "message": "Current visualPrompt changed since baseHash. Re-fetch shot packet and retry, or pass force: true."
}
```

Response:

```json
{
  "kind": "lahari.apply.shot_prompts",
  "projectId": "...",
  "shotsUpdated": 3,
  "updates": [
    { "shotId": "abc", "fieldsChanged": ["visualPrompt", "motionPrompt"], "newHash": "sha256..." },
    ...
  ],
  "directorEventSeqs": [124, 125, 126],
  "webUrl": "https://lahari.../?project=...&step=studio"
}
```

---

### 2. `apply_storyboard_prompt`

**Per-shot storyboard prompt + cut plan.**

Input:

```ts
{
  projectId: string;
  shotId: string;
  storyboardPrompt: string;     // image-render prompt with per-panel actions inline
  storyboardCutPlan: string;    // can be empty
  baseHash?: string;            // sha256 of current (storyboardPrompt|storyboardCutPlan)
  force?: boolean;
}
```

Validation:

- `shotId` resolves
- `storyboardPrompt` non-empty; ≤ 5000 chars (storyboards over ~4k degrade)
- `storyboardCutPlan` ≤ 3000 chars (can be empty string)
- Shot is not locked (refuse if `shot.locked === true`)
- `baseHash` matches current hash, unless `force: true`

Behavior:

- Update `storyboard_prompt`, `storyboard_cut_plan`, `storyboard_prompt_status: 'success'`.
- Set `prompts_stale: false`.
- If existing board exists (`storyboard_asset_id`), mark `storyboard_status: 'stale'` (Codex just rewrote the prompt; board needs regeneration).
- Mark `video_status: 'stale'` if existing video exists.
- Record `storyboard_prompt_applied` director event with `source: 'codex'`.

Error responses: same shape as #1 (validation_failed / drift_detected).

---

### 3. `apply_storyboard_prompts_bulk`

**Multi-shot storyboard prompt apply. Composes with `get_storyboard_status` output.**

Input:

```ts
{
  projectId: string;
  shots: Array<{
    shotId: string;
    storyboardPrompt: string;
    storyboardCutPlan: string;
    baseHash?: string;
  }>;
  force?: boolean;
}
```

Behavior:

- For each shot: same as `apply_storyboard_prompt` (single).
- Atomic-per-shot: each shot's update is independent. If one fails validation, others still apply. Response includes per-shot success/failure.
- Locked shots are skipped (not refused) — response notes `skipped: ['shotId-X (locked)']`.

Response:

```json
{
  "kind": "lahari.apply.storyboard_prompts_bulk",
  "projectId": "...",
  "applied": [{ "shotId": "abc", "newHash": "..." }],
  "skipped": [{ "shotId": "def", "reason": "locked" }],
  "rejected": [{ "shotId": "ghi", "reason": "drift_detected", "currentHash": "..." }],
  "directorEventSeqs": [...],
  "webUrl": "..."
}
```

---

### 4. `apply_script`

**Full cast + environments + scenes + shots replacement.** Highest blast radius. Same shape as the existing `apply_rewrite_script_preview` but no preview file.

Input:

```ts
{
  projectId: string;
  script: {
    cast: Array<{ id?: string; name: string; description: string }>;
    environments: Array<{ id?: string; name: string; description: string }>;
    scenes: Array<{
      id?: string;
      sectionLabel?: string;
      startTime?: string;
      endTime?: string;
      lyrics?: string;
      narrativeDescription?: string;
      shots: Array<{
        id?: string;
        direction?: string;
        duration: number;
        castIds?: string[];
        environmentId?: string | null;
        continuityFrom?: 'cut' | 'prev_shot';
      }>;
    }>;
  };
  baseFingerprint?: string;     // sha256 of buildScriptDraft(currentProject)
  force?: boolean;              // override hasDownstreamVisualWork refusal
}
```

Validation:

- Schema check on full structure
- Every shot's `castIds` resolve to a cast member by index or by ID
- Every shot's `environmentId` resolves to an environment
- Scene `endTime - startTime` matches sum of shot durations ± 0.5s
- Per-shot duration is positive, ≤ project's max shot duration
- Total scenes ≥ 1, total shots ≥ 1
- `baseFingerprint` matches current `scriptFingerprint(project)` unless `force: true`
- **Downstream visual work check** — if `hasDownstreamVisualWork(project)` returns true, refuse unless `force: true`. Forking is the safer recovery; the apply tool's error response includes the fork CLI command.

Behavior:

- Goes through the same RPC path as `applyRewriteScriptPreview` to atomically delete + reinsert all script rows in one Postgres transaction (use the existing `lahari_rollback_script_preview` shape, or define a parallel `lahari_apply_script` RPC).
- Sets project status to `scripted` (or whatever the existing apply path sets).
- Records one `script_applied` director event with summary of counts.

Why atomic: the same logic that made script rollback atomic in RB-FU1 applies here. Partial failure leaves the project broken.

Error responses:

```json
{
  "error": "downstream_visual_work",
  "message": "Project has locked shots, generated boards, or generated videos. Fork before applying a new script.",
  "forkCli": "npm run lahari -- fork-project <projectId>",
  "next": "Either fork the project, or pass force: true to wipe downstream work."
}
```

---

### 5. `apply_concept`

**Locked concept object.** Smaller surface than script.

Input:

```ts
{
  projectId: string;
  concept: {
    title: string;
    direction: string;
    description: string;
    deity?: string;
    mood?: string;
  };
  baseHash?: string;            // sha256 of current locked concept
  force?: boolean;
}
```

Validation:

- `title` non-empty, ≤ 200 chars
- `direction` non-empty, ≤ 500 chars
- `description` non-empty, ≤ 2000 chars
- `deity` ≤ 100 chars
- `mood` ≤ 200 chars
- `baseHash` matches current unless `force: true`
- **Downstream check** — if cast/env/scenes already exist for this project, warn (not refuse — concept can be refined without wiping script, depending on how much it changes).

Behavior:

- Updates `lahari_projects.locked_concept` JSON.
- If script exists and the concept change is significant (direction or description), mark dependent shots `prompts_stale: true`.
- Record `concept_applied` director event.

---

### 6. `apply_video_prompt`

**Per-shot motion_prompt for keyframe mode.**

(In storyboard mode the equivalent is `apply_storyboard_prompt` which includes the cut plan. There's no separate "video prompt" in storyboard mode — Seedance reads the board + cut plan.)

Input:

```ts
{
  projectId: string;
  shotId: string;
  motionPrompt: string;
  baseHash?: string;
  force?: boolean;
}
```

Validation:

- `shotId` resolves; not locked
- `motionPrompt` non-empty, ≤ 2000 chars
- Project is in keyframe mode (refuse for Seedance/storyboard mode with a directive: use `apply_storyboard_prompt` instead)
- `baseHash` matches current

Behavior:

- Update `motion_prompt`, set `prompts_stale: false`, mark `video_status: 'stale'` if existing video exists.
- Record `video_prompt_applied` event.

---

## Cross-Cutting Concerns

### Drift Detection

Every apply tool accepts an optional `baseHash` (or `baseFingerprint` for script). Computed as:

```ts
sha256(stableJson({ ...relevantFields }))
```

The hash is what Codex sees in the response of read tools (`get_shot_packet`, `attach_director_session`, etc.) at the moment it decides to write. If the canonical state changes between read and apply, the hash mismatches and the tool refuses with `drift_detected`.

`force: true` bypasses the check. Required for any apply that wipes work the artist or another agent has done. Tools refuse `force: true` without explicit approval verbiage in the call (the skill teaches: "Do not pass `force: true` without saying out loud what you're overwriting and asking the user.").

For new content (no current state), `baseHash` is omitted and no check runs. Set on first read; check on subsequent writes.

### Validation Error Shape

All apply tools return validation errors in the same shape so Codex can retry with structured feedback:

```json
{
  "error": "validation_failed" | "drift_detected" | "downstream_visual_work" | "shot_not_found" | "project_not_found" | "schema_invalid",
  "field": "fieldName",        // for validation_failed
  "shotId": "...",             // for per-shot tools
  "currentHash": "...",        // for drift_detected
  "submittedBaseHash": "...",  // for drift_detected
  "message": "Human-readable explanation.",
  "next": "Suggested recovery action."
}
```

Codex reads the error, adjusts content (e.g., compresses an over-cap prompt), and retries. The skill teaches: "On validation_failed, the tool's `message` and `field` tell you what to fix. Retry with the corrected content."

### Audit Symmetry

Each apply tool records audit (via existing `registerAuditedTool` wrapper). Director events:

- Single-shot tools: one event per apply with `entityType: 'shot'`, `entityId: <shotId>`.
- Bulk tools: one event per successfully-updated shot. (Not one bulk event — better journal granularity.)
- Project-level tools (`apply_concept`, `apply_script`): one event with `entityType: 'project'`.

Event types follow convention:
- `shot_prompts_applied` (per-shot)
- `storyboard_prompt_applied` (per-shot)
- `script_applied` (per-project)
- `concept_applied` (per-project)
- `video_prompt_applied` (per-shot)

Payload includes compact pointers per `eventResultPointers` whitelist (newHash, fieldsChanged, sourceCharCount). No full prompt bodies in event payloads — those bloat the table.

### Deprecation Path for R25 Transitional Tools

The two LLM-wrapper tools shipped in R25 (`write_storyboard_prompt`, `bulk_write_storyboard_prompts`) need to deprecate cleanly:

**Step 1 (with R28 ship):** mark them deprecated in tool descriptions:

> "Deprecated. Prefer `apply_storyboard_prompt` — write the prompt directly using the `storyboard-prompt-craft` skill, then apply. This tool wraps a backend LLM call and bypasses the harness-native pattern."

Tool keeps working. Audit logs note `deprecated: true`.

**Step 2 (one Codex pass later, after deprecation is observed):** add a warn-level log when the tool is called: `[deprecated] write_storyboard_prompt — use apply_storyboard_prompt instead.`

**Step 3 (after no usage observed for ~1 week):** remove from the MCP registration. The backend function `writeStoryboardPrompt` stays — the web studio still calls it via the `/write-storyboard-prompt` endpoint for non-Codex users.

Don't rename or alias. Deprecate explicitly; let usage drop; remove.

### Backend Integration

The apply tools call the same persistence layer as existing apply-preview tools. Reuse:
- `updateRows('shots', ...)` for shot field updates
- `lahari_rollback_script_preview` RPC (or define a sibling `lahari_apply_script` if cleaner) for atomic script replacement
- `recordDirectorEvent` for events
- Drift hashes computed via the same `hashJson` / `stableJson` helpers used in R29

No new database functions needed for shot-level applies — only for `apply_script` which needs the same atomic-transaction shape as rollback.

### Web Studio Compatibility

The existing backend endpoints (`/api/projects/:id/write-shot-prompts`, `/refine-shot-prompts`, `/generate-script`, `/refine-script`, `/lock-concept`, etc.) are untouched. The web studio keeps working. Apply-only tools are added alongside, not replacing.

This means web studio users get backend-LLM-authored content (current behavior); Codex sessions get harness-authored content (R28). Two paths, one persistence layer.

## Implementation Order

1. Define drift hash helpers reused across all tools (one `shotContentHash`, one `conceptHash`, etc., or generalized `hashJson` over the relevant fields).
2. Implement validation per tool, returning structured errors.
3. Wire the simplest tool first: `apply_video_prompt`. Smallest surface, fast smoke test.
4. `apply_shot_prompts` (single-shot first, then bulk).
5. `apply_storyboard_prompt` + `apply_storyboard_prompts_bulk`.
6. `apply_concept`.
7. `apply_script` — needs the atomic RPC; do this last because it's the most involved.
8. Deprecation step 1 for R25 transitional tools (description update + audit metadata).
9. Update the `lahari-director` skill with a "Writing Content for Apply Tools" section that points at the right shard for each tool and teaches the retry-on-validation-error loop.

## Skill Integration

The `lahari-director` skill should add a short section pointing at which shard to read when calling each apply tool:

| Apply tool | Shard to load |
|---|---|
| `apply_concept` | `lahari-director` taste checks (concept questions still live here, since they're cross-cutting) |
| `apply_script` | `script-doctor` |
| `apply_shot_prompts` | `script-doctor` + `continuity-auditor` |
| `apply_storyboard_prompt(_bulk)` | `storyboard-prompt-craft` |
| `apply_video_prompt` | `storyboard-prompt-craft` (motion prompts share the rubric) |

The skill should also teach the **retry-on-validation-error loop** explicitly:

> When an apply tool returns `error: validation_failed`, the tool's `message` and `field` tell you exactly what to fix. Compress, simplify, or correct as instructed. Retry with the same baseHash. Do not pass `force: true` to skip validation.

## Open Questions

1. **Should `apply_shot_prompts` accept a single shot shape too, not just an array?** Convenience for single-shot edits. Either: keep array-only (Codex always wraps in `[{...}]`) or expose two tools (single + bulk). Recommendation: array-only — fewer tools in the MCP surface, Codex wraps trivially.

2. **Should `apply_script` always use an atomic RPC, or accept partial updates?** Partial would let Codex edit one scene without rebuilding the whole script. Schema is harder; constraint checking is harder. Recommendation: atomic-only for R28 phase 1; partial-script-edit is a future R# if demand emerges.

3. **Should the deprecated R25 tools alias to the new apply tools internally?** I.e., `write_storyboard_prompt` calls `apply_storyboard_prompt` with backend-generated content? Adds complexity. Recommendation: no — keep them as separate code paths (the deprecated tools wrap the existing backend LLM call; the new tools take Codex content). Code duplication is fine for a transitional surface.

4. **Should drift detection be optional from day one (omit `baseHash` to skip the check)?** Currently the spec says `baseHash` is optional and only checked when provided. This means Codex can apply blind if it doesn't have the hash. Pro: flexible. Con: silent overwrites possible. Recommendation: keep optional for now; skill teaches "always pass baseHash from the most recent read."

5. **Should events bundle bulk applies or per-shot?** Bulk is simpler to read in the journal ("Codex applied prompts to 12 shots") but loses per-shot granularity. Per-shot matches existing patterns (web studio events are per-shot). Recommendation: per-shot, matches existing journal shape.

## Cross-References

- Doctrine §4 (harness-native vs tool call): the framing this design implements
- Doctrine §5 (permission model): drift detection / validation as the safety layer
- R29 design (`docs/r29-project-config-design.md`): complementary — R29 stores recipes, R28 applies content
- R29 audit (`docs/r29-prompt-override-audit.md`): which prompts move to R28 vs R29 vs stay engine
- Skill shards: `storyboard-prompt-craft`, `script-doctor`, `continuity-auditor` — the rubrics that shape content quality
- R25 commit `e9accaf`: the transitional tools this design deprecates
