# R17 Distribution Design — `@lahari/setup` npm bootstrap

Status: first-pass design
Date: 2026-05-14
Companion to: `docs/codex-native-doctrine.md`, ledger R17, R16, R28, R29

## Goal

A non-engineer artist runs ONE terminal command, then never touches a terminal again. Everything after is conversational Codex/Claude Code chat. The artist gets a clean workspace with AGENTS.md + skills + MCP wired to hosted Lahari + authenticated as themselves — no service keys on their machine, no engine repo access, no `~/.lahari/` plumbing they need to understand.

## Non-Goals

- **Not a marketplace install.** When Codex Desktop gets a plugin marketplace, we'd add a one-click button that invokes the same bootstrap. Not v1.
- **Not a pure conversational install.** Pattern A ("type 'set up Lahari' in chat") was considered and rejected for v1 robustness reasons (see ledger R17 entry, ledger verification log 2026-05-14). Could be added as a layer over Pattern B later.
- **Not a separate Lahari editor app.** The artist's editor IS Codex Desktop / Claude Code. The bootstrap just configures it.
- **Not an engine code distribution.** The bootstrap doesn't ship engine code, prompt catalog, or migrations. Engine stays internal. Artist gets the *director surface* only.

## The Artist's Experience

```
$ npx @lahari/setup init

Lahari setup
============

What workspace folder should hold your Lahari work? [~/lahari-studio]
> [Enter]

✓ Created ~/lahari-studio
✓ Wrote AGENTS.md, skills, prompt config templates
✓ Detected Codex Desktop (1.2.3)
✓ Registered Lahari MCP server with Codex
✓ Opened browser for sign-in...

(browser opens to https://lahari.media/auth/cli)
(artist signs in via Google OAuth)
(browser redirects to http://localhost:53241/callback)
(callback closes the browser tab automatically)

✓ Signed in as <artist@email.com>
✓ Saved credentials to ~/.lahari/credentials

Done. Restart Codex Desktop, then open ~/lahari-studio.
You can ask Codex anything Lahari-related — e.g.:
  "List my Lahari projects"
  "Open Sri Mahaganapathi Stotram"
  "Start a new music video from this song URL"
```

Two terminal interactions: one Enter to confirm path, one wait for browser. Then never again.

## Architecture

### Package shape

```
@lahari/setup
├── bin/
│   └── lahari-setup.js          # the npx entry point
├── src/
│   ├── init.js                  # main flow: detect → write → register → auth
│   ├── harness.js               # detect Codex vs Claude Code, MCP register
│   ├── templates/               # AGENTS.md, skills/, prompts/, .lahari structure
│   │   ├── AGENTS.md
│   │   ├── skills/
│   │   │   ├── lahari-director/SKILL.md
│   │   │   ├── storyboard-prompt-craft/SKILL.md
│   │   │   ├── script-doctor/SKILL.md
│   │   │   ├── continuity-auditor/SKILL.md
│   │   │   ├── style-ref-critic/SKILL.md
│   │   │   └── render-triage/SKILL.md
│   │   └── prompts/             # template files for project-config prompts
│   ├── oauth.js                 # localhost callback + token capture
│   ├── credentials.js           # ~/.lahari/credentials read/write
│   ├── update.js                # `lahari-setup update` self-update
│   └── doctor.js                # `lahari-setup doctor` diagnostics
├── package.json
└── README.md
```

