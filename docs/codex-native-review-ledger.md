# Codex-Native Review Ledger

**Purpose.** Status tracking for the codex-native-studio lane: what's been proposed, shipped, validated, or invalidated. Append-only verification log.

**Operating principles and architecture rules live in `docs/codex-native-doctrine.md`** — read that for "how the system works." This file is the dated record of decisions and their fates.

**How to use.** Each substantive change opens or updates an R# entry. When a recommendation moves from `proposed` to `shipped` to `validated`, that's a verification log append. Don't restate doctrine here — link to the relevant doctrine section.

**Last touched:** 2026-05-18 — R42 notebook sync CLI published; deploy pending Railway outage recovery.

---

## Current State (snapshot for fast orient — read this first)

**Architecture status (as of 2026-05-18):**

R17 + R28 + R29 are all shipped to production and validated by the first artist. The artist-facing distribution is **real** — remote MCP is live, artists mint tokens at `/connect`, install snippets work on Codex Desktop and Claude Code, `npx @ssaulgoodman420/lahari-cli sync` is the preferred large-notebook materialization path, `write_project_notebook` remains the pure-MCP fallback, and realtime presence shows agent activity in the web studio. This is the moment R17 was building toward, and it's here.

**Shipped and live in production:**

- **R17** — Remote MCP at `/mcp` with bearer-token auth, `/connect` page for token minting + install snippets, `lahari_mcp_tokens` table with sha256-hashed storage, and a local `@lahari/mcp-server` fallback package implemented in-repo (publish pending if needed). **Validated by first artist install.**
- **R28** — Six apply-only text tools: concept, script, shot_prompts, storyboard_prompt + bulk, video_prompt. Codex writes content via skill shards, apply tools validate + persist with drift checking. Migration applied.
- **R29** — Project config + prompt overrides through phase 2. All 5 prompt kinds (concept, script, shot_prompts, storyboard, video) overridable per project. Migration applied.
- **R35/R42** — Notebook layout + sync. Preferred: MCP `mint_cli_token` then `npx @ssaulgoodman420/lahari-cli sync <projectId>` writes notebooks directly with idempotent hash/conflict handling. Fallback: `write_project_notebook` returns file payloads. Layout: `mirrors/` read-only snapshots, `drafts/` editable working copies, `config/` project overrides, `journal.md` local memory. `drafts/script.md` applies through `apply_script_markdown`; `drafts/storyboards/<scene>.md` applies through `apply_storyboard_scene_markdown`. Skills served from `server/resources/skills/`. Package `@ssaulgoodman420/lahari-cli@0.1.0` is published to npm.
- **R36** — Realtime agent operation presence. `lahari_agent_operations` table, per-tool start/finish tracking, Supabase realtime subscription in web studio, "Codex is working" pill in header. Migration applied.
- **Security hardening** — In-memory rate limiting (per user, per tool category), body size limits, Zod max sizes on payloads, audit redaction of prompt/script/concept content, `lahari_capture_issue` requires project ownership.
- **Skills** — Six shards (lahari-director orchestrator + storyboard-prompt-craft / script-doctor / continuity-auditor / style-ref-critic / render-triage) bundled at `server/resources/skills/`, ship in deploy artifact, materialized into artist workspace by notebook sync or `write_project_notebook` fallback.
- **Stabilization F1–F4** — Session rename language softened; song-classification bottleneck demoted; friction-capture trigger imperative; re-attach journal dedup.

**Pending operational:**

All migrations applied and `@ssaulgoodman420/lahari-cli@0.1.0` published. Latest code is pushed to `main`; Railway deploy is pending only because Railway temporarily paused deploys during the 2026-05-18 outage. When Railway recovers, run `railway up --detach` from the main worktree.

**Next workstreams:**

