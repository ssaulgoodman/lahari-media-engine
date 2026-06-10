# Lahari → Mirage Divergence Audit

**Date:** 2026-06-07
**Author:** Claude (managed by Saul)
**Purpose:** After the repo split, `lahari-media-engine` (artist-facing, lahari-specific
workflows) and this repo (`mirage`, the general agent-native video harness/plugin)
evolved independently. Lahari kept getting hardened as artists hammered it. Some of
those changes only patch lahari's own shortcomings; some are *general* improvements
this codebase should adopt. This is the differential ledger of what's worth porting.

## Method

- **Fork point:** `af791e6` (2026-05-18, "Use cmd npx for Windows notebook sync") —
  last common ancestor of `mirage` and lahari `main`.
- **Divergence since fork:** lahari = **52 commits**; mirage = **331 commits**.
- **Differential, not naive.** Mirage made 331 of its own commits, so every lahari
  change is checked against mirage's *current* code: does mirage already solve it,
  has it diverged intentionally, or is it genuinely missing? A lahari fix that mirage
  already handles (often better) is **SKIP**, not PORT.
- To reproduce: the lahari commits are fetched into this repo as `lahari-local/main`
  (`git remote add lahari-local ../lahari-media-engine`). `git show <hash>` works here.

## Legend

- **Classification** — `GENERAL` (applies to any video harness) · `LAHARI-SPECIFIC`
  (tied to the legacy `queue`/`songs` artist surface or lahari ops) · `MIXED`.
- **Mirage status** — `missing` · `partially-has` · `already-has` ·
  `diverged-intentionally` · `needs-human-check`.
- **Recommendation** — `PORT` (adopt ~as-is) · `ADAPT` (port the idea, rework for
  mirage's architecture) · `INVESTIGATE` · `SKIP`.
- **Effort** S/M/L · **Risk** low/med/high.

---

## Priority shortlist

Ranked by value relative to effort×risk. **10 actionable items; the other ~30 commits
are SKIP** (mirage already has it, mirage diverged intentionally, it's legacy
`queue`/`songs`-specific, or it's a net-zero revert). Full disposition in the appendix.

### Tier 1 — do these

1. **Duplicate-generation guard** — `837bd15` (A) · ADAPT · S · low risk
   Prevents double-*charging* when a paid generation is double-fired (double-click, agent
   retry). This is the *prevention* layer that pairs with the charge-risk ledger (the
   *accounting* layer) we built for Kie today. Mirage has no in-flight lock at all.

2. **Non-destructive single-shot add/delete** — `a7fdad8` + `8a44801` (C) · PORT pair · M · med risk
   Adds `add_extra_shot` / `delete_extra_shot` MCP tools + an `is_extra` column. **Today
   mirage can only add or remove a shot via a destructive `apply_script` rebuild** (gated
   by `allowDownstreamVisualWipe`). Biggest capability gap in the whole audit and a core
   agent-native win. Delete preserves paid asset rows and force-gates on generated assets.

3. **Render cancellation + blind-update hardening** — `2d6067d` (B) · PORT · M · low risk
   No way to cancel an in-flight render in mirage. Also fixes a **latent bug**: mirage's
   renderer-reject path (`server/routes/render.ts:312`) does an *unconditional* `updateRows`
   that can clobber a render row that already moved on — the commit brings the conditional
   `.eq('status','rendering')` guard. Port the hardening even if you defer the Cancel UI.

### Tier 2 — high value, smaller

4. **Artist cross-project memory** — `b16741e` (C) · PORT · M · low risk
   Read-only `query_artist_memory` + `search_artist_assets` over the artist's prior
   projects/assets. Mirage has zero cross-project agent memory (all read tools are
   single-project). **Landed in Mirage** as read-only cockpit tools, not registry actions.
   Security review: user ownership is server-authoritative (`auth.userId`), projectId only
   narrows the owned set, and asset search scopes by owned project IDs. Known limit: asset
   recall ranks over the 500 most-recent owned assets before scoring.

5. **Storyboard-lock in shot header** — `3d568c2` (D) · PORT · M · low risk · **landed 2026-06-10**
   In Seedance storyboard mode the header lock now locks/unlocks the *storyboard* (the unit
   the artist signs off on), not the shot. Ported `canLockStoryboard`/`visibleLocked` to
   Mirage's `ShotCard`; expanded-panel locks route through the panel's `handleLock` (token
   bridge) so plan-flush and versionId resolution still apply, and the panel's own
   lock/unlock controls hide behind `hideLockControls` so the header is the single surface.
   Kept Mirage's `isLockingShot` spinner on the non-storyboard path.

6. **Fail loud on empty look batches** — `eb51137` (A) · PORT · S · low risk · **landed 2026-06-08**
   Mirage's Gemini batch look functions now retry once on the alternate Gemini image model, then
   throw if a whole batch returns empty. This prevents a failed persona/reference setup from
   surfacing as a silent successful no-op.

### Tier 3 — refinements / conditional

7. **ffmpeg benign-layout eligibility** — `a75ab45` (B) · ADAPT · S · med risk · **landed 2026-06-10**
   Adapted as designed: `hasLayoutOverrides` (any layout key present → Remotion) replaced
   with `hasNonDefaultLayout(details, size)` — benign means "reproduces the ffmpeg path's
   own contain-centered-on-canvas composition" (zeros, canvas-size width/height, identity
   scale in either unit convention, zero rotation, `contain`/`center`, empty crop). Real
   transforms/crops and unparseable values still force Remotion. Lahari's wholesale delete
   was NOT ported.

8. **Split paid rate limits (image vs video)** — `4c7c561` (A) · ADAPT · S · low risk
   Mirage lumps all paid tools into one `mcp:paid`/day bucket; video costs far more than
   images. Split via the `actionSpec.paid` category, with `MIRAGE_*` env names.

9. **Inference cost export + billing reconciliation** — `4a63f2d` + `183b113` (D) · ADAPT pair · M · low risk
   Standalone script reading mirage's *existing* `lahari_ai_calls.cost_estimate` ledger;
   weekly/monthly/by-provider CSVs + Google-invoice-vs-estimate reconciliation. Strip the
   song/title joins down to project-level; **do not** import the committed CSV spend data.

10. **Render take-library hide/upload endpoints** — `a3151bb` + `881cda9` (D) · CONDITIONAL · M · low risk
    Generic, queue-free media-library endpoints. Only worth it **if** mirage adopts a
    render-side media-library drawer; port the server endpoints, evaluate the UI separately.

---

## Cluster A — charge-safety / provider / generation correctness

This is the cluster most connected to mirage's reliability story (the generation-attempt
ledger + charge-risk semantics). Audited directly.

