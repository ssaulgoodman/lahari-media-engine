# Codex-Native Operating Doctrine

**Purpose.** The durable operating contract for the codex-native-studio lane. Codex reads this at the start of any substantive engineering pass. Updated when the architecture changes, not when individual features ship — that's what `codex-native-review-ledger.md` is for.

**Stability rule.** Sections here are stable enough to design around. If a recommendation is still in flight, it lives in the ledger as an R# item until accepted, then lifts here. Once here, sections only change when the architecture genuinely changes, not for every commit.

---

## 1. Vision Anchor

Lahari should be operable from a polished general-purpose agent harness (Codex Desktop, Claude Code, future ChatGPT desktop), not become a new agent harness itself. The repo is the creative operating system. The harness brings long threads, worktrees, browser/computer use, skills, MCP, memory, and a polished chat surface. Lahari exposes domain truth as tools, taste as skills, and state as artifacts.

The bet: every time the harness gets better (memory, computer use, voice, mobile), Lahari directors get better for free. The moat is domain truth — schema, events, taste skills, deterministic pipeline — not harness work.

---

## 2. The Three Editability Tiers

The central organizing principle. Every piece of state in this system lives in exactly one tier. Knowing the tier tells you who can edit it and how.

| Tier | Examples | Who edits | How |
|---|---|---|---|
| **1. Project config** (per-project, agent-owned) | Project-specific prompts, model preferences, taste notes, glossary, decision log | Project owner's director agent | Direct file edits in `lahari/projects/<id>/config/` inside the artist notebook → typed apply tool persists to Supabase |
| **2. Project state** (per-project, canonical in Supabase) | Concept, script, style, cast, env, scenes, shots, locks, prompts, assets | Project owner's director agent | Always via typed `apply_*` tools with preview/drift/rollback |
| **3. Engine truth** (global, immutable from director's view) | Global prompt catalog, provider routing, engine code, migrations | Engine sessions only | Direct file edits → commit |

**The director agent gets full freedom in tier 1, mediated power in tier 2, no access to tier 3.**

When an agent recognizes "I need to switch providers because credits ran out" or "this song needs a different prompt recipe," the answer is **always** a tier-1 edit, never a tier-3 code change. Tier-3 fixes happen in engine sessions, not director sessions.

This tier model is what makes the remote-MCP distribution safe: the artist notebook contains zero engine code, so tier-3 is physically inaccessible. Tier-1 power scales fully; tier-3 stays with engineers.

---

## 3. MCP vs CLI Boundary

**MCP is the production surface for director/artist work. CLI is engine infrastructure plus fallback.**

| Surface | Purpose | Audited | When to use |
|---|---|---|---|
| MCP | Artist/director chat surface | Yes (start + finish per tool call) | Always in director sessions |
| CLI | Engine sessions, setup, cron, diagnostics | Yes (audit shim wraps `main()`) | Never in director sessions; freely in engine |

**Director-session rule:** at session start, verify the Lahari MCP namespace is visible. If `mcp__lahari__*` tools aren't available, do not fall back to CLI. Stop and tell the user to quit and reopen Codex Desktop. Continue only after MCP is visible.

**Engine-session rule:** full freedom. CLI, shell, file edit, git, anything. Audit log catches CLI calls that touch project state for accountability.

**CLI being a superset of MCP capability is intentional** — it gives debuggability, automation, and disaster recovery without polluting the artist surface.

---

## 4. Harness-Native vs Tool Call

Not every operation should round-trip through the Lahari backend to call an LLM. The harness already has Claude/GPT/Gemini loaded. Use it.

**Rule:** if the operation is "read existing structured content, rewrite it per instruction, validate against constraints, persist," it's harness-native. The harness writes the new content; an apply-only tool validates and persists.

| Operation | Path | Reason |
|---|---|---|
| Concept gen, refines | Harness-native | Text generation, no double-hop needed |
| Script gen, refines | Harness-native | Conversational, structured output, constraint validation |
| Storyboard prompt + cut plan writing | Harness-native | Text, conversational |
| Storyboard prompt refines | Harness-native | Read existing + rewrite per instruction |
| Video prompt writing/refines | Harness-native | Text, derived from cut plan |
| Style direction brainstorm | Harness-native (rare; styles → presets) | Text |
| Style preset lock | Tool call | Image upload |
| Style visualization | Tool call | Image generation API |
| Character/environment looks | Tool call | Image generation API |
| Storyboard board gen | Tool call | Image generation API |
| Storyboard board refine (edit_image) | Tool call | Image generation with image input |
| Video gen | Tool call | Video API |
| Last-frame extraction | Tool call | ffmpeg |
| Audio analysis (lyrics, structure) | Tool call | Gemini audio API |
| Render | Tool call | Remotion / ffmpeg |
| All tier-2 state mutations | Tool call | Apply tools, drift checked |

**The seam: apply-only tools.** Take pre-written structured content, validate against constraints (schema, scene durations, prompt length caps, etc.), persist via the same path as existing apply tools, record a director event. No LLM call inside the tool. Codex writes the content; the apply tool is the constraint enforcer. If the content violates a constraint, apply rejects with structured error and Codex retries.

**The web studio retains its own "Generate" buttons** with backend LLM endpoints so non-harness users still get AI authoring. Two paths converge at the same persistence layer.

**Nuance on media generation as harness capabilities evolve.** The "tool call" entries above are not permanent boundaries — they reflect where harness capability is *today*. The honest framing is "does the harness have a capable native generator for this specific case":

- **Text** — always harness-native. Harness has the LLM loaded; no reason to round-trip.
- **Image** — *mixed today*. Harness-native is fine when the case is simple (single-image input, no multi-reference grounding, no specialized model needed). Tool call when multi-ref grounding (locked style + cast + env) or a specialized model is required. As harnesses grow multi-ref image capability, more cases shift to harness-native. **R34** files the apply-only tools for harness-native image output so the pipeline can absorb it.
- **Video** — tool call today. No major harness has native video gen capability yet. Watch this space.
- **Audio** — tool call today. Same as video.

**Both paths must converge at the same apply layer.** Whether bytes came from a harness-native gen or a dedicated tool, persistence + drift + events go through one code path. The artist never knows which engine produced the result; the architecture composes.

---

## 5. Permission Model

Three tiers within tier-2 (project state) operations:

| Operation tier | What | Approval before running |
|---|---|---|
| Read | Packets, sheets, status, audit, journal | Never — free |
| Preview | Paid AI call producing a draft + diff | Yes (it costs money) |
| Apply | DB write that persists state | Yes; refuses anon key; validates drift |

**Every plan or apply response must include:**
- What action will run
- What entities it affects
- Estimated cost (if paid)
- Rollback path (which preview/snapshot reverses it)
- Whether the operation is fork-recoverable

**Drift detection on every apply.** Validate the preview's `after` snapshot matches current state before writing the `before` snapshot back. Refuse silently-overwritten human edits.

**Rollback is a first-class tool, not a paper exercise.** Every preview's `before` snapshot is the inverse. `rollback_*` tools restore it with the same drift validation.

---

## 6. Source of Truth

**Supabase Postgres is canonical for everything in tier 2 (project state) and tier 1 (project config after persistence).**

- Web studio state = cache of Postgres
- `lahari/` notebook files = desk copies and drafts. Read mirrors freely, edit drafts/config files surgically, sync via apply tools
- Codex's in-context understanding = derived from packets which derive from Postgres
- Local journal (`lahari/projects/<id>/journal.md`) = working memory only, not authoritative

**Never dual-write.** If a piece of state lives in tier 1 or tier 2, Supabase remains canonical. Local files are working surfaces: `mirrors/` reflect Supabase, `drafts/` hold surgical edits awaiting apply, and `config/` holds project override bodies awaiting apply. Don't treat local files and Supabase as parallel truths.

**Exception:** the session journal lives only on disk. That's intentional — it's Codex's working memory, not engine state. The `lahari_director_events` table captures the structured events that the journal narrates.

---

## 7. Distribution Arc

**Engine sessions (this repo):** this repo is for code, prompts, infra, docs, schema, and deployment. Internal MCP and CLI are available for engine-side debug, smoke tests, and recovery, but they are not the artist/director surface. When an engineer wants to test director behavior, use an artist-shaped empty folder with remote MCP installed.

**Artist sessions (production today):** remote MCP at `https://lahari-media-engine-production.up.railway.app/mcp`, authenticated with personal `lahari_mcp_...` tokens minted at `/connect`. Artist opens any empty folder in Codex Desktop or Claude Code, adds the MCP server with the one-line snippet from `/connect`, restarts the harness, and asks "open <song name>." The agent resolves the song/project via `resolve_project` (with `list_queue` and `search_catalog` for browsing/discovery), attaches via `attach_director_session`, calls `write_project_notebook(projectId)`, and the workspace materializes itself — `AGENTS.md` + `.agents/skills/*` + mirrors + drafts + config + journal all written by the tool, not by an `npx setup` step.

Notebook roles:
- `mirrors/` are read-only Supabase snapshots. Refresh them from notebook output or `changedArtifacts`.
- `drafts/` are editable working copies. In phase 1, `drafts/script.md` is the script surgery surface; apply with `apply_script_markdown`, which parses strict markdown, checks `scriptFingerprint` drift, validates references/durations, and persists through the atomic script apply path.
- `drafts/storyboards/<scene>.md` files are scene-level storyboard prompt + Seedance cut-plan surfaces. Apply with `apply_storyboard_scene_markdown`; write adjacent shots together so continuity, motifs, and pacing are authored as one scene rather than as isolated prompt calls.
- `config/` is the project override layer. Edit prompt/preference files locally, then persist with config apply tools.
- `journal.md` is local working memory, not canonical project state.

Earlier design proposed an `@lahari/setup` npm bootstrap (Pattern B). It was replaced by the remote-MCP-primary path: remote MCP is the canonical distribution. `@lahari/mcp-server` exists in this repo as a local fallback/debug package, but publishing it is a separate operational step. No engine code on the artist's machine. No service key. No Node requirement on the happy path. Auth via account-scoped bearer token.

**Plugin distribution gates** (all true as of 2026-05-15):
1. ✅ Second-user setup is two terminal commands (`export TOKEN=...` + `codex mcp add ...` / `claude mcp add-json ...`) plus a one-time harness restart. `/connect` page issues the snippets.
2. ✅ MCP surface stable; `X-Lahari-MCP-Version` header + `minimumMcpServerVersion` give us a compatibility lever for future evolution.
3. ✅ First non-Saul operator has run the install + workspace materialization end-to-end (2026-05-15 first artist test).
4. ✅ Artist's MCP path has zero engine dependencies at runtime — `/mcp` is HTTP-only, talks to Supabase via the artist's JWT, no in-process service-layer call required.

**Future fork — the abstraction platform (`Mirage`):** R38 / `docs/abstraction-platform-plan.md`. Same engine code, separate Supabase + Railway, `studio_*` schema, SeedKind/Workflow/Preset decomposition for music video / anime / ads / reels. Single-brand multi-tenant SaaS. Develops on the `abstraction` branch in a separate worktree. Engine fixes flow forward (`codex-native-studio → abstraction`); Mirage-specific work stays on its branch.

---

## 8. Discipline — Things NOT to Build

Easy to drift on these once gaps appear in the harness. The temptation to plug them with Lahari-side workarounds is the architecture's biggest risk.

- ❌ No Lahari TUI.
- ❌ No Lahari chat surface.
- ❌ No Lahari "agent runner" that operates without Codex/Claude in front.
- ❌ No custom permission/approval UI — let the harness handle it.
- ❌ No native visual review tools — deep-link to the web studio.
- ❌ No critique tools that are just LLM-with-rubric — that's a skill.
- ❌ No workflow tools (`review_scene`, `pre_lock_audit`, `final_checklist`) — skill compositions over primitives.
- ❌ No Lahari-side hot-reload of MCP tools — harness gap, file upstream.
- ❌ No tier-3 code edits from director sessions — that's an engine session.

When a gap shows up in Codex/Claude Code: file it upstream, route around with browser MCP or downloadable HTML, do not build a vertical workaround.

---

## 9. Session-Type Protocol

Sessions are split by **workspace**, not by toggle inside one workspace:

- **Engine sessions** — happen in this repo (`lahari-codex-native` or `abstraction` worktree). Improve code, prompts, infra, docs, schema. Full shell + edit + git access. Internal MCP and CLI are available here for engine-side debug, scripting, and disaster recovery, but those are *tools*, not a separate session type.
- **Director sessions** — happen in an artist workspace (any empty folder with the remote MCP installed). Attach to a Lahari project via `/mcp`, materialize the workspace via `write_project_notebook`, operate through the apply tool surface. The orchestrator skill at `.agents/skills/lahari-director/SKILL.md` (materialized into the artist workspace by the notebook tool) drives the protocol.

Earlier doctrine ran both in the same worktree as a transitional pattern from before distribution shipped. That's no longer the recommended path — testing director-session behavior is cleaner from an artist-shaped workspace (any empty folder + remote MCP) than from this engine repo.

### Engine Session Opening Move

Direct: `pwd`, `git status --short --branch`, then ask user what to build or fix.

### When an engineer wants to test director-session behavior

Open any empty folder in Codex Desktop (or Claude Code), mint a token at `/connect` against your own account, paste the install snippet, restart the harness. Same path an artist takes. The behavior you observe is what artists actually experience — testing it from inside the engine repo gives a falsely-comfortable shape because internal MCP is in-process.

### Friction Capture

When something feels wrong mid-session, do not guess. Call `lahari_capture_issue` with severity, summary, and any suspected fix. The tool auto-collects recent audit context. Engine sessions read captured issues at start.

---

## 10. References

- **Status of recommendations and verification log:** `docs/codex-native-review-ledger.md`
- **Vision detail and milestone history:** `docs/codex-native-studio.md`
- **Director taste rubric (concept/script/style/shot taste checks):** `.agents/skills/lahari-director/SKILL.md`
- **Pipeline anatomy (backend control flow):** `docs/pipeline-anatomy.md`
- **Prompt catalog (read-only inventory):** `server/prompts/catalog.ts`
- **Codex-native tools surface:** `server/services/codexStudio.ts`, `cli/lahari.ts`, `mcp/lahari.ts`
