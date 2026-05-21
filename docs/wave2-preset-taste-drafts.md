# Wave 2 — `presetTaste` drafts for T9.2 brainstorm-style

**Status:** Drafts, ready to apply. T9.12 composer extension landed in `ed9efd2`; T9.2 is unblocked.

**Doctrine reminder (D25 reframed):** medium-guard lives in `presetTaste`, NOT in `coreTask`. The shared `coreTask` is workflow-agnostic. The per-preset taste field carries medium + drift rules into the `TASTE` section of the composed prompt.

**Architectural correction (post Codex review):** `preset.style.rules` is **shared across multiple surfaces** — script parser (`server/services/claude.ts:413`), initial `style_description` on script intake (`server/routes/projects.ts:970`), brainstorm, visualize, refine. Dropping brainstorm-specific instructions like "return 4 distinct directions, cover a range" into `style.rules` contaminates the parser and style-description seed. **Fix:** split into two layers:

- `style.rules` keeps the **shared style language**: medium statement + drift bans. Consumed by every surface that needs to know what kind of visual world this is.
- `style.brainstormTaste?` (new optional field) carries **brainstorm-only** rules: aesthetic range coverage + distinctness. Consumed only by the brainstorm tool builder.

---

## Schema change

Extend `PipelinePreset.style` in `server/presets.ts`:

```ts
style: {
  dpIdentity: string;
  rules: string;                // shared style language (medium + drift bans)
  brainstormTaste?: string;     // brainstorm-tool-only: range coverage + distinctness
  subjectPrompt: (subject: string) => string;
  presetBible?: string;
};
```

Other tools (visualize, refine, parser, looks) continue reading `style.rules`. They never read `style.brainstormTaste`. If a future tool needs its own taste slice, add a similarly-named optional field — generalize the shape only when a second tool needs it.

---

## `anime_default.style.rules` — proposed (shared)

Replaces existing field. Used by brainstorm, visualize, refine, script parser, initial style_description.

```
Medium is anime: hand-illustrated frames, drawn linework, painted or
flat-color rendering, animated camera and staging. The output reads
as a drawn/animated frame, not as a photographed or photoreal object
pretending to be one.

Do not let directions, descriptions, or generated frames drift into
live-action photography, documentary stills, Polaroid or film-stock
realism as the apparent medium. Technical ingredients like cel-shaded
CG, 3D-assisted backgrounds, painted photoreal-leaning environments,
and digital compositing are all legitimate inside anime production —
what matters is that the final image reads as anime, not as a
photographed scene with anime styling slapped on top.
```

**Why this shape:**
- Establishes the medium (anime, drawn/animated frame)
- Bans the **failure mode** ("reads as photograph"), not technical ingredients
- Explicitly OKs cel-shaded CG / 3D-assisted backgrounds / photoreal-leaning painted backgrounds — all legitimate anime production
- Works as the shared baseline for all visual tools, not just brainstorm

---

## `anime_default.style.brainstormTaste` — proposed (new field)

Brainstorm-only. Appended into the `TASTE` section when the brainstorm tool runs.

```
Cover a real range across legitimate anime aesthetics. Each of the
four directions should sit in a clearly different corner of the
anime production space: modern flat-color digital, retro cel-painted
television, soft watercolor or pastel illustration, harsh
high-contrast graphic, photoreal-leaning painted backgrounds with
anime characters, ink-and-wash or sketch-forward, stylized
limited-animation looks. These are starting points, not a fixed
menu — pick four that actually contrast with each other given this
project.

Each direction must be distinct from the others in palette, line
treatment, rendering, and overall mood. Avoid restating the same
look with different adjectives.
```

**Why this shape:**
- Range coverage explicit so brainstorm doesn't taste-lock to OVA/cel/vintage
- "Starting points, not a fixed menu" — the LLM picks four that contrast for THIS project, not the four named
- Distinctness rule prevents 4 directions that are 4 adjectives on the same thing
- No enum labels, no other-workflow nouns

---

## `music_video_default.style.rules` — proposed (shared)

```
Music video has no fixed medium. Animation, live-action, mixed media,
motion graphics, photography, performance capture, projection, lo-fi
formats — any visual production can be the medium. The medium choice
is part of the treatment, not a constraint to work around.

Should feel like an intentional music-video production, not generic
stock fantasy, AI-renderscape filler, or default-grade visual mood
collage. Specificity beats genre cliché.
```