### 837bd15 — Prevent duplicate paid shot generations
- **classification:** GENERAL · **mirage-status:** missing · **recommendation:** ADAPT
- **effort:** S · **risk:** low
- **what-it-does:** Adds a 10-line in-process guard `server/services/inFlightGeneration.ts`
  (`beginInFlightGeneration(key) -> release | null`). Each paid generation entry point
  (image / storyboard / end-frame / video) takes a per-shot lock; a second concurrent
  request gets `409 "already running"` instead of firing a second paid call. Released in
  `finally`.
- **mirage-gap:** Mirage has **no** in-flight guard. A double-click or agent retry can
  fire two paid generations for the same shot simultaneously — each one charges. This is
  the *prevention* layer that complements the *accounting* layer (the charge-risk ledger)
  we built for Kie today: the ledger tells you when a charge is at risk; this stops the
  duplicate charge from ever starting.
- **adapt note:** Port the module as-is, but mirage's paid entry points are broader than
  lahari's web routes — the agent path (`start_job` / director) must take the same lock,
  not just the web routes. Lock key should be `{kind}:{projectId}:{shotId}`. Caveat:
  in-process `Set` only dedups within one server instance; for multi-instance it's a
  cheap first layer, with the DB ledger as the cross-instance backstop. Worth stating in
  code comments so nobody mistakes it for distributed locking.
- **mirage-files:** `server/services/inFlightGeneration.ts` (new),
  `server/routes/generate-shots.ts`, `server/routes/generate-video.ts`, and the
  agent-side paid dispatch (`server/routes/mcp.ts` start_job / `actionRegistry`).

### eb51137 — Fail loudly on empty look generations
- **classification:** GENERAL · **mirage-status:** partially-has · **recommendation:** PORT
- **effort:** S · **risk:** low
- **mirage-status update 2026-06-08:** landed in `server/services/imagen.ts` for Gemini
  character/environment look batches. If 0/N variants return, Mirage retries once with the
  alternate Gemini image model when available, then throws a clear error instead of returning
  an empty candidate list.
