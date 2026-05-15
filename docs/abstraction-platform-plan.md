# Abstraction Platform Plan

**Status:** seeded design, ready for implementation on `abstraction` branch
**Date:** 2026-05-15
**Branch:** `abstraction` (use a separate worktree at `~/Code/lahari-media-engine/lahari-abstraction`)
**Scope:** turn Lahari's pipeline into a configurable platform that can serve multiple workflows (music video, anime, ads, reels) from one engine, without forking the codebase.

---

## Vision

Lahari's pipeline shape — **Intake → Blueprint → Looks → Studio → Render** — is the right spine for most single-seed video production. Today it's hardcoded for devotional music video from audio. The abstraction makes the spine reusable while letting domain-specific work live in configuration.

The bet: every new workflow (anime, ads, reels) becomes a `Workflow` + `Preset` definition + an intake adapter. No new pipeline code. No new repo. No engine fork.

---

## The Three-Axis Decomposition

| Axis | What it captures | Examples |
|---|---|---|
| **`SeedKind`** | What the user starts with | `audio`, `script`, `brief`, `document`, `idea` |
| **`Workflow`** | What path the project should follow | `music_video`, `anime_scripted`, `ads_brand`, `reels_short` |
| **`Preset`** | Taste, defaults, prompt rules, model picks | `music_video_default`, `anime_default`, `ads_premium` |

Concrete combinations:

- **Lahari today:** `seed: audio` + `workflow: music_video` + `preset: music_video_default`
- **Anime v1:** `seed: script` + `workflow: anime_scripted` + `preset: anime_default`
- **Future ads:** `seed: brief` + `workflow: ads_brand` + `preset: ads_premium`

Each axis is independent. A `music_video` workflow could in principle take a `script` seed (singer-actor lip-sync from a scripted scene). A `script` seed could feed `anime_scripted` or `ads_brand`. Don't lock the combinations — let presets gate the legal pairs.

---

## What Stays the Same

The pipeline shape itself. Every workflow goes through:

1. **Intake** — accept the seed, normalize, run any seed-specific analysis (audio structure, script parse, brief extraction)
2. **Blueprint** — concept, script, style, cast, environments
3. **Looks** — character + environment reference generation
4. **Studio** — per-shot production (storyboard or keyframe, video, refs)
5. **Render** — timeline composition + final mp4

The MCP tool surface — `list_projects`, `attach_director_session`, `apply_*`, `generate_*`, `write_project_notebook` — stays identical. Codex agents talking to one workflow can talk to all of them.

The R28 apply-only text architecture stays. The R29 prompt override system stays. The notebook tool stays.

---

## What Changes

### Database

**New Supabase project, clean `studio_*` schema.** Lahari prod stays untouched on `lahari_*` tables.

```bash
DB_TABLE_PREFIX=lahari   # existing prod, unchanged
DB_TABLE_PREFIX=studio   # new platform DB
```

Single env switch in `server/database.ts` picks the prefix. All `T['projects']`-style table-key map entries become prefix-aware. Same code, two backends.

**Schema diffs from `lahari_*`:**

- `studio_projects` adds: `seed_kind`, `workflow`, `preset` columns
- New table `studio_preset_definitions` (or load from code; either works for v1)
- `studio_intake_adapters` registry (not a table — code registry of intake handlers per `seed_kind`)
- Multi-tenant from day 1: every table gets `tenant_id` (or use `user_id` as the tenant boundary if single-user-per-tenant for v1)

Migration strategy: spin up new Supabase, run a migration that mirrors `lahari_*` schema with `studio_*` prefix + the additions above. Don't migrate Lahari data. Lahari can become "tenant: lahari" on the platform later, but that's a year-2 move.

### Intake Adapters

Each `SeedKind` needs an adapter that turns the seed into the same downstream shape Blueprint expects.

