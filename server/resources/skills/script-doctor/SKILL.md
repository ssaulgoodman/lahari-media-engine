---
name: script-doctor
description: Use when writing, refining, or critiquing a project's script — scene structure, shot beats, cast and environment assignments, pacing. Triggered by "write the script," "refine scene 3," "this script feels plot-heavy," "shot count is wrong," or when calling apply tools that take Codex-written script content. Grounded in the project's seed_kind, workflow_key, and preset_key.
---

# Script Doctor

A studio script is a production plan: reusable cast, reusable environments, scenes, and shots. It must hold together as a single arc and survive translation into images, storyboards, video clips, and the final render.

Before writing or critiquing, read the project mode from the packet or notebook:

- `seed_kind` — what the artist started with (`audio`, `script`, `brief`, `document`, `idea`)
- `workflow_key` — what production spine the project follows (`music_led`, `scripted_narrative`; later `campaign` / `short_form`)
- `preset_key` — taste/model/default prompt rules (`music_video_default`, `anime_default`, later more)

Do not assume lyrics, audio analysis, deity, temple, devotional context, or a queue unless the project mode says so.

## Source Contract

**Music-led workflow.** Scenes usually follow musical structure. Use lyrics, audio sections, rhythm, and meaning to decide scene boundaries and beat timing. If the song is meditative, let shots breathe. If it is narrative or performance-heavy, allow stronger progression and movement.

**Scripted narrative workflow.** Scenes follow the uploaded script, treatment, or episode brief. The anime preset is one taste/medium layer inside this workflow, not a separate planner. Preserve dialogue/action order unless the director asks for adaptation. Shots should clarify acting beats, reactions, reveals, action choreography, screen direction, and continuity.

**Brief/document/idea seeds.** First normalize the source into a production brief: premise, runtime target, scene list if available, cast, environments, constraints, and unanswered questions. Do not invent a full story change when the source only needs structuring.

## What a Script Has to Get Right

**Scene structure follows the source.** Audio projects map to musical sections. Scripted projects map to script scenes and action/dialogue beats. Brief-led projects need explicit assumptions called out before applying.

**Shot count per scene is bounded by duration.** In Seedance/storyboard mode, anchor around cohesive clips up to 15 seconds. Split anything longer than 15s into adjacent shots. Shorter scenes can use 4, 5, 6, 8, 10, or 12 seconds when that better fits the source beat. Standard/keyframe mode may use shorter clips when the selected video model or render plan requires it.

**Cast and environment assignments must reach every named entity.** If the source names a person, creature, object, or location that appears on screen, it needs a cast/environment entry or a deliberate reason to stay implicit. Dangling names create downstream confusion because look generation and references will not know what to render.

**Beats are visible and shootable.** Each shot's beat is the one thing that changes, expressed as something a camera or animation layout could show. "She realizes the truth" is not enough. "She stops mid-step, lowers the note, and looks back at the empty doorway" is renderable.

**Direction is protected.** When refining, preserve `direction` unless the artist explicitly changes the shot's meaning. Edit visual/motion/storyboard prompts freely; touch direction only when story intent changes.

## Duration And Surgical Edit Contract

When the artist asks to fix durations, pacing, or overly long scenes, treat it as pacing surgery, not a script rewrite. Preserve cast, environments, scene labels, timestamps, source excerpts, narrative descriptions, shot IDs, cast assignments, environment assignments, and shot meanings unless the artist explicitly asks to change story content.

Preferred workflow: edit `mirage/projects/<projectId>/script.md` with the harness file editor, then apply with `run_action(apply_script)` using markdown. Read `state/` files as canonical DB snapshots, but do not edit state. The script frontmatter carries `scriptFingerprint`; if apply returns `drift_detected`, refresh the notebook and reconcile before retrying.

Default Seedance/storyboard pacing:

- Aim for clips close to 15s when the source beat can hold one cohesive mini-sequence.
- Use 8-12s for quiet holds, acting beats, transitions, and moments that need breathing room.
- Use 4-8s for quick connective beats, reactions, action fragments, or scene endings.
- Never leave a shot above 15s. Split it into two or more adjacent shots with the same cast/environment unless the artist asks for a new subject or location.
- Scene shot durations must add up exactly to the scene duration.

If a duration fix requires changing shot count, say that plainly before applying: "I am splitting S2.3 into two adjacent shots; cast and environment stay the same." If your draft also changes cast, environments, scene meanings, or named characters, stop and call it a full-script rewrite instead of pretending it is duration-only.

## Workflow Calibration

For `music_led`, ask: does this beat follow the track, lyric, performance, rhythm, or emotional arc? Avoid unrelated plot that fights the song.

For `scripted_narrative`, ask: does this beat preserve the script's intent, character continuity, screen direction, and acting clarity? Avoid adding new plot turns, characters, or locations just because the scene feels sparse.

For future ad/reel workflows, ask: does this beat serve the offer, product promise, audience, and delivery format? Avoid cinematic filler that does not move the message.

## Anti-Patterns

- **Plot-heavy script on source material that wants stillness.** Every scene introduces a new event when the source wanted to dwell.
- **Shot list as camera jargon.** "Wide shot," "slow dolly," or "close-up" is not a beat by itself. Pair it with visible action or story information.
- **Cast described as roles, not individuals.** "A student" is weak. "Mina, sixteen, short black bob, oversized navy school blazer, guarded expression" can become a consistent reference.
- **Repeated wallpaper.** The same pose/location/action repeated with minor phrasing changes. The script should progress: emotion shifts, information changes, blocking changes, or the environment responds.
- **Generic fantasy/VFX as default.** Glowing particles, cosmic energy, abstract symbols, and magic fog flatten projects unless the source specifically calls for them.

## Refining vs Rewriting

**Surgical refines preserve references.** When the artist says "scene 4 needs more grief," edit scene 4's narrative and affected shots. Don't renumber, recast, or change scene boundaries unless asked.

**Rewrites can wipe downstream.** When the artist says "scrap this and start over," it may invalidate style, cast, environments, shot prompts, boards, and videos. Confirm before running anything with `force`.

**The source wins.** Uploaded scripts, audio structure, briefs, and director notes outrank generic storytelling instincts.

## When to Push Back

- **"Add more shots."** First ask why. If it means "fill the scene," fix pacing or source structure instead of adding noise.
- **"Make it more emotional."** Ask which emotion. Grief, awe, tenderness, dread, relief, embarrassment, and resolve translate to different blocking and timing.
- **"Make it more epic."** Ask what should become bigger: scale, stakes, motion, crowd, location, sound moment, or character choice. Generic spectacle is usually a downgrade.

## Cross-References

- Doctrine §4: script writing is harness-native; the apply tool validates content shape but Codex writes it.
- `storyboard-prompt-craft`: how a shot beat becomes a renderable storyboard prompt.
- `continuity-auditor`: when chained shots constrain how the next shot opens.
