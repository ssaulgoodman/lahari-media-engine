# R32 — Artist Distribution + Onboarding Plan

**Status:** Draft for review · 2026-05-14
**Owner:** Claude (planning) · Codex (implementation, per their R32 framing)
**Scope:** Lahari (internal Bhakti music-video tool) — single artist v1, with module abstraction reserved for future tracks.

---

## Intent

Today's working setup — Codex Desktop attached to a worktree, MCP tools functioning, web studio reflecting state, the artist (you) typing natural language at the agent — is the v1 distribution model. It just needs to be:

1. **Repeatable** for a second artist without manual hand-holding.
2. **Polished** in a few specific places (auth flow, prompt edit loop, onboarding skill).
3. **Documented** enough that the agent (Codex) reliably knows what to do when a new artist says "set up Lahari."

We are not building a CLI binary that artists run by hand. We are not building a marketplace plugin. We are packaging the existing working flow so that the agent's natural-language install path is reliable end-to-end.

---

## Non-goals (deferred)

- **Domain abstraction** (anime / real-estate / ads modules with their own DBs and configs). Comes after Lahari v1 is solid.
- **Self-service API keys** for the artist. v1 uses Lahari's shared Railway-side keys; artist credentials only grant workspace access via OAuth.
- **Claude Code support.** Codex Desktop is the v1 target host. Claude Code support is a separate track once the Codex flow is proven.
- **Marketplace / public npm release.** Internal `git-direct` distribution (`npx github:lahari/lahari-codex setup` style) for the first additional artist; npm publish only once the install spec stabilizes.
- **Image apply tool** (`apply_storyboard_image_asset`). Deferred per user note — Codex doesn't natively imagegen today; Lahari API handles image gen server-side.
- **Gemini script writer.** Already deferred. Codex-native architecture makes external Gemini calls less attractive.

---

## Distribution model (the actual artist experience)

```
Artist (in Codex Desktop chat):
  "Set up Lahari for music video work."

Codex (driven by AGENTS.md + Lahari skill):
  → calls `npx github:lahari/lahari-codex init` (or equivalent bootstrap)
     • Writes operator AGENTS.md / skill files / prompt config folders into workspace
     • Writes MCP server config so Codex registers Lahari's MCP next session start
  → calls `npx github:lahari/lahari-codex login`
     • Opens browser (localhost callback OAuth via Supabase Auth)
     • Artist signs in, browser redirects to local port, token captured
     • Token stored at ~/.lahari/credentials
  → tells artist: "Setup complete. Restart Codex to load Lahari tools, then say 'start a music video for [song URL]'."

Artist restarts Codex once. From then on:
  "Start a music video for [song URL]"
  "Refine scene 3 — make it more meditative"
  "Show me the storyboard for shot 5"
  "Open the studio"  → opens browser to https://lahari-media-engine-production.up.railway.app
  "Edit the storyboard prompt template — use less mystical language"
    → Codex calls edit_prompt MCP tool → DB override saved → next runtime uses it
```

System architecture:

```
Artist machine                      Lahari (Railway)             
─────────────                       ───────────────              
Codex Desktop                       Express backend              
  │                                   │                          
  ├── AGENTS.md + skills            HTTP/MCP API ── Supabase     
  │     (operator role)                                   (DB + Storage)
  ├── Local MCP shim ─── bearer ──── Lahari MCP server            
  │                       token         (existing)                
  ├── ~/.lahari/credentials                                       
  └── chat with artist
```

Nothing about LLM keys, image gen, or video gen lives on the artist's machine. All of that stays server-side. The artist's machine has: Codex Desktop + operator context + a bearer token. That's it.

---

