> **Archived.** Historical audit that informed R29 implementation — see ledger R29. Preserved for reference. 
# R29 Prompt Override Audit

Status: input for R29 phase 2+ scope
Date: 2026-05-13
Audited file: `server/prompts/catalog.ts` (26 prompts, 1014 lines)

## Purpose

R29 phase 1 makes `storyboard` and `video` prompt recipes overridable per project. This audit identifies which of the remaining 24 prompts are candidates for override-eligibility in phase 2 and beyond, classified by leverage. Output is a prioritized list Codex can use to design phase 2 scope without re-deriving the analysis.

## Methodology

Each prompt classified into one of four buckets:

- **Bucket A — Engine-only.** Deterministic, system-level, or low per-project variance. Stays in `server/prompts/catalog.ts`. No override path.
- **Bucket B — Project recipe candidate.** Taste-heavy and per-project benefit. Override-eligible. Sized by leverage (Tier 1 / 2 / 3).
- **Bucket C — Per-shot content, not recipe.** Belongs in R28 (apply-only content) territory, not R29 (recipe overrides). The Codex-native answer is "Codex writes the content; apply tool validates and persists," not "Codex tunes a per-project template."
- **Bucket D — Skill, not prompt.** The prompt is a critique/analysis function that should become skill content, not a stored prompt. Cross-references R7.

## Full Audit

