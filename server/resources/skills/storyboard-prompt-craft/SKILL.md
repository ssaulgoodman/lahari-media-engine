---
name: storyboard-prompt-craft
description: Use when writing or rewriting a shot's storyboard prompt and cut plan. Triggered by tasks like "write the storyboard prompt for shot X," "rewrite this storyboard to feel more intimate," "fix this storyboard prompt that's too cinematic," or when calling apply tools that take Codex-written storyboard prompt content. Anchored to renderable image-gen output, not film-school language.
---

# Storyboard Prompt Craft

You are writing a prompt that an image model will turn into a multi-panel storyboard. The model sees text. It does not see "dolly in" or "rack focus." It does not understand cinematography vocabulary. It understands subjects, actions, composition words, lighting words, and medium words.

## Core Rules

**The prompt describes images, not films.** Panels are static. Action happens *between* panels, captured at decisive moments. If you write "the camera slowly pans across the temple," you've written film grammar that image models will misinterpret or ignore.

**Per-panel actions live inside the prompt, not as a separate bullet list.** Image models follow narrative prompts better than parsed lists. "Panel 1 — Shantamma kneels at the threshold, palms pressed together. Panel 2 — close on her face, eyes closed, tears tracing the lines below her cheekbones. Panel 3 — the lamp she lit flickers as she rises, still holding the flame's warmth in her cupped palms." Inline beats Saul's existing instinct.

**Panels read left-to-right, then top-to-bottom.** For a 4-panel board: top-left, top-right, bottom-left, bottom-right. For a 3-panel board: left, middle, right. Never assume a different reading order.

**Do not ask for visible panel numbers, captions, arrows, labels, or readable text.** Storyboard image models will render those literally as graphic elements, which makes the board look like a teaching diagram instead of a film board. Thin panel borders are acceptable; the model uses them to separate panels.

**Cut plan is separate from storyboard prompt.** The storyboard prompt is for the image model; the cut plan is text guidance for the video model when it animates from the board. Cut plan can be empty (Seedance will rely on board order alone). When you write cut plan, write per-panel beats: "Panel 1 — slow lean forward, breath visible. Panel 2 — sudden recognition, head lifts. Panel 3 — exhale, smile breaking through."

## What Makes a Good Storyboard Prompt

**Concrete actions, not interior feelings.** "She lowers her body to the stone" is shootable. "Her surrender pours out of her" is interior — the model can't render it.

**One emotional beat per board, not three.** A storyboard captures a moment, not an arc. If three things happen, that's three shots, not one storyboard.

**Specific subjects, not generic types.** "Shantamma, elderly Tamil grandmother, gray hair tied back, wearing a faded cotton sari" — the model uses identity refs anyway, but the textual grounding helps. "An old woman" is too generic.

**Medium language anchored to the locked style.** If the project's style is a painterly miniature, the storyboard should read as panels of that miniature — not as cinematic frames with painterly tint. The planner now sees the locked style ref directly (since 2026-05-12 fix), so describe the medium consistent with what the artist locked.

**Tight length.** Storyboard prompts over ~3-4k characters degrade. The image model loses the through-line. If the prompt grows past that, you're describing too much detail per panel — compress.

## Anti-Patterns

These will make storyboard quality fall off a cliff. Avoid in every prompt.

**Cinematic vocabulary that image models don't understand.**
- ❌ "dolly in," "rack focus," "match cut," "60mm lens," "shallow depth of field"
- ✅ "close on her face, hands soft-focused in foreground"

**Generic temple fantasy.**
- ❌ "a glowing sanctum filled with golden light"
- ❌ "a sacred space with floating petals"
- ✅ "the threshold of a stone shrine, oil lamps in clay holders, the air thick with sandalwood smoke"

**VFX vocabulary on a non-VFX project.**
- ❌ "she dissolves into golden particles"
- ❌ "rays of divine light burst from her chest"
- ✅ "she stands very still, the lamps doubled in her wet eyes"

**Inventing characters or props the project doesn't have.**
- ❌ "a young priest watches from the corner" (when no young priest is in cast)
- ❌ "an ornate carved door swings open" (when the environment hasn't established that door)
- ✅ stick to the cast and environments the script defined

**Every panel a single deity portrait.**
- ❌ four panels of Ganesha at different angles
- ✅ three panels building action, one panel that resolves it (or vice versa)

**Symmetry shortcuts.** Four perfectly framed centered compositions look like a teaching poster, not a board. Vary composition deliberately.

## Refining vs Rewriting

**Surgical refines preserve everything except the artist's stated edit.** If the artist says "make panel 3 closer," touch only panel 3's framing words. Don't rewrite panels 1-2-4 to "match the new mood."

**Rewrites reset the whole board.** If the artist asks for a fundamentally different beat ("scrap this, the shot is about loss, not blessing"), throw the existing prompt away and start from the scene narrative.

When in doubt, ask: "Surgical edit to panel N, or full rewrite of the shot?"

## When to Tell the Artist No

- If the asked-for prompt requires inventing characters the project doesn't have, say so and propose adding to cast first.
- If the asked-for beat requires more panels than the storyboard format supports (3 or 4), say so and suggest splitting the shot.
- If the artist's instruction would produce a generic temple-fantasy result on a project that's been carefully grounded, push back gently before writing.

## What This Skill Doesn't Cover

- Image generation itself — that's a tool call. This skill only writes the text the tool consumes.
- Refining the *image* after generation — that's the `refine_storyboard_image` tool path (image-gen, takes prompt + image + feedback). The skill here is about writing prompts, not iterating boards visually.

## Also Covers: Motion Prompts (Keyframe-Mode Video)

The same rubric applies to motion prompts (the `motion_prompt` field used by Veo and keyframe-mode video gen). A motion prompt is one sentence to a short paragraph describing what changes from the start frame — same "describe action, not film grammar," same "concrete over interior," same anti-cinematic-vocab discipline.

The differences:
- Motion prompts are shorter (typically 100-400 chars, hard cap 2000) because the video model uses the start frame to anchor everything else.
- Motion prompts describe motion *over time*, not panel-by-panel. "She lowers her body to the stone over the first second, then exhales, eyes closing" — temporal beats inside one continuous shot.
- No panel ordering, no panel borders, no per-panel actions. The shot is one continuous take.

When R28's `apply_video_prompt` ships, this is the rubric Codex follows. There is no separate `video-prompt-craft` shard — motion prompts and storyboard panel actions share enough that one skill covers both.

## Cross-References

- Doctrine §4 (harness-native text generation): why this skill exists rather than backend AI calls
- `script-doctor`: when refining a storyboard requires rethinking the shot's beat
- `continuity-auditor`: when storyboard composition has to honor prev_shot continuity
- `style-ref-critic`: when storyboard medium needs to match locked style
