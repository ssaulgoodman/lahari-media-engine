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
| **1. Project config** (per-project, agent-owned) | Project-specific prompts, model preferences, taste notes, glossary, decision log | Project owner's director agent | Direct file edits in `.lahari/projects/<id>/config/` → typed apply tool persists to Supabase |
| **2. Project state** (per-project, canonical in Supabase) | Concept, script, style, cast, env, scenes, shots, locks, prompts, assets | Project owner's director agent | Always via typed `apply_*` tools with preview/drift/rollback |
| **3. Engine truth** (global, immutable from director's view) | Global prompt catalog, provider routing, engine code, migrations | Engine sessions only | Direct file edits → commit |

**The director agent gets full freedom in tier 1, mediated power in tier 2, no access to tier 3.**

When an agent recognizes "I need to switch providers because credits ran out" or "this song needs a different prompt recipe," the answer is **always** a tier-1 edit, never a tier-3 code change. Tier-3 fixes happen in engine sessions, not director sessions.

This tier model is what makes the future npm-package distribution safe: the artist's `@lahari/director` workspace contains zero engine code, so tier-3 is physically inaccessible. Tier-1 power scales fully; tier-3 stays with engineers.

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
- `.lahari/` files = desk copies, read freely, edit freely, sync via apply tools
- Codex's in-context understanding = derived from packets which derive from Postgres
- Local journal (`.lahari/sessions/<id>/journal.md`) = working memory only, not authoritative

**Never dual-write.** If a piece of state lives in tier 1 or tier 2, it lives in Supabase. Local files mirror it. Don't write to both as parallel sources.

**Exception:** the session journal lives only on disk. That's intentional — it's Codex's working memory, not engine state. The `lahari_director_events` table captures the structured events that the journal narrates.

---

## 7. Distribution Arc

**Today (solo operator):** single repo, bimodal `AGENTS.md`, both director and engine sessions in the same worktree. Works because the operator does both.

**Soon (second operator):** extract director tools as `@lahari/director` npm package. Engine repo stays internal. Artist runs:

```bash
npx @lahari/director init ~/lahari-studio
cd ~/lahari-studio
npx @lahari/director setup
# open Codex Desktop on ~/lahari-studio
```

Package contains CLI, MCP server, skill, AGENTS.md template, setup commands. No engine code. Auth via browser-bridged JWT (no service key on artist's machine).

**Plugin distribution gates** (all must be true before packaging):
1. Second-user setup is one command.
2. MCP surface stable, no breaking changes weekly.
3. At least one non-Saul operator has run Blueprint → Studio → Render end-to-end.
4. The director surface is extractable as a separate distribution without engine dependencies at runtime.

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

Every new Codex session in this workspace is one of two types. Identify which one before doing anything else.

**Director session** — operating Lahari for a specific song or project. Attaches to a Lahari project via MCP. Default when the user names a song, project, video, scene, shot, or creative work.

**Engine session** — improving Lahari itself (code, prompts, infra, docs). Does not attach. Default when the request is about the codebase, refactoring, or fixing Lahari.

If unclear, ask one sentence to clarify.

### Director Session Opening Move

1. **Verify MCP visibility.** Check that `mcp__lahari__*` tools are available. If not, do not fall back to CLI. Stop and tell user to quit and reopen Codex Desktop.
2. **Attach.** Call `attach_director_session` with the project ID. If user named a song but you don't have the ID, call `list_projects` first.
3. **Read `directorEvents.recentEvents`** — decisions the artist made since last session.
4. **Read `diagnosis`** — `productionRead`, `bottleneck`, `weakLinks`, `nextApprovedAction`.
5. **Suggest renaming** the Codex session to the project title.

**Opening message:**
- Acknowledge in production terms: "Working on Krishna Bhajan..." — not "hydrating" or "fetching."
- Summarize the production read in one sentence.
- Name the bottleneck.
- Mention anything material from `recentEvents`.
- Propose `nextApprovedAction` unless events suggest the artist moved past it.

**Banned vocab in artist-facing text:** "hydrate," "workbench," "packet," "checkpoint." These are plumbing the artist doesn't need to think about. Say what you're going to *do*.

### Engine Session Opening Move

Direct: `pwd`, `git status --short --branch`, then ask user what to build or fix. No project attach. Full shell + edit + git available.

### Friction Capture

When something feels wrong mid-session, do not guess. Call `lahari_capture_issue` with severity, summary, and any suspected fix. The tool auto-collects recent audit context. Engine session reads issues at start. Friction → fix → continue.

---

## 10. References

- **Status of recommendations and verification log:** `docs/codex-native-review-ledger.md`
- **Vision detail and milestone history:** `docs/codex-native-studio.md`
- **Director taste rubric (concept/script/style/shot taste checks):** `.agents/skills/lahari-director/SKILL.md`
- **Pipeline anatomy (backend control flow):** `docs/pipeline-anatomy.md`
- **Prompt catalog (read-only inventory):** `server/prompts/catalog.ts`
- **Codex-native tools surface:** `server/services/codexStudio.ts`, `cli/lahari.ts`, `mcp/lahari.ts`
