# Lahari AI Video Production Studio

## Case Study

Mothership built Lahari into an AI-assisted video production studio for devotional music videos: a system that turns a song catalog into concepts, scripts, style references, character and environment looks, storyboards, generated clips, editable timelines, and final renders.

The work happened in two layers.

First, we built the production machine: a real visual studio with queueing, song analysis, prompt transparency, model selection, reference management, storyboard/video generation, and a render timeline.

Then we made that machine agent-native: operable through Codex and Claude, with remote MCP tools, local notebooks, editable drafts, validation, audit trails, realtime activity, and approval-safe apply flows.

The result is a studio where artists and AI agents can coordinate around the same project, see what changed, control models and workflows, manage budget-sensitive generations, preserve creative continuity, and move from song to finished video dramatically faster than a manual production loop.

## The Problem

AI video tools can generate impressive clips, but production work is bigger than clip generation.

Artists need to choose the right song, understand the lyrics, map the structure, design a concept, maintain character and style continuity, plan scenes and shots, generate references, review variations, assemble the final timeline, and keep track of what has already been approved.

Before Lahari, that work lived across scattered tools, chats, spreadsheets, folders, prompts, and human memory. It was hard to coordinate, hard to reproduce, and slow to scale. Every new generation risked losing context from the previous step.

The goal was not just "make AI videos." The goal was to build a repeatable production system for artists.

## Phase 1: The Visual Studio

Mothership first built Lahari as a full-stack AI video studio.

The studio starts from Lahari's digitized music catalog. Songs are stored with metadata, audio files, and subtitle/transcription assets in Supabase. From the queue, an artist can start a production project immediately. The system creates a project, downloads audio, reads verified SRT files when available, falls back to Gemini transcription when needed, detects musical structure, summarizes meaning, and caches the analysis back onto the song so future users skip duplicate AI work.

That audio analysis becomes the context chain for the rest of the pipeline.

The Blueprint stage turns the song into a production plan: concept directions, script, scenes, shots, style, character references, and environment references. The system does not treat each model call as isolated. Lyrics, meaning, musical sections, song type, locked concept, style reference, cast, environment, and shot direction flow forward through the pipeline so downstream generations stay grounded.

The Studio stage turns the plan into media. Artists can work shot by shot, choose model/workflow settings, generate frames, generate videos, use storyboard mode for Seedance, inspect histories, refine prompts, lock good outputs, and keep stale work visible instead of silently overwriting it.

The Render stage gives artists a real timeline editor. Generated clips become editable media. Artists can trim, sequence, assemble, render, publish, and keep version history. Final renders are uploaded to Supabase Storage and written back to the production queue.

In product terms, Phase 1 created four core surfaces:

- **Queue:** choose songs from a production catalog, start work instantly, preserve per-user forks, and reuse cached analysis.
- **Blueprint:** turn audio and meaning into a creative plan: concept, script, style, characters, environments, and reference assets.
- **Studio:** produce shot-level media with visible prompts, references, generation history, storyboard mode, video mode, locks, and stale-state warnings.
- **Render:** assemble generated clips into a final timeline, render asynchronously, track progress, and publish the output.

## Engineering Highlights

Lahari was built as production software, not a thin prompt wrapper.

It includes:

- Supabase Postgres project model for songs, queue items, projects, scenes, shots, cast, environments, assets, AI calls, renders, and final outputs.
- Supabase Storage for audio, references, generated assets, storyboards, clips, and renders.
- Multi-user queue behavior so multiple artists can start their own production forks from the same song.
- Audio analysis pipeline with SRT priority, transcription fallback, timestamp preservation, musical structure detection, song classification, meaning summary, and cached reuse.
- Prompt catalog and pipeline anatomy docs that expose every major prompt, model, variable, and control point.
- Visible/editable prompt fields across the workflow so artists can directly steer generation instead of relying on hidden backend magic.
- Staleness detection when upstream creative choices change, so downstream prompts and media are flagged rather than overwritten.
- Character, environment, and style reference systems that preserve identity and visual continuity across shots.
- Seedance storyboard mode for multi-panel shot planning, cut plans, storyboard boards, and storyboard-driven video generation.
- A render timeline editor with media library, trims, version append, render history, and final publish flow.
- Separate render infrastructure for long-running Remotion/FFmpeg jobs, with progress, watchdogs, fallback, and Supabase upload.

## Phase 2: Agent-Native Operations

Once the visual studio existed, Mothership turned it into an agent-operable creative workcell.

Codex and Claude can now operate Lahari through a remote MCP surface. Artists connect with a token from `/connect`, open a clean workspace, ask to open a song, and the agent materializes a project notebook locally.

That notebook contains read-only mirrors of canonical project state, editable drafts for scripts and storyboard prompts, project-level config overrides, a local journal, and Lahari-specific skills for script direction, storyboard prompt craft, continuity review, style critique, and render triage.

This changed the operating model. The web app remains the visual studio. Codex or Claude becomes the director/operator sitting beside the artist.

Agents can inspect the project, reason over the song and production state, write or revise scripts and storyboard prompts locally, then persist changes through typed apply tools. Apply tools validate structure, check drift, update Supabase, write events, and return refreshed artifacts. Costly generation and destructive mutations remain explicit approval moments.

The same studio can now be run by artists, agents, or both.

The important nuance: agents do not replace the studio. They operate it. Lahari keeps canonical project truth in Supabase, the web app keeps visual review and approval, and the agent works through a constrained tool surface that preserves state, cost awareness, and rollback discipline.

## Agent-Native Highlights

Phase 2 added:

