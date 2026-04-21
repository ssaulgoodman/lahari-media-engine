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
