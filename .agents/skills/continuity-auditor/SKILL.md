---
name: continuity-auditor
description: Use when checking continuity across shots — chained (`prev_shot`) flow, character identity, environment consistency, style preservation, end-frame-to-start-frame transitions. Triggered by "does this sequence read coherently," "the character looks different in shot 4," "why does scene 2's lighting jump," or before locking a sequence of shots.
---

# Continuity Auditor

A music video that doesn't hold together visually feels cheap regardless of how good any single shot is. Continuity is the invisible work — when it's right, no one notices.

## The Four Layers of Continuity

**1. Identity continuity.** A named cast member must read as the same person across every shot they appear in. Same face, same age, same costume, same hair, same era. Identity is provided by the locked character reference image — every shot that includes the character must use that reference. If the artist generated new candidates and didn't lock, downstream shots will drift.

**2. Environment continuity.** A named environment must read as the same place. Same architecture, same materials, same time of day unless a beat explicitly shifts it. Like identity, this is anchored by the locked environment reference image.

**3. Style continuity.** Every shot in the project should read as the same visual world — same medium, palette, lighting register, level of stylization. The locked style image is the anchor; the storyboard planner and image generator both consume it.

**4. Temporal continuity (chained shots).** When `continuityFrom = 'prev_shot'`, the shot is expected to flow from the previous shot's last frame. The end of N becomes the start of N+1. Cuts (where `continuityFrom = 'cut'`) explicitly break this expectation — the audience reads it as a scene change or beat shift.

## What to Check When Auditing

**Across all of a character's shots:**
- Same face? Same costume? Same age?
- If the character ages or changes costume within the video, is that an intentional beat?
- Look for drift: subtle differences that accumulate. A slightly different sari color in three shots reads as carelessness.

**Across all of an environment's shots:**
- Same place? Same time of day?
- If lighting shifts (morning → evening), is that progression in the script?
- Architectural details — pillars, thresholds, lamps — should appear consistently when in frame.

**Across the whole video for style:**
- Same medium throughout? (painterly, photographic, miniature, etc.)
- Same color temperature register? (warm, cool, mixed)
- Same level of stylization? (no shot should suddenly read as a different art style)

**Across chained sequences:**
- Does N+1's start visually flow from N's end?
- If N ends with a wide shot of a temple and N+1 starts with a close-up of a face, that's a cut, not a chain. Mark it `cut`.
- If both are marked `prev_shot`, the model expects continuity and will produce odd hallucinations to bridge them.

## Common Failures and Their Causes

**Same character looks different across shots.**
- Most likely: no locked reference, generation used pure text prompts → drift.
- Fix: lock a reference character look. Mark dependent shots stale. Regenerate.

**Environment shifts subtly.**
- Most likely: locked environment ref is too generic ("a temple") so each shot interprets it differently.
- Fix: refine the environment reference to be more specific, or lock a better candidate.

**Style breaks on one shot.**
- Most likely: that shot was generated with a different model than the others, OR the prompt drifted into cinematic language while others stayed in the locked medium.
- Fix: regenerate that shot with the project's image_model, or rewrite its visual prompt to match the locked style's medium.

**Chained shots don't flow.**
- Most likely: shot N's `end_visual_prompt` doesn't actually describe what N+1 expects to start from.
- Fix: rewrite N's end frame prompt to describe what N+1 needs to see at its start.

**Cut markers don't match the artist's intent.**
- Most likely: the script was written without thinking through `continuityFrom` per shot.
- Fix: walk through the scene, ask "does shot N flow visually from shot N-1, or does it cut?" Set continuity_from explicitly per shot.

## Anti-Patterns

- **Forcing continuity across a clear scene break.** If scene 2 is "temple morning" and scene 3 is "home shrine evening," chaining the last shot of 2 to the first of 3 will produce hallucinated bridging that reads weird. Cut.
- **Refusing to use cuts on a longer video.** A 4-minute video with 13 shots, all chained, is exhausting and visually murky. Cuts give the audience moments to breathe.
- **Locking a character reference that's wrong.** If the locked ref has an off-detail (wrong costume era, wrong age), every downstream shot inherits it. Audit the reference before downstream work.

## Cost-Aware Triage

If you spot continuity drift in a generated video, decide:

- **Prompt issue (cheap to fix)** — rewrite the visual_prompt or motion_prompt, regenerate. ~$0.05-0.80 per shot.
- **Reference issue (medium cost)** — unlock and regenerate the character/env look, then regenerate dependent shots. Per look ~$0.02, per shot ~$0.05-0.80.
- **Style issue (medium cost)** — if every shot drifts in the same way, the locked style is the cause. Unlock style, pick a different preset or generate a better visualization, then regenerate downstream.
- **Video model issue (cheap to test)** — if the still board/frame is right but motion keeps drifting, compare a different video model on one shot. Image generation is Segmind Nano Banana 2 only; fix image problems through prompt/reference changes.

Don't immediately regenerate the video. Diagnose first — `render-triage` skill walks through this.

## What This Skill Doesn't Cover

- Writing the continuity-respecting prompts in the first place — see `storyboard-prompt-craft` and `script-doctor`.
- The mechanical lock/unlock tools — those are tier-2 apply tools, not taste.

## Cross-References

- `script-doctor`: continuity considerations during script writing.
- `storyboard-prompt-craft`: composing storyboard panels that respect chained continuity.
- `render-triage`: diagnosing whether a continuity break is a prompt, reference, style, or model issue.
