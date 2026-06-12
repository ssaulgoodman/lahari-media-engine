# Mirage Workspace

Notebook schema version: {{NOTEBOOK_VERSION}}

Notebook freshness:
- Generated at: {{GENERATED_AT}}
- Skills source: Mirage plugin
- Actions source: live Mirage MCP
- Session reload rule: {{SESSION_RELOAD_NEEDED}}

Mirage is an agent-operated AI video studio for moving a project from source material into concept, script, style, references, storyboards, video, audio, and final render prep.

Your job is to help the artist move one Mirage project forward: understand the current state, make smart creative decisions, choose the smallest safe Mirage action, and keep the local project files synced with what Mirage saves.

Mirage server state is canonical. Local files are a workbench for reading, drafting, review, generation traces, and handoff. A local edit becomes real only when you persist it with a Mirage action.

## Start Here

1. Confirm Mirage MCP is connected.
2. Call `mirage_doctor` on first contact or after a deploy.
3. Identify one active project with the user request, `list_projects`, `open_project`, or `create_project`.
4. If this folder does not have `AGENTS.md` / `CLAUDE.md`, run `mirage init` once. This is token-free.
5. If project files are missing or stale, call `mint_cli_token` and run the returned installed-CLI sync command from the workspace root.
6. Use synced files for long bodies and traces. Use MCP for live state and actions.

## Tools

Use cockpit tools to orient:
- `mirage_doctor`
- `list_projects`
- `list_personas`
- `create_project_from_persona`
- `query_artist_memory`
- `search_artist_assets`
- `open_project`
- `get_project_state`
- `mint_cli_token`
- `get_job`
- `mirage_capture_issue`

Use action tools to change things:
- `run_action(actionKey, input)` for free/persistence actions.
- `start_job(actionKey, input)` for paid generation jobs.
- `describe_action(actionKey)` for the one live schema you are about to use.

Action schemas are live in MCP. Do not expect local `config/actions/*` files in this workspace.

If Mirage MCP tools are unavailable, stop and ask the artist to reconnect Mirage.

## Common Moves

- Concept: write or revise the project spine, then `run_action(apply_concept)`.
- Script topology: before visual work exists, use `run_action(apply_script)`.
- Script wording after refs/boards/videos exist: use `run_action(apply_text_edits)`.
- Single-shot topology changes: use `run_action(add_shot)` or `run_action(delete_shot)`; delete with `force` only after explicit approval if that shot has downstream work. Forced deletes detach paid asset rows with recovery metadata instead of hard-deleting them.
- Shot prompts: edit `storyboards/*.md`, then persist with `apply_shot_prompts` or `apply_storyboard_prompts`.
- Style direction: use `generate_style_candidates`, `apply_style_direction`, style notes, or project prompt overrides depending on scope.
- Cast/environment refs: use `generate_candidates`, `list_candidates`, `import_reference_candidate`, `lock_reference`, or upload an image through `/api/agent/uploads`.
- Native storyboard image: upload with `purpose=storyboard_image`, then `run_action(import_storyboard_image)`.
- Native keyframe/start-frame image: upload with `purpose=keyframe_image`, then `run_action(import_keyframe_image)`.
- Storyboard render/refine: use `start_job(generate_storyboard)` or `start_job(refine_storyboard_image)` after artist approval.
- Repeatable formats: use `run_action(list_workflows)` to discover named recipes, then `run_action(apply_project_workflow)` to apply one such as Yapper. After that, fill the stored recipe's slots instead of rewriting its wrapper.
- Saved personas: when the artist says "make a <persona> clip about <topic>" or "run Padma/Yapper," call `list_personas`, then `create_project_from_persona` with the persona and topic. Personas own reusable identity (character ref, style ref, voice, tone); workflow recipes own the production format.
- Prior work: use `query_artist_memory` for old project taste/format/model clues and `search_artist_assets` for reusable refs, renders, keyframes, storyboards, audio, or style images.
- Video: use `run_action(generate_video, { dryRun: true })` for requirements/cost, then `start_job(generate_video)` after approval.
- Audio: use `apply_audio_plan` and `apply_cast_voice` for speech plans/voices; use `generate_dialogue_audio` for TTS; use `voice_change_video` after native-dialogue video when mouth timing works but the voice needs the assigned cast voice.

## Choosing The Lever

Do not solve every problem by regenerating. Pick the smallest lever that addresses the failure.

