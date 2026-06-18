---
name: mirage
description: Use when connecting Codex to Mirage, opening or refreshing a Mirage workspace, choosing a project, syncing project files, uploading media, or explaining the Mirage operating loop.
---

# Mirage

Use Mirage as an agent-operated video studio. Help the artist move one Mirage project through concept, script, style, references, storyboards, video, audio, and render prep.

## Do This Now

1. Confirm Mirage MCP is connected. If auth fails, ask the artist to run `codex mcp login mirage` or reconnect Mirage from `/connect`.
2. Call `mirage_doctor` on first contact or after a deploy. If it says production/plugin state is not coherent, report the verdict plainly and stop before paid work.
3. Choose or create one project with Mirage tools.
4. If the workspace lacks `AGENTS.md` / `CLAUDE.md`, run `mirage init` once. This is token-free and writes stable workspace instructions.
5. Run `mirage sync <projectId>` to refresh project files if the CLI is logged in. If the CLI is not logged in, use `mint_cli_token` for a one-off sync command, or run `mirage login` with the fallback token from Mirage `/connect`.
6. Read the sync receipt. Trust `generatedAt`, file counts, and receipt status; do not treat the notebook schema version as freshness.

## Operating Contract

Mirage server/Supabase is canonical truth. Local files are the workbench: useful for reading, editing, diffing, generation traces, and handoff. A local file becomes production only when a Mirage apply action persists it.

Use Mirage MCP for project state, actions, paid jobs, locks, imports, uploads, issue capture, and coherence checks.

Bytes stay outside MCP. Upload local images/audio through `/api/agent/uploads` with the Mirage bearer token, then pass returned asset IDs into actions.

## Local Workspace Shape

Workspace root:

- `AGENTS.md` and `CLAUDE.md` from `mirage init`
- `.mirage-workspace-state.json`
- no local `config/actions/*` requirement
- no synced `.agents/skills/*` requirement

Project files live under `mirage/projects/<projectId>/`:

- `state/` read-only snapshots
- `state/generation-traces/`
- `script.md`
- `audio-plan.md`
- `storyboards/*.md`
- project `config/`
- `journal.md`

Skills come from the installed Mirage plugin. Action schemas come from live MCP: call `describe_action(actionKey)` for the schema you are about to use.

For repeatable production formats, call `list_workflows` and apply the matching recipe with `apply_project_workflow`. The recipe is project data; fill its slots during generation instead of rewriting the wrapper from memory.

For recurring hosts or characters, use personas before asking the artist to re-upload identity. Call `list_personas` when the artist says "use Padma," "run this as Yapper," or "make a <persona> clip about <topic>." If the persona exists, call `create_project_from_persona` with the topic; it seeds character reference, style reference, voice fields, tone notes, and the persona's workflow recipe. Use `save_persona` only when the artist is setting up or updating a reusable identity from owned Mirage assets.

When the artist asks to reuse prior taste, characters, references, formats, or old outputs, call `query_artist_memory` for project-level memory and `search_artist_assets` for reusable asset IDs/URLs before asking them to re-explain it.

## Safe Edit Rule

Before visual assets exist, `apply_script` can create or rebuild broad topology.

After references, storyboards, or videos exist, use `apply_text_edits` for wording-only changes to existing scene titles, shot directions, or dialogue. Use `add_shot` / `delete_shot` for one-shot changes inside an existing scene. Keep `apply_script` for broad topology changes: scenes, cast, environments, multi-shot reorders, or re-IDing.

## Sync And Permissions

Project sync writes project files only. It should not rewrite skills, action schemas, `AGENTS.md`, or `CLAUDE.md`.

Install/update the Mirage CLI without a live project token. MCP auth is OAuth-first: `codex mcp login mirage` opens Mirage `/connect` and the harness stores the MCP credential. This does not automatically log in the standalone `mirage` CLI.

For file sync, prefer the simplest available path: if the CLI is logged in, run `mirage sync <projectId>`; otherwise call `mint_cli_token` and run the returned short-lived sync command. Use `mirage login` only when the artist deliberately wants persistent CLI sync on that machine.

Use MCP file reads only when the harness has no shell or local file-write capability.

For local debugging, `mirage status` / `mirage doctor` is the file-level check. `mirage_doctor` is the remote coherence check. Use both when onboarding feels stuck.

## Media Uploads

For uploaded guides, references, audio, or native imagegen outputs:

1. Make sure `mirage auth status` is authenticated, or use `mint_cli_token` as a one-off fallback.
2. POST the file to `/api/agent/uploads` with the Mirage bearer token and correct `purpose`.
3. Use the returned `assetId` in the relevant action.

For native storyboard images, upload with `purpose=storyboard_image`, then call `import_storyboard_image` with the target `shotId`.

## Paid Work

Ask before paid generation. Prefer `dryRun` where available for cost and missing-requirement checks. Use `start_job` for paid image, storyboard, video, and audio generation, then return the job id and keep working unless the artist explicitly asks you to watch/poll. Studio realtime is the default progress surface; use `get_job` for deliberate checks, not habit loops.

If video generation returns provider outcome unknown, pending, or fetch/poll failed, do not retry immediately. Read the generation trace or attempt record, preserve the provider request ID if present, and ask the artist before acknowledging prior charge risk or starting another paid attempt.
