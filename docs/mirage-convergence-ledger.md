# Mirage Convergence Ledger

**Date opened:** 2026-06-08
**Status:** Active planning ledger — Lahari/workspace/tenant convergence
**Horizon:** post-v1. The v1 ledger (`mirage-platform-v1-ledger.md`) is now historical
decision/checkpoint truth; this ledger owns the Lahari-as-tenant horizon and depends on
nothing in v1 being undone.

## North Star

**Collapse the two codebases into one. Lahari stops being a separate repo and becomes a
*tenant* inside Mirage.** Mirage stays the general agent-native video studio; everything
lahari-specific (the queue, `songs`, its skills, its model defaults) lives *inside* a
workspace, gated by membership. The dual-repo split was the right phase — it let Mirage find
its general shape without lahari's gravity. Re-converging through tenancy is the mature move
now that the shape is found.

**Fast read (2026-06-16):**
- Prize: one Mirage codebase; Lahari becomes tenant #1 through workspace/preset-pack primitives.
- Data call (2026-06-21): Lahari already has its own paid Supabase project. Do **not** copy
  its live content into the current Mirage/Sacred database by default. First convergence target
  is one codebase + tenant/workspace routing while Lahari data remains in Lahari's DB; any
  later consolidation is an explicit migration project with rehearsal and rollback.
- Naming note (2026-06-21): product/brand direction is moving from "Mirage" toward **Sacred**.
  Do not do broad code/package/env renames until Saul calls a dedicated rename sweep.
- Already landed from the audit: paid-generation guards, shot topology, render cancel/salvage, artist memory/assets, server-backed timelines, sidebar, media-library uploads.
- Music-video smoke passed; smoke-derived Studio/product work now lives in `docs/mirage-post-smoke-product-ledger.md`.
- Ready next without workspace forks: CP/Yapper/persona acceptance and small reliability/UX hardening.
- Fork-gated work: workspace tenancy, preset-pack scoping, Lahari queue/data cutover, workspace-level provider keys.

**Why it's the prize, not just cleanup:** one binary, no dual maintenance — and every Mirage
improvement (charge-safety guards, agent-native render, MCP surface, the sidebar) flows to
lahari artists for free. The split's whole tax (porting fixes back and forth, this very audit)
disappears.

**This is general multi-tenancy with lahari as customer zero.** Don't build "a lahari
workspace" as a special case — build the workspace/preset-pack primitive (already sketched in
`mirage-beta-workspace-preset-packs.md`) and make lahari the first tenant. A "preset pack" is
the generalized form of "the lahari workflow": default structure + taste + inputs + skills +
recipes + model choices + render defaults.

## Related docs

- `mirage-beta-workspace-preset-packs.md` — product shape (account / workspace / preset pack
  / project). This ledger is its execution plan.
- `lahari-divergence-audit.md` — the port-candidate backlog (render fixes, extra-shot, memory).
  Tracks below pull from it.
- `mirage-platform-v1-ledger.md` — predecessor; same format. v1 has shipped and remains
  decision/checkpoint truth.
- `mirage-post-smoke-product-ledger.md` — smoke-derived Mirage product maturity work
  (payload inspector, durable overrides, shot-scoped reads, timeline/render polish). Referenced
  here because Lahari will inherit it, but tracked separately because it is not convergence work.

## Current landed work

The divergence audit has already produced two concrete Mirage slices. Treat these as closed
when reading the tracks below:

- Duplicate paid-generation prevention landed across artist-triggered paid surfaces
  (`3cbcc25`, `1963f9f`). This closes the "double click / double agent fire / double charge"
  prevention gap the audit surfaced.
- Non-destructive single-shot topology landed as registry actions (`3551cc4`): `add_shot` and
  `delete_shot` let agents insert/remove one shot without rebuilding the whole script graph.
- Render cancellation and late-output salvage landed (`546dbf8`, `72c86ee`, `f2a01e6`):
  local cancel now preserves paid shot/render outputs as recoverable versions, renderer jobs
  receive best-effort cancellation, and terminal writes use conditional status guards.
