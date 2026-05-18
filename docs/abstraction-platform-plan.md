# Abstraction Platform Plan

**Status:** implementation underway on `codex/preset-abstraction`
**Date:** 2026-05-15
**Branch:** `/Users/ssaulgoodman/Code/lahari-media-engine/lahari-preset-abstraction` on `codex/preset-abstraction`
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

**Implemented schema diffs from `lahari_*`:**

- `studio_projects` adds: `seed_kind`, `workflow_key`, `preset_key`, `project_brief`, `source_payload`.
- Preset/workflow definitions currently load from code in `server/presets.ts`, not a DB table.
- Intake adapter shape is started in route/service code; the longer-term registry should live under `server/intake/<seedkind>.ts`.
- Tenant boundary for v1 is `user_id`/Supabase Auth. Do not add a separate `tenant_id` until the customer model is decided.
- The clean migration also creates the Codex-native harness tables: director events, agent operations, MCP tokens, project config, prompt overrides, render metadata.

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
2. Create a public `studio-assets` bucket
3. Run `migrations/2026-05-13_create_studio_workspace_schema.sql`
4. Point this branch/deployment at the new Supabase with `DB_TABLE_PREFIX=studio` and `SUPABASE_BUCKET=studio-assets`
5. Provision a separate Railway project/deployment when the local smoke test passes
6. Pick the platform domain (e.g. `studio.media`, `lab.media`) and wire DNS to the new Railway

### Foundation (~3-4 days)

Done in code:

- `DB_TABLE_PREFIX` env switch in `server/database.ts`
- `SUPABASE_BUCKET` / `STORAGE_BUCKET` switch in `server/storage.ts`
- Clean `studio_*` bootstrap migration
- `server/presets.ts`
- Anime script-first backend + Dashboard entry point
- `POST /api/projects/intake` accepts explicit `workflowKey`, `seedKind`, and optional `presetKey` for the new opening studio UX. It supports `music_video + audio` and `anime_scripted + script`; legacy `/api/projects` and `/api/projects/script` remain compatibility wrappers.

Next foundation gate:

- Run migration against the new Supabase project
- Verify backend boots against `DB_TABLE_PREFIX=studio`
- Verify `music_video` workflow runs end-to-end on new infra: upload audio, generate concept, write script, generate looks, build a couple of shots, render
- Verify the MCP/director harness can attach to a `studio_*` project without missing-table errors

### Preset layer (~2 days)

Done/started:

- `server/presets.ts` defines workflow recipes and presets.
- Generation paths read preset rules in key prompt builders.
- Project rows can store `preset_key`, `workflow_key`, `seed_kind`.

Remaining:

- Make MCP/project packets expose preset/workflow/seed explicitly.
- Make frontend Blueprint read `workflow_key` to hide or adapt irrelevant phases.
- Scrub `server/prompts/catalog.ts` before treating Prompt Library as product truth.

### Anime proof (~3-5 days)

Started:

- `POST /api/projects/script` creates a script-first anime project.
- `POST /api/projects/intake` is now the preferred workflow-first create route for frontend mode cards.
- `parseAnimeScriptToPlan` parses a script into scenes, shots, cast, and environments.
- Dashboard has a script-first anime project panel.

Remaining:

- Extract script intake into `server/intake/script.ts` once the route proves stable.
- Modify Blueprint frontend to handle `seed_kind === 'script'` flow cleanly: no audio player, no analysis spinner, no unnecessary script-generation step.
- End-to-end anime test: paste a script -> generate concept -> generate looks -> build shots -> render.

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
