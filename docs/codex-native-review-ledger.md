# Codex-Native Review Ledger

**Purpose.** Claude's running architectural review of the codex-native-studio lane, kept in-repo for shared accountability. Separate from Codex's planning docs (`codex-native-studio.md`, `world-class-plan.md`, `learning-loop-plan.md`, `assistant-director-plan.md`). This file is opinion + verification, not plan.

**How to use.** Codex builds; this ledger tracks what's been agreed, what's open, what shipped, what proved right, what got invalidated. Entries are added on every substantive review pass. Status changes are dated.

**Last touched:** 2026-05-13 — Codex implemented FU1-FU4 and render lifecycle events after Claude's review of `789536b`.

---

## Vision Anchor (confirmed)

Lahari should be operable from a polished general-purpose agent harness (Codex Desktop, Claude Code, future ChatGPT desktop), not become a new agent harness itself. The repo is the creative operating system. Codex brings the harness — long threads, worktrees, browser/computer use, skills, MCP, memory. Lahari exposes domain truth as tools, taste as skills, and state as artifacts.

- **Supabase Postgres = source of truth.** Web studio state, `.lahari/` workbench files, Codex in-context understanding are caches.
- **Web studio = visual workstation.** Stays. Do not rebuild it inside Codex.
- **Codex = director/operator surface.** Reads packets, calls typed tools, asks before paid/destructive work.
- **MCP = the bridge.** Vendor-neutral; same server serves Codex Desktop, Claude Code, anything else MCP-aware.
- **Skills = taste.** Tools = primitives that mutate state. Docs = architecture. Three roles, do not blur.

---

## Load-Bearing Principles (agreed)

| # | Principle | Status |
|---|-----------|--------|
| P1 | Supabase is source of truth; `.lahari/` is desk copy. Never dual-write. | shipped in AGENTS/docs |
| P2 | Three-tier permission model: read (free) → preview (paid, no DB write) → apply (DB write, refuses anon key). | agreed, shipped |
| P3 | Drift detection on every apply: validate preview against current DB state before writing. | agreed, partial |
| P4 | Cost, blast radius, and rollback path must be in every plan/apply response. | agreed, partial |
| P5 | Workflows are skills, not tools. Tools provide facts and primitive mutations; composition lives in skills + Codex. | agreed |
| P6 | One Codex session = one song. Many Codex sessions over time can attach to one Lahari director session. | shipped in AGENTS/docs |
| P7 | Web studio is the visual review surface. Codex deep-links into it; we do not build native visual review. | shipped first pass |
| P8 | Tools are small primitives that compose. Codex orchestrates with Linear, Notion, Figma, Slack, browser, etc. | agreed |

---

## Open Recommendations

Status legend: `proposed` (raised, not yet decided) · `agreed` (decided, not yet built) · `shipped` (in code) · `validated` (shipped and proven) · `invalidated` (tried or thought through, abandoned) · `deferred` (correct but not now).

### R1 — Bidirectional journal seam *(highest leverage)*

Status: **shipped first pass** · Raised: 2026-05-13 · Updated: 2026-05-13

Web studio actions (lock shot, reject board, add note, regenerate) must land in a form Codex can read on next session attach. Without this, every Codex session starts cold and the artist's web-studio decisions are invisible.

**Concrete shape shipped:** `lahari_director_events` table. Backend writes structured rows on core artist/Codex decisions: locks, unlocks, prompt edits, clears, reverts, storyboard prompt writes/refines, generations, and Codex preview applies. On session attach, Codex reads events newer than the local cursor and folds them into the journal narrative.

**Follow-ups from review of `789536b`:**

- **FU1 — Tighten error swallowing.** Status: **shipped**. Only missing-table rollout errors are warn-and-continue; other insert/read failures log loudly with projectId/eventType.
- **FU2 — Stop spreading full `result` objects into `payload`.** Status: **shipped**. Generation events now store compact result pointers instead of full response bodies.
- **FU3 — Strictly monotonic cursor.** Status: **shipped**. Added `seq bigserial`; `state.json` stores `lastSeq`; attach reads `seq > lastSeq`.
- **FU4 — Remove 50-event read cap when paginating after a cursor.** Status: **shipped**. After-cursor reads page ascending until exhausted; limit only applies to no-cursor tail reads.