- Read-only artist memory landed as MCP cockpit tools: `query_artist_memory` searches prior
  projects for reusable taste/format/model clues, and `search_artist_assets` finds old refs,
  storyboards, videos, audio, and style assets by user-scoped project ownership. The important
  boundary is server-side: callers never pass `userId`, and both tools derive ownership from
  `auth.userId`.
- Server-backed render timeline storage landed as the first C3 slice: the editor now has a
  shared project timeline row, immutable save history, local browser drafts, explicit Save to
  promote local to canonical, Restore, and Reset.

## Locked decisions

_(Things we've effectively agreed. Promote forks here as they're called.)_

- **L1 — Lahari converges *in*, not maintained *out*.** No more porting fixes between two
  repos; lahari becomes a tenant. (The reason this whole ledger exists.)
- **L2 — Tenancy is the generalization, not a lahari hack.** Workspace + preset-pack is a
  general primitive; lahari is tenant #1, validating the primitives any future studio reuses.
- **L3 — Lahari data stays in the paid Lahari DB by default.** "Tenant convergence" means one
  product/codebase and a Lahari workspace/preset-pack surface, not an automatic bulk copy of
  live Lahari content into the current Mirage/Sacred database. Copy/consolidate only after a
  separate rehearsed migration with rollback.

## Non-goals / guardrails

- Do not rebuild Lahari as a special global runtime inside Mirage. If a feature is useful, make
  it a workspace/preset capability; if it is Lahari-only, gate it to the Lahari workspace.
- Do not reintroduce Lahari, Bhakti, devotional, queue, or song assumptions into generic Mirage
  prompts, skills, actions, or UI copy.
- Do not migrate or copy live Lahari data into the current Mirage/Sacred database by default.
  Lahari's paid Supabase project remains its source of truth for the first tenant convergence
  shape. Any later data consolidation needs ownership mapping, storage mapping, billing/spend
  handling, deep-link behavior, rollback, and a dry run.
- Do not assume workspace-scoped installed skills exist yet. Until the plugin/runtime supports
  dynamic skill distribution cleanly, preset packs mean server-owned recipes, defaults, assets,
  style notes, prompt overrides, and operator guidance.

## Open forks (need Saul's call before deep planning)

- **F1 — Tenancy key + data-home strategy.** Target architecture is one codebase/product
  surface with workspace/preset-pack tenancy. Lahari's first data home remains the existing
  paid Lahari Supabase project, not the current Mirage/Sacred DB. The first deliverable is a
  design/prototype for routing a Lahari workspace to Lahari-owned data while keeping generic
  projects on the studio data home: auth ownership, storage paths, queue/songs, billing/spend,
  project IDs, deep links, rollback, dry run, and cutover.
  *Recommendation: converge code/product first; treat physical DB consolidation as a later
  explicit migration, not the default tenant-onboarding path.*