1. **Abstraction platform** (new branch + worktree `lahari-abstraction`). SeedKind / Workflow / Preset decomposition. New Supabase + Railway for `studio_*` schema. Music video + anime as v1 proof. See `docs/abstraction-platform-plan.md`. Brand: **Mirage**, multi-tenant SaaS, single brand for now.
2. **R37** — Per-shot/scene presence indicators on ShotCard (backend supports it; UI hasn't surfaced it yet). Half day. Codex.
3. **R32** — Per-call model override shipped for storyboard/video plan + generation tools. Project defaults stay stable; one-off experiments travel in the call payload.
4. **R39** — Codex-native concept/style ideation shipped for director sessions: `apply_concept` plus new `apply_style_direction`; Studio's backend idea generators remain for civilian UI.
5. **R40** — Character/environment look-generation recipe overrides shipped as project prompt kinds (`character_looks`, `environment_looks`) and consumed by Studio look generation at runtime.
6. **R41** — Per-shot workflow mode shipped (`auto | storyboard | keyframe`) so Codex can force exceptions without changing whole-project defaults.
7. **R42** — Agent-run notebook sync CLI shipped first pass. Migration applied and `@ssaulgoodman420/lahari-cli@0.1.0` published; Railway deploy pending outage recovery.
8. **R33 / R34** — Model-bias correction and apply-only harness-native media remain filed for later. Post-abstraction or post-next-artist-feedback.
9. **Polish items P-poli-01..11** — Address opportunistically when adjacent code is being touched.

**Engineering watch items (not yet ledger entries):**

- `structuredToolError` message-substring matching in director.ts / mcp.ts / mcp-tokens.ts (brittle, works today)
- RLS policies on `lahari_mcp_tokens` (currently service-role-only, fine)
- Rate limiting is in-memory (single-instance only; replace with Cloudflare/Redis when scaling)
- DRY duplication between `/api/director/*` and `/mcp` tool registries (~400 lines mirrored)

---

## Open Recommendations

Status legend: `proposed` (raised, not yet decided) · `agreed` (decided, not yet built) · `shipped` (in code) · `validated` (shipped and proven) · `invalidated` (tried or thought through, abandoned) · `deferred` (correct but not now).

### R1 — Bidirectional journal seam *(highest leverage)*

Status: **shipped first pass** · Raised: 2026-05-13 · Updated: 2026-05-14

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

Status: **partially shipped** · Raised: 2026-05-13

Use Supabase Realtime (already in stack) over three layers:
- `postgres_changes` per-project subscription on `lahari_projects`, `lahari_scenes`, `lahari_shots`, `lahari_assets`, `lahari_renders` → Codex applies → web studio updates in <200ms.
- `broadcast` for ephemeral activity ("Codex generating video for shot 4…").
- `presence` for "Codex attached to this session" pill (optional polish).

**Replaces:** current refetch-on-action paths and render-status polling. Costs ~1-2 days. Render polling replacement alone is hours of work and a meaningful win.

**Why it matters:** Makes the same web app the live visual surface for both artist's browser and Codex's browser MCP. Architecture's biggest cheat — one studio, two operators.

---

### R3 — Approval surface needs visual support

Status: **shipped first pass** · Raised: 2026-05-13 · Updated: 2026-05-14

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

Status: **shipped first pass** · Raised: 2026-05-13 · Updated: 2026-05-13

Original file had grown past 3,600 lines during R25/R29. First-pass split keeps `server/services/codexStudio.ts` as the public barrel used by CLI/MCP, and moves focused code into:
- `server/services/codexStudio/core.ts`
- `server/services/codexStudio/packets.ts`
- `server/services/codexStudio/sheets.ts`
- `server/services/codexStudio/plans.ts`
- `server/services/codexStudio/storyboardOps.ts`

Remaining future split candidates: session/workbench, preview/apply/rollback families, and script preview/apply. Those are more stateful, so they should move after R28 spec lands or when they are next touched.

**Why it matters:** Drift validation is load-bearing and gets easier to keep correct when each apply file owns its own field-level diff logic.

---

### R7 — Critique tools should be skills, not LLM-wrappers

Status: **proposed** · Raised: 2026-05-13

The doc lists `critique_concepts`, `critique_shot_sequence`, `critique_style_refs` as future MCP tools. If they're just "call Claude with rubric," they belong as skills, not tools. Tools should provide *facts the model can't derive itself*: contact-sheet renders, prompt-length stats, prompt diffs, which shots share characters, visual similarity scores. Then the `lahari-director` skill (read by Codex) does the actual critique.

**Why it matters:** Avoids tool-surface bloat with primitives that don't earn their slot, and keeps the skill/tool boundary honest.

---

### R8 — `lahari-director` skill should fragment

Status: **shipped first pass** · Raised: 2026-05-13 · Updated: 2026-05-13

One mega-skill is fine for v1 but the real architecture is taste shards loaded contextually: `script-doctor`, `storyboard-prompt-craft`, `style-ref-critic`, `continuity-auditor`, `render-triage`. Skills can be triggered by task; small skills load on demand and stay sharp.

**Shipped:** `lahari-director` slimmed to orchestrator (session start, permission, output style). Five taste shards created under `.agents/skills/` with focused frontmatter descriptions, concrete heuristics, anti-patterns, and cross-references. `lahari-director` now indexes the shards and instructs on-demand loading by task.

**Why it matters:** A mega-skill is read every session whether relevant or not. Fragmented skills are a way to grow taste without growing prompt overhead. The shards also prep R28: `storyboard-prompt-craft` and `script-doctor` are the rubrics that shape Codex-written content quality when apply-only tools replace LLM-wrappers.

**Follow-up from 2026-05-14 test session:**
- **F3 (shipped):** `lahari_capture_issue` trigger strength. Real friction surfaced in test (session rename failure) but Codex didn't auto-capture; the issue only surfaced in post-test review. Skill now uses imperative capture language for unexpected tool output, web/tool disagreement, unavailable harness actions, and repeated operator confusion.

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

Status: **shipped first pass** · Raised: 2026-05-13 · Updated: 2026-05-13

For the second operator (or even Saul on a new machine), today's setup is: install Codex, clone repo, npm install, paste 8 env keys, register MCP, possibly fix Supabase service key. 30 minutes of devops, half fails silently.

Pre-plugin: a `lahari setup` (or `npm run lahari -- setup`) command that handles env validation, Supabase round-trip check, MCP server registration write-out, worktree placement. That command is the bridge between "internal Saul-only tool" and "internal team tool" — and must exist before plugin packaging is a real conversation.

**Shipped first pass:** `npm run lahari -- setup` validates repo shape, `.env` discovery, required keys, Supabase project access, `lahari_director_events`, and `lahari_rollback_script_preview`, then re-registers the `lahari` MCP server for Codex Desktop and Claude Code. Registration uses `npm --prefix <repo> run lahari:mcp` plus `LAHARI_ENV_FILE=<resolved .env>` so the server starts from either harness without relying on launch cwd. `setup --check` runs validation without rewriting MCP config.

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

### R11A — Director/engine friction capture

Status: **shipped first pass** · Raised: 2026-05-13 · Updated: 2026-05-14

Parallel testing uses two Codex sessions on the same worktree: one director session operating a real song, one engine session fixing what breaks. The handoff needs evidence, not memory.

**Shipped first pass:** every Lahari MCP call writes redacted JSONL start/finish audit rows to `.lahari/audit/<projectId>/<date>-calls.jsonl` or `_unscoped`. CLI command `npm run lahari -- audit tail [projectId|_unscoped] [n]` prints recent entries for engine debugging. MCP tool `lahari_capture_issue` lets the director session write `.lahari/issues/<timestamp>-<severity>.json` with a summary, suggested fix, and recent audit tail.

**2026-05-14 stabilization:** strengthened the director skill trigger so unavailable harness actions, web/tool disagreement, and repeated operator confusion are captured immediately instead of left for later review.

**Why it matters:** Makes real-project testing debuggable. The engine session can see exactly which tool ran, how long it took, what it returned in summary, and what Codex thought was wrong.

---

### R12 — Session-bind UX (title + attach + journal read)

Status: **shipped** · Raised: 2026-05-13 · Updated: 2026-05-14

A new Codex session should:
1. Identify director vs engine session.
2. Ask the artist which song (or list recent in-progress projects).
3. Call `attach_director_session <projectId>`.
4. Read `recentEvents` and `diagnosis` from the response.
5. Tell the artist the suggested Codex session title; they rename manually if useful.
6. Open with a production-language summary (no "hydrate" / "workbench" / "packet" / "checkpoint").

**Shipped:**
- Tool-side: `attach_director_session` returns suggested session title, opening phrase, web studio link, and the event sync block.
- Skill-side: `lahari-director` skill now has an explicit "Session Start" section teaching the director-vs-engine distinction, the opening move sequence, the words to avoid, and resume-vs-new-session default.

**Still open (small):** automated session-title rename via Codex's harness API if/when one exists. Today it's a nudge to the artist.

**2026-05-14 stabilization:** attach now skips repetitive journal entries when there are no new director events and no operator note within the de-dupe window, while still refreshing `state.json`. The opening instructions no longer imply Codex can rename the chat itself.

**Follow-ups from 2026-05-14 test session:**
- **F1 (shipped):** session rename language was too strong — skill said "suggest renaming" which Codex interpreted as a promise it then couldn't deliver. Skill/AGENTS now explicitly say Codex cannot rename the session programmatically here.
- **F4 (shipped):** re-attach journal noise. 11 "session attached" entries appeared in a 2-hour test span, most with no new events between them. Attach now updates `state.json` but skips a new journal block when the previous attach was recent, `newEvents === 0`, and there is no operator note.

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

**2026-05-14 stabilization:** local project markdown now uses `Updated:` instead of `Hydrated:` in brief, audio-analysis, concept-notes, script, and storyboard-prompts files.

---

### R16 — Browser-bridged operator auth

Status: **proposed** · Raised: 2026-05-13

The current MCP server authenticates to Supabase with `SUPABASE_SERVICE_KEY` (bypasses RLS, full write power). That works for solo internal use but doesn't scale to a second operator and doesn't compose with R10's setup flow once an artist is involved.

**Pattern:** `gh auth login` / Vercel CLI / Stripe CLI. The artist signs in to the web studio in Codex's browser MCP once; the MCP grabs the resulting Supabase JWT and uses it for all subsequent tool calls. RLS applies automatically — Codex can only mutate projects the artist owns. Event `userId` is the JWT subject.

Implementation sketch:
- `lahari_login` MCP tool spawns local HTTP receiver on random port
- Tool opens `https://lahari.../auth/cli-bridge?callback=http://localhost:XXXX` in Codex's browser
- Artist signs in via Google OAuth (the existing web flow)
- Bridge page sends access + refresh token to localhost callback
- MCP caches the JWT, refreshes via Supabase refresh-token endpoint on expiry
- All tool calls send `Authorization: Bearer <jwt>` to Lahari backend / Supabase

**Wins:**
- No `SUPABASE_SERVICE_KEY` in the artist's environment — real security improvement
- RLS becomes Codex's authorization boundary
- Operator identity falls out for free (JWT subject)
- Scales to N operators without config change
- Log out in browser → JWT invalidates → Codex stops working. One-click off-switch.
- Pattern transfers to Claude Code unchanged.

**Fallback:** for headless/cron/Codex Cloud cases, env-var operator identity remains (`LAHARI_OPERATOR_EMAIL`). Browser auth is the front door for artist-driven sessions.

**Why it matters:** This is the auth design decision behind R17 (distribution). The npm package can't ship `SUPABASE_SERVICE_KEY` baked in; it has to acquire credentials at runtime. Browser-bridged JWT is how.

---

### R17 — Distribution architecture for non-engine operators

Status: **shipped + validated** · Raised: 2026-05-13 · Updated: 2026-05-15

Engine + director live in one repo today because Saul is the sole operator. When an artist joins — someone who shouldn't see or touch engine code — they can't be handed this repo (overwhelming, destructive ops accessible, exposes engine internals).

**Recommended path: hosted remote MCP.** Artist signs in to Lahari, creates an account-scoped personal MCP token, connects Codex/Claude directly to Lahari's hosted `/mcp` endpoint, and everything after is conversational.

```bash
export LAHARI_MCP_TOKEN=lahari_mcp_...
codex mcp add lahari --url https://lahari.media/mcp --bearer-token-env-var LAHARI_MCP_TOKEN
```

Claude Code uses the same token as an Authorization header. The token maps back to the logged-in Lahari `user_id`; every project-scoped tool still checks `lahari_projects.user_id`. `@lahari/mcp-server` is retained as the local-subprocess fallback for harness bugs and debugging, not as the primary artist path.

**Why remote MCP replaced local bootstrap as primary:** current harnesses support Streamable HTTP MCP with bearer-token auth, and the hosted Director facade is already the durable spine. Remote MCP removes artist-side Node/package/version drift. The earlier npm bootstrap remains a valid fallback and template-distribution helper.

**Design doc:** `docs/r17-distribution-design.md` — updated for remote MCP primary, account-specific token auth, hosted `/mcp`, and local package fallback.

**Dependencies:** deploy + clean non-codebase workspace test.

**Implementation slices shipped/started:**
- Hosted Director API facade under `/api/director/*`: exposes the director surface as authenticated HTTP routes instead of local service imports. User-scoped through existing JWT `requireAuth`, `{ ok, data, error }` envelopes, audit source `mcp-remote`.
- Local fallback package `@lahari/mcp-server`: thin stdio MCP client over `/api/director/*`.
- Personal MCP token layer: `lahari_mcp_tokens` stores token hashes; `/api/mcp-tokens` mints/lists/revokes tokens for logged-in users.
- Hosted `/mcp`: stateless Streamable HTTP MCP endpoint authenticated by `Authorization: Bearer lahari_mcp_...`.
- `/connect`: first-pass authenticated web page that mints tokens and shows Codex/Claude install snippets.
- `write_project_notebook`: MCP-born workspace scaffolding. The tool returns deterministic file payloads (`AGENTS.md`, `CLAUDE.md`, project-local Codex/Claude skills, mirrors, config, journal) and the agent writes them into any empty folder with harness file tools.
- Project-local skills: `write_project_notebook` now emits `.agents/skills/*` for Codex and `.claude/skills/*` for Claude Code, sourced from the Lahari skill shards. The artist should restart/open a fresh session in the folder after first write so native skill discovery can pick them up.
- Tool annotations: hosted, fallback, and internal MCP tools declare read-only/mutating/destructive/idempotent/open-world hints so harnesses can reason about approval surfaces before tool use.
- `changedArtifacts`: apply/generation/config tools now return affected notebook files so the agent can refresh only the changed mirrors/config instead of re-running the full notebook on every mutation.

First-pass route coverage: version, project list/packet/actions, remote session attach/get, shot packet, storyboard status, R28 apply-only tools, R29 project config apply/revert tools, storyboard/video generation plans, storyboard generation/bulk generation/refine/lock/unlock, video generation, and issue capture.

**Still needed:** deploy + clean non-codebase workspace test; optional later plugin/resource distribution once the project-local skill path is proven.

**Why it matters:** Resolves the "give the artist this repo" question without compromising engine separation. The director surface becomes extractable as a separate distribution without engine dependencies at runtime — closes R10's plugin-distribution gate.

---

### R18 — Director sessions should be MCP-first, CLI-second

Status: **shipped first pass** · Raised: 2026-05-13

The first real director test exposed an important boundary: Lahari MCP was registered, but the active Codex chat did not expose the `mcp__lahari...` namespace, so the director session used local CLI/service calls. The work succeeded, but it bypassed the MCP audit layer and made `.lahari/audit/<projectId>/` empty.

**Decision:** director sessions should be MCP-first. CLI remains first-class engine infrastructure, but not the default artist-operation lane.

Use MCP in director mode for project reads, attach/session state, previews, applies, rollback, generation plans, issue capture, and any future structured mutation tools. Use CLI for setup, diagnostics, audit tailing, smoke tests, migrations, provider doctor checks, engine debugging, or when no MCP tool exists yet.

**Follow-ups:**
- Shipped: `AGENTS.md` and `lahari-director` skill now require an active-chat Lahari MCP visibility check before `attach_director_session`; director sessions must stop and ask for Codex restart/fresh session instead of falling back to CLI.
- Shipped: CLI calls now write `.lahari/audit/<projectId>/<date>-calls.jsonl` with `source: "cli"` start/finish rows, so escaped/direct CLI calls leave a footprint.
- Still open: add a dedicated `mcp doctor` command if Codex exposes a reliable active-tool introspection path. For now, active visibility is a manual chat-surface check.

**Why it matters:** "Freedom" here silently routed around observability. The system needs discipline, plus fallback logging when discipline fails.

---

### R19 — MCP registration is not the same as active tool availability

Status: **shipped first pass** · Raised: 2026-05-13

Observed during director test: `codex mcp list` showed `lahari` registered and enabled, but the running Codex chat did not expose the Lahari namespace as callable tools. The correct explanation is not "MCP is unavailable"; it is "registered locally, but this session did not load the namespace."

**Follow-ups:**
- Shipped: setup output now explicitly tells the operator to quit/reopen Codex Desktop after registration, and says director sessions should not fall back to CLI if native Lahari MCP tools are not visible.
- Shipped: `AGENTS.md` and the skill distinguish registered-on-disk from active-in-this-chat availability through the mandatory visibility check.
- Still open: active-tool introspection remains manual unless Codex exposes a programmatic API.

**Why it matters:** This is a user-trust bug. If the artist hears "the tool is enabled" but Codex says "I can't call it," the system feels flaky even when the registration is technically correct.

---

### R20 — Out-of-band generation must hydrate Blueprint candidates on load

Status: **shipped** · Raised: 2026-05-13

Observed during director test: Codex generated character and environment candidates out-of-band. The assets existed in the DB (character/environment candidates were present), but the Blueprint UI did not show them because no candidate was locked yet and the frontend mostly relied on UI-local generation state for the candidate grids.

**Fix:** Blueprint should auto-fetch existing character/environment look candidates on load when an entity has candidates but no locked `reference_asset_id`. Candidate grids should be DB-hydrated, not only populated by the current browser action.

**Why it matters:** Codex and web studio are two operators on the same project. Anything Codex creates must become visible in the browser after reload/focus without needing a UI-originated generation action.

---

### R21 — Provider routing drift needs a doctor check

Status: **agreed** · Raised: 2026-05-13

Observed during director test: `nano-banana-2` was expected to use the updated Google Developer API route from `main`, but the `codex-native-studio` worktree was behind and still routed it through Segmind. The director session patched the local routing after comparing against `main`.

**Follow-ups:**
- Add `npm run lahari -- doctor providers` to print image/storyboard/text/video provider routing, runtime model names, and obvious mismatch warnings.
- Include provider routing in setup/check or director attach diagnostics when the selected project uses a non-default model.
- Keep provider routing changes small and cherry-pickable across `main` and `codex-native-studio` until the branch is merged.

**Why it matters:** Provider routing is production behavior, not just code shape. A stale worktree can spend the wrong credits, hit exhausted providers, or produce different creative outputs than the deployed app.

---

### R22 — Project-local prompt catalogs, edited by Codex

Status: **agreed** · Raised: 2026-05-13

The director session should be able to own and tune the prompt recipes for a specific project instead of only calling backend refine APIs. Start every project from the global templates, then let Codex maintain project-local prompt overrides as the song teaches us what works.

**Boundary:** global catalog stays canonical defaults; project catalog is a working copy/override. Do not let one project's taste edits silently mutate `server/prompts/catalog.ts`.

Suggested desk-copy shape:
```text
.lahari/projects/<projectId>/prompts/
  script-writer.md
  storyboard-prompt.md
  video-prompt.md
  style-critic.md
  continuity-auditor.md
```

Production use still needs a typed apply/import path, probably a `lahari_project_prompt_overrides` table keyed by project + prompt kind. `.lahari/` files are editable desk copies; Supabase remains truth for generation behavior.

**V1 scope:** start with storyboard prompt and video prompt overrides. Those are the highest-tax areas and where tiny wording changes most affect output quality. Script prompt ownership can follow once the storyboard/video loop proves itself.

**Why it matters:** The artist and Codex can iteratively make the project smarter without repeatedly asking another API to "refine" when the needed fix is a precise prompt recipe edit.

---

### R23 — Move taste-heavy LLM work into Codex-native editing

Status: **agreed direction** · Raised: 2026-05-13

Longer-term, Lahari should stop building backend LLM endpoints for every taste-heavy language operation. Codex is the better runtime for script writing, storyboard prompt writing, video prompt rewriting, critique, continuity reasoning, and project-specific prompt-catalog tuning because it can use local files, diffs, memory, approvals, and browser context.

Backend/provider tools should stay responsible for things Codex cannot natively do well or safely:
- image generation
- video generation
- audio analysis/transcription
- storage and DB mutations
- render orchestration
- factual project packet reads
- contact sheets / visual asset surfaces

Codex should increasingly own:
- script writing and surgical script edits
- storyboard prompt writing/direct editing
- video prompt writing/direct editing
- critique and continuity checks
- project-local prompt catalog tuning
- deciding when a provider tool should be called

**Guardrail:** language edits still need preview/diff/apply/rollback and durable events when they affect production state. "Codex-native" does not mean silent DB writes.

**Why it matters:** This is the real agent-native abstraction: Lahari exposes truth and provider primitives; Codex carries taste, iteration, and judgment.

---

### R24 — Explore Codex PermissionRequest hooks for Lahari approvals

Status: **proposed** · Raised: 2026-05-13

Question from director testing: can Lahari use Codex permission-request hooks instead of asking for paid/destructive approval only in natural language?

**Current finding:** Codex hooks can observe permission-request events in this local setup; `~/.codex/hooks.json` already wires `PermissionRequest` to the sound notification script. That is useful for attention and external notification. It does not, by itself, create a Lahari approval request. Hooks fire when Codex itself reaches a permission gate; Lahari still needs to model production approvals through tool boundaries.

**Working boundary:**
- Codex execution permissions: shell escalation, risky local commands, harness-level permission gates. These can use Codex's native permission UI and hooks for notifications/possibly policy where supported.
- Lahari production approvals: paid generation, DB writes, lock/unlock, publish, destructive rewrites. These should be typed plan/apply tools with explicit cost/blast-radius/rollback responses. If Codex surfaces a native approval UI for mutating MCP tools/plugins, use it. If not, keep explicit chat approval plus web-studio deep links.

**Do not fake approvals** by forcing Lahari actions through shell escalation just to trigger a Codex permission dialog. That would couple product safety to the wrong subsystem.

**Follow-ups:**
- Keep `PermissionRequest` hook for sound/notification.
- Test whether plugin-packaged Lahari mutating tools produce a native approval moment in Codex Desktop.
- If native approval metadata becomes available for MCP tools, encode Lahari cost/blast-radius/rollback into that approval surface.

**Why it matters:** The approval moment is the product. We want Codex-native permission UX when available, without making Lahari safety depend on fragile natural-language convention or shell-command hacks.

---

### R25 — Complete storyboard lifecycle MCP coverage

Status: **agreed** · Raised: 2026-05-13

The first MCP-path director test exposed the missing primitives around storyboard work. Current MCP can preview/apply a single storyboard prompt rewrite and generate a single storyboard board (`apply_generate_storyboard`), but the director still lacks the full lifecycle needed for efficient shot-by-shot or bulk storyboard work.

**Tools to add:**
- `write_storyboard_prompt` — write saved `storyboard_prompt` + `storyboard_cut_plan` for one shot using the same backend path as the web studio.
- `bulk_write_storyboard_prompts` — write missing/error prompts by default; optional force/rewrite with explicit approval.
- `generate_storyboard` — alias/renamed shape for the current `apply_generate_storyboard` to make the mental model less apply-preview-specific.
- `bulk_generate_storyboards` — generate boards only for shots with saved prompts and no board by default; optional stale/unlocked regeneration when approved.
- `refine_storyboard_image` — wraps backend `refine-storyboard` `edit_image` mode with `projectId`, `shotId`, `feedback`, optional `previousVersionId`, optional reference image.
- `lock_storyboard` / `unlock_storyboard` — let Codex lock good boards after visual review and reopen them when needed.
- `get_storyboard_status` — compact per-shot readiness/progress view: prompt status, board status, lock state, stale flags, video readiness.

**Shipped:** `get_storyboard_status`, `write_storyboard_prompt`, `generate_storyboard` alias, `bulk_generate_storyboards`, `refine_storyboard_image`, `lock_storyboard`, and `unlock_storyboard` are exposed through MCP. CLI supports the same core apply commands for engine smoke/debugging. The old `bulk_write_storyboard_prompts` backend-LLM wrapper is no longer a supported MCP director-session path; Studio keeps its civilian bulk button, while agents author scene drafts and apply them through `apply_storyboard_scene_markdown`.

**Why it matters:** Storyboard prompting and board generation are the highest-tax v1 director workflows. Codex needs primitives that match the artist's natural loop: write prompt, generate board, inspect, refine image, lock, move to next shot or bulk-fill missing work.

---

### R26 — Unified local project folder for director desk copy

Status: **agreed** · Raised: 2026-05-13

Current `.lahari/` layout is mechanically useful but too scattered for director mode:

```text
.lahari/sessions/<projectId>/   # state + journal
.lahari/projects/<projectId>/   # readable mirror/snapshots
.lahari/previews/<projectId>/   # pending changes
.lahari/codex/                  # reports/sheets
```

The better mental model is one local desk folder per song/project:

```text
.lahari/projects/<projectId>/
  state.json
  journal.md
  brief.md
  audio-analysis.md
  concept-notes.md
  script.md
  storyboard-prompts.md
  action-plan.json
  previews/
  sheets/
  snapshots/
  issues/
```

**Migration rule:** keep backward compatibility. Existing tools should continue reading old paths for now, but new artifacts should write into the unified project folder. Later add a lightweight migration/cleanup command.

**Why it matters:** The repo is the creative operating system. For the artist/operator, a song should feel like one folder with memory, state, previews, sheets, and issues together. Supabase stays canonical; `.lahari/projects/<projectId>/` is the local desk copy.

---

### R27 — Optional tldraw infinite-canvas review surface

Status: **pinned for later** · Raised: 2026-05-13

Idea: generate a tldraw-based infinite canvas for operators/artists who prefer spatial review. This is not a replacement for the Lahari web studio. It is a visual planning/review artifact: scenes as lanes, shots as cards, refs pinned nearby, storyboard boards and video clips lined up, arrows for continuity, and notes/status badges around them.

Official tldraw capability check:
- SDK supports image, video, and bookmark assets as records referenced by shapes.
- Assets can use hosted URLs/custom storage backends, which maps cleanly to Supabase Storage URLs.
- Editor/store supports JSON snapshots via `getSnapshot` / `loadSnapshot`.
- Shapes are JSON records; SDK supports default shapes plus custom editable shapes.
- Editor APIs can create shapes programmatically.
- Export APIs can render selected shapes/canvas to image formats.

Possible later shape:
```text
npm run lahari -- canvas storyboard <projectId>

.lahari/projects/<projectId>/canvas/
  storyboard.html
  storyboard.snapshot.json
```

MCP/CLI primitive: `write_storyboard_canvas`
- Reads the project packet.
- Lays out scenes/shots/refs/status on a tldraw canvas.
- Opens or deep-links the local HTML in the browser for Codex/browser review.
- Does not mutate Supabase.

Later import primitive: `import_canvas_notes`
- Reads sticky notes/comments from the canvas snapshot.
- Converts them into Lahari issue files or prompt-edit previews.
- Never mutates Supabase directly.

**Why it matters:** Gives Lahari a "whole song on a wall" review surface for spatial thinkers without building a new production editor. It composes well with Codex browser use and the unified `.lahari/projects/<projectId>/` desk-folder direction.

---

### R28 — Apply-only text tools replace backend LLM wrappers

Status: **shipped + validated, migration applied** · Raised: 2026-05-13 · Updated: 2026-05-15

R25 shipped two useful but transitional tools: `write_storyboard_prompt` and `bulk_write_storyboard_prompts`. They wrap backend LLM calls, which violates doctrine §4. Keep them for the live test loop, but do not extend that pattern.

R28 replaces backend LLM-wrapper tools with apply-only primitives. Codex writes the text using the director skill and local project context; the tool validates, persists, records a director event, and returns drift/rollback metadata. The web studio can keep its backend generate/refine endpoints for non-Codex users.

Implemented scope:
- `apply_shot_prompts`
- `apply_storyboard_prompt` / `apply_storyboard_prompts_bulk` / `apply_storyboard_scene_markdown`
- `apply_script`
- `apply_concept`
- `apply_video_prompt`

The tools live under `server/services/codexStudio/applies/` rather than growing the `codexStudio.ts` barrel. They are exposed through MCP + CLI, record per-shot/per-entity director events, append local journal entries, and rely on `baseHash` / `baseFingerprint` drift checks where applicable. `apply_script` is atomic-only through `lahari_apply_script`, so `migrations/2026-05-14_apply_script_rpc.sql` must be applied before using the script tool against real projects.

R25 transitional `write_storyboard_prompt` remains callable for one-shot compatibility but is deprecated. `bulk_write_storyboard_prompts` is disabled for MCP director sessions because parallel backend planner calls lose scene continuity. Codex director sessions should prefer scene-level markdown drafts and R28 apply-only tools.

**Why it matters:** This is the seam that makes Lahari Codex-native instead of another app that calls an LLM behind Codex's back. Codex owns taste-heavy language work; Lahari tools own validation and persistence.

---

### R29 — Project config and prompt override design

Status: **phase 2 shipped, migration applied** · Raised: 2026-05-13 · Updated: 2026-05-15

R29 is the editable project-config umbrella for R22. It now covers per-project preferences and project-level prompt recipes for concept, script, shot-prompts, storyboard, and video. Later phases can add glossary, taste notes, decisions, and richer scene/shot inheritance once the core path proves itself.

Design doc: [`docs/r29-project-config-design.md`](r29-project-config-design.md)

Phase 1 objects:
- `.lahari/projects/<projectId>/config/preferences.json`
- `.lahari/projects/<projectId>/config/prompts/concept.md`
- `.lahari/projects/<projectId>/config/prompts/script.md`
- `.lahari/projects/<projectId>/config/prompts/shot_prompts.md`
- `.lahari/projects/<projectId>/config/prompts/storyboard.md`
- `.lahari/projects/<projectId>/config/prompts/video.md`
- Supabase canonical tables for persisted project config and prompt overrides (`project_id` / `scope_id` are `text`, matching existing Lahari IDs)
- apply tools: `apply_project_preferences`, `apply_project_prompt_override`, `revert_project_prompt_override`
- history from day one: apply inserts a new active override row and marks the old one inactive; revert reactivates the previous row or falls back to global
- no preview tool by design: Codex edits the desk-copy file and the apply tool validates/persists after approval
- implementation first pass: config migration, project config service, `.lahari/projects/<projectId>/config/` desk-copy files, attach/packet config summaries, null-safe storyboard/video read path, MCP/CLI apply + revert tools

**Why it matters:** Project-specific taste improvements should be project-owned configuration, not tier-3 engine edits. This gives Codex a safe editable surface for model choices and prompt recipes while keeping Supabase canonical.

**2026-05-14 stabilization:** storyboard/video/config mutating MCP tools now append concise local journal entries immediately after mutation, so engine sessions can see what just happened without waiting for a future attach. Full canonical desk-copy re-fetch for character/env lock toolchains remains a later polish pass.

**2026-05-15 phase 2:** prompt override kinds expanded to `concept`, `script`, and `shot_prompts` alongside `storyboard` and `video`. Notebook config now emits all five prompt recipe files and MCP/fallback schemas accept all five kinds. Migration `2026-05-15_expand_project_prompt_override_kinds.sql` must be applied to widen the Supabase check constraint.

---

### R31 — Diagnosis bottleneck priority + action ranking

Status: **shipped** · Raised: 2026-05-14 · Updated: 2026-05-14

Two related bugs surfaced in the 2026-05-14 test session driving project `13c259ce-57eb-4da3-8b7e-4e78f1940a1d` (Sri Mahaganapathi Prarthasnmarana Stotram) through 9 phases of work:

**F2 — Stuck-bottleneck diagnosis.** "Song classification is missing" appeared as the `bottleneck` in every attach diagnosis (11 attaches over 2 hours) even after the workflow advanced through audio analysis → concept → script → style → cast/env → storyboard generation. Either: (a) the bottleneck check reads a field that was never populated for this fork, (b) the fork didn't inherit song classification from parent, or (c) audio re-analysis was skipped. **Fix:** make song classification a *warning* not a *bottleneck* once production has moved past audio analysis. The bottleneck should reflect the current production phase's blocker, not a stale audio-stage gap.

**Action ranking.** Storyboard-mode video gen appeared in recommended action lists before storyboard boards were generated/locked. For Seedance-storyboard projects, video can't run until boards are locked, so suggesting it preemptively is wrong. **Fix shipped:** recommended actions now insert a storyboard-review phase, only recommend video from locked storyboard boards, and `buildProjectActionList` only includes runnable video generation actions.

**Why it matters:** the diagnosis is the artist's most-read sentence per session ("here's what to do next"). Persistent stale bottleneck messages dilute trust; out-of-order actions cause wasted time and money.

---

### R30 — Rename `.lahari/` → `lahari/` for sidebar visibility

Status: **proposed** · Raised: 2026-05-13

Codex Desktop and Claude Code sidebars hide dot-prefixed directories by default. That makes ~60% of `.lahari/` invisible to the artist — including their own session journal, project brief, script notes, storyboard prompts, director notes, and project config. Wrong default for content the artist should browse.

**Recommendation:** rename top-level `.lahari/` to `lahari/`. Single visible directory. Plumbing files (audit JSONL, hashes.json, snapshots, state.json) live in subdirectories and are visible-but-ignorable like `node_modules/`.

**Cost:** ~2-3 hours of mechanical find-and-replace across `server/services/codexStudio*/`, `server/services/projectConfig.ts`, `server/services/lahariAudit.ts`, CLI, MCP, skill shards, docs, `.gitignore`. Plus a one-time `mv .lahari lahari` per worktree.

**When:** after the live test pass (so current session state isn't disrupted mid-test), before R28 implementation (so R28's new apply tools land at the right paths from the start, no cleanup pass).

**Why two-dir split rejected:** could split into `studio/` (human-visible) + `.lahari/` (plumbing) but adds complexity for small gain. Plumbing inside `lahari/` is visible but obviously machine-data; artists learn to ignore it like they ignore build output.

**Why it matters:** R17 distribution lands artists into a workspace where their session memory and project files should be discoverable without learning `ls -a`. The dot-prefix was a copy-paste from `.git`/`.vscode` precedent that's wrong for human-readable content.

---

### R32 — Per-call model override on generation tools

Status: **shipped first pass** · Raised: 2026-05-14 · Updated: 2026-05-17

Today changing the image/storyboard/video model requires `apply_project_preferences` (R29 phase 1) which mutates project state. Codex's workaround for "use a different model just for this one refine" is: switch global → do work → switch back. Three problems:
1. If the refine errors mid-way, the project is left in the wrong state.
2. Parallel work inherits the temporary switch.
3. Three director events for what was conceptually one decision.

**Shipped first pass:** added an optional `modelOverride` parameter to storyboard/video planning and generation tools (`plan_generate_storyboard`, `plan_generate_video`, `generate_storyboard`, `bulk_generate_storyboards`, `refine_storyboard_image`, `apply_generate_video`). Uses the override for this call only; project preferences unchanged. Director event records the override when used.

Example:
```js
refine_storyboard_image({
  projectId, shotId, feedback,
  modelOverride: { storyboardProvider: 'gpt-image-2' }  // optional
})
```

Supported today: `storyboardProvider` and `videoModel`. Project-level model preferences remain the right path for durable preference changes; `modelOverride` is for one-off experiments and recovery.

**R32-extension:** per-call overrides do **not** yet cover keyframe image generation, style visualization, or character/environment look generation. Those would need `modelOverride.imageModel` wired through the frame/image, style-viz, and looks routes. Keep this as a later focused pass if real sessions need transient image-model experiments outside storyboard boards.

**Why it matters:** "Try a different model for just this one shot" is a common debugging move (see R33 — model bias correction). Forcing a state change for transient overrides is heavy. R32 lets Codex compose model choice per-call without ceremony.

---

### R33 — Model-bias correction system

Status: **proposed** · Raised: 2026-05-14

Different image/video models have known aesthetic biases. GPT-Image-2 leans dark/grainy/high-contrast. Some models lean cool-palette. When the artist switches models mid-project (whether via project preference, R32 per-call override, or fallback when one provider is down), the new model's bias fights the locked style ref.

**Three layers, all composing at prompt-assembly time:**

| Layer | What | Where |
|---|---|---|
| Engine baseline (tier 3) | Known model biases as anti-pattern lists. `gpt-image-2 → ['avoid grainy texture', 'avoid heavy darkening', 'avoid high-contrast color grading']` | `server/prompts/model-bias.ts` (new) |
| Project extension (tier 1) | This song's specific extensions/suppressions of the baseline | R29 phase 2-ish: `lahari/projects/<id>/config/model-corrections.md` |
| Skill awareness | Teach Codex to diagnose model-bias drift via `render-triage`; apply correction via R32 or project config | `render-triage` shard, light extension |

Prompt assembly: global template (or R29 project override) + model-bias correction (R33 engine baseline, plus project R33 extension if any) → final prompt sent to model.

**Cost:** ~1-2 days. New service file, new prompt-assembly helper, extension hooks in storyboard/video prompt builders.

**Why it matters:** the biggest model-switching headache in the 2026-05-13 test was style drift when GPT-Image-2 took over. R33 encodes the workaround systematically so Codex doesn't have to manually fight model bias every time.

---

### R34 — Apply-only tools for harness-native media output

Status: **proposed** · Raised: 2026-05-14

R28 established the pattern for harness-native text: Codex writes, apply tool persists. The same pattern should exist for media when the harness has capable native generation. Currently the harness can generate images natively (OpenAI's image gen under Codex Desktop's hood) but Lahari has nowhere to put the output — bytes appear in chat, never land as a tracked asset.

**Recommendation:** add `apply_storyboard_board(shotId, imageData, prompt, baseHash?)` that takes bytes from Codex's native generation, uploads to Supabase Storage, creates an asset row, creates a version, marks shot updated, records event. Same R28 pattern extended to images. Future entries (`apply_voiceover_audio`, `apply_render_composition`) follow as harness capabilities grow.

**Today's capability gap:** harness native image gen is single-image-input today; storyboard refinement needs multi-reference grounding (locked style + cast + env). For multi-ref work, dedicated tools (Lahari's `refine_storyboard_image` via Segmind/Google) stay the right choice. R34 is for the *simple* image-gen cases that the harness can already handle, and for *future* multi-ref capability when harnesses grow it.