## Architectural decisions (resolved)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Prompts: DB-canonical, local-edit-and-apply loop** | Web studio + agent + future modules all need a single source of truth. Local files are editing convenience. Apply tool pushes local edits to DB. |
| D2 | **Auth: localhost-callback OAuth via Supabase Auth** | Invisible to the artist. No copy-paste tokens. Matches GitHub CLI / gcloud UX. |
| D3 | **Target host v1: Codex Desktop** | Where current testing happens. Avoids lowest-common-denominator skills. Claude Code support is a follow-on. |
| D4 | **Auth scope v1: long-lived bearer token** | Refresh-token flow can wait. v1 ships fast with token rotation as a v1.5 follow-up. |
| D5 | **Distribution: install spec endpoint on Lahari API + thin CLI wrapper** | `/install/codex/v1` returns the operator config; CLI wrapper (`lahari init/login/studio`) lets Codex call it via tools. Lines up with future module abstraction (each domain gets its own `/install/<module>` endpoint). |
| D6 | **CLI distribution channel v1: git-direct via `npx github:...`** | Iteration speed. npm publish only once install flow is stable. |
| D7 | **Web studio remains visual surface** | No regression. Codex + studio are complementary. Artist can use either or both. |
| D8 | **Scope of skill files: per pipeline stage** | One skill per stage (concept, script, style, characters/envs, storyboard, render). Each skill encodes what tools to call and when. |

---

## Components

### Foundation (already exists, may need polish)

| Component | Status | Polish needed |
|---|---|---|
| Lahari API on Railway | Live | None |
| MCP server + tools (`apply_*`, `write_*`, `lock_*`, `bulk_*`, `get_shot_packet`, etc.) | Working per codex's R31 audit | Audit for completeness across all stages |
| Web studio | Live | None |
| Supabase Auth (Google OAuth) | Live | Add CLI-bearer-token endpoint |
| Provider abstraction (Claude / GPT-5.5 / Gemini) | Live since 2026-05-13 | None |
| Render engine observability | Live since 2026-05-14 | None |
| Apply-tool pattern for text | Working per codex's R31 audit | None |

### New build (R32 deliverables)

| # | Component | Description | Est. |
|---|---|---|---|
| C1 | **Operator AGENTS.md / skill set** | Codex-as-operator instructions (separate from existing developer-facing AGENTS.md). Includes one skill file per pipeline stage. Tells Codex which MCP tools to call when. | 6-8 hrs |
| C2 | **Bearer-token auth endpoints** | (a) `POST /api/auth/cli-callback` to receive OAuth redirect and mint a long-lived token. (b) `Authorization: Bearer <token>` middleware on all MCP-callable routes. (c) Token revocation endpoint. | 4 hrs |
| C3 | **Install spec endpoint** | `GET /api/install/codex/v1` returns JSON manifest: file paths + contents + MCP config + post-install hints. Versioned for future updates. | 3 hrs |
| C4 | **CLI package** (`lahari-codex` on github) | Three commands the agent calls: `init` (fetches install spec, writes files), `login` (opens browser, captures token), `studio` (opens browser to web studio URL). Small Node package. | 6 hrs |
| C5 | **DB-backed prompt overrides** | Schema migration: `lahari_prompt_overrides` table (project_id, prompt_id, override_text, version, updated_by, updated_at). Read-through in all prompt-building functions (`claude.ts`, `openai-script.ts`, `storyboard.ts`, `gemini-script.ts`-future). | 6-8 hrs |
| C6 | **Agent-callable prompt edit tools** | MCP tools: `list_prompts(projectId)`, `read_prompt(projectId, promptId)`, `edit_prompt(projectId, promptId, newText)`, `reset_prompt(projectId, promptId)`. Edits flow to `lahari_prompt_overrides`. | 4 hrs |
| C7 | **Local workbench MCP tools** | Read-only inspection tools beyond what already exists: `get_project_status(projectId)`, `get_render_status(projectId)`, `list_active_renders()`. Maps to existing API endpoints. | 3 hrs |
| C8 | **End-to-end dry run + fixes** | Spin up a fresh worktree on a second account. Run the install flow conversationally. Fix whatever doesn't work. | 3-4 hrs |

