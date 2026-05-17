> **Archived.** Historical polish backlog. Items shipped opportunistically as adjacent code was touched. Preserved for reference. 
# UI Polish Plan — Skill-Based Audit

Audit of all screens against `make-interfaces-feel-better` + `web-design-guidelines` skills.
Organized by screen, priority within each. Each fix references the skill principle it addresses.

---

## 1. Studio (Storyboard + ShotCard + PromptToolkit + StudioHeader + ShotVersionHistory)

### Scale on Press — no buttons have tactile feedback
**Principle:** Scale on Press (always `0.96`)

| Element | File:Line | Fix |
|---------|-----------|-----|
| Generate frame button | ShotCard ~303 | Add `active:scale-[0.96] transition-transform` |
| Generate video button | ShotCard ~307 | Same |
| Lock button | ShotCard ~311 | Same |
| All bulk action buttons | StudioHeader ~239,248,257 | Same |
| Write prompts / Frames / Videos | StudioHeader | Same |
| Generate button in PromptToolkit | PromptToolkit ~401 | Same |
| Refine button | PromptToolkit ~459 | Same |
| Scene pill buttons | StudioHeader ~109 | Same |

### transition-all — must specify exact properties
**Principle:** Never Use `transition: all`

| Before | After | File:Line |
|--------|-------|-----------|
| `transition-all` on version thumbnails | `transition-[border-color,box-shadow]` | ShotVersionHistory ~95 |
| `transition-all` on shot card border | `transition-[border-color,opacity]` | ShotCard ~216 |

### Hit Areas — several controls under 40px
**Principle:** Minimum Hit Area (40x40px)

| Element | Current Size | Fix | File:Line |
|---------|-------------|-----|-----------|
| History button | 28x28 (w-7 h-7) | Add `after:` pseudo to extend to 40x40 | ShotCard ~301 |
| Generate frame button | 28x28 | Same | ShotCard ~303 |
| Generate video button | 28x28 | Same | ShotCard ~307 |
| Lock button | 28x28 | Same | ShotCard ~311 |
| Clear frame button | 24x24 (w-6 h-6) | Same | ShotCard ~370 |
| Remove ref "x" button | ~12x12 | Extend hit area with pseudo | PromptToolkit ~179 |
| Version history close | text-only ~20px | Add padding or pseudo | ShotVersionHistory ~81 |

### Image Outlines — images missing subtle outline
**Principle:** Image Outlines (pure white in dark mode, `rgba(255,255,255,0.1)`)

| Image | Fix | File:Line |
|-------|-----|-----------|
| Shot start/end frame images | Add `outline outline-1 -outline-offset-1 outline-white/10` | ShotCard ~354,377,395 |
| Version history thumbnails | Same | ShotVersionHistory ~104 |
| @mention item thumbnails | Same (tiny, optional) | PromptToolkit ~375 |
| Compiled ref thumbnails | Same | PromptToolkit ~228 |
| Hover preview image | Already has `border border-white/[0.1]` — swap to outline | PromptToolkit ~198 |

Note: `index.html` has a global `.shot-image` outline rule, but it uses `rgba(255,255,255,0.06)` — should bump to `0.1` per skill guidelines.

### Concentric Border Radius — nested rounded elements
**Principle:** Outer = Inner + Padding

| Parent | Child | Current | Fix | File |
|--------|-------|---------|-----|------|
| Shot card `rounded-xl` (16px) | Inner image `rounded-md` (6px) | Both independent | Card has `overflow-hidden` so inner radii hidden — OK as-is | ShotCard |
| Version thumbnail `rounded-md` (6px), `p-0` | Child image (none) | OK — overflow-hidden clips | No fix needed | ShotVersionHistory |
| Header `rounded-xl` (16px), `px-4` | Scene pills `rounded-l-md`/`rounded-r-md` | Independent surfaces, padding >24px | OK per skill exception | StudioHeader |

### Stagger Enter Animations — could be better
**Principle:** Split and Stagger Enter Animations

| Current | Improvement | File |
|---------|-------------|------|
| Shots stagger at `delay: shotIdx * 0.03` (30ms) | Bump to ~60-80ms for more visible cascade | ShotCard ~218 |
| Scene containers use `duration: 0.2` | Add `filter: blur(4px)` to initial state for polish | Storyboard ~148-154 |

### AnimatePresence — missing initial={false}
**Principle:** Skip Animation on Page Load

| Location | Fix |
|----------|-----|
| ImageModal AnimatePresence | Add `initial={false}` — modal shouldn't animate on page load | Storyboard ~228 |

### Text Wrapping
**Principle:** `text-wrap: balance` on headings, `pretty` on body

| Element | Fix | File:Line |
|---------|-----|-----------|
| Scene heading | Add `text-balance` | Storyboard ~158 |
| Scene narrative description | Add `text-pretty` | Storyboard ~163 |
| Shot direction "Beat" text | Add `text-pretty` | ShotCard (wherever direction renders) |

---

