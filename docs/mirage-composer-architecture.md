# Mirage Composer Architecture

Status: working direction for Saul/Codex/Claude review.
Sibling: `docs/mirage-composer-audit.md` keeps the tactical prompt-bloat evidence.

This doc replaces the longer debate draft. The point is simple: Mirage should be graph-first, not workflow-first. The composer should not be a hidden director. Codex, the artist, and the UI advance the project graph; the composer only assembles the exact context needed for one action.

## Core Intent

An artist should be able to start with any useful material:

- a rough concept
- a finished script
- an audio track
- a mood board or style image
- character references
- nothing but a sentence of intent

Mirage should not force that into a preset/workflow doctrine. It should populate the graph, then ask what is missing or stale:

- concept
- script/scenes/shots
- style description and style asset
- cast and character references
- environments and environment references
- audio plan, soundtrack, dialogue/TTS
- storyboard boards
- videos
- render timeline

Once graph fields exist, the next move follows naturally. If there is a script but no cast/env/shot graph, normalize the script. If there is audio and the user wants a music-led structure, analyze it. If the user only wants the audio as a soundtrack, attach it to render and skip analysis. If there is concept and style but no characters, generate or define characters. This is product state, not prompt doctrine.

## What The Composer Is For

The composer is an action-scoped context assembler.

For a specific action, it answers:

1. What model or service is being called?
2. What project data does that call need?
3. What references/assets should be attached by default?
4. What saved project override applies?
5. Did the agent or UI explicitly include, exclude, or replace any context for this call?

That is it.

The composer should not decide taste. It should not carry workflow philosophy. It should not explain anime, music videos, education videos, or cinematic taste unless that language is actual project data supplied by the artist/agent.

## Roles

**Project graph:** canonical truth. If "anime" matters, it should be in the concept, style description, script tone, or explicit project notes. Not hidden in a workflow enum that keeps injecting rules forever.

**Project style notes:** small per-surface taste/technique buckets that Codex and artists can edit as the project earns its language. These are live project data, not hidden presets.

**Codex:** director/orchestrator. It reads the graph, talks to the artist, decides the next useful move, and can write final prompts itself when it has strong intent.

**Web UI:** graph editor and visual studio. It should let artists add/edit/lock the same canonical objects. Later, UI buttons can use the same action/context machinery as Codex.

**Composer:** default context bundle for one action. It can build a reasonable call from the graph, but the bundle must be editable per call.

**Action handlers:** hard technical contracts for the worker model. Example: a character reference action can require a reusable identity reference; a storyboard image action can ban readable labels/captions. These are action contracts, not workflow taste.

**Skills:** optional vocabulary/context loaded by Codex when relevant. Specific taste like "Ilya Kuvshinov", "Y2K anime", "educational explainer graphics", or "ambient music-video pacing" belongs here or in project style notes, not always-on composer text.

## Workflows, Presets, And Harvesting

Workflows should not be the runtime brain.

At most, a workflow/preset is an intake shortcut:

- "anime" seeds a starting project mode, maybe a starting style description, and default models.
- "music video" suggests audio analysis and beat/section planning.
- "education video" suggests narration, diagrams, and clearer explanatory structure.

After intake, the graph is the truth. The composer should not keep injecting `anime_default` or `music_led` doctrine into every call. If that taste matters, it should have been written into graph data: concept, script, style description, references, or explicit project override.

Reusable presets come later through harvesting, not upfront doctrine. When a project works and the artist wants episode 2, Codex can help codify the current project's style notes plus proven overrides into a reusable production bible. That bible seeds the next project, but the next project's notes remain editable and can diverge.

This keeps simple facts simple. "Anime, not photoreal" does not need to become a giant reusable bible entry. Codex can infer that from the project mode and write positive image language when needed. The bible is for earned production knowledge: phrasing, techniques, rhythm, dialogue tone, model-specific wording, and override patterns that actually produced good outputs.

## Project Style Notes

Style is not one blob. Different calls need different taste.

Start with small editable string buckets on the project:

