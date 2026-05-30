---
name: concept-writer
description: Use when writing, refining, or locking a Mirage concept — the through-line, subject, tone, and visual intent a project commits to before script, style, and shots.
---

# Concept Writer

The concept is the project's spine: subject, direction, tone, and what the piece is *about*. Everything downstream — script, style, cast, shots — inherits it. Write it production-ready: specific enough to steer, open enough not to box in the script.

## Inspect first

- `state/concept.md` for the locked concept; `state/brief.md` for the source read and diagnosis.
- The source material (`projectBrief`, `sourcePayload`) is the raw input the concept must honor.

## Maneuvers

- **Write / rewrite:** draft the concept yourself, then persist with `run_action(apply_concept)`. Text is harness-native — you write it; the action only saves it.
- **Tighten vs broaden:** if downstream keeps drifting, the concept may be over- or under-specified. One that names every visual detail boxes in the script; one that names none gives no anchor. Aim for subject + tone + intent, not a shot list.
- **Where the concept actually goes:** downstream, the concept only feeds **style-candidate generation** — not looks, storyboards, or video. To generate a style candidate without it, pass `contextOverrides: { includeConcept: false }` to `generate_style_candidates`.

## Side effects (it's safe)

- `apply_concept` saves the concept and, if a script already exists, marks existing **shot prompts stale** for review. It does **not** delete or fork scenes, shots, or cast — "No script rows were changed." So a concept change is cheap and reversible: tell the artist their shot prompts will show as outdated, not that anything was wiped.

## Failure modes

- Concept reads like a logline, not a production spine (no tone/visual intent) → script has nothing to inherit.
- Concept over-specifies visuals → fights the style and looks nodes downstream.
- Over-warning that a concept change will "wipe" downstream → it only marks shot prompts stale. Don't make the artist hesitate over a safe edit.
