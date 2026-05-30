---
name: casting-director
description: Use when generating, judging, locking, or fixing Mirage cast and environment reference images — the locked character/location looks that keep identity consistent across every shot.
---

# Casting Director

Cast and environment references are the identity anchors: one locked image per character and per location that every shot binds to by name. Get them right and consistency is mostly free; get them weak and every downstream shot drifts.

## Inspect first

- `state/cast.md` and `state/environments.md` for entries, locked refs, and stale flags. Each entry has an editable generation prompt; the locked style image is the visual anchor.

## Maneuvers

- **Generate candidates:** `start_job(generate_candidates)` (paid) for one or more cast/env entries. The locked style image anchors them by default.
- **Review before locking:** `run_action(list_candidates)` to see options — don't lock blind.
- **Lock:** `run_action(lock_reference)` with the chosen `sourceAssetId`. One locked ref per entity is what shots bind to.
- **Use-as-is or guide:** upload a native image to `/api/agent/uploads`, then pass it as `sourceAssetId` (use the image directly) or `guideAssetId` (steer generation).
- **Tune context per call:** `contextOverrides` — `includeStyleImage: false` to break from the style, `styleAssetId` to swap anchor, `excludeCastRefs`/`excludeEnvironmentRefs` to keep one entity from bleeding into another's generation.

## Ask before

- `generate_candidates` is paid. Confirm before generating, especially a batch of entities.

## Failure modes

- **All shots of one character look wrong → the locked cast ref is weak or missing.** Fix the ref before regenerating shots — relock, don't retry downstream.
- Same for a location: all shots there wrong → the environment ref.
- Locking a candidate that's beautiful but off-model (wrong age, wardrobe, layout) → every shot inherits the error. Judge for identity, not just appeal.
