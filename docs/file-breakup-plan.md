# File Breakup Plan

## Why

`Storyboard.tsx` (~1600 lines) and `server/routes/generate.ts` (~2400 lines) are too large to work with reliably. Bugs slip through because the full context can't be held — loading states get missed, refs don't wire through, features get built cosmetically instead of end-to-end. This directly caused the @mention system shipping as fake text insertion, generate buttons without loading states, and ref chips that didn't control what actually got sent.

## Files to Break Up

### `components/Storyboard.tsx` → 5-6 files

| New File | Responsibility | Approx Lines |
|----------|---------------|-------------|
| `ShotCard.tsx` | Single shot: header bar (chevron, timestamp, progress dots, cast names, queue status), frame display (start/end/video), lock/clear/use-as-prev overlay buttons | ~300 |
| `RefChips.tsx` | Ref chip rendering, x-to-remove, upload button, active ref state management, `getDefaultRefs`, `getActiveRefs`, `resolveRefDisplay` | ~200 |
| `PromptToolkit.tsx` | Per-tab prompt textarea with @mention picker, generate button (with loading), refine section (with loading), video override reset | ~350 |
| `ShotVersionHistory.tsx` | History panel with 3 tabs, revert buttons, thumbnail strips | ~150 |
| `StudioHeader.tsx` | Context bar: scene tabs with lock toggles, progress stats, story popover, bulk actions (frames/videos/rewrite), bulk note | ~250 |
| `Storyboard.tsx` | Orchestrator: state management, scene iteration, shot expansion, passes data + handlers to children | ~300 |

### `server/routes/generate.ts` → 4-5 files

| New File | Responsibility | Approx Lines |
|----------|---------------|-------------|
| `generate-style.ts` | Style brainstorm, visualize, refine, lock, unlock, upload-and-lock, analyze-style-image, enrich DNA | ~350 |
| `generate-looks.ts` | Character look gen + lock, environment look gen + lock, upload refs, advance phases | ~400 |
| `generate-shots.ts` | Script gen + refine, write-shot-prompts, shot image gen, end frame gen, refine-prompt, refine-end-frame, refine-video, clear/revert/upload frames, lock/unlock shots, scene lock-all/unlock-all, shot ref upload/delete, split | ~800 |
| `generate-video.ts` | Video generation (Segmind call, ffmpeg extract, chain refresh), revert-video | ~400 |
| `generate.ts` | Router + middleware: param validators (`id`, `shotId`, `sceneId`), scope helpers (`requireAsset`, `requireCastMember`, `requireEnvironment`, `ScopeError`), mounts sub-routers | ~150 |

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

## Priority

1. `generate.ts` first — backend bugs are harder to catch than UI bugs
2. `Storyboard.tsx` second — makes all future Studio UI work safer
3. `App.tsx` later — it's big but mostly handler definitions that rarely change together

## What This Enables

- Each file is small enough to hold in full context (~200-400 lines)
- Changes to ref chips don't risk breaking shot headers
- Changes to video gen don't risk breaking style lock
- Loading states, disabled states, and error handling can be audited per-file
- New features (chat history, video fallback) can be added to the right file without scrolling past 2000 lines of unrelated code

## Codex Notes

My read: this breakup plan is correct in spirit and should be done. The current failure mode is not "bad engineers making mistakes," it is oversized files making end-to-end correctness hard to hold in working memory. The plan should stay refactor-only at first.

### How I Would Execute It

1. **Break up `server/routes/generate.ts` first.**
   - This is the higher-risk file because auth/scope bugs, stale-flag bugs, and generation wiring bugs are harder to see than UI regressions.
   - I would keep `generate.ts` as the thin composition layer: auth + param validators + scope helpers + mounted sub-routers.
   - I would avoid moving ownership/scope helpers into multiple files. Keep them centralized so future auth fixes happen in one place.

2. **Do the backend split in two passes, not one.**
   - Pass 1: extract `generate-video.ts` only. This is the cleanest seam.
   - Pass 2: extract style / looks / shots once the first split is stable.
   - Reason: if the first extraction goes well, the pattern is proven and the next three are safer.

3. **For `generate-shots.ts`, expect one more split later.**
   - The proposed `~800` lines is better than `~2400`, but still not ideal.
   - That is acceptable as an intermediate state.
   - Likely later split:
     - `generate-script.ts`
     - `generate-shot-images.ts`
     - `generate-shot-admin.ts` (clear/revert/lock/unlock/split/refs)

4. **For `Storyboard.tsx`, extract the volatile state surfaces first.**
   - First: `PromptToolkit.tsx`
   - Second: `RefChips.tsx`
   - Third: `ShotVersionHistory.tsx`
   - Then: `ShotCard.tsx` / `StudioHeader.tsx`
   - Reason: prompt/ref state is where subtle bugs have already shipped.

5. **Keep state ownership high until the seams are proven.**
   - `Storyboard.tsx` should remain the state orchestrator at first.
   - Child components should stay mostly presentational + callback driven.
   - Do not rush local state down into extracted components during the first pass.

6. **Add a smoke-test checklist to every extraction PR.**
   - Open existing project
   - Expand/collapse shots
   - Switch all shot tabs
   - Add/remove refs
   - Use @mention in prompt
   - Generate / refine / lock / unlock
   - Trigger one failure path
   - Verify optimistic updates revert on error

### Extra Rules I Would Add

7. **No opportunistic cleanup inside breakup PRs.**
   - No renames for style.
   - No new abstractions unless the move requires them.
   - No changing API response shapes.
   - No "while we're here" feature work.

8. **Preserve function names where possible.**
   - That makes review easier because moved logic is easier to diff mentally.

9. **Prefer one-directional dependencies.**
   - Extracted UI pieces should depend on shared types/utils, not on each other in a tangled way.
   - Extracted route modules should depend on shared helpers, not cross-call each other casually.

10. **Do not introduce barrel files.**
    - Direct imports only. Easier grep, easier debugging, easier reviews.

### Suggested Order

**Backend**
1. Extract `generate-video.ts`
2. Extract `generate-style.ts`
3. Extract `generate-looks.ts`
4. Extract `generate-shots.ts`
5. Re-evaluate whether `generate-shots.ts` needs a second breakup

**Frontend**
1. Extract `PromptToolkit.tsx`
2. Extract `RefChips.tsx`
3. Extract `ShotVersionHistory.tsx`
4. Extract `StudioHeader.tsx`
5. Extract `ShotCard.tsx`
6. Reduce `Storyboard.tsx` to orchestration only

### Review Standard

I would review each stage against one simple question:

**Did this change only reduce file complexity, or did it also quietly alter behavior?**

If the answer is "only structure changed," the breakup is good.

— Codex
