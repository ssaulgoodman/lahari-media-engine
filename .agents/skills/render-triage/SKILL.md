---
name: render-triage
description: Use when a generated asset (storyboard, frame, video, render) doesn't match intent and you need to decide what to fix. Triggered by "this board is wrong," "the video drifted off the prompt," "why does this look generic," "should we regenerate or refine," "we tried twice and it's still off." Cost-aware diagnosis before paying to regenerate.
---

# Render Triage

Generated assets fail in four distinct ways. Before regenerating (which costs money), diagnose which failure mode you're seeing. The fix changes per mode.

## The Four Failure Modes

**1. Prompt issue.** The text instruction doesn't describe what we wanted. Most fixable, cheapest.

**2. Model issue.** The model interpreted the prompt correctly but rendered it badly. Try a different model.

**3. Reference issue.** The locked character/environment/style reference is wrong or weak. Downstream inherits its wrongness.

**4. Taste issue.** The render is technically correct but the underlying creative direction was wrong. The prompt did what it said; what it said was a bad idea.

## How to Tell Them Apart

**Read the prompt and the render side by side.**

- If the prompt asked for X and the render produced Y unrelated to X → **prompt issue** (model didn't understand) OR **model issue** (model understood but couldn't render).
- If the prompt asked for X and the render produced X but with wrong identity (face is different from the locked character) → **reference issue**.
- If the prompt asked for X and the render produced X but it just looks generic or off-style → **style reference issue** OR **model issue** (some models lean generic).
- If the prompt asked for X and the render produced X and it's accurate but the *shot itself is wrong for the scene* → **taste issue**.

**One-shot diagnosis tests.**

| Symptom | Most likely cause | Cheap test |
|---|---|---|
| Random object in render not in prompt | Model hallucination / over-generic prompt | Refine prompt to be more specific |
| Right composition, wrong face | Character ref weak or not locked | Check `referenceImageUrl` on cast member |
| Right composition, wrong environment | Env ref weak or not locked | Check `referenceImageUrl` on environment |
| Cinematic look on a painterly project | Style isn't constraining medium | Style critique — see `style-ref-critic` |
| Same drift across multiple shots | Common reference (style, model) is the cause | Audit the shared reference |
| Drift on one shot only | Per-shot prompt issue | Refine that one prompt |
| Result looks great but feels wrong | Taste issue | Don't regenerate — rewrite the shot's intent |

## Cost-Aware Fix Ladder

Climb only as high as you need to. Each step costs more.

**Step 1: Refine the prompt (cheapest).** Edit `visual_prompt` or `motion_prompt` to be more specific or remove ambiguous language. Regenerate. ~$0.05 (board) / ~$0.80 (video).

**Step 2: Add/remove refs (cheap).** Adjust which references the shot pulls. Toggle `useNextAsEndFrame`, attach a manual reference image. Regenerate. Same cost.

**Step 3: Switch the model (one shot's worth).** Try a different image model (nano-banana-2 vs nano-banana-pro vs gpt-image-2) or video model (veo-3.1 vs seedance-2.0-fast). Run one shot to compare. Same cost.

**Step 4: Refine the locked reference (medium).** Unlock the character/environment/style. Generate a better candidate. Lock the new one. Mark dependent shots stale. Regenerate dependents. Per-look ~$0.02, per dependent shot ~$0.05-0.80.

**Step 5: Rewrite the shot's intent (cheap text, but might force regen of everything).** If the underlying beat was wrong, fix the script. Then everything downstream may be stale. Heaviest in implication.

## Common Triage Mistakes

**Regenerating before diagnosing.** The same prompt + same model + same refs will likely produce the same kind of failure. If you regenerate without changing something, you've spent money learning that the system is consistent.

**Refining the prompt when the problem is the reference.** If the character's face is wrong in 5 shots, refining the per-shot prompt won't fix it. The reference is wrong.

**Refining the reference when the problem is the model.** If you've regenerated the reference 3 times and it still looks generic, try a different image model for the reference generation.

**Calling it a taste issue when it's a prompt issue.** If you haven't tried a more specific prompt, you don't know yet that the taste is wrong. Refine first, judge second.

**Regenerating video before locking the storyboard.** Video is the expensive end. If the storyboard wasn't locked, the video is gambling. Storyboard-lock-first is the cost discipline.

## When to Stop Iterating

Lock if:
- The render matches the shot's intent
- Identity / environment / style continuity holds
- The flaws are character of the medium, not character of the prompt

Move on without locking if:
- The shot is "good enough for now" but you might iterate later → leave unlocked, mark for review.
- The shot is a structural placeholder until upstream changes → leave unlocked, don't keep paying to regenerate something whose specification will change.

Walk away (and ask) if:
- Three iterations haven't improved quality
- Each iteration drifts a different way (signal of model/style instability, not a prompt-tuning problem)
- The cost is mounting and you're not converging

## The Storyboard → Video Lock Discipline

The single most expensive failure mode is generating video before the storyboard is right. Veo and Seedance both cost ~$0.10-0.20/second × N shots. A 13-shot 8s video = ~$10-20 per pass.

Discipline:
1. Iterate the storyboard cheap (~$0.05/board × N iterations) until it's locked.
2. Only after lock, generate video.
3. If video fails, return to the storyboard — not the video prompt.

The artist's instinct will often be to regenerate video. Resist. Ask: is the storyboard wrong? If yes, fix the storyboard, then generate video again.

## What This Skill Doesn't Cover

- The mechanical regenerate/refine tool calls — those are tier-2 apply tools.
- Writing the new prompt during a refine — see `storyboard-prompt-craft` / `script-doctor`.
- Continuity-specific drift — see `continuity-auditor`.

## Cross-References

- `continuity-auditor`: identity / environment / style drift diagnosis.
- `storyboard-prompt-craft`: writing better storyboard prompts after triage points there.
- `style-ref-critic`: when the diagnosis points to a style problem.
- Doctrine §5 (permission model): generate cost / blast radius / rollback expectations.
