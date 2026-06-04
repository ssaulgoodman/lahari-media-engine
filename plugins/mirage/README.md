# Mirage Codex Plugin

Prototype plugin for operating Mirage projects from Codex.

This plugin packages the Mirage MCP entrypoint and Mirage production skills so a beta artist can install one thing, connect Mirage, open a workspace folder, and ask Codex to run a video-production workflow.

## What This Prototype Covers

- Remote Mirage MCP server declaration.
- Mirage operator skill for connect/open/sync habits.
- Node skills for concept, script, style, casting, sound, audio, storyboarding, and video.
- Starter prompts for opening a project, creating a video, and refreshing a workspace.

## Still Manual In V0

- Authentication still comes from Mirage `/connect`. The plugin MCP config expects `MIRAGE_MCP_TOKEN` until the plugin owns the auth handoff.
- Local notebook sync still uses `mint_cli_token` and the returned Mirage CLI command.
- A future plugin/local bridge should own sync and uploads directly instead of asking the agent to reason about shell commands.

## Local Install Test

From this repo:

```bash
codex plugin marketplace add ./plugins
codex plugin add mirage@mirage-local
```

Then start a new Codex thread. Plugin skills and MCP config are loaded at session start.

## Beta Onboarding Goal

The artist experience should become:

1. Install Mirage plugin.
2. Connect Mirage with the email Saul assigned.
3. Open a local workspace folder.
4. Ask Codex: "Open my Mirage project" or "Start a new Krishna podcast episode."

The plugin should make Mirage feel like an installed production surface, not a pile of copied instructions.
