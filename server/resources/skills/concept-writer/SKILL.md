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
- **Keep it off every call:** the concept seeds context but isn't meant to ride in every image/video prompt. If it's polluting outputs, drop it per-call with `contextOverrides: { includeConcept: false }`.

## Ask before

- **Re-locking a changed concept is destructive.** If scenes already exist, locking a materially different concept can wipe or fork downstream script/cast/shots. State that plainly and confirm before applying — offer a fork if the artist wants to keep both.

## Failure modes

- Concept reads like a logline, not a production spine (no tone/visual intent) → script has nothing to inherit.
- Concept over-specifies visuals → fights the style and looks nodes downstream.
- Silent re-lock → downstream data loss. Always surface the wipe/fork choice first.