| SeedKind | Adapter responsibility |
|---|---|
| `audio` | Download → SRT parse → transcription fallback → structure detection → meaning summary (existing Lahari path) |
| `script` | Parse script format (Fountain / freeform markdown / Final Draft export) → extract scenes + characters + locations → emit equivalent of `musicalStructure` |
| `brief` | Accept freeform text + brand assets → extract goals, audience, tone → emit Blueprint seed |
| `document` | Accept PDF/Doc → extract structure → emit Blueprint seed |
| `idea` | Pure text prompt → expand into brief via LLM → route through brief adapter |

Adapters live at `server/intake/<seedkind>.ts`. Each exports a function `(seedRef) => Promise<BlueprintSeed>`. Pipeline asks the registry which adapter to run based on `project.seed_kind`.

### Presets

`server/presets.ts` defines preset rules that get composed into prompts at render time. Don't rewrite `server/prompts/catalog.ts` per preset — inject preset rules into the existing prompts.

```typescript
export const PRESETS = {
  music_video_default: {
    label: 'Music Video',
    workflows: ['music_video'],
    seedKinds: ['audio', 'script'],
    rules: {
      shotPacing: 'sync to musical structure',
      castDefault: 'singer + supporting',
      narrativeMode: 'visual-rhythmic',
      // ...
    },
    promptInjections: {
      concept: '...rules to merge into concept gen prompt',
      script: '...',
    },
    modelDefaults: {
      video: 'veo-3.1-fast',
      image: 'gemini-3-pro-image',
    },
  },
  anime_default: {
    label: 'Anime',
    workflows: ['anime_scripted'],
    seedKinds: ['script'],
    rules: {
      shotPacing: 'beat-driven from script',
      castDefault: 'character roster from script',
      narrativeMode: 'narrative-linear',
    },
    // ...
  },
};
```

Apply tools and generation paths read `project.preset`, look up the preset, and merge rules into the prompt. Engine prompt stays stable; preset rules layer in.

This is *complementary* to R29 project-level prompt overrides — preset = workflow defaults, R29 override = per-project customization on top.

### Workflow

`Workflow` defines the legal stage transitions and what's required at each. v1 stays close to Lahari's flow:

```typescript
export const WORKFLOWS = {
  music_video: {
    stages: ['intake', 'concept', 'script', 'style', 'cast', 'env', 'shots', 'render'],
    required: { audio: true, script: 'generated' },
  },
  anime_scripted: {
    stages: ['intake', 'concept', 'style', 'cast', 'env', 'shots', 'render'],  // skips script generation since seed IS the script
    required: { script: true, audio: false },
  },
};
```

Frontend reads workflow to gate UI. Backend reads workflow to validate transitions. Same Blueprint/Studio screens; some steps hidden or modified per workflow.

---

## Honest Soft Spots

Two assumptions in this plan are softer than they look. Don't promise yourself otherwise:

1. **Pipeline shape isn't free for every workflow.** Ads usually need a Brand Pack (logos, fonts, voice) *before* concept — doesn't fit Intake → Blueprint cleanly. Reels often skip Looks entirely. Plan for "stages can be skipped or inserted" not just "config inside fixed stages." This will surface around workflow #3 or #4. Build it then.

2. **"Inject preset rules into stable core prompts" sounds clean, will tangle in practice.** The engine prompt and preset rules will need either explicit composition rules or per-workflow prompt catalogs (R29 phase 2 shape). Don't promise yourself you can keep one global prompt forever. Once the preset rules become 30+ lines of injected text per prompt, it's time to split into per-workflow prompt catalogs.

3. **SeedKinds aren't symmetric.** Each is a different intake *adapter*, not just a different config field. Audio analysis ≠ script parsing. Plan for adapter code per SeedKind, not just enum values.

None of these block v1. They're notes for when the abstraction starts to leak.

---

## Execution Plan

### Setup (~1 day)

1. Create new Supabase project (suggested name: `turiya-studio` or whatever fits the platform brand)
2. Open the `abstraction` branch as a worktree:
   ```bash
   git worktree add ../lahari-abstraction abstraction
   ```
   Then open Codex / Claude Code in `~/Code/lahari-media-engine/lahari-abstraction`. This keeps the Lahari worktree free for parallel fixes.
