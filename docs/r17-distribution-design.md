# R17 Distribution Design — remote MCP primary, local package fallback

Status: remote-first implementation started
Date: 2026-05-14
Companion to: `docs/codex-native-doctrine.md`, ledger R17, R16, R28, R29

## Goal

A non-engineer artist connects their Codex/Claude harness to Lahari without seeing engine code, service keys, or local infra. Everything after is conversational Codex/Claude Code chat. The artist gets MCP tools wired to hosted Lahari and authenticated as themselves.

**Primary path as of 2026-05-14:** hosted remote MCP at `/mcp`, authenticated with Lahari-issued personal MCP tokens. This is simpler than the earlier local-subprocess bootstrap: no local Node package required for the happy path, no `~/.lahari/credentials`, no refresh-token loop on the artist machine, and no version drift between a local MCP subprocess and Railway.

**Fallback path:** keep `@lahari/mcp-server` as a documented local bridge for harnesses or environments where remote MCP is flaky. The fallback package is a thin HTTP client over the same Director API facade.

## Non-Goals

- **Not a marketplace install.** When Codex Desktop gets a plugin marketplace, we'd add a one-click button that invokes the same bootstrap. Not v1.
- **Not a pure conversational install.** The artist still needs a concrete harness connection step. The primary version is a copy-paste remote MCP connection string; a local setup helper remains optional.
- **Not a separate Lahari editor app.** The artist's editor IS Codex Desktop / Claude Code. Lahari only provides the hosted MCP server, visual web studio, and optional workspace templates.
- **Not an engine code distribution.** The bootstrap doesn't ship engine code, prompt catalog, or migrations. Engine stays internal. Artist gets the *director surface* only.

## The Artist's Experience — Primary Remote MCP Path

```
1. Artist opens https://lahari.media/connect
2. Artist signs in with the existing Lahari Google OAuth flow.
3. Lahari issues a personal MCP token (`lahari_mcp_...`) scoped to that user.
4. The page shows harness-specific install snippets:

Codex:
  export LAHARI_MCP_TOKEN=<token>
  codex mcp add lahari --url https://lahari.media/mcp --bearer-token-env-var LAHARI_MCP_TOKEN

Claude Code:
  claude mcp add lahari --transport http \
    --header "Authorization: Bearer <token>" \
    https://lahari.media/mcp

5. Artist restarts the harness once.
6. Artist asks: "List my Lahari projects" or "Open Sri Mahaganapathi Stotram."
```

The token is tied to the artist's Lahari account. `/mcp` resolves the bearer token to `user_id` before any tool runs; every project load still checks `lahari_projects.user_id`.

## Architecture

### Account-specific Auth

Do not ask artists to paste Supabase service keys or generic JWTs into harness configs. Lahari issues its own personal MCP token:

```sql
lahari_mcp_tokens(
  id uuid primary key,
  user_id text not null,
  label text not null,
  token_hash text not null unique,
  token_prefix text not null,
  created_at timestamptz,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
)
```

Token lifecycle:
- `/api/mcp-tokens` is behind normal Supabase `requireAuth`; the connect page calls it after login.
- The raw token is shown once. Only `sha256(token)` is stored.
- `/mcp` accepts `Authorization: Bearer lahari_mcp_...`, hashes it, verifies active/not expired, updates `last_used_at`, and attaches `user_id` to the MCP request.
- Tool handlers enforce the same project ownership check as the Director API facade.
- Revocation is just `revoked_at=now()`.

This gives account-specific access without relying on Supabase OAuth support inside each harness.

### Hosted MCP Transport

`/mcp` speaks Streamable HTTP MCP and is stateless. Each POST creates a short-lived MCP server instance whose tool handlers close over the authenticated `user_id`.

The hosted tool surface mirrors the internal MCP names where possible:
- Read/session: `list_projects`, `attach_director_session`, `get_director_session`, project/shot packets, storyboard status
- Workspace notebook + skills: `write_project_notebook` returns deterministic `{ path, content, mode, writePolicy }` file payloads. The agent writes them into the current folder with harness file tools. This is how an empty artist workspace becomes a Lahari project notebook and receives project-local Codex/Claude skills; no npm setup/template download is needed. After mutations, apply/generation/config tools return `changedArtifacts` so the agent refreshes only the files that changed.
- Apply-only text tools from R28
- Project config tools from R29
- Media tools: plan/generate storyboard/video, bulk storyboard generation, refine image, lock/unlock
- Issue capture
- Legacy local-file tools return explicit `remote_facade_gap` errors instead of silently disappearing

