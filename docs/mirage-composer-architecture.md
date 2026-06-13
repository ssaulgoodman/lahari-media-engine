# Mirage Composer Architecture

**Status:** Reference architecture. Use with `docs/mirage-composer-audit.md` for composer/prompt cleanup context.
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

Status legend: **✅ shipped** / **🟡 partial** / **🔵 deferred (intentional)**

### 1. Establish the new contract in code — ✅ shipped

`ContextOverride` type lives in `server/services/contextOverrides.ts` and ships with looks, style, storyboard, video, audio, and script actions. X-Ray trace output records included/excluded graph fields, attached refs/assets, promptOverride and projectOverride usage, plus styleNoteSections include/exclude.

### 1b. Split raw notes from agent instructions — 🟡 partial

D27 locked the doctrine: agent path translates raw artist chat into spec edits, contextOverrides, promptOverride, callInstruction, editInstruction, or a project override. `userNote` no longer flows on the agent path. Field-level renames in action specs (`feedback` → `editInstruction` etc.) deferred to a follow-up; today the same field carries the Codex-translated instruction.

### 2. Fix project overrides — ✅ shipped

`PROJECT OVERRIDE` section is first-class in the composer (C5). All declared override kinds — `concept`, `script`, `shot_prompts`, `storyboard`, `video`, `character_looks`, `environment_looks`, `audio_plan` — wire through `getProjectPromptOverride()` and flow into the composer section uniformly. No ad-hoc per-builder injection.

### 3. Cut `writeShotPrompts` — ✅ shipped

C1 trimmed `writeShotPrompts` from ~7000 to ~3800 chars. Kept one GOOD/BAD per axis (visual + motion). Removed preset taste, USER_NOTE_POLICY local constant, workflowContext, OUTPUT-CONTRACT 6-item checklist. previousBatchTail capped to last 3 shots.

### 4. Remove workflow/preset doctrine from text prompts — ✅ shipped

C2 relocated preset taste out of text-gen prompts. Concept, script/parse/refine, shot prompts, audio plan, style brainstorm all run on action contracts + selected graph context. `workflowContext` removed from composer entirely. Text models receive no preset doctrine.

### 5. Move worker-model invariants to actions — 🟡 partial

Action invariants like "neutral pose," "no text/watermark," "single image" already live in per-action OUTPUT CONTRACT constants in `server/prompts/lookPrompts.ts`, `server/prompts/storyboard.ts`, etc. Some image-gen worker invariants still live in `preset.looks.qualityRules` / `preset.studio.storyboardRules` and need to be sorted into action handler constants. Tracked in audit backlog as "architecture step 5 reshape."

### 6. Add project style-note buckets — ✅ shipped

D28: `project_config.style_notes` (jsonb) carries per-surface buckets — `image`, `storyboard`, `motion`, `script`, `dialogue`, `audio`, plus `modelPhrases[modelKey]`. `apply_project_style_notes` action persists them. Composer reads selected buckets per action via `STYLE NOTES` section. Selectable per call via `contextOverrides.styleNoteSections.{include,exclude}`. Currently consumed at runtime: `image`, `storyboard`. Other buckets accepted but not yet read (forward-compat).

### 7. Shrink presets — 🟡 partial

Presets no longer ship runtime doctrine to text prompts. Image-gen workers still pull `preset.looks.qualityRules` / `preset.style.rules` etc. Final shrink waits on step 5 cleanup. The current state preserves backward compat for image rendering while text path is fully cleaned.

### 8. Harvest reusable presets later — 🔵 deferred (intentional)

`codify_project_as_preset(name, sections?)` not built. Intentional: per the harvest doctrine, we wait until a real "I shipped a great anime, now make episode 2" moment proves the shape. Today: project style notes accumulate per project; no cross-project codification action exists.

Reusable skills belong in the same harvest family. If an artist or agent rewrites `storyboard-prompt-craft`, develops a stronger script voice, or finds a reliable render-triage rubric for a series, that should not require copying files between project notebooks or editing global Codex state by hand.

Target product object: a **production bundle**. It is a user/team/project-scoped package of selected project style notes, prompt overrides, reusable skills, examples/model phrases, and optionally reusable refs/assets. A new project can apply the bundle at intake or after Codex suggests it. The bundle seeds project-local files and config, but the project copy stays editable and can diverge.

The plugin boundary stays clean: a Mirage Codex plugin ships stable generic operating skills and connection glue; production bundles are Mirage server/workbench data selected per project. The plugin is not runtime truth, and user taste does not become hidden global doctrine.

### 9. Update skills and AGENTS/CLAUDE — ✅ shipped

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

Settled (D27/D28 + Tier 1-3 implementation):

1. `workflow_key` remains for UI filtering / backward compat but does not drive recurring prompt doctrine.
2. Legacy web buttons keep minimal raw-note helper prompts until the UI becomes agent-backed; those paths are labeled `[web-direct]` in the catalog.
3. Project overrides remain freeform by action surface.
4. The Prompt Library shows graph/action contracts; composer internals are debug/X-Ray surface.
5. **Project style-note storage:** JSONB column on `project_config.style_notes` (D28 implementation slice).
6. **`contextOverrides.styleNoteSections` syntax:** `{ include?: SectionKey[], exclude?: SectionKey[] }`. Default sections per action (e.g. looks defaults to `['image']`; storyboard to `['image', 'storyboard']`).
7. **`modelPhrases`:** in v1 style notes, keyed by model name. Used today by image/storyboard render paths.

Still open:

1. Harvest action timing and surface — likely later, after the first successful project/episode proves the shape.
2. Architecture step 5 finish: image-gen worker invariants currently in `preset.looks.qualityRules` / `preset.studio.storyboardRules` need to be sorted into per-action handler constants; preset surface shrinks correspondingly.
3. Field rename across action specs (`userNote` → `editInstruction` / `callInstruction` where the path is agent-only). Doctrine is locked; field-level rename is a follow-up slice.

## Summary

Mirage should not be "workflow prompt plus tools." It should be a graph of production objects with an agent/UI that knows how to move the graph forward.

The composer is not the director. It is editable plumbing.

Taste belongs in project data, references, skills, Codex's reasoning, and eventually harvested project style notes. Presets are intake hints and defaults until a good project earns a reusable production bible. Worker actions keep only the small hard contracts needed to make media generation behave.
