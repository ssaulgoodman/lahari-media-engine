# Mirage Codex Plugin

Beta plugin for operating Mirage projects from Codex.

This plugin packages the Mirage MCP entrypoint and Mirage production skills so a beta artist can install Mirage once, connect their account, open a workspace folder, and ask Codex to run a video-production workflow.

## What This Covers

- Remote Mirage MCP server declaration.
- Mirage operator skill for connect/open/sync habits.
- Node skills for concept, script, style, casting, sound, audio, storyboarding, and video.
- Starter prompts for opening a project, creating a persona clip, and creating a new video.
- Mirage icon and app metadata for the Codex plugin UI.

## Still Manual In This Beta

- Authentication is OAuth-first: install the plugin, then run `codex mcp login mirage`. Mirage `/connect` handles the browser approval.
- Bearer-token setup from `/connect` remains a fallback for older clients that do not support MCP OAuth.
- Project-file sync can use `mint_cli_token` from the connected MCP session. `mirage login` remains a CLI convenience for users who want `mirage sync <projectId>` to mint short-lived project tokens without asking MCP each time.
- Workspace instructions are initialized once with `mirage init`; skills come from this plugin; action schemas come from live MCP.
- A future plugin/local bridge should own sync and uploads directly instead of asking the agent to reason about shell commands.

## Install Test

From macOS with Codex Desktop:

```bash
npm install -g @ssaulgoodman420/mirage-cli@0.1.12
codex plugin marketplace add ssaulgoodman/lahari-media-engine --ref mirage --sparse .agents/plugins --sparse plugins/mirage
codex plugin add mirage@mirage
codex mcp login mirage
codex mcp get mirage --json
```

The plugin owns the Mirage MCP registration. Do not also add a separate global `codex mcp add mirage` entry; a global entry can shadow the plugin's OAuth registration and make new threads miss the Mirage tools. The login command opens Mirage `/connect` in the browser. Approve the request, then fully restart Codex and start a new thread in an empty Mirage workspace folder. Plugin skills and MCP config are loaded at session start.

For clients that do not support plugin-owned OAuth MCP, use the bearer-token snippet from Mirage `/connect` as a fallback.

The first useful prompt after install is:

```text
Check Mirage status and open my latest project.
```

Codex should call `mirage_doctor`, run `mirage init` if the folder is new, choose or create a project, and sync project files. If the CLI is not logged in, use `mint_cli_token` for a short-lived sync command or run `mirage login` from the `/connect` fallback token. Project sync should not require a fresh chat; a fresh chat is only needed after installing or updating the plugin.

For recurring formats like Yapper, Codex should call `list_personas` and `create_project_from_persona` when the artist asks for a saved host/persona such as Padma, instead of asking for the same reference image, style, or voice id again.

If a paid provider call returns outcome unknown, Codex should inspect the generation trace/attempt before retrying. Do not spend again until the prior provider request is reconciled or the artist explicitly accepts the charge risk.

## Beta Onboarding Goal

The artist experience should become:

1. Install Mirage plugin.
2. Connect Mirage with the email Saul assigned.
3. Open a local workspace folder.
4. Ask Codex: "Check Mirage status and open my project" or "Start a new Krishna podcast episode."

The plugin should make Mirage feel like an installed production surface, not a pile of copied instructions.
