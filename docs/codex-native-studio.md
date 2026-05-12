# Codex-Native Studio

This project should become a Codex-native creative production workspace, not only a web app with an embedded assistant.

The Lahari app remains the visual studio: storyboard, images, videos, prompts, approvals, renders. Codex Desktop becomes the operator: it reads the repo, uses skills, opens the studio in the browser, inspects assets, calls typed tools, writes reports, and asks permission before costly or destructive changes.

The core idea: the repo is the creative operating system. Codex already brings the polished harness, long-running threads, worktrees, browser/computer use, skills, plugins, MCP, git, and memory. We should expose Lahari as a set of safe production tools that Codex can operate.

## Product Shape

- Codex Desktop is the director/operator surface.
- Lahari web app is the visual workstation.
- Supabase is durable truth for projects, assets, decisions, and history.
- Repo docs and skills are production doctrine.
- MCP tools are Codex's hands.
- Browser/computer use are Codex's eyes and fallback controls.
- The CLI is the human-debuggable engine room behind the MCP tools.

This is an internal Lahari workflow first. It does not need to look like a consumer SaaS assistant. It needs to be powerful, permissioned, inspectable, and easy for a high-agency artist/operator to use.

## Core Engine vs Presets

The engine is not Bhakti-specific. The current app has Bhakti assumptions baked into prompts, names, UI copy, schema fields, and examples. Those should become a preset.

Core engine:

- media/content intake
- analysis and segmentation
- concept directions
- script/scene/shot planning
- style system
- entity/reference generation
- location/environment references
- shot prompt writing
- frame/video generation
- continuity chaining
- critique, rerun, refine, lock
- final assembly and publishing

Preset:

- domain vocabulary
- input schema extensions
- prompt doctrine
- taste rules
- examples and anti-examples
- critique rubrics
- default models/settings
- approval policies

Bhakti is the first serious preset, not the whole engine.

Future presets:

- `bhakti-music-video`
- `short-film`
- `ad-film`
- `product-launch`
- `anime-series`
- `music-video`

## Bhakti Preset

Bhakti-specific concepts to extract out of core:

- deity, devotee, darshan, ritual, invocation, stotra, bhajan, kirtan, chant
- Indian audience and cultural authenticity rules
- devotional restraint and anti-generic-fantasy rules
- temple/home-shrine/sacred-space defaults
- song classification: stotra, chant, bhajan, kirtan, song, unknown
- meditative/narrative axes
- guidance around divine presence, spectacle, symbolism, and cultural references

These belong in a preset skill/package, not scattered through core route logic.

## Codex Tooling Stack

Build both CLI and MCP, but MCP is the primary Codex interface.

CLI gives us debuggability and local repeatability:

```bash
lahari project packet <projectId>
lahari shot packet <shotId>
lahari assets contact-sheet <projectId>
lahari critique concepts <projectId>
lahari critique shots <projectId>
lahari report <projectId>
```

MCP wraps the same domain services as typed tools:

- `list_projects`
- `get_project_packet`
- `get_shot_packet`
- `get_asset`
- `make_contact_sheet`
- `critique_concepts`
- `critique_style_refs`
- `critique_shot_sequence`
- `generate_concepts`
- `brainstorm_styles`
- `visualize_style`
- `write_shot_prompts`
- `rewrite_shot_prompts_preview`
- `generate_start_frame`
- `generate_video`
- `compare_versions`
- `mark_stale`
- `fork_project`
- `publish_render`

Do not make raw SQL the normal creative interface. Supabase MCP is useful for read-only inspection, debugging, migrations, and admin work. Production creative actions should go through Lahari domain tools because they understand phase state, staleness, cost, assets, forks, and rollback.

## Permission Model

Codex can freely run read-only tools.

Codex should ask approval before:

- writing to the Lahari DB
- calling paid generation models
- overwriting prompts/scripts/concepts
- marking assets stale
- deleting anything
- publishing final renders
- running raw SQL writes

