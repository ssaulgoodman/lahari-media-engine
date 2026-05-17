---
name: script-doctor
description: Use when writing, refining, or critiquing a project's script — scene structure, shot beats, cast and environment assignments, pacing. Triggered by "write the script," "refine scene 3," "this script feels plot-heavy," "shot count is wrong," or when calling apply tools that take Codex-written script content. Grounded in the song's musical structure and the project's song type.
---

# Script Doctor

A Lahari script is a music video plan: scenes derived from the song's musical sections, shots within each scene, beats per shot. It must hold together as a single arc and survive translation into images and video without losing the song's emotional intent.

## What a Script Has to Get Right

**Scene structure follows musical structure.** If the song has verse / chorus / verse / bridge / chorus structure, scenes should map to those sections, not to a separate narrative the script invented. A 4-minute bhajan with 6 musical sections becomes ~6 scenes; never 12.

**Shot count per scene is bounded by duration.** In Seedance/storyboard mode, anchor pacing around 15-second clips unless the artist explicitly asks for faster cutting. Split anything longer than 15s into adjacent shots; for shorter scenes, use the closest natural duration under 15s. A 42-second scene usually becomes 3 shots (14 + 14 + 14), not 2 shots (21 + 21, too long) and not 6 shots (over-cut, won't read). A 22-second scene usually becomes 2 shots (11 + 11) or 3 only if the music clearly has three beats. Standard/keyframe mode may use shorter 4-8s clips when the selected video model or render plan requires it.

**Cast and environment assignments must reach every named entity.** If the script names "Shantamma" in the description, at least one shot must explicitly cast her. If the script names "the temple courtyard," at least one shot must place its action there. Dangling names create downstream confusion — the look-generation phase won't know what to render references for.

**Beats are visible and shootable.** Each shot's beat is the *one thing that changes* in that shot, expressed as something a camera could record. "Surrender" is not a beat. "She lowers her body to the stone, palms flat on the floor" is.

**Direction (the shot's creative intent) is preserved across edits.** When refining, keep `direction` even when rewriting `visual_prompt`. The direction is the artist's read on what this shot means; the visual prompt is one way to express it.

## Duration And Surgical Edit Contract

When the artist asks to fix durations, pacing, or overly long scenes, treat it as pacing surgery, not a script rewrite. Preserve cast, environments, scene labels, timestamps, lyrics, narrative descriptions, shot IDs, cast assignments, environment assignments, and shot meanings unless the artist explicitly asks to change story content.

Preferred workflow: edit `lahari/projects/<projectId>/drafts/script.md` with the harness file editor, then apply with `apply_script_markdown`. Read `mirrors/script.md` as the canonical DB snapshot, but do not edit mirrors. The draft frontmatter carries `scriptFingerprint`; if apply returns `drift_detected`, refresh the notebook and reconcile before retrying.

Default Seedance/storyboard pacing:

- Aim for clips close to 15s when the phrase can hold one cohesive idea.
- Use 8-12s for meditative holds, devotional gestures, and quiet transitions that cannot carry 15s.
- Use 4-8s only for quick connective beats, responses, or scene endings.
- Never leave a shot above 15s. Split it into two or more adjacent shots with the same cast/environment unless the artist asks for a new subject or location.
- Scene shot durations must add up exactly to the scene duration.

If a duration fix requires changing shot count, say that plainly before applying: "I am splitting S2.3 into two adjacent shots; cast and environment stay the same." If your draft also changes cast, environments, scene meanings, or named characters, stop and call it a full-script rewrite instead of pretending it is a duration edit.

## Song-Type Calibration

The script must respect what kind of song this is. Lahari classifies as `stotra`, `chant`, `bhajan`, `kirtan`, `song`, or `unknown`, with axes `isNarrative` and `isMeditative`.

**Meditative material wants stillness.** A stotra or meditative bhajan should NOT have:
- 2-3 second shots (over-cut, breaks the meditation)
- Multiple plot beats per scene (the song isn't telling a story; it's holding a feeling)
- Action sequences (a deity stepping forward, a devotee running — wrong register)

It should have:
- Longer shots (8-10s), letting moments breathe
- Recurring motifs (the same lamp, the same threshold, returning across scenes)
- Restraint — fewer cast, fewer environments, more time with each

**Narrative material can carry more.** A bhajan with story (`isNarrative: true`) can have:
- Scene-to-scene arc with rising and falling action
- Multiple cast members and environments
- Beats that build on each other

But narrative still doesn't mean Hollywood — devotional narrative is closer to oral tradition than to film. "She walks for many days; she arrives at the temple; she gives her last coin to the priest; she is recognized" is a complete narrative in four beats.

**Unknown / generic `song`** — default to restrained until evidence accumulates. Better to have a quiet script that the artist asks to lift than a busy one that has to be cut down.

## Anti-Patterns

- **Plot-heavy script on meditative material.** The single most common failure. Every scene introduces a new event when the song wanted to dwell.
- **Every shot a single deity portrait.** The deity is the *subject* of the devotion; the *visible* world is the devotee, the offering, the threshold, the lamp. Compose around the devotee's gesture, not the deity's face.
- **Cast described as roles, not individuals.** "An old woman" → useless for look-gen. "Shantamma, elderly Tamil grandmother, frail, warm eyes, hair tied back, faded green sari" → enough to generate a consistent reference.
- **Repeated devotional wallpaper.** Lamp shot, deity shot, devotee bowing, repeat. The script should have *progression* even when meditative — what we see in scene 5 should differ from scene 1 in some meaningful way (light shifting, devotee deeper into ritual, environment changing).
- **Generic temple fantasy.** "A sacred chamber filled with golden light" is the same failure mode as in storyboards. Be specific: which temple, which time of day, what's actually visible.

## Refining vs Rewriting

**Surgical refines preserve cast/scene references.** When the artist says "scene 4 needs more grief, less ceremony," edit scene 4's narrative and the affected shots' beats. Don't renumber, don't recast, don't change scene boundaries unless asked.

**Rewrites can wipe downstream.** When the artist says "scrap this and start over from a different angle," it's a rewrite — Lahari may fork the project so the previous script survives. Confirm before running anything that takes a `force` flag.

**Direction is the most-protected field.** It's the artist's intent. Edit `visual_prompt` and `motion_prompt` freely; touch `direction` only when the artist explicitly changes the shot's meaning.

## When to Push Back

- **"Add more shots."** First ask why. If it's "fill the scene," that's a sign the scene duration is wrong — fix the duration, not the shot count. If it's "the pacing feels slow," ask whether the song actually wants faster pacing or whether the artist is reacting to a render that's too still.
- **"Make it more emotional."** Generic note. Ask: emotional how? Grief? Tenderness? Awe? Resignation? Each translates to different shot composition and different shot durations.
- **"Add a deity descending."** This is the temple-fantasy reflex. Push back: what does the descent show that stillness wouldn't? Sometimes the answer is real; usually it's not.

## What This Skill Doesn't Cover

- Generating concept directions (that's an earlier phase, before script).
- Writing storyboard prompts from the script's shot beats — see `storyboard-prompt-craft`.
- Diagnosing a rendered video that doesn't match the script's intent — see `render-triage`.

## Cross-References

- Doctrine §4: script writing is harness-native; the apply tool validates content shape but Codex writes it.
- `storyboard-prompt-craft`: how a shot beat becomes a renderable storyboard prompt.
- `continuity-auditor`: when chained shots constrain how scene-N+1 opens.