```ts
projectStyleNotes: {
  image?: string;       // line, palette, lighting, texture, visual medium
  storyboard?: string;  // panel density, board language, framing habits
  motion?: string;      // cutting rhythm, camera behavior, movement restraint
  script?: string;      // story pacing, scene construction, narration stance
  dialogue?: string;    // voice, humor, restraint, character speech style
  audio?: string;       // ambience, TTS/narration tone, sound treatment
  modelPhrases?: Record<string, string[]>; // optional later: per-model wording that works
}
```

These are not injected wholesale. Each action has sensible default selections:

- character/environment look: `image`
- storyboard generation: `image` + `storyboard`
- video generation: `motion` and, where useful, selected `image`
- script/refine-script: `script` + `dialogue`
- dialogue/audio plan: `dialogue` + `audio`

Codex can include, exclude, or rewrite the selection per call. If only one technique from the project notes applies, use only that technique. If a note is hurting the output, unplug it with context selection rather than fighting the final prompt.

## Action Contracts Vs Style Notes

Do not put action contracts inside style notes or presets.

Action contracts are owned by the tool and apply every time that tool runs:

- character reference: reusable identity image, clean visibility, no accidental props unless requested
- environment reference: reusable location/background plate, not a character-focused scene
- storyboard: ordered panel board, no readable text/captions/arrows/labels
- video: preserve selected refs, obey saved motion/cut-plan intent
- style image: produce a reusable style anchor, not a finished scene illustration

Project style notes are taste and technique:

- flat deadpan anime lighting
- clean gray bunker palette
- fast cuts interrupted by still silent holds
- dry clipped dialogue
- phrase that works well with a specific image/video model

The migration out of `presetTaste` is mostly sorting every old line into one of these two buckets: action contract or project style note. Anything else gets deleted.

## Context Must Be Editable Per Call

Default context is suggested, not mandatory.

Today many builders auto-attach locked style, cast refs, env refs, source script, audio data, or preset rules. Codex can often override prompt text, but cannot always unplug the context bundle.

The new shape should allow:

```ts
contextOverrides: {
  includeStyleImage?: boolean;
  styleAssetId?: string | null;
  styleNoteSections?: {
    include?: Array<'image' | 'storyboard' | 'motion' | 'script' | 'dialogue' | 'audio'>;
    exclude?: Array<'image' | 'storyboard' | 'motion' | 'script' | 'dialogue' | 'audio'>;
  };
  includeCastRefs?: boolean | string[];
  excludeCastRefs?: string[];
  includeEnvironmentRefs?: boolean | string[];
  excludeEnvironmentRefs?: string[];
  includePreviousStoryboard?: boolean;
  includeGuideAsset?: boolean;
  includeProjectStyleDescription?: boolean;
  includeConcept?: boolean;
}
```

Examples:

- Generate a character without the locked style image for one experiment.
- Use one uploaded guide image but skip existing cast refs.
- Treat uploaded audio as soundtrack only, not as music-structure input.
- Generate an alternate storyboard that ignores the previous board.
- Ask for a style image from text only, without current style asset feedback.
- Generate a storyboard using the project's image style note but excluding the motion style note.

This is the key missing piece: not just `promptOverride`, but context override.

## Prompt Override Levels

We need three clear levels, not one overloaded idea.

**Final prompt override:** per-call exact text sent to a worker model. Codex uses this when it knows exactly what the image/video/prompt should say.

**Context override:** per-call include/exclude/swap of graph data and attachments. Codex uses this when the default bundle is mostly right but one source should be unplugged.

**Project prompt override:** persistent project-level instruction for a surface. Example: "For all storyboard prompts in this project, favor flat graphic compositions and deadpan blocking." This should be wired for every declared kind or removed where unsupported.

Current state: final prompt override exists in several places; project overrides are half-wired; context overrides are not first-class enough.

## Composer Sections, Reframed

The old section list was too abstract. The new sections should map to real sources:

- `TASK`: the smallest action contract.
- `PROJECT DATA`: selected graph fields.
- `STYLE NOTES`: selected project style-note buckets.
- `REFERENCES`: selected asset/image/audio attachments and labels.
- `PROJECT OVERRIDE`: persistent override for this action kind, if present.
- `CALL OVERRIDE`: final prompt override or call note, if this is a legacy web path.
- `OUTPUT CONTRACT`: schema/format only.

