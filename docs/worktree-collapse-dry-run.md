# Lahari Worktree Collapse Dry Run

Date: 2026-06-03

## Why This Exists

`lahari-codex-native` has become the real operating worktree for Lahari engineering context, but Railway still deploys from the older `lahari-media-engine` main checkout. This creates repeated cherry-pick/deploy ceremony and branch confusion.

The desired end state is: one primary Lahari worktree, on branch `main`, deployed by the existing Lahari Railway wrapper.

## Current Worktrees

```text
/Users/ssaulgoodman/Code/lahari-media-engine/lahari-media-engine    main
/Users/ssaulgoodman/Code/lahari-media-engine/lahari-codex-native    codex-native-studio
/Users/ssaulgoodman/Code/lahari-media-engine/lahari-preset-abstraction mirage
```

`~/.local/bin/lahari-deploy` currently hardcodes:

```text
MAIN_WORKTREE="/Users/ssaulgoodman/Code/lahari-media-engine/lahari-media-engine"
```

## Dry-Run Finding

The two Lahari worktrees are clean, but `main` and `codex-native-studio` are not identical.

Many production changes exist on both branches as cherry-pick twins with different commit hashes. There are also real unique differences:

- `main` has recent production/accounting changes: Vertex video fallback removal, inference cost reporting, Google billing reconciliation.
- `codex-native-studio` has context/docs/case-study lineage: case-study source doc and screenshots, Codex-native notebook/draft/storyboard lineage, and several agent-operability documentation commits.

Do not blindly delete or switch either worktree without first reconciling these differences.

## Safe Collapse Plan

1. Create backup branch refs for both current heads.
2. Merge `main` into `codex-native-studio` inside `lahari-codex-native`.
3. Resolve any conflicts deliberately, preserving both production/accounting code and codex-native context/docs.
4. Run `npx tsc --noEmit`, `git diff --check`, and `npm run build` in `lahari-codex-native`.
5. Remove or park the old `lahari-media-engine` worktree, because Git cannot have branch `main` checked out in two worktrees.
6. Move/switch `lahari-codex-native` onto branch `main`.
7. Update `~/.local/bin/lahari-deploy` to point at `lahari-codex-native`.
8. Push `main`.
9. Deploy once from the new primary worktree and verify Railway success.

## Recommendation

Do not rename folders in the same pass. First make `lahari-codex-native` the real `main` worktree and deploy from it. If that holds for a few days, optionally rename the folder later.

## Completion Record

Executed on 2026-06-13.

- Backup refs created:
  - `backup/pre-collapse-main-20260613`
  - `backup/pre-collapse-codex-native-20260613`
- `main` was merged into `codex-native-studio` in `lahari-codex-native`.
- `lahari-media-engine` was parked on `archive/old-main-worktree-20260613`.
- `lahari-codex-native` was switched to `main`.
- `~/.local/bin/lahari-deploy` was updated to deploy from `lahari-codex-native`.

Current intended state:

```text
/Users/ssaulgoodman/Code/lahari-media-engine/lahari-codex-native    main
/Users/ssaulgoodman/Code/lahari-media-engine/lahari-media-engine    archive/old-main-worktree-20260613
/Users/ssaulgoodman/Code/lahari-media-engine/lahari-preset-abstraction mirage
```

Folder rename is still intentionally deferred. Keep `lahari-codex-native` as the primary Lahari engine path until the new deploy path has held steady.
