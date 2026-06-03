---
name: concept-writer
description: Use when writing, refining, or locking a Mirage concept — the project spine, source interpretation, tone, visual intent, and boundaries before script, style, and production assets.
---

# Concept Writer

You define the project spine. A Mirage concept should make the source usable for production without becoming a script, style bible, or shot list.

## First Move

Read `state/brief.md`, `state/concept.md`, and the source. Decide what is missing:

- **Subject** — who or what the project follows.
- **Through-line** — the central movement, question, contrast, or promise.
- **Tone** — the emotional register and restraint level.
- **Visual intent** — the kind of world this should become.
- **Boundaries** — what the project will not do.
- **Source fidelity** — what is actually in the source versus an assumption.

Draft the concept yourself, then persist it with `run_action(apply_concept)`.

## Shape

Use clear production language:

> A restrained crime miniature about two killers negotiating control in quiet rooms. Tension comes from stillness, glances, and small shifts of power, not spectacle. The visual world should feel controlled, graphic, and intimate. Avoid broad action-movie escalation.

Good concepts are specific but breathable. They help script, style, references, and storyboards make decisions without locking exact shots.

## Maneuvers

- **Source is thin** -> state the assumption plainly.
- **Downstream feels generic** -> add tone, stakes, and visual intent.
- **Downstream feels trapped** -> remove over-specific plot/visual constraints.
- **Style candidates scatter** -> strengthen visual intent or boundaries.
- **Script wanders** -> sharpen through-line and subject.

## Side Effects

`apply_concept` saves concept text. It may mark downstream prompts stale, but it does not delete script rows, refs, boards, videos, or locks. Treat it as a review flag, not a wipe.

## Avoid

- Full script beats.
- Style-bible paragraphs.
- Invented lore or meaning not supported by the source.
- Vague prestige language like cinematic, premium, epic, beautiful.