**Total: ~35-40 hrs (4-5 days focused).**

---

## Build phases

### Phase 1 — Audit & polish foundations (Block A)

Before building C1-C8, audit what's already there:

- Confirm all MCP tools listed in codex's R31 report. Identify any missing tools for the operator role.
- Confirm bearer-token auth path. Today MCP "somehow auths" — make explicit how, and document.
- Confirm existing AGENTS.md / skills coverage. Identify gaps for operator use.

**Deliverable:** short audit note (`docs/r32-audit.md`) listing what works, what's missing, what's broken.
**Est:** 2 hrs.

### Phase 2 — Operator context (C1)

- Write operator-facing AGENTS.md (separate file or new section in existing AGENTS.md).
- Write skill files for each pipeline stage:
  - `skills/lahari-onboarding.md` — first-time setup, login, "show me what you can do"
  - `skills/lahari-concept.md`
  - `skills/lahari-script.md`
  - `skills/lahari-style.md`
  - `skills/lahari-characters.md`
  - `skills/lahari-environments.md`
  - `skills/lahari-storyboard.md`
  - `skills/lahari-render.md`
- Each skill names the relevant MCP tools, the expected inputs/outputs, common pitfalls, and the human-in-the-loop checkpoints.

**Deliverable:** operator AGENTS.md + skill set, committed to repo + included in install spec.
**Est:** 6-8 hrs.

### Phase 3 — Bearer-token auth (C2) + Install spec endpoint (C3) + CLI package (C4)

These three are tightly coupled — the CLI fetches the install spec, the install spec assumes auth, auth needs the CLI to receive callbacks.

Order within phase:
1. C2 — Lahari API exposes the CLI auth endpoints (callback, bearer middleware on MCP routes).
2. C3 — Install spec endpoint returns the file manifest.
3. C4 — CLI package implements `init` (fetches spec, writes files), `login` (browser + callback), `studio` (browser launcher).

**Deliverable:** Artist can run (via Codex calling these as tools) `init` → `login` → ready to use. Auth works end-to-end.
**Est:** 13 hrs.

### Phase 4 — Prompt overrides (C5) + edit tools (C6)

1. Schema migration for `lahari_prompt_overrides`.
2. Read-through in all prompt-building functions: check DB for override before using default.
3. MCP tools to list/read/edit/reset prompts.

**Deliverable:** Artist can ask "edit the storyboard prompt template" and have it persist. Web studio reflects.
**Est:** 10-12 hrs.

### Phase 5 — Workbench (C7) + dry run (C8)

1. Read-only MCP tools for inspection.
2. Spin up fresh Codex worktree on a different account; run the full onboarding conversationally.
3. Fix whatever doesn't work.

**Deliverable:** Second artist runs through onboarding + a small pipeline (queue → blueprint → studio → render) without manual intervention. Working video at the end.
**Est:** 6-7 hrs.

---

## Schedule (calendar)

If goal is "package out within 2 weeks":

| Day | Block | Output |
|---|---|---|
| 1 | Phase 1 audit | `docs/r32-audit.md` |
| 2-3 | Phase 2 (operator AGENTS.md + skills) | Operator context shipped |
| 4-5 | Phase 3 (auth + install + CLI) | Onboarding flow live, tested manually |
| 6-7 | Phase 4 (prompt overrides) | DB-backed prompts shipped |
| 8 | Phase 5.1 (workbench tools) | Inspection tools live |
| 9-10 | Phase 5.2 (E2E dry run + fixes) | Second-artist test passes |