Remove or aggressively shrink:

- `workflowContext`
- `presetTaste`
- `userNotePolicy`
- long doctrine blocks
- repeated examples in every runtime prompt

If a line is useful only because the model "might forget what anime is", it probably belongs in Codex's interpretation of the project mode or in a small image style note, not in an always-on preset block.

## Agentic Path Vs Legacy Web Path

Agentic path:

1. Artist says intent in chat.
2. Codex reads graph state.
3. Codex decides next action.
4. Codex rewrites the relevant project object or call spec in concrete production language.
5. Mirage validates and persists the graph/spec, or runs the paid worker from that saved spec.

Legacy web path:

1. Artist presses a button.
2. Backend may still need to send a small user note and minimal taste anchor because no agent translated intent.

Do not design the agentic path around limitations of the legacy web-button path. Keep the legacy path working, but do not let it force composer bloat forever.

## Agent-Native Correction: Intent Is Not A Prompt Slot

Raw artist language is not the unit Mirage should pass through agent MCP actions.

When the artist says "make this brighter" or "less grungy," Codex should not forward that sentence as `userNote` and ask a backend composer to interpret it. Codex is the interpreter. It should inspect the current graph/prompt/asset, decide what needs to change, and turn the request into one of three concrete operations:

1. **Spec edit:** update the saved graph object or saved prompt text. Example: edit `storyboard_prompt` from "dim, grimy bunker" to "clean bright overhead light, pale gray walls, crisp flat shadows," then apply that exact saved prompt.
2. **Worker generation from saved spec:** run an image/video/audio worker from the current saved graph/spec, with optional `contextOverrides` or a precise `promptOverride` written by Codex.
3. **Media edit:** send the existing image/video plus a narrow edit instruction: "Keep composition, characters, and panel layout identical; brighten the lighting and clean up the dirty texture." This is not a full regenerate from the original prompt.

`userNote` is therefore a legacy/web-direct concept, not the happy path for agent sessions. It exists for places where the artist clicks a web refine button and no harness has translated intent. In agent sessions, raw chat becomes a deliberate edit to project data, a direct worker instruction, or a saved project override.

This also fixes the refine split:

- **Prompt/spec refine:** Codex edits text or structured JSON and applies it. It should prefer local notebook/draft edits when available because small inline edits are safer than rewriting a whole prompt from memory.
- **Image/video refine:** Codex uses an edit action against the existing media with a concise positive instruction. It should not resend the whole original generation prompt unless the edit model explicitly requires background context.

The composer is still useful, but only as plumbing for worker calls. It assembles selected graph data, selected references, project overrides, call overrides, and output contracts. It is not the creative director.

## Migration Plan

### 1. Establish the new contract in code

Add a shared `ContextOverride` type and support it in action specs for looks, style, storyboard, video, audio, and script actions where relevant.

Add trace/X-Ray output that shows:

- included graph fields
- excluded graph fields
- attached refs/assets
- promptOverride used or not
- projectOverride used or not

This makes the composer debuggable as plumbing.

### 1b. Split raw notes from agent instructions

Rename the concepts in action specs and docs:

- `userNote`: legacy web-direct raw artist text. Allowed only on backend LLM helper/refine routes where no harness has interpreted intent.
- `callInstruction`: precise one-off instruction written by Codex for a worker call.
- `editInstruction`: precise instruction for media edit/refine actions.
- `promptOverride`: exact final worker prompt, authored by Codex or a saved project override.

Storyboard should be the first migration target because it has all three cases: saved prompt edits, storyboard image generation, and storyboard image refine.

### 2. Fix project overrides

Either wire every declared override kind or delete unsupported kinds. Preferred: wire them.

Add a real `PROJECT OVERRIDE` section in the composer instead of ad-hoc injection in storyboard/video only.

### 3. Cut `writeShotPrompts`

Use the tactical audit. It is the worst offender and should be the first prompt trim.

Target: less doctrine, more shot data. Keep one useful example if needed; delete the rest from runtime.

### 4. Remove workflow/preset doctrine from text prompts

Start with text-model prompts where Codex or project data should carry taste:

- concept
- script/parse/refine
- shot prompts
- audio plan
- style brainstorm