- **what-it-does:** After generating N parallel character/environment look variants, if
  *all* came back empty (`paths.length === 0`), throw instead of returning an empty look
  set. Adds a one-shot alternate-model retry before giving up.
- **mirage-gap:** Mirage throws on empty at the *single-call* level (`imagen.ts:63`), but
  its **batch** look functions only log `got 0/N` and return — `generateCharacterLooks`
  (`imagen.ts:301`) and `generateEnvironmentLooks` (`imagen.ts:396`) have no all-empty
  guard. So a fully-failed look batch surfaces as a silent empty result, not an error.
- **mirage-files:** `server/services/imagen.ts` (add all-empty throw after the batch
  gather in both look functions; optionally the alternate-model retry).

### 4c7c561 — Split paid generation rate limits
- **classification:** GENERAL · **mirage-status:** partially-has · **recommendation:** ADAPT
- **effort:** S–M · **risk:** low
- **what-it-does:** Splits a single paid-calls-per-day MCP limit into separate
  `paid-image` and `paid-video` buckets (video is far more expensive, so one shared bucket
  either over-throttles images or under-throttles video).
- **mirage-gap:** Mirage uses a **single** `mcp:paid` bucket for *all* paid tools
  (`mcp.ts:833`, `MCP_LIMITS.paidPerDay`). The idea is sound; the implementation must be
  reworked: mirage classifies paid via `actionSpec(...).paid` on `run_action`/`start_job`/
  `parallel_run`, so the image-vs-video split should come from the action spec's category,
  not lahari's static `PAID_*_TOOLS` sets. Use `MIRAGE_*` env names, not `LAHARI_MCP_*`.
- **mirage-files:** `server/routes/mcp.ts`, `server/routes/director.ts`,
  `server/services/rateLimit.ts`, `server/services/actionRegistry.ts` (paid category).

### aa988fd — Disable Vertex video fallback
- **classification:** LAHARI-SPECIFIC · **mirage-status:** diverged-intentionally · **recommendation:** SKIP
- **what-it-does:** Rips the Vertex Veo fallback out of `video-provider.ts` entirely
  (-88 lines); commits lahari to Segmind-only video. Doc: "Vertex Veo fallback is unplugged."
- **why skip:** Mirage already neutralizes Vertex for the platform lane — the fallback is
  gated behind `!studioSchema` (`video-provider.ts:147`, `:157`), so in the Mirage `studio`
  schema Vertex never runs, while the legacy lane keeps it. And mirage's identity is *more*
  providers (we added Kie today), not fewer. Full removal is an anti-goal here; mirage's
  schema-gated approach is strictly more flexible.

### d7bbfb0 — Route visual generation through Segmind
- **classification:** LAHARI-SPECIFIC · **mirage-status:** diverged-intentionally · **recommendation:** SKIP
- **what-it-does:** Deletes `imagen.ts` (-710), `openai-image.ts` (-398),
  `vertex-video.ts` (-159); routes all *image* generation through Segmind. Lahari committed
  to a single image provider.
- **why skip:** Directly anti-mirage. Mirage's default image model is Gemini 3 Pro Image
  ("Nano Banana Pro") with flash fallback, plus `nano-banana-2` / `gpt-image-2` alternates —
  provider richness is a core design value. The only possibly-portable scrap is the small
  extracted `imagePrompts.ts` (+57), but mirage already has its own prompt composer.
  Note: `eb51137`'s loud-fail logic lives in lahari's post-Segmind path; the *idea* still
  ports to mirage's retained `imagen.ts` (see above), independent of this refactor.

---

## Cluster B — render / timeline robustness

**Architectural fork resolved for C3:** lahari built a **server-canonical timeline**
(`lahari_project_timelines` + `lahari_timeline_versions` tables, `GET/PUT /timeline`,
`/restore`, `/versions`, Supabase realtime publication, optimistic-concurrency / last-write-
wins). Mirage originally stayed localStorage-only (`components/timeline-editor/persistence.ts`,
debounced autosave, no server row/realtime/version history). We adopted the product decision
for Mirage C3 and ported the base architecture: shared project timeline row, immutable
versions, local browser drafts, explicit Save to promote local to canonical, Restore, and Reset.
Mirage kept its better shotId-keyed `reconcileSnapshotWithInitialClips` + media-library badge
instead of copying lahari's src-string matching. Remaining C3 follow-up: realtime remote-change
notification and agent/API timeline-edit actions.