**Coverage gaps to wire next (R1 phase 2):** core concept/style/cast/environment/script/publish/fork/audio-analysis decisions are wired. Project deletion is not durable because event rows cascade with the deleted project. Remaining gaps: explicit artist notes/reject reasons and any later-added workflow endpoints.

**Replay idempotency note:** apply tools currently record a second event on retry. Not blocking now (visible in log), but mandatory before any auto-retry path. Consider uniqueness on `(event_type, payload->>'previewId')` for apply events.

**Why it matters:** Single largest gap between the current architecture and the "Codex inhabits Lahari" vision. Until this exists, the journal is Codex-only memory and accumulated taste leaks out every session.

---

### R2 — Supabase Realtime for web studio sync

Status: **agreed** · Raised: 2026-05-13

Use Supabase Realtime (already in stack) over three layers:
- `postgres_changes` per-project subscription on `lahari_projects`, `lahari_scenes`, `lahari_shots`, `lahari_assets`, `lahari_renders` → Codex applies → web studio updates in <200ms.
- `broadcast` for ephemeral activity ("Codex generating video for shot 4…").
- `presence` for "Codex attached to this session" pill (optional polish).

**Replaces:** current refetch-on-action paths and render-status polling. Costs ~1-2 days. Render polling replacement alone is hours of work and a meaningful win.

**Why it matters:** Makes the same web app the live visual surface for both artist's browser and Codex's browser MCP. Architecture's biggest cheat — one studio, two operators.

---

### R3 — Approval surface needs visual support

Status: **shipped first pass** · Raised: 2026-05-13 · Updated: 2026-05-13

"Approve in chat" is fine for prompt rewrites (markdown diffs read). Useless for "approve this $0.80 video generation." The artist needs to see start frame + style ref + motion prompt next to each other *before* spending.

**Preferred / first pass shipped:** apply/plan/action tools return web studio deep links using `?project=<id>&step=studio&shot=<id>&action=<review-action>`. The web app opens the requested project/step and focuses the containing scene.

**Still open:** exact shot-card anchoring, action-specific review affordances, and browser MCP auto-open behavior.

**Alternative:** preview tools render a self-contained HTML card (image + diff + cost + rollback) Codex displays inline. Acceptable for low-stakes previews.

**Why it matters:** Without this, the approval flow becomes either rubber-stamping or context-switching to the browser manually. Both kill the v1 UX.

---

### R4 — Rollback as a first-class tool

Status: **shipped first pass** · Raised: 2026-05-13 · Updated: 2026-05-13

Every preview already contains a `before` snapshot. Add `rollback_last_apply` / `restore_from_preview` that reverses the named apply using that snapshot. Without it, "rollback path" in plan responses is theatre.

**Shipped first pass:** rollback commands/tools exist for shot prompt previews, storyboard prompt previews, and new script previews. Each validates current state against the preview `after` state before restoring the `before` snapshot and records a durable rollback event. Older script previews without rollback snapshots are refused.

**RB-FU1 shipped:** script rollback now restores through the `lahari_rollback_script_preview` Postgres RPC, so deleting/reinserting cast, environments, scenes, shots, and project prompt metadata happens atomically once the migration is applied.

**Why it matters:** Lowers the bar for authorizing applies. Once one-click rollback exists, "yes apply" becomes a much smaller decision.

---

### R5 — Previews should be Supabase rows, not local files

Status: **partial** · Raised: 2026-05-13

`previewJsonPath` works for one operator on one machine. Breaks for Codex Cloud, second operators, multi-machine sessions. Move previews to a `lahari_previews` table with the JSON body; apply tools take a preview ID.

**Why it matters:** The local-file approach is silently capping future deployment shapes. Cheap to migrate now, expensive later.

**Caveat:** local file artifact can still be written as a side-effect for human inspection. The ID is source of truth.

