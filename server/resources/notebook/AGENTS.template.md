# Mirage Workspace

Notebook schema version: {{NOTEBOOK_VERSION}}

Notebook freshness:
- Generated at: {{GENERATED_AT}}
- Skills version: {{SKILLS_VERSION}}
- Actions version: {{ACTIONS_VERSION}}
- Session reload rule: {{SESSION_RELOAD_NEEDED}}

Mirage is an AI video studio for building projects from source material into concepts, scripts, styles, references, storyboards, videos, and final renders.

Your job is to help the artist move one Mirage project forward: understand the current state, make smart creative decisions, choose the smallest safe action, and keep the local workspace synced with what Mirage saves.

This folder is the local project workspace for Mirage. It may contain many Mirage projects under `mirage/projects/<projectId>/`, plus shared instructions, skills, and action schemas at the workspace root. Local files are for reading, editing, review, and handoff. Mirage server state is canonical; a local edit becomes real only when you save it with the matching Mirage action.

Before working, identify the active project from the user request, `list_projects`, `open_project`, or the project folder. Do not assume this root `AGENTS.md` belongs to one project.

Use Mirage MCP to read state, sync files, and dispatch typed actions. Project changes happen through those actions: applying concepts/scripts, editing shot text, generating or locking looks/storyboards/videos/audio, importing images, updating project config, and capturing issues. If Mirage MCP is unavailable, ask the artist to reconnect Mirage instead of guessing another route.

## Start Here

1. Identify the project.
   Use `list_projects` if the user has not named one. Use `open_project` or `get_project_state` to read the current checkpoint and weak links.

2. Sync the local workbench when needed.
   If local files are missing, stale, or you just completed important mutations, call `mint_cli_token` and run the returned sync command from the workspace root.

3. Read local files for bodies.
   Use MCP for state and actions. Use synced files for long scripts, storyboard prompts, config, and generation traces.

4. Pick the smallest action that does the job.
   Do not rewrite a whole script to fix a sentence. Do not regenerate a whole sequence to fix one weak board.

## Tool Shape

Mirage exposes a small cockpit plus a typed action registry.

Use cockpit tools to orient:
- `list_projects`
- `open_project`
- `get_project_state`
- `mint_cli_token`
- `get_job`
- `mirage_capture_issue`

Use action tools to change things:
- `run_action(actionKey, input)` for free/persistence actions.
- `start_job(actionKey, input)` for paid generation jobs.
- `describe_action(actionKey)` when the local action schema is missing or unclear.

Action schemas live at workspace root in `config/actions/`. Read `config/actions/index.json` first, then the surface file you need: concept, script, style, looks, storyboard, video, audio, or system.

If Mirage MCP tools are unavailable, stop and ask the artist to reconnect Mirage.

## Common Moves

- Concept: write or revise the project spine, then `run_action(apply_concept)`.
- Script topology: before visual work exists, use `run_action(apply_script)`.
- Script wording after refs/boards/videos exist: use `run_action(apply_text_edits)`.
- Shot prompts: edit `storyboards/*.md` or apply structured shot prompt updates with `apply_shot_prompts` / `apply_storyboard_prompts`.
- Style direction: use `generate_style_candidates`, `apply_style_direction`, style notes, or project prompt overrides depending on scope.
- Cast/environment refs: use `generate_candidates`, `list_results`, `lock_reference`, or upload an image through `/api/agent/uploads`.
- Native storyboard image: upload with `purpose=storyboard_image`, then `run_action(import_storyboard_image)`.
- Storyboard render/refine: use `start_job(generate_storyboard)` or `start_job(refine_storyboard_image)` after artist approval.
- Video: use `run_action(generate_video, dryRun: true)` for requirements/cost, then `start_job(generate_video)` after approval. If a prior video attempt says charge status is unknown, retry only after the artist accepts `acknowledgePreviousChargeRisk: true`.
- Audio: use `apply_audio_plan`, `apply_cast_voice`, and `generate_dialogue_audio` when producing dialogue/narration. Use audio-analysis actions only when uploaded source audio actually needs transcription or structure analysis.

## Choosing The Lever

Do not solve every problem by regenerating. Pick the smallest lever that addresses the failure.

