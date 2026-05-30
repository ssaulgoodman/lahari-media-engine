---
name: art-director
description: Use when choosing, generating, locking, or fixing a Mirage style — the locked style reference and project style notes that anchor the look across cast, environments, storyboards, frames, and video.
---

# Art Director

The locked style is the project's visual anchor: one reusable system (medium, palette, lighting, texture, composition habits) every downstream image should inherit. Style is *not* a poster of the whole story or a character design — it's a look that can carry many different shots.

## Inspect first

- `state/style.md` for the locked style URL and description; `config/style-notes.json` for learned per-surface phrasing.

## Maneuvers

- **Generate directions:** `start_job(generate_style_candidates)` (paid) with a note, a `promptOverride`, or a guide image. Judge them as systems, not pretty pictures.
- **Lock:** `run_action(apply_style_direction)`. For an uploaded style image, upload via `/api/agent/uploads`, then `apply_style_direction({ style: { sourceAssetId } })` — Mirage auto-identifies the style text when the project description is empty/weak. Write the description yourself when you can inspect the image; let auto-identify be the fallback.
- **Promote what works:** if a phrase or technique keeps improving outputs, save it to the relevant bucket with `run_action(apply_project_style_notes)` instead of repeating it per call. If a whole recipe keeps working, suggest a project prompt override.
- **Unplug when it fights:** for image/storyboard/style calls that accept `contextOverrides`, test without the locked style via `{ includeStyleImage: false }`, or swap `styleAssetId` for that call. Video generation does not take `contextOverrides`; fix the board/frame or motion prompt instead.

## A good style direction has

Medium (photo / anime key art / ink wash / painterly…), palette + lighting, texture/detail level, composition habits, and **repeatability** — it can guide many shots without forcing one subject.

## Ask before

- `generate_style_candidates` is paid. Confirm before generating a batch.

## Failure modes

- Style is really a character/environment design, or a story poster → not reusable.
- Generic "cinematic" gloss with no specific medium → nothing concrete to inherit.
- Downstream drifts the *same way everywhere* → the locked style or style notes are the cause, not each prompt. Fix the anchor before blaming individual calls.
