# Button feedback audit

**Status:** Living doc. Each slice marks rows ✅ + commit hash when shipped.

**Symptom:** clicking a button that fires an async backend call gives no immediate visual feedback. The action lands seconds later with nothing in between. Pattern across Concept / Characters / Environments / Style / Audio / Script and the global Unlock pills.

## Constraints (Saul, 2026-05-22)

1. **Use the smallest shared shape.** Don't bespoke each button — extract common patterns.
   - **`UnlockPill`** accepts either a `busy` prop OR internally awaits `Promise.resolve(onClick())` and tracks its own `pending`. Single component change closes L2 / L4 / L6 / L11 / L12 in one place.
   - **Per-item locks** use keyed pending state, not booleans:
     - concept option → `lockingIndex: number | null`
     - cast member look → `lockingLookId: string | null`
     - env look → `lockingLookId: string | null`
     - style slot → `lockingSlotIndex: number | null` + separate user-slot flag
     - shot → `lockingShotId: string | null` (distinct from `isGenerating`)

2. **Destructive confirm dialogs don't spin the button.** If clicking opens a confirm dialog, the spinner waits until the user actually confirms and the backend call starts. Spinner == "backend in flight," not "modal waiting for input."

3. **After each slice: test one real click in browser.** This bug class is about perceived feedback — tsc + build won't catch a button that still feels dead. Real human click required before marking ✅.

4. **Don't fix working buttons.** StoryboardPanel + PromptToolkit already have decent generation feedback; verify rows in the table below are read-only inspections, not auto-rewrites.

## Spinner standard

Project-standard inline spinner is `w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin` (use `border-t-black` on white buttons). The 1px `border` version is the "rotating stick" — already corrected in `19cc46d`.

## Slice order (Saul's call)

1. **P0 lock/unlock only** — the buttons currently being felt.
2. **P1 add/delete rows** — useful but not blocking creative flow.
3. **Verify-only rows.** Don't fix working buttons.
4. **P3 contentEditable save feedback.** Deferred — delicate, easy to introduce more bugs than it solves. One pass at the end if at all.

---

## P0 — Lock / Unlock (Saul's top complaint)

| # | File:line | Button | Action fired | Current feedback | Status |
|---|---|---|---|---|---|
| L1 | `ConceptPhase.tsx:206` | Concept card "Choose" | `onLockConcept(idx)` → `AppShell.handleLockConcept` (async, may show destructive dialog) | Click gated by `!isLoading`; grid-wide overlay "Locking concept..." only appears once `isLoading` flips. No per-card visual on click. | ⏳ |
| L2 | `ConceptPhase.tsx:132` | "Unlock" (next to Locked Concept header) | `onUnlockConcept` → `api.unlockConcept` | `disabled={isLoading}` only. No spinner / label swap. | ⏳ |
| L3 | `CharactersPhase.tsx:391` | Look candidate "Lock" (per look in detail panel) | `onLockCharacter(memberId, assetId)` → `AppShell.handleLockCharacter` (async backend) | Plain button. No busy / disabled. | ⏳ |
| L4 | `CharactersPhase.tsx:120` | "Unlock characters" pill | `onUnlockCharacters` | `disabled={isLoading}` only. | ⏳ |
| L5 | `EnvironmentsPhase.tsx:381` | Env look candidate "Lock" | `handleEnvLock(envId, assetId)` (local async) | Plain button. No busy / disabled. | ⏳ |
| L6 | `EnvironmentsPhase.tsx:109` | "Unlock environments" pill | `onUnlockEnvironments` | `disabled={isLoading}` only. | ⏳ |
| L7 | `StylePhase.tsx` StyleRow Lock button (per slot) | "Lock style" (over image) | `onLock` → `handleLockSlot` (async) | Single shared `isLocking` flag — clicking one slot dims that button but NOT other slots' lock buttons. Multi-slot race possible. | ⏳ |
| L8 | `StylePhase.tsx:679` | Custom-slot "Lock style" (user vision pane) | `handleLockSlot(userSlot)` | Same `isLocking` shared flag. | ⏳ |
| L9 | `StylePhase.tsx:648` | "Use uploaded image as style" | `handleLockUploadedDirect` | Has `isLocking` + spinner + "Locking…" label. ✅ Already correct — verify. | ✅ keep |
| L10 | `StylePhase.tsx:413` | Curated preset "Use this style" | `handleLockPreset(preset)` | Per-preset `presetLockingKey` + spinner + label. ✅ Already correct. | ✅ keep |
| L11 | `StylePhase.tsx:445` | Style phase "Unlock" pill | `onUnlockStyle` | `disabled={isLoading}` only. | ⏳ |
| L12 | `ScriptPhase.tsx:241` | Script "Unlock" pill | `onUnlockScript` | `disabled={isLoading}` only. | ⏳ |
| L13 | `ShotCard.tsx:329` | Per-shot lock button (icon) | `onLockShot(scene.id, shot.id)` | `disabled={isGenerating || ...}` — uses generation flag, not a dedicated lock-in-flight flag. Click while another shot is generating disables; click during its own lock — no feedback. | ⏳ |
| L14 | `ShotCard.tsx` storyboard | Storyboard lock / unlock (in StoryboardPanel) | `onLockStoryboard` / `onUnlockStoryboard` | Need to verify — flagged for inspection. | 🔍 |

