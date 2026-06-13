> Archived 2026-06-13. Wave 2 draft material has either landed or been superseded by current composer/recipe doctrine in `docs/mirage-platform-v1-ledger.md`, `docs/mirage-tool-reference.md`, and `docs/mirage-workflow-recipes.md`.

# Wave 2 — T9.3 + T9.4 prompt-composer drafts

**Status:** Drafts ready for review. Composer signature with `userNotePolicy` slot is live (D25 + commit `654f8e0`). T9.2 reference template is `server/prompts/styleBrainstorm.ts`.

**Scope:**
- **T9.3** = `visualize-style` (image-gen prompt) + `refine-style-direction` (LLM text refine)
- **T9.4** = `generate-concept` + `refine-concept` (LLM text gen + refine)

**Doctrine reminder (D25 + userNotePolicy):**
- Constraint hierarchy: tool contract > medium guard (preset) > user note > range-inside-note
- Generate tools: `userNotePolicy` = hard constraint, all outputs satisfy it
- Refine tools: `userNotePolicy` = surgical application, preserve locked structure
- Tools that don't take a user note: skip the policy

**Preset field plan:** no new fields needed. Reuse existing `style.rules` (shared) and `concept.rules` (shared). Tool-specific behavior lives in the tool builder, not on the preset. We'll add tool-specific preset fields later if a real need emerges (per Codex's "decide what belongs in shared preset taste versus tool-specific taste" framing).

---

## T9.3a — `visualize-style` (image-gen prompt)

**File target:** `server/prompts/visualizeStyle.ts` (new). Replaces inline `buildStylePrompt` in `server/services/imagen.ts:188`.

**Why composer migration matters here despite no LLM call:** the existing `buildStylePrompt` hardcodes "It may be photographic, painterly, illustrated, miniature-inspired, or mixed-media." That's music-video-shaped — for anime projects it gives the image model permission to drift to photographic. Pushing the medium-guard into `presetTaste` via `style.rules` closes this leak.

### Shape

```ts
const CORE_TASK = `Generate one reusable visual style reference frame for this project. The frame should demonstrate the style system clearly — lighting behavior, color palette, texture or medium, rendering approach, atmosphere — using a motif, prop, environment detail, or production-design element that belongs to the project.

Keep the composition clean enough that the visual treatment is easy to read and reuse downstream. Do not produce a character portrait, storyboard frame, poster, collage, or narrative scene.`;

const OUTPUT_CONTRACT = `Output the final image. High production value. No text. No watermark. No captions.`;

// No userNotePolicy: the locked direction text IS the input; there's
// no separate user note in this flow.

export const buildVisualizeStylePrompt = (input: {
  styleDescription: string;     // locked direction text (the "subject" of this gen)
  subject: string;              // project subject from concept
  preset: PipelinePreset;
}): string => composePrompt({
  coreTask: CORE_TASK,
  workflowContext: workflowContextFor(input.preset),
  inputs: `Subject: ${input.preset.style.subjectPrompt(input.subject)}\n\nStyle direction to render:\n${input.styleDescription}`,
  presetTaste: [input.preset.style.rules, input.preset.looks.qualityRules].filter(Boolean).join('\n\n'),
  outputContract: OUTPUT_CONTRACT,
});
```

**What changes vs today:** medium-guard moves from a hardcoded "photographic, painterly..." list to `preset.style.rules` (anime preset bans photographic; music-video preset permits it). Quality rules already preset-keyed; just relocated to the `TASTE` block.

---

## T9.3b — `refine-style-direction` (LLM text refine)

**File target:** `server/prompts/refineStyle.ts` (new). Replaces `refineStyleDirection` body in `server/services/claude.ts:1070`.

### Shape

