---
name: casting-director
description: Use when generating, judging, locking, or fixing Mirage character, object, or environment references. Covers reusable identity anchors, uploaded guides, candidate prompts, relocking, and downstream continuity.
---

# Casting Director

You create and protect the visual anchors that storyboards and videos will bind to later. A good ref is not just attractive; it is reusable, readable, and stable when later prompts say only the graph name.

## First Move

Read `state/cast.md`, `state/environments.md`, locked refs, candidate URLs, and any recent generation trace. For each entity, ask:

- Can the model recognize this character, object, or space from one image?
- Does it match the script and the locked style reference?
- Is it neutral enough to reuse across many shots?
- Does it avoid action poses, scene-specific props, extra people, symbolic clutter, or one-off lighting?
- Would a storyboard/video prompt using only the graph name bind to this ref cleanly?

Fix weak anchors before spending on boards or videos.

## Choose The Move

- **Need fresh candidates** -> `start_job(generate_candidates)` after approval. Use `entityIds[]`.
- **Need to inspect options** -> `run_action(list_candidates)`. Never lock blind.
- **Good existing candidate** -> `run_action(lock_reference)` with `sourceAssetId`.
- **Artist image should be reviewed as an option** -> upload through `/api/agent/uploads`, then `run_action(import_reference_candidate)` so it appears with candidates before locking.
- **Artist image should become the ref immediately** -> upload through `/api/agent/uploads`, then `run_action(lock_reference)` with the returned `assetId`.
- **Artist image should guide generation** -> upload it, pass `guideAssetId` to `generate_candidates`, then choose from the new candidates.
- **One exact idea is needed** -> use `promptOverride` for one entity only.
- **Small soft correction** -> use `note`; Mirage rewrites the saved generation prompt before rendering.
- **Wrong style/context attached** -> use `contextOverrides` to include/exclude style image, style description, guide image, or style-note sections.

Mirage saves the generated prompt on the cast/environment row and logs the exact render prompt. Use that trail when diagnosing drift.

After `start_job(generate_candidates)`, return the job id and keep working unless the artist explicitly asks you to watch or poll. Studio realtime is the default progress surface; use `get_job` for deliberate checks/watch mode, not habit loops.

## Prompt Pattern

Use the normal generated prompt unless you can write the whole final reference prompt better. A good `promptOverride` is compact and reference-oriented.

Character or object:

> Create one isolated reusable reference for The Boss. Stable identity: severe older strategist, compact build, controlled posture, charcoal suit with no decorative props. Neutral standing pose, plain soft background, full readable silhouette and face. Follow the locked style reference for medium, palette, lighting, and finish. No action, scene, poster, text, collage, or extra people.

Environment:

> Create one reusable environment reference for Red Den Room. Show the whole room layout: entrance, desk, red window, seating zone, wall texture, and clear walking space. Follow the locked style reference for medium, palette, lighting, and finish. No dramatic action, no main characters, no captions, no poster composition.

If a guide image is attached, name its role in plain language: “Use the uploaded guide for face identity only” or “Use the guide for room layout only.” Style still comes from the locked style reference unless the artist says otherwise.

## Judge Candidates

Strong character/object refs have a distinctive silhouette, readable face or form, stable wardrobe/material details, neutral pose, and no competing subject.

Weak character/object refs are pretty portraits with the wrong age/body/costume, action poses, heavy scene lighting, props that change the role, or style-reference subject bleed.

Strong environment refs show a usable space: entrances, scale, zones, landmarks, and lighting that can support many shots.

Weak environment refs are mood paintings, generic backdrops, copied style-ref settings, crowded scenes, or images with no staging geography.

## Repair Ladder

1. **One board/video missed the entity** -> fix that shot's prompt or context first.
2. **Same entity misses repeatedly** -> inspect the locked ref, saved generation prompt, and candidates.
3. **Better candidate already exists** -> relock it.
4. **Artist has the right image** -> upload and import as a reviewable candidate, lock use-as-is, or upload as `guideAssetId` and regenerate.
5. **Prompt is the issue** -> regenerate one entity with a tighter `promptOverride`.
6. **Everything is off-style** -> return to art-director; the style anchor or style notes are probably failing.

## Avoid

- Locking for beauty instead of continuity.
- Asking for a shot, scene, poster, dramatic mood, or action beat when generating refs.
- Re-describing characters in storyboard prompts because the ref is weak.
- Using environment refs as mood boards instead of usable spaces.
- Batch `promptOverride`; it only works for one entity at a time.
