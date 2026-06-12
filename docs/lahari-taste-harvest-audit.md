# Lahari → Mirage Taste Harvest Audit

**Date:** 2026-06-10
**Author:** Fable (agent-assisted sweep over `lahari-local/main` content vs current `mirage` tree)
**Purpose:** `lahari-divergence-audit.md` covered *code commits*. This covers *taste content* —
skills, prompt bodies, presets — answering: how different is Lahari's accumulated production
knowledge, and how much is worth harvesting when Lahari converges in as the first tenant (C4)?
This is the content backlog for the C4 taste port.

**Headline:** Mirage's genericization (composer, registry, node skills) was correct architecture,
but it stripped ~95% of the devotional taste content out of the text-prompt layer and 100% of the
curated style presets. Roughly **70% of Lahari's earned knowledge is preservable** — most of it
as preset/recipe/skill *data* on rails Mirage already has. The single biggest finding: several
load-bearing taste rules live in Lahari's *code*, not its docs (e.g. the props-in-hand ban inside
`buildCharacterPrompt()`), and were invisible to every doc-level audit until now.

## How different, per surface

| Surface | Lahari (`lahari-local/main`) | Mirage (current) | Divergence |
|---|---|---|---|
| Skills | 6 ops/cost-aware skills (continuity-auditor, render-triage, script-doctor, storyboard-prompt-craft, style-ref-critic, lahari-director) | 8 generic node skills (concept/script/art/casting/sound/audio/storyboarding/video) | HIGH — Lahari teaches failure diagnosis + cost triage; Mirage teaches workflow + safe edits. Neither subsumes the other. |
| Prompts | ~200-line planScenes with song-type branching, meditative pacing math, devotional vocabulary | Composer sections + ~3 lines of generic preset rules | ~95% of devotional taste content absent from Mirage's text layer (deliberately) |
| Presets | 4 curated devotional style presets (`server/style-presets.ts`), preview images, proven over ~60 songs | 2 workflow presets + 1 workflow recipe (yapper); zero shipped style presets | Structural inversion: style-preset-driven → workflow-preset-driven |

## Harvest backlog (ranked)

### HIGH — port these as part of C4

1. **Song-type calibration** — `lahari-local/main:server/services/claude.ts` (generateConceptOptions, planScenes).
   Classification (stotra/chant/bhajan/kirtan/song) + `isNarrative`/`isMeditative` axes, wired into
   *pacing math*, not flavor: meditative material gets 8–10s holds, no over-cutting, fewer cast/envs,
   recurring motifs. This prevents Lahari's #1 historical failure mode (plot-heavy scripts on
   meditative songs). Mirage's `detect-structure` stripped song-type entirely. Restore as an optional
   post-transcription step + preset-gated script-layer branching (music_led uses it; anime ignores it).
2. **Meditative pacing rules / Seedance duration doctrine** — same file, planScenes prompt.
   "Aim ~15s when the phrase holds one idea; 8–12s for meditative holds; 4–8s only for connective
   beats; never above 15s; scene shot durations sum exactly to scene duration (validated)."
   Mirage currently defaults to 8s uniform — structurally over-cut for devotional work. Port as
   music_led preset default + exact-sum validation in the script layer.
3. **Four curated style presets** — `lahari-local/main:server/style-presets.ts`.
   `sacred-golden-serenity`, `pure-temple-morning`, `warm-incense-devotion`, `sacred-teal-riverlight`.
   Proven registers over 60 productions. Port as the Lahari-workspace style-preset registry (preset
   image is ground truth per existing doctrine). This is the speed win for tenant artists: lock one
   and move, no brainstorm needed.
4. **Props-in-hand anti-pattern** — `lahari-local/main:server/services/imagePrompts.ts`,
   `buildCharacterPrompt()`: "Do NOT include props, weapons, lamps, offerings, or ritual items in
   hand." Earned rule: deities holding objects read as actors, not presences — breaks darshan.
   Devotional-specific: belongs in the Lahari pack's look rules / casting guidance, NOT generic Mirage.
5. **Continuity-auditor skill** — `lahari-local/main:server/resources/skills/continuity-auditor/SKILL.md`.
   Four-layer model (identity/environment/style/temporal), chained-shot mechanics
   (`continuityFrom='prev_shot'` vs `'cut'` and what the model hallucinates when mismarked),
   cost-aware fix ladder. Mirage dropped it in the node-skill rebuild because "not a graph node" —
   correct for the skill taxonomy, but the *content* never got re-homed. Absorb into script-writer +
   storyboarding + video-director skills, or restore as an on-demand diagnostic worker skill.
6. **Chained-shot temporal mechanics** — same file, "Temporal Continuity" section. Mirage's
   script-writer mentions continuity-dependent neighbors but never teaches the failure mode.

### MEDIUM

7. **Render-triage content** — `lahari-local/main:server/resources/skills/render-triage/SKILL.md`.
   Four failure modes (prompt/model/reference/taste) + one-shot diagnosis tests + cost ladder.
   Was dropped with the node-skill rebuild; port as an on-demand worker skill (matches the audit
   backlog's "selective worker agents" item), with hardcoded dollar costs stripped.
8. **Storyboard prompt anti-patterns** — `lahari-local/main:server/resources/skills/storyboard-prompt-craft/SKILL.md`.
   Concrete ❌/✅ pairs (no film-tech jargon image models can't parse; "every panel a deity portrait"
   ban; specific-over-generic: "threshold of a stone shrine, oil lamps in clay holders" beats
   "glowing sanctum"). Mirage's storyboarding skill is template-forward and thinner — graft the
   anti-pattern section in (generic parts globally; devotional parts in the Lahari pack).

### LOW / adapt-only

9. **lahari-director operating rhythm** — structure only (attach → refresh → read events → propose);
   wording is stale against Mirage's cockpit. Mirage's AGENTS.md already covers most of it.
10. **style-ref-critic reusability tests** (strip-the-subject / imagine-13-shots / constrain-vs-define)
    — fold into art-director skill if not already covered.

## Not worth porting

- **Exact model routing** (Lahari's vendor pins) — Mirage's provider landscape moved on; port the
  strategy, not the picks.
- **Hardcoded "Indian devotional" literals in prompt builders** — become Lahari-pack preset/style-note
  fields, never global prompt text (enum-label ban + tenant cleanliness both apply).
- **`plan-scenes-openai` experiment** — already a cut candidate in the tool audit.
- **Lahari's extended-thinking call shape** — keep the *logic* (shot-count math + exact-sum check),
  re-implement on Mirage's current script-writer path.

## Placement map (where each harvest lands on Mirage rails)

| Harvest item | Mirage home |
|---|---|
| Song-type + pacing rules | music_led preset script layer + optional audio-analysis step |
| 4 style presets | Lahari workspace style-preset registry (C4; `server/style-presets.ts` pattern exists) |
| Props ban, devotional storyboard anti-patterns | Lahari pack style notes / pack-scoped skill content |
| Continuity + triage content | node skills (generic parts) + on-demand worker skill (diagnosis ladder) |
| Generic anti-patterns (film-jargon ban, specificity) | global storyboarding/video-director skills — safe for all tenants |

## Standing lesson

Taste was hiding in three places with different port costs: skill docs (cheap — copy/adapt),
preset data (cheap — it's data), and **prompt-builder code** (expensive to find, cheap to move once
found — this audit found it). When harvesting any future tenant's earned knowledge, grep the prompt
builders, not just the docs.
