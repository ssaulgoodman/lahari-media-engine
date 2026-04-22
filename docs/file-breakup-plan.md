# File Breakup Plan

## Why

`Storyboard.tsx` (~1600 lines) and `server/routes/generate.ts` (~2400 lines) are too large to work with reliably. Bugs slip through because the full context can't be held — loading states get missed, refs don't wire through, features get built cosmetically instead of end-to-end. This directly caused the @mention system shipping as fake text insertion, generate buttons without loading states, and ref chips that didn't control what actually got sent.

## Backend Breakup — DONE

Completed 2026-04-22. `generate.ts` went from ~2490 lines to ~240 lines.

| Module | What | Status |
|--------|------|--------|
| `generate.ts` | Thin composition: param validators, phase unlocks, chat, mounts | DONE |
| `generate-style.ts` | Style brainstorm, visualize, refine, lock, upload-and-lock, analyze-style-image | DONE |
| `generate-looks.ts` | Character + env look gen, upload refs, lock, advance phases | DONE |
| `generate-script.ts` | Script gen (extended thinking + validation), refine, write-shot-prompts | DONE |
| `generate-shots.ts` | All shot-level: image gen, end frame, refine prompts, clear/revert, lock/unlock, scene lock, refs, history, split (largest module) | DONE |
| `generate-video.ts` | Video gen (Segmind), revert-video, chained-shot refresh | DONE |
| `scope-helpers.ts` | Shared: `paramStr`, `ScopeError`, `requireAsset/CastMember/Environment`, `parseTimestamp`, `atLeast` | DONE |

Codex recommended a 2-pass approach (video first, then the rest). We did it in 5 passes instead — one module per pass with review after each. `generate-shots.ts` is the largest (~900 lines) and may warrant a second split later into script-gen / shot-images / shot-admin, but it's stable for now.

## Fix List — DONE

10 of 11 fixes from `docs/fix-list-2026-04-22.md` completed before starting frontend breakup:
- Stale prompt rebuild, unlock button visibility, queue fully async, refine-script durations
- Model-aware durations (Claude prompt + Segmind rounding), duration read-only
- Custom Dropdown component, silent failure feedback, shared feedback hooks
- Deferred: #2 (unlock doesn't show previous candidates)

Shared feedback pattern (`hooks/useActionFeedback.ts` + `components/ActionFeedback.tsx`) ready for adoption during frontend extraction.

## Frontend Breakup — NEXT

### `components/Storyboard.tsx` → 5-6 files

| New File | Responsibility | Approx Lines |
|----------|---------------|-------------|
| `ShotCard.tsx` | Single shot: header bar (chevron, timestamp, progress dots, cast names, queue status), frame display (start/end/video), lock/clear/use-as-prev overlay buttons | ~300 |
| `RefChips.tsx` | Ref chip rendering, x-to-remove, upload button, active ref state management, `getDefaultRefs`, `getActiveRefs`, `resolveRefDisplay` | ~200 |
| `PromptToolkit.tsx` | Per-tab prompt textarea with @mention picker, generate button (with loading), refine section (with loading), video override reset | ~350 |
| `ShotVersionHistory.tsx` | History panel with 3 tabs, revert buttons, thumbnail strips | ~150 |
| `StudioHeader.tsx` | Context bar: scene tabs with lock toggles, progress stats, story popover, bulk actions (frames/videos/rewrite), bulk note | ~250 |
| `Storyboard.tsx` | Orchestrator: state management, scene iteration, shot expansion, passes data + handlers to children | ~300 |

### `App.tsx` (~1400 lines) → consider later

Not critical yet but growing. Could extract:
- `useProjectHandlers.ts` — all the `handle*` functions as a custom hook
- `useBulkGeneration.ts` — bulk frame/video logic with concurrency
- `useAuth.ts` — already exists as `AuthContext`

## Rules for the Breakup

1. **No behavior changes.** Pure structural refactor. Same props, same API calls, same UI. If it compiles and the app looks identical, it's done.
2. **Test by visual comparison.** Open a project, expand shots, switch tabs, generate, refine, lock — every interaction should be identical before and after.
3. **Move helpers close to their consumers.** `parseTimeToSec`, `fmtTime` go to a `utils/time.ts`. Ref types go to `types.ts`. Scope helpers stay in the router file.
4. **Keep imports explicit.** No barrel files (`index.ts` re-exports). Direct imports only.
5. **One PR per file group.** Don't mix Storyboard breakup with generate.ts breakup.
6. **Adopt `useActionFeedback` / `useKeyedActionFeedback`** in each extracted component. Wire error display inline instead of bubbling to parent. This is the main integration point from the fix-list work.

## Priority

1. ~~`generate.ts` first~~ — DONE
2. `Storyboard.tsx` next — makes all future Studio UI work safer
3. `App.tsx` later — it's big but mostly handler definitions that rarely change together

## What This Enables

- Each file is small enough to hold in full context (~200-400 lines)
- Changes to ref chips don't risk breaking shot headers
- Changes to video gen don't risk breaking style lock
- Loading states, disabled states, and error handling can be audited per-file
- New features (chat history, video fallback) can be added to the right file without scrolling past 2000 lines of unrelated code

## Codex Notes

My read: this breakup plan is correct in spirit and should be done. The current failure mode is not "bad engineers making mistakes," it is oversized files making end-to-end correctness hard to hold in working memory. The plan should stay refactor-only at first.

### How I Would Execute It (Frontend)

1. **Extract the volatile state surfaces first.**
   - First: `PromptToolkit.tsx`
   - Second: `RefChips.tsx`
   - Third: `ShotVersionHistory.tsx`
   - Then: `ShotCard.tsx` / `StudioHeader.tsx`
   - Reason: prompt/ref state is where subtle bugs have already shipped.

2. **Keep state ownership high until the seams are proven.**
   - `Storyboard.tsx` should remain the state orchestrator at first.
   - Child components should stay mostly presentational + callback driven.
   - Do not rush local state down into extracted components during the first pass.

3. **Add a smoke-test checklist to every extraction PR.**
   - Open existing project
   - Expand/collapse shots
   - Switch all shot tabs
   - Add/remove refs
   - Use @mention in prompt
   - Generate / refine / lock / unlock
   - Trigger one failure path
   - Verify optimistic updates revert on error

### Extra Rules

4. **No opportunistic cleanup inside breakup PRs.**
   - No renames for style.
   - No new abstractions unless the move requires them.
   - No changing API response shapes.
   - No "while we're here" feature work.

5. **Preserve function names where possible.**
   - That makes review easier because moved logic is easier to diff mentally.

6. **Prefer one-directional dependencies.**
   - Extracted UI pieces should depend on shared types/utils, not on each other in a tangled way.

7. **Do not introduce barrel files.**
   - Direct imports only. Easier grep, easier debugging, easier reviews.

### Suggested Order (Frontend)

1. Extract `PromptToolkit.tsx`
2. Extract `RefChips.tsx`
3. Extract `ShotVersionHistory.tsx`
4. Extract `StudioHeader.tsx`
5. Extract `ShotCard.tsx`
6. Reduce `Storyboard.tsx` to orchestration only

### Review Standard

Each stage reviewed against one simple question:

**Did this change only reduce file complexity, or did it also quietly alter behavior?**

If the answer is "only structure changed," the breakup is good.

— Codex