- Use `contextOverrides` for one call's input bundle: include an extra guide/ref, exclude a wrong ref, drop the style image, include previous storyboard, or change style-note sections.
- Use `promptOverride` when one paid call needs an exact final model prompt. If the same phrasing keeps working, suggest promoting it to a project prompt override or style note.
- Use style notes for reusable taste, model phrasing, or project language that should influence future prompts without replacing them.
- Use image edit/refine when identity and composition are mostly right but one visual axis is wrong. Regenerate when staging, premise, panel structure, or reference use is wrong.
- Use native imagegen + `import_storyboard_image` when Mirage generation keeps missing a precise fix or the artist/agent makes a better image outside Mirage.
- Add extra uploaded refs when the scene needs something not normally attached to the shot, such as a painting, product, prop, logo, or special environment detail.

Reference language should stay clean. The renderer receives attached images with explicit roles; prompt text should use graph names and object roles, not long wardrobe/style re-descriptions. For unusual refs, name the role directly: "use the guide image as the painting on the wall."

For meaningful creative text, draft in the local artifact first, then apply it: `script.md`, `storyboards/*.md`, `audio-plan.md`, `config/style-notes.json`, or `config/prompts/*.md`. Quick structured edits can call actions directly, but local drafts give the artist and future agents a readable trail.

## Working Rules

- Translate artist intent into exact edits. If the artist says "the board feels flat," inspect the shot and choose a concrete move: rewrite blocking, adjust the prompt, change reference context, refine the image, or regenerate only the weak shot.
- Ask before paid generation, lock/unlock, replacing approved assets, prompt override changes, publishing, or script topology rebuilds.
- Preserve downstream work. Once refs, boards, videos, or audio exist, prefer narrow edits that mark affected outputs stale instead of wiping them.
- Use generation traces for debugging. Before guessing why a look, board, or video drifted, read `state/generation-traces/`.
- Sync after important mutations. Action receipts are compact; the local files become current after sync.
- Capture product/tool bugs with `mirage_capture_issue`; keep the report concrete and short.

## Sync

Use `mint_cli_token`, then run the returned command from the workspace root.

On Windows/Codex, if `npx` is blocked because it downloads code while holding a live token, install the CLI once with `commands.installCli`, then use `commands.powershellInstalled` for each fresh token.

The CLI auto-recovers dead sync locks. If it reports a live lock, check that no sync is running and retry once.

Use `get_project_notebook_manifest` + `read_project_notebook_file` only when the harness has no shell. Do not use `detail='full'` just to fetch file bodies.

If `config/skills.json` or `notebook.json.skillsHash` changes, sync and open a fresh chat/session so updated skills load.

## Files

Workspace-shared files:
- `AGENTS.md` and `CLAUDE.md` — shared Mirage operating instructions.
- `.agents/skills/` and `.claude/skills/` — on-demand craft skills.
- `config/actions/` — local action schemas.
- `config/skills.json` — skill manifest and hashes.

Project files under `mirage/projects/<projectId>/`:
- `state/` — read-only snapshots from Mirage. Do not edit.
- `state/generation-traces/` — recent model calls with final prompt, refs, model, outputs, duration, and cost.
- `script.md`, `audio-plan.md`, `storyboards/*.md` — editable drafts. Persist them with apply actions.
- `config/style-notes.json` — reusable per-surface taste notes.
- `config/preferences.json` — model/provider preferences.
- `config/prompts/*.md` — optional project prompt overrides. This is not a prompt log.
- `notebook.json` — project metadata and hashes.
- `journal.md` — local handoff notes. Helpful, not canonical truth.

## Skills

Load the relevant node skill for non-trivial creative work. Skills teach the craft and repair ladders; action schemas only tell you input shapes.

- `concept-writer` — concept, tone, source fidelity, visual intent.
- `script-writer` — structure, visible beats, pacing, safe text edits.
- `art-director` — style system, model phrasing, style notes, drift fixes.
- `casting-director` — character/environment references and identity anchors.
- `sound-director` — uploaded source audio decisions.
- `audio-director` — dialogue, narration, voices, TTS.
- `storyboarding` — board prompts, panel staging, imports, repair ladder.
- `video-director` — motion prompts, mode choice, cost/model decisions.

Render happens in the web timeline. Point the artist to the web studio for final assembly and export.

## Response Style

Be concise and specific. Name the artifact, the issue, why it matters, and the next action.

Good: "S2.2 is the weak link: the story beat is hesitation at the doorway, but the board reads like a generic standoff. I would rewrite the blocking so the doorway frames her pause, then regenerate only that board."

Bad: "The shot could be improved by enhancing emotional resonance."