Tool outputs should say what changed:

- entities updated
- assets created
- prompts rewritten
- stale flags set
- estimated cost
- next recommended action
- rollback/fork option

The app should never require blind trust. Codex should be able to say: "This will rewrite 6 shot prompts and mark 4 frames stale. Proceed?"

## Project Packets

The most important primitive is a compact project packet. Codex should not need the whole DB dumped into context.

A project packet includes:

- project status and active preset
- source media metadata
- analysis summary
- concept options and locked concept
- script summary
- style directions and selected style asset
- cast/entity references
- environments/locations
- scenes and shot table
- generated assets per shot
- stale/error state
- recent human decisions
- recent agent notes
- recommended next actions

A shot packet includes:

- scene narrative and lyrics/time range
- shot beat/direction
- visual prompt
- motion prompt
- continuity mode
- cast/environment refs
- start frame, end frame, video, extracted last frame
- previous/next shot context
- known issues and retries

## Visual Evidence

Codex needs fast visual access. Build tools that create contact sheets:

- concept option sheet
- style reference sheet
- character candidate sheet
- environment candidate sheet
- storyboard frame sheet
- video thumbnail strip
- before/after comparison sheet

These should be files Codex can open or attach in the thread. One contact sheet beats forty scattered URLs.

## Journals and Learning Loop

Every song/project should accumulate a durable journal.

Capture:

- critiques
- accepted/rejected candidates
- human edits
- rerun reasons
- tool calls
- prompt diffs
- model failures
- final winners

This is not just logging. It becomes eval data. Later Codex can ask: "For meditative stotra projects, which concept/style/shot prompt patterns got accepted fastest?"

The learning loop should improve prompts and presets from real work, not theoretical prompt debates.

## Skills

Initial skills:

- `lahari-director`
- `bhakti-cultural-grounding`
- `style-reference-critic`
- `shot-continuity-critic`
- `cinematic-renderable-prompts`
- `render-triage`

Skills should teach process and taste. Tools should mutate state. Docs should explain architecture. Keep those responsibilities separate.

## First Milestone

Do not start with "Codex makes a whole video."

Start with read-only operation:

1. Codex opens an existing project.
2. Codex calls `get_project_packet`.
3. Codex creates a contact sheet.
4. Codex writes a director report:
   - what is working
   - what is weak
   - where the pipeline is blocked
   - which actions it recommends next
5. No mutation happens.

This proves the premise safely.

Implemented first read-only tools:

- CLI: `npm run lahari -- project list [limit]`
- CLI: `npm run lahari -- project packet <projectId>`
- CLI: `npm run lahari -- project actions <projectId>`
- CLI: `npm run lahari -- project hydrate <projectId> [outputDir]`
- CLI: `npm run lahari -- project storyboard-review <projectId>`
- CLI: `npm run lahari -- shot packet <projectId> <shotId>`
- CLI: `npm run lahari -- project report <projectId> [out.md]`
- CLI: `npm run lahari -- project sheet <projectId> <overview|style|references|storyboard|renders> [out.html]`
- CLI: `npm run lahari -- project contact-sheet <projectId> [out.html]`
- CLI: `npm run lahari -- session attach <projectId> [note...]`
- CLI: `npm run lahari -- session state <projectId>`
- CLI: `npm run lahari -- session note <projectId> <note...>`
- CLI: `npm run lahari -- session journal <projectId>`
- CLI: `npm run lahari -- preview rewrite-script <projectId> [note...]`
- CLI: `npm run lahari -- preview rewrite-shot-prompts <projectId> [note...]`
- CLI: `npm run lahari -- preview rewrite-storyboard-prompt <projectId> <shotId> [note...]`
- CLI: `npm run lahari -- plan generate-storyboard <projectId> <shotId>`
- CLI: `npm run lahari -- plan generate-video <projectId> <shotId>`
- CLI: `npm run lahari -- apply-plan rewrite-script <preview.json>`
- CLI: `npm run lahari -- apply-plan rewrite-shot-prompts <preview.json>`
- CLI: `npm run lahari -- apply-plan rewrite-storyboard-prompt <preview.json>`
- CLI: `npm run lahari -- apply rewrite-script <preview.json>`
- CLI: `npm run lahari -- apply rewrite-shot-prompts <preview.json>`
- CLI: `npm run lahari -- apply rewrite-storyboard-prompt <preview.json>`
- CLI: `npm run lahari -- rollback rewrite-script <preview.json>`
- CLI: `npm run lahari -- rollback rewrite-shot-prompts <preview.json>`
- CLI: `npm run lahari -- rollback rewrite-storyboard-prompt <preview.json>`
- CLI: `npm run lahari -- apply generate-storyboard <projectId> <shotId> [artist note...]`
- CLI: `npm run lahari -- apply generate-video <projectId> <shotId> [prompt override...]`
- MCP: `npm run lahari:mcp`

