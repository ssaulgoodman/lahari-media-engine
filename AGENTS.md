# AGENTS.md

Guidance for Codex when working in this repo. Keep this file aligned with `CLAUDE.md`, `docs/pipeline-anatomy.md`, `docs/mirage-platform-v1-ledger.md`, `server/tools/registry.ts`, `server/prompts/*`, and the doctrine when pipeline behavior changes.

**Architectural context (read first):**
- `docs/mirage-platform-v1-ledger.md` — current Mirage v1 decisions, task tracks, checkpoints, and pending workstreams.
- `docs/codex-native-doctrine.md` — durable operating contract. Three editability tiers, MCP/CLI boundary, session-type protocol, distribution arc.

## Operating Principle

Supabase is canonical project truth. Local files in artist workspaces are desk copies and drafts for reading, editing, diffing, and handoff. `mirrors/` are read-only DB snapshots. `drafts/` are editable working copies that become production only when an apply tool persists them. `config/` is the editable project override layer.

**This repo is for engine work.** Code, prompts, infra, docs, schema, deployment. The artist-facing director surface lives in deployed Mirage — remote MCP at `/mcp`, materialized per-project workspaces via `write_project_notebook`. Internal legacy MCP (`mcp/lahari.ts`) and CLI (`cli/lahari.ts`) still exist as engine-side debug + scripting tools, not as the director-session surface.

If you want to test director-session behavior, open any empty folder in Codex Desktop or Claude Code, mint a token at `/connect`, install the remote MCP. Same shape an artist gets. Don't try to do director work from inside this engine repo — that's a transitional pattern from before distribution shipped and it gives a falsely-comfortable shape.

The Mirage web app is the visual studio. Use deep links to it for visual approval moments instead of rebuilding visual review.

## Workspace Layout

This checkout is the **Mirage platform lane**.

- Parent folder: `/Users/ssaulgoodman/Code/lahari-media-engine/` — not a git repo.
- Main/deploy checkout: `/Users/ssaulgoodman/Code/lahari-media-engine/lahari-media-engine` on `main`.
- Codex-native checkout: `/Users/ssaulgoodman/Code/lahari-media-engine/lahari-codex-native` on `codex-native-studio`; its harness has been merged here.
- Mirage checkout: `/Users/ssaulgoodman/Code/lahari-media-engine/lahari-preset-abstraction` on `mirage`.

Do Mirage platform work here. Do not switch the main checkout away from `main` for Lahari work, and do not use this checkout for urgent Lahari production hotfixes or Railway deploys unless the user explicitly asks. At session start, confirm with `pwd` and `git status --short --branch`.

Artists do not use this repo. They mint a token at the deployed Mirage `/connect` page, paste the install snippet into Codex Desktop or Claude Code, restart their harness, open any empty folder, and ask to open a project. The agent attaches via remote MCP and `write_project_notebook` materializes the workspace (mirrors, drafts, config, journal, AGENTS.md, skills) inside that folder. No engine code on the artist's machine. Current CLI snippets use `@ssaulgoodman420/mirage-cli`.

Current notebook contract:
- `mirrors/` are overwritten from Supabase and should not be hand-edited.
- `drafts/script.md` is the editable script working copy. Agents should make surgical file edits there, then call `apply_script_markdown`; the tool parses the draft, checks `scriptFingerprint` drift, validates references/durations, and applies through the atomic script RPC.
- `config/prompts/*.md` and `config/preferences.json` are project-level runtime overrides. Edit locally, then persist with `apply_project_prompt_override` or `apply_project_preferences`.
- Reference-image bridge tools: prefer the Slice 1 action surface: `list_actions` / `describe_action` / `run_action` with `generate_candidates`, `list_candidates`, and `lock_reference`. For local/native images, POST multipart to `/api/agent/uploads` with the Mirage bearer token, then pass the returned `assetId` as `sourceAssetId` for use-as-is or `guideAssetId` for upload-as-guide. Legacy tools (`list_character_look_candidates`, `apply_cast_reference`, `upload_cast_reference`, etc.) remain as compatibility aliases for now.
- Storyboard action bridge: prefer `run_action` for `generate_storyboard`, `bulk_generate_storyboards`, `apply_storyboard_prompts`, `refine_storyboard_image`, `lock_storyboard`, and `unlock_storyboard`; use `parallel_run` for approved independent storyboard batches. Legacy storyboard MCP tools remain as compatibility aliases for now.
- `journal.md` is local operator memory. Append concise decisions; do not treat it as canonical project state.

