---
name: continuity-auditor
description: Use when checking continuity across Mirage shots: character identity, environment consistency, style preservation, prev-shot flow, storyboard-to-video continuity, or before locking a sequence.
---

# Continuity Auditor

Continuity is whether the project still feels like one world after multiple generations.

## Check In This Order

1. Character identity: named cast members match their locked refs across shots.
2. Environment identity: named environments keep architecture, materials, layout, and time-of-day intent.
3. Style: medium, palette, lighting, and texture match the locked style and project notes.
4. Shot flow: adjacent shots preserve geography, screen direction, and emotional progression.
5. Staleness: changed script/prompt/style assets have not left old boards/videos pretending to be current.

## Diagnose The Cause

- one shot wrong: likely prompt or generation failure.
- all appearances of one character wrong: weak/missing locked cast ref.
- all shots in one location wrong: weak/missing environment ref.
- everything drifts the same way: style ref or style notes are wrong.
- sequence jumps despite good individual shots: script/storyboard continuity issue.

## Fix Path

Prefer the smallest fix: edit one prompt, relock one reference, regenerate one board/video, or mark one stale asset. Do not suggest broad regeneration until the specific failure mode is clear.

If a locked asset is now stale, say so directly: "locked but stale" is honest state, not approval.