Templates are kept in sync with the engine repo via a one-way export script (`npm run sync-templates` in the engine repo copies `.agents/skills/*` + AGENTS.md template into the setup package's templates/).

### What the bootstrap actually does

`init.js` runs these steps in order. Each step has clear success criteria and a clear failure mode:

**Step 1 — Detect environment**
- Find the harness (`codex` CLI in $PATH? `claude` CLI in $PATH? Or both?)
- Find Node version (require ≥20)
- Find OS (some path handling differs Mac/Linux/Windows)
- Find the user's home directory

**Step 2 — Pick workspace location**
- Prompt for workspace path with default `~/lahari-studio`
- Confirm overwrite if directory exists with non-empty Lahari files

**Step 3 — Write workspace files**
- Create workspace directory
- Copy template `AGENTS.md` to workspace root
- Copy `.agents/skills/*` to workspace (Codex picks them up; the directory is gitignored which is fine — these are operating files)
- Copy `.lahari/projects/templates/config/` skeleton (empty prompts/, hashes.json absent)
- Copy `.gitignore` template (excludes `.lahari/sessions`, `.lahari/audit`, `.lahari/issues`, credentials)

**Step 4 — Register MCP server**

Per harness:

```
Codex Desktop:
  codex mcp add lahari \
    --env LAHARI_API_URL=https://lahari-media-engine-production.up.railway.app \
    -- npx -y @lahari/mcp-server

Claude Code (note: -e after name due to arg-order bug):
  claude mcp add --scope user lahari \
    -- npx -y @lahari/mcp-server \
    -e LAHARI_API_URL=https://lahari-media-engine-production.up.railway.app
```

(The actual arg orderings are encoded per harness based on tested syntax; setup script doesn't trust generic docs because we've already been bitten.)

**Step 5 — OAuth localhost callback (R16)**

```
1. Start small HTTP server on random localhost port (e.g. :53241)
2. Open browser to https://lahari.media/auth/cli?redirect=http://localhost:53241/callback
3. Artist signs in via existing Lahari Google OAuth flow
4. Auth server redirects to localhost callback with token in query params or POST body
5. Local server captures token, sends artist a "you can close this tab" HTML response
6. Local server shuts down
```

**Step 6 — Save credentials**

`~/.lahari/credentials` file with mode 0600 (user-readable only):

```json
{
  "version": 1,
  "api_url": "https://lahari-media-engine-production.up.railway.app",
  "access_token": "<jwt>",
  "refresh_token": "<refresh>",
  "expires_at": "2026-06-14T18:00:00Z",
  "user": {
    "id": "<uuid>",
    "email": "<artist@email.com>"
  }
}
```

The MCP server reads this file at startup, refreshes the access token when it's near expiry, and uses it for all Lahari API calls.

**Step 7 — Print ready summary + next steps**

Tell the artist:
- Restart Codex Desktop / Claude Code once
- Open the workspace folder in the harness
- Try a starter command ("List my Lahari projects" or "Open <song name>")

### The MCP server (`@lahari/mcp-server`)

Separate npm package. Runs as a subprocess of Codex/Claude Code (registered via step 4).

- Reads `~/.lahari/credentials` for the access token
- Calls Lahari API on Railway via HTTP using `Authorization: Bearer <token>`
- Backend's `requireAuth` middleware validates the JWT against Supabase Auth (same path as the web studio uses today)
- Refreshes token automatically when expired
- Exposes the same tools as today's MCP — `list_projects`, `attach_director_session`, `apply_*` family, generation tools, etc.

**Key difference from internal MCP**: no `SUPABASE_SERVICE_KEY` anywhere. The MCP server has no DB access of its own. It's purely an HTTP client to the Lahari API on Railway. The artist's identity (and therefore their RLS scope) is the access token.

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

## Templates the bootstrap writes

### AGENTS.md (artist version)

Slimmed from engine's AGENTS.md. Director-mode only. Removes engine-session content, build commands, env var docs, deployment notes. Keeps:
- Operating principle (Supabase canonical, `.lahari/` is desk copy)
- Session-type protocol (in artist version, only director sessions matter, but mention "if you're debugging the install, that's an engine session")
- Director session opening move
- Friction capture
- Reference to skills

### Skills

Same five shards as today (`lahari-director` orchestrator + four taste shards). Verbatim copies.

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

1. Define template contents — pull AGENTS.md + skills from current engine into `@lahari/setup/src/templates/`. Sync script lives in engine repo. ~2 hours.
2. Build `@lahari/mcp-server` package — HTTP client to Lahari API, JWT-based auth, refresh-token loop, exposes existing tool surface. ~1 day.
3. Build `@lahari/setup` `init.js` — happy path: detect, write files, register MCP, OAuth, save credentials. ~1 day.
4. Add Lahari API `/auth/cli` + `/auth/cli-bridge` endpoints on Railway. ~half day.
5. Backend `requireAuth` updates to accept the same JWT pattern from MCP-originated requests as it does from web studio. ~few hours (probably no change — already JWT-based).
6. Error handling for the seven failure modes. ~half day.
7. `doctor` + `update` commands. ~half day.
8. Publish `@lahari/setup` and `@lahari/mcp-server` to npm (or GitHub Packages for internal). ~1 hour.
9. Documentation page at `lahari.media/install` with the one-liner. ~few hours.

**Total estimate:** ~4-5 focused days of work.

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