Director-session work in this engine repo is a developer-only path — used for debugging, testing internal MCP changes, or operating against the canonical engine without going through Railway. Identical tool surface to remote, identical apply discipline.

## Preset Abstraction Context

This lane is for turning the Lahari-shaped engine into a clean video studio platform for non-Lahari artists. The implementation can keep using the existing pipeline shape and legacy table names where they are compatibility boundaries, but the product direction is Mirage: no devotional/Bhakti/Lahari assumptions in generic runtime surfaces.

North star:
- Build a clean platform with presets/workflows. v1 active workflow archetypes are `music_led` and `scripted_narrative`; first serious presets are `music_video_default` and `anime_default`.
- Do not assume deity, temple, devotional, Bhakti, or Lahari context in generic runtime prompts.
- Extract domain taste into preset configuration: concept/script prompt rules, source assumptions, model defaults, style/cast/environment guidance, output format defaults, and workflow capabilities.
- Keep deterministic pipeline semantics intact: Blueprint -> Looks -> Studio -> Render. Do not replace the pipeline with a generic agent loop.
- Prove the abstraction with two golden paths: music video from audio, and anime from script.
- Prefer a strangler approach: route prompts/model/default choices through presets, keep legacy compatibility where needed, and gradually remove hardcoded assumptions.

Current strategy:
- Preset/workflow source of truth lives in `server/presets.ts`. Canonical workflow keys are `music_led` and `scripted_narrative`; legacy `music_video` / `anime_scripted` are aliases only.
- Treat `Preset`, `Workflow`, and `SeedKind` separately. A workflow is the planner/source spine, a preset is taste/model/defaults, and a seed is the starting material (`audio`, `script`, `brief`, `document`, `idea`).
- Tool availability lives in `server/tools/registry.ts`. The web Blueprint shelves and MCP packets should both read `availableTools` / `blockedTools` instead of inventing phase gates.
- LLM prompt builders use `composePrompt` sections: core task, workflow context, inputs, preset taste, user-note policy, output contract, user note. Do not reintroduce fat templates with hidden preset/workflow labels.
- Treat queue as one source adapter, not the universal intake model. Non-Lahari users may start from a pasted/uploaded script, audio, brief, document, or idea.
- Runtime schema can be switched by env: `DB_TABLE_PREFIX=lahari` uses the legacy production-shaped tables, `DB_TABLE_PREFIX=studio` uses clean platform tables.
- New non-Lahari work should use a fresh Supabase project with the `studio_*` schema. Do not point generic artists at the Lahari/Bhakti production DB.
- The clean DB bootstrap migration is `migrations/2026-05-13_create_studio_workspace_schema.sql`; operator notes are in `docs/studio-db-bootstrap.md`.
- Storage bucket is configurable with `SUPABASE_BUCKET` / `STORAGE_BUCKET`; default remains `lahari-assets` for compatibility.
- Platform-only project columns (`preset_key`, `workflow_key`, `seed_kind`, `project_brief`, `source_payload`) are only written when the platform schema is enabled.
- The product-facing prompt surface is **Tool Recipes**, backed by the registry and composer/X-Ray recipe traces. `server/prompts/catalog.ts` is now a secondary legacy/template reference and must stay truthful, but it is not the primary product contract.

Good starting docs:
- `docs/abstraction-platform-plan.md` — merged Codex-native platform plan and strategic shape.
- `docs/preset-abstraction-plan.md` — current preset/workflow/seed plan and v1 finish line.
- `docs/studio-db-bootstrap.md` — how to create the fresh Supabase project and run the clean `studio_*` schema.
- `docs/world-class-plan.md` — product north star; explicitly frames Lahari as the first vertical workflow, not the final product boundary.
- `docs/pipeline-anatomy.md` — current pipeline trace and known hardcoded devotional points; search for "preset" and "Devotional cinema".
- `docs/seedance-storyboard-workflow.md` — current Seedance storyboard baseline that the abstraction must preserve.
- `docs/assistant-director-plan.md` — adjacent future lane for agentic orchestration; useful context, but do not mix it into the preset abstraction unless asked.
- `docs/learning-loop-plan.md` — later feedback/research loop; useful after presets exist.

## Build & Run

```bash
npm install
npm run dev          # Backend :3003 (or PORT env), frontend :3002 (Vite proxies /api + /storage)
npm run dev:server   # Backend only
npm run dev:client   # Frontend only
npm run build        # Vite production build -> dist/
npm run lahari -- setup  # legacy internal setup helper; artists use deployed Mirage /connect instead
npm run lahari       # legacy-named internal CLI helpers around codexStudio
npm run lahari:mcp   # legacy-named in-process MCP debug adapter
npm start            # Production: Express serves dist/ + /api + /storage from one origin
```