Two genuine ports:

### 2d6067d — Add render cancellation  ·  PORT · M · low
Adds `POST /:id/renders/:renderId/cancel` (guarded status transitions, conditional update,
director event), `'cancelled'` to `RenderStatus`, finalized-state handling in the callback,
and a Cancel button. Mirage has **no** cancellation anywhere (`render.ts`,
`render-callback.ts`, `StepRender.tsx`). Bundled win: the commit also converts the
renderer-reject failure update to a conditional `.eq('status','rendering')`, fixing mirage's
**unconditional blind `updateRows` at `render.ts:312`** + the missing `'cancelled'` in
`render-callback.ts:84`'s finalized guard. Adapt to mirage's `updateRows`/`selectOne`
helpers (table is prefix-mapped `lahari_renders`) and param-guarded routing — don't copy
lahari's hardcoded `getSB().from('lahari_renders')`.

### a75ab45 — Allow ffmpeg render with benign layout metadata  ·  ADAPTED · landed 2026-06-10
Lahari deletes the `hasLayoutOverrides` eligibility gate so timelines carrying default
layout fields take the fast ffmpeg path instead of falling back to Remotion. Mirage ported
the *intent*, not the delete: `hasNonDefaultLayout(details, size)` passes only values that
reproduce the ffmpeg path's own composition (objectFit `contain` centered on the full
canvas — zero offsets, canvas-size width/height, identity scale, zero rotation, empty
crop); real transforms/crops and unparseable values still force the Remotion fallback.

Server-timeline chain status: `d394179`, `75b1d1b`, `41d09ad`, `ec6e879`, `c90d4f8`,
`5768e10`, `bc4931a`, `5105dd8`, and `28fd4e5` are now **ADAPTED as the C3 base**, except
for realtime notification, which remains open. Everything else SKIP: `6d01cce`/`a074289`/
`ddec68b` mirage already has equivalents; `d8774ea` is lahari-catalog stale-audio;
`52b26fe`+`3a7018e` is a net-zero revert touching legacy `music_video_queue`.

---

## Cluster C — MCP / agentic surface + shot features

Mirage's MCP surface is generally **richer** than lahari's here, so most of this cluster is
already-surpassed. Two real ports — and the standout of the whole audit lives here.

### a7fdad8 + 8a44801 — Extra-shot add/delete  ·  PORT pair · M · med
`add_extra_shot` appends a single out-of-band insert/B-roll shot into an "Extra Shots" scene
**without rewriting the script or touching existing shots**; `delete_extra_shot` removes
exactly one `is_extra` shot (refuses canonical shots, force-gates on generated assets, and
**preserves paid asset rows** even on force). Extra shots are excluded from the auto-seeded
render timeline and surface in the media library for manual placement. **Mirage has zero
single-shot insert/delete** — the only path is `apply_script` (`applies/script.ts:56` deletes
all shots, gated by `allowDownstreamVisualWipe:145`), i.e. adding one B-roll shot requires a
destructive topology rebuild. The conservative asset-preserving delete semantics match
mirage's existing posture. ADAPT plumbing only: lahari ships a `lahari_apply_script` Postgres
RPC update for `is_extra`; mirage inserts shots TS-side, so it needs only the additive
`is_extra` column migration + the TS service + a `StepRender.tsx` timeline filter.

### b16741e — Artist memory query tools  ·  PORTED · M · low
Read-only `query_artist_memory` (NL search over the artist's prior projects — styles, models,
taste patterns) and `search_artist_assets` (cross-project asset search → public URLs), both
strictly `user_id`-scoped. Mirage's read tools (`list_projects`, `resolve_project`,
`get_project_packet`) are all single-project — no cross-project memory exists. All deps
present (`T.projects`/`T.assets`, `storageUrl`, `webStudioUrl`); map legacy `song_type`/
`is_narrative` → mirage workflow fields.

Mirage status: landed as `query_artist_memory` and `search_artist_assets`, both read-only MCP
cockpit tools. The caller cannot supply `userId`; both queries derive it from authenticated
context and route through owned projects. `search_artist_assets` is deliberately bounded and
currently scans the 500 most-recent owned assets before ranking, so older library search can be
promoted to an indexed path if artists outgrow that window.

