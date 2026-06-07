# Mirage Workflow Recipes

Status: design + slice plan. Cornerstone for the repeatable-production-format path. Yapper is case #1.

Related: `docs/mirage-agent-surface-redesign.md` (the layered surface), `docs/agent-working-method.md` (harvest-don't-author), `docs/mirage-platform-v1-ledger.md` (work log).

## Why this exists (the discovery)

A native-dialogue Yapper clip succeeded and failed with the **same route, same keyframe, same Veo 3.1, same `generate_audio: true`, same 8s, no extra refs.** The only difference was the **main prompt wording.** Performance-framed wording passed; audio-instruction-framed wording got policy-blocked (in both Telugu and English).

The lesson: for a repeatable production format, the **prompt wrapper is the decisive, risky part**, and letting the agent re-compose it every shot produces moderation-sensitive, variable phrasing. So we **freeze the wrapper and vary only the safe parts.**

## The responsibility split (the rule)

| Concern | Owner |
|---|---|
| Dialogue | **Data** — the audio plan / shot lines |
| References / context | **`contextOverrides`** — refs only, never dialogue |
| Format wrapper (the prompt skeleton) | **Workflow recipe** — frozen, reused |
| Per-shot nuance (pace, performance, ending, voice-change decision, model) | **Agent judgment** — fill slots, make calls |
| One-off exact prompt | **`promptOverride`** — last-mile escape hatch |

The agent's job shrinks from "compose the whole prompt" to "**fill slots + make the few real calls.**" Safer (it can't reintroduce blocked phrasing) and more reliable (every clip uses the proven wrapper).

## Positive framing rule (native-dialogue video)

> Write dialogue as a **visible performance**, not an audio instruction. The speaker is *already speaking, lips moving to deliver* the line as spoken text. You're describing what's on screen — not telling the model to "synchronize audio."

This is *why* the working prompt worked, and it generalizes. We teach this **affirmative pattern**, never a list of words to avoid — a blocklist overfits to the two prompts we happened to see and is brittle.

## Three layers (one owner each)

- **Skill** (plugin-owned, general craft): teaches *"for a repeatable format, discover it with `list_workflows`, apply it with `apply_project_workflow`, then fill the recipe's slots — don't re-author the wrapper."* Cross-project. No format specifics live here.
- **Workflow recipe** (server resource): the named, canonical format (Yapper; later Bhakti micro-drama, music video). **The single home for the template + defaults.**
- **Project recipe** (project data): what gets *written into a project* when a workflow is applied — the prompt override(s) + preferences. Re-read per shot; survives compaction because it's project data, not memory.

## Architecture (reuses existing patterns — additive)

- A workflow recipe is a **server resource**: `server/resources/workflows/<name>.json`, version-controlled and single-source, exactly like skills and action specs.
- **Two thin actions:**
  - `list_workflows()` → `[{ name, label, description }]` so the agent/artist can discover and the agent can route an "apply yapper" request.
  - `apply_project_workflow({ projectId, name })` → loads the named recipe and applies it: **reuses `apply_project_prompt_override` under the hood** to write the template into the project, plus real preferences and the format invariants (as durable workflow notes). Returns a receipt confirming what was set and the *"fill slots per shot"* guidance.
- The result is **project-scoped** (lands in `config/prompts/video.md` + `config/preferences.json`). The agent reads it per shot. No new override mechanism — the workflow just supplies the canonical body.

### Slot-fill happens engine-side (recommended)

The recipe template keeps `{dialogue}` as a slot. At `generate_video` time, the **composer (`videoGeneration.ts`) fills `{dialogue}` from the shot's audio-plan line** and the agent supplies `{pace}`/`{performance}`/`{ending}` as inputs. The dangerous wrapper never passes through the agent's free text — the engine owns the merge. (Alternative: agent assembles and passes a full `promptOverride` per call — simpler but lets the agent touch the wrapper. Prefer engine-side.)

### Three kinds of recipe content — don't confuse them

