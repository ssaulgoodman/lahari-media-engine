---
name: casting-director
description: Use when generating, judging, locking, or fixing Mirage cast and environment references — identity anchors, reference candidates, uploaded guides, and downstream consistency for characters, objects, and locations.
---

# Casting Director

Cast and environment refs are continuity anchors. Storyboards and videos bind graph names to these images. If a locked ref is vague, off-style, over-composed, or beautiful-but-wrong, every downstream shot inherits the problem.

## Do this now

Read `state/cast.md`, `state/environments.md`, and candidate URLs from `run_action(list_candidates)`. Judge candidates for production usability, not gallery appeal.

For each entity, decide:

- Is the identity readable from one image?
- Does it match the script description and locked style?
- Is it neutral enough to reuse across many shots?
- Does it avoid scene-specific action, dramatic props, extra characters, or one-off lighting?
- Will the image model bind this consistently when the prompt later says only the graph name?

If not, regenerate or upload a better anchor before spending on downstream boards/videos.

## Generate and lock

- **Generate candidates:** `start_job(generate_candidates)` after approval. Use `entityIds[]`; `promptOverride` may target only one entity.
- **List candidates:** `run_action(list_candidates)` before locking; never lock blind.
- **Lock:** `run_action(lock_reference)` with `sourceAssetId`.
- **Upload use-as-is:** upload via `/api/agent/uploads`, then lock with `sourceAssetId`.
- **Upload as guide:** upload and pass `guideAssetId` to `generate_candidates` when the artist image should steer but not be used directly.
- **Tune context:** use `contextOverrides` to include/exclude style image, style description, style-note buckets, or swap style asset. Candidate generation does not include other cast/env refs by default.

## Writing better candidate prompts

Use `promptOverride` only when you can state the full final prompt. It should be compact and reference-oriented:

- Character/object: name, stable identity cues, age/build/material, wardrobe or object-state invariants, neutral pose/presentation, plain background, no action.
- Environment: geography/layout, architectural logic, key landmarks, lighting register, scale, readable whole space, no characters unless tiny scale figures are needed.

Do not ask for a shot, scene, poster, action beat, or dramatic moment. These refs are reusable production plates.

## Judging character/object refs

Strong:

- face/body/silhouette or object shape is distinctive
- wardrobe/material/status details match the script
- neutral pose lets later shots animate or restage the character
- style matches the locked project style without copying its subject
- no second person/object steals attention

Weak:

- attractive portrait but wrong age/costume/body
- action pose that becomes hard to reuse
- dramatic lighting that defines identity poorly
- generated prop/object differs from the script’s role
- style ref subject bleeds into the character

## Judging environment refs

Strong:

- whole space is understandable
- entrances, scale, zones, and landmarks are clear
- lighting and palette match the style
- no one-off action locks the location into a single scene
- later boards can stage different beats inside it

Weak:

- mood painting with no usable layout
- copied from style image’s setting
- too generic to bind continuity
- crowded with characters or symbolic clutter

## Repair ladder

1. **One downstream shot wrong:** fix storyboard/shot prompt first.
2. **Same entity wrong across shots:** inspect locked ref and candidates.
3. **Locked ref weak:** relock a better existing candidate or upload use-as-is.
4. **No good candidate:** regenerate with a tighter prompt or guide image.
5. **All refs off-style:** return to art-director; style anchor is probably failing.

## Failure modes

- Locking for beauty instead of identity.
- Re-describing characters in storyboard prompts because the ref is weak.
- Using environment refs as mood boards instead of spaces.
- Regenerating boards/videos before fixing a bad anchor.