Renderer validation:

```bash
cd remotion-renderer && npm run build
```

Useful checks in this repo: `npm run build`, `npx tsc --noEmit`, `git diff --check`. There is no `npm run check`.

## Env Vars

- `GEMINI_API_KEY` - Gemini 3 Pro Image (`imagen.ts`), Gemini audio/vision (`gemini.ts`), and Gemini text when the artist picks Gemini in the text-provider picker.
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY` - GPT-5.5 text-provider option, `gpt-image-2` storyboard/image provider, and optional GPT script-writer experiment.
- `SCRIPT_WRITER_PROVIDER=openai` (optional) - forces `generate-script` to GPT-5.5 globally. Script writing is otherwise Claude Opus and is intentionally not routed through the text-provider picker.
- `SEGMIND_API_KEY` - all video generation through Segmind; also Nano Banana 2 image renderer.
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` - Postgres + Storage + song catalog.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` - frontend auth.
- `DB_TABLE_PREFIX` - optional. Defaults to `lahari`. Set to `studio` for the fresh platform DB.
- `VITE_DB_TABLE_PREFIX` - optional frontend realtime table prefix. Defaults to `studio` in this Mirage lane. Set to match `DB_TABLE_PREFIX` if testing a legacy/prefixed environment.
- `SUPABASE_BUCKET` / `STORAGE_BUCKET` - optional. Defaults to `lahari-assets`. Set to something like `studio-assets` for the clean project.
- `CORS_ORIGINS` - comma-separated in prod.
- `REMOTION_RENDERER_URL`, `RENDERER_SHARED_SECRET` - sibling renderer service URL and `x-renderer-secret`.
- `RENDER_ENGINE` (optional, default `ffmpeg`) - Modal renderer engine. `ffmpeg` uses the fast FFmpeg concat path for eligible timelines and falls back to Remotion. `remotion` forces Remotion for everything. `FFMPEG_PRESET` default `veryfast`, `FFMPEG_CRF` default `23`, `FFMPEG_AUDIO_BITRATE` default `192k`.
- Vertex fallback: `GCP_PROJECT_ID=turiya-462513`, `GCP_LOCATION=us-central1`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`. Used only as Veo fallback and by last-frame extraction paths that still need GCP config.

Production Mirage app: https://mirage-platform-production-05ca.up.railway.app

## Engine Session Protocol

**Before substantive work, read `docs/mirage-platform-v1-ledger.md`** for current Mirage v1 state and task ownership. Also read `docs/codex-native-doctrine.md` when the work touches MCP/CLI boundary, harness-native behavior, permissions, source-of-truth rules, or distribution.

Sessions in this repo are engine sessions only — improving Mirage itself (code, prompts, infra, docs, schema, deployment). Director-session work (operating Mirage on a specific project) happens in artist-shaped workspaces against deployed Mirage, not here. See "Operating Principle" above.

### Engine Session Opening Move

1. `pwd` + `git status --short --branch` — confirm which worktree and which branch.
2. Skim the latest checkpoints and active tracks in `docs/mirage-platform-v1-ledger.md` — know what's shipped, what's pending operationally, and what the next workstream is.
3. Skim recent captured issues if any (`lahari_issues` table or `.mirage/issues/` local debug files).
4. Then ask the user what to build, fix, or review.

### When an engineer wants to experience director-session behavior

Open any empty folder in Codex Desktop or Claude Code, mint a token at the deployed Mirage `/connect` page, paste the install snippet, restart the harness, ask to open a project. Same path an artist takes. That's the surface to test — not the internal MCP from inside this repo (the internal path bypasses real auth, real rate limits, real network conditions, and presents a falsely-comfortable shape).

### Full Operating Skill

The full director rubric (taste checks for concept/script/style/shots/assets/audio, permission rules, output style examples) lives at `.agents/skills/mirage-director/SKILL.md`. Read it when giving creative feedback or proposing changes — it captures the production language and refusal patterns to follow.

## Internal Debug Surfaces

The shared service for Codex tools is `server/services/codexStudio.ts`. The CLI and MCP are adapters around that service:

```bash
npm run lahari -- project list [limit]
npm run lahari -- project packet <projectId>
npm run lahari -- project actions <projectId>
npm run lahari -- project hydrate <projectId> [outputDir]   # internal desk-copy primitive
npm run lahari -- project storyboard-review <projectId>
npm run lahari -- shot packet <projectId> <shotId>
npm run lahari -- project report <projectId> [out.md]
npm run lahari -- project sheet <projectId> <overview|style|references|storyboard|renders> [out.html]
npm run lahari -- project contact-sheet <projectId> [out.html]
npm run lahari -- session attach <projectId> [note...]
npm run lahari -- session state <projectId>
npm run lahari -- session note <projectId> <note...>
npm run lahari -- session journal <projectId>
npm run lahari -- preview rewrite-script <projectId> [note...]
npm run lahari -- preview rewrite-shot-prompts <projectId> [note...]
npm run lahari -- preview rewrite-storyboard-prompt <projectId> <shotId> [note...]
npm run lahari -- plan generate-storyboard <projectId> <shotId>
npm run lahari -- plan generate-video <projectId> <shotId>
npm run lahari -- apply-plan rewrite-script <preview.json>
npm run lahari -- apply-plan rewrite-shot-prompts <preview.json>
npm run lahari -- apply-plan rewrite-storyboard-prompt <preview.json>
npm run lahari -- apply rewrite-script <preview.json>
npm run lahari -- apply rewrite-shot-prompts <preview.json>
npm run lahari -- apply rewrite-storyboard-prompt <preview.json>
npm run lahari -- rollback rewrite-script <preview.json>
npm run lahari -- rollback rewrite-shot-prompts <preview.json>
npm run lahari -- rollback rewrite-storyboard-prompt <preview.json>
npm run lahari -- apply generate-storyboard <projectId> <shotId> [artist note...]
npm run lahari -- apply generate-video <projectId> <shotId> [prompt override...]
npm run lahari -- apply shot-prompts <projectId> <shots.json> [force]
npm run lahari -- apply storyboard-prompt <projectId> <shotId> <prompt.md> [cut-plan.md] [baseHash]
npm run lahari -- apply storyboard-prompts-bulk <projectId> <shots.json> [force]
npm run lahari -- apply concept <projectId> <concept.json> [baseHash]
npm run lahari -- apply video-prompt <projectId> <shotId> <motion-prompt.md> [baseHash]
npm run lahari -- apply script <projectId> <script.json> [baseFingerprint|force]
```

Generated local artifacts from current internal debug commands live under `.mirage/` and are intentionally ignored:

- `.mirage/codex/` - director reports and contact sheets
- `.mirage/projects/<projectId>/` - local Codex workbench mirror (`brief.md`, `audio-analysis.md`, `script.md`, `storyboard-prompts.md`, snapshots)
- `.mirage/sessions/<projectId>/` - `state.json` and `journal.md`
- `.mirage/previews/<projectId>/` - preview JSON/Markdown/runtime prompts

Durable artist/operator decisions are written to Supabase director events (`lahari_director_events` in legacy mode, prefix-mapped for studio mode where applicable). Internal `session attach` reads new events since the last monotonic `seq` cursor and appends them into `.mirage/sessions/<projectId>/journal.md`; this is a developer/debug mirror, not the artist distribution path.

Remote artist notebooks use `mirage/projects/<projectId>/` instead of `.mirage/`. That folder is created by `write_project_notebook`, not by this repo's internal CLI.

**Realtime transport is shipped (R36):** prefix-mapped `agent_operations` tracks every non-readonly tool call (`status: running | success | error`, scoped to project/scene/shot), wired into both `/api/director/*` and `/mcp` `audited` wrappers. Web studio subscribes via Supabase realtime channel per project; renders a quiet pill in the header. See doctrine §6 reference. Frontend already subscribes to `postgres_changes` across project-relevant tables for cascade refresh.

Permission boundary:

- Read-only inspection and local artifacts are safe to run.
- Preview commands are non-mutating but may call paid models, so ask before running them autonomously.
- Apply commands mutate Supabase and must be explicit user-approved commands. They require a valid `SUPABASE_SERVICE_KEY`; Codex tools may fall back to `VITE_SUPABASE_ANON_KEY` for read-only work, but apply tools refuse anon fallback.
- Ask before paid generation, DB writes, lock/unlock changes, deletes, publish, or destructive rewrites.

The CLI and in-process MCP are engine-side debugging surfaces — useful for scripts, audit inspection, disaster recovery, and one-off operations. They are **not** the director-session surface. The director surface for artists lives at deployed Mirage over remote MCP. Don't shoehorn director work through CLI here unless you are explicitly debugging the engine path.

## Architecture