---

### R6 — Split `codexStudio.ts` before M3 grows it further

Status: **partial** · Raised: 2026-05-13 · Updated: 2026-05-13

File is at 2,564 lines and about to add lock/compare/rollback/critique/style-gen/character-gen. Same shape as the `generate.ts` breakup last month: `packets/`, `sheets/`, `sessions/`, `previews/`, `applies/`, `plans/`. Each apply lives in ~200 lines with its before/after schema co-located.

**Why it matters:** Drift validation is load-bearing and gets easier to keep correct when each apply file owns its own field-level diff logic.

---

### R7 — Critique tools should be skills, not LLM-wrappers

Status: **proposed** · Raised: 2026-05-13

The doc lists `critique_concepts`, `critique_shot_sequence`, `critique_style_refs` as future MCP tools. If they're just "call Claude with rubric," they belong as skills, not tools. Tools should provide *facts the model can't derive itself*: contact-sheet renders, prompt-length stats, prompt diffs, which shots share characters, visual similarity scores. Then the `lahari-director` skill (read by Codex) does the actual critique.

**Why it matters:** Avoids tool-surface bloat with primitives that don't earn their slot, and keeps the skill/tool boundary honest.

---

### R8 — `lahari-director` skill should fragment

Status: **proposed** · Raised: 2026-05-13

One mega-skill is fine for v1 but the real architecture is taste shards loaded contextually: `script-doctor`, `storyboard-prompt-craft`, `style-ref-critic`, `continuity-auditor`, `render-triage`. Skills can be triggered by task; small skills load on demand and stay sharp.

**Why it matters:** A mega-skill is read every session whether relevant or not. Fragmented skills are a way to grow taste without growing prompt overhead.

---

### R9 — Be ruthless about MCP tool count

Status: **proposed** · Raised: 2026-05-13

21 tools today. With lock/unlock, compare, fork, publish, mark-stale, critique-\*, generate-style, generate-character, generate-look, rollback still coming, the natural trajectory is 40-60. Tool-selection accuracy drops fast past ~30. Collapse aggressively in the MCP surface:
- One `apply_preview` dispatching on `kind` instead of three apply tools per kind.
- One `plan_generate` dispatching on target instead of `plan_generate_storyboard` + `plan_generate_video` + future variants.

CLI stays verb-rich; MCP stays tight.

**Why it matters:** Codex's tool-picking degrades with surface size. Discipline now is cheaper than refactor later.

---

### R10 — Second-user setup is the gate to plugin distribution

Status: **proposed** · Raised: 2026-05-13

For the second operator (or even Saul on a new machine), today's setup is: install Codex, clone repo, npm install, paste 8 env keys, register MCP, possibly fix Supabase service key. 30 minutes of devops, half fails silently.

Pre-plugin: a `lahari setup` (or `npm run lahari -- setup`) command that handles env validation, Supabase round-trip check, MCP server registration write-out, worktree placement. That command is the bridge between "internal Saul-only tool" and "internal team tool" — and must exist before plugin packaging is a real conversation.

**Plugin gates** (not timing):
1. Second-user setup is one command.
2. MCP surface stable, no breaking changes weekly.
3. At least one non-Saul operator has run Blueprint → Studio → Render end-to-end.

---

### R11 — Long-running ops need out-of-chat notification

Status: **proposed** · Raised: 2026-05-13

Video gens: 60-90s. Renders: minutes. The artist will context-switch and forget. v1 minimum: apply tools return "this will take ~N seconds, I'll show you when done" and Codex auto-checks. Better: a `notify_when_done` primitive that lands a desktop push, email, or Codex push when an async job completes.

**Why it matters:** Without this, the artist sits and waits, killing the "Codex orchestrates while I do other things" promise.

---

### R12 — Session-bind UX (title + attach + journal read)

Status: **shipped** · Raised: 2026-05-13 · Updated: 2026-05-13