Compressible if blocks run parallel (e.g., Phase 2 and Phase 3 can overlap if two operators).

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Codex's MCP server registration requires restart, breaking "one-chat install" UX | Acceptable for v1. Document the restart step. Investigate hot-reload for v2. |
| Localhost-callback OAuth doesn't work on artists with unusual network setups (firewalls, container envs) | Fall back to device-code copy-paste flow. Implement both, pick at runtime. |
| Prompt overrides cause runtime drift between agent and web studio if cache invalidation is wrong | Read-through every time (no caching on the runtime side). Cache only at the CLI/agent layer with TTL. |
| Second artist hits something codex's MCP test didn't cover | Phase 5 dry run is exactly for this. Allocate fix time. |
| AGENTS.md grows too long, hits Codex context limits | Operator AGENTS.md is separate from developer AGENTS.md. Skills are loaded on-demand, not all at once. |
| Install spec endpoint becomes stale relative to actual file requirements | Endpoint is versioned (`/install/codex/v1`). When breaking changes happen, bump to `/v2`. CLI checks compatibility. |

---

## Decisions still pending

These need a call before phase 3 starts:

| # | Decision | Options | Recommendation |
|---|---|---|---|
| P1 | **Github repo for CLI package** | `lahari/lahari-codex` (separate repo) vs. `lahari/lahari-media-engine` subdir | Separate repo — keeps CLI install surface small and public-cloneable |
| P2 | **Token TTL for v1** | 30 days / 90 days / 1 year | 90 days. Long enough for daily use, short enough to force a rotation per quarter |
| P3 | **MCP server hosting** | Embed in Lahari Railway service (same Express app) vs. separate process | Embed in Lahari Railway. One less deployment to manage. |
| P4 | **Restart vs hot-reload after install** | Require restart for v1, investigate hot-reload later | Require restart. Document it. v1 ships faster. |
| P5 | **Operator AGENTS.md location** | Append to existing `AGENTS.md` vs. new file | New file `AGENTS-operator.md`. Keep developer + operator contexts separate so Codex doesn't conflate them. |

---

## Out of scope / future tracks

These are R32-adjacent but explicitly NOT in v1:

- **R33: Module abstraction** — anime / real-estate / ads as separate install profiles, each with their own database, prompts, and skill set.
- **R34: Claude Code support** — mirror the Codex install flow for Claude Code. Skills converted to `.claude/skills/` format. Same MCP server.
- **R35: Self-service keys** — artist supplies their own OpenAI/Anthropic/Segmind keys, which override Lahari's defaults at runtime per project.
- **R36: Image apply tool** — `apply_storyboard_image_asset` for hosts that gain native imagegen. Currently blocked by Codex not having it.
- **R37: Marketplace publish** — public npm package + Codex/Claude marketplace listing once the install flow is stable.

---

## Open questions for review

1. **P1-P5 decisions above** — call them before phase 3.
2. **Do we want a `docs/r32-audit.md` first (phase 1)?** Or skip the audit and dive into phase 2? Audit takes 2 hrs and gives both planners + implementer a shared baseline. My vote: do the audit.
3. **Who implements what?** Codex's note says "Claude can draft the doc and decision table; I can then implement the package/bootstrap side once the doc is accepted." That's a clean split — I'd own Phase 2 (operator AGENTS.md + skills, all text) and Phase 4 (prompt overrides — touches existing claude.ts/openai-script.ts/storyboard.ts code). Codex owns Phase 3 (CLI package + auth endpoints) and Phase 5 (E2E test). Phase 1 audit can be either or both.
4. **Order of execution** — strictly serial or can phases overlap? My vote: Phase 1 → Phase 2 + Phase 3 in parallel (independent) → Phase 4 → Phase 5.

---

## Definition of done for R32

A second artist (not the original user), given:
- A Codex Desktop install
- A workspace folder
- The phrase "Set up Lahari and start a music video for [song URL]"

Can:
1. Get the operator context written to their workspace.
2. Authenticate via browser OAuth.
3. Start a project, drive it through Blueprint → Studio → Render.
4. Edit any prompt and see the change reflected in the next gen.
5. End up with a rendered music video.

Without manual intervention from the original user or from devops.

---

*End of plan. Update this doc as decisions resolve and phases land.*
