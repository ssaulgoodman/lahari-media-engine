# Lahari → Mirage Taste Harvest Audit

**Status:** Active taste/preset harvest backlog. Use when turning Lahari-specific lessons into Mirage packs or recipes.

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

**Dispositions (Saul, 2026-06-12):** most of the harvest is NOT Lahari-attributed.
- The props-in-hand ban generalizes: it's a default rule for ALL character reference generation
  ("no held props unless explicitly asked"), home = global casting-director skill / style notes.
- Song-type calibration and hard pacing doctrine are **obsolete in the agent-driven machine** —
  the agent reasons pacing from audio analysis / theme / concept per project. Do not re-bake
  opinionated pacing into presets (that's the preset-blob pattern D28 killed). The machine's only
  job is to expose enough signal (structure, energy, section timing) for the agent to reason with.
- Style presets are a **general workspace primitive** for every workflow: artists curate their own
  preset sets and port them. Lahari's four are simply the first imported set when its artists move,
  not a Lahari-shaped feature.
The genuinely Lahari-specific residue is small: the four preset *contents*, devotional storyboard
anti-pattern examples, and devotional vocabulary — all of which land as workspace pack data.

## How different, per surface

| Surface | Lahari (`lahari-local/main`) | Mirage (current) | Divergence |
|---|---|---|---|
| Skills | 6 ops/cost-aware skills (continuity-auditor, render-triage, script-doctor, storyboard-prompt-craft, style-ref-critic, lahari-director) | 8 generic node skills (concept/script/art/casting/sound/audio/storyboarding/video) | HIGH — Lahari teaches failure diagnosis + cost triage; Mirage teaches workflow + safe edits. Neither subsumes the other. |
| Prompts | ~200-line planScenes with song-type branching, meditative pacing math, devotional vocabulary | Composer sections + ~3 lines of generic preset rules | ~95% of devotional taste content absent from Mirage's text layer (deliberately) |
| Presets | 4 curated devotional style presets (`server/style-presets.ts`), preview images, proven over ~60 songs | 2 workflow presets + 1 workflow recipe (yapper); zero shipped style presets | Structural inversion: style-preset-driven → workflow-preset-driven |

## Harvest backlog (ranked)

### HIGH — generic machine improvements (not Lahari-gated; do whenever)

1. **Props-in-hand default rule** — `lahari-local/main:server/services/imagePrompts.ts`,
   `buildCharacterPrompt()`: "Do NOT include props, weapons, lamps, offerings, or ritual items in
   hand." Generalized per Saul: default for ALL character reference generation, with an explicit
   escape ("unless the artist asks for a held object"). Home = global casting-director skill +
   look-generation guidance. The devotional *why* (held objects read as acting, breaks darshan)
   goes in the Lahari pack notes as context.
2. **Pacing signal exposure (NOT pacing doctrine)** — demoted from the original draft per Saul.
   Lahari's hard rules ("15s default, 8–12s meditative holds…") were the pre-agent machine doing
   the agent's job. The agent now reasons pacing from audio analysis/theme/concept. The only
   portable requirement: audio analysis must expose enough signal (sections, energy, timing) and
   the script-writer skill may carry one line of craft guidance ("let meditative material breathe;
   don't over-cut") — judgment input, not enforced math. Lahari's exact-sum duration validation
   stays useful as a mechanical check where Seedance needs durations to add up.
3. **Style presets as a workspace primitive** — general feature for every workflow: workspace-scoped
   curated preset sets (preset image is ground truth, per existing doctrine), artist-portable.
   Lahari's four (`lahari-local/main:server/style-presets.ts`: sacred-golden-serenity,
   pure-temple-morning, warm-incense-devotion, sacred-teal-riverlight) become the first imported
   set when Lahari's artists move — content, not architecture.
4. **Continuity-auditor skill** — `lahari-local/main:server/resources/skills/continuity-auditor/SKILL.md`.
   Four-layer model (identity/environment/style/temporal), chained-shot mechanics
   (`continuityFrom='prev_shot'` vs `'cut'` and what the model hallucinates when mismarked),
   cost-aware fix ladder. Mirage dropped it in the node-skill rebuild because "not a graph node" —
   correct for the skill taxonomy, but the *content* never got re-homed. Absorb into script-writer +
   storyboarding + video-director skills, or restore as an on-demand diagnostic worker skill.
5. **Chained-shot temporal mechanics** — same file, "Temporal Continuity" section. Mirage's
   script-writer mentions continuity-dependent neighbors but never teaches the failure mode.

### MEDIUM

6. **Render-triage content** — `lahari-local/main:server/resources/skills/render-triage/SKILL.md`.
   Four failure modes (prompt/model/reference/taste) + one-shot diagnosis tests + cost ladder.
   Was dropped with the node-skill rebuild; port as an on-demand worker skill (matches the audit
   backlog's "selective worker agents" item), with hardcoded dollar costs stripped.
7. **Storyboard prompt anti-patterns** — `lahari-local/main:server/resources/skills/storyboard-prompt-craft/SKILL.md`.
   Concrete ❌/✅ pairs (no film-tech jargon image models can't parse; "every panel a deity portrait"
   ban; specific-over-generic: "threshold of a stone shrine, oil lamps in clay holders" beats
   "glowing sanctum"). Mirage's storyboarding skill is template-forward and thinner — graft the
   anti-pattern section in (generic parts globally; devotional parts in the Lahari pack).

### LOW / adapt-only

8. **lahari-director operating rhythm** — structure only (attach → refresh → read events → propose);
   wording is stale against Mirage's cockpit. Mirage's AGENTS.md already covers most of it.
9. **style-ref-critic reusability tests** (strip-the-subject / imagine-13-shots / constrain-vs-define)
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
| Props default rule ("no held objects unless asked") | global casting-director skill + look guidance |
| Pacing | agent judgment; machine exposes audio-analysis signal; one craft line in script-writer skill; exact-sum check stays mechanical |
| Style presets | general workspace-scoped preset primitive; Lahari's 4 = first imported set |
| Devotional storyboard anti-patterns + vocabulary | Lahari workspace pack notes / pack-scoped skill content |
| Continuity + triage content | node skills (generic parts) + on-demand worker skill (diagnosis ladder) |
| Generic anti-patterns (film-jargon ban, specificity) | global storyboarding/video-director skills — safe for all tenants |

## Standing lesson

Taste was hiding in three places with different port costs: skill docs (cheap — copy/adapt),
preset data (cheap — it's data), and **prompt-builder code** (expensive to find, cheap to move once
found — this audit found it). When harvesting any future tenant's earned knowledge, grep the prompt
builders, not just the docs.