A new Codex session should:
1. Identify director vs engine session.
2. Ask the artist which song (or list recent in-progress projects).
3. Call `attach_director_session <projectId>`.
4. Read `recentEvents` and `diagnosis` from the response.
5. Suggest renaming the Codex session title to the song name.
6. Open with a production-language summary (no "hydrate" / "workbench" / "packet" / "checkpoint").

**Shipped:**
- Tool-side: `attach_director_session` returns suggested session title, opening phrase, web studio link, and the event sync block.
- Skill-side: `lahari-director` skill now has an explicit "Session Start" section teaching the director-vs-engine distinction, the opening move sequence, the words to avoid, and resume-vs-new-session default.

**Still open (small):** automated session-title rename via Codex's harness API if/when one exists. Today it's a nudge to the artist.

---

### R13 — Director sessions vs engine sessions distinction

Status: **shipped** · Raised: 2026-05-13 · Updated: 2026-05-13

One-line addition to `AGENTS.md`: "Sessions in this workspace are either *director sessions* (operating Lahari for a song; attach to a project on first tool call) or *engine sessions* (improving Lahari itself; do not attach, may use worktrees)."

**Why it matters:** As the workspace fills up, engine sessions accidentally tripping director-session instructions (and vice versa) becomes a real bug class.

---

### R14 — Promote "Supabase is truth, `.lahari/` is desk copy"

Status: **shipped** · Raised: 2026-05-13 · Updated: 2026-05-13

Currently a paragraph in `codex-native-studio.md`. Should be the first line of `AGENTS.md`. Every drift bug, every "is this state real or stale," every hand-edit confusion traces back to forgetting this.

---

### R15 — "Hydrate project X" leaks engineering vocab

Status: **shipped first pass** · Raised: 2026-05-13 · Updated: 2026-05-13

The skill should teach Codex that when the artist names a song or asks "what's going on with X," the right opening move is attach + hydrate + diagnose + report — not "let me hydrate the project first." The artist should never learn the word "hydrate."

**Shipped so far:** AGENTS/docs/tool descriptions now frame `attach_director_session` as "open/attach" and keep hydrate as an internal primitive.

---

## Discipline — Things NOT to Build

Easy to drift on these once gaps appear in Codex's harness. The temptation to plug them with Lahari-side workarounds is the architecture's biggest risk.

- ❌ No Lahari TUI.
- ❌ No Lahari chat surface.
- ❌ No Lahari "agent runner" that operates without Codex/Claude in front.
- ❌ No custom permission/approval UI — let the harness handle it.
- ❌ No native visual review tools — deep-link to the web studio.
- ❌ No critique tools that are just LLM-with-rubric — that's a skill.
- ❌ No workflow tools (`review_scene`, `pre_lock_audit`, `final_checklist`) — those are skill compositions over primitives.

When a gap shows up in Codex/Claude Code: file it upstream, route around it with browser MCP or downloadable HTML, do not build a vertical workaround.

---

## Risks / Watch List

Things I might be wrong about. Worth revisiting as we learn.

