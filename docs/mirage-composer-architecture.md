# Mirage Composer Architecture — Revised Vision

Status: draft for Saul/Codex/Claude review.
Sibling to: `docs/mirage-composer-audit.md` (which is the tactical trim work).
Companion: `docs/mirage-agent-surface-redesign.md` §8 covers the apply vs override distinction.

This doc proposes the destination shape for the composer + presets + override architecture, after the tactical audit trims are done. It is the strategic answer to "what should the composer be FOR."

## How We Got Here

This doc is the destination, but Codex should see the reasoning path that led to it. The thinking unfolded across a conversation, not in one shot. Each step changed what we thought the architecture had to be.

**Step 1 — The trigger question.** Saul asked: `workflowContext` is one sentence shared across 12 prompt builders. If it's not doing work, why is it a category? That cracked open a bigger question: what's the composer actually FOR? Categories should be where genuinely different inputs flow. A category that always renders the same one-sentence string isn't a category — it's a vestigial constant. From there the question became: which other "categories" in the composer are vestigial?

**Step 2 — The image-model vs text-model distinction.** When we looked at where presetTaste rules actually flow, two downstream consumers showed up:

- **Image models** (Nano Banana, Gemini-image, Seedance) — context-blind. Each call is independent. They have no project state, no conversation history. If the prompt doesn't say "anime, no photoreal," they might render photoreal.
- **Text models** (Claude, Gemini-3-pro, GPT-5.5) doing concept/script/shot-prompt writing — fully capable LLMs. They know what anime is, what music videos are, what scripted narrative pacing looks like.

The current composer treats both consumers the same — pumps presetTaste, userNotePolicy, workflowContext into every prompt. That's belt-and-braces. For text models, it's mostly **redundant common knowledge being explained back to a model that already knows it**. For image models, it's genuinely needed.

This distinction is what unlocks the rest of the architecture. It says: presets earn their tokens for image generation; they don't earn them for text generation.

**Step 3 — The Codex-as-third-consumer realization.** Then we layered in a third consumer: **Codex itself**, when it's the agent driving the project. Codex IS an LLM, with conversation context, project state access, and tool dispatch. When Codex is writing the storyboard prompt to ship as `promptOverride`, the composer doesn't need to lecture Codex about user-note policy — Codex has already read the user note from chat. The composer talking back to Codex is the model talking to itself through the composer.

This forces a three-way split: composer-as-plumbing for Codex (who handles taste himself), composer-with-minimal-taste for image models (who need explicit guards), composer-as-it-is-today for the legacy web-button path (where neither Codex nor anyone else translates artist intent).

**Step 4 — Where Claude was wrong, and the correction.** Initial draft: "userNote stays, userNotePolicy goes." Saul caught it: user note is for Codex to consume, not for Nano Banana. When the artist says "make it darker," Codex's job is to TRANSLATE that into concrete visual instructions ("low-key lighting, shadows dominate, single backlit subject") and ship the concrete prompt to the image model. The image model should never see "make it darker" — it should see the translated final prompt.

This changed the model: user note doesn't belong in image prompts at all. It might still flow into legacy text-gen prompts where there's no Codex translator, but in the agentic flow Codex handles it directly. **The correction matters as much as the conclusion.** It's why the architecture splits user-note handling by path (agentic / legacy / image), not by section.

**Step 5 — Saul's dream-flow as the framing test.** Saul described what the artist experience should be:

> "I come in and say I want to produce anime, I want it in the style of Ilya Pushkin. Then Codex asks 'do you have a concept or script or something?' I say I want to make an episode about an AI companion of a 12-year-old boy suddenly getting conscious — wakes up for the first time in human recorded history. Then it knows the workflow from the usual pipeline. Brainstorm the script, then consolidate style — maybe I provide images and it adds them, then offers to write the style description, I confirm and move on. Characters and looks visualized. So on and so forth."