- **F2 — Server-canonical timeline.** Mirage's timeline lives in browser localStorage
  (`components/timeline-editor/persistence.ts`), so an agent literally cannot see or edit it —
  a hole in the agent-native story. Adopt the server-canonical timeline (storage + history +
  realtime, from the audit's cluster B) so the agent can edit it, it survives devices, and
  edits are recoverable? *Recommendation: yes. This is the line between "render fixes" and
  "render gets powerful."*
- **F3 — Gating model.** Capability-based (`workspace.features = ['lahari_queue', ...]`,
  seed only lahari now) vs. identity-based (membership in the lahari workspace unlocks lahari
  features). *Recommendation: capability-based — same effort now, future-proof.*
- **F4 — Membership / invite flow.** Admin-add vs invite-by-email vs join-code.
  *Recommendation for beta: invite-by-email / admin-add.*
- **F5 — Deploy / domain cutover.** Lahari has live artists on its own Railway + URL. Merging
  means one deploy and a cutover for real users mid-work — the one genuinely ops-risky,
  irreversible piece. Needs its own migration + cutover plan (track C5).
- **F6 — Workspace-level API keys.** D5 (per-user BYOK) meets reality: Lahari artists run on
  Saul's platform keys. Proposed: key resolution user → workspace → none; the Lahari workspace
  carries Saul's keys, future tenant workspaces carry theirs. Must be called before C2 schema
  work. *Recommendation: yes.* (Raised 2026-06-12 in `mirage-lahari-tenant-port-plan.md`.)

## Tracks (the phased sequence)

Ordering reflects hard dependencies: sidebar sets the tenancy IA; the workspace model is the
foundation the queue port needs; the timeline decision (F2) gates render power.

### C0 — Reliability render ports `[closed 2026-06-11]`
Small, safe, ships value immediately. The audit's duplicate-generation guard and single-shot
topology items have already landed. Render cancellation and blind-update hardening have also
landed, including the conditional status guards the audit called out. All C0 items have landed:
- ~~`a75ab45` ffmpeg benign-layout eligibility~~ — landed 2026-06-10 as the planned
  "non-default layout" adapt (benign defaults take the ffmpeg fast path; real transforms
  still force Remotion).
- ~~`a3151bb`/`881cda9` media-library hide/upload endpoints~~ — hide had already landed for
  shot videos; the upload half landed 2026-06-11 (see checkpoint). C0 is closed.

### C1 — World-standard sidebar `[landed — pending visual pass]`
Replace the toggle-drawer `ProjectSidebar.tsx` with a persistent left rail. IA that survives
workspaces: **workspace switcher (slot reserved) › current project + switcher (now) › phase
nav (Blueprint/Studio/Render) › account/settings/profile/BYOK at bottom.** Build
workspace-aware from day one so the shell isn't rebuilt twice. `usePersistedProject` already
maps phases to URL params — presentation change, not a routing rewrite.

### CP — Yapper Pack v1 (preset-pack pilot) `[ready now — no forks]`
The smallest real preset-pack pilot, chosen to *earn* the workspace/queue foundation rather
than guess it. Proves the persona/pack pattern with low blast radius before C2 exists.

**Done when (acceptance):** in a fresh session with zero setup, the artist says *"make a Padma
clip about <topic>"* → the agent loads the saved persona (character ref + voice + style + tone),
applies the Yapper workflow, writes a topic-aware script in that persona's lane, and generates
the clip — **no re-uploading the image, no re-entering the voice id, no re-picking the style.**
Repeat across 5 sessions (any persona × any topic), each a one-liner → clip. The proof is the
*absence of re-setup*, session over session.

**The missing primitive is personas, not more overrides.** A persona is a reusable production
identity: name, character reference asset, voice id, style ref(s), freetext tone/topic-lane
notes, and a default workflow pointer. Build it as a **user-scoped `personas` table now** (same
scoping as the artist-memory tools — this is their write-side counterpart); add `workspace_id`
additively when C2 lands. This keeps the pilot unblocked from forks F1/F3/F4.

**A persona is a project-seed from reusable assets — it rides existing rails.** "Create project
from persona" = seed a `cast_member` with the persona's `reference_asset_id` (shared file path) +
`voiceId`, set style, set preferences, set `workflow_key = yapper`. That's the proven fork
deep-copy-row / share-file pattern; the pipeline downstream is unchanged. New surface is small: a
`personas` CRUD + a `create_project_from_persona` action (MCP + web).

**Layering — persona owns WHO, the workflow/pack owns HOW.** The Yapper recipe owns the shared
production path (native dialogue → voice-change) on the existing workflow-recipe rails. The
persona owns only what differs per identity (character ref, voice id, style ref, tone). A persona
may *override* a recipe knob where one yapper truly diverges, but the recipe is not copied onto
every persona. Override order: pack/recipe default → persona override → project.

**The magic wiring:** the persona's tone notes auto-feed the script writer, so "<persona> clip
about <topic>" → the writer receives `persona.toneNotes + topic` and writes in-lane with no
re-explaining. Small wiring on top of the seed step — it's what makes v1 a win, not a shortcut.

**Out of scope for v1:** no queue/board (select-persona + topic → one clip is enough; the generic
queue comes *after* personas exist, when we know what a queue item must carry). No backstory or
topic taxonomy — tone-lane is freetext.

**Why it precedes C2/C4:** Yapper Pack v1 is the first concrete preset pack (workflow recipe +
persona library + defaults). Validating it user-scoped means C2 later just re-homes personas
under workspaces, and Lahari (C4) becomes a bigger adapter on the same primitive — not a
from-scratch shape. The generic workspace queue is the next foundation after this, informed by
what the Yapper queue-item actually needed to carry.

### C2 — Workspace tenancy model `[needs F1, F3, F4]`
The foundation. `workspaces`, `workspace_members(user_id, workspace_id, role)`, `workspace_id`
on projects (and queue/songs when ported). Everyone gets a personal default workspace →
workspace is always the top tier. Capability-based feature gating (F3). Roles: owner / admin /
member. Schema unification lives here, but the first implementation slice should be the
workspace model plus a migration rehearsal plan/prototype — not a live Lahari move.

### C3 — Server-canonical timeline (agent-native render power) `[started]`
First slice landed: project timelines now have a server current row and recoverable version
history, while browser edits remain local drafts until the artist presses Save. This preserves
the Lahari-proven local-vs-canonical workflow and keeps Mirage's better shotId-keyed
`reconcileSnapshotWithInitialClips`. Remaining C3 work: realtime "new saved version" refresh
signals, explicit agent/API timeline-edit actions, and any richer render/media-library editing
surface needed after artists use the shared timeline.

### C4 — Lahari preset pack `[needs C2]`
Port the lahari workflow in as a gated preset pack: the queue (`music_video_queue` + `songs` +
`Dashboard.tsx`) as a workspace-scoped feature; proven prompt recipes on the **existing**
workflow-recipes rails (`server/resources/workflows/*`, `list_workflows`/
`apply_project_workflow` — built earlier; see `mirage-workflow-recipes.md`); Lahari reference
assets, style notes, prompt overrides, model/provider opinions, and render defaults as
workspace/preset defaults, not global defaults. A Lahari skill pack can become real later if
plugin/runtime support workspace-scoped skill distribution cleanly; do not make that a v1
assumption. "Seamlessly" = behavior-parity with what artists ship on today.

**Skill scoping note:** there are two delivery channels today. The plugin is global, so it
should stay core-only; anything shipped there leaks to every artist. The materialized notebook
is server-driven per project, so after C2 gives the server a workspace/features map, it can
materialize `core + workspace packs` from `server/resources/skills/`. Until then, Lahari
knowledge should live in recipes, prompt overrides, style notes, reference assets, and
workspace defaults — not in globally installed skills.

### C5 — Deploy / domain cutover `[needs C2, C4; gated by F5]`
One product/codebase, cut Lahari artists over carefully. The first target is not "copy all
Lahari content into the Mirage/Sacred DB"; it is "Lahari artists use the converged app against
the Lahari data home with Lahari workspace/preset capabilities." Any future physical DB
consolidation becomes its own separate migration. This is the irreversible, people-touching
piece — its own plan, done last and carefully.

### C6 — Render UX polish pass `[after C1, C3]`
The editor is feature-rich already (~3,400 lines across Timeline/Ruler/Playhead/Effects/
Transitions); "patchy, no polish" is chrome/interaction consistency, much of which the sidebar
(C1) fixes for free. *Open input needed: is the patchiness in editor interactions, the
StepRender flow, or visual design?* Scope this once C1/C3 land.

## Dependency sketch

```
C0  (closed)
C1  (landed, visual pass pending) ──┐
CP  (Yapper Pack v1 — user-scoped, no forks) ──► teaches ──► C2 / generic queue / C4
F1,F3,F4 ─► C2 ───────────────┼─► C4 ─► C5 (cutover)
F2 ─► C3 ─────────────────────┘
C1 + C3 ─► C6 (polish)
```

Sequencing note: CP (Yapper Pack v1) remains the lowest-blast-radius convergence-adjacent
preset-pack pilot. Smoke-derived Studio/product maturity work should proceed from
`docs/mirage-post-smoke-product-ledger.md` and will be inherited by Lahari later, but it should
not crowd this convergence plan. The generic workspace queue follows CP, then C2 re-homes
personas under workspaces, then C4 ports Lahari as a bigger adapter on the same primitive.

## Checkpoints

_(Append as tracks execute. Format: date · track · commit · note.)_

- 2026-06-08 · ledger opened · — · captured from strategy discussion; forks F1–F5 open.
- 2026-06-08 · reliability guard · `3cbcc25` / `1963f9f` · duplicate paid-generation
  prevention landed in Mirage.
- 2026-06-08 · shot topology · `3551cc4` · `add_shot` / `delete_shot` landed as registry-only
  script actions.
- 2026-06-08 · render cancellation · `546dbf8` / `72c86ee` / `f2a01e6` · local cancel preserves
  late paid outputs, renderer jobs get best-effort cancel signals, and shot/render activation
  writes are conditional on current status.
- 2026-06-08 · artist memory · — · added read-only MCP tools for user-scoped project
  memory and cross-project asset search, with plugin/AGENTS guidance so agents can reuse prior
  taste and media without asking the artist to re-explain it. Security review: `userId` is
  server-authoritative, project filters narrow ownership instead of replacing it, and asset
  search scopes through user-owned project IDs. Known limit: asset recall scans the 500 most
  recent owned assets before ranking, so very old assets may need a future indexed search path.
- 2026-06-08 · C3 timeline base · — · added prefixed project timeline tables, current/versions/
  restore/reset endpoints, explicit Save-to-shared behavior, local draft autosave, shared
  version restore, and reset-to-generated-clips. Realtime remote-change notification and
  agent-edit actions remain future C3 work.
- 2026-06-08 · C3 timeline review fix · — · fixed reset-then-save versioning: timeline saves now
  derive the next version from both the current canonical row and immutable history, so Reset can
  keep recoverable versions without causing deterministic version conflicts.
- 2026-06-08 · CP Yapper Pack v1 · first spine · added prefix-mapped user-scoped `personas`
  schema, `list_personas`, `save_persona`, and `create_project_from_persona`. The seed action
  copies owned ref asset rows into the new project while sharing storage files, creates the
  cast member with voice fields, locks the style ref when present, stores topic/persona context
  in `project_brief`/`source_payload`, and applies the saved workflow recipe. Still to prove:
  one live Padma-style run from saved persona → script → audio/video → clip, then repeat across
  5 personas/sessions.
- 2026-06-08 · divergence cleanup · first spine · ported `eb51137` fail-loud empty look batches:
  Gemini character/environment look generation retries once on the alternate Gemini image model
  if 0/N variants return, then throws instead of returning an empty candidate set.
- 2026-06-08 · CP agent guidance · follow-up · taught personas across the agent-facing surfaces:
  hosted MCP instructions/tool descriptions already route `list_personas` →
  `create_project_from_persona`; plugin Mirage skill, notebook `AGENTS.template.md`, and CLI
  `mirage init` template now teach the same "make a <persona> clip about <topic>" move. Bumped
  Mirage CLI to `0.1.11` for the new init template and plugin manifest to `0.1.9` for the new
  skill copy.

- 2026-06-10 · beta-prep hardening · `f9b2130` / `e6e4b75` / `5d81b68` · three pre-onboarding
  slices from the tool audit backlog: durable prefix-mapped `*_issues` table behind
  `mirage_capture_issue` (DB-first, user/source attributed, `GET /api/admin/issues` triage,
  local JSON now dev-fallback only); Seedance storyboard-video prompt hardening against
  ref-frame intrusion + mid-clip style drift (3-5 clip paid smoke still pending); and
  `rename_project` registry action closing the shell-vs-concept title divergence. Apply
  `migrations/2026-06-10_add_issues_table.sql` before deploying.
- 2026-06-10 · beta-prep hardening 2 · `7c7a156` / `dbcf5c1` / `2eedd32` · stretch slices:
  `generate_candidates` ships four per-mode examples with `entityIds[]` made explicit;
  storyboard-mode header lock now locks the storyboard, not the shot (lahari `3d568c2`
  ported with a token bridge into the panel's lock path); ffmpeg fast path accepts benign
  default layout metadata while real transforms still force Remotion (lahari `a75ab45`
  adapted, not blind-ported). C0's render-hardening backlog is now down to the conditional
  media-library endpoints.

- 2026-06-11 · C1 sidebar · `4c0f2b2` · persistent left rail landed: workspace identity slot
  (static `WorkspaceSlot`, swap-in point for the C2 switcher), always-visible project tree with
  the existing fork hierarchy/rename/delete/renders actions, Blueprint/Studio/Render phase nav
  with header-parity gating, account/Prompts/BYOK/sign-out at bottom. Header lost its center
  pipeline nav + account cluster; narrow viewports get the same rail as an overlay drawer.
  Saul's visual pass pending.
- 2026-06-11 · C0 closed · `810b493` · media-library uploads ported (lahari `881cda9`
  adapted): `GET/POST /api/projects/:id/media-library/uploads` + `:assetId/hide` behind the
  projects ownership guard, asset category `media_library_video`, soft-hide via metadata flag;
  drawer gains an Uploads row, Upload clip button, and emerald in-timeline/added indicators;
  Render button now gates on the timeline containing a visual clip and the editor mounts even
  with zero generated shots. Hides are events-attributed. C0's audit backlog is now empty.

- 2026-06-10 · C4 prep + visual audit · `44554eb` · X-Ray panel is now shot-anchored and
  filmmaker-readable (layer cards per composed-prompt section, source-labeled, human stage
  names; per-shot scope via output-asset linkage) — first slice of the visual audit surface.
  Opened `lahari-taste-harvest-audit.md`: content-level diff of Lahari skills/prompts/presets
  vs Mirage, ranked harvest backlog for the C4 taste port (~70% preservable; key finds:
  song-type pacing math, 4 curated style presets, props-in-hand rule living in prompt code).

- 2026-06-12 · port plan pinned · — · opened `mirage-lahari-tenant-port-plan.md`: the C2→C4→C5
  execution plan for Lahari as tenant #1, grounded in a verified schema/infra diff (storage paths
  portable, UUIDs copy-safe, renderer shared; real work = auth user-id remap + queue port +
  additive column backfill). New fork F6 (workspace-level keys) raised. Taste harvest dispositions
  revised per Saul: props ban → generic rule, pacing doctrine → agent judgment, style presets →
  general workspace primitive.
- 2026-06-16 · music-video smoke · `ee873d2` / `9cbb700` · Lingashtakam/Suprabhatam smoke proved
  the end-to-end music-video loop is usable and that prompt/payload auditing materially improves
  creative output. Follow-up product work moved to `docs/mirage-post-smoke-product-ledger.md`
  so this ledger stays focused on Lahari/workspace/tenant convergence. The same smoke surfaced a
  render storage-size cap on the free Mirage Supabase project; long final renders need
  higher-cap storage or an explicit preview-compression policy.
- 2026-06-21 · data-home call · — · Saul clarified Lahari already has its own paid Supabase
  project; convergence should not copy Lahari live content into the current Mirage/Sacred DB by
  default. Updated L3/F1/C5: one codebase/product first, Lahari data home retained first,
  physical DB consolidation only as a later explicit migration. Also captured the brand note:
  product direction is moving from Mirage toward Sacred, but broad rename is deferred.

## References

- Audit + port backlog: `lahari-divergence-audit.md`
- Taste harvest backlog for C4: `lahari-taste-harvest-audit.md`
- Tenant port execution plan (C2/C4/C5): `mirage-lahari-tenant-port-plan.md`
- Product shape: `mirage-beta-workspace-preset-packs.md`
- Recipe rails for C4: `mirage-workflow-recipes.md`
- Post-smoke Mirage product maturity: `mirage-post-smoke-product-ledger.md`
- v1 predecessor: `mirage-platform-v1-ledger.md`