Keep only action contracts and selected graph context.

### 5. Move worker-model invariants to actions

For image/video/audio workers, keep short hard constraints at the action level:

- reusable character ref
- no text/watermark/collage
- storyboard board constraints
- video continuity/ref preservation
- TTS output requirements

These are not workflows. They are the worker contract.

### 6. Add project style-note buckets

Add the small per-surface note layer as project data. Keep it deliberately humble: named strings first, not a giant nested bible schema.

Codex can update these notes when production discovers language that works. Example: after several good boards, Codex might write a storyboard note like "Use flat 2x3 deadpan panel boards with minimal camera drama and clean graphic blocking."

These notes should be visible/editable in the notebook/config layer and eventually in the Web Studio. They should also be selectable per action via context overrides.

### 7. Shrink presets

Reduce presets/workflows to:

- intake suggestions
- default model/provider preferences
- optional starter style description / starter style-note buckets

No recurring runtime doctrine by default.

### 8. Harvest reusable presets later

Do not build the full production-bible system before a project earns it.

Add a later explicit action such as `codify_project_as_preset(name, sections?)` that snapshots selected project style notes plus useful project overrides into a reusable preset. This should be artist-confirmed, reversible, and framed around real production moments: sequel, series, client template, or "make more like this."

### 9. Update skills and AGENTS/CLAUDE

Teach agents:

- Mirage is graph-first.
- Workflow/preset names are hints, not truth.
- Raw artist chat is not an MCP `userNote`; translate it into exact graph/spec edits, call instructions, edit instructions, context overrides, or prompt overrides.
- For prompt/spec refine, edit the local draft or exact saved text first, then apply. Do not ask a backend refine prompt to guess the diff when Codex can make the edit.
- For media refine, send the existing asset plus a narrow positive edit instruction. Do not regenerate from the whole original prompt unless that is intentionally the chosen strategy.
- Use `contextOverrides` before fighting the prompt template.
- Use selected project style notes instead of dumping a whole preset/bible into every call.
- Update project style notes when a phrase or technique keeps improving outputs.
- Use `promptOverride` for final concrete worker prompts.
- Promote repeated successful call overrides to project overrides or project style notes.
- Suggest harvesting a reusable preset only after a project/episode has actually worked.
- Backfill style/character/env descriptions when artists upload images as-is.

## What This Lets Us Build

The artist can say:

"I want to make an anime about a 12-year-old boy's AI companion becoming conscious."

Codex can:

1. create/save concept
2. normalize or write script
3. ask for or generate style
4. backfill style description from uploaded images
5. generate characters/envs
6. create shot prompts/storyboards/videos
7. render

No preset doctrine required. If the artist says anime, that becomes project data. If later they say "actually make it like a sterile corporate training video," the graph changes and future actions follow the graph.

The artist can also say:

"Here is a song, but don't analyze it; just use it as background audio."

The graph can represent that too. Audio exists; analysis is optional; render can still use the soundtrack.

## Open Calls

Settled by D27/D28:

1. `workflow_key` can remain for UI filtering/back-compat, but it must not drive recurring prompt doctrine.
2. Legacy web buttons may keep minimal raw-note helper prompts until the UI becomes agent-backed; those paths should be labeled legacy/web-direct.
3. Project overrides remain freeform by action surface for now.
4. The Prompt Library should primarily show graph/action contracts. Composer internals are debug/X-Ray surface.

Still open before implementation:

1. Exact storage shape for project style notes: columns vs JSON config vs existing project config/preferences layer.
2. Exact `contextOverrides.styleNoteSections` syntax and which actions support it first.
3. Whether `modelPhrases` belongs in v1 style notes or waits until the first real model-specific phrase proves it is needed.
4. Harvest action timing and surface: likely later, after the first successful project/episode proves the shape.

## Summary

Mirage should not be "workflow prompt plus tools." It should be a graph of production objects with an agent/UI that knows how to move the graph forward.

The composer is not the director. It is editable plumbing.

Taste belongs in project data, references, skills, Codex's reasoning, and eventually harvested project style notes. Presets are intake hints and defaults until a good project earns a reusable production bible. Worker actions keep only the small hard contracts needed to make media generation behave.