**Studio engine** — AI-powered video production tool evolving from the Lahari music-video engine. The app still contains some legacy Lahari names at source-adapter and DB-column boundaries, but the Mirage lane is making the core platform clean enough for non-Lahari artists.

- Frontend: React 19 + Vite, Tailwind via CDN.
- Backend: Express 5, stateless, Supabase-backed.
- Storage: Supabase Storage bucket via `SUPABASE_BUCKET` / `STORAGE_BUCKET`, default `lahari-assets`; final renders currently live under `videos/<projectId>/...` in the configured render bucket.
- DB: Supabase Postgres via `server/database.ts`. Table prefix comes from `DB_TABLE_PREFIX` (`lahari_*` legacy, `studio_*` clean platform).

Auth: Supabase Auth with Google OAuth. Backend uses `requireAuth`. Project ownership is enforced at route params. Child URL/body IDs are scoped through route params and `scope-helpers.ts`. No null-owner bypass.

1. **Intake** (`StartProject.tsx`) — Direct project creation is the platform path. `music_led` projects start from uploaded audio. `scripted_narrative` projects, including the anime preset, start from pasted/uploaded script or related source material. The old `music_video_queue` flow remains a legacy backend/source adapter, not the default platform UI.
2. **Blueprint** (`AnalysisEditor.tsx`) — asset shelves for project graph setup:
   - Concept (project text provider, 3 options or 1 director-brief option, regen with note)
   - Script (script writer / parser proposes cast + environments + scenes + shots with validated durations)
   - Style (text-provider brainstorm → selected image provider visualize → style asset lock)
   - Characters (Gemini 3 Pro Image, 3 parallel calls per char)
   - Environments (Gemini 3 Pro Image, 3 parallel calls per env)
   - Audio for scripted narrative when needed: dialogue plan, cast voice IDs, TTS generation, lipsync/overlay strategy.
   - Auto-writes shot prompts with full context when prerequisites exist.
3. **Studio** (`Storyboard.tsx`) — Per-shot:
   - Keyframe mode: generate start frame (Gemini 3 Pro Image with full ref chain)
   - Seedance storyboard mode: generate/refine/lock an ordered storyboard board first, then generate video from storyboard + refs
   - Generate video (Veo 3.1 or Seedance 2.0 via Segmind)
   - ffmpeg extracts last frame → becomes continuity ref for next shot if `continuity_from === 'prev_shot'`
   - Lock shot (requires start + video)
4. **Render** (`StepRender.tsx`) — timeline snapshot posts to the backend render endpoint; FFmpeg is preferred for eligible timelines and Remotion remains the fallback for richer edits.

Generate router modules:

| Module | Owns |
|---|---|
| `generate.ts` | router composition, params, unlocks, mounts |
| `generate-style.ts` | style brainstorm/visualize/refine/lock/presets/upload |
| `generate-looks.ts` | character/env look gen, refs, lock/advance |
| `generate-script.ts` | script gen/refine/write-shot-prompts |
| `generate-shots.ts` | shot image/end-frame/storyboard/history/refs/split/lock |
| `generate-video.ts` | Segmind video gen, revert-video, chained prompt refresh |
| `scope-helpers.ts` | shared scoping helpers |

## Legacy Lahari Pipeline Notes

1. **Legacy queue adapter** - Supabase `music_video_queue` + `songs`. Queue start creates a project immediately and background-runs audio download, SRT parse, transcription fallback, structure detection, and meaning summary. Analysis caches onto `songs` so future users skip repeat AI calls. Multiple users can start the same queue item; `source_queue_id` links their own projects. Mirage's main frontend entry is `StartProject.tsx`, not the queue table.

2. **Blueprint** (`AnalysisEditor.tsx`) - Concept, Script, Style, Characters, Environments.
   - Concept/style/refines use the project `text_provider` via `server/services/text-provider.ts`.
   - Script writing remains Claude Opus direct (`planScenes`, `refineScript`, `writeShotPrompts`) because it uses extended thinking plus a validation loop.
   - Mirage v1 does not expose legacy curated Lahari style presets. If curated styles return, they must be workflow/preset-specific clean assets in `server/style-presets.ts`; the locked preset image is ground truth and `style_description` stays intentionally empty.
   - Characters/environments use editable generation prompts and the locked style image as the visual ground truth.

3. **Studio** (`Storyboard.tsx`) - Per-shot production.
   - Keyframe mode: First frame / Last frame / Video / Full chain using `PromptToolkit`.
   - Seedance storyboard mode: `StoryboardPanel` replaces keyframe tabs with a two-step board workflow.
   - Shot-level refs, @mention prompt editing, generation/refine buttons, version history, lock/unlock all live here.

