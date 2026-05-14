---
name: style-ref-critic
description: Use when selecting, locking, or critiquing the style reference for a project — preset picks, style brainstorming critique, deciding whether a generated style is reusable downstream, refining style direction. Triggered by "which style preset fits this song," "is this style ref reusable," "the style is drifting," or before locking a style asset.
---

# Style Ref Critic

The locked style image is the visual contract for the entire video. Every downstream generation — character looks, environment looks, storyboards, frames, videos — consumes it as a reference. If the style is wrong, everything downstream inherits the wrongness.

## What "Style" Means in Lahari

A style is a **reusable visual system**, not a specific image. Properties of a good style:
- Coherent medium (painterly miniature, photographic, illustrated, woodcut, etc.)
- Coherent palette (warm earth + lamplight, or cool stone + moonlight, etc.)
- Coherent lighting register (golden hour, indoor-lamp, midday, etc.)
- Coherent texture (high-detail, flat, grainy, etc.)
- Coherent reference tradition (Indian miniature, Renaissance fresco, contemporary photography, etc.)

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

**Presets (curated, ground-truth):** Lahari ships style presets that are already known to work for bhakti/devotional projects. When the song fits one of these registers (warm temple, cool sacred river, golden serenity, etc.), lock the preset directly. No brainstorm needed. Saul's existing workflow has shifted in this direction — most projects should pick a preset.

**Brainstorm directions:** Use when no preset matches the song's register. Brainstorming should produce 3-4 genuinely different directions (different medium, different palette, different reference tradition), not 4 variations of the same direction.

**Visualizing a direction:** The visualize step produces a reusable style frame. It is NOT a scene from the video. Anti-pattern: the visualization shows the song's main character in a key moment — that's a poster, not a style. Re-prompt to remove subject specificity.

## Anti-Patterns in Style Selection

- **Locking a beautiful one-off image as "style."** It's too specific. Every downstream shot will try to mimic the composition.
- **Locking a portrait of the main deity as "style."** Same problem — every shot becomes a portrait.
- **Generic temple fantasy as default.** "Glowing sanctum, divine light, golden particles" — produces the same look across every project, removes the song's specific identity.
- **Cool palette on warm material.** A teal-and-blue style ref on a love-toned bhajan creates emotional discord the artist will feel without being able to name.
- **High-stylization on documentary material.** If the song is about a real saint's life and tradition, miniature stylization may feel false; restrained photography may serve better.

## Cultural Authenticity (Bhakti-Specific)

Devotional/bhakti style critique has extra layers:

- **Avoid generic "Indian temple aesthetic."** Most stock-trained outputs lean toward generic gold-and-saffron temple imagery. Push toward specific traditions: South Indian Chola bronzes, North Indian Pahari miniatures, Bengal Patachitra, Tamil Nadu Tanjore painting, etc., when the song's tradition supports it.
- **Avoid Hollywood-VFX divinity.** Floating petals, rays of light bursting from deities, glowing auras — these are visual templates from Western fantasy/superhero film. A devotional video should use cultural visual languages, not VFX shorthand.
- **Respect the song's tradition.** A Carnatic kriti and a North Indian bhajan come from different visual traditions. The style ref should signal which one.

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
- **"Make it more golden / more divine / more glowy."** These are anti-patterns trending toward temple fantasy. Ask what the song is actually about and what visual register matches.
- **"Use a Renaissance look for this bhakti song."** Sometimes the right answer; usually a sign the artist hasn't thought through cultural authenticity. Ask first.

## What This Skill Doesn't Cover

- Writing the style brainstorm or visualization prompts themselves — those are text-writing operations that move to R28 apply-only when ready.
- Image-gen tool calls for style visualization — that's a tier-2 tool call.
- Critiquing generated character/environment look references (which are style-consuming, not style-defining) — that's its own kind of triage, partially covered by `render-triage`.

## Cross-References

- `continuity-auditor`: style continuity across shots once locked.
- `render-triage`: when generated outputs drift, deciding whether the cause is style.
- Doctrine §4: visualization is image-gen (tool call); selection and refinement direction are taste (this skill).
