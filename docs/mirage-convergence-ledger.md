# Mirage Convergence Ledger

**Date opened:** 2026-06-08
**Status:** planning — forks open
**Horizon:** post-v1. The v1 ledger (`mirage-platform-v1-ledger.md`) is finishing the
hosted studio; this ledger is the next horizon and depends on nothing in v1 being undone.

## North Star

**Collapse the two codebases into one. Lahari stops being a separate repo and becomes a
*tenant* inside Mirage.** Mirage stays the general agent-native video studio; everything
lahari-specific (the queue, `songs`, its skills, its model defaults) lives *inside* a
workspace, gated by membership. The dual-repo split was the right phase — it let Mirage find
its general shape without lahari's gravity. Re-converging through tenancy is the mature move
now that the shape is found.

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
- `mirage-platform-v1-ledger.md` — predecessor; same format. v1 must land first.

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

## Non-goals / guardrails

- Do not rebuild Lahari as a special global runtime inside Mirage. If a feature is useful, make
  it a workspace/preset capability; if it is Lahari-only, gate it to the Lahari workspace.
- Do not reintroduce Lahari, Bhakti, devotional, queue, or song assumptions into generic Mirage
  prompts, skills, actions, or UI copy.
- Do not migrate live Lahari data until there is a rehearsal plan with ownership mapping,
  storage mapping, billing/spend handling, deep-link behavior, rollback, and a dry run.
- Do not assume workspace-scoped installed skills exist yet. Until the plugin/runtime supports
  dynamic skill distribution cleanly, preset packs mean server-owned recipes, defaults, assets,
  style notes, prompt overrides, and operator guidance.

## Open forks (need Saul's call before deep planning)

- **F1 — Tenancy key + schema unification.** Target architecture: one codebase wants one data
  model keyed by `workspace_id`, not two `DB_TABLE_PREFIX` schemas (`studio_*` vs `lahari_*`)
  behind one binary. This is not a "yes, implement directly on live data" switch. The first
  deliverable is a migration design/prototype: auth ownership, storage paths, queue/songs,
  billing/spend, project IDs, deep links, rollback, dry run, and cutover.
  *Recommendation: yes to the target; design the migration before moving live Lahari rows.*
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

## Tracks (the phased sequence)

Ordering reflects hard dependencies: sidebar sets the tenancy IA; the workspace model is the
foundation the queue port needs; the timeline decision (F2) gates render power.

### C0 — Reliability render ports `[ready now, no forks]`
Small, safe, ships value immediately. The audit's duplicate-generation guard and single-shot
topology items have already landed. Render cancellation and blind-update hardening have also
landed, including the conditional status guards the audit called out. Remaining C0 work starts
with media/render hardening from `lahari-divergence-audit.md` cluster B:
- `a75ab45` ffmpeg benign-layout eligibility (adapt as a "non-default layout" check, not
  lahari's wholesale delete, so real transforms still force Remotion).
- `a3151bb`/`881cda9` media-library hide/upload endpoints (part of the render-polish story).

### C1 — World-standard sidebar `[ready now]`
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
One deploy, migrate lahari auth/projects, cut over the domain for live artists. The
irreversible, people-touching piece — its own plan, done last and carefully.

### C6 — Render UX polish pass `[after C1, C3]`
The editor is feature-rich already (~3,400 lines across Timeline/Ruler/Playhead/Effects/
Transitions); "patchy, no polish" is chrome/interaction consistency, much of which the sidebar
(C1) fixes for free. *Open input needed: is the patchiness in editor interactions, the
StepRender flow, or visual design?* Scope this once C1/C3 land.

## Dependency sketch

```
C0  (independent, ship now)
C1  (independent, ship now) ──┐
CP  (Yapper Pack v1 — user-scoped, no forks) ──► teaches ──► C2 / generic queue / C4
F1,F3,F4 ─► C2 ───────────────┼─► C4 ─► C5 (cutover)
F2 ─► C3 ─────────────────────┘
C1 + C3 ─► C6 (polish)
```

Sequencing note: CP (Yapper Pack v1) is the recommended next build — it's the lowest-blast-radius
way to prove the persona/preset-pack pattern, and it's unblocked (user-scoped, no forks). The
generic workspace queue follows CP, then C2 re-homes personas under workspaces, then C4 ports
Lahari as a bigger adapter on the same primitive.

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

## References

- Audit + port backlog: `lahari-divergence-audit.md`
- Product shape: `mirage-beta-workspace-preset-packs.md`
- Recipe rails for C4: `mirage-workflow-recipes.md`
- v1 predecessor: `mirage-platform-v1-ledger.md`