3. Provision new Railway project with env vars pointing at the new Supabase
4. Pick the platform domain (e.g. `studio.media`, `lab.media`) and wire DNS to the new Railway

### Foundation (~3-4 days)

5. Add `DB_TABLE_PREFIX` env switch in `server/database.ts` — single conditional that picks `lahari_*` or `studio_*`. Probably ~30 lines.
6. Migration script that creates `studio_*` tables (mirror of `lahari_*` schema initially, plus `seed_kind`, `workflow`, `preset` columns on `studio_projects`)
7. Run migration against new Supabase
8. Deploy `abstraction` branch to new Railway. Verify backend boots, `/api/health` returns 200.
9. **First gate: verify `music_video` workflow runs end-to-end on new infra** — same app, new DB, new domain. Upload audio, generate concept, write script, generate looks, build a couple of shots, render. **If this works cleanly, the abstraction layer holds.**

### Preset layer (~2 days)

10. Add `Preset` + `Workflow` types in `server/types.ts`
11. Create `server/presets.ts` with `music_video_default` (rules extracted from current Lahari hardcoded behavior) and starter `anime_default`
12. Apply tools + generation paths read `project.preset` and merge rules into prompts
13. Frontend Blueprint reads `project.workflow` to gate UI

### Anime proof (~3-5 days)

14. Build `server/intake/script.ts` — script parser for at least Fountain + freeform markdown formats
15. Add `anime_scripted` workflow definition (skips audio analysis + script generation, since seed IS the script)
16. Modify Blueprint frontend to handle `seed_kind === 'script'` flow (no audio player, no analysis spinner; jump straight to concept + style)
17. End-to-end anime test: paste a script → generate concept → generate looks → build shots → render

### After both work (~ongoing)

18. Decide customer model: white-label per client vs multi-tenant SaaS. Doesn't change the foundation work; does change how branding + tokens scale.
19. Decide whether to migrate Lahari into the platform DB as `tenant: lahari` or keep them on separate infra forever. Year-2 question.
20. Add ads + reels workflows when there's actual customer demand.

**Total to first working anime test: ~1-2 focused weeks.**

---

## What NOT to Do

- **Don't migrate Lahari to `studio_*` schema yet.** Lahari prod stays where it is. The platform stands up beside it.
- **Don't try to support 5 workflows in v1.** Music video + anime is the proof. Everything else waits for demand.
- **Don't build per-client white-label branding yet.** Single domain, single brand for the platform until a second customer asks.
- **Don't fork the engine repo.** The whole point of the abstraction is to avoid forks. The moment you have two repos, you have two products to maintain.
- **Don't rewrite the prompt catalog** until preset injection clearly stops scaling. R29 phase 2 path (per-kind override) is the natural next step when needed.

---

## Open Questions

1. **Platform domain name.** Drives env config, OAuth redirect URLs, and the `/connect` page UX. Pick before step 4.
2. **Customer model.** Multi-tenant SaaS or per-client white-label? Doesn't change the next 2 weeks of work but shapes everything after.
3. **Codex skills strategy.** Same skills work across workflows (lahari-director, storyboard-prompt-craft, etc.) or per-workflow skills? Probably same with workflow-aware behavior. Decide when adding the second workflow.
4. **MCP server identity.** Single server (`studio.media/mcp`) serving all workflows under one MCP namespace? Or per-tenant subdomains (`lahari.studio.media/mcp`, `animeco.studio.media/mcp`)? v1 = single server. Subdomains can be added later.

---

## References

- **This repo's doctrine and ledger:** `docs/codex-native-doctrine.md`, `docs/codex-native-review-ledger.md`
- **R29 prompt override design:** `docs/r29-project-config-design.md` — the per-project override pattern that pairs with workflow presets
- **R28 apply-only text tools:** `docs/r28-apply-only-text-gen-design.md` — the architecture that stays the same across workflows
- **R17 distribution design:** `docs/r17-distribution-design.md` — the remote MCP shape that stays the same across workflows

When this design ships, file an `R36` (or next available number) entry in the ledger pointing at this doc + status.
