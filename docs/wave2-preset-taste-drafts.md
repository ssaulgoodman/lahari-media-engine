# Wave 2 — `presetTaste` drafts for T9.2 brainstorm-style

**Status:** Drafts. Not committed to `server/presets.ts` yet. To be applied when T9.12 (composer signature extension) lands and T9.2 (brainstorm-style migration) begins.

**Doctrine reminder (D25 reframed):** medium-guard lives in `presetTaste`, NOT in `coreTask`. The shared `coreTask` is workflow-agnostic ("Propose 4 distinct visual style directions, no story/scenes/characters, cover a real range"). The per-preset `style.rules` field carries medium + taste rules that injected into the `TASTE` section of the composed prompt.

These drafts target the `style.rules` field on `PipelinePreset` in `server/presets.ts:PIPELINE_PRESETS`. They replace what's currently there for the brainstorm-style use case; we will also extend `style.rules` if other tools (`visualize-style`, `refine-style-direction`) need richer guidance.

---

## `anime_default.style.rules` — proposed

```
Medium is anime: hand-illustrated frames, drawn linework, painted or
flat-color rendering, animated camera and staging. Stay inside anime
production.

Range of legitimate anime aesthetics that should remain available:
modern flat-color digital production, retro cel-painted television,
soft watercolor or pastel illustration, harsh high-contrast graphic
styles, photoreal-leaning anime backgrounds, ink-and-wash or sketch-
forward work, stylized limited-animation looks. Do not collapse to
a single era or treatment when proposing directions.

Avoid drifting into: live-action photography, documentary stills,
Polaroid or film-stock realism, 3D CGI renders, motion-capture
realism, photoreal pastiches. If a reference would naturally read as
a photographed object rather than a drawn frame, it does not belong
in an anime direction.

Each direction must be distinct from the others in palette, line
treatment, rendering, and overall mood. Avoid restating the same
look with different adjectives.
```

**Why this shape:**
- Medium-guard explicit (anime, hand-illustrated, drawn frames)
- Range coverage explicit so brainstorm won't taste-lock to OVA/cel/vintage
- Negative space named (the Polaroid/photoreal drift modes)
- Distinctness rule prevents 4 directions that are 4 adjectives on the same thing
- No enum labels ("anime_default", "scripted_narrative")
- No workflow nouns from other workflows ("song", "lyrics", "musical structure")

---

## `music_video_default.style.rules` — proposed

```
Music video has no fixed medium. Animation, live-action, mixed media,
abstract, motion graphics, documentary, photography, performance
capture — all fit. Lean into the medium that suits the song's energy
and the artist's intent.

Each direction is one coherent visual world the video could live
inside: its rendering medium, palette, lighting language, and overall
mood. Cover a real range across media and aesthetics. Do not collapse
to a single look type when proposing directions.

Vary medium, lighting, texture, era, camera grammar, and production
design across directions. Each must be distinct from the others.
Avoid restating the same treatment with different adjectives.

Should feel like an intentional music-video treatment, not generic
stock fantasy or AI-renderscape filler.
```

**Why this shape:**
- Medium-permissive (the music_led counterpart to anime's medium-guard)
- Explicit range coverage so brainstorm doesn't collapse to "all live-action" or "all animated"
- Distinctness rule
- Anti-slop guard ("generic stock fantasy", "AI-renderscape filler") — preserved from existing rules
- No anime nouns ("character-model consistency", "key poses", "anime production language")
- No enum labels

---

## How these get used in T9.2

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

export const buildStyleBrainstormPrompt = (
  project: ApiProject,
  preset: PipelinePreset,
  userNote?: string,
): string => composePrompt({
  coreTask:
    "Propose 4 distinct visual style directions for this project. " +
    "Each direction is one coherent visual world the project could " +
    "live inside. Do not write story, scenes, or characters. " +
    "Cover a real range across legitimate aesthetics for this medium.",
  workflowContext: WORKFLOW_CONTEXTS[preset.workflowKey],
  inputs: formatProjectInputs(project),
  presetTaste: preset.style.rules,
  outputContract:
    "Return exactly 4 directions as JSON. Each direction:\n" +
    "- title: short evocative name (2-5 words)\n" +
    "- description: 2 sentences describing palette, line/medium treatment, " +
    "rendering, lighting, and overall mood.\n\n" +
    "Hard rules:\n" +
    "- No character names. No scene beats. No plot.\n" +
    "- Do not number directions with story arcs.\n" +
    "- Each direction independent; do not restate one with different adjectives.",
  userNote,
});
```

The `coreTask` and `outputContract` are shared (one body, all workflows). `workflowContext` is a per-workflow string (literal short prose, not an enum). `presetTaste` is whatever the project's preset has in `style.rules` — that's where medium-guard lives.

---

## Sanity check against the proof gate criteria

Validation criteria from ledger §6 W2 proof gate:

- **(a) No music-led chrome leaks into a scripted_narrative + anime_default run:** anime preset has no "song", "lyrics", "musical" nouns ✓
- **(b) No taste-lock to a specific anime era:** anime preset explicitly lists 7 different aesthetic ranges that must remain available; no canonical "this is the right anime" anchor ✓
- **(c) Directions vary across modern/retro/minimal/maximal/painterly/graphic:** anime preset explicitly names the range; will need to verify LLM honors this on live run ⏳
- **(d) MCP packet `availableTools`+`blockedTools` correct:** unchanged by these drafts (registry side; covered by T8) ✓
- **(e) No workflow/preset enum strings in prompt body:** both drafts use only production language ✓
- **(f) Shared coreTask + workflowContext + presetTaste layering holds (no medium-guard in coreTask):** coreTask says "cover a real range across legitimate aesthetics for this medium" — references "this medium" abstractly, with the medium itself defined by presetTaste. Layering holds ✓

---

## Open questions

1. **Should `anime_default.style.rules` also cover non-brainstorm tools** (visualize-style, refine-style-direction, looks generation, shot prompts)? The current rules in presets.ts have separate fields for each (`style.rules`, `looks.qualityRules`, `studio.shotPromptRules`). For now, replace only `style.rules` for the brainstorm migration; other tools' rules stay as-is until their own T9.x migration.

2. **Does music_video_default need a second medium-flag for "vary medium" vs "lean into one"?** Some artists want eclectic directions, others want a focused medium. v1 default is "vary medium" per the existing rules. Defer richer toggling to v1.5.

3. **What about workflowContext for deferred archetypes (campaign, short_form)?** Add the strings when the workflow lands; they don't need to be defined now.