```ts
const CORE_TASK = `Revise the current style direction text using the director's feedback. Preserve the direction's core identity — this is a surgical refinement, not a replacement. Update only the aspects the feedback addresses.`;

const USER_NOTE_POLICY = `USER NOTE contains the director's feedback. Apply it surgically:
- Touch only the fields and qualities the note addresses.
- Preserve identity-defining elements not mentioned in the note.
- Do not propose a different direction. Do not regenerate from scratch.
- If the note conflicts with the medium guard in TASTE, refuse the conflicting part and translate it to the closest medium-safe analogue (e.g. "make it look like a Polaroid" on anime → printed-photo-inspired color/texture treatment, still a drawn anime frame).`;

const OUTPUT_CONTRACT = `Return the revised direction as JSON:
- title: short evocative label, 2-5 words (revise only if the feedback addresses the title or shifts the direction's identity)
- description: 2 compact sentences describing palette, line/medium treatment, rendering, lighting, texture, mood. Vivid and concrete; will be used as an image-generation prompt.

Hard rules:
- Description is style/treatment only. No character names, no scene beats, no plot.
- Stay inside the medium described in TASTE.`;

export const buildRefineStylePrompt = (input: {
  currentDirection: { title?: string; description: string };
  feedback: string;
  concept: any;
  preset: PipelinePreset;
}): string => composePrompt({
  coreTask: CORE_TASK,
  workflowContext: workflowContextFor(input.preset),
  inputs: [
    `Subject: ${conceptSubject(input.concept)}`,
    input.concept.mood ? `Mood: ${input.concept.mood}` : null,
    `\nCurrent direction:\n${input.currentDirection.title ? `Title: ${input.currentDirection.title}\n` : ''}${input.currentDirection.description}`,
  ].filter(Boolean).join('\n'),
  presetTaste: input.preset.style.rules,
  userNotePolicy: USER_NOTE_POLICY,
  outputContract: OUTPUT_CONTRACT,
  userNote: input.feedback,
});
```

**Why feedback as `userNote`:** in refine tools, the artist's correction IS the user note. Treating it via the `userNotePolicy` slot (surgical) makes the surgical-vs-hard-constraint pattern visible and consistent across all refine tools.

---

## T9.4a — `generate-concept` (LLM text gen)

**File target:** `server/prompts/concept.ts` (new). Replaces `generateConceptOptions` body in `server/services/claude.ts:70`. Note this is shared with `refine-concept` (T9.4b) in the same file.

**Special case:** today's `generateConceptOptions` has two completely different prompt bodies depending on whether `directorBrief` is set. The cleanest composer migration keeps one `coreTask` and varies the `outputContract` between "Return EXACTLY 1 concept that realizes the brief" vs "Return EXACTLY 3 distinct concepts." `directorBrief` goes in `inputs` either way.

### Shape

```ts
const CORE_TASK_BASE = `Propose creative narrative directions for this project. Each direction is one coherent idea — what the viewer follows, what visibly happens, the emotional arc, the world. The visual medium and style are decided in a separate phase; do not include camera, lens, palette, or art-style language. Focus on story, beats, and what visibly happens.`;

const USER_NOTE_POLICY = `If USER NOTE is present, treat it as a hard creative constraint inside the tool contract and TASTE rules. All returned directions must satisfy it.

If the note conflicts with the source material, preset rules, or tool contract (e.g. asks for visual style/palette/cinematography at this layer, or asks the concept to abandon the source's intent), refuse the conflicting part and translate the rest into the closest valid concept-layer intent. Concept stays story/brief-level — style and medium are decided in later phases.

Variety means distinct directions inside the noted constraint, not in spite of it. With no user note, propose maximally distinct directions inside TASTE.`;

const outputContractFor = (hasDirectorBrief: boolean): string => hasDirectorBrief
  ? `Return EXACTLY 1 concept in the concepts array — one that fleshes out the director's brief into a complete production-ready concept. Do not override the director's intent; expand it.

Each concept:
- title: 2-4 word creative title
- subject: the central subject (artist, character, premise, world, object)
- mood: one distinct emotional keyword
- theme: core narrative idea, 1 sentence
- conceptDirection: short creative label
- description: 2-3 sentences expanding the concept`
  : `Return EXACTLY 3 concepts in the concepts array — three genuinely different visual approaches, all respecting the source material.

Each concept:
- title: 2-4 word creative title
- subject: the central subject
- mood: one distinct emotional keyword (different per concept)
- theme: core narrative idea, 1 sentence
- conceptDirection: short creative label
- description: 2-3 sentences expanding the concept

Hard rules:
- Each concept must offer a meaningfully different visual approach.
- Do not let all three collapse into the same narrative shape.
- No art style, color palette, or cinematography language in any field.`;

export const buildGenerateConceptPrompt = (input: {
  title: string;
  language: string;
  sourceText?: string;     // lyrics OR script excerpt
  meaning?: string;
  musicalStructure?: any[];
  scriptSummary?: string;
  songType?: string;
  isNarrative?: boolean;
  isMeditative?: boolean;
  directorBrief?: string;  // if set, generate 1 concept; else 3
  userNote?: string;
  preset: PipelinePreset;
}): string => composePrompt({
  coreTask: CORE_TASK_BASE,
  workflowContext: workflowContextFor(input.preset),
  inputs: formatConceptInputs(input),  // formats title, language, source text, meaning, structure, songType signals, directorBrief
  presetTaste: input.preset.concept.rules,
  userNotePolicy: USER_NOTE_POLICY,
  outputContract: outputContractFor(!!input.directorBrief),
  userNote: input.userNote,
});
```

---

## T9.4b — `refine-concept` (LLM text refine)

**File target:** same `server/prompts/concept.ts`. Replaces `refineConceptDirection` body in `server/services/claude.ts:194`.

### Shape

```ts
const REFINE_CORE_TASK = `Revise the locked concept using the director's feedback. Preserve the core identity — this is a refinement, not a replacement. Update only the fields the feedback addresses.`;

const REFINE_USER_NOTE_POLICY = `USER NOTE contains the director's feedback. Apply it surgically:
- Touch only the fields the note addresses (mood, theme, subject, direction, description).
- Preserve all locked fields the note does not mention.
- Do not regenerate the concept from scratch.
- If the note conflicts with the source material, preset rules, or tool contract (e.g. asks for visual style/palette/cinematography at this layer), refuse the conflicting part and translate the rest into the closest valid concept-layer intent. Concept stays story/brief-level — style and medium are decided in later phases.`;

const REFINE_OUTPUT_CONTRACT = `Return the refined concept as JSON with all fields populated. Fields not addressed by the feedback should carry their current values forward unchanged.`;

export const buildRefineConceptPrompt = (input: {
  currentConcept: any;
  feedback: string;
  preset: PipelinePreset;
}): string => composePrompt({
  coreTask: REFINE_CORE_TASK,
  workflowContext: workflowContextFor(input.preset),
  inputs: formatLockedConceptInputs(input.currentConcept),
  presetTaste: input.preset.concept.rules,
  userNotePolicy: REFINE_USER_NOTE_POLICY,
  outputContract: REFINE_OUTPUT_CONTRACT,
  userNote: input.feedback,
});
```

---

## Shared helpers (factor into `server/prompts/_shared.ts` or duplicate per-file?)

Across T9.2, T9.3, T9.4, repeated helpers appear:

- `workflowContextFor(preset)` — currently duplicated in `styleBrainstorm.ts`; would duplicate in 4 more files
- `conceptSubject(concept)` — currently in `claude.ts`
- `clip(value, max)` — currently in `styleBrainstorm.ts`
- `formatConceptInputs(input)` / `formatLockedConceptInputs(input)` — would be new

**Recommendation:** extract `workflowContextFor`, `conceptSubject`, `clip` into `server/prompts/_shared.ts`. Tool-specific input formatters (`formatConceptInputs`, `formatProjectInputs`) stay co-located with each tool. Avoids 5x duplication while keeping tool builders readable.

---

## Sanity check against the proof gate criteria

For each tool, when proof-gated post-T9.3/T9.4:

- **(a) No music-led chrome leaks** ✅ shared coreTask, no music nouns
- **(b) Medium-guard holds** ✅ via `style.rules` / `concept.rules` per preset
- **(c) User-note hierarchy holds** ✅ generate-tools = hard constraint, refine-tools = surgical
- **(d) No enum labels in prompt body** ✅ workflowContext is human prose
- **(e) Layering clean** ✅ medium-guard lives in TASTE, not coreTask

---

## Open questions before implementation

1. **`server/prompts/_shared.ts` for workflowContextFor + helpers?** Recommend yes. Codex agrees → I extract during T9.3 implementation. Codex disagrees → duplicate per file (cheap, but DRY violation).

2. **Should `visualize-style` reuse `looks.qualityRules` in TASTE?** Today it's read from `preset.looks.qualityRules`. That field is conceptually "quality rules for character/env look images" but the content overlaps with style-image quality rules. v1: reuse it (one less new field); v1.5: split into `style.visualizeQualityRules` if the rules diverge.

3. **Caller site changes.** Each of these migrates `claude.ts` callers (`generateConceptOptions`, `refineConceptDirection`, `refineStyleDirection`) + `imagen.ts` caller (`buildStylePrompt`). Same shim pattern as Codex used for T9.2: keep the existing exported function signatures but delegate to the new composed builder. Lets existing call sites stay untouched in this slice.

4. **Test coverage:** these don't have existing unit tests. v1 verification = tsc + build + diff-check + render the composed prompts locally for both presets and spot-check the section ordering / taste injection. Live LLM proof = post-merge.
