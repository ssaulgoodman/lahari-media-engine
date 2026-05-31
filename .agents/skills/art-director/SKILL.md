---
name: art-director
description: Use when choosing, generating, locking, or fixing Mirage style — the reusable visual system, style notes, model phrasing, and project-level taste decisions that keep downstream images and videos coherent.
---

# Art Director

Style is the project’s reusable visual system. It is not a pretty poster, a character portrait, or a single scene. It is the set of choices every downstream image can inherit: medium, line, palette, lighting, texture, density, camera/illustration habits, and what the project refuses to look like.

## Do this now

Read `state/style.md`, `config/style-notes.json`, and the latest generated outputs that drifted. Decide which layer is failing:

- **Style reference** — the locked image is too specific, weak, or misleading.
- **Style description** — the text does not name the medium and constraints clearly.
- **Style notes** — a repeated phrase/technique works but is not codified.
- **Per-call context** — one shot or candidate needs a temporary style/guide override.
- **Model mismatch** — the model is reading the style poorly.

Fix the lowest layer that explains the pattern. Do not patch ten individual prompts when one bad style anchor is causing every output to drift.

## What good style direction looks like

A useful style direction has:

- **Medium:** anime key art, clean editorial photography, watercolor background art, ink wash, claymation still, graphic poster, etc.
- **Line and form:** crisp contour, soft painterly edges, flat cel shading, visible brushwork, high-detail realism.
- **Palette and lighting:** controlled color family, contrast level, day/night register, shadow softness, highlight behavior.
- **Composition habits:** spacious wides, close acting shots, strong silhouettes, restrained backgrounds, dense set dressing.
- **Repeatability:** it can handle wide/tight, interior/exterior, cast/environment, action/quiet.
- **Negative constraints:** what not to become, especially common model defaults.

Weak style language sounds impressive but gives no steering: “cinematic,” “premium,” “epic,” “beautiful,” “high quality.” Convert that into visible constraints.

## Maneuvers

- **Author directions yourself:** for `generate_style_candidates`, prefer `directions[]` with 2-4 genuinely different systems. Example shape: title + 2-4 sentences naming medium, palette, light, texture, and why it fits the source.
- **Use a guide image:** upload via `/api/agent/uploads`, then pass `guideAssetId` when the artist has a visual target but it should not become the locked style directly.
- **Lock style:** `run_action(apply_style_direction)`. If locking an uploaded asset, write `styleDescription` yourself when you can inspect it; auto-identify is fallback.
- **Save learned taste:** if a phrase keeps improving image/storyboard/video prompts, use `run_action(apply_project_style_notes)` in the relevant bucket (`image`, `storyboard`, `motion`, `modelPhrases`). Do this instead of repeating the phrase manually forever.
- **Use prompt override sparingly:** `apply_project_prompt_override` is for a full repeatable recipe, not a few taste fragments.
- **Unplug per call:** when style image is hurting a candidate/board, use `contextOverrides` such as `{ includeStyleImage: false }`, `styleAssetId`, or `styleNoteSections`. Video generation has no `contextOverrides`; fix the board/frame/motion prompt instead.

## Diagnose style drift

- **All outputs copy the style image’s subject/composition:** style ref is too scene-specific. Generate/lock a more neutral style frame.
- **Characters look stylish but inconsistent:** cast refs are weak or candidate prompts are over-styled; use casting-director.
- **Boards ignore the locked medium:** style description/notes are too vague, or storyboard provider is weak for that medium.
- **One shot drifts:** per-shot prompt/context issue. Do not relock the global style.
- **Everything drifts the same way:** global style/reference/model issue. Fix the anchor.

## Judging candidates

Ask: can this visual system produce a full sequence, not just one image? Cover the subject mentally. If the remaining medium, palette, lighting, and texture still define a world, it is a style. If the image only works because of its central subject or one composition, it is a poster.

## Push back

Push back on “make it more cinematic/premium/epic” until it becomes visible language. Ask what should change: medium, color, contrast, texture, detail level, composition, realism, motion energy, or emotional register.

## Failure modes

- Locking a beautiful character/environment image as style.
- Letting style notes become a dumping ground for full prompts.
- Adding broad style prose to every storyboard instead of fixing the style anchor.
- Treating preset labels as instructions. The project graph and artist-approved style are the actual contract.