### Local Fallback Package

`@lahari/mcp-server` remains useful as a fallback and for debugging. It runs as a stdio subprocess and calls the hosted Director API facade. It should not be the default artist path anymore.

Use it when:
- A harness has remote MCP bugs.
- An operator needs local artifact-writing affordances.
- We want to diagnose remote transport separately from the Director API facade.

The fallback package may continue to use a credentials file or token env var, but it is no longer the source of truth for distribution.

### Workspace Notebook and Skills

Remote MCP does not install a repo or local subprocess. The workspace is born from `write_project_notebook`:
- `AGENTS.md` is generated by the tool and describes this folder's notebook contract.
- `CLAUDE.md` is generated for Claude Code parity.
- `.agents/skills/*` contains project-local Codex Lahari skills.
- `.claude/skills/*` contains project-local Claude Code Lahari skills.
- `mirrors/` files are read-only desk copies of Supabase truth.
- `config/` files are editable project overrides; Codex edits them locally, then persists through typed apply tools.
- `journal.md` is local operator memory; durable cross-session events still live in Supabase.

The hosted MCP `initialize` instructions carry the engine-wide doctrine for the first run. Native skill discovery is a harness start-up behavior, so after the first notebook write the artist should restart/open a fresh session in that folder. Internal users keep this repo's `.agents/skills/*`; artist workspaces receive their own project-local copies from the notebook tool.

### Hosted Director API facade (shared spine)

The Director API facade remains useful under `/api/director/*`:
- The local fallback MCP calls it.
- The hosted MCP can call the same service-layer functions directly.
- It provides stable JSON envelopes for web/admin/debug use.

The facade and hosted MCP must keep behavior aligned: same tool names, same validation, same ownership checks, same audit source (`mcp-remote`).

### Implementation Order (revised)

1. Hosted Director API facade under `/api/director/*` (done first pass).
2. Fix facade error envelopes and preview vocab (done).
3. Local fallback `@lahari/mcp-server` package (done first pass).
4. MCP token table + token management routes.
5. Hosted `/mcp` Streamable HTTP transport using those tokens.
6. `/connect` page that signs in and shows copy-paste install snippets (done first pass).
7. `write_project_notebook`, project-local skill payloads, and apply-response `changedArtifacts` for the firm-hybrid local notebook (done first pass).
8. Optional plugin/resource distribution pass after the local project-skill path is proven.
9. OAuthProxy / one-click harness auth later if the ecosystem requires it.

### Safety Notes

- Store only token hashes, never raw MCP tokens.
- Token routes are behind normal Supabase auth.
- `/mcp` does not accept Supabase service keys or anon keys.
- Every project-scoped tool calls `assertProjectAccess`.
- Tokens should expire by default and be revocable from the connect/account page.
- Hosted MCP local-file tools must fail loudly with `remote_facade_gap`; no imaginary desk-copy writes.
- Paid/mutating tools keep the same plan/apply discipline taught in skills.

## Local Bootstrap Fallback (historical first design)

The rest of this document records the earlier npm-bootstrap design. Keep it as fallback/reference, not as the primary distribution path. The live direction is remote MCP first; the local subprocess package exists for harness gaps and debugging.

### The MCP server (`@lahari/mcp-server`)

Separate npm package. Runs as a subprocess of Codex/Claude Code (registered via step 4).

- Reads `~/.lahari/credentials` for the access token
- Calls **the hosted Director API facade** (see next section) via HTTP using `Authorization: Bearer <token>`
- Refreshes token automatically when expired
- Exposes the same *tool surface* as today's MCP — `list_projects`, `attach_director_session`, `apply_*` family, generation tools — but each tool is a thin typed HTTP client, not a direct service-layer call

**Key difference from today's internal MCP**: today's MCP imports `server/services/codexStudio.ts` directly and uses `SUPABASE_SERVICE_KEY` for DB writes. That stack cannot ship to artists. The npm MCP server has zero engine imports, zero DB access, zero Supabase service key. It's a typed HTTP client. The artist's identity (and therefore their RLS scope) is the access token.

### Hosted Director API facade (the real R17 spine)