## P1 — Add / Delete / Upload

| # | File:line | Button | Action | Current feedback | Status |
|---|---|---|---|---|---|
| A1 | `CharactersPhase.tsx:135` | "+ Add" cast row | `onAddCast(...)` | Plain text-link button. No busy. | ⏳ |
| A2 | `EnvironmentsPhase.tsx` | "+ Add" env row | `onAddEnv(...)` (verify line) | Plain. No busy. | ⏳ |
| D1 | `CharactersPhase.tsx:185` | Cast row delete X | `onDeleteCast(memberId)` (after confirm dialog) | Confirm dialog handles its own state, but the sidebar row stays present until refresh — no "Deleting…" or row dim. | ⏳ |
| D2 | `EnvironmentsPhase.tsx:174` | Env row delete X | `onDeleteEnv` (verify) | Same. | ⏳ |
| U1 | `CharactersPhase.tsx:310` | "Use as-is" upload (cast) | `handleCastUploadAsIs` | Already wired: `castUploading` Set + spinner. ✅ keep | ✅ keep |
| U2 | `CharactersPhase.tsx:302` | "Generate with reference" upload | stages a ref then fires generate | Verify whether spinner runs while staging. | 🔍 |
| U3 | `EnvironmentsPhase.tsx:302` | Env "Use as-is" upload | `handleEnvUploadAsIs` | Already wired: `envUploading` + spinner. ✅ keep | ✅ keep |
| U4 | `StylePhase.tsx:559` | "Upload reference" (direct-lock) | `uploadAndLockStyle` | Has `isLocking` + spinner. ✅ keep | ✅ keep |

## P2 — Generate / Visualize / Refine / Regenerate

| # | File:line | Button | Action | Current feedback | Status |
|---|---|---|---|---|---|
| G1 | `CharactersPhase.tsx:502` | "Generate Looks" / "Regenerate" | `onGenerateLooks(memberId)` | `disabled={looksLoading.has(memberId)}`, label swaps to "Generating…". ✅ Already correct. | ✅ keep |
| G2 | `EnvironmentsPhase.tsx:311` | "Generate Looks" / "Regenerate" env | `onGenerateEnvLooks(envId)` | `disabled={envGenerating.has(envId)}` + label swap. ✅ | ✅ keep |
| G3 | `StylePhase.tsx` StyleRow Visualize | "Visualize" / "Re-visualize" per slot | `onVisualize` → `handleVisualize` | Per-slot `slot.isGenerating` flag in slot state. ✅ | ✅ keep |
| G4 | `StylePhase.tsx` StyleRow Refine | "Refine" per slot | `onRefine` → `handleRefine` | Per-slot `slot.isRefining`. ✅ | ✅ keep |
| G5 | `StylePhase.tsx:511` | "Brainstorm" / "Regenerate" | `handleBrainstorm` via AssetShelf | AssetShelf handles busy on the tool button itself. ✅ | ✅ keep |
| G6 | `AssetShelf.tsx` tool buttons | Any tool fired through shelf | parent `handleRunTool` | Per-tool `busyKey` + spinner + label swap. ✅ Already correct after T10.1. | ✅ keep |
| G7 | `ScriptPhase.tsx:235` | Header "Write all dialogue" | `writeAllDialogue` | `writingDialogue.has('__all__')` + "Writing…" label. ✅ | ✅ keep |
| G8 | `ScriptPhase.tsx` per-shot DialogueBlock | "Write dialogue" / "Rewrite" / "Regenerate" | `onWrite` → `writeDialogueForShot(id)` | `writingDialogue.has(shotId)` + "Writing…" label. ✅ | ✅ keep |
| G9 | `ShotCard.tsx:326` | "Generate video" / "Regenerate video" | `onGenerateVideo` | `disabled={isGenerating}` — needs verification that label swaps too. | 🔍 |
| G10 | `ShotCard.tsx:482` | "Generate end frame" | `onGenerateEndFrame(shotId)` | `disabled={shot.endImageStatus === 'loading'}` + spinner. ✅ | ✅ keep |
| R1 | `ConceptPhase.tsx` AssetShelf | "Generate concept" / "Refine concept" tool buttons | through AssetShelf | ✅ via AssetShelf busy state | ✅ keep |
| R2 | `AudioPhase.tsx` per-line | "Regenerate" per dialogue line | `regenerateLine(lineId)` | Verify. | 🔍 |