4. **Render** (`StepRender.tsx`) - Timeline editor sends a render-authoritative zustand snapshot to `/api/projects/:id/render`. Main backend creates a `lahari_renders` row and calls the sibling `remotion-renderer` service. Frontend polls `/render-status`.

## AI Models And Providers

| Stage | Model/provider | Code |
|---|---|---|
| Audio transcription / structure | Gemini 3 Pro | `gemini.ts` |
| Concept/style/meaning/refines/storyboard planner | Project `text_provider`: `claude-opus`, `gpt-5.5`, `gemini-3-pro` | `claude.ts` -> `text-provider.ts` |
| Script writer | Claude Opus 4.7 direct; optional GPT via env/body experiment | `claude.ts`, `openai-script.ts` |
| Image gen default | Gemini 3 Pro Image ("Nano Banana Pro") with flash fallback | `imagen.ts` |
| Image alternates | `nano-banana-2`, `gpt-image-2` | `segmind-image.ts`, `openai-image.ts` |
| Storyboard image | Project `storyboard_provider`: `nano-banana-2`, `nano-banana-pro`, `gpt-image-2` | `storyboard.ts` |
| Video | Segmind: Seedance 2.0 / Veo 3.1 variants | `segmind.ts`, `video-provider.ts` |

### Text Provider Routing

`project.text_provider` controls concept generation/refine, style brainstorm/refine, meaning summary, image-style analysis, frame/motion/chained refines, character/env look refines, and storyboard prompt writing.

It does **not** control script writing. The UI says "Script writer always uses Claude Opus." Keep that true unless the script stack is explicitly ported.

Implementation notes:
- `server/services/text-provider.ts` is the unified dispatcher.
- Anthropic uses tool-use for structured output.
- OpenAI uses JSON schema output; keep schemas compatible with OpenAI requirements.
- Gemini uses `responseSchema`/JSON mode and inline data for vision when needed.
- Refines use cheaper sibling models through `useRefineModel: true`.

## Seedance Storyboard Workflow

This is now a two-step pipeline, matching frame generation shape.

1. `POST /write-storyboard-prompt` runs the text planner and saves:
   - `shot.storyboard_prompt` - image-render prompt, including per-panel action descriptions inline.
   - `shot.storyboard_cut_plan` - panel beats for Seedance video.
   - `storyboard_prompt_status`.
2. `POST /generate-storyboard` renders exactly the saved `storyboard_prompt` with the selected `storyboard_provider` and locked refs. It does not re-plan.
3. `refine-storyboard` has two modes:
   - `replan` rewrites saved text only; artist renders explicitly afterward.
   - `edit_image` uses current board + refs + artist note to render a new board; text fields stay untouched.

Prompt rules:
- Keep storyboard prompts short and image-native. Per-panel actions belong inside `storyboard_prompt`; long "contract" bullet lists, animation rules, and quality boilerplate made outputs worse.
- Board panels are ordered left-to-right, then top-to-bottom.
- Do not ask for visible panel numbers, captions, arrows, labels, or readable text. Seedance can copy those into video.
- Thin panel borders are acceptable; they standardize boards.
- `storyboard_cut_plan` may be empty. Lock/image gen do not require it; empty cut plan means Seedance relies more on the board order.

Continuity:
- Storyboard mode ignores the old extracted-frame chain and does not block on `prev_shot`.
- Optional previous storyboard ref: `use_prev_storyboard_ref`.
- Optional previous cut-plan text context: `include_prev_cut_plan` (nullable means smart default from `continuity_from`).

## Video Generation

All video generation goes through Segmind first. Veo requests may fall back to Vertex when Segmind fails for infra/billing reasons and Vertex is configured. Seedance never falls back to Vertex.

Seedance constraint: `first_frame_url` and `reference_images` are mutually exclusive. Keyframe mode prioritizes frame control. Storyboard mode sends no `first_frame_url`; it sends locked storyboard as `@image1` plus style/cast/environment refs.

Keyframe video prompt is mostly `motionPrompt` plus actually-attached ref labels. Do not stuff scene/mood/cast prose into the video prompt; the start frame already carries the visual state.

## Render Pipeline

Render is async because real renders can exceed Railway request limits.

Flow:
1. `StepRender` posts timeline snapshot to `/api/projects/:id/render`.
2. Main backend inserts `lahari_renders`, returns `202`, and calls renderer service.
3. Renderer stages remote media to `/tmp`, serves it over loopback HTTP, renders, uploads mp4 to Supabase, and calls `/api/renders/callback/:renderId`.
4. Frontend polls status. Watchdog/reconciler handle stale rows and callback fallback.