Today's `mcp/lahari.ts` and `cli/lahari.ts` both call `server/services/codexStudio.ts` in-process. The npm MCP server cannot do this — it runs on the artist's machine with no engine code and no service key. So Railway must expose the codexStudio surface as authenticated HTTP endpoints.

This is the biggest engineering chunk of R17 and should be built first.

**Endpoint shape** — grouped by domain, not one-route-per-tool:

```
POST /api/director/session/attach              { projectId } -> session packet
POST /api/director/session/recent-events       { projectId, sinceSeq? }
GET  /api/director/projects                    -> list_projects
POST /api/director/preview/script              { projectId, ... }
POST /api/director/preview/storyboard-prompt   { projectId, shotId, ... }
POST /api/director/apply/script                { projectId, baseHash, draft }
POST /api/director/apply/shot-prompts          { projectId, shots[], force? }
POST /api/director/apply/storyboard-prompt     { projectId, shotId, ... }
POST /api/director/apply/concept               { projectId, ... }
POST /api/director/apply/video-prompt          { projectId, shotId, ... }
POST /api/director/rollback/script             { projectId, previewId }
POST /api/director/issues/capture              { ... }
... etc, one route per codexStudio public function
```

All routes:
- Mount under existing `requireAuth` JWT middleware
- Reuse the same `user_id`-scoped project lookup the web studio uses (no new ownership path)
- Return structured `{ ok, data, error }` JSON envelopes the MCP server unwraps
- Log to the same audit shim that wraps CLI today, tagged `source: 'mcp-remote'`

**Implementation note:** the simplest path is a new `server/routes/director.ts` that imports `server/services/codexStudio.ts` and calls its existing functions, with thin request/response translation. The service layer stays unchanged. This is mostly mechanical wiring, not a refactor — likely 1–1.5 days for full surface.

**Versioning:** the facade publishes a version string at `GET /api/director/version`. The MCP server checks at startup and warns if it's older than the API expects. This gives us a compatibility lever once artists are on different `@lahari/mcp-server` versions.

**This must be built and deployed before `@lahari/mcp-server` is useful.** The setup package is downstream of both.

## Per-harness MCP registration details

Each harness has slightly different CLI for adding MCP servers. The setup script handles both, with tested arg orderings:

### Codex Desktop (current as of 2026-05-14)
```
codex mcp add lahari \
  --env LAHARI_API_URL=<url> \
  -- npx -y @lahari/mcp-server
```

Codex caches MCP servers at app startup. Restart required after registration.

### Claude Code (current as of 2.1.132)
```
claude mcp add --scope user lahari \
  -- npx -y @lahari/mcp-server \
  -e LAHARI_API_URL=<url>
```

Note: `-e` flag MUST come AFTER the `lahari` name due to commander.js variadic-flag arg consumption (caught during 2026-05-13 testing — see ledger). The setup script enforces this order.

Both harnesses require a restart for new MCP servers to become visible in chat. Setup output tells the artist this clearly.

## OAuth localhost callback flow (R16 specifics)

### Lahari API side

New endpoints to add on Railway backend:

```
GET /auth/cli
  Query: redirect=http://localhost:PORT/callback, state=<random>
  Action: redirect to Supabase Google OAuth with `redirectTo` pointing
          to a Lahari-hosted bridge page that knows to relay tokens
          to the localhost callback.

GET /auth/cli-bridge
  Receives Supabase auth callback with token in URL fragment.
  Reads localhost callback URL from `state` parameter.
  Returns HTML that uses JavaScript to POST the token to the
  localhost callback URL.
  This indirection is needed because Supabase puts tokens in URL
  fragments (#) which the server can't see, only the browser can.
```

### Setup script side

