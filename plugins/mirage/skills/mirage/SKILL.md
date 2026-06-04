---
name: mirage
description: Use when connecting Codex to Mirage, opening or refreshing a Mirage workspace, choosing a project, syncing the local notebook, uploading media, or explaining the Mirage operating loop.
---

# Mirage

Use Mirage as an agent-operated video studio. Your job is to help the artist move one Mirage project through concept, script, style, references, storyboards, video, audio, and render prep.

## Do This Now

1. Confirm Mirage MCP is connected. If it is missing or auth fails, ask the artist to reconnect Mirage from the Mirage `/connect` page or set the plugin's `MIRAGE_MCP_TOKEN`.
2. Choose or create one project with Mirage tools.
3. Call `mint_cli_token` and run the returned sync command exactly in the artist's workspace.
4. Read the sync receipt. Trust `generatedAt`, `skillsHash`, `actionsHash`, and `summary`; do not treat the notebook schema version as freshness.
5. If the receipt says `sessionReloadNeeded: true`, tell the artist to open a new chat in the same workspace after sync so Codex reloads instructions, skills, and action schemas.

## Operating Contract

Mirage server/Supabase is canonical truth. Local files are the workbench: useful for reading, editing, diffing, and handoff. A local file becomes production only when a Mirage apply action persists it.

Use Mirage MCP for project state, actions, paid jobs, locks, imports, uploads, and issue capture. Bytes stay outside MCP: upload local images/audio through `/api/agent/uploads` with the Mirage bearer token, then pass returned asset IDs into actions.

## Local Workspace Shape

Workspace-shared files live at the workspace root:

- `AGENTS.md`
- `.agents/skills/`
- `.claude/skills/`
- `config/actions/`
- `config/skills.json`

Project files live under `mirage/projects/<projectId>/`:

- `state/` read-only snapshots
- `script.md`
- `audio-plan.md`
- `storyboards/*.md`
- project `config/`
- `journal.md`

Read root `config/actions/index.json` first, then the surface file you need. Use live `list_actions` or `describe_action` when local files are missing, stale, or unclear.

## Safe Edit Rule

Before visual assets exist, `apply_script` can create or rebuild topology.

After references, storyboards, or videos exist, use `apply_text_edits` for wording-only changes to existing scene titles, shot directions, or dialogue. Keep `apply_script` for real topology changes: add, remove, or re-ID scenes, shots, cast, or environments.

## Sync And Permissions

The returned CLI sync command is the normal path. Retry it once if it fails.

If sync reports workspace operating files need write access, retry the same command with elevated local write approval. Do not switch to MCP notebook file reads for local file permission errors.

Use MCP file reads only when the harness has no shell or no local file-write capability.

## Media Uploads

For uploaded guides, references, audio, or native imagegen outputs:

1. Mint a CLI token.
2. POST the file to `/api/agent/uploads` with the Mirage bearer token and correct `purpose`.
3. Use the returned `assetId` in the relevant action.

For native storyboard images, upload with `purpose=storyboard_image`, then call `import_storyboard_image` with the target `shotId`.

## Paid Work

Ask before paid generation. Prefer `dryRun` where available for cost and missing-requirement checks. Use `start_job` for paid image, storyboard, video, and audio generation, then poll with `get_job`.
