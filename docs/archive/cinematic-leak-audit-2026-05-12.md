# Cinematic-realism Leak Audit + Fix Plan

**STATUS as of 2026-05-12 evening:** Tiers 1, 2, and 3 all shipped. The narrow `visual_medium` enum was rejected in favor of a fully generic approach — see "Tier 3 (revised, shipped)" at the bottom. A separate storyboard-consistency restoration also landed in the same batch as Tier 3.

**Trigger:** today's stylized-style project came out reading "cinematic realism" even though the locked style image was non-realistic and all the per-shot refs were correct.

**Root cause in one line:** the locked style image is *supposed* to be the visual ground truth, but every downstream image-gen prompt hardcodes the words **"cinematic"** and **"film still"** in the request text. Image models weight text + reference images jointly, so the text is fighting the style image — and on stylized prompts (painterly, miniature, illustrated, mixed-media) the text wins enough of the time to leak realism back in.

This is the exact same class of bug we fixed when we ripped style-DNA text out of Gemini prompts back in April. We just left a different family of medium adjectives hardcoded.

---

## 1. Where "cinematic / realism" is hardcoded (always-on, regardless of style choice)

### A. Image generation downstream prompts (the bug surface — fights the style image at render time)

| File | Line | Phrase | What it applies to |
|---|---|---|---|
| `server/services/imagen.ts` | 210, 211 | `Generate ONE cinematic character reference portrait` | Every character look gen |
| `server/services/imagen.ts` | 223 | `Eye-level framing, natural cinematic lighting` | Every character look gen |
| `server/services/imagen.ts` | 225 | `Should feel like a real film still` | Every character look gen |
| `server/services/imagen.ts` | 309, 310 | `Generate ONE cinematic environment shot` | Every environment look gen |
| `server/services/imagen.ts` | 317 | `Should feel like a real film still` | Every environment look gen |
| `server/services/imagen.ts` | 470 | `Single cinematic frame. ... Should feel like a film still` | Every shot start frame |
| `server/services/imagen.ts` | 619 | `Two cinematic frames. ... Should feel like film stills` | Every shot end frame |
| `server/services/openai-image.ts` | 254, 350 | Same `Cinematic film still` / `Single cinematic frame` | When project uses `gpt-image-2` |
| `server/services/segmind-image.ts` | 310, 320, 351 | `cinematic start frame` / `Single cinematic frame` | When project uses `nano-banana-2` |

**Severity:** P0. This is what the artist felt today. Three different image providers, three independent copies, all biased toward realism.

### B. Storyboard renderer (Seedance mode)

| File | Line | Phrase |
|---|---|---|
| `server/services/seedance-storyboard-rd.ts` | 183 | `Each panel is a different cinematic moment` |
| `server/services/seedance-storyboard-rd.ts` | 189, 192 | `Create a [four/six]-panel cinematic production storyboard` |
| `server/services/seedance-storyboard-rd.ts` | 211 | `Each panel must be its own true 16:9 cinematic film frame` |
| `server/services/seedance-storyboard-rd.ts` | 272 | `Generate a Xs cinematic Lahari music-video clip` (shot_timing_only variant) |
| `server/services/seedance-storyboard-rd.ts` | 296 | `Animate the storyboard @image1 into one Xs cinematic clip` (board_plus_timing — what we actually run) |

**Severity:** P1. The new trimmed storyboard prompt is much leaner, but the word "cinematic" survived the trim. Same fight.

### C. Script writer prompts (upstream — biases what Claude proposes)

| File | Line | Phrase |
|---|---|---|
| `server/services/claude.ts` | 104, 115, 179 | `You are a visionary film director specializing in Indian mythological and devotional cinema` (concept gen, refine concept, plan scenes) |
| `server/services/claude.ts` | 337–338 | `DIRECTOR STYLE: Cinematic — fewer, more sustained moments` (only one of two modes, but the framing is built around film-thinking) |
| `server/services/claude.ts` | 571 | Same `visionary music video director ... devotional cinema` in `refineScript` |
| `server/services/claude.ts` | 769 | `WRITE CINEMATIC PROMPTS THAT ARE RENDERABLE` (writeShotPrompts) |
| `server/services/claude.ts` | 810 | `Mood: ${concept.mood || 'Cinematic'}` (default fallback) |
| `server/services/claude.ts` | 935 | `Avoid overly AI/CGI/fantasy look — should feel cinematic or painterly` (style brainstorm) |
| `server/services/claude.ts` | 1031 | `return text \|\| 'Cinematic, high contrast.';` (analyze-image-style fallback) |