## P3 — Edit / Save (contentEditable blur saves)

Different category from buttons — `contentEditable` fields that save on blur. No immediate "Saving…" indicator; "Saved" flash appears AFTER the server returns.

| # | File:line | Field | Action | Current feedback | Status |
|---|---|---|---|---|---|
| E1 | `ConceptPhase.tsx:152-180` | Locked concept: subject / mood / direction / theme | `onUpdateConcept` on blur | `savedFlash` shows ONLY after return. No in-flight. | ⏳ |
| E2 | `ScriptPhase.tsx` scene narrative | scene blur | `onUpdateScene` | Same. | ⏳ |
| E3 | `ScriptPhase.tsx` per-shot direction / visualPrompt | shot blur | `onUpdateShot` | Same. | ⏳ |
| E4 | `CharactersPhase.tsx` cast name / description | blur | `onUpdateCast` | Same. | ⏳ |
| E5 | `EnvironmentsPhase.tsx` env name / description | blur | `onUpdateEnv` | Same. | ⏳ |
| E6 | `CharactersPhase.tsx` voice editor | voice fields | `onSave` → `saveVoice` | `saving` flag + spinner on save button. ✅ already wired. | ✅ keep |

## P4 — Nav / Cancel / Stop (low priority, click is instant)

| # | File:line | Button | Action | Why low |
|---|---|---|---|---|
| N1 | `ConceptPhase.tsx:176` | "Continue to Script" | `onSetViewPhase('script')` | Pure nav, instant. |
| N2 | `StylePhase.tsx:461` | "Continue to Characters" | nav | Same. |
| N3 | `AudioPhase.tsx:250/278` | "Back to Script" / "Back to Characters" | nav | Same. |
| N4 | "Stop" buttons during generation | `onCancelScript` / `onCancelConcepts` | Already disabled when not generating; show spinner during. ✅ | ✅ |

---

## Slice plan

**Slice A — UnlockPill shared enhancement.** Closes L2 + L4 + L6 + L11 + L12 in a single component change. Pill internally awaits `Promise.resolve(onClick())`, tracks its own pending, swaps label to "Unlocking…" + shows spinner. Callers don't change. Five buttons fixed at once.

**Slice B — Concept lock + Character look lock + Env look lock.** Sister pattern: keyed pending. Concept uses `lockingIndex`, Character + Env use `lockingLookId`. Concept's destructive-dialog case must NOT spin until the user confirms.

**Slice C — StyleRow lock (per slot + user slot).** Keyed `lockingSlotIndex: number | null` and separate `lockingUserSlot: boolean`. Fixes the multi-slot race.

**Slice D — Per-shot lock in ShotCard.** `lockingShotId: string | null`, distinct from existing `isGenerating`.

**Slice E — Add / Delete sweep.** A1 / A2 / D1 / D2 only after Saul confirms creative-flow buttons feel right.

After each slice:
- `npx tsc --noEmit --pretty false`
- `npm run build`
- **Real browser click on one affected button.** If it still feels dead, don't mark ✅.
- Update the corresponding rows with `✅ <commit>`.

## Verify before starting (🔍 marked rows)

These are inspection-only — read the code, decide if the button already feels right, mark ✅ keep if so. Don't rewrite.

- L14 storyboard lock/unlock in StoryboardPanel
- U2 character "Generate with reference" — does staging show feedback?
- G9 ShotCard generate-video — does label swap or only disabled?
- R2 audio line regenerate — feedback state?
