# Mirage Codex Plugin

Beta plugin for operating Mirage projects from Codex.

This plugin packages the Mirage MCP entrypoint and Mirage production skills so a beta artist can install Mirage once, connect their account, open a workspace folder, and ask Codex to run a video-production workflow.

## What This Covers

- Remote Mirage MCP server declaration.
- Mirage operator skill for connect/open/sync habits.
- Node skills for concept, script, style, casting, sound, audio, storyboarding, and video.
- Starter prompts for opening a project, creating a video, refreshing a workspace, and checking coherence.
- Mirage icon and app metadata for the Codex plugin UI.

## Still Manual In This Beta

- Authentication still comes from Mirage `/connect`. The plugin MCP config expects `MIRAGE_MCP_TOKEN` until Codex supports a native plugin-owned auth handoff.
- Project-file sync still uses `mint_cli_token` and the installed Mirage CLI command.
- Workspace instructions are initialized once with `mirage init`; skills come from this plugin; action schemas come from live MCP.
- A future plugin/local bridge should own sync and uploads directly instead of asking the agent to reason about shell commands.

## Install Test

From macOS with Codex Desktop:

```bash
launchctl setenv MIRAGE_MCP_TOKEN '<token-from-connect>'
codex plugin marketplace add ssaulgoodman/lahari-media-engine --ref mirage --sparse .agents/plugins --sparse plugins/mirage
codex plugin add mirage@mirage
codex mcp remove mirage
codex mcp add mirage --url https://mirage-platform-production-05ca.up.railway.app/mcp --bearer-token-env-var MIRAGE_MCP_TOKEN
codex mcp get mirage --json
```

Then fully restart Codex and start a new thread in an empty Mirage workspace folder. Plugin skills and MCP config are loaded at session start.

The first useful prompt after install is:

```text
Check Mirage status and open my latest project.
```

Codex should call `mirage_doctor`, run `mirage init` if the folder is new, choose or create a project, and sync project files with the returned `mint_cli_token` command. Project sync should not require a fresh chat; a fresh chat is only needed after installing or updating the plugin.

If a paid provider call returns outcome unknown, Codex should inspect the generation trace/attempt before retrying. Do not spend again until the prior provider request is reconciled or the artist explicitly accepts the charge risk.

## Beta Onboarding Goal

The artist experience should become:

1. Install Mirage plugin.
2. Connect Mirage with the email Saul assigned.
3. Open a local workspace folder.
4. Ask Codex: "Check Mirage status and open my project" or "Start a new Krishna podcast episode."

The plugin should make Mirage feel like an installed production surface, not a pile of copied instructions.