## 2. Blueprint (AnalysisEditor + Context Bar + 5 Phases + UnlockPill)

### Scale on Press

| Element | File:Line | Fix |
|---------|-----------|-----|
| Launch Studio button | BlueprintContextBar ~235 | `active:scale-[0.96] transition-transform` |
| Generate Concepts button | ConceptPhase ~181 | Same |
| Generate Script button | ScriptPhase ~108 | Same |
| Concept option "Choose" buttons | ConceptPhase ~354 | Same |
| Brainstorm / Visualize style buttons | StylePhase ~486,575 | Same |
| Lock Style button | StylePhase ~90 | Same |
| Generate Looks button | CharactersPhase ~279 | Same |
| Lock character/env buttons | CharactersPhase ~346, EnvironmentsPhase ~339 | Same |
| Refine buttons (all phases) | Various | Same |
| Unlock pills | UnlockPill ~8 | Same |

### transition-all

| Before | After | File:Line |
|--------|-------|-----------|
| Summary cards `transition-all` | `transition-[background-color,box-shadow]` | Dashboard ~138 |

### Hit Areas

| Element | Current Size | Fix | File:Line |
|---------|-------------|-----|-----------|
| Audio play button | 24x24 (w-6 h-6) | Extend to 40px with pseudo | BlueprintContextBar ~167 |
| Delete cast/env button | ~16px (opacity on hover) | Extend to 40px | CharactersPhase ~150, EnvironmentsPhase ~162 |
| Unlock padlock icon | ~16px | Wrap in button with 40px hit area | CharactersPhase ~225 |
| Split shot button | Looks ~40px already | Verify | ScriptPhase ~290 |

### Image Outlines

| Image | Fix | File:Line |
|-------|-----|-----------|
| Style phase thumbnails (StyleRow) | Add `outline outline-1 -outline-offset-1 outline-white/10` | StylePhase ~44 |
| Locked style image | Same | StylePhase ~351 |
| Character reference thumbnails | Same | CharactersPhase ~110 |
| Environment reference thumbnails | Same | EnvironmentsPhase ~144 |
| Character candidate grid images | Same | CharactersPhase ~289 |
| Environment candidate grid images | Same | EnvironmentsPhase ~297 |
| Style ref chip hover preview | Already has border — swap to outline | CharactersPhase ~409 |

### Tabular Numbers
**Principle:** Dynamic numbers need `tabular-nums`

| Element | Fix | File:Line |
|---------|-----|-----------|
| Scene/shot count display | Add `tabular-nums` | ScriptPhase ~232 |
| Shot duration display | Add `tabular-nums` | ScriptPhase ~275 |
| Generation count in sidebar | Add `tabular-nums` | CharactersPhase ~174 |

Note: `index.html` applies `font-variant-numeric: tabular-nums` globally to `font-mono` elements, so anything with `font-mono` already gets it. Check if these elements use `font-mono`.

### Shadows Over Borders — cards using borders for depth

| Element | Current | Fix | File:Line |
|---------|---------|-----|-----------|
| Concept option cards | `border border-white/[0.06]` | Replace with `shadow-[0_0_0_1px_rgba(255,255,255,0.06)]` | ConceptPhase ~339 |
| Style row container | `border border-white/[0.06]` | Same pattern | StylePhase ~37 |
| Script scene container | `border border-white/[0.06]` | Same pattern | ScriptPhase ~161 |

Note: This is debatable in dark mode — the skill says dark mode shadows simplify to a single white ring `0 0 0 1px rgba(255,255,255,0.08)` which is nearly identical to what we already have with borders. Could skip this if it doesn't improve the look.

### Stagger Enter Animations

| Current | Improvement | File |
|---------|-------------|------|
| Phase transitions: opacity+y, 0.2s | Add `filter: blur(4px)` to initial/exit for more polish | AnalysisEditor ~83-88 |
| Concept option cards: stagger at 0.05s | Good already — could add blur | ConceptPhase ~333 |
| No stagger on style exploration rows | Add stagger | StylePhase ~440 area |

### Text Wrapping

| Element | Fix | File:Line |
|---------|-----|-----------|
| Concept titles | `text-balance` | ConceptPhase |
| Concept descriptions/mood text | `text-pretty` | ConceptPhase |
| Scene narrative descriptions | `text-pretty` | ScriptPhase ~227 |
| Shot directions | `text-pretty` | ScriptPhase |
| Meaning summary text | `text-pretty` | BlueprintContextBar |

---

## 3. Render (StepRender + Timeline Editor + Effects Panel)

### transition: all — pervasive in timeline components (inline styles)
**Principle:** Never Use `transition: all`

| Element | Current | Fix | File |
|---------|---------|-----|------|
| Timeline toolbar buttons | `all 0.15s` | `background-color 0.15s, color 0.15s` | TimelineEditor ~30-38 |
| Timeline sidebar buttons | `all 0.15s` | `background-color 0.15s, border-color 0.15s, color 0.15s` | TimelineEditor ~40-52 |
| Transition overlay items | `all 0.15s` | `background-color 0.15s, border-color 0.15s` | TransitionOverlay ~48 |
| Effects panel preset buttons | `all 0.15s` | `background-color 0.15s, border-color 0.15s, color 0.15s` | EffectsPanel ~87-97 |

