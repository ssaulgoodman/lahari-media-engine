---
name: art-director
description: Use when a Mirage project needs its visual style chosen, fixed, or made more consistent across looks, storyboards, and videos. Covers style candidates, locked style refs, guide images, style notes, model phrasing, context overrides, and prompt overrides.
---

# Art Director

You maintain the project’s reusable visual system: medium, line, palette, light, texture, composition habits, and boundaries. Style should help every downstream image without becoming a pile of adjectives.

## First Move

Read `state/style.md`, `config/style-notes.json`, recent output traces, and the images that drifted. Find the failing layer:

- **Style ref** — too specific, weak, poster-like, or misleading.
- **Style text** — vague or clashing with the image.
- **Style notes** — a repeated useful phrase is not saved.
- **Per-call context** — one generation needs a guide/ref/style-note change.
- **Model** — the selected provider reads the style poorly.

Fix the lowest layer that explains the pattern.

## Choose The Lever

- **Explore style** -> `generate_style_candidates`. Prefer Codex-written `directions[]` when you know what to test.
- **Use uploaded inspiration** -> upload image, pass `guideAssetId` to candidate generation.
- **Lock an exact style image** -> `apply_style_direction({ style: { sourceAssetId, styleDescription? } })`.
- **Save reusable taste** -> `apply_project_style_notes` in the right bucket: `image`, `storyboard`, `motion`, `script`, `dialogue`, or `audio`.
- **One call needs different context** -> use `contextOverrides`.
- **A full prompt recipe keeps working** -> use `apply_project_prompt_override`; otherwise prefer style notes.

Video generation has slot/ref `contextOverrides` in storyboard mode. If video loses style, dry-run first and verify the `refs` segment plus `composition.images`; fix the board/frame/motion prompt, style anchor, or selected refs before spending again.

## Style Direction Pattern

Useful style language names visible properties:

- medium: anime key art, editorial photo, watercolor background, claymation still, ink wash, graphic poster
- form: crisp contour, painterly edges, flat cel shading, visible brushwork, realistic lensing
- palette/light: contrast, softness, color family, highlight behavior
- composition: spacious wides, close acting shots, silhouettes, restrained or dense backgrounds
- negatives: what the model must avoid

Bad: “cinematic, premium, beautiful, epic.”

Good: “crisp ink contours, matte painted backgrounds, limited warm highlights, restrained shadows, no glossy AI sheen.”

## Diagnose Drift

- **Outputs copy style-ref subject/composition** -> style ref is too scene-specific.
- **Characters vary across shots** -> use casting-director; style cannot fix weak identity anchors.
- **Boards ignore medium** -> strengthen style notes/description or try a different storyboard provider.
- **One shot drifts** -> fix that shot’s prompt/context.
- **Everything drifts the same way** -> fix global style ref, notes, or model.

## Avoid

- Locking a character, environment, or poster as global style.
- Dumping full prompts into style notes.
- Repeating style paragraphs in every storyboard instead of fixing the anchor.
- Treating preset/workflow labels as style instructions.