**Severity:** P2. Claude's brainstorm prompt already explicitly invites "photographic, painterly, illustrated, miniature-inspired, or mixed-media directions" (catalog.ts:377) — but the meta-frame still says "cinema". For a project that *wants* miniature, this primes a tug-of-war.

### D. Curated style presets

Historical note: the old Lahari curated style presets shipped with implicit medium choices baked into their description text. Mirage removed those presets entirely; any future curated style set must be clean, workflow-specific, and deliberate.

---

## 2. Why removing-not-replacing is the right call (for tier A)

When we deleted style-DNA text from image-gen prompts in April, the reasoning was: **the locked style image already carries the medium signal**. Saying "miniature, gouache, flat color" in text on top of a miniature reference image is redundant on a match and harmful on a near-miss (model averages text and image).

The same logic applies to "cinematic / film still":

- If the locked style image *is* cinematic, the words "cinematic film still" add nothing — the image already says that.
- If the locked style image is painterly / illustrated / miniature, the words "cinematic film still" actively fight the image and pull renders back toward realism. Exactly today's bug.

So tier A is **delete, not replace**. No new column, no UI surface, no preset metadata needed. The image is already doing the work.

For tier B (storyboard) the same holds.

For tier C (Claude script/concept writers) it's slightly different — Claude isn't looking at the style image, so it does need *some* medium signal to write coherent shot directions. The signal it needs is light: a single project-level "visual medium" tag (cinematic / painterly / illustrated / miniature / stylized-other) that overrides the hardcoded "film director" framing.

---

## 3. Plan (three tiers, ship in this order)

### Tier 1 — Remove medium adjectives from image-gen prompts (P0, ~1 hour, no schema)

Find/replace across three files. Each replacement: drop "cinematic" and "film still" language, keep everything else verbatim. The style image is already a numbered ref in every one of these prompts.

| File | Function | Change |
|---|---|---|
| `imagen.ts` | `buildCharacterPrompt` | `Generate ONE cinematic character reference portrait` → `Generate ONE character reference portrait`. Drop `natural cinematic lighting` from the framing bullet. Drop the trailing "Should feel like a real film still." sentence. |
| `imagen.ts` | `buildEnvironmentPrompt` | Same treatment — drop "cinematic", drop "Should feel like a real film still." |
| `imagen.ts` | `buildShotFramePrompt` | `Single cinematic frame.` → `Single frame.` Drop "Should feel like a film still." |
| `imagen.ts` | end-frame builder | `Two cinematic frames. ... Should feel like film stills` → `Two frames. ...` |
| `openai-image.ts` | char / env / shot frame mirrors | Same removals |
| `segmind-image.ts` | char / env / shot frame mirrors | Same removals |
| `server/prompts/catalog.ts` | matching catalog entries | Mirror the live changes so the Prompts library doesn't lie |

Also: kill the unused `Hyperrealistic cinematic portrait` / `vintage 16mm film still` direction-seed strings at `imagen.ts:120-123`, `segmind-image.ts:218-224`, `openai-image.ts:246-249` — they're seed bank entries that aren't reached on the curated-preset path anymore, but if any code path still hits them they bias hard toward realism.

**Acceptance:** generate a character look + environment look + shot start frame against a clean curated preset and against an uploaded painterly miniature style. Both should track the style image; the painterly one should NOT show realism leak.

### Tier 2 — Trim "cinematic" from the Seedance storyboard prompt (P1, ~30 min, no schema)

Same removal pattern in `seedance-storyboard-rd.ts`:

- "cinematic moment" → "moment"
- "cinematic production storyboard" → "production storyboard"
- "true 16:9 cinematic film frame" → "true 16:9 frame"
- The video prompt's "into one Xs cinematic clip" → "into one Xs clip"

Storyboard image renderer (nano-banana-pro / nano-banana-2 / gpt-image-2) already sees the locked style/character/env refs alongside the prompt — same logic as tier 1, the image carries the medium.

**Acceptance:** lock a painterly style, write storyboard prompts on three shots, render boards. Boards should match the painterly reference, not collapse to cinematic still language.

### Tier 3 — Replace upstream "film director" framing with a configurable medium tag (P2, ~2-3 hours, one migration)

This is the deeper fix for the Claude side. Currently every concept / script / shot-prompt call starts with `You are a visionary film director specializing in Indian mythological and devotional cinema.` That framing biases everything downstream toward film-shaped thinking even for projects where the artist wants miniature-painting or illustrated-comic energy.