### Scale on Press

| Element | File | Fix |
|---------|------|-----|
| Render button | StepRender ~241 | `active:scale-[0.96] transition-transform` |
| Back button | StepRender ~216 | Same |
| History toggle button | StepRender ~232 | Same |

### Hit Areas

| Element | Current | Fix | File |
|---------|---------|-----|------|
| Timeline header buttons | 28x28 | Extend to 40px with pseudo | Header ~15-29 |
| Delete render button | text-only ~20px | Add padding | StepRender ~322 |
| Zoom slider | height 4px | OK — native control | Header |

### Image Outlines

| Image | Fix | File |
|-------|-----|------|
| History panel video thumbnails | Add `outline outline-1 -outline-offset-1 outline-white/10` | StepRender ~310 |
| Transition preview images | Same | TransitionOverlay ~52-56 |

### Enter Animations — history panel could animate
**Principle:** Split and Stagger

| Element | Current | Fix | File |
|---------|---------|-----|------|
| History panel mount | Appears instantly | Add fade+slide from right | StepRender ~268 |
| History items | All appear at once | Stagger 80ms | StepRender ~294 |
| Success/Error banners | Appear instantly | Add fade+y enter | StepRender ~333,359 |

### Text Wrapping

| Element | Fix | File |
|---------|-----|------|
| StepRender title | `text-balance` | StepRender ~221 |

---

## 4. Dashboard (Queue Screen)

### Scale on Press

| Element | Fix | File:Line |
|---------|-----|-----------|
| Start button | `active:scale-[0.96] transition-transform` | Dashboard ~284 |
| Open button | Same | Dashboard ~276 |
| Summary filter cards | Same | Dashboard ~138 |
| Clear filters button | Same | Dashboard ~174 |

### transition-all

| Before | After | File:Line |
|--------|-------|-----------|
| Summary card `transition-all` | `transition-[background-color,box-shadow]` | Dashboard ~138 |

### Image Outlines
No images in Dashboard — N/A.

### Hit Areas

| Element | Current | Fix | File:Line |
|---------|---------|-----|-----------|
| Table sort headers | text-only | Already wide enough via cell padding | Dashboard ~195 |
| Clear/Refresh buttons | ~28px height | Adequate with padding | Dashboard ~174,183 |

### Text Wrapping

| Element | Fix | File:Line |
|---------|-----|-----------|
| Dashboard title | `text-balance` | Dashboard ~117 |
| Song names in table | `text-pretty` (if multi-line) | Dashboard ~239 |

### Tabular Numbers

| Element | Fix | File:Line |
|---------|-----|-----------|
| Summary card counts (text-2xl numbers) | Already uses `font-mono` — gets tabular-nums from global CSS | Dashboard ~142 |
| Priority column | Uses `font-mono` — OK | Dashboard ~236 |
| Duration column | Uses `font-mono` — OK | Dashboard ~244 |

---

## 5. Global / Root

### Already Correct
- Font smoothing: `antialiased` + `grayscale` on body
- Image outlines: Global rule in `index.html` for `.shot-image`, `.ref-image` — but uses `0.06` opacity (bump to `0.1`)
- Scrollbar styling: Custom dark scrollbars
- Surface system: `.surface`, `.surface-raised`, `.surface-inset` classes with layered shadows
- Skeleton shimmer animation

### Global Fixes

| Fix | Where |
|-----|-------|
| Bump image outline opacity from `0.06` to `0.1` | index.html ~79-80 |
| Add `text-wrap: pretty` to base `p` styles | index.html or Tailwind layer |
| Add `text-wrap: balance` to base `h1-h3` styles | index.html or Tailwind layer |
| Verify `will-change` not overused | Grep for `will-change` — should be minimal |

---

## Priority Order

**P0 — High impact, quick wins:**
1. Scale on press on all primary buttons (global pass)
2. Replace all `transition-all` with specific properties
3. Bump image outline opacity to `0.1`

**P1 — Medium impact:**
4. Hit area extensions on small controls (pseudo-element pattern)
5. Image outlines on all displayed images
6. Text wrapping (balance on headings, pretty on body text)
7. Tabular-nums on remaining dynamic numbers

**P2 — Polish:**
8. Stagger + blur on enter animations
9. AnimatePresence `initial={false}` where appropriate
10. History panel enter/exit animations in Render
11. Shadows-over-borders audit (likely skip — dark mode borders work fine)
12. Concentric radius check (most already OK due to overflow-hidden)

---

## Estimated Effort
- P0: ~1 hour (mechanical find-and-replace patterns)
- P1: ~1.5 hours (need to verify each image element, add pseudo-elements)
- P2: ~1 hour (animation tweaks, optional refinements)
- Total: ~3-4 hours if we do everything
