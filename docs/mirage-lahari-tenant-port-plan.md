# Lahari → Mirage Tenant Port Plan

**Date:** 2026-06-12
**Status:** 📌 PINNED — design locked enough to execute; start after the current issue-fixing
round settles. C2-lite (Phase 1) can start any time; nothing in it touches live Lahari.
**Owner:** Saul (calls) + agents (execution)
**Executes:** convergence ledger L1 — Lahari converges *in* as tenant #1. One machine, one
standard, no divergence; every Mirage improvement reaches Lahari artists, and Lahari artists
doing better work on the new machine is the Saregama selling point.

Related: `mirage-convergence-ledger.md` (C2/C4/C5 tracks, forks F1–F5),
`lahari-divergence-audit.md` (code-commit ports — mostly done),
`lahari-taste-harvest-audit.md` (taste/content backlog + Saul's 2026-06-12 dispositions).

## Ground truth (schema/infra diff, verified 2026-06-12)

What makes this EASIER than feared:
- **Storage paths are portable.** Both sides store bucket-relative keys (`server/storage.ts`
  `saveBuffer()` returns `category/filename`; `storageUrl()` prefixes at read time). Copy rows +
  copy bucket files with the same keys and nothing breaks. No URL rewriting.
- **IDs copy verbatim.** All project/scene/shot/asset IDs are app-generated UUIDv4 text PKs on
  both sides. No renumbering, no collision risk.
- **Renderer is shared already.** Both deployments point at the same Remotion renderer via
  `REMOTION_RENDERER_URL` + `RENDERER_SHARED_SECRET`. Zero renderer work.
- **No same-name/different-meaning columns detected.** The drift is additive on both sides.

What makes it REAL work:
- **Two auth pools.** Lahari's Supabase auth users ≠ Mirage's. Every `user_id`-bearing row needs
  remapping through an explicit old→new mapping table. Affected lahari tables: projects,
  director_events, agent_operations, project_config(.updated_by), project_prompt_overrides
  (.updated_by), song_notes, personas, project_timelines(.updated_by),
  project_timeline_versions(.saved_by). Note `lahari_mcp_call_traces.user_id` is TEXT not uuid
  (token-owner string) — carry as-is, don't remap.
- **The queue surface doesn't exist in Mirage.** `music_video_queue` + `songs` (~1500-row
  catalog) + `lahari_song_notes` + `Dashboard.tsx` + `server/routes/queue.ts` are Lahari-only.
  This is the main C4 feature port.
- **Additive schema gaps to reconcile** (small, enumerated):
  - lahari→studio: `shots.is_extra` (B-roll flag, excluded from auto-seeded timeline),
    `mcp_call_traces` (audit; optional carry), song/queue tables (the port itself).
  - studio-side columns lahari rows lack: `workflow_key`/`preset_key`/`seed_kind`/
    `project_brief`/`source_payload`, `storyboard_provider`, voice fields, `audio_plan`,
    `workflow_mode` — all backfillable with defaults (`workflow_key='music_led'`,
    `seed_kind='audio'`) at copy time. Legacy `music_video` values normalize at read
    boundaries already.
  - Timelines exist on BOTH sides post-fork (different lineages, similar shape) — reconcile
    column-by-column at copy time, not assumed identical.
- **Bucket copy.** `lahari-assets` → `mirage-assets`, preserving keys. One-time storage job
  with a checksum/row-count verification pass.

## Fork calls (decide before Phase 1 schema work)

- **F1 — tenancy key.** Target: one schema (`studio_*`) keyed by `workspace_id`; lahari rows are
  *copied in* during Phase 3, old deployment kept intact as rollback. Dual-prefix-in-one-binary
  is rejected (permanent operational tax). *Recommend: lock this.*
- **F3 — gating.** Capability-based: `workspace.features = ['lahari_queue', ...]`. The queue
  ships as a workspace capability, not an identity hack. *Recommend: lock as ledger suggests.*
- **F4 — membership.** Admin-add / invite-by-email for beta. *Recommend: lock as ledger suggests.*
- **F6 (new) — workspace-level API keys.** D5 says every tenant BYOKs per-user, but Lahari
  artists run on Saul's platform keys today. Resolution order becomes user → workspace → none;
  the Lahari workspace carries Saul's keys, a future Saregama workspace carries theirs. D5's
  principle survives (tenant-owned keys; tenant = workspace). Shapes the key-resolver and
  `tenant_api_keys` schema, so it must be called before C2 lands. *Recommend: yes.*

## Phases

### Phase 1 — C2-lite workspace model `[can start now; no live-data risk]`
`workspaces`, `workspace_members(user_id, workspace_id, role)`, additive `workspace_id` on
projects + personas (+ style presets when the primitive lands), capability flags (F3), personal
default workspace for everyone, workspace-level key resolution (F6). Sidebar already reserved
the workspace-switcher slot (C1, shipped).

### Phase 2 — C4 feature + content ports `[needs Phase 1]`
1. **Queue as workspace capability:** port `songs` + `music_video_queue` + `song_notes` tables,
   `queue.ts` routes (workspace-scoped), and a workspace queue view (adapt `Dashboard.tsx` to the
   Mirage shell). Keep `source_queue_id` continuation semantics (existing-project detection).
2. **Style presets as a general workspace primitive** (per taste-audit disposition): workspace-
   scoped curated preset registry, preset image = ground truth; Lahari's four presets imported as
   the first set. Generic feature — every future tenant uses it.
3. **`is_extra` shot flag** + timeline-seed exclusion (queue-era parity for B-roll workflows).
4. **Taste/pack data** per `lahari-taste-harvest-audit.md` dispositions: generic items (props
   default rule, continuity/triage skill content, storyboard anti-patterns) into global skills;
   devotional vocabulary + anti-pattern examples into Lahari workspace pack notes.

### Phase 3 — C5 migration rehearsal, then cutover `[needs Phase 2; gated by F5]`
1. **Rehearsal on a copy** (fresh Supabase or staging schema): user mapping table (artists
   pre-provisioned in Mirage auth or JIT on first sign-in), row copy in dependency order
   (projects → scenes → shots → cast/envs → assets → configs → overrides → timelines → queue),
   default backfill for studio-only columns, bucket file copy, checksum + row-count + spot-check
   verification, deep-link/redirect notes.
2. **Cutover:** announced freeze window for the 3 artists; final delta copy; Lahari deployment
   flips read-only (rollback = it's still there, untouched); artists sign in at Mirage, land in
   the Lahari workspace. Domain redirect last.
3. **Decommission** only after N clean weeks.

## Acceptance

A Lahari artist signs into Mirage, lands in the Lahari workspace, sees the queue and their
in-flight projects exactly where they left them, continues a song mid-production (refs, boards,
videos, timeline intact), renders, and ships — behavior parity with today, on the new machine,
with every Mirage capability (agent surface, X-Ray, personas, cancel-safety) now available to
them. Spend flows through workspace keys.

## Non-goals (this plan)

- Saregama onboarding (separate, later; benefits from everything here).
- Public preset marketplace / dynamic skill distribution.
- Self-learning loop (measurement first; separate ledger when beta signal exists).

## Checkpoints

- 2026-06-12 · plan opened · — · grounded in schema/infra diff (storage-portable, UUID-safe,
  shared renderer; auth remap + queue port are the real work). F6 (workspace keys) raised.
  Pinned pending Saul's F1/F3/F4/F6 stamps and the current issue-fixing round.