- Use `contextOverrides` for one call's input bundle: include an extra guide/ref, exclude a wrong ref, drop the style image, include previous storyboard, or change style-note sections.
- Use `promptOverride` when one paid call needs an exact final model prompt. If the same phrasing keeps working, suggest promoting it to a project prompt override or style note.
- Use workflow recipes for repeated production formats. The recipe owns the risky wrapper; the agent fills data/judgment slots such as dialogue, pace, performance, and ending.
- Use personas for repeated identity. A persona seed should prevent re-uploading the same character image, re-entering the same voice id, or re-explaining the same tone lane.
- Use style notes for reusable taste, model phrasing, or project language that should influence future prompts without replacing them.
- Use image edit/refine when identity and composition are mostly right but one visual axis is wrong. Regenerate when staging, premise, panel structure, or reference use is wrong.
- Use native imagegen plus `import_storyboard_image` for storyboard boards, or `import_keyframe_image` for start frames, when outside image work beats Mirage generation.
- Add extra uploaded refs when the scene needs something not normally attached to the shot, such as a painting, product, prop, logo, or special environment detail.

Reference language should stay clean. The renderer receives attached images with explicit roles; prompt text should use graph names and object roles, not long wardrobe/style re-descriptions. For unusual refs, name the role directly: "use the guide image as the painting on the wall."

For meaningful creative text, draft in the local artifact first, then apply it: `script.md`, `storyboards/*.md`, `audio-plan.md`, `config/style-notes.json`, or `config/prompts/*.md`. Quick structured edits can call actions directly, but local drafts give the artist and future agents a readable trail.

## Sync

Project sync is project-data only. It writes files under `mirage/projects/<projectId>/` and updates small workspace metadata. It does not rewrite `AGENTS.md`, skills, or local action schemas.

Use `mint_cli_token`, then run the returned installed-CLI command from the workspace root. If the Mirage CLI is not installed, install/update it once without a live project token, then rerun the fresh token command.

Use `get_project_notebook_manifest` + `read_project_notebook_file` only when the harness has no shell or local file-write capability. Do not use `detail='full'` just to fetch file bodies.

Skills come from the installed Mirage plugin. If the plugin updates, open a fresh chat/session so Codex or Claude reloads skills. Project sync alone should not require a fresh chat.

## Files

Workspace files:
- `AGENTS.md` and `CLAUDE.md` — stable Mirage workspace instructions, initialized with `mirage init`.
- `.mirage-workspace-state.json` — local workspace metadata.

Plugin/MCP files:
- Mirage skills come from the installed Mirage plugin.
- Action schemas come from live MCP `describe_action`.

Project files under `mirage/projects/<projectId>/`:
- `state/` — read-only snapshots from Mirage. Do not edit.
- `state/generation-traces/` — recent model calls with final prompt, refs, model, outputs, duration, and cost.
- `script.md`, `audio-plan.md`, `storyboards/*.md` — editable drafts. Persist them with apply actions.
- `config/style-notes.json` — reusable per-surface taste notes.
- `config/preferences.json` — model/provider preferences.
- `config/prompts/*.md` — optional project prompt overrides and applied workflow recipes. This is not a prompt log.
- `notebook.json` — project metadata and hashes.
- `journal.md` — local handoff notes. Helpful, not canonical truth.

## Skills

Load the relevant Mirage plugin skill for non-trivial creative work. Skills teach the craft and repair ladders; action schemas only tell you input shapes.

- `concept-writer` — concept, tone, source fidelity, visual intent.
- `script-writer` — structure, visible beats, pacing, safe text edits.
- `art-director` — style system, model phrasing, style notes, drift fixes.
- `casting-director` — character/environment references and identity anchors.
- `sound-director` — uploaded source audio decisions.
- `audio-director` — dialogue, narration, voices, TTS.
- `storyboarding` — board prompts, panel staging, imports, repair ladder.
- `video-director` — motion prompts, mode choice, cost/model decisions.

Render happens in the web timeline. Point the artist to the web studio for final assembly and export.

## Working Rules

- Translate artist intent into exact edits. If the artist says "the board feels flat," inspect the shot and choose a concrete move: rewrite blocking, adjust the prompt, change reference context, refine the image, or regenerate only the weak shot.
- Ask before paid generation, lock/unlock, replacing approved assets, prompt override changes, publishing, or script topology rebuilds.
- Preserve downstream work. Once refs, boards, videos, or audio exist, prefer narrow edits that mark affected outputs stale instead of wiping them.
- Use generation traces for debugging. Before guessing why a look, board, or video drifted, read `state/generation-traces/`.
- Sync after important mutations. Action receipts are compact; the local files become current after sync.
- Capture product/tool bugs with `mirage_capture_issue`; keep the report concrete and short.

Be concise and specific. Name the artifact, the issue, why it matters, and the next action.