```js
// oauth.js
const port = await getAvailablePort()
const server = http.createServer((req, res) => {
  // Receive POST from cli-bridge with token in body
  // Validate state matches
  // Save credentials
  // Respond with success HTML
  // Schedule server shutdown
})
server.listen(port)
await open(`https://lahari.media/auth/cli?redirect=http://localhost:${port}/callback&state=${state}`)
await waitForCallback(server, timeout: 5 * 60 * 1000)  // 5 min timeout
```

### Token refresh

The MCP server keeps the credentials file fresh. On every API call, check `expires_at`; if within 5 min of expiry, call Supabase's `auth/v1/token?grant_type=refresh_token` with the stored refresh token, save the new access + refresh tokens to the credentials file, then make the API call.

### Safety notes — must hold before R17 ships

These are the edges that turn a smooth install into a debugging nightmare on someone else's machine. Each one is a setup-script invariant, not an aspirational guideline.

- **State parameter is required and validated.** The localhost callback rejects any response whose `state` doesn't match the one issued by setup. Without this, a malicious page could feed tokens to a listening setup process. `state` is a 32-byte random token, single-use, expires when the local server shuts down.
- **`/auth/cli-bridge` only relays to localhost.** The bridge endpoint must validate that the `redirect` URL points to `http://localhost:<port>/callback` or `http://127.0.0.1:<port>/callback`. Reject everything else, including `https://`, public hostnames, or other ports/paths. This prevents the bridge from being weaponized as an open token forwarder.
- **Supabase redirect allowlist explicitly lists `https://lahari.media/auth/cli-bridge`.** Forgetting this is the most common cause of "OAuth completes but no token arrives." Setup's `doctor` command pings the bridge and warns if the redirect chain breaks.
- **MCP server install is exact-version pinned.** `codex mcp add ... -- npx -y @lahari/mcp-server@X.Y.Z`, not floating latest. Floating versions make artist-machine debugging unreproducible because the artist's MCP can silently upgrade between sessions. `lahari-setup update` is the only path that bumps the pinned version, and it records the bump in `~/.lahari/credentials` so `doctor` can report it.
- **Credentials file is mode 0600 on write.** Even though it's already in `~/.lahari/`, set the mode explicitly — default umasks vary across machines.
- **Refresh-token failure does not silently log the artist out.** If refresh returns 401, the MCP server returns a structured `auth_expired` error to the harness so the agent can say "your Lahari session expired — run `npx @lahari/setup login` to sign back in."

## Templates the bootstrap writes

### AGENTS.md (artist version)

Slimmed from engine's AGENTS.md. Director-mode only. Removes engine-session content, build commands, env var docs, deployment notes. Keeps:
- Operating principle (Supabase canonical, `.lahari/` is desk copy)
- Session-type protocol (in artist version, only director sessions matter, but mention "if you're debugging the install, that's an engine session")
- Director session opening move
- Friction capture
- Reference to skills

### Skills

Same six shards as today (`lahari-director` orchestrator + five taste shards: `storyboard-prompt-craft`, `script-doctor`, `continuity-auditor`, `style-ref-critic`, `render-triage`). Verbatim copies into `<workspace>/.agents/skills/`.

**v1 delivery model — workspace files, not first-class plugin skills.** The artist's `AGENTS.md` explicitly references these shards by path so the harness reads them as workspace operating instructions when the relevant trigger fires. We do *not* depend on Codex/Claude Code recognizing them as registered skills with chips/banners. That UI varies by harness version and is not guaranteed by file placement alone.

When Codex Desktop ships a stable plugin/skill registry, R17 can grow a follow-up that registers shards there too. Until then, workspace-file delivery is the contract. Skill content does not change between the two modes — only the discovery path.

### Prompt config templates

Empty starter files at `.lahari/projects/templates/config/prompts/storyboard.md` and `video.md` with a comment header explaining what they do and pointing at the skill for filling them in.

### .gitignore template

```
# Lahari workspace
.lahari/sessions/
.lahari/audit/
.lahari/issues/
.lahari/previews/
# Keep .lahari/projects/<id>/config/ in version control if desired
# Credentials should never be in the workspace
.env
.env.local
```

The artist's workspace is gitignore-protected by default. They can commit project config to their own private repo if they want.

## Error handling — seven common failure modes

1. **Node version too old.** Detect at startup, abort with "Lahari requires Node 20+. Install from https://nodejs.org/"
2. **No harness detected.** "Couldn't find Codex Desktop or Claude Code in PATH. Install Codex from https://... or Claude Code from https://..."
3. **MCP registration fails.** Surface the raw CLI error + suggest manual command + link to docs.
4. **Workspace directory already has Lahari files.** Prompt for overwrite vs new path.
5. **OAuth timeout (5 min).** Tell artist to re-run setup; offer device-code fallback in v1.5.
6. **Localhost port unavailable.** Try sequential ports starting from a random base; if all fail, fall back to device code.
7. **Credentials file already exists with different user.** Prompt "Replace existing credentials for <other@email.com>?" — useful for switching accounts.

## Update mechanism