**Schema:**
- New column `lahari_projects.visual_medium TEXT NULL` — values: `cinematic` (default), `painterly`, `illustrated`, `miniature`, `mixed_media`, `other`.
- One-line migration. Default `cinematic` so existing projects behave identically.

**Prompt routing:**
- Add a `mediumPersona(medium)` helper in `claude.ts` that returns the right opening line:
  - `cinematic` → `You are a visionary film director specializing in Indian mythological and devotional cinema.`
  - `painterly` → `You are a visionary art director planning a painterly Indian devotional music video.`
  - `illustrated` → `You are a visionary art director working in an illustrated, graphic-novel idiom for an Indian devotional music video.`
  - `miniature` → `You are a visionary art director working in the Indian miniature painting tradition for a devotional music video.`
  - `mixed_media` → `You are a visionary art director working in mixed-media collage for an Indian devotional music video.`
  - `other` → `You are a visionary art director planning an Indian devotional music video. The visual medium is non-cinematic; lean on the locked style image and refs.`
- Replace every hardcoded "visionary film director" string in `claude.ts` with this helper.
- In `writeShotPrompts`, replace `WRITE CINEMATIC PROMPTS THAT ARE RENDERABLE` with `WRITE PROMPTS THAT ARE RENDERABLE` and add a one-liner: `Visual medium: ${medium}. The locked style image is the ground truth for medium and rendering approach — write the action and composition; don't dictate art style in words.`
- Drop the `'Cinematic'` fallback in `concept.mood || 'Cinematic'` — let it be empty.
- Drop the `'Cinematic, high contrast.'` fallback in `analyzeImageStyle`.

**UI:**
- One dropdown in `BlueprintContextBar.tsx` next to the existing render-params row. Default `Cinematic`. Persists via `PATCH /api/projects/:id` (already accepts arbitrary project fields).
- When a curated style preset is locked, **optionally** stamp `project.visual_medium` from preset metadata (Tier 3.5 below).

**Acceptance:** create a project, switch medium to `miniature`, click "Generate concept" → Claude proposes miniature-inflected concepts, no "film still" / "cinematic" language anywhere in the script writer output.

### Tier 3.5 — Optional: preset metadata for `visual_medium` (~30 min)

Add a `medium` field to each `StylePreset` in `server/style-presets.ts`. Today all four are `cinematic`, but the structure supports future non-cinematic presets (illustrated bhakti comic, miniature paintings, batik, etc.). `POST /lock-style-preset` reads the field and stamps `project.visual_medium` alongside `style_asset_id`.

Skip if Tier 3 is good enough — most artists will set medium explicitly anyway.

---

## 4. What this does NOT touch

- **Video generation prompts** (`generate-video.ts`) — these are `motionPrompt + ref labels`. No "cinematic" in the user-facing path. Don't touch.
- **Audio analysis prompts** (`gemini.ts`) — no medium language.
- **The `videoMode` montage/cinematic toggle** in script writer — that's about pacing/cuts, not visual medium. Leave it; it's orthogonal to this fix.
- **Style-preset descriptions** themselves — future curated presets may still carry intentional medium choices. The artist who picks one gets what they asked for.

---

## 5. Risk

- **Tier 1**: zero. We've already proven this path works (the style-DNA-text deletion in April had the same shape: trust the style image, drop the redundant text). Only risk is that *cinematic* projects subtly degrade because the model loses a redundant nudge — extremely unlikely given the image is still in-prompt.
- **Tier 2**: same as Tier 1. Storyboard image model already has the style ref.
- **Tier 3**: highest risk because we change Claude's persona framing. Mitigations: keep `cinematic` as the default for every existing project; existing personas only change when the artist explicitly opts into a non-cinematic medium.

---

## 6. Recommendation

**Ship Tier 1 today.** It's the actual bug the artist hit, the fix is mechanical, and it doesn't need a migration or UI surface. The artist will see correct stylized renders on the next batch.

**Ship Tier 2 same-day.** Same shape of fix, different file.

**Tier 3 next session.** Requires migration + UI + thinking about the persona strings. Don't rush.

**Tier 3.5 only if a non-cinematic preset gets added.** Not worth the code right now.

---

## Tier 3 (revised, shipped 2026-05-12 evening)

The original Tier 3 plan proposed a `visual_medium` column + dropdown + 5-option enum (cinematic / painterly / illustrated / miniature / mixed_media / other) + `mediumPersona()` helper. That was rejected as too-narrow forcing. What we shipped instead:

### Approach: trust the locked style image, delete the forcing language

No schema change. No migration. No new UI surface. The locked style image is already the source of truth for visual medium — we just (a) stopped fighting it with cinema text in persona strings, and (b) actually passed it as vision input to the one stage that needed to read it.

### Changes

**Persona strips in `claude.ts` (text-side):**
- `generateConceptOptions` (both Path A and Path B), `refineConceptDirection`, `refineScript`: replaced `"You are a visionary film director specializing in Indian mythological and devotional cinema"` with neutral `"You are a visionary music video director planning an Indian devotional music video"` + an explicit note that visual medium is decided separately via the locked style reference.
- `writeShotPrompts`: replaced `"You are a cinematographer"` → `"You are an art director / shot writer"`, replaced `"WRITE CINEMATIC PROMPTS THAT ARE RENDERABLE"` → `"WRITE PROMPTS THAT ARE RENDERABLE"`. Added an explicit anti-cinema instruction: don't dictate art style / color palette / "cinematic"/"film still" framing in words — the style image is the ground truth.
- `brainstormStyleDirections` quality guideline: replaced `"should feel cinematic or painterly"` with medium-agnostic `"grounded and intentional in its chosen medium (photographic, painterly, illustrated, miniature, mixed-media, etc.)"`.
- `analyzeImageStyle` fallback: dropped `'Cinematic, high contrast.'` → empty string.
- `concept.mood || 'Cinematic'` fallback → `'devotional'`.

**Storyboard planner overhaul in `storyboard.ts`:**
- **Flipped `plannerVisionRefs` filter** to include the locked style ref (key `'style'`), not just the artist refine ref and prev storyboard ref. The planner now actually sees what medium it's planning for.
- **Added new persona line to both planner-prompt variants** (`artistNote` refine path and the convert-from-source-brief path): `"You are an art director planning one panel of a devotional music video storyboard. The locked style reference image is the visual ground truth — read it to understand the medium (cinematic photographic, painterly, miniature, illustrated, mixed-media, etc.) and match it."`
- **Restored inter-panel consistency demand** (the line that the trim regression had dropped). The planner is now explicitly required to put a consistency instruction inside `storyboardPrompt`, naming which ref controls which aspect (style → medium/lighting/palette; characters → identity/costume; environment → physical space). Word cap raised from 300 → 330 to accommodate the line. Explicit ban on `"cinematic film still"` language.

**Seedance video prompt in `seedance-storyboard-rd.ts`:**
- Restored one-sentence identity-continuity instruction: `"Preserve character identity (face, body, costume, jewelry) and environment geometry across the whole animation — match the locked references throughout, do not let them drift between panels."` This was load-bearing in the pre-trim version; the trim had reduced it to a weak `"identity anchor only"` label.

**Catalog updates** (`server/prompts/catalog.ts`):
- Mirror all persona text changes in the displayed templates.
- Updated `seedance-storyboard-image` entry: model column unchanged, but added `styleImage` to the variables list, rewrote the template + summary to reflect the new planner persona / inter-panel consistency demand / style-image vision input.
- Updated `seedance-storyboard-video` template to include the restored identity-continuity sentence.

### What this gets

- Works for any locked style — cinematic, painterly, miniature, illustrated, mixed-media, batik, kalamkari, anything. The image is the spec.
- Zero artist config. Nothing new to set per project.
- Backward compatible for existing cinematic projects: their locked style image is already cinema-shaped, so the planner sees a cinema-shaped image and outputs cinema-shaped panel directions. Same behavior, just now driven by the image rather than text bias.
- Fixes the inter-panel style-drift regression that came in with the storyboard-prompt trim.

### Risk

Lower than the original Tier 3 plan (no migration, no UI, no enum to maintain). Two real risk surfaces:

1. **Planner now sees the style image alongside the other vision inputs** (artist refine ref, prev-storyboard ref when continuity is on). Extra vision tokens per planner call. Mitigation: tested with the existing token budget — still well under the 4096 `maxTokens` cap.
2. **Planner might over-index on the style image** and ignore the shot direction text, collapsing every panel into "variations on the style frame" instead of "shot beats". Mitigation: the new persona explicitly says *"read it to understand the medium and match it"* — bounded to medium, not composition.

### Tier 3.5 — still skipped

Preset metadata for `medium` is still not worth the code. All current presets are cinema-realistic and the audit fix above handles them. If a non-cinematic preset gets added later, just paint the curated PNG in that medium — the planner will read it.