Supabase Postgres tables are prefix-mapped in `server/database.ts`.

- Legacy/prod-compatible mode: `DB_TABLE_PREFIX=lahari` (default) uses `lahari_projects`, `lahari_scenes`, `lahari_shots`, etc.
- Clean platform mode: `DB_TABLE_PREFIX=studio` uses `studio_projects`, `studio_scenes`, `studio_shots`, etc.
- The clean bootstrap migration is `migrations/2026-05-13_create_studio_workspace_schema.sql`.
- The clean schema deliberately does not create `songs`, `files`, or `music_video_queue`; those belong to the old source catalog/queue adapter.
- `studio_projects` adds `preset_key`, `workflow_key`, `seed_kind`, `project_brief`, and `source_payload`.
- Do not run the clean studio migration on the Lahari production project unless Saul explicitly decides to colocate both schemas. The intended v1 boundary is a separate Supabase project.
- All DB access goes through `server/database.ts`. Legacy `db.ts`, `veo.ts`, `fal.ts` have been deleted.

Renderer engines:
- Default `RENDER_ENGINE=ffmpeg`.
- FFmpeg eligible: only video/image/audio items, no transitions, no visual effects, no custom positioning/transforms, no playback-rate changes, no overlapping visual clips.
- FFmpeg output: `libx264`, preset `veryfast`, CRF `23`, yuv420p, faststart, audio mixed with AAC.
- Ineligible timelines fall back to Remotion. Keep Remotion for future text effects, transitions, and richer layout work.

Timeline editor features include media library, split-at-playhead, ripple delete, horizontal scroll, version append, and render history. Sync renderer timeline copies with `cd remotion-renderer && npm run sync-timeline` after changing upstream timeline composition code.

## Staleness

Upstream changes mark downstream `prompts_stale`; UI shows amber "Outdated". No auto-overwrite. Artist chooses rewrite/regenerate. Cleared when generation/refine/direct prompt edit updates the relevant prompt.

Known caveat: `lahari_shots.prompts_stale` is shared by keyframe `visual_prompt` and storyboard `storyboard_prompt`. Rewriting one clears the shared flag. Future schema should split `visual_prompt_stale` and `storyboard_prompt_stale`.

## Prompt Sources

The current prompt/tool architecture has three layers:

- `server/tools/registry.ts` — cross-surface tool contract: what exists, what it needs, what it reads, what it produces, and where it appears.
- `server/prompts/*` + `server/prompts/_composer.ts` — runtime prompt builders. Keep core task, workflow context, inputs, preset taste, user-note policy, output contract, and user note as explicit sections.
- `components/PromptsLibrary.tsx` / `/api/prompts` — artist/debug surface now framed as Tool Recipes, with legacy template references below.

`server/prompts/catalog.ts` is a secondary read-only template/reference surface. It must stay in sync with runtime prompt changes, but do not treat it as the primary source of truth over the registry/composer.

Runtime prompt changes commonly touch:

- `server/prompts/*`
- `server/tools/registry.ts` when a tool's inputs/outputs/availability change
- `server/services/claude.ts` and `server/services/openai-script.ts` shims
- `server/services/storyboard.ts`
- `server/services/seedance-storyboard-rd.ts`
- `server/routes/generate-video.ts`
- `components/PromptsLibrary.tsx` if the artist-facing recipe surface changes

**Legacy source-catalog tables (only in the old Lahari Supabase project):**
- `songs` — 1490 songs with `audio_storage_url` / `drive_audio_url`
- `files` — SRT files, etc. (Google Drive URLs)
- `music_video_queue` — song_id, priority, status, lahari_project_id, video_url

These are not part of the clean `studio_*` schema. Code that depends on them should be treated as queue-adapter code.

`docs/pipeline-anatomy.md` is the step-by-step control-flow doc. Update it with any pipeline behavior change, especially prompt ownership, hidden dependencies, provider routing, and artist-visible control changes.

## Database Notes

Important clean-platform project fields:
- `preset_key`
- `workflow_key`
- `seed_kind`
- `project_brief`
- `source_payload`

Canonical workflow values are `music_led` and `scripted_narrative`. Legacy rows may still contain `music_video` or `anime_scripted`; normalize them at read boundaries and do not emit them in new artist-facing packets/UI.

Important current project fields:
- `image_model`
- `storyboard_provider`
- `text_provider`
- `video_model`
- `source_queue_id`
- `style_exploration`
- render settings: `aspect_ratio`, `video_resolution`

