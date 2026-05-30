---
name: render-triage
description: Load only before spending money to regenerate a failed Mirage asset, or after repeated failed generations when you need to decide whether to fix prompt, references, model, or taste. Do not use for ordinary critique.
---

# Render Triage

Use this as a cost gate before paid regeneration.

## Failure Modes

- Prompt issue: the instruction does not ask for the right thing.
- Reference issue: the locked style/cast/environment/storyboard ref is weak or wrong.
- Model issue: the request is right but this provider is bad at it.
- Taste issue: the output matches the spec, but the spec itself is not desirable.

## Triage Steps

1. Compare output against the saved prompt/spec and attached refs.
2. Name the failure mode.
3. Choose the cheapest correction.
4. Only then recommend regeneration.

## Cheapest Fix First

- prompt issue: edit prompt/spec, regenerate the affected asset.
- reference issue: relock or regenerate the bad reference before downstream retries.
- model issue: switch provider/model if the same prompt fails twice.
- taste issue: change concept/style/script direction before spending more.

Do not say "try again" without naming what changes.