This is the architecture's test case. The composer needs to support:
- Codex orchestrating without preset enum selection at intake
- Style emerging from artist's stated intent + (optional) reference images, captured as project.styleDescription text + style asset
- Special-vocabulary asks ("Ilya Pushkin style") served by skill files that load contextually
- Codex composing prompts itself when it has specific intent, using `promptOverride`
- Composer assembling defaults otherwise — but the defaults are leaner because Codex doesn't need preachy rules

If the architecture supports this flow cleanly, it's right. If parts of it require workflow enum selection or preset-driven taste rules that contradict the artist's stated direction, it's wrong.

**Step 6 — Why not just patch the current composer.** A reasonable pushback is: do an aggressive trim of the current prompts (the audit's C1-C5) and call it done. But that path keeps the composer doing three jobs (assemble state, dispense taste, enforce meta-policy) when only one of them — assembling state — is irreducible. Trim-only leaves us with a smaller version of the same confused architecture. The doc proposes that the destination is fewer responsibilities, not the same responsibilities with less prose. The trim work in the audit is sequenced steps toward this destination, not an alternative to it.

**What landed.** The roles separation (composer = plumbing, Codex = director, skills = vocabulary, downstream models = workers) plus the template/DB layer map are the doc's two structural contributions. Everything else flows from "what's each consumer's actual need" once we stop treating image models, text models, and Codex as one undifferentiated audience.

## Diagnosis (brief)

The composer today is confused about who its audience is.

It pumps `presetTaste`, `userNotePolicy`, `workflowContext`, and meta-instructions into every prompt as if every consumer is a context-blind image model needing belt-and-braces guidance. But the actual consumers are mixed:

- **Image models** (Nano Banana, Gemini-image, Seedance) — context-blind. Need explicit medium guards and concrete visual instructions.
- **Text models in the legacy web path** (Claude/Gemini called server-side when the artist clicks "generate" in the UI) — capable of interpreting nuance, but no agent in the loop, so they need some rules and the user note.
- **Codex in the agentic path** — fully capable LLM with conversation context, project state, and tool access. Doesn't need to be lectured at via composer.

Today we treat all three the same. That's the bloat source.

## The revised model

### Roles, clearly separated

**Composer = context-bundler.** Takes project state (style ref, character refs, env refs, scene/shot data, audio plan) and assembles the right slice per action. Knows the SHAPE of what each downstream consumer needs. **No rules. No taste lectures. No meta-policy.**

**Codex = director.** Reads project state via cockpit (`open_project`, `get_project_state`). Decides what to do. Either lets the composer assemble defaults OR composes prompts itself and ships via `promptOverride`. Reads artist's chat directly — never needs the user note pasted back to it through the composer.

**Skills = special-case knowledge loaders.** "Ilya Kuvshinov style", "vintage anime cels", "solarpunk lighting", "music-video pacing for ambient tracks" — load contextually when relevant. Not always-on overhead in every prompt.

**Downstream models:**
- Image models receive only final concrete prompts. No raw user notes — Codex translates intent into concrete visual language before the image model sees anything.
- Text models in the legacy web path receive prompts with minimal taste anchoring + user note (because there's no Codex translator). This path shrinks as the agentic path takes over.

### Presets shrink to a clearer purpose

Today `PIPELINE_PRESETS` is a fat config carrying source.rules, concept.rules, script.rules, style.rules, looks.rules, studio.rules, audio.rules — all of which get injected into prompts as taste.

In the revised model, presets are just:

1. **Defaults**: `image_model`, `video_model`, `aspect_ratio`, `pacing`, `text_provider`. These are config, never injected into prompt text.
2. **Intake starter**: when artist picks "anime" at project creation, `project.styleDescription` gets seeded with anime starter text. After intake, the preset enum stops mattering. `project.styleDescription` is the runtime anchor.

That's it. Presets are no longer a runtime prompt-rendering thing. They're a one-time intake convenience plus model defaults.

### Image-gen invariants move from preset to action handler

"No text in panels" / "no captions/speech bubbles" / "thin borders OK" are not anime-specific or music-video-specific — they're storyboard invariants. They belong in the `generate_storyboard` handler's constant string, not in `preset.studio.storyboardRules`.

Same for character look generation: "neutral pose, no scene-specific action" is a `generate_character_candidates` invariant, not a preset rule.

This makes the action handlers honest carriers of their own irreducible image-model guidance. Presets get out of the way.

### How the user note flows

| Path | User note destination | Why |
|---|---|---|
| Agentic (Codex driving) | Codex reads it from chat context | Codex IS the LLM; doesn't need it pasted back |
| Codex calling an image action | Codex translates intent to concrete prompt, ships via `promptOverride` | Image model sees only the final concrete prompt, never the raw nudge |
| Legacy web button | Composer includes it in the prompt to Claude/Gemini | No agent in the loop; text model needs the raw note + minimal taste |

The "userNotePolicy" 5-line meta-instruction (in 6 prompt files) goes away entirely. Text models can interpret "user said X, treat as constraint" without ceremony.

## Template vs DB Layer Map

What lives where, and how each thing gets modified. This is the "get down to the weeds" view.

### Three layers, four modification paths

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1: CODE TEMPLATES                                    │
│  (server/prompts/*.ts, action handler constants, skill .md) │
│  Modified via: code commits                                 │
└─────────────────────────────────────────────────────────────┘
                            ↓ (composer reads + assembles)
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2: PROJECT-SCOPED OVERRIDES                          │
│  (project_prompt_overrides table)                           │
│  Modified via: apply_project_prompt_override                │
└─────────────────────────────────────────────────────────────┘
                            ↓ (composer reads + injects)
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3: PROJECT DATA                                      │
│  (concept text, script JSON, style description, refs, etc.) │
│  Modified via: apply_concept, apply_script, ...             │
└─────────────────────────────────────────────────────────────┘
                            ↓ (composer reads + injects)
┌─────────────────────────────────────────────────────────────┐
│  LAYER 4: PER-CALL INPUT                                    │
│  (user note, promptOverride, modelOverride)                 │
│  Modified via: run_action / start_job input fields          │
└─────────────────────────────────────────────────────────────┘
                            ↓ (composer reads OR Codex overrides)

                       FINAL PROMPT
                            ↓
                   DOWNSTREAM MODEL
```

### Concrete per-concept mapping

For "concept":

| Thing | Layer | Where stored | Modified via | Example |
|---|---|---|---|---|
| Core task template for generate-concept | Layer 1 (code) | `server/prompts/concept.ts` `GENERATE_CORE_TASK` | code commit | "Propose creative narrative directions for this project. Each direction is one coherent idea..." |
| Concept project override | Layer 2 (DB) | `project_prompt_overrides` table, kind='concept' | `apply_project_prompt_override({kind:'concept'})` | (currently dead — Pattern 7 in audit) |
| The actual locked concept | Layer 3 (DB) | `projects.locked_concept` column | `apply_concept({concept})` | "A solarpunk love story set in Mumbai monsoon. Premise..." |
| Per-call user note | Layer 4 (call) | not stored; in the request | `run_action({input: {userNote: "..."}})` | "make it more grounded, less metaphysical" |

For "style":

| Thing | Layer | Where stored | Modified via | Example |
|---|---|---|---|---|
| Style brainstorm core task | Layer 1 | `server/prompts/styleBrainstorm.ts` | code commit | "Generate 4 distinct style directions..." |
| Style image-gen invariants | Layer 1 (after migration) | `generate_style_candidates` handler constants | code commit | "No text or watermarks. No collage. One coherent style frame per candidate." |
| Style project override | Layer 2 | `project_prompt_overrides`, kind='style' (not declared today; would be added with C5) | `apply_project_prompt_override({kind:'style'})` | "for this project, prefer harsh high-contrast graphic looks" |
| Style description text | Layer 3 | `projects.style_description` column | `apply_style_direction({description})` | "Vintage anime cels, soft watercolor textures, pastel palette" |
| Style reference asset | Layer 3 | `assets` table, locked via `projects.style_asset_id` | `apply_style_direction({sourceAssetId})` OR upload+lock | (image URL) |
| Per-call style override | Layer 4 | not stored | `run_action({input: {promptOverride: "..."}})` | "for this one generation, ignore the locked style and try noir" |

For "shot prompts":

| Thing | Layer | Where stored | Modified via | Example |
|---|---|---|---|---|
| Shot prompts core task + GOOD/BAD examples | Layer 1 | `server/prompts/shotPrompts.ts` | code commit | "You are an art director / shot writer..." + examples |
| Shot prompts project override | Layer 2 | `project_prompt_overrides`, kind='shot_prompts' | `apply_project_prompt_override({kind:'shot_prompts'})` | (currently dead — Pattern 7) |
| Saved visualPrompt / motionPrompt per shot | Layer 3 | `shots.visual_prompt`, `shots.motion_prompt` columns | `apply_shot_prompts({shots: [{shotId, visualPrompt, motionPrompt}]})` | "Medium side shot: Mina stops at the classroom doorway..." |
| Per-call shot generation override | Layer 4 | not stored | `run_action({input: {promptOverride: "..."}})` | (one-shot experiment with a different motion phrasing) |

### What the composer does given these layers

For a given action (say `generate_storyboard` for shotId X):

1. **Code template (Layer 1):** composer pulls the slim core-task constant for storyboard generation.
2. **Project override (Layer 2):** composer reads `getProjectPromptOverride(projectId, 'storyboard')`. If present, injects it as a new `PROJECT OVERRIDE` section (the C5 fix from the audit).
3. **Project data (Layer 3):** composer reads `project.style_asset_id`, char ref URLs for cast in this shot, env ref URL, the storyboard prompt text saved on the shot, the cut plan. Assembles them as `INPUTS`.
4. **Per-call input (Layer 4):** if Codex shipped `promptOverride`, composer is bypassed entirely. If Codex shipped just a `note`, server-side handler appends it. If Codex shipped nothing extra, just the default.

The composer never injects taste rules, never injects userNotePolicy, never injects workflowContext. It assembles state + (optional) project override + (optional) per-call input. Codex (or the legacy web caller) decides whether to trust the default or override.

## Migration: how to get from here to there

This is sequenced. Each step is independently shippable.

### Step 1: Drop the dead sections from the composer (tactical, low risk)

- `workflowContext` → removed entirely. `workflowContextFor()` deleted.
- `userNotePolicy` → removed entirely. The 6 per-file restatements deleted.
- All `composePromptParts` consumers updated to stop passing these.

Cost: ~10 files touched. Token savings: ~50-100 tokens per call.

Risk: low. We're removing redundant restatements; the rules are already implicit in inputs + presetTaste.

### Step 2: Move image-gen invariants from preset to action handler

- Take `preset.studio.storyboardRules` ("no text in panels...") and inline it as a constant in the storyboard action handler that gets appended to the image prompt server-side, post-composer.
- Same for `preset.looks.qualityRules`, `preset.style.rules` image-side bits.
- Presets shrink: `style.rules`, `looks.qualityRules`, `studio.*Rules` removed.

Cost: action handlers grow slightly; presets shrink significantly.
Token savings: prompts no longer carry full anime doctrine when not needed.

### Step 3: Drop presetTaste from text-gen prompts (the bigger architectural call)

- `concept.ts`, `planScenes.ts`, `refineScript.ts`, `shotPrompts.ts`, `styleBrainstorm.ts`, `audioPlan.ts` stop passing `presetTaste`.
- The text model receives: core task + inputs + (optional override) + (optional user note in legacy path).
- Project's own `style_description` text becomes the runtime taste anchor (it's already in inputs).

Cost: meaningful shift. Need to verify that text models still produce good output without preset rules.
Risk: medium. Could cause drift over long projects. Mitigation: ensure project.styleDescription is the anchor and Codex always includes it in inputs.

### Step 4: Wire project overrides as first-class composer section (Pattern 7 C5 from audit)

- Composer gets new `projectOverride?: string` field. New `PROJECT OVERRIDE` section header.
- All prompt builders call `getProjectPromptOverride(projectId, kind)` and pass through.
- All 8 declared override kinds now actually flow.

Cost: 6 prompt builders gain one new read call.
Risk: low.

### Step 5: Skill mechanism for special-case vocabulary

- Define how Codex loads a skill like "ilya-kuvshinov-style" or "vintage-anime-cels".
- Skills carry domain-specific vocabulary that Codex uses when composing prompts.
- Not part of the composer — they're Codex-side context.

Cost: depends on whether the Codex harness already supports skill loading at action-call time, or whether we need a new mechanism.

### Step 6: Reduce preset enum to defaults + intake starter only

- `PIPELINE_PRESETS` shrinks dramatically. Only `defaults` (model/aspect/pacing) and an optional `intakeStarter.styleDescription` text remain.
- All `rules` fields removed (they've been moved to action handlers or made the artist's `project.styleDescription` responsibility).

Cost: presets.ts shrinks from ~300 lines to ~50 lines.
Risk: low if steps 1-5 are done first.

## Open questions for Saul and Codex

The questions that need verdicts before any of these steps land:

1. **Is the role separation (composer = plumbing, Codex = director, skills = vocabulary) actually right?** Or does Codex disagree on where some responsibility should land?

2. **Step 3 (drop presetTaste from text-gen) — too aggressive?** This is the architectural bet. Codex's audit didn't go this far; my analysis suggests it's the right destination. Need Codex's read on whether text models drift without the preset anchor.

3. **What is the legacy web path's actual use today?** If the artist still uses "Generate concepts" / "Generate style" buttons in Visual Studio, those go through the composer with no Codex translator. We need to decide:
   - Keep the legacy path with minimal taste (so artists can still drive without an agent)
   - OR fully deprecate it, requiring agentic flow for generation
   - OR something in between (UI still has buttons, but they invoke the agent under the hood)

4. **Skill loading mechanism** — does the Codex harness support per-session skill loading we can trigger from an action? If not, we'd need a thinner version (Codex reads a project notes file that points to relevant skill keywords).

5. **How does Codex know when to use `promptOverride` vs accept the default?** Today the default does a lot of work and Codex needs to override often to escape ceremony. After steps 1-3 the default does less, so Codex can trust the default more often. Worth a skill-instruction update.

6. **Pattern 7 — Option A still right?** Wire all 8 override kinds vs narrow to 2. After this architecture lands, Option A clearly wins because the override mechanism is the artist's per-project taste shaping path that the architecture relies on.

7. **`project.styleDescription` as the anchor** — does it carry enough? Today it's a short paragraph. If it becomes the canonical taste text after preset.rules go away, it might need to grow. Does that mean we add a richer style notes field? Or are we trusting Codex + the style image + the description text together?

## How to review this doc

Same flow as the agent surface redesign and tool audit:

1. **Saul reads top-to-bottom.** Marks calls inline. Sends back hot takes on the questions.
2. **Codex annotates.** Adds disagreements as italicized `> _Codex: ..._` notes under the section they apply to. Doesn't rewrite Claude's sections.
3. **Claude folds in disagreements, drafts the migration plan in more detail** once direction is clear.
4. **Then** the audit's C1-C5 tactical work executes against the agreed direction.

The audit doc (`docs/mirage-composer-audit.md`) is for the trim execution. This doc is for the direction.

---

## Claude's summary opinion

The current composer is doing three jobs and most of them aren't actually working:

- It assembles state ✅ (real value, keep)
- It dispenses taste rules ⚠️ (mostly redundant for capable LLMs, real value for context-blind image models — split)
- It enforces meta-policy ❌ (lectures the model about how to handle conflicts; downstream models can interpret without)

The destination is: composer-as-plumbing, taste-as-project-data (style description + style image), skills-as-special-vocabulary, Codex-as-director-with-promptOverride-when-needed.

Presets stop being a runtime prompt thing and become a thin intake + defaults config.

This is the architecture that makes Mirage a real general-purpose agent-driven video maker, the way you described: artist gives intent → Codex orchestrates → tools execute → result.
