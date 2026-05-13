# Codex-Native Review Ledger

**Purpose.** Status tracking for the codex-native-studio lane: what's been proposed, shipped, validated, or invalidated. Append-only verification log.

**Operating principles and architecture rules live in `docs/codex-native-doctrine.md`** — read that for "how the system works." This file is the dated record of decisions and their fates.

**How to use.** Each substantive change opens or updates an R# entry. When a recommendation moves from `proposed` to `shipped` to `validated`, that's a verification log append. Don't restate doctrine here — link to the relevant doctrine section.

**Last touched:** 2026-05-13 — Ledger slimmed: vision, principles, and discipline lifted to `docs/codex-native-doctrine.md`.

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

Status: **partially shipped** · Raised: 2026-05-13

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

Status: **shipped first pass** · Raised: 2026-05-13 · Updated: 2026-05-13

Parallel testing uses two Codex sessions on the same worktree: one director session operating a real song, one engine session fixing what breaks. The handoff needs evidence, not memory.

**Shipped first pass:** every Lahari MCP call writes redacted JSONL start/finish audit rows to `.lahari/audit/<projectId>/<date>-calls.jsonl` or `_unscoped`. CLI command `npm run lahari -- audit tail [projectId|_unscoped] [n]` prints recent entries for engine debugging. MCP tool `lahari_capture_issue` lets the director session write `.lahari/issues/<timestamp>-<severity>.json` with a summary, suggested fix, and recent audit tail.

**Why it matters:** Makes real-project testing debuggable. The engine session can see exactly which tool ran, how long it took, what it returned in summary, and what Codex thought was wrong.

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

Status: **proposed** · Raised: 2026-05-13

Engine + director live in one repo today because Saul is the sole operator. When a second person joins — an artist who shouldn't see or touch engine code — they can't be handed this repo (overwhelming, destructive ops accessible, exposes engine internals).

**Recommended path: extract director tools as an npm package.**

Package contents:
- `bin/lahari` (CLI)
- `bin/lahari-mcp` (MCP server)
- `skills/lahari-director/SKILL.md`
- `templates/AGENTS.md` (director-mode workspace template)
- `setup` / `init` commands

Artist onboarding:
```bash
npx @lahari/director init ~/lahari-studio
cd ~/lahari-studio
npx @lahari/director setup
# open Codex Desktop on ~/lahari-studio
```

They never see the engine repo. The MCP server depends on the hosted Lahari backend (Railway) via HTTP. Auth via R16 browser-bridged JWT — no service key on artist's machine.

**Do not build yet.** The CLI/MCP/skill are already self-contained units in `lahari-codex-native/`; extraction is ~1-2 days of plumbing work. Build when at least one of these triggers:
1. Saul wants to onboard another operator.
2. AGENTS.md is too noisy for director-only use.
3. A real "artist needs this" moment arrives.

Adds a fourth gate to R10's plugin-distribution checklist: **the director surface is extractable as a separate distribution without engine dependencies at runtime.**

**Why it matters:** Resolves the "give the artist this repo" question without compromising engine separation. Makes the architecture's "Codex inhabits Lahari" claim true for non-engineers, not just Saul.

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

**Shipped:** `get_storyboard_status`, `write_storyboard_prompt`, `bulk_write_storyboard_prompts`, `generate_storyboard` alias, `bulk_generate_storyboards`, `refine_storyboard_image`, `lock_storyboard`, and `unlock_storyboard` are exposed through MCP. CLI supports the same core apply commands for engine smoke/debugging. Bulk tools accept optional `shotIds`, skip locked shots, default to missing/error/stale work, and require explicit `force` for rewrites/regeneration.

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

Status: **designed direction** · Raised: 2026-05-13

R25 shipped two useful but transitional tools: `write_storyboard_prompt` and `bulk_write_storyboard_prompts`. They wrap backend LLM calls, which violates doctrine §4. Keep them for the live test loop, but do not extend that pattern.

R28 replaces backend LLM-wrapper tools with apply-only primitives. Codex writes the text using the director skill and local project context; the tool validates, persists, records a director event, and returns drift/rollback metadata. The web studio can keep its backend generate/refine endpoints for non-Codex users.

Apply-only scope:
- `apply_storyboard_prompt` / `apply_storyboard_prompts_bulk`
- `apply_video_prompt` / `apply_video_prompts_bulk`
- later: concept, script, and keyframe shot prompt apply-only variants

**Why it matters:** This is the seam that makes Lahari Codex-native instead of another app that calls an LLM behind Codex's back. Codex owns taste-heavy language work; Lahari tools own validation and persistence.

---

### R29 — Project config and prompt override design

Status: **designed, review fixes applied** · Raised: 2026-05-13

R29 is the editable project-config umbrella for R22. Phase 1 is deliberately narrow: per-project preferences and storyboard/video prompt overrides. Later phases can add glossary, taste notes, decisions, and richer inheritance once the core path proves itself.

Design doc: [`docs/r29-project-config-design.md`](r29-project-config-design.md)

Phase 1 objects:
- `.lahari/projects/<projectId>/config/preferences.json`
- `.lahari/projects/<projectId>/config/prompts/storyboard.md`
- `.lahari/projects/<projectId>/config/prompts/video.md`
- Supabase canonical tables for persisted project config and prompt overrides (`project_id` / `scope_id` are `text`, matching existing Lahari IDs)
- apply tools: `apply_project_preferences`, `apply_project_prompt_override`, `revert_project_prompt_override`
- history from day one: apply inserts a new active override row and marks the old one inactive; revert reactivates the previous row or falls back to global
- no preview tool by design: Codex edits the desk-copy file and the apply tool validates/persists after approval

**Why it matters:** Project-specific taste improvements should be project-owned configuration, not tier-3 engine edits. This gives Codex a safe editable surface for model choices and prompt recipes while keeping Supabase canonical.

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