```
npx @lahari/setup update
```

Re-runs the file-write step with latest templates. Preserves credentials. Preserves project-local config (`.lahari/projects/*/config/`). Re-registers MCP server (idempotent — uses `mcp remove` then `mcp add`). Useful when skill shards or AGENTS.md improve in the engine.

## Doctor command

```
npx @lahari/setup doctor
```

Same idea as today's `npm run lahari -- setup --check` in the engine repo. Verifies:
- Workspace structure intact
- MCP server registered with at least one harness
- Credentials valid (not expired)
- API reachable (`GET /api/health` returns 200)
- Token-refresh roundtrip works

Useful for triage when something feels off.

## Implementation Order

Build the spine first, the bootstrap second. The setup package is useless without the API facade and the remote MCP server.

1. **Hosted Director API facade** — new `server/routes/director.ts` on Railway, grouped endpoints over the existing `codexStudio.ts` surface, `requireAuth`, audit-logged with `source: 'mcp-remote'`. Add `/api/director/version`. ~1–1.5 days.
2. **`/auth/cli` + `/auth/cli-bridge` endpoints** on the Lahari API, including state validation and localhost-only redirect allowlist. Update Supabase redirect allowlist. ~half day.
3. **`@lahari/mcp-server` package** — typed HTTP client over the facade, JWT-based auth, refresh-token loop, structured `auth_expired` error, version check against facade. ~1 day.
4. **Template contents** — pull AGENTS.md + skills from engine into `@lahari/setup/src/templates/`. One-way sync script lives in engine repo. ~2 hours.
5. **`@lahari/setup init` happy path** — detect, write files, register MCP at exact pinned version, run OAuth, save credentials with mode 0600. ~1 day.
6. **Error handling** for the seven failure modes. ~half day.
7. **`doctor` + `update` + `login`** commands. ~half day.
8. **Publish** `@lahari/setup` and `@lahari/mcp-server` to npm (or GitHub Packages for internal). Tag exact-version pins. ~1 hour.
9. **Documentation page** at `lahari.media/install` with the one-liner and a "what just happened" walkthrough. ~few hours.

**Total estimate:** ~5–6 focused days of work (up from earlier ~4–5 once the facade is sized in honestly).

## Testing

After implementation, Saul does the artist-grade install on a clean machine (or fresh user account, or `env -i` shell):

```
$ npx @lahari/setup init
... (the full flow)
$ # restart Codex Desktop
$ # open ~/lahari-studio in Codex Desktop
$ # in chat: "List my Lahari projects"
$ # in chat: "Open <project name>"
$ # work the project as the artist would
```

Friction items from this test become the next ledger entries. Same loop as the 2026-05-13/14 testing of the engine workspace.

## Cross-References

- Doctrine §7 (Distribution Arc): the "v1 plugin distribution gates" — all must be true before R17 ships. With R28 + R29 + stabilization shipped, gates 1-3 are achievable. Gate 4 (extractable as separate distribution without engine deps at runtime) is what this design accomplishes.
- R16 (browser-bridged operator auth): the OAuth localhost callback flow in step 5 IS R16. Building this implements R16.
- R28 (apply-only text tools): the MCP server in `@lahari/mcp-server` exposes the R28 tools. Same tool surface, different packaging.
- R29 phase 1 (project config): bootstrap writes the config skeleton; apply tools work as today.
- R34 (apply-image tools): future addition; same MCP server gains new tools.
- Polish items P-poli-04 (web studio override badge), P-poli-09 (notifications): independent of R17.

## Open Questions

1. **Should `@lahari/mcp-server` be a separate package or bundled into `@lahari/setup`?** Separate keeps the MCP server independently versioned and faster to update. Bundled is simpler but couples version bumps. **Recommendation: separate.**
2. **Should we support a "service account" install for CI / cron / Codex Cloud where browser OAuth isn't available?** Yes eventually, but not v1. v1.5 adds a device-code flow as fallback.
3. **Should the bootstrap detect git and offer to `git init` the workspace?** Probably yes — most artists will want to version their project config. Optional flag, default yes.
4. **Workspace lock or single-instance enforcement?** If the artist runs `init` twice in the same directory, what happens? Probably: detect, ask, replace credentials only or full re-init.
5. **How does the artist switch accounts later?** `npx @lahari/setup login` (re-runs OAuth, replaces credentials). File for v1.