| # | Prompt | Stage | Bucket | Rationale |
|---|---|---|---|---|
| 1 | Transcribe lyrics | audio | A | Deterministic audio→text. No per-project taste. |
| 2 | Detect musical structure + classify song | audio | A | Deterministic. No taste. |
| 3 | Summarize meaning | audio | A | Mostly deterministic ("here are lyrics, summarize"). Low override value. |
| 4 | Generate concept directions | blueprint | **B Tier 1** | First creative decision. Per-project: an artist might want "always offer literal / abstract / mythological" for one project and "always offer traditional / modern / experimental" for another. Largest first-move taste lever. |
| 5 | Plan script (cast, environments, scenes, shots) | blueprint | **B Tier 1** | Biggest single quality lever for the project. Where scene-count rules, shot-pacing, anti-patterns, and song-type calibration live. Per-project preferences (e.g., "always restrained for meditative work," "always 8s shots minimum") encode here. |
| 6 | Plan script (GPT-5.5 experiment) | blueprint | **B Tier 1** | Same as #5 for the GPT provider lane. Override should propagate to whichever provider is active. |
| 7 | Brainstorm style directions | blueprint | **B Tier 2** | Most projects use presets, but for projects that brainstorm, override value is real. Different rules for narrative vs meditative direction sets. |
| 8 | Refine style direction | blueprint | **B Tier 3 (bundle)** | Bundle with #7. Small surface; same scope, refining same recipe. |
| 9 | Character look | blueprint | **B Tier 4** | Per-project moderate value: when a song has specific character vocab (era, costume conventions). Could also become a global preset family. |
| 10 | Environment look | blueprint | **B Tier 4** | Same as #9. |
| 11 | Write shot prompts (bulk) | studio | **B Tier 1** | Translates script beats to renderable per-shot prompts. Highest leverage in studio phase. Per-project preferences ("never use lens flares, never use slow-motion, always favor stillness") encode here. |
| 12 | Write Seedance storyboard prompt | studio | ✓ Phase 1 | Already in R29 phase 1 scope as `kind='storyboard'`. |
| 13 | Render Seedance storyboard image | studio | A | Image-gen prompt template (sent to image model). Less taste-laden; the recipe IS the per-panel-action contract from #12. Low override value. |
| 14 | Refine Seedance storyboard | studio | C / B Tier 3 | `replan` mode is taste (bundle with #12); `edit_image` mode is image gen (tool call, not recipe). The replan path's override is captured by the storyboard recipe override itself. |
| 15 | Shot start frame | studio | C | Per-shot template that composes image-gen prompt from `visual_prompt` + refs. Per-project value low; the per-shot `visual_prompt` (R28) is where Codex's taste should land. |
| 16 | Refine frame prompt (first/end/character/env) | studio | C | Per-shot refinement. Codex writes the refined frame prompt directly via R28; no per-project recipe needed. |
| 17 | Refine video/motion prompt | studio | C | Per-shot. Same as #16. |
| 18 | Refine locked concept | blueprint | **B Tier 3 (bundle)** | Bundle with #4. |
| 19 | Refine script (surgical edit) | blueprint | **B Tier 3 (bundle)** | Bundle with #5. |
| 20 | Chained-shot refresh (prev-frame grounded) | studio | C | Per-shot continuity refresh. Codex writes via R28. |
| 21 | Shot video prompt (keyframe mode) | studio | ✓ Phase 1 | Already in R29 phase 1 scope as `kind='video'`. |
| 22 | Seedance video from locked storyboard | studio | **B Tier 2** | Companion video prompt for storyboard mode. Should ALSO be in R29 phase 1 `kind='video'` if not already — confirm during implementation. |
| 23 | Critique shot image | studio | D | Should be a skill (see `render-triage` shard), not a stored prompt. R7 territory. |
| 24 | Describe frame (continuity) | studio | A | Internal utility: extracts a description from a frame for downstream continuity. Deterministic. |
| 25 | Analyze uploaded style image | blueprint | A | Internal utility: parses artist-uploaded style ref into a description. Low taste. |
| 26 | Chat with director | utility | A / D | Legacy chat fallback. Probably moot in the MCP-first world; consider deprecating rather than overriding. |

## Phase 2 Recommended Scope

The phase 1 scope (storyboard + video recipes) ships first. Phase 2 should add the three Tier-1 leverage points:

**Phase 2:**
- `kind='concept'` — recipe for generating concept directions
- `kind='script'` — recipe for planning the script (cast, envs, scenes, shots)
- `kind='shot_prompts'` — recipe for writing visual + motion prompts in bulk

Each Tier-3 bundle (refine_concept, refine_script, refine_style_direction) inherits from its Tier-1/2 sibling — they're the surgical-edit twin of the writer. Implementation: one override row per kind covers both; the refine path reads the same body.

**Phase 3 (lower priority):**
- `kind='style_brainstorm'` — for projects that brainstorm rather than pick a preset
- `kind='character_look'` — for projects with specific character vocab
- `kind='environment_look'` — same for environments

## What Stays Engine-Only

Bucket A prompts have low per-project value and should stay in `server/prompts/catalog.ts` indefinitely:

- Transcribe lyrics
- Detect musical structure + classify song
- Summarize meaning
- Render Seedance storyboard image (template that wraps the storyboard recipe)
- Describe frame (continuity)
- Analyze uploaded style image
- Chat with director (or deprecate)

Reasoning: these are infrastructure-shaped. Per-project tuning would create noise without quality gain. The engine team owns them; project agents don't need access.

## Why Bucket C Doesn't Get Override Treatment

Per-shot operations (shot start frame, refine frame prompt, refine video prompt, chained-shot refresh) are not "recipes" — they're per-shot content events. The Codex-native answer per doctrine §4 is:

1. R28 ships `apply_shot_prompts(shots: [{shotId, visualPrompt, motionPrompt}])`.
2. Codex writes the new content directly using `storyboard-prompt-craft` / `continuity-auditor` skills.
3. Apply tool validates schema, persists, records director event.
4. No "tune the recipe per project" step needed — the skill itself IS the tunable recipe (and skills are tier 1+2 of the agency model — Codex can refine the shard inline, the artist sees the change).

Treating these as R29 recipes would force a per-project storage layer for things that change per-shot. Wrong abstraction.

## Bucket D — Critique Prompt Should Become Skill

`Critique shot image` is currently a stored prompt that calls an LLM to evaluate an image. Per R7, this belongs as a skill (the `render-triage` shard now exists and covers this judgment). The catalog entry should either:

- Be removed entirely (taste lives in `render-triage`); OR
- Stay as a deterministic *fact-gathering* tool (e.g., "extract prompt length stats, color histograms, ref similarity scores") and the actual critique moves to the skill.

Either way, this isn't an R29 candidate.

## Cross-Cutting Concerns

**Inheritance precedence (already in R29 design):** shot → scene → project → global. The audit's Tier-1 prompts (concept, script, shot prompts) are project-scoped only — there's no meaningful scene or shot override for them. Tier-2 (style brainstorm) is also project-scoped. The shot/scene scope columns exist on the table for future flexibility but aren't exercised by these prompt kinds.

**Body cap (already in R29 design):** 12k chars per override body. Plan-script and write-shot-prompts templates are the biggest in the catalog and currently sit around 4-6k chars. Cap is comfortable.

**Refine prompts shouldn't multiply the surface.** R29 phase 2 should design refine bundles such that one override row per logical kind covers both write and refine — not separate `concept_write` and `concept_refine` rows.

## Open Questions

1. **Should Bucket A prompts ever surface to Codex as read-only references?** If Codex is debugging a project quality issue and wants to see the global storyboard recipe, today it has to read `server/prompts/catalog.ts` directly (tier 3). Could surface read-only via an MCP tool like `get_global_prompt(kind)`. Minor convenience, not blocking.

2. **Should refine-mode bundles use the same override row, or have a separate `mode` column?** Recommendation: same row, body includes both write and refine guidance (write recipe + "when refining, apply these rules:"). Saves a column and matches how the existing catalog handles writer + refine together.

3. **Should the per-shot Bucket C prompts get their skill rubric formalized?** `shot-prompt-craft` shard doesn't exist yet (storyboard-prompt-craft does). Worth considering for the R28 prep work.

## Recommendation Summary

Codex implements R29 phase 1 (storyboard + video) as currently designed. Phase 2 (Tier-1: concept + script + shot prompts) becomes the natural next addition once phase 1 ships and is validated. Tier-2 and Tier-3 follow as discovered need accumulates. Bucket A stays engine-only; Bucket C routes through R28; Bucket D moves into skills.

The audit doesn't change phase 1 scope. It frames what comes next.
