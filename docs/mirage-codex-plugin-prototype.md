# Mirage Codex Plugin Prototype

Status: v0 prototype, repo-local.

The goal is to make Mirage onboarding feel like installing a production surface in Codex, not manually assembling MCP config, skills, notebook sync habits, and project instructions.

## What Exists

Plugin source:

`plugins/mirage/`

Local marketplace:

`plugins/marketplace.json`

Contents:
- `.codex-plugin/plugin.json` — Mirage plugin manifest and Codex UI metadata.
- `.mcp.json` — deployed Mirage remote MCP endpoint.
- `skills/mirage/SKILL.md` — plugin-level operating skill for connect/open/sync/upload behavior.
- `skills/<node>/SKILL.md` — eight Mirage production node skills copied from the server skill resources.

## What This Solves

The plugin gives Codex a Mirage identity and a packaged skill surface. It should reduce friend/beta onboarding from "paste several instructions and hope the agent follows the ritual" to "install Mirage, connect, open a workspace, and ask Codex to start/open a project."

## What It Does Not Solve Yet

This prototype still uses the current backend paths:
- Remote MCP for project control and actions.
- `mint_cli_token` plus Mirage CLI for notebook sync.
- `/api/agent/uploads` for bytes.

The plugin does not yet include a custom local bridge or native auth flow. The MCP config uses `MIRAGE_MCP_TOKEN` as a safe placeholder until the plugin owns the connect/auth handoff. The local bridge remains the later HTTP/data-plane slice.

## Friend/Beta Onboarding Target

1. Saul invites the user by email and assigns preset/workflow access in Mirage.
2. User installs the Mirage plugin.
3. User connects Mirage from the deployed `/connect` flow.
4. User opens a local workspace folder.
5. User says: "Open my Mirage project" or "Start a new Krishna podcast episode."

The agent should then use Mirage MCP, sync the workbench, and follow the packaged skills.

## Next Plugin Slice

After this prototype is validated locally:
- Promote the local marketplace shape into the beta distribution path.
- Decide whether auth can be owned by plugin install instead of pasted `/connect` MCP config.
- Move sync/upload into a plugin-local bridge or official HTTP helper so the agent no longer reasons about npm, shell permissions, and token commands.