- Remote MCP with bearer-token auth for Codex and Claude.
- `/connect` onboarding for artists to mint tokens and install the Lahari tool surface.
- Notebook sync via `npx @ssaulgoodman420/lahari-cli`, with MCP file-by-file fallback when shell or npm is blocked.
- Editable `drafts/script.md` and scene-level storyboard markdown files that apply back through validation tools.
- Project-level prompt and model preference overrides.
- Apply-only tools where Codex writes taste-heavy text and Lahari validates/persists it.
- Artist memory search for prior styles, reusable references, older storyboards, and taste patterns.
- Realtime agent-operation presence in the web studio so artists can see when Codex is working.
- Security and audit hardening: rate limits, body limits, redacted logs, ownership checks, and issue capture.
- Render media-library hardening so regenerated clips appear as new takes and never destroy a saved timeline.

## What Changed

Before, producing a polished AI music video required coordinating many fragile steps manually: gather assets, understand the song, write prompts, generate candidates, track references, manage revisions, assemble clips, and remember which decisions mattered.

With Lahari, those steps became a production system.

An artist can move through a guided workflow, but still keep control. The system knows the project state, the model choices, the references, the prompt history, the render state, and the next useful action. Agents can assist without becoming a black box because every mutation flows through typed tools, visible drafts, logs, and approval boundaries.

For suitable projects, this compresses work that used to take weeks of fragmented coordination into a focused production cycle that can happen in roughly a day, with better traceability and fewer lost decisions.

## Impact

Lahari gives teams a repeatable way to produce AI video at scale.

It lets artists:

- Start from a real song catalog instead of an empty prompt box.
- Reuse accurate song analysis across projects.
- Preserve cultural, lyrical, and musical context across the whole pipeline.
- Choose models and workflows per project or per shot.
- Keep style, character, and environment continuity anchored by locked references.
- Review and lock outputs intentionally.
- Track stale work, failed generations, and render status.
- Coordinate with agents without losing authorship or control.
- Move from ideation to rendered video inside one production environment.

The deeper impact is operational. Lahari turns AI video from a series of experiments into a supervised production line.

## Positioning Line

Mothership built Lahari as a production operating system for AI video: first the visual studio, then the agent-native layer that lets artists and AI collaborators run it together.

## Short Copy Options

**One-liner**

Mothership built Lahari, an AI video production studio that turns a song catalog into coordinated, storyboarded, rendered music videos with artists and agents working in the same production loop.

**Website short**

Lahari is an AI-assisted video studio for music-video production. It analyzes songs, builds concepts and scripts, generates references, plans shots, creates storyboard/video assets, assembles timelines, and lets artists coordinate with AI agents through traceable, approval-safe workflows.

**LinkedIn short**

Most AI video demos stop at a clip. Lahari is what happens when you build the whole production machine around the clip: catalog intake, transcription, song analysis, concepts, scripts, style refs, character/env continuity, storyboards, generated videos, render timelines, approvals, budgets, and agent-operated workflows.

## Video Story Angles

**Product demo angle**

Start with a song in the queue. Show Lahari analyzing lyrics and structure, generating a concept, building a script, locking style/cast/environment references, creating storyboard boards, generating videos, assembling the render timeline, and publishing the final output.

**Engineering angle**

Show the hidden machinery: Supabase project state, prompt catalog, context chaining, staleness flags, AI call logs, storyboard cut plans, render worker, FFmpeg/Remotion path, and final Supabase Storage output.

**Agent-native angle**

Show an artist asking Codex to open a project. Codex syncs the notebook, edits a script or storyboard draft, applies it through Lahari tools, and the web studio updates with realtime agent activity.

**Business impact angle**

Frame it as production compression: weeks of fragmented creative coordination becoming a guided, inspectable workflow where artists and agents can move fast without losing control.

## Snapshot Checklist

For the case study and future video, capture the product in the same order the work flows.

**1. Queue**

- Dashboard with Lahari songs, status/action pills, and search/filter context.
- A song row before starting production.
- If available, a row showing multiple user/project states or completed/in-progress work.

**2. Blueprint**

- Audio/analysis view showing lyrics, structure, meaning, or analysis progress.
- Concept phase with generated/locked concept.
- Script phase with scenes/shots visible.
- Style phase with locked preset/reference.
- Character and environment references after generation/selection.

**3. Studio**

- Shot card with storyboard/keyframe mode visible.
- Storyboard prompt/cut plan area.
- Generated storyboard board.
- Video tab or generated clip with version/history controls.
- Any lock/stale/error indicators that show production state.

**4. Render**

- Timeline editor with generated clips arranged.
- Media library drawer with shot versions/takes.
- Render progress/status.
- Final rendered output or render history.

**5. Agent-Native Layer**

- `/connect` or token/install surface if it is visually clean.
- Codex/Claude resolving or opening a Lahari project.
- Notebook workspace showing `mirrors/`, `drafts/`, `config/`, and `journal.md`.
- Codex editing a script or storyboard draft.
- Apply tool result showing validation/persistence/change summary.
- Web studio with realtime "Codex is working" presence.
- A before/after where the agent-generated change appears back in the studio.

## Visual Assets To Pull

- Queue dashboard with song list and action states.
- Audio analysis / Blueprint view showing lyrics, structure, meaning, and concept/script stages.
- Style preset or locked style reference.
- Character and environment reference selection.
- Studio shot card with storyboard/keyframe controls.
- Storyboard board and cut plan.
- Video generation/version history.
- Render timeline with media library.
- Render status/progress and final output.
- Codex/Claude notebook workspace showing mirrors, drafts, config, and journal.
- Web studio realtime "Codex is working" presence.

## Core Takeaway

Lahari proves the Mothership pattern: build the real operating system around a client workflow, then make it agent-operable.

The win is not just better prompts or faster generation. It is a coordinated machine where software, artists, models, media assets, approvals, and agents all share the same production state.