**Why this shape:**
- Medium-permissive (the music_led counterpart to anime's medium-guard)
- Anti-slop guard — preserved from existing rules
- No anime nouns ("character-model consistency", "key poses", "anime production language")
- No brainstorm-specific instruction ("return 4 directions") — that's now in `brainstormTaste`

---

## `music_video_default.style.brainstormTaste` — proposed (new field)

```
Cover a real range across mediums and aesthetics. Vary the medium
(animation, live-action, mixed, abstract, motion graphics,
photography-leaning, etc.), the lighting language, the texture, the
era reference, the camera grammar, and the production design across
the four directions. Each direction should sit in a clearly different
production space.

Each must be distinct from the others. Avoid restating the same
treatment with different adjectives.
```

---

## How T9.2 builds the prompt

```ts
// server/prompts/styleBrainstorm.ts

const WORKFLOW_CONTEXTS: Record<WorkflowKey, string> = {
  music_led:
    "This is a music-led project. The directions will become the visual " +
    "world the music video sits inside.",
  scripted_narrative:
    "This is a scripted narrative project. The directions will become the " +
    "visual world the episode or film sits inside.",
};

const composedPresetTaste = (preset: PipelinePreset): string =>
  [preset.style.rules, preset.style.brainstormTaste].filter(Boolean).join('\n\n');

export const buildStyleBrainstormPrompt = (
  project: ApiProject,
  preset: PipelinePreset,
  userNote?: string,
): string => composePrompt({
  coreTask:
    "Propose 4 distinct visual style directions for this project. " +
    "Each direction is one coherent visual world the project could " +
    "live inside. Do not write story, scenes, or characters.",
  workflowContext: WORKFLOW_CONTEXTS[preset.workflowKey],
  inputs: formatProjectInputs(project),
  presetTaste: composedPresetTaste(preset),
  outputContract:
    "Return exactly 4 directions as JSON. Each direction:\n" +
    "- title: short evocative name (2-5 words)\n" +
    "- description: 2 sentences describing palette, line/medium treatment, " +
    "rendering, lighting, and overall mood.\n\n" +
    "Hard rules:\n" +
    "- No character names. No scene beats. No plot.\n" +
    "- Do not number directions with story arcs.\n" +
    "- Each direction independent.",
  userNote,
});
```

`coreTask` and `outputContract` are shared across workflows. `workflowContext` is a per-workflow string. `presetTaste` is `style.rules` (shared) + `style.brainstormTaste` (brainstorm-only) concatenated — the brainstorm tool is the only place those two layers compose.

---

## Sanity check against the proof gate criteria

- **(a) No music-led chrome leaks into a scripted_narrative + anime_default run:** anime preset has no music nouns ✓
- **(b) No taste-lock to a specific anime era:** brainstormTaste explicitly frames the 7 listed aesthetics as "starting points, not a fixed menu" — and the rules layer no longer bans technical ingredients that would have over-constrained ✓
- **(c) Directions vary across modern/retro/minimal/maximal/painterly/graphic possibilities inside anime production:** brainstormTaste names this range explicitly ⏳ (verify on live run)
- **(d) MCP packet `availableTools`+`blockedTools` correct:** unchanged by these drafts ✓
- **(e) No workflow/preset enum strings in prompt body:** both drafts use only production language ✓
- **(f) Shared coreTask + workflowContext + presetTaste layering holds:** coreTask is workflow-agnostic; medium-guard lives in `style.rules` (shared); brainstorm-specific range/distinctness lives in `style.brainstormTaste`. Layering is clean ✓
- **(g) No contamination of other surfaces:** script parser at `claude.ts:413` and initial `style_description` at `projects.ts:970` continue reading `style.rules` only; new field is brainstorm-tool-only ✓

---

## Open questions

1. **Other tools that need their own taste slice later?** Visualize-style will likely want a different taste shape (image-generation prompt rules vs. text-direction rules). Defer to T9.3 — add `style.visualizeTaste?` then if needed, or refactor `style` into `toolTaste: { brainstorm?, visualize?, ... }` if a third tool also needs one. Don't pre-generalize.

2. **`style.presetBible`** — currently used as a higher-priority fallback over `style.rules` in `projects.ts:970` and `claude.ts:413`. For anime it carries a "Default anime look: clean 2D animation key art..." line that overlaps with the new `style.rules`. After T9.2, consider deleting `presetBible` and folding any unique content into `style.rules`. Out of scope for the brainstorm slice; flag for follow-up cleanup.
