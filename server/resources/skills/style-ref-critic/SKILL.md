---
name: style-ref-critic
description: Use when selecting, locking, or critiquing the style reference for a project — preset picks, style brainstorming critique, deciding whether a generated style is reusable downstream, refining style direction. Triggered by "which style preset fits this project," "is this style ref reusable," "the style is drifting," or before locking a style asset.
---

# Style Ref Critic

The locked style image is the visual contract for the entire video. Every downstream generation — character looks, environment looks, storyboards, frames, videos — consumes it as a reference. If the style is wrong, everything downstream inherits the wrongness.

## What "Style" Means

A style is a **reusable visual system**, not a specific image. Properties of a good style:
- Coherent medium (painterly miniature, photographic, illustrated, woodcut, etc.)
- Coherent palette (warm earth + lamplight, or cool stone + moonlight, etc.)
- Coherent lighting register (golden hour, indoor-lamp, midday, etc.)
- Coherent texture (high-detail, flat, grainy, etc.)
- Coherent reference tradition (anime key art, contemporary photography, woodcut, painted background art, etc.)

What it is NOT:
- A specific poster or portrait
- A scene from the video
- A storyboard frame
- A narrative composition

## What Makes a Style Reusable

**Test 1: Strip the subject.** If you covered the central figure in the style ref, would the remaining frame still look like a coherent visual world? If yes, it's a style. If no, it's a portrait or scene.

**Test 2: Imagine 13 different shots.** Can you envision 13 different compositions — wide and tight, interior and exterior, with and without people — all reading as the same visual world? If yes, the style is reusable. If only 2-3 compositions fit, it's too specific.

**Test 3: Does it constrain or define?** A good style *constrains* downstream (this medium, this palette, this lighting register). A weak style *defines* a specific subject/composition that every downstream shot tries to copy.

## Preset vs Brainstorm

**Pipeline presets:** `preset_key` defines the default visual/taste contract. If the preset already supplies a style bible, use it as the source of truth unless the artist asks for a custom direction.

**Brainstorm directions:** Use when the preset needs project-specific taste or the artist asks for exploration. Brainstorming should produce 3-4 genuinely different directions (different medium, different palette, different reference tradition), not 4 variations of the same direction.

**Visualizing a direction:** The visualize step produces a reusable style frame. It is NOT a scene from the video. Anti-pattern: the visualization shows the song's main character in a key moment — that's a poster, not a style. Re-prompt to remove subject specificity.

## Anti-Patterns in Style Selection

- **Locking a beautiful one-off image as "style."** It's too specific. Every downstream shot will try to mimic the composition.
- **Locking a character portrait as "style."** Same problem — every shot becomes a portrait.
- **Generic fantasy/VFX as default.** "Glowing chamber, mystical light, golden particles" produces the same look across every project and removes the source's specific identity.
- **Palette fighting the source.** A cold palette on tender material or a sugary palette on dread material creates emotional discord the artist will feel without being able to name.
- **High-stylization on grounded material.** If the project is documentary-like or realist, heavy stylization may feel false; restrained photography or controlled illustration may serve better.

## Preset Authenticity

Every preset has its own authenticity test:

- `music_video_default`: does the style serve the track, artist, genre, and intended audience without becoming generic stock music-video gloss?
- `anime_default`: does the style support character-model consistency, readable acting, clear silhouettes, and background continuity instead of live-action photoreal defaults?
- Future client presets: does the style express that client's brand/world, not the model's generic taste?

## When to Refine a Locked Style

If downstream generations consistently drift the same way, the style is the cause. Symptoms:
- Every character look comes out with the same generic costume the style ref happened to have.
- Every environment renders too similar to the style ref's setting.
- Storyboards keep losing the locked medium.

Diagnosis:
- The style ref might be too compositionally specific (test 1 fails).
- The style ref might lack contrast (model can't tell what to preserve vs vary).
- The style might be fighting with the project's image model (some models read certain styles better).

Fix paths:
- Lock a different preset.
- Re-brainstorm with a directive note that addresses the specific drift.
- Visualize again with a more abstract subject in the frame.

## When to Tell the Artist No

- **"This portrait is the style."** No — it's a portrait. Push toward a reusable system.
- **"Make it more glowy / epic / premium."** These are vague notes trending toward generic VFX or stock polish. Ask what the source actually needs and what visual register matches.
- **"Use this unrelated famous style."** Sometimes the right answer; often a sign the artist has not thought through source authenticity. Ask first.

## What This Skill Doesn't Cover

- Writing the style brainstorm directions themselves — you author those, then `generate_style_candidates` renders them.
- The image-gen call for style visualization — that's a paid action, not this skill.
- Critiquing generated character/environment look references (which are style-consuming, not style-defining) — that's its own kind of triage, partially covered by `render-triage`.

## Cross-References

- `continuity-auditor`: style continuity across shots once locked.
- `render-triage`: when generated outputs drift, deciding whether the cause is style.