- **W1. INVALIDATED 2026-05-13.** Tried the structured events table (`lahari_director_events` in `789536b`) directly without first exploring the "just query DB updates" approach. The structured-event approach was clearly correct: it captures *intent* (locked vs cleared vs reverted) which raw row diffs can't recover, gives clean source attribution (web vs codex vs system), and gives the journal a clean ingestion shape. Don't relitigate.
- **W2.** MCP tool-count ceiling is a heuristic, not measured. If Codex's tool-selection holds up to 40+ tools in practice, R9 is over-engineered.
- **W3.** Realtime might be overkill if artists work asynchronously and never have web studio open while Codex is acting. Polling-on-tab-focus could be enough. Watch the actual usage pattern.
- **W4.** "One Codex session = one song" assumes long sessions. If sessions get fragmented (Codex's session UX nudges restart), Lahari director sessions in `.lahari/sessions/` should carry the weight and Codex sessions become disposable. Architecture supports this — just don't optimize Codex-session continuity prematurely.
- **W5.** The plugin distribution timing question is downstream of all of this. Don't relitigate until R10's gates are concrete and met.

---

## Verification Log

Dated entries as recommendations move through status. Append-only.

- 2026-05-13 — Ledger created. R1-R15 raised. P1-P8 stated. Surface as of commit `a6332e9` (M1 + M2 shipped, M3 partial).
- 2026-05-13 — Codex shipped R3 first pass in `e0616a8` (deep-link routing through `App.tsx` + `codexStudio.ts` URL construction). Status: `shipped first pass`. Watch item: shot-card-level anchoring still pending.
- 2026-05-13 — Codex shipped R1 first pass in `789536b` (durable event journal). Schema and rollout strategy are correct. Verification: build green (tsc + git diff --check + vite build). Follow-ups FU1-FU4 captured under R1; coverage gaps listed (concept/style/cast/env/render not yet wired). **W1 invalidated** — structured events table was the right call, raw-row-diff approach abandoned.
- 2026-05-13 — Codex updated P1/P6/P7 statuses to "shipped in AGENTS/docs" / "shipped first pass" in this ledger between commits. Verified against actual code; updates are accurate.
- 2026-05-13 — Codex implemented FU1-FU4 from Claude's review plus render lifecycle events. Event cursor is now `seq`, payloads are compact pointers, after-cursor reads page until exhausted, non-table-missing event failures log loudly, and render start/fail/complete writes durable events.
- 2026-05-13 — Claude reviewed `d8342eb` (Harden director event journal). All four FU items verified against code. `isMissingTableError` covers both Postgres `42P01` and Supabase REST `PGRST205`. `eventResultPointers` whitelist is the right shape (additive new generator fields can't leak). Render events cover all four failure modes. Build green. **Operational note:** the two migrations must be applied in order (`add_director_events.sql` → `harden_director_events.sql`); worth bundling as a single apply step. R1 follow-ups (FU1-FU4) now `validated`. Coverage gaps and replay idempotency remain `open` under R1.
- 2026-05-13 — Claude shipped R12 skill-side (Session Start section in `.agents/skills/lahari-director/SKILL.md`): director-vs-engine session split, explicit opening move sequence after `attach_director_session`, banned vocab list ("hydrate," "workbench," "packet," "checkpoint"), resume-vs-new-session default. Tool-side already shipped by Codex.
- 2026-05-13 — **Migrations applied to Supabase** (`2026-05-13_add_director_events.sql` + `2026-05-13_harden_director_events.sql` in one tab). RLS enabled with `owner reads own project events` SELECT policy joining to `lahari_projects.user_id`; writes remain service-role-only via backend. Event journal seam is now live end-to-end. Forward-compatible with R2 (Realtime subscriptions) and R16 (browser-bridged auth).
- 2026-05-13 — Codex wired R1 phase 2 event coverage for concept/style/cast/environment/script/publish/fork/audio-analysis decisions and shipped R4 first pass rollback tools for preview applies. Remaining event-memory gap is explicit artist notes/reject reasons, not the normal mutation routes.
- 2026-05-13 — Claude reviewed `231483a` (Complete director events + preview rollback). R1 phase 2 verified — 30+ new event types across concept/style/cast/env/script/project domains. Coverage is comprehensive; only intentional gap is project deletion (event rows cascade-delete with the project — design choice). R4 rollback pattern verified: fingerprint drift check refuses on mismatch, `hasDownstreamVisualWork` guards script rollback against destroying visual work, snapshot restore from preview `before`, durable rollback event. Build green. **One follow-up flagged: RB-FU1 — wrap script rollback in a Postgres transaction.** Current implementation is sequential `delete`+`insert` with no atomicity; partial failure leaves the project in a half-restored state. Not blocking smoke testing on fork projects but must be atomic before script rollback runs on anything load-bearing.
- 2026-05-13 — Codex implemented RB-FU1. Script rollback now calls `lahari_rollback_script_preview` through `rpcVoid`; the migration restores project script rows inside one Postgres transaction. Service-side preview ownership, downstream-work, and after-state drift checks still run before the RPC. Requires applying `migrations/2026-05-13_atomic_script_rollback.sql` before using script rollback against real projects.