The MCP server currently exposes read-only/local-output tools plus explicit mutating apply tools:

- `list_projects`
- `get_project_packet`
- `get_project_actions`
- `hydrate_project_workbench`
- `review_storyboard_prompts`
- `get_shot_packet`
- `write_project_artifacts`
- `write_project_sheets`
- `attach_director_session`
- `get_director_session`
- `add_director_note`
- `preview_rewrite_script`
- `preview_rewrite_shot_prompts`
- `preview_rewrite_storyboard_prompt`
- `plan_generate_storyboard`
- `plan_generate_video`
- `plan_apply_script_preview`
- `plan_apply_shot_prompt_preview`
- `plan_apply_storyboard_prompt_preview`
- `apply_script_preview`
- `apply_shot_prompt_preview`
- `apply_storyboard_prompt_preview`
- `rollback_script_preview`
- `rollback_shot_prompt_preview`
- `rollback_storyboard_prompt_preview`
- `apply_generate_storyboard`
- `apply_generate_video`

This keeps MCP as an adapter, not the architecture. The shared domain logic lives in `server/services/codexStudio.ts`, and the CLI wraps the same functions.

Local MCP command:

```bash
cd /Users/ssaulgoodman/Code/lahari-media-engine/lahari-codex-native
npm run lahari:mcp
```

For local Codex use, register that command as the Lahari MCP server. The server loads `.env` from this worktree first and then falls back to the sibling main checkout at `../lahari-media-engine/.env`, so the Codex worktree can stay clean while using the same local Supabase credentials.

Read-only tools may use `VITE_SUPABASE_ANON_KEY` if the service key is stale. Mutating apply tools refuse anon fallback and require `SUPABASE_SERVICE_KEY`.

Current v1 execution list:

1. Keep packets aligned with the current app schema: text provider, storyboard provider, storyboard prompts/boards, render history, stale/error state.
2. Expand visual artifacts into separate style, reference, storyboard, shot-history, and render sheets. Current implementation covers style, references, storyboard, and renders.
3. Turn deterministic reports into a real director diagnosis with bottleneck, weak links, and next approved action.
4. Add preview/apply pairs for storyboard prompt rewrites and selected safe state changes. Current implementation covers one-shot storyboard prompt/cut-plan rewrites.
5. Add generation tools only after each reports cost, write blast radius, and rollback/fork path.

Project workbenches are local Codex desk copies under `.lahari/projects/<projectId>/`:

- `brief.md` is the current production read, bottleneck, risks, and next actions.
- `audio-analysis.md` mirrors meaning, lyrics, classification, and structure.
- `concept-notes.md` mirrors locked concept and saved options.
- `script.md` mirrors cast, environments, scenes, and shot beats.
- `storyboard-prompts.md` mirrors storyboard prompts, cut plans, and motion prompts.
- `action-plan.json` is the current native/manual action menu.
- `snapshots/` stores packet/action JSON snapshots for drift comparison.
- `director-notes.md` is local-only and is not overwritten by hydration.