- **Template** → written to the project prompt override.
- **Preferences** → only *real* project preference fields (e.g. `videoModel`). Never invent a field. If it isn't already in the project schema, it isn't a preference — so `generateAudio`/native-audio is **not** a preference.
- **Format invariants** → per-call behaviors that are *always* true for the format (native audio on, native→voice-change). They are not project state and not per-shot judgment. They must live as **durable, re-read recipe instructions** (the project's workflow notes), so a compaction can't drop them — or, better, the **engine applies them from the recipe** at `generate_video` time, the same way it fills `{dialogue}`. Engine-applied invariants are "works every time"; agent-remembered ones are "usually."

## First recipe: Yapper

Format: vertical podcast monologue, native dialogue, talking head.

`server/resources/workflows/yapper.json` → `applies.promptOverrides.video` (derived from the known-good test prompt; refine against more runs):

```
A fast-paced medium close-up video of the speaker from the provided image.
From the very first frame the speaker looks directly into the lens and is
already speaking {pace}. Their lips move energetically to deliver this
{language} dialogue: "{dialogue}". They perform with {performance}. Immediately
after the final word they settle into {ending}. Keep the podcast studio
background, wardrobe, and vertical framing from the start frame steady throughout.
```

- **Filled from data:** `{dialogue}` (audio plan), `{language}` (project config).
- **Filled by agent judgment:** `{pace}`, `{performance}`, `{ending}`.
- **Preferences (real fields only):** `videoModel: veo-3.1`. Native audio is **not** a preference — see below.
- **Format invariants (always, not judgment):** native audio **on** — passed per call as the *real* `generate_video` arg (the passing test used `generate_audio: true`); and native dialogue first → `voice_change_video` if the native voice ≠ the assigned cast voice (not TTS). These live as durable workflow notes / engine-applied, never agent-remembered.
- Identity is **not** a slot — "the speaker from the provided image" leans on the keyframe; no restating appearance.

## Slices

**Prereq — must land first:** keyframe video gen must read the **project** video prompt override. Today `videoGeneration.ts` honors only the per-call `promptOverride` and `shot.motion_prompt`; the stored project recipe is wired into storyboard mode, not keyframe. Yapper is keyframe mode, so without this the applied recipe is never used. Wire the project video override (with engine-side `{dialogue}` fill) into the keyframe composer.

**Slice 1 — the mechanism:**
- `server/resources/workflows/` resource type + `yapper.json`.
- `list_workflows` + `apply_project_workflow` actions (apply reuses `apply_project_prompt_override`).
- A durable home for the recipe's **format invariants** (native audio on, native→voice-change) — workflow notes the agent re-reads, or engine-applied from the recipe. **Needed now, not later:** Yapper has no lipsync without native audio, so this can't be agent-remembered.
- One `video-director` skill line: discover/apply workflows; fill the recipe's slots; don't re-author the wrapper.

**Later — harvest, not now:** add Bhakti micro-drama and music-video recipes as they each prove out. Grow the recipe object (cast/env defaults, render settings) only when a recipe actually needs it.

## Guardrails (so this doesn't sprawl)

- **Build the mechanism once; harvest recipes.** Don't author a speculative library — Yapper is the first proven recipe, others earn their place.
- **Recipe v1 = prompt template + a couple of defaults.** Grow on demand only.
- **Single-source:** each recipe is one server file; if recipes ship in the plugin too, `check:notebook`-style identity enforces it.
- **`promptOverride` is the under-the-hood write mechanism, not the workflow system.** A per-project override is correctly scoped; it graduates to a *named workflow* only when the same format recurs across projects. Don't let per-project overrides become the library.
- **Positive framing only.** No banned-word lists in recipes or skills.

## Open decisions (for Codex on the first slice)

1. Recipe resource location + whether recipes also ship in the plugin bundle (and identity-check if so).
2. Does `apply_project_workflow` v1 set only the prompt override, or also preferences/cast defaults?
3. Confirm engine-side `{dialogue}` fill in the keyframe composer vs agent-assembled `promptOverride`. (Recommended: engine-side.)
4. Slot syntax + which slots are required vs optional, and the fallback when a judgment slot is empty.
5. Use the **real** `generate_video` native-audio param (the passing test used `generate_audio: true`) — do not introduce a parallel `nativeAudioMode` knob unless you are deliberately renaming the one field. Two params for one behavior will drift.
6. Format invariants: agent passes them per call from the re-read recipe, or the **engine applies them from the recipe** at `generate_video` time. Recommended: engine-applied, so a compaction can't silently drop native audio.

## Log

- 2026-06-XX: doc started. Origin = Yapper native-dialogue voice test (job `652657da-...`): identical params, prompt wording alone decided success. Prereq (keyframe honors project video override) confirmed as a real gap in `videoGeneration.ts`.
- 2026-06-XX: refined after review. Native audio is a per-call `generate_video` arg / format invariant, not a `preferences` field (don't invent schema). Format invariants need a durable re-read home — ideally engine-applied from the recipe — and are slice-1 for Yapper (no lipsync without native audio). Use the real param name; don't add a parallel knob.