SKIP: `6109100` MCP tracing (mirage's `mcp_audit_events` + `get_agent_timing_summary` with
p50/p90/max inter-tool gaps already surpasses flat trace rows); `0bcb669` per-entity visual
ref tools (mirage's generic `generate_candidates`/`lock_reference` + `generate_style_
candidates` model is architecturally superior — lahari's own `434470c` is a design note
*asking for what mirage already shipped*); `434470c` that doc note.

> Prompt-discipline note for both ports (per CLAUDE.md): new tools must be mirrored into
> `actionRegistry.ts` / `tools/registry.ts` / `PromptsLibrary.tsx` and the
> `HOSTED_MCP_INSTRUCTIONS` + read-only-prefix lists, not just registered in `mcp.ts`.

---

## Cluster D — media library / UI polish / cost & budget / reverts

Mostly confirmed lahari-specific, as expected. The genuine wins were promoted to the
shortlist (`3d568c2` storyboard-lock-in-header; `4a63f2d`+`183b113` cost export +
reconciliation — both reading mirage's existing `lahari_ai_calls.cost_estimate` ledger;
`a3151bb`+`881cda9` queue-free media-library endpoints, conditional on a drawer).

Confirmed SKIP: the **queue-UI subcluster** (`84f4c27`, `55390ca`, `14c743e`, `12d2f64`,
`2af2b4c`) all edit `components/Dashboard.tsx`, **which does not exist in mirage** (intake is
`StartProject.tsx`). The **budget-dashboard subcluster** (`9d57ed7`, `6a945ea`, `9eae666`,
`6b62079`, `d379000`) is hardwired to `music_video_queue`+`songs` (song_name/isrc/deity) and
is superseded for the portable need by the export script. `7844c35` tab-local nav is already
present (`usePersistedProject.ts`). `a1878b7`/`ad49b6d`/`0fb26ea`/`3d3e6e4` are net-zero
add/revert pairs. `3d8f190`/`25c50e3` are cosmetic; `0b740cd` is a lahari-only deploy doc.

---

## Appendix — full 52-commit disposition

Legend: ✅ PORT · 🔧 ADAPT · 🟡 CONDITIONAL/INVESTIGATE · ⛔ SKIP

| Commit | Cluster | Subject | Class | Mirage status | Disp |
|---|---|---|---|---|---|
| 837bd15 | A | Prevent duplicate paid shot generations | GENERAL | missing | ✅ ADAPT |
| eb51137 | A | Fail loudly on empty look generations | GENERAL | partially-has | ✅ PORT |
| 4c7c561 | A | Split paid generation rate limits | GENERAL | partially-has | 🔧 ADAPT |
| aa988fd | A | Disable Vertex video fallback | LAHARI | diverged (studioSchema gate) | ⛔ |
| d7bbfb0 | A | Route visual generation through Segmind | LAHARI | diverged (provider-rich) | ⛔ |
| a7fdad8 | C | Add context-aware extra shots | GENERAL | missing | ✅ PORT |
| 8a44801 | C | Add safe extra shot deletion | GENERAL | missing | ✅ PORT |
| b16741e | C | Add artist memory query tools | GENERAL | landed as read-only cockpit tools | ✅ PORTED |
| 6109100 | C | Add MCP call tracing | GENERAL | already-has (richer) | ⛔ |
| 0bcb669 | C | Expose MCP visual reference tools | GENERAL | already-has (superior) | ⛔ |
| 434470c | C | Document MCP v2 intent surface | GENERAL (doc) | already-has | ⛔ |
| 2d6067d | B | Add render cancellation | GENERAL | missing | ✅ PORT |
| a75ab45 | B | Allow ffmpeg render w/ benign layout metadata | GENERAL | missing | 🔧 ADAPT |
| 6d01cce | B | Append generated clips to restored timelines | GENERAL | already-has (better) | ⛔ |
| a074289 | B | Protect render timeline drafts | GENERAL | already-has | ⛔ |
| ddec68b | B | Prevent timeline reseed from clip refresh | GENERAL | already-has (diff mech) | ⛔ |
| d8774ea | B | Drop stale timeline audio when project has none | MIXED | missing | ⛔ (lahari catalog) |
| d394179 | B | Share render timeline drafts | MIXED | diverged (local-only) | ⛔ |
| 75b1d1b | B | Sync render timeline from realtime updates | MIXED | diverged | ⛔ |
| 41d09ad | B | Enable realtime timeline publication | LAHARI | n/a (no table) | ⛔ |
| ec6e879 | B | Add recoverable timeline history | MIXED | diverged | ⛔ |
| c90d4f8 | B | Simplify timeline saves to last-write-wins | MIXED | diverged | ⛔ |
| 5105dd8 | B | Keep timeline autosave local only | GENERAL | already-has (by constr.) | ⛔ |
| 5768e10 | B | Prefer local timeline draft on reload | LAHARI | already-has trivially | ⛔ |
| bc4931a | B | Treat matching timeline draft as saved | LAHARI | n/a | ⛔ |
| 28fd4e5 | B | Fix timeline save feedback and history duration | MIXED | partially n/a | ⛔ |
| 52b26fe | B | Restore render audio from queue fallback | LAHARI | n/a (reverted) | ⛔ |
| 3a7018e | B | Revert "Restore render audio from queue fallback" | — | net-zero | ⛔ |
| 3d568c2 | D | Use storyboard lock in shot header | GENERAL | missing | ✅ PORT |
| 4a63f2d | D | Add inference cost reporting sheets | MIXED | missing | 🔧 ADAPT |
| 183b113 | D | Add Google billing reconciliation to cost reports | MIXED | missing | 🔧 ADAPT |
| a3151bb | D | Hide render media library takes | GENERAL | missing | 🟡 COND |
| 881cda9 | D | Improve render media library uploads | GENERAL | missing | 🟡 COND |
| 52aadd5 | D | Mark new render media clips | GENERAL | needs-check | ⛔ (follow-on) |
| a1878b7 | D | Add generated media library clips | — | reverted | ⛔ |
| ad49b6d | D | Clarify generated media library clips | — | reverted | ⛔ |
| 0fb26ea | D | Revert "Add generated media library clips" | — | net-zero | ⛔ |
| 3d3e6e4 | D | Revert "Clarify generated media library clips" | — | net-zero | ⛔ |
| 7844c35 | D | Make project navigation tab-local | GENERAL | already-has | ⛔ |
| 3d8f190 | D | Remove text model helper copy | GENERAL | cosmetic | ⛔ |
| 25c50e3 | D | Shorten storyboard provider label | GENERAL | diverged (cosmetic) | ⛔ |
| 84f4c27 | D | Make queue filters status-based | LAHARI | n/a (no Dashboard) | ⛔ |
| 55390ca | D | Show needs audio queue filter | LAHARI | n/a | ⛔ |
| 14c743e | D | Show queue collaborators by email | LAHARI | n/a | ⛔ |
| 12d2f64 | D | Make queue collaborator hover visible | LAHARI | n/a | ⛔ |
| 2af2b4c | D | Improve queue collaborator chip contrast | LAHARI | n/a | ⛔ |
| 9d57ed7 | D | Add dev account budget dashboard | LAHARI | missing | ⛔ (song-centric) |
| 6a945ea | D | Fix dev budget viewer access | LAHARI | n/a | ⛔ |
| 9eae666 | D | Fix dev budget target email | LAHARI | n/a | ⛔ |
| 6b62079 | D | Add artist account budget filtering | LAHARI | n/a | ⛔ |
| d379000 | D | Polish budget dashboard tables | LAHARI | n/a | ⛔ |
| 0b740cd | D | Document token-based Lahari deploy helper | LAHARI | diverged | ⛔ |

**Totals:** 7 PORT · 4 ADAPT · 2 CONDITIONAL · 39 SKIP (of which ~14 are already-has/better
in mirage, ~13 legacy queue/songs-specific, ~7 server-timeline architecture, 5 net-zero reverts).

## How to act on this

These are candidates, not a queue. Each Tier-1/2 item is independently shippable as its own
reviewed slice (same posture as the Kie provider work). Suggested first slice: **`837bd15`
duplicate-generation guard** — smallest, highest charge-safety value, and it closes the
prevention/accounting loop with the ledger work already in flight. The extra-shot pair
(`a7fdad8`+`8a44801`) is the highest-*capability* win but is the larger lift (new column +
tools + prompt-surface mirroring).