Supabase remains the source of truth. The workbench is a local Codex mirror for reading, diffing, drafting, and long-session continuity. Official writes still go through typed apply tools.

Artist-facing sessions should start with "open this song/project," not "hydrate." `attach_director_session` is the front door: it refreshes the durable director session, hydrates the local workbench, returns a suggested Codex session title, and includes a web studio deep link. The `project hydrate` primitive remains available for debugging or explicit refreshes.

Director sessions are local working memory under `.lahari/sessions/<projectId>/`:

- `state.json` is the latest deterministic checkpoint read.
- `journal.md` is the running human/Codex production log.
- Reports and contact sheets remain generated snapshots under `.lahari/codex/`.

The state file is not the source of truth for the project. Supabase remains truth; the session files preserve production context, open questions, and decisions for a long-lived Codex thread.

Artist and operator decisions that need to survive across Codex sessions live in `lahari_director_events`. Web studio mutations and Codex apply tools write compact events for locks, unlocks, prompt edits, clears, reverts, generation, render lifecycle, and preview applies. `attach_director_session` reads events newer than the last monotonic `seq` cursor and writes a "Changes since last attach" block into the local journal.

Realtime sync uses three lanes over Supabase Realtime: `postgres_changes` for persisted project row changes, broadcast channels for ephemeral progress like "Codex is generating shot 4", and optional presence for "Codex is attached." Broadcast/presence are not memory; the durable event table is.

Web studio deep links use query parameters such as `?project=<id>&step=studio&shot=<shotId>&action=review-video`. The web app opens the requested project/step and focuses the shot's scene when possible. These links are the visual approval surface for paid generation, lock/reject review, and shot-level decisions.

Preview artifacts live under `.lahari/previews/<projectId>/`. The first preview action is `rewrite-shot-prompts`: it calls the real shot prompt writer, writes before/after Markdown + JSON + runtime prompt artifacts, and does not mutate Supabase. It is still a paid AI call, so Codex should ask before running it when operating autonomously.

Applying a preview is a separate command/tool. `apply-plan rewrite-shot-prompts` is read-only and validates drift. `apply rewrite-shot-prompts` / `apply_shot_prompt_preview` requires a valid `SUPABASE_SERVICE_KEY`, refuses anon fallback, updates only the previewed shot prompt fields, and appends to the local director journal. This is the intended Codex permission boundary.

Rollback is a first-class apply primitive. `rollback rewrite-shot-prompts`, `rollback rewrite-storyboard-prompt`, and `rollback rewrite-script` restore a preview's `before` snapshot after validating current state still matches the preview `after` state. Script rollback requires previews generated after rollback snapshots were added and runs through the `lahari_rollback_script_preview` Postgres RPC so the scene/cast/environment/shot restore is atomic once the migration is applied.

Second milestone:

- permissioned prompt rewrites
- preview/diff before write
- one approved mutation at a time

Third milestone:

- generation actions with cost/approval gates
- visual comparison
- accepted/rejected decision capture

## Setup Vision

An artist/operator should be able to:

1. Install Codex Desktop.
2. Install/open the Lahari Codex workspace.
3. Run a setup command.
4. Add required API keys interactively.
5. Validate Supabase/storage/model access.
6. Start the Lahari server.
7. Open the studio in Codex's browser.
8. Work in a long-lived Codex thread per song.

The fallback remains the normal Lahari app.

First pass setup command:

```bash
npm run lahari -- setup
```

It validates the local worktree, required env vars, Supabase project access, `lahari_director_events`, and the atomic script rollback RPC. It then idempotently registers the `lahari` MCP server for both Codex Desktop and Claude Code as `npm --prefix <repo> run lahari:mcp`, passing `LAHARI_ENV_FILE` so the MCP server can load the same credentials from any launch directory. Use `npm run lahari -- setup --check` for validation without rewriting MCP registration.

## Design Principle

Do not build an imitation of Codex inside Lahari.

Make Lahari operable by Codex.

The app becomes a machine Codex can inhabit.