**When to build:** not high-priority today because harness native image gen fails on multi-ref work (which is most storyboard refinement). File now so the pattern is documented; build when capability lands.

**Why it matters:** doctrine §4 already softened to acknowledge "image gen is mixed." R34 is the apply-side that makes harness-native image gen actually composable. Without it, even when capability arrives, output has no home.

**Skill ritual for native image edits (from 2026-05-13 test diagnosis):** when harness native image gen IS used, the failure mode observed was setup-driven, not capability-driven. Codex passed reference URLs as "inspiration" and the model reinterpreted compositionally instead of doing strict pixel-preserve edit. The skill (when R34 is built) should encode:
1. Treat native imagegen output as a local draft only — not production-ready until visually inspected
2. Preserve source image by passing it as the primary edit target, NOT as inspiration
3. Use style images only as grade/reference, NEVER as content to merge
4. After approval, call `apply_storyboard_image_asset(projectId, shotId, localImagePath, sourceVersionId, note)`
5. Never manually upload/register image rows — always through the typed apply tool

This ritual prevents the "inspiration vs preserve" misinterpretation that caused the 2026-05-13 test's image edit to fail.

---

## Risks / Watch List

Things I might be wrong about. Worth revisiting as we learn.

- **W1. INVALIDATED 2026-05-13.** Tried the structured events table (`lahari_director_events` in `789536b`) directly without first exploring the "just query DB updates" approach. The structured-event approach was clearly correct: it captures *intent* (locked vs cleared vs reverted) which raw row diffs can't recover, gives clean source attribution (web vs codex vs system), and gives the journal a clean ingestion shape. Don't relitigate.
- **W2.** MCP tool-count ceiling is a heuristic, not measured. If Codex's tool-selection holds up to 40+ tools in practice, R9 is over-engineered.
- **W3.** Realtime might be overkill if artists work asynchronously and never have web studio open while Codex is acting. Polling-on-tab-focus could be enough. Watch the actual usage pattern.
- **W4.** "One Codex session = one song" assumes long sessions. If sessions get fragmented (Codex's session UX nudges restart), Lahari director sessions in `.lahari/sessions/` should carry the weight and Codex sessions become disposable. Architecture supports this — just don't optimize Codex-session continuity prematurely.
- **W5.** The plugin distribution timing question is downstream of all of this. Don't relitigate until R10's gates are concrete and met.
- **W6.** CLI audit fallback could make MCP discipline feel optional. Keep the product rule MCP-first in director mode; CLI audit is a safety net, not the primary operating path.
- **W7.** Project-local prompt catalogs can become a second source of truth if file edits are not imported through typed apply tools. Desk-copy files are useful; production overrides must live in Supabase.
- **W8.** Codex Desktop / Claude Code MCP hot-reload gap: registered MCP servers don't appear in active chat sessions until app restart. Upstream limitation, not a Lahari bug. R18 enforcement (skill refuses CLI fallback when MCP not visible) handles the user-facing failure mode. File as feature request with OpenAI/Anthropic when stable surface exists.
- **W9.** R29 phase 2 is now implemented as a project recipe/config surface. Watch actual usage before wiring every backend LLM path to consume the new concept/script/shot_prompts recipes; Codex-native director sessions already use the files directly when authoring apply-only content.

---

### R35 — `write_project_notebook` tool and notebook refresh artifacts

Status: **shipped + validated** · Raised: 2026-05-14 · Updated: 2026-05-15

Solved the chicken-and-egg problem from R17: artist connects MCP, opens an empty folder, asks "open <song>" — and the workspace has to materialize itself. `write_project_notebook(projectId)` returns deterministic file payloads (`{ path, content, mode, writePolicy }`) that the agent writes via harness file tools. Layout: `lahari/projects/<id>/mirrors/` (read-only state mirrors), `drafts/` (editable working copies), `config/` (Tier-1 editable overrides + preferences + drift hashes), `journal.md` (local working memory), `AGENTS.md` (workspace instructions). Apply tools return `changedArtifacts` on every mutation so the agent refreshes only the affected mirrors; script apply additionally returns `notebookRefresh.recommended` because shot-topology replacement may leave stale per-shot files.

**2026-05-18 note:** R42 supersedes this as the preferred large-notebook materialization path. Keep `write_project_notebook` as the pure-MCP fallback for environments where shell/npx is unavailable; use CLI sync for normal artist workspaces.

Editable script draft extension: `drafts/script.md` is now the preferred script-refine surface. Agents edit it surgically with file tools, then call `apply_script_markdown`. The tool parses the strict markdown, validates `scriptFingerprint` drift, reference integrity, and shot/scene duration constraints, then persists through the same atomic script apply path as JSON `apply_script`.

Scene-level storyboard draft extension: `drafts/storyboards/<scene>.md` is now the preferred storyboard prompt + Seedance cut-plan authoring surface. Agents write adjacent shots together, then call `apply_storyboard_scene_markdown`; the tool parses strict markdown, validates per-shot base hashes, skips locked shots, persists valid rows through the same apply path as JSON `apply_storyboard_prompt`, and refreshes affected mirrors/drafts. Studio's civilian bulk prompt writer remains available in the web app, but MCP director sessions should not use backend bulk prompt writers.

Generated rather than distributed: AGENTS.md and skill shards are emitted by the tool, not bundled in an `npx setup` step. Engine updates ship via Railway deploy, instant for all artists.

Skills shipped at `server/resources/skills/` (deploy-safe bundle), with `.agents/skills/` as local-dev fallback. Materialized into `<workspace>/.agents/skills/` per project.

**Verified.** First artist successfully ran attach → notebook → mirrors readable → apply → mirror refresh end-to-end.

### R36 — Realtime agent operation presence

Status: **shipped + validated** · Raised: 2026-05-15 · Updated: 2026-05-15

Realizes doctrine §6's promise: "operation progress should use broadcast channels." New `lahari_agent_operations` table tracks every non-readonly tool call with `status: running | success | error`, `scope_type: project | scene | shot`, `scope_id`, label, compact result payload. Wired into both `/api/director/*` and `/mcp` `audited` wrappers. RLS-policy-enforced (only project owner reads their ops via `auth.uid()`).

Web studio subscribes via Supabase realtime channel filtered per project; renders a quiet `surface-inset` pill in the header with a pulsing colored dot (amber=working, red=error, emerald=success). 800ms debounce coalesces cascade refreshes.

Migration `2026-05-15_add_agent_operations_realtime.sql` adds the table + RLS + publication entries for 13 tables. Service has graceful `isMissingTableError` fallback if migration not applied yet.

**Open follow-up: R37 (below).**

### R37 — Per-scope operation presence in ShotCard / scene tiles

Status: **proposed** · Raised: 2026-05-15

R36 backend tracks `scope_type: 'shot' | 'scene'` + `scope_id`. The header pill is the only UI surface today. ShotCard should read `agentOperations` and render a subtle pulsing amber accent when its `shotId` matches an active operation's `scope_id`. Same for scene tiles. ~half day frontend.

Also worth doing alongside: tablet/mobile degradation of the header pill (currently `hidden lg:flex`, disappears entirely below 1024px; could degrade to just the pulsing dot without label at smaller breakpoints).

### R38 — Abstraction platform (Mirage)

Status: **branched, design seeded** · Raised: 2026-05-15

The third major workstream. Lahari's pipeline (Intake → Blueprint → Looks → Studio → Render) is the right spine for most single-seed video production. Today it's hardcoded for devotional music video from audio. The abstraction makes the spine reusable across workflows: music video, anime, ads, reels.

Three-axis decomposition: `SeedKind` (audio/script/brief/document/idea), `Workflow` (music_video/anime_scripted/...), `Preset` (taste rules + defaults). DB switch via `DB_TABLE_PREFIX=lahari|studio`. New Supabase + Railway for `studio_*` schema. Lahari prod untouched.

Brand: **Mirage**, single brand multi-tenant SaaS, beta testers building anime/reels/ads with presets. White-label deferred until first big client.

Full design at `docs/abstraction-platform-plan.md`. Work proceeds on the `abstraction` branch in a separate worktree (`~/Code/lahari-media-engine/lahari-abstraction`). Engine fixes flow `codex-native-studio → abstraction` via merge, not the other direction.

---

### R39 — Codex-native concept + style ideation

Status: **shipped first pass** · Raised: 2026-05-17 · Updated: 2026-05-17

The current Studio path still routes concept/style ideation through backend LLM endpoints: generate multiple ideas, optionally refine, then visualize a selected style. That remains useful for civilian UI users, but it is the wrong default for director-agent sessions. Concept and style direction writing are text work; Codex already has the model, the conversation, the song/script context, the culture/taste rubric, and the ability to edit outputs surgically.

**Shipped first pass:** director-session concept/style ideation moved to the Codex-native apply-only lane. Codex writes one or more concept directions or style directions itself, using the relevant skill rubric, then persists them through typed apply tools. Concept uses existing `apply_concept`; style now uses `apply_style_direction`, drift-checked by the style base hash in the notebook. Visualization remains a tool call because it creates pixels. Preset lock remains a tool call because it selects a curated asset.

**Target flow:**
1. Codex reads audio analysis, lyrics, script, notes, and taste context.
2. Codex writes one or two concept/style directions directly in the workspace or response.
3. Codex applies the chosen text through `apply_concept` or `apply_style_direction`.
4. Only after text approval does Codex call the style visualizer or lock a preset/asset.

**Why it matters:** removes the "generate 3 ideas + refine + visualize" double-hop from director sessions, keeps taste reasoning in the harness where the artist is talking, avoids unnecessary paid/backend LLM calls, and lets Codex directly edit the actual output instead of asking another model to rewrite it.

Studio's backend concept/style generators remain available for civilian UI users. MCP director sessions should prefer the native apply lane.

---

### R40 — Character/environment look-generation recipe overrides

Status: **shipped first pass** · Raised: 2026-05-17 · Updated: 2026-05-17

R29 phase 2 made `concept`, `script`, `shot_prompts`, `storyboard`, and `video` overridable project prompt recipes. The looks pipeline is still missing the same agency surface. Directors can edit character/environment descriptions and generation prompts as project state, but they cannot yet override the recipe that decides *how* Lahari turns those entities plus the locked style ref into look-generation prompts/images.

**Shipped first pass:** added R29-style project prompt override kinds for the looks stage:
- `character_looks`
- `environment_looks`

These control the runtime text recipe used when generating/refining cast and environment looks, while the actual image rendering remains a tool call. The recipe is applied at generation time and does not permanently bake itself into each cast/env saved prompt, so reverting the project override cleanly returns to the engine default. Codex can adapt look-generation taste per project — cultural specificity, costume/material discipline, face/body consistency rules, architecture vocabulary, "avoid generic devotional gloss," etc. — without editing tier-3 engine prompts.

**Why it matters:** character and environment looks set the visual DNA for every downstream frame, board, and video. If the director cannot tune the look-generation recipe, the system keeps pulling them back into generic defaults. This is the same freedom R29 gave storyboard/video prompts, applied earlier in the pipeline where taste compounds.

Requires migration `2026-05-17_agency_pass_models_workflow_looks.sql`.

---

### R41 — Per-shot workflow mode

Status: **shipped first pass** · Raised: 2026-05-17

Project-wide storyboard/keyframe defaults were too rigid. A project can mostly be storyboard-mode but have one keyframe-heavy hero shot, or mostly keyframe-mode but use a storyboard board for a hard continuity bridge.

**Shipped first pass:** shots now carry `workflow_mode: auto | storyboard | keyframe`. `auto` preserves existing project/model behavior. `storyboard` forces storyboard-board-first flow and refuses video generation if no locked board exists. `keyframe` forces the first-frame path even on Seedance projects. Codex sets modes through `apply_shot_workflow_modes`; packets, notebooks, storyboard drafts, and plan responses surface the mode.

This is agent-first for now. Studio UI can stay simple; the web app will naturally reflect the chosen path when generation tools run.

**Follow-ups:** `apply_shot_workflow_modes` currently has no baseHash/drift check because it mutates one low-risk field per shot. Add one before Studio exposes a workflow-mode toggle. Studio also needs a small workflow badge/filtering pass before civilian bulk actions understand forced keyframe/storyboard modes.

---

### R42 — Agent-run notebook sync CLI

Status: **shipped first pass, package published, pending deploy** · Raised: 2026-05-17 · Updated: 2026-05-18

The first remote notebook path sent every file body through one giant MCP text response. It worked, but longer projects make that brittle and expensive in chat context. Notebook materialization is bulk file IO, so the artist agent should use a local sync command while project mutations remain MCP/apply-tool mediated.

**Shipped first pass:** hosted MCP exposes `mint_cli_token(projectId, ttlMinutes)` which creates a short-lived project-scoped token. New package `@ssaulgoodman420/lahari-cli` exposes `lahari sync <projectId>`, calls `/api/notebook-sync/projects/:id/notebook`, writes files directly to the current workspace, and maintains `lahari/projects/<id>/.sync-state.json` for idempotent hashes and conflict detection.

Sync rules:
- `overwrite` files are refreshed from Supabase state.
- `create_if_missing` files like `journal.md` are never clobbered.
- `review_before_overwrite` files under `drafts/` and `config/` are protected with a last-known-server hash. If local and server both changed, CLI skips and reports a conflict unless `--force` is used.
- Removed server files are deleted only when the local file still matches the last-known hash.

`write_project_notebook` remains as the pure-MCP fallback for environments without shell/npx. Apply-tool `changedArtifacts` still handles small refreshes; use CLI sync when `notebookRefresh.recommended` or when the notebook is stale/damaged.

Migration `2026-05-17_add_cli_notebook_sync_tokens.sql` is applied. Package `@ssaulgoodman420/lahari-cli@0.1.0` is published. Deploy is pending Railway outage recovery.

---

## Polish Items

Small things noticed but not substantial enough for their own R#. Address opportunistically when adjacent code is being touched.

- **P-poli-01 — Replay idempotency on apply tools.** Apply tools record a second event on retry (same `previewId`). Not blocking today (visible in log, human-interpretable), but mandatory before any auto-retry path. Consider uniqueness on `(event_type, payload->>'previewId')` for apply events.
- **P-poli-02 — Known-event-types registry.** Codex creates event types on the fly (e.g., `storyboard_prompt_direct_edit`, `project_settings_updated`). Fine architecturally (event_type is open text) but worth maintaining a documented list of known types in `docs/director-events.md` for analytics + journal narration consistency.
- **P-poli-03 — `compare_versions` MCP tool.** Visual diff between two generation versions (board v1 vs v2, video v1 vs v2). Would compose with the web studio's existing version history. Belongs in the storyboard iteration loop after `get_storyboard_status` + `refine_storyboard_image`. Small build (~half day) — generates a side-by-side contact-sheet HTML.
- **P-poli-04 — Web studio "Codex override active" badge.** R29 design decided no inline editing in phase 1, just a small badge. Badge not yet built — when storyboard generation uses a project override, the BlueprintContextBar should show "Codex storyboard override active." ~1 hour of frontend work.
- **P-poli-05 — R6 phase 2 split (preview/apply/rollback families).** Codex's R6 first pass deferred this intentionally because R28 reshapes the apply pattern. Now that R28 has shipped under `applies/`, the preview/apply/rollback chains remaining in `codexStudio.ts` barrel can move into focused `previews/`, `rollbacks/` modules. ~2-3 hours.
- **P-poli-06 — Structured `deviation` field on model registries.** R21's doctor command warns on routing drift via regex on `note` text ("Segmind credits out", "TEMP routing"). Fragile — different wording silently breaks detection. Add a structured `deviation: { reason: 'segmind-credits-out', expectedProvider: 'segmind' }` field to model configs; doctor reads structured field instead of grepping prose.
- **P-poli-07 — Audit log rotation strategy.** Daily JSONL rotation today. Long-running projects accumulate many files. Consider per-month rotation or size-based rotation for `_unscoped` (which catches all CLI invocations). Not urgent.
- **P-poli-08 — Deprecate `critique-shot-image` catalog prompt (R7).** The prompt is still in `server/prompts/catalog.ts` but the `render-triage` skill now covers the judgment. Remove the catalog entry; if any fact-gathering primitive emerges later (prompt-length stats, color histogram, ref similarity), add as a small read-only tool — not a Claude call.
- **P-poli-09 — Render notification primitive (R11).** Long-running ops (video gen 60-90s, render minutes) have no out-of-chat notification. The artist sits and waits. Options: apply tool returns "expect ~Ns" + Codex auto-polls; or `notify_when_done` MCP primitive that lands desktop push/email. Watch list candidate.
- **P-poli-10 — RLS policies on R29 tables before R2/R16 land.** `lahari_project_config` and `lahari_project_prompt_overrides` have RLS enabled but no policies — service-role-only access today. Realtime subscriptions (R2) and browser-bridged auth (R16) both need policies. Add `select where auth.uid() IN (select user_id from lahari_projects where id = project_id)` per the pattern in `lahari_director_events`.
- **P-poli-11 — Studio workflow-mode UX.** R41 is agent-first. Web Studio should eventually show `auto/storyboard/keyframe` on ShotCard and make civilian bulk storyboard/keyframe actions filter or warn by workflow mode.

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
- 2026-05-13 — Claude reviewed `1408f0b`. PL/pgSQL function is properly hardened: `security definer`, `search_path = public`, revoked-from-public + granted-to-service_role, project-existence pre-check, jsonb iteration with coalesce defaults, tri-state handling for `include_prev_cut_plan`. Implicit single-transaction body makes the rollback atomic. **RB-FU1 status: shipped — pending migration apply to Supabase.** One trivial nit (non-blocking): function duration default `15` drops the previous `project.targetDuration` fallback; only matters if a snapshot shot has no duration AND project uses non-default target, which is vanishingly rare.
- 2026-05-13 — Codex shipped R10 first pass setup command. `npm run lahari -- setup` validates env/worktree/Supabase/MCP prerequisites and idempotently registers `lahari` for Codex Desktop + Claude Code; `setup --check` gives a no-write validation path.
- 2026-05-13 — Claude reviewed `fed5e88` (R10). Setup script is properly defensive: validation gates registration (won't wire a broken system), layered env-file resolution matches MCP loader, three progressively deeper Supabase probes (REST + table + RPC), uses native `codex/claude mcp add` CLI rather than writing config files directly, idempotent via remove-then-add, threads `LAHARI_ENV_FILE` to the registered server. Self-discovery caught the missing atomic-rollback migration and refused to register MCP — exactly the right behavior. **R10 status: shipped, validated end-to-end by Codex's own setup smoke.** Gate to first session: apply `2026-05-13_atomic_script_rollback.sql` → re-run setup → MCP registers → ready.
- 2026-05-13 — Codex shipped RB-FU2/R10 follow-up: setup and MCP env loading now strip empty-string env values before dotenv loads, and setup presence checks use trimmed values. Explicit empty shell exports no longer block `.env` fallback.
- 2026-05-13 — Saul ran setup on his own terminal. All 12 prerequisites green (env, worktree, Supabase REST + events table + rollback RPC). Codex Desktop MCP registered ✓. **One blocker remains: Claude Code MCP registration failed** due to `claude mcp add` arg-order bug. In Claude Code 2.1.132 the variadic `-e <env...>` flag greedy-consumes the `<name>` positional when env flags precede the name; reproduced and confirmed via direct `claude mcp add` calls. Fix: in `registerClaudeMcp`, move `-e LAHARI_ENV_FILE=...` to after `MCP_SERVER_NAME`. Codex Desktop is already operational; Claude Code path waits on this one-liner reorder.
- 2026-05-13 — First-session diagnostic: Saul started a Codex Desktop session in the worktree; tools and skill both invisible. (1) MCP `lahari` is registered (`codex mcp list` confirms) but the in-flight session pre-dates the registration — Codex Desktop loads MCP servers at app start, not per-session. Fix: quit + reopen Codex Desktop. (2) `.agents/skills/lahari-director/SKILL.md` is a Claude/Anthropic-skills convention; Codex Desktop doesn't auto-discover that path. Claude inlined the Session Start bootstrap (director-vs-engine, opening move, banned plumbing vocab, resume-vs-new, pointer to full skill file) into `AGENTS.md` so Codex picks it up via the workspace instruction file it already reads. Full skill remains canonical at `.agents/skills/lahari-director/SKILL.md` for taste rubric.
- 2026-05-13 — First real director-test friction logged from project `13c259ce-57eb-4da3-8b7e-4e78f1940a1d`: (1) registered MCP was not visible as active chat tools, causing local CLI/service fallback and empty MCP audit logs; R18/R19 opened. (2) out-of-band character/environment generation created DB candidates that the Blueprint UI did not hydrate on load until a lock existed; R20 opened. (3) `nano-banana-2` provider routing in `codex-native-studio` drifted from `main` and still pointed to Segmind; R21 opened. These are now tracked as engine follow-ups rather than living only in chat.
- 2026-05-13 — Directional product decision logged: per-project prompt ownership should use project-local prompt catalogs seeded from global templates, with Codex allowed to tune storyboard/video prompt recipes directly and apply them through typed preview/apply paths. Longer-term boundary: taste-heavy language work moves into Codex-native editing; provider tools keep image/video/audio/render/storage responsibilities. R22/R23 opened.
- 2026-05-13 — Approval UX exploration logged. Codex `PermissionRequest` hooks are useful for notification/attention and already wired locally for sounds, but Lahari production approvals should remain typed plan/apply tool boundaries unless plugin/MCP mutating tools expose a native Codex approval surface. R24 opened.
- 2026-05-13 — Storyboard director workflow gaps logged from live MCP testing. Add storyboard prompt write/bulk-write, board generate/bulk-generate, edit-image refine, lock/unlock, and compact status tools. Also logged the local filesystem consolidation direction: new artifacts should live under one `.lahari/projects/<projectId>/` desk folder while old session/preview/codex paths remain readable for compatibility. R25/R26 opened.
- 2026-05-13 — Quick tldraw capability check completed from official docs. SDK has image/video assets, snapshots, programmatic shapes, custom editable shapes, and export; pinned optional infinite-canvas storyboard/review surface as R27 for later, not a core v1 blocker.
- 2026-05-13 — Codex shipped R25 storyboard lifecycle in `e9accaf`: `write_storyboard_prompt`, `bulk_write_storyboard_prompts`, `generate_storyboard` (alias, kept `apply_generate_storyboard`), `bulk_generate_storyboards`, `refine_storyboard_image`. Guardrails: bulk tools take optional `shotIds`, defaults skip locked/non-needed shots, `force` exists but gated on approval, single generate refuses to overwrite locked boards. Tests + audit green.
- 2026-05-13 — Claude reviewed `e9accaf`. Image-gen tools (`refine_storyboard_image`, `bulk_generate_storyboards`, `generate_storyboard`) are doctrine-compliant tool calls. **Two tools are transitional debt:** `write_storyboard_prompt` and `bulk_write_storyboard_prompts` wrap backend `writeStoryboardPrompt` which round-trips through `text-provider.ts` → LLM. This violates doctrine §4 (text-writing should be Codex-native). **Decision: keep as transitional** so the live testing loop stays unblocked; deprecate when R28 ships apply-only `apply_storyboard_prompt` / `apply_storyboard_prompts_bulk` that take Codex-written content. Do not extend this pattern to new text tools.
- 2026-05-13 — **Doctrine clarification for R28 scope:** apply-only variants for Codex-native text generation should cover concept, script, shot prompts, storyboard prompts, and video prompts. Each tool takes pre-written structured content from Codex, validates against constraints, persists via existing apply path, records a director event. No LLM call inside the tool. Web studio retains backend `generate-*` / `refine-*` endpoints for non-Codex users.
- 2026-05-13 — Codex shipped R29 design doc in `f1bf3b6` (`docs/r29-project-config-design.md`). Phase 1 scope: project preferences + project-level storyboard/video prompt overrides. Schema: `lahari_project_config` (preferences) + `lahari_project_prompt_overrides` (prompts, scope columns for future scene/shot). Inheritance: shot → scene → project → global. Drift via baseHash. Read path folded into `attach_director_session`. R28/R29 boundary explicit: R28 applies content; R29 stores recipes.
- 2026-05-13 — Claude reviewed R29 design. Solid overall. **Schema fixes required before implementation:** `project_id` must be `text` not `uuid` (matches existing `lahari_projects.id`); `scope_id` must be `text null` not `uuid null` (matches existing scene/shot IDs). **Missing pieces to add before implementation:** (1) hash file refresh after apply succeeds; (2) explicit revert path — `revert_project_prompt_override(projectId, kind)` recommended over body-empty deactivate; (3) one-line callout that there's no preview tool by design (Codex IS the preview); (4) rollback strategy — use `active=false` on previous row, INSERT new active row instead of UPDATE in place, makes rollback = re-activate previous. **Open question answers:** (Q1) project config overrides `lahari_projects` columns for phase 1, deprecate later; (Q2) yes to history rows from day one via `active` toggle; (Q3) phase 1 web studio shows only a "Codex overrides active" badge, no inline editing. **Implementation order tweak:** wire backend planner/builder to read overrides BEFORE adding apply tools, to verify read path is null-safe before allowing writes.
- 2026-05-13 — Claude shipped R8 skill fragmentation (parallel work while Codex implements R29). `lahari-director` slimmed to orchestrator (session start, permission rules, output style, friction capture). Created five focused taste shards under `.agents/skills/`: `storyboard-prompt-craft` (88 lines), `script-doctor` (77), `continuity-auditor` (90), `style-ref-critic` (90), `render-triage` (105). Each shard has a focused frontmatter description, concrete heuristics, anti-patterns, refining-vs-rewriting guidance, and cross-references. Skill index in `lahari-director` tells Codex which shard to load when. Shards are also prep for R28 — `storyboard-prompt-craft` and `script-doctor` are what shape Codex-written content quality when apply-only tools replace LLM-wrappers.
- 2026-05-13 — Claude shipped R29 prompt override audit in `docs/r29-prompt-override-audit.md`. Classified all 26 catalog prompts into four buckets: A (engine-only, ~7 prompts), B (project recipe candidates by tier, ~10 prompts), C (per-shot content → R28 territory, ~5 prompts), D (should be skill, not stored prompt, e.g., `critique-shot-image` → R7). **Recommended R29 phase 2 scope:** Tier-1 leverage points — `kind='concept'`, `kind='script'`, `kind='shot_prompts'`. Refine variants bundle into the same override row as their writer twin. Bucket A stays engine-only; Bucket C routes through R28; Bucket D moves to skill shards. Audit doesn't change phase 1 scope, frames what comes after.
- 2026-05-13 — Codex shipped R29 phase 1 implementation in `a8eb751`. New migration `2026-05-13_add_project_config_overrides.sql` (still needs Supabase apply). Schema fixes from my review all landed: `project_id text`, `scope_id text null`, partial unique index `where active` enforces one-active-row-per-scope. New `server/services/projectConfig.ts` (429 lines) implements drift-checked apply/revert via active-flag history (UPDATE existing `active=false` → INSERT new `active=true`). Hash file refresh after every apply via `writeProjectConfigDeskCopy`. Backend wired null-safely in `storyboard.ts` and `videoGeneration.ts`. MCP tools (`apply_project_preferences`, `apply_project_prompt_override`, `revert_project_prompt_override`) audit-wrapped and emit director events. Read path folded into attach + packet via `projectConfig` block. No preview tool, by design.
- 2026-05-13 — Claude reviewed `a8eb751`. All R29 design review notes addressed correctly. Two small operational items: (1) RLS enabled on both new tables but no policies defined — fine for phase 1 (service-role-only access via backend), but R2 (Realtime subscriptions) and R16 (browser-bridged auth) will both need SELECT/INSERT policies on these tables before they can land. Worth deferring as a "policy add" task tied to whichever lands first. (2) Migration ready to apply to Supabase whenever — pure DDL, no functions, no destructive SQL.
- 2026-05-13 — R29 phase 1 migration applied to Supabase. End-to-end live.
- 2026-05-13 — Claude shipped R28 spec in `docs/r28-apply-only-text-gen-design.md`. Six apply-only tools (`apply_shot_prompts`, `apply_storyboard_prompt`, `apply_storyboard_prompts_bulk`, `apply_script`, `apply_concept`, `apply_video_prompt`) with full input/validation/error/event specs. Cross-cutting: drift detection via baseHash, structured validation error shape for retry loops, audit symmetry, deprecation path for the two R25 transitional tools (3-step: mark deprecated → warn-level log → remove from MCP). Backend integration reuses existing `updateRows` + atomic RPC pattern from RB-FU1. Web studio compatibility preserved (existing backend endpoints untouched). Implementation order suggested: simplest tool first (`apply_video_prompt`), most-involved last (`apply_script` with atomic RPC).
- 2026-05-13 — R28 spec open questions locked by Saul + Claude: (1) array-only for `apply_shot_prompts`; (2) atomic-only for `apply_script`; (3) deprecated R25 tools stay as separate code paths through 3-step removal; (4) `baseHash` optional with skill teaching "always pass it"; (5) bulk applies emit per-shot director events, not one bundle. Spec updated with locked decisions; ready for Codex implementation.
- 2026-05-13 — Codex implemented R29 phase 1. Added `lahari_project_config` + `lahari_project_prompt_overrides` migration with history-preserving partial active index, project config service with drift hashes, `.lahari/projects/<projectId>/config/preferences.json`, `prompts/storyboard.md`, `prompts/video.md`, `hashes.json`, attach/packet summaries, backend preference/override reads in storyboard planner/renderer and storyboard-mode video builder, plus MCP/CLI tools `apply_project_preferences`, `apply_project_prompt_override`, and `revert_project_prompt_override`. Verified with `npm run build`, `npx tsc --noEmit`, and `git diff --check`. Pending: apply migration to Supabase and Claude review.
- 2026-05-13 — Codex shipped R6 first-pass split. `server/services/codexStudio.ts` reduced from 3,622 lines to 1,729 lines while keeping it as the CLI/MCP public barrel. New focused modules: `codexStudio/core.ts` (shared types/helpers/status), `packets.ts` (project/shot packets), `sheets.ts` (reports/contact sheets), `plans.ts` (action lists/storyboard prompt review), `storyboardOps.ts` (storyboard/video generation and R29 apply/revert ops). Verified with `npm run build`, `npx tsc --noEmit`, and `git diff --check`. Remaining future split: sessions/workbench and preview/apply/rollback families.
- 2026-05-14 — Saul drove a real 2-hour test session on fork `13c259ce-57eb-4da3-8b7e-4e78f1940a1d` (Sri Mahaganapathi Prarthasnmarana Stotram). Workflow advanced from audio analysis through concept → script → style → cast/env → storyboard generation for shot 1. Architecture claims validated end-to-end via audit + journal: MCP-first discipline held (16 of 17 tool calls `mcp/*`; only CLI was `audit tail`), R29 agency layer actively used (`apply_project_preferences` called 3x mid-flow), skill-driven taste applied (new `storyboard_prompt_direct_edit` event), production-language operator notes throughout. Surfaced four real friction items + two Codex-added polish notes. **Filed as follow-ups under R8 (F3), R12 (F1+F4), R15 (Hydrated→Updated), R29 (post-apply desk-copy refresh extension), plus new R31 (diagnosis bottleneck + action ranking).** R30 explicitly deferred — touches setup/gitignore/docs/skills/muscle-memory, cosmetic relative to F1-F4, save for separate pass with backwards-compat plan.
- 2026-05-14 — Codex shipped stabilization pass: F1+F4 (R12), F3 (R8), F2+action ranking (R31), Hydrated→Updated (R15), and immediate local journal entries for storyboard/video/config mutations (R29 polish). Verified with `npm run build`, `npx tsc --noEmit`, and `git diff --check`. Sequence remains: Saul quick continuation test → R28 implementation (apply-only tools under `server/services/codexStudio/applies/`) → Claude reviews.
- 2026-05-14 — Claude reviewed `b0a2c83`. All six items verified against code: F1 honest scope-setting in skill; F2 `classificationIssue` moved to end of `openIssues` so it's last-warning not bottleneck; F3 imperative capture-issue trigger with broader list; F4 re-attach dedup gated on four conditions with `LAHARI_ATTACH_JOURNAL_DEDUP_MINUTES` env override; action ranking gates video gen on locked storyboards (storyboard mode) or completed frames (keyframe); zero remaining "Hydrated:" strings, "Updated:" everywhere; new `appendSessionJournalEntry` helper provides post-mutation journal append pattern that R28 can reuse as template. R12 F1+F4, R8 F3, R15 Hydrated→Updated, R29 desk-copy extension, R31 — all now `shipped first pass`. Ready for Saul's continuation test, then R28 implementation.
- 2026-05-14 — Codex implemented R28 apply-only text tools. New modules under `server/services/codexStudio/applies/` cover `apply_shot_prompts`, `apply_storyboard_prompt`, `apply_storyboard_prompts_bulk`, `apply_script`, `apply_concept`, and `apply_video_prompt`; the `codexStudio.ts` root remains a re-export barrel. MCP + CLI surfaces added, R25 backend-LLM storyboard writer tools marked deprecated, read packets now expose base hashes for concept/script/shot/storyboard/video prompt drift checks, and every apply records director events + appends local journal entries. New migration `2026-05-14_apply_script_rpc.sql` adds atomic `lahari_apply_script` RPC. Verified with `npx tsc --noEmit`, `npm run build`, and `git diff --check`. Pending: apply the migration before using `apply_script` against live projects, then Claude review.
- 2026-05-14 — Claude reviewed `14b127d`. All five locked spec decisions verified in code: Q1 array-only on `apply_shot_prompts`; Q2 atomic `lahari_apply_script` RPC with `security definer + search_path + revoke from public + grant to service_role` matching the rollback RPC's defensive shape; Q3 R25 tools keep their backend-LLM code paths plus get both a description warning and runtime `console.error('[deprecated] ...')` on every call; Q4 `validateBaseHash` returns null when baseHash is missing or `force: true` (optional drift check with escape hatch); Q5 per-shot `shot_prompts_applied` events emitted inside the bulk loop. `helpers.ts` factored cleanly (157 lines): `applyError`, `validateBaseHash`, `ensureLength`, `findProjectShot`, `appendApplyJournal`, `hasDownstreamVisualWork`, `scriptDraftHash`, `normalizeScriptForApply`. Structured errors include `field`, `shotId`, hashes, and `next` suggested-action — the retry-on-validation-error loop is real. Bulk applies return both `updates` and `rejected` arrays so Codex can retry partial failures. Skill updated with "Writing Content for Apply Tools" section per spec. Build green. **R28 status: shipped first pass — pending Supabase application of `2026-05-14_apply_script_rpc.sql` before `apply_script` works on live projects.**
- 2026-05-14 — Claude filed R32 (per-call model override), R33 (model-bias correction system), R34 (apply-only tools for harness-native media output) as new recommendations from the 2026-05-13 test session's friction. Doctrine §4 updated with the nuance that media generation tool-call entries are not permanent boundaries — they reflect today's harness capability; image gen is mixed, video/audio are tool-only today but watch this space. Both paths must converge at the same apply layer regardless of which engine produced the bytes. Polish Items section added to the ledger with 10 items (P-poli-01 through P-poli-10) covering replay idempotency, event types registry, compare_versions tool, web studio override badge, R6 phase 2 split, structured deviation field, audit log rotation, R7 catalog deprecation, R11 notifications, and R29 RLS policies. None block testing; all are "address opportunistically when adjacent code is being touched."
- 2026-05-14 — End-of-session sync before compact. Director-session-on-full-codebase pattern declared validated end-to-end (two test sessions, all stabilization friction items shipped). Decision on R17 distribution path: Pattern B (npm bootstrap `@lahari/setup init`) chosen over Pattern A (pure conversational install) for robustness — script execution is deterministic, testable, idempotent, debuggable, and harness-portable in ways agent-interpreted install specs aren't. Claude rewrote R17 ledger entry to reflect Pattern B; updated R34 with the native-imagegen ritual (preserve source, style as grade not content) caught in main-Claude's image-edit diagnosis; added "Current State" snapshot at top of ledger for fast post-compact orient; wrote `docs/r17-distribution-design.md` (~470 lines) covering the bootstrap script, `@lahari/mcp-server` HTTP-client package, OAuth localhost callback (R16 implementation), per-harness MCP registration syntax (Codex + Claude Code, with the known arg-order quirk), templates, error handling for 7 common failure modes, update/doctor commands, implementation order (~4-5 focused days estimated). R17 status moved to `agreed, design ready`. Next workstream: Codex implements R17 from the design doc; Claude reviews; Saul tests on a clean non-codebase workspace. Pending operational: apply `migrations/2026-05-14_apply_script_rpc.sql` to Supabase before R28's `apply_script` works on live projects.
- 2026-05-14 — Codex started R17 implementation with the hosted Director API facade. Added `server/routes/director.ts` and mounted it at `/api/director` behind existing `requireAuth`. First-pass routes expose version, project list/packet/actions, remote session attach/get, shot packet, storyboard status, R28 apply-only tools, R29 config apply/revert, storyboard/video plans, storyboard generation/bulk/refine/lock/unlock, video generation, and issue capture. Routes enforce project ownership before loading full project state, return `{ ok, data, error }` envelopes, and record audit rows as `source: 'mcp-remote'`. Verified with `npx tsc --noEmit`; full build still pending in this pass.
- 2026-05-14 — Codex added first-pass `@lahari/mcp-server` package under `packages/lahari-mcp-server`. It is a standalone Node 20 ESM MCP server with no engine imports: reads `~/.lahari/credentials`, refreshes Supabase JWTs when within 5 minutes of expiry, sends `X-Lahari-MCP-Version` on every request, unwraps `{ ok, data, error }` envelopes from `/api/director/*`, and preserves structured `auth_expired` / validation / drift errors for the agent. Tool-name parity with internal `mcp/lahari.ts` is intentional: supported tools call the hosted facade, while legacy local-file/preview tools return a loud `remote_facade_gap` error rather than silently disappearing. Verified with `node --check`, `npm pack --dry-run --cache /private/tmp/lahari-npm-cache`, `npm run build`, and `git diff --check`. The first `npm pack --dry-run` hit Saul's root-owned `~/.npm` cache issue; rerun with temp cache passed.
- 2026-05-14 — R17 pivoted to hosted remote MCP as the primary artist distribution path, keeping `@lahari/mcp-server` as fallback. Codex added account-specific Lahari MCP tokens (`lahari_mcp_tokens` migration + `server/services/mcpTokens.ts`), authenticated `/api/mcp-tokens` list/create/revoke routes, and a stateless Streamable HTTP `/mcp` endpoint. `/mcp` requires `Authorization: Bearer lahari_mcp_...`, verifies the token hash, resolves to `user_id`, then registers the same director tool surface with per-tool project ownership checks and `mcp-remote` audit rows. `docs/r17-distribution-design.md` and R17 ledger text updated to remote-first. Pending next slice: `/connect` page that signs in and prints Codex/Claude install snippets.
- 2026-05-14 — Codex added the first-pass `/connect` page. It uses existing Supabase Google auth, calls `/api/mcp-tokens` to create a 30-day Lahari MCP token, shows the raw token once, renders Codex + Claude setup snippets, lists existing tokens, and can revoke them. Also fixed the backend-generated Claude snippet to reference `LAHARI_MCP_TOKEN` instead of embedding the raw token directly in the `claude mcp add` command.
- 2026-05-14 — R17 notebook hybrid landed. Codex added `buildProjectNotebook` and exposed it through hosted MCP as `write_project_notebook`, plus `/api/director/projects/:projectId/notebook` for the fallback package. The hosted MCP initialize instructions now teach the attach → write notebook → read mirrors → apply → refresh ritual. `hydrate_project_workbench` remains deprecated/unsupported on hosted remote; notebook files are born from the tool response and written by the harness into any empty workspace.
- 2026-05-14 — Codex completed the warm-refresh half of the R17 notebook hybrid. `config/hashes.json` no longer churns on every notebook generation; its generation marker uses project state time instead of wall-clock time. Apply/generation/config responses now include `changedArtifacts` payloads for the notebook files that should be refreshed: R28 apply-only tools, storyboard prompt write/bulk write, storyboard generation/bulk generation/refine/lock/unlock, video generation, and R29 preferences/prompt override apply/revert. Full script apply additionally returns `notebookRefresh.recommended` because script replacement can leave obsolete per-shot mirror files behind. Verified with `npx tsc --noEmit`, `npm run build`, and `git diff --check`.
- 2026-05-14 — Codex added project-local native skill payloads to `write_project_notebook`. The notebook now includes `CLAUDE.md`, `.agents/skills/{lahari-director,storyboard-prompt-craft,script-doctor,continuity-auditor,style-ref-critic,render-triage}/SKILL.md`, and matching `.claude/skills/*/SKILL.md` files, all sourced from the tracked Lahari skill shards. MCP initialize instructions and R17 docs now tell agents to write the skills and restart/open a fresh harness session so native skill discovery can pick them up. Verified with `npx tsc --noEmit`; build pending in this pass.
- 2026-05-14 — Codex added MCP tool annotations across hosted `/mcp`, internal `mcp/lahari.ts`, and fallback `packages/lahari-mcp-server`. Tool registration now supplies `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` from a shared name-based classification: read/plan/notebook tools are read-only+idempotent; apply/generate/refine/lock/unlock/capture tools are mutating; `apply_script`, rollback, and revert are marked destructive. Director HTTP facade is intentionally unchanged because annotations are an MCP `tools/list` concern. Verified with `npx tsc --noEmit`; build pending in this pass.
- 2026-05-15 — R29 phase 2 shipped: `concept`, `script`, `shot_prompts` added to the project prompt override allowlist alongside `storyboard` and `video`. DB check constraint updated via `2026-05-15_expand_project_prompt_override_kinds.sql`. All four MCP surfaces (hosted `/mcp`, director facade, internal CLI/MCP, fallback npm package) wired. Migration applied to Supabase.
- 2026-05-15 — Security hardening pass (`535f4c1`): in-memory rate limiting on `/mcp`, `/api/director/*`, `/api/mcp-tokens`; body size limits at the Express layer (2MB/5MB/32KB); Zod max sizes on hosted MCP tool payloads; audit redaction for sensitive keys (token/secret/auth/password) and content keys (body/script/concept/prompt) with summary metadata; `lahari_capture_issue` requires projectId + ownership check. Three watch items remain: scoped per-project MCP tokens, RLS policies on `lahari_mcp_tokens`, edge/DB-backed rate limit for production scale.
- 2026-05-15 — Realtime agent operation presence shipped (R36, commit `f31689e`): `lahari_agent_operations` table with RLS, Supabase realtime publication adds for 13 tables, `start/finishAgentOperation` wired into both `/api/director/*` and `/mcp` `audited` wrappers, frontend channel subscription with debounced refresh. Migration `2026-05-15_add_agent_operations_realtime.sql` applied. Aesthetic follow-up: header pill quieted to `surface-inset` + colored pulsing dot (commit `71ea3a7`) to match the app's single-signal pill pattern.
- 2026-05-15 — `/connect` redesign (commit `d5c6f3d`) plus follow-ups: three numbered steps, tabbed harness switching (Codex Desktop / Claude Code), platform sub-toggle (macOS/Windows/Linux/CLI) auto-detected from User-Agent, verify-success emerald callout, troubleshooting drawer with concrete failure-mode fixes, "I've copied it safely" confirmation chip that masks the token after copy. Cherry-picked to main, deployed.
- 2026-05-15 — Abstraction platform branched (R38). Plan seeded at `docs/abstraction-platform-plan.md`. Decision: brand is **Mirage**, multi-tenant SaaS single brand for now, separate Supabase + Railway for `studio_*` schema, music video + anime as v1 proof. Work proceeds on `abstraction` branch in a separate worktree; engine fixes flow `codex-native-studio → abstraction` via merge.
- 2026-05-15 — Ledger cleanup. R17/R28/R29 statuses updated to shipped + validated. R35 (write_project_notebook), R36 (realtime presence), R37 (per-scope ShotCard indicator, proposed), R38 (abstraction platform) filed. Current State snapshot rewritten — distribution is real, no operational items pending, next workstream is the abstraction platform on its own branch. `docs/templates/AGENTS.md` archived (obsoleted by write_project_notebook generating per-project AGENTS.md).
- 2026-05-17 — Agency/free-the-director pass shipped first pass. R32 per-call model overrides added to storyboard/video plan + generation tools; R39 Codex-native style direction apply added (`apply_style_direction`) alongside existing `apply_concept`; R40 character/environment look recipe overrides added as project prompt kinds and consumed by look generation at runtime; R41 per-shot workflow mode (`auto | storyboard | keyframe`) added with apply tool and plan/generation gating. Notebook version bumped to `2026-05-17.agency-pass-v1`; docs, MCP instructions, and skills updated. Requires applying `migrations/2026-05-17_agency_pass_models_workflow_looks.sql` before using new override kinds/workflow modes in production.
- 2026-05-18 — R42 release state updated. Migration `2026-05-17_add_cli_notebook_sync_tokens.sql` applied, `@ssaulgoodman420/lahari-cli@0.1.0` published to npm, and main pushed through `1a7942e`. Railway deploy attempted but blocked by a Railway outage / temporarily paused deploys. When Railway recovers, run `railway up --detach` from the main worktree and smoke-test `mint_cli_token` plus `npx @ssaulgoodman420/lahari-cli@0.1.0 sync <projectId>`.