Important shot fields:
- keyframe: `visual_prompt`, `motion_prompt`, `end_visual_prompt`, `extracted_last_frame_asset_id`
- storyboard: `storyboard_prompt`, `storyboard_cut_plan`, `storyboard_prompt_status`, `storyboard_asset_id`, `storyboard_version_id`, `storyboard_locked`, `excluded_refs`, `use_prev_storyboard_ref`, `include_prev_cut_plan`
- shared: `direction`, `continuity_from`, `prompts_stale`, `last_error`

`lahari_storyboard_versions` still has legacy OpenAI-specific fields (`openai_response_id`, `openai_image_call_ids`, `reasoning_model`) but generic provider metadata is now the important path. Canonical cut-plan text lives on `lahari_shots.storyboard_cut_plan`; `metadata.cutPlanText` is legacy.

## Key API Endpoints

**Queue:**
- `GET /api/queue` — list with joined song data
- `POST /api/queue/:queueId/start` — pull audio + SRT, create a project from the legacy queue adapter
- `PATCH /api/queue/:queueId` — update status / video_url

**Direct intake:**
- `POST /api/projects` — upload audio, analyze lyrics/structure, create a `music_led` project
- `POST /api/projects/script` — paste/upload script, parse into scenes/shots/cast/environments, create a `scripted_narrative` project, usually with the anime preset for v1

**Blueprint:**
- `POST /api/projects/:id/generate-concepts` (userNote optional)
- `POST /api/projects/:id/generate-script` (userNote optional; experimental `scriptProvider: "openai"` switches to GPT-5.5)
- `POST /api/projects/:id/brainstorm-styles`, `visualize-style`, `refine-style-direction`, `analyze-style-image`, `lock-style`, `unlock-style`
- `POST /api/projects/:id/generate-looks`, `lock-character`, `advance-characters`
- `POST /api/projects/:id/generate-environment-look`, `lock-environment`, `advance-environments`
- `POST /api/projects/:id/write-shot-prompts`
- `POST /api/projects/:id/write-audio-plan`, `audio-plan-cost`, `generate-dialogue-audio`

Studio:
- `POST /api/projects/:id/shots/:shotId/generate-image`
- `POST /api/projects/:id/shots/:shotId/generate-video`
- `POST /api/projects/:id/shots/:shotId/write-storyboard-prompt`
- `POST /api/projects/:id/shots/:shotId/generate-storyboard`
- `POST /api/projects/:id/shots/:shotId/refine-storyboard`
- `POST /api/projects/:id/shots/:shotId/lock-storyboard`, `unlock-storyboard`
- `PATCH /api/projects/:id/shots/:shotId/storyboard-plan`
- `GET /api/projects/:id/shots/:shotId/storyboard-history`
- `GET /api/projects/:id/shots/:shotId/history`
- `POST /api/projects/:id/shots/:shotId/split`
- shot ref upload/delete, frame clears, revert endpoints, scene lock-all/unlock-all

Render:
- `POST /api/projects/:id/render`
- `GET /api/projects/:id/render-status`
- `GET /api/projects/:id/renders`
- `POST /api/queue/publish/:projectId`
- `POST /api/queue/publish-url/:projectId` where available/preferred.

Admin diagnostics behind `x-admin-secret`:
- `/api/admin/env`
- `/api/admin/usage`
- `/api/admin/errors`
- `/api/admin/active-renders`

## Deployment

Railway project: `lahari-media-engine` (`a2ef8e79-f9ae-4dce-80e0-114d80e0a575`). Deploy with:

```bash
railway up --detach
```

If Railway CLI auth is stale, run `railway login` in a TTY and use the activation code. Before render-service deploys, check active renders via `/api/admin/active-renders` if possible.

Migrations are additive. Apply new migrations before deploying code that reads new columns (`text_provider`, storyboard prompt fields, render progress fields, etc.).

## UI System

Use the typography/color tiers in `index.html`.

- Size tiers: `text-[11px]`, `text-xs`, `text-sm`, `text-lg`, `text-2xl`.
- Text colors: `text-white`, `text-zinc-300`, `text-zinc-400`.
- Avoid native `<select>`; use `components/Dropdown.tsx`.
- Keep dark UI readable; avoid `zinc-500+` for body text.

## Express 5 / TS Notes

- Route params can be `string | string[]`; use `paramStr()`.
- Catch-all route is `/{*path}`, not `*`.
- Path alias: `@/*` -> project root.
