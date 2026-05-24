# Mirage Platform v1 — Source of Truth Ledger

**Status:** 🔒 LOCKED 2026-05-18 — execution begins next session
**Date:** 2026-05-18
**Branch:** `mirage`
**Owners:** Claude + Codex working in parallel tracks
**Supersedes:** `docs/v1-platform-finish-line-plan.md`, sections of `docs/abstraction-platform-plan.md`, sections of `docs/preset-abstraction-plan.md`

**Lock contract:** §2 (Locked Decisions), §3 (Architecture), §7 (Contracts) do not change without raising in §8 (Open Questions), discussing, and explicitly amending with a new D-number or contract-version. Track/task content (§4, §6) can be adjusted during execution as we learn; log every adjustment in §9 (Checkpoints).

This is the single source of truth for getting Mirage Platform v1 shipped. Every locked decision, contract, file path, and acceptance criterion lives here. If something contradicts an older doc, this wins.

Both Claude and Codex read from and append progress to this ledger. Pick a task by its ID (e.g. `T3.2`), do it, check it off, log a one-line note in the Checkpoints section.

**Navigation:** §2 (locked decisions D1-D26), §3 (architecture), §4 (tracks T1-T10), §6 (sequencing), §7 (contracts), §8 (open questions), §9 (checkpoints, append-only). When jumping in cold, read your owned tracks in §4 + tail §9 for what just shipped. The whole file is the single source of truth; if older docs disagree, this wins.

---

## 1. Scope

**Ship:** A clean hosted studio at a Mirage-branded domain where outside artists sign in, create music-video or anime projects from intake, work the pipeline through Studio + Render, and (for anime) produce dialogue via TTS. Anime is the first external workflow.

**Two-surface contract:** every authoring operation has a web studio surface (backend LLM endpoint + UI button) and a Codex MCP surface (apply-only tool consuming harness-native text gen). Both converge at the apply layer — the apply tool is the constraint-and-persistence seam.

**Brand:** Mirage. New npm scope `@mirage/*`, new Railway app, new Supabase project, new domain (TBD), separate MCP server. Lahari production stays untouched on its own infra.

**v1 done when:**
1. A new artist signs in at the Mirage domain.
2. They can create a music-video project from audio (no regression vs current behavior).
3. They can create an anime project from script.
4. Both projects store `workflow_key + seed_kind + preset_key` and read correctly from the `studio_*` schema.
5. The artist sets their own API keys for every paid provider before any AI call runs (BYOK enforced).
6. For anime: dialogue gets written per shot in the Script phase, voices get assigned per character in the Characters phase, TTS gets generated in the Audio phase.
7. Codex Desktop attaches via Mirage MCP, sees the project mode in its packet, and can run the audio-blueprint tools to write/regenerate audio plans and trigger TTS.
8. Render produces an mp4 with dialogue overlaid for anime shots with `dialogueStrategy: 'overlay_at_render'`.
9. Music video render path unchanged.

**Out of scope for v1 (deferred to v1.5+):**
- Lahari→Mirage data migration. Lahari prod stays on Lahari infra.
- Voice library / per-tenant saved voice pool. v1 = paste voice ID inline.
- Voice preview button in UI. v1 = first TTS gen IS the preview.
- ElevenLabs sound-effect API integration. v1 = SFX lives as free-text `soundNotes`, video gen renders ambient.
- `audio_lipsync` strategy. v1 = `overlay_at_render` and `bake_into_video` only.
- Ads/reels workflows.
- Multi-tenant white-label.
- Voice preview affordances beyond the post-gen audio asset.

---

## 2. Locked Decisions

Every one of these has been debated and settled in conversation. Don't re-litigate without raising it in the Open Questions section.

| # | Decision | Rationale |
|---|---|---|
| D1 | Three-axis decomposition: `SeedKind` + workflow profile + `PipelinePreset` | Implemented in `server/presets.ts`. Workflow profile identifies the planner/source spine; seed kind picks intake adapter; preset injects taste/prompt-rules/model-defaults. Tool availability now comes from `server/tools/registry.ts`, not workflow stages. |
| D2 | `audio_plan` is the only home for dialogue text. Script schema has no dialogue field | Single source of truth; protects TTS investment from script edits; independent staleness per layer |
| D3 | `dialogueVideoMode` is project-level, two values: `lipsync` and `overlay`. `lipsync` prompts the video model to perform speech and mouth movement natively from dialogue text; TTS is not required for video generation. `overlay` uses generated TTS as a render-time audio layer | The artist picks one delivery strategy for the project. Per-shot `audio_plan.dialogueStrategy` is legacy data only and must not block generation or drive UI. Legacy music-led `lipsync_enabled` remains separate song-lipsync behavior |
| D4 | `soundNotes` is free text on `audio_plan`, not a structured SFX array. Video gen produces ambient | Aligns with Saul's "manage SFX via video gen" call; zero new render plumbing for v1 |
| D5 | BYOK across ALL providers for every Mirage tenant including Saul. No platform env fallback in Mirage app code | Dogfood the real path; one code path; one mental model; simpler |
| D6 | BYOK requirement scope split into "required at /connect" vs "optional, prompted at feature use". **Required at /connect per workflow:** `music_led` = segmind + gemini (video + image via Segmind; audio analysis via Gemini); `scripted_narrative` = segmind + elevenlabs (video + image via Segmind; TTS via ElevenLabs). **Optional (only needed for pure web-studio users who never use a harness):** anthropic (web-studio AI buttons like Generate Concept / Script / Refine / Write Audio Plan); openai (gpt-image-2 storyboard, GPT script-writer option). Account Keys UI surfaces these as optional with copy like "Only needed if you generate via the web studio without using Codex Desktop or Claude Code." Google AI Studio key is required for `music_led` (audio analysis) and optional for `scripted_narrative` (only if switching image gen back to Google directly) | Both supported harnesses bring their own LLM subscription: Codex Desktop uses its Claude/OpenAI; Claude Code uses Anthropic. Harness users do all text gen harness-native and never hit backend Anthropic/OpenAI endpoints. So those keys are pure-web-studio concerns and shouldn't block /connect onboarding for harness users |
| D7 | Separate npm package (`@ssaulgoodman420/mirage-mcp-server`), separate Railway app, separate Supabase, separate domain | Different MCP tool surface, different schema, different brand — same MCP url with route-by-tenant was wrong |
| D8 | Fork CLI: `packages/lahari-cli` → `packages/mirage-cli`, repoint URL/env var | CLI calls the studio backend; needs to point at Mirage Railway |
| D9 | Apply-only seam for audio (R28 pattern). Codex writes JSON, apply tool validates+persists | Doctrine §4; no double-hop; same pattern as `apply_script_markdown`, `apply_shot_prompts` |
| D10 | Blueprint phases reordered to: Concept → Script (with dialogue text) → Style → Characters (with voice IDs) → Environments → Audio (TTS production) → Studio | Dialogue is part of script reading; voice belongs with character identity; Audio phase becomes "produce speech" not "write speech" |
| D11 | Music-led has no Audio tool surface in v1. Audio affordances are registry-gated, not stage-gated | Music-led already has primary audio (the song); no useful dialogue/TTS UX for v1 unless an explicit future tool is added |
| D12 | First TTS provider: ElevenLabs. Voice provider is per-cast-member, not per-project | Per-voice provider future-proofs adding a second TTS later (`cast.voice_provider` switches per character) |
| D13 | `audio_plan_stale` is a separate flag from `prompts_stale` | Lahari already conflates two prompt-staleness signals on one column; don't repeat that mistake |
| D14 | Cost preview required before bulk TTS gen (route + UI modal) | BYOK = cost is visible to tenant; need to show before charging their ElevenLabs key |
| D15 | Tenant API keys encrypted at rest. App-level AES via `MIRAGE_ENCRYPTION_KEY` env, not pgcrypto | App-level keeps key out of DB backups; rotation is one env swap (with re-encrypt migration if needed) |
| D16 | Mirage (this branch) and Lahari (main) are permanently divergent. No merge-back. Engine bugfixes are cherry-picked between branches as needed | Product shapes differ at the entry surface (Lahari = curated queue, Mirage = open-signup intake), at /connect, at brand, at BYOK enforcement — too many fork points to gate cleanly in one codebase. Shared-engine package extraction is a v2 escape hatch when cherry-pick pain becomes real |
| D17 | Bootstrap migration `2026-05-13_create_studio_workspace_schema.sql` is frozen the moment first Mirage Supabase runs it. All new schema lands in dated additive migration files. No edits to the base after that | Avoids divergent reality between fresh deploys and existing instances; standard practice; closes the waffle the audit doc had on this |
| D18 | Engine session protocol: bugfix lands on the branch where the bug was discovered. Cherry-pick to the other branch in the same session if it applies. Lahari hotfixes start on `main`; Mirage features start on `mirage` | Forces the cherry-pick discipline to live in the moment, not "later". Annotate with `cherry-pick from <sha>` in commit message for traceability |
| D19 | Hard TTS spend cap per user per day: $20 USD equivalent, hardcoded in v1. Configurable per-tenant in v1.5 | Cost preview is a check, not a stop. Runaway agent loops could burn hundreds before noticed. $20 is a tight but workable ceiling for v1 |
| D20 | Mirage uses Segmind as the single provider for both image gen and video gen. Default models in Mirage presets resolve to Segmind routes (including Nano Banana Pro, Nano Banana 2, Seedance, Veo). No Vertex / GCP fallback in Mirage runtime. If a Segmind call fails, the call fails (no silent retry to Google) | Saul confirmed Segmind has all image models needed. Collapses required keys (anime = Segmind + ElevenLabs only). Drops GCP runtime dependency from Mirage entirely. Lahari (`main`) keeps Vertex fallback for its own continuity |
| D21 | Schema interpretation doctrine: `project_brief` is artist/director intent; `source_payload` is raw seed material; `target_duration` is default per-shot pacing only; music-video analysis fields (`lyrics`, `meaning`, `musical_structure`, `song_type`, `is_narrative`, `is_meditative`, `analysis_step`) are music-video compatibility fields and must not be repurposed by anime/ads/reels; `audio_plan` is the home for dialogue/TTS/strategy; `lipsync_enabled` is legacy song-lipsync and not the anime dialogue path | Prevents future workflows from repeating the `target_duration` collision. Keeps the schema stable without destructive v1 migrations |
| D22 | Mirage is backend-first, with explicit realtime exceptions. Browser data truth comes from backend API responses. Direct Supabase client usage is allowed only for auth and explicit realtime presence/update surfaces; those surfaces must be table-prefix aware and backed by owner-scoped RLS policies. New tables default to backend-only until deliberately exposed | Preserves the harness-first mental model while keeping useful live update affordances. Avoids silent client failures from RLS-enabled tables with no policies or hardcoded Lahari table names |
| D23 | Agent harness is the primary product surface. Beta cohort is Codex Desktop / Claude Code users. Web Studio is overwatch + occasional human nudge, not the primary working surface. UI changes serve the agent first: legible state, no gates the engine doesn't enforce, no UI affordance for things the agent can't also do. The artist surface is a thin observer/operator on top of the same tool registry the agent uses. | First-cohort users are harness-native by design. Duplicating agent capability inside the web UI is wasted scope. Agent does the production work; UI shows state and lets humans nudge. |
| D24 | Tool registry is the cross-surface contract. Every LLM-driven tool and every apply tool has a manifest in `server/tools/registry.ts` declaring `key`, `label`, `description` (agent-facing), `requires`, `contextInputs`, `produces`, `surface`, optional `enabledFor?: WorkflowKey[]` (workflow/profile scoping; omit = available across all profiles), and optional `buildPrompt`. `availableTools(project)` and `blockedTools(project)` are pure functions over the manifest list + project asset state. Both MCP packet and Web UI read the same registry. `WorkflowRecipe.stages` has been removed — orchestration emerges from tool dependencies. **Vocabulary discipline:** *preset* = taste/defaults (`preset_key` column); *workflow / production profile* = what kind of thing we're making (`workflow_key` column). The manifest scope field gates on **workflow profile**, not preset, and is named accordingly. | One source of truth for "what can run when." No hardcoded phase gates. Adding a new tool surfaces in both agent and UI automatically. Adding a new preset is a taste profile + maybe new tool entries, not a separate stage definition. Vocabulary clarified 2026-05-20 after Codex review — the manifest scope field was misnamed `preset?` when it actually keyed on workflow profile. |
| D25 | Prompt composition: every LLM-driven tool builds its prompt via `composePrompt({ coreTask, workflowContext, inputs, presetTaste, userNotePolicy, outputContract, userNote })`. **`coreTask` is shared across workflows** — it states what the tool does in workflow-agnostic production language ("Propose 4 distinct visual style directions for this project. No story/scenes/characters. Cover a real range."). **`workflowContext` is a small graph-context string** (one or two sentences: "This is a scripted narrative — directions will become the visual world the episode/film sits inside" / "This is a music-led project — directions will become a visual world the video sits inside"). **`presetTaste` carries medium + taste** — this is where medium-guard lives ("Medium is anime, 2D animation; stay inside anime production; do not propose live-action photography, documentary stills, photoreal pastiches"). **`userNotePolicy` is per-tool** — declares the hierarchy between tool contract, medium guard, user note, and range within the constrained space. For generate-style tools the policy is "user note = hard creative constraint inside contract + TASTE; range means variety inside the note." For refine-style tools the policy is "apply note surgically; preserve locked structure; do not regenerate from scratch." For script parser etc. there is no userNotePolicy. `outputContract` is shared (JSON schema / shape rules). `userNote` is optional free-form direction. **The doctrine, not the text, is what's shared across surfaces.** Backend composer governs API-tool LLM calls (web UI buttons; agent fast-path tool calls). Agent-native reasoning consumes skills + packet + registry, never the composed text directly. Skills carry the same vocabulary discipline in agent-readable form. **Enum-label ban still holds:** prompt text receives only human-readable production language — never raw workflow/preset enum labels like `scripted_narrative` or `anime_default`. Logs and metadata can reference enum keys; prompt bodies cannot. **Constraint hierarchy** (top to bottom, codified via the section order): tool contract > medium guard (preset) > user note > range. Tools express this hierarchy by the policy text they pass; the composer just orders the sections. | Replaces both failure modes: the "one fat template with nouns swapped" drift (where music-video chrome contaminated anime) AND the "N per-workflow body files" overcorrection (which would have duplicated the same instruction across every new workflow). The right layering is: shared mechanism in coreTask, workflow as small context, taste/medium as preset injection. The Polaroid leak came from baking taste into the shared body, not from sharing the body — fix the layering, not the duplication. Doctrine refined 2026-05-20 after Saul pushed first-principles on per-workflow coreTask burden. `userNotePolicy` slot added 2026-05-20 evening after T9.2 proof-gate run showed user notes were being treated as nudges; old `buildStyleBrainstormPrompt` had treated them as hard constraints. Codifying the hierarchy in the composer (not per-prompt) so every tool's stance on user notes is explicit and reviewable. |
| D26 | Workflow archetypes locked at 4. **v1 active canonical keys:** `music_led` (audio is the spine — analyze song/lyrics/structure, then build scenes/shots around it); `scripted_narrative` (script/story is the spine — film, anime, short film, episode, dialogue scenes all fit here). **Deferred:** `campaign` (brief/product/offer is the spine — ads, launch videos, explainers, CTA-driven pieces); `short_form` (hook/beat/retention is the spine — reels, TikToks, UGC-style cuts). Anime is a **preset** under `scripted_narrative`, not its own workflow. Naming rule: workflows describe the **planner's spine** (what production structure is built around), not the output format label. **Migration rule:** current code/rows may still contain legacy keys `music_video` and `anime_scripted`; migration must support them as aliases until all runtime types, registry `enabledFor` values, `WorkflowRecipeKey`, DB rows, frontend refs, MCP packets, and docs have moved to the canonical keys. | First-principles test for "is this a workflow": different seed type + different planner logic. Anime and live-action drama share the scripted_narrative planner (scene → shot → dialogue → motion); they differ only in style preset. Music-led has its own planner (sections → shots driven by audio). Campaign has its own (brief → hook → product → CTA). Short-form has its own (hook → retention → payoff). Locking the archetype set early prevents new "workflow" requests from multiplying without a planner change behind them. Codex proposed the archetype shape 2026-05-20 after Saul pushed first-principles on per-workflow coreTask burden. |

---

## 3. Architecture

Mirage and Lahari are two products that share git history up to 2026-05-18 and diverge after. They live on permanently distinct branches of the same repo.

```
                       ┌────────────────────────────────────────────┐
                       │  One git repo                              │
                       │  ├── main branch  →  Lahari production     │
                       │  └── mirage branch →  Mirage production    │
                       └────────────────────────────────────────────┘

  Engine bugfixes:
  ────────────────
  Fix lands on the branch where it's discovered.
  Then cherry-pick the commit to the other branch.
  No automatic merge in either direction.
```

**Lahari production:**
```
                       ┌─────────────────────────────┐
                       │  lahari-media-engine-       │
                       │  production.up.railway.app  │
                       │  - / (web studio with queue)│
                       │  - /connect (Lahari)        │
                       │  - /mcp (Lahari MCP)        │
                       └──────────────┬──────────────┘
                                      │
                       ┌──────────────▼──────────────┐
                       │  Lahari Railway, deploys    │
                       │  from `main`                │
                       │  DB_TABLE_PREFIX=lahari     │
                       │  SUPABASE_BUCKET=           │
                       │    lahari-assets            │
                       │  Platform env keys          │
                       └──────────────┬──────────────┘
                                      │
                       ┌──────────────▼──────────────┐
                       │  Lahari Supabase project    │
                       │  lahari_* schema            │
                       │  music_video_queue + songs  │
                       └─────────────────────────────┘
```

**Mirage production:**
```
                       ┌─────────────────────────────┐
                       │  Mirage domain (TBD)        │
                       │  - / (StartProject intake)  │
                       │  - /connect (BYOK gate)     │
                       │  - /account/keys            │
                       │  - /mcp (Mirage MCP)        │
                       └──────────────┬──────────────┘
                                      │
                       ┌──────────────▼──────────────┐
                       │  Mirage Railway, deploys    │
                       │  from `mirage` branch       │
                       │  DB_TABLE_PREFIX=studio     │
                       │  SUPABASE_BUCKET=           │
                       │    mirage-assets            │
                       │  Tenant key resolver        │
                       │    (BYOK enforced)          │
                       └──────────────┬──────────────┘
                                      │
                       ┌──────────────▼──────────────┐
                       │  Mirage Supabase project    │
                       │  studio_* schema            │
                       │  studio_tenant_api_keys     │
                       │    (encrypted)              │
                       │  Audio Blueprint columns    │
                       │  No queue/songs catalog     │
                       └─────────────────────────────┘
```

**Artist client paths (Mirage):**
- Web: Browser → `mirage.<domain>/` (sign in → BYOK setup → intake → blueprint → studio → render)
- Codex: Desktop → `@ssaulgoodman420/mirage-mcp-server` → `mirage.<domain>/mcp` → `mirage.<domain>/api/*` → Mirage Supabase
- CLI: Terminal → `@ssaulgoodman420/mirage-cli` (notebook sync) → `mirage.<domain>/api/notebook-sync/*`

**Branch lifecycle:**
- `main` is Lahari's permanent home. Maintenance mode acceptable. Saul-paid env keys, curated artist roster, music_video only
- `mirage` is Mirage's permanent home. Active development. Open-signup tenants, BYOK enforced, `music_led` + `scripted_narrative` + future workflows (`campaign`, `short_form` deferred per D26)
- Engine bugfixes get cherry-picked between branches when they apply to both (`server/services/claude.ts`, render pipeline, supabase plumbing, etc.). Product-shape changes never cross-port (Lahari keeps its queue; Mirage keeps its intake)
- v2 escape hatch when cherry-pick cost gets painful: extract shared engine into a package (`@mirage-core/engine`), restructure into a proper monorepo, both products import. Not v1 scope

---

## 4. Tracks

Each track is a coherent workstream. Tasks within a track are mostly sequential; tracks themselves can be parallelized except where noted in §5 (Dependency Graph).

**T1–T7** = v1 foundation (mostly shipped — see §9 checkpoints for status).
**T8–T10** = agent-native pivot (post-D23/D24/D25, before v1 ship). Codifies tool registry + composer + asset-shelf UI.

### T1 — Mirage Infrastructure

**Goal:** Stand up the Mirage Railway app pointed at a fresh Supabase, accessible at a Mirage domain, serving the existing engine code with `DB_TABLE_PREFIX=studio`.

**Owner:** Codex
**Depends on:** T7 (CLI must exist in this lane before forking it)

| ID | Task | Files / Targets | Acceptance |
|---|---|---|---|
| T1.1 | Provision Mirage Supabase project | New Supabase project named `mirage` | URL + service key + anon key captured in 1Password / secrets store |
| T1.2 | Run bootstrap migration | `migrations/2026-05-13_create_studio_workspace_schema.sql` against new Supabase | All `studio_*` tables exist; storage bucket `mirage-assets` exists |
| T1.3 | Provision Mirage Railway app | New Railway project `mirage-platform` | App boots, `/api/health` returns 200 with `DB_TABLE_PREFIX=studio`, `SUPABASE_BUCKET=mirage-assets` |
| T1.4 | Pick + wire Mirage domain | DNS + Railway custom domain | `https://<mirage-domain>/api/health` resolves and serves 200 |
| T1.5 | Fork MCP server package | Copy `packages/lahari-mcp-server` → `packages/mirage-mcp-server`. Rename package `@ssaulgoodman420/mirage-mcp-server`. Update internal namespace prefix from `lahari` to `mirage` (env vars, default API URL, audit header `X-Mirage-MCP-Version`) | `npm run build` succeeds in package; manifest exposes Mirage namespace; published version is 0.1.0 |
| T1.6 | Fork CLI package | Copy `packages/lahari-cli` → `packages/mirage-cli`. Rename package `@ssaulgoodman420/mirage-cli`. Update `DEFAULT_API_URL`, `LAHARI_CLI_TOKEN`→`MIRAGE_CLI_TOKEN` env var, help text | `npx @ssaulgoodman420/mirage-cli sync <projectId>` against a Mirage project pulls notebook correctly |
| T1.7 | Update Google OAuth | Add Mirage domain to Google OAuth allowed redirect URLs | Sign-in works at Mirage domain |
| T1.8 | Smoke test: music video on Mirage | Manual: sign in, create a music video project on Mirage, run through Blueprint, generate one shot, render | Project lives in studio_* schema; render mp4 lands in `mirage-assets` bucket |
| T1.9 | Mirage provider consolidation (D20) | (a) Extend `server/services/segmind-image.ts` to support Nano Banana Pro + any other models currently served only by Google. (b) Update image routing (`server/services/imagen.ts` or its dispatcher) so when `DB_TABLE_PREFIX=studio`, all image gen routes through Segmind regardless of model name. Google `imagen.ts` direct calls stay reachable only from Lahari (`lahari` prefix). (c) Remove Vertex fallback in `server/services/segmind.ts` / `video-provider.ts` for `studio` prefix — Segmind failure surfaces as error, no GCP fallback. (d) Preset defaults in `server/presets.ts` set `imageModel: 'nano-banana-pro'` for both Mirage presets (best quality, Segmind-served) | Mirage runtime has zero GCP dependency; all image+video gen flows through Segmind key; Lahari path unchanged |

**Acceptance for T1 as a whole:** A fresh user can sign in at the Mirage domain and complete the existing music-video pipeline end-to-end against the new Supabase, with no Lahari fallback and no GCP dependency. The Mirage MCP package and Mirage CLI package both exist, build, and function against the new app.

---

### T2 — BYOK Platform

**Goal:** Every paid provider call resolves the API key from the requesting tenant's stored keys. Artists must set keys at `/connect` before MCP token issuance. Platform env keys exist as fallback ONLY for internal Lahari tenant.

**Owner:** split — Codex (backend, migration, resolver), Claude (UI, /connect gate, error surfacing)
**Depends on:** none (can run parallel to T1)

| ID | Task | Files / Targets | Acceptance |
|---|---|---|---|
| T2.1 | Migration: tenant API keys table | New migration `2026-05-18_add_tenant_api_keys.sql`. Schema: `(id uuid pk, user_id uuid fk auth.users, provider text, key_label text, key_value_encrypted text, created_at, updated_at, last_used_at, last_error text)`. Unique index on (user_id, provider). Add `user_metadata.is_internal` flag check helper | Migration applies clean; table accepts encrypted rows |
| T2.2 | Encryption helper | `server/services/byok/crypto.ts` — AES-256-GCM, key from `MIRAGE_ENCRYPTION_KEY` env (32 random bytes base64). Export `encryptKey(plaintext)`, `decryptKey(ciphertext)` | Unit test round-trips; throws on missing env var |
| T2.3 | Key resolver service | `server/services/byok/resolver.ts` — `getTenantApiKey(userId, provider): Promise<string \| null>`. Caches per-request via AsyncLocalStorage or arg-passed. Returns null if user has no key for that provider. No env fallback in Mirage — every user (including Saul) BYOKs (per D5) | Unit test: user without key returns null; user with key returns decrypted plaintext |
| T2.4 | Backend routes | `server/routes/account.ts` (new): `GET /api/account/api-keys` (returns presence + label + last_used_at, never values), `PUT /api/account/api-keys/:provider` (body `{ value, label? }` → encrypt + upsert), `DELETE /api/account/api-keys/:provider`. All require auth | curl: PUT then GET returns the new presence row; PUT same provider replaces; DELETE removes |
| T2.5 | Update provider services for resolver | All of: `server/services/claude.ts`, `openai-script.ts`, `gemini.ts`, `imagen.ts`, `openai-image.ts`, `segmind.ts`, `segmind-image.ts`, `seedance-storyboard-rd.ts`, `videoGeneration.ts`. Each accepts `userId` and calls resolver. Throw structured `{ code: 'missing_key', provider, setupUrl: '/account/keys' }` on null | Each service file modified; tsc passes; existing routes that call them pass `req.userId` through |
| T2.6 | MCP/CLI structured error wrapper | When backend returns `missing_key`, MCP returns a friendly message: `"Your <provider> API key isn't set. Open <mirage-domain>/account/keys to add it, then retry."` | Manual test: call any AI tool without keys → friendly message, not stack trace |
| T2.7 | `/connect` BYOK gate | `server/routes/connect.ts` modified — before issuing MCP token, check that the tenant has keys for the required-at-connect set (per D6): `music_led` needs segmind+gemini; `scripted_narrative` needs segmind+elevenlabs. If missing, render setup checklist instead of token. Show optional providers (anthropic, openai, etc.) as "add when needed" hints, NOT blocking | New tenant at /connect sees minimal required checklist; after pasting required keys, gets MCP token snippet; optional providers visible but don't block |
| T2.8 | Account keys UI page | `components/AccountKeys.tsx` (new). Two sections: **Required** (per workflow — Segmind + ElevenLabs for `scripted_narrative`; Segmind + Gemini for `music_led`). **Optional — only if generating via web studio without a harness** (Anthropic, OpenAI). Per-provider row: label, status (set/not set), last-used, "Set/Rotate" button (modal with password-style input + label), "Delete" button. Copy for optional section explains harness-vs-studio split | Page lists providers in required vs optional sections with clear copy; can add/rotate/delete each; PUT/DELETE call backend |
| T2.9 | TTS daily-cap table | `studio_provider_usage_daily` — `(user_id, provider, day_utc, cost_usd, char_count)`. Composite unique on (user_id, provider, day_utc). Resolver increments after each successful TTS gen. T3.5 reads + enforces D19 cap | Schema exists; row increments correctly; rejection works when over cap |

**Acceptance for T2 as a whole:** External tenant cannot run any paid AI operation without BYOK. Internal tenant can. UI clearly tells them which keys are missing and where to set them. Audit log captures key set/delete events.

---

### T3 — Audio Backend

**Goal:** Backend supports writing audio plans, generating dialogue TTS, and assigning voices to cast. ElevenLabs is the first TTS provider.

**Owner:** Codex
**Depends on:** T2.5 (provider services updated for BYOK so ElevenLabs uses tenant key)

| ID | Task | Files / Targets | Acceptance |
|---|---|---|---|
| T3.1 | Migration: audio blueprint columns | New migration `2026-05-XX_add_audio_blueprint.sql`. Adds: `studio_cast_members.voice_provider text`, `voice_id text`, `voice_name text`; `studio_shots.audio_plan jsonb`, `audio_plan_stale boolean default false`; `studio_assets` accepts `category='dialogue_audio'`. Mirror into `studio_workspace_schema.sql` bootstrap | Migration applies; columns exist; bootstrap migration reflects new shape |
| T3.2 | TTS provider dispatcher | `server/services/tts/index.ts` — `generateSpeech({ userId, provider, voiceId, text, deliveryHint? })`. Dispatches by provider | Unit test: dispatcher routes elevenlabs → elevenlabs impl |
| T3.3 | ElevenLabs implementation | `server/services/tts/elevenlabs.ts` — calls ElevenLabs `/v1/text-to-speech/:voice_id` endpoint with tenant key from BYOK resolver. Returns `{ audioBuffer, mimeType, characterCount }`. Handles voice-not-found, quota, key errors | Manual: with a real ElevenLabs key in BYOK, generates audio for a short line, asset stored |
| T3.4 | `POST /api/projects/:id/write-audio-plan` | `server/routes/generate-audio.ts` (new). Body: `{ shotIds?: string[], force?: boolean }` (default: all shots that have dialogue context or are stale). For each shot, calls text-provider with audio-director prompt, parses JSON, validates, persists to `audio_plan`. Default `dialogueStrategy` per shot: `lipsync` if all speakers in the shot have look references; `overlay` if any speaker has no look (treats narrator/off-screen case). Records `audio_plan_written` director event per shot. Returns updated project | curl: writes audio plan for selected shots; tsc passes; non-empty `shot.audio_plan` after call; narrator-spoken shots default to `overlay` |
| T3.5 | `POST /api/projects/:id/generate-dialogue-audio` | Same router. Body: `{ dialogueIds?: string[], shotIds?: string[] }`. Before generating: read today's TTS spend from `studio_provider_usage_daily` for this user; if (current + estimated) exceeds D19 cap ($20/day), refuse with structured `{ code: 'daily_cap_exceeded', currentUsd, capUsd, capResetsAtUtc }`. For each dialogue line: resolve cast voice → call TTS → store asset → increment usage row → write back `ttsAssetId, ttsStatus, ttsDurationSec` into the line. Allow partial success (some lines succeed, others fail with per-line error or daily cap hit mid-batch). Records `dialogue_audio_generated` event with line count + total cost | curl: returns asset list + cost; failed lines have status + error; over-cap request refused with structured error; partial cap-hit returns generated + remaining queued |
| T3.6 | `GET /api/projects/:id/audio-plan-cost` | Same router. Query params: `shotIds?, dialogueIds?, characterIds?`. Returns `{ totalChars, estimatedUsd, pendingLines: N, missingVoices: [{ characterId, name }] }`. Pricing formula: ElevenLabs $0.30/1k chars (Multilingual v2 default) | curl: returns sane cost preview |
| T3.7 | `PATCH /api/projects/:id/cast/:memberId/voice` | Extend existing cast routes. Body: `{ voiceProvider, voiceId, voiceName? }`. Validates provider is in allowlist (`['elevenlabs']` for v1). Records `cast_voice_assigned` event | curl: updates voice fields; bad provider rejected |
| T3.8 | Audio-director prompt | Add to runtime catalog: `server/services/audioDirector.ts` (new). Exports `buildAudioPlanPrompt(project, shot, preset, sourcePayload)`. Includes character list with descriptions, locked script, scene/shot context, raw `source_payload` (for verbatim extraction when script seed had dialogue), preset rules. Output schema = audio_plan JSON shape from D2/D3/D4 | Unit test: prompt builds without crashing for a fixture project |
| T3.9 | Audio preset rules | `server/presets.ts`: `PipelinePreset.audio` carries dialogue/sound/strategy rules per preset. Stage gating was superseded by the tool registry in T8.6 | tsc passes; audio-director prompt reads preset audio rules |
| T3.10 | Staleness wiring | For in-place script/blueprint edits that preserve shot identity, set `audio_plan_stale = true` for any touched shot that already had `audio_plan != null`; preserve the plan. Full script regeneration/apply is a topology replacement: it may delete/recreate shots and therefore discards old per-shot audio plans unless a later migration adds explicit shot matching. | Manual: write audio plan, edit an existing shot/scene/cast/environment, `audio_plan_stale` flips true and plan content is preserved. Full script regeneration/apply is documented as destructive topology replacement. |
| T3.11 | Prompt catalog update | `server/prompts/catalog.ts`: add audio-director prompt entry (read-only mirror of runtime) | Catalog entry exists; lists shape of input/output |

**Acceptance for T3 as a whole:** curl can flow: assign voice → write audio plan → preview cost → generate TTS → verify asset and audio_plan updated. All via studio_* schema, with BYOK ElevenLabs key.

---

### T4 — Audio Codex MCP

**Goal:** Mirage MCP exposes audio-blueprint tools so Codex in an artist workspace can write plans, generate TTS, and assign voices following R28 apply-only pattern. Skill shard guides quality.

**Owner:** Codex
**Depends on:** T1.5 (Mirage MCP package exists), T3 (backend contracts stable)

| ID | Task | Files / Targets | Acceptance |
|---|---|---|---|
| T4.1 | `apply_audio_plan` MCP tool | In `packages/mirage-mcp-server/src/tools/applyAudioPlan.ts`. Input: `{ projectId, shots: [{ shotId, audioPlan, baseHash? }], force? }`. Validates JSON schema, char caps (dialogue.text ≤ 500 chars, soundNotes ≤ 1000 chars), `characterId` resolves to cast in project, drift via baseHash. Persist via existing apply path. Record director event per shot | Schema rejects malformed; drift refusal works; success returns new hash |
| T4.2 | `apply_cast_voice` MCP tool | Similar, applies voice fields with drift check. Input: `{ projectId, castMemberId, voiceProvider, voiceId, voiceName?, baseHash? }` | Drift check on cast row; success persists |
| T4.3 | `generate_dialogue_audio` MCP tool | Wraps backend `POST /generate-dialogue-audio`. Returns `{ generated: [{ dialogueId, assetId, durationSec }], failed: [{ dialogueId, error }], totalCostUsd }` | Calls backend correctly; surfaces partial success |
| T4.4 | `get_audio_plan_cost` MCP tool | Wraps backend `GET /audio-plan-cost`. Returns same shape | Returns cost preview |
| T4.5 | Project packet additions | `server/services/codexStudio/packets.ts`. Add `audioPhase: { state, missingVoices: [{ id, name }], pendingTtsLineCount, totalDialogueLines, audioPlanStaleShotIds }` to project packet. Add `audioPlan: { ... }` and `audioPlanStale: bool` to each shot. Add `voice: { provider, id, name, assigned: bool }` to each cast member | Packet schema test passes; sample project produces non-empty audio fields |
| T4.6 | Notebook materialization | `server/services/codexStudio/notebook.ts`. Materialize `drafts/audio-plan.md` — one section per shot with editable fields (markdown table for dialogue, soundNotes as freeform block, dialogueStrategy as a single line). Include `<!-- shot_id: ... -->` and `<!-- base_hash: ... -->` for round-trip drift check | Notebook write produces parseable markdown; sample shot section renders |
| T4.7 | `apply_audio_plan_markdown` MCP tool | Parses `drafts/audio-plan.md` from the workspace, computes per-shot JSON, calls apply tool. Same role as `apply_script_markdown` | Edit the draft, run tool, audio_plan column updates with drift check |
| T4.8 | Audio-director skill | `server/resources/skills/audio-director/SKILL.md` (resources are what get materialized into workspaces). Sections: choosing `dialogueStrategy` (lipsync for visible characters, overlay for narrator/off-screen — read cast `has_look` flag); how to preserve script intent when seed had dialogue (extract verbatim from `source_payload`); how to write delivery cues; character-voice mapping (read character description, voice notes); paceHint heuristics; soundNotes restraint; refusing to invent characters; lipsync ordering ("generate TTS for lipsync shots before video gen") | Skill file exists, reviewed for taste rubric quality |
| T4.9 | Mirror skill into `.agents/skills/` | The repo's `.agents/skills/audio-director/SKILL.md` for engine sessions | Both copies in sync |
| T4.10 | Notebook AGENTS.md regen | Update notebook AGENTS.md template to mention Audio phase availability + audio-director skill | Newly materialized notebook contains the section |

**Acceptance for T4 as a whole:** From Codex Desktop in an artist workspace: artist says "draft audio plan for the anime episode" — Codex reads packet + skill, writes JSON for each shot, calls apply_audio_plan, recovers from drift errors. Artist says "generate TTS for Mina's lines" — Codex calls cost preview, confirms with artist, then generate_dialogue_audio, assets exist in Supabase, audio_plan rows updated.

---

### T5 — Audio Frontend

**Goal:** Web studio reflects the new Blueprint phase order, surfaces dialogue inline with the script, lets artists assign voices in the Characters phase, and runs TTS production from a dedicated Audio phase.

**Owner:** Claude
**Depends on:** T3 contracts (write-audio-plan response shape, audio_plan JSON)

| ID | Task | Files / Targets | Acceptance |
|---|---|---|---|
| T5.1 | Phase order refactor | `components/AnalysisEditor.tsx` and phase children. Insert Audio phase between Environments and Studio. Initial v1 hardcoded visibility is superseded by T10 registry-backed shelves | tsc passes; music_led shows no Audio tab; scripted_narrative shows it |
| T5.2 | Script phase dialogue inline | `components/ScriptPhase.tsx`. Under each shot, render dialogue lines (read mode by default, click to edit text/delivery). "Write dialogue" button per shot. "Write all dialogue" bulk button. Calls `POST /write-audio-plan`. Optimistic refresh from response | Anime artist can write + read dialogue without leaving Script |
| T5.3 | Characters phase voice editor | `components/CharactersPhase.tsx`. Add voice section to each character card: provider dropdown (just `elevenlabs` for v1), `voice_id` text input, `voice_name` optional label, "needs voice" amber pill if not set. PATCH on save | Voice IDs persist; missing-voice pill clears once set |
| T5.4 | Audio phase main view | `components/AudioPhase.tsx` (new). Table of all dialogue lines across all shots: character, line text, paceHint, ttsStatus pill, audio preview (`<audio>` element if asset exists), regenerate per-line button. Filters: by character, by shot, by ttsStatus | Visible audio surface; preview audio plays |
| T5.4a | Audio harness simplification pass | `components/AudioPhase.tsx`. Keep the Audio phase as a Codex-operable harness, not a production tracker. Bulk and per-shot generation should target only pending/error lines whose characters already have voice IDs. Missing voices remain visible as assignable tasks, but they do not block unrelated ready lines. Tone down any first-class dashboard/filter UI that makes the surface feel like a spreadsheet rather than a shot graph | "Generate available" works even if some characters still need voices; missing voices remain linked to Characters; no ready line is blocked by an unrelated missing voice |
| T5.5 | TTS cost preview modal | `components/TtsGenerateModal.tsx` (new). Triggered by "Generate available" / "Generate selected". Shows `totalChars`, `estimatedUsd`, missing voices omitted from this run, pending vs already-generated. "Generate" button calls backend, polls or awaits, refreshes project | Cost displayed before gen; missing voices are listed as skipped tasks rather than blocking ready dialogue |
| T5.6 | `dialogueStrategy` per-shot picker | Per-shot toggle in Audio phase row. Two options: "Lipsync (character speaks on screen)" → `lipsync`; "Overlay (voiceover / narrator / off-screen)" → `overlay`. Default reflects what write-audio-plan picked. Disable `lipsync` option (with tooltip "speaker has no look reference") if any line in the shot is from a no-look cast member. Show "Generate TTS before video gen" warning badge if shot is `lipsync` and TTS missing for any line | Artist picks per shot; correct enum stored; lipsync-blocked shots clearly flagged |
| T5.7 | Stale warnings | Amber badge on shots with `audio_plan_stale = true`, in both Script phase dialogue view and Audio phase. Click to rewrite | Badge appears when script changes; clears on rewrite |
| T5.8 | API client additions | `services/api.ts`: `writeAudioPlan(projectId, shotIds?, force?)`, `generateDialogueAudio(projectId, dialogueIds?, shotIds?)`, `getAudioPlanCost(projectId, scope)`, `updateCastVoice(projectId, castId, voice)` | tsc passes; all four wrappers used by components |
| T5.9 | Workflow UI gating | Transitional hardcoded Blueprint phase visibility. Superseded by T10 asset-shelf registry consumption | Music-led doesn't show Audio tab; scripted_narrative does |

**Acceptance for T5 as a whole:** Anime artist in web studio: clicks through Script with dialogue visible, assigns voices in Characters, jumps to Audio, sees lines, hits "Generate available" → cost modal → confirm → assets appear → previews play. If some characters are missing voices, those lines are skipped and clearly linked back to Characters; unrelated ready lines still generate. Music video user never sees the Audio phase.

---

### T6 — Studio (video gen) + Render Consumption

**Goal:** Both `lipsync` and `overlay` strategies flow end-to-end. Lipsync shots: video gen call passes TTS to Seedance for in-clip lipsync. Overlay shots: video gen produces silent video; render mixes TTS over the timeline. soundNotes flows into the video prompt regardless.

**Owner:** split — Codex (server-side video gen + renderer), Claude (UI plumbing for the lipsync-blocked warning + render preview if needed)
**Depends on:** T3.1 (audio_plan column exists), T3.5 (TTS generation produces ttsAssetId)

| ID | Task | Files / Targets | Acceptance |
|---|---|---|---|
| T6.1 | Video prompt assembly: `soundNotes` | `server/routes/generate-video.ts` (or the prompt-builder it calls). When building the video prompt for a shot, append `soundNotes` to the scene/ambient description if present. Applies to all strategies | Manual: shot with soundNotes triggers video gen that includes ambient context in prompt log |
| T6.2 | Video gen: `lipsync` path | `server/services/segmind.ts` (Seedance wrapper) and the route that calls it. When `shot.audio_plan.dialogueStrategy === 'lipsync'`: resolve all dialogue lines' `ttsAssetId`s, concatenate audio assets into one shot-level audio (or pass primary line if Seedance doesn't accept concat), pass `lipsync: true` + audio URL + character target (e.g. cast member that matches the first dialogue speaker) to Seedance. Validate every line has a resolved TTS before invoking — return `{ code: 'lipsync_tts_missing', shotId, missingDialogueIds: [...] }` 4xx if not | Manual: lipsync shot with TTS produces a video with character lipsynced; missing TTS produces structured error |
| T6.3 | Video gen: `overlay` path | Same files. When `dialogueStrategy === 'overlay'` (or audio_plan absent): no audio passed to Seedance; generate normal silent video. Dialogue text NOT included in video prompt | Manual: overlay shot produces silent video; prompt log shows no dialogue lines |
| T6.4 | Render: overlay dialogue tracks | `remotion-renderer` + `server/services/timeline*.ts`. For each shot with `dialogueStrategy === 'overlay'` and resolved `ttsAssetId`s, emit dialogue audio tracks aligned to shot offset. Multiple lines stack sequentially by `order` field. For `lipsync` shots, no dialogue track added — audio is already in the video clip | Render produces mp4 with overlay TTS for overlay shots; lipsynced shots play their baked-in audio |
| T6.5 | Timeline sync to renderer | `cd remotion-renderer && npm run sync-timeline` after any timeline shape change | Renderer build passes |
| T6.6 | FFmpeg fast path eligibility | If FFmpeg path is taken and any shot has overlay dialogue (additional audio track), route to Remotion path (FFmpeg fast path isn't dialogue-aware in v1). Lipsync shots are fine on FFmpeg fast path because their audio is baked into the clip | Eligibility predicate excludes overlay-dialogue timelines; falls back to Remotion. Lipsync-only timelines stay on FFmpeg |
| T6.7 | Cost/duration overrun warning | If overlay TTS clip exceeds shot duration, show warning in render preview UI but don't block (audio plays past shot cut) | Visible warning; render still runs |
| T6.8 | Lipsync-blocked surface in Studio | Studio shot card shows warning badge for `lipsync` shots with missing TTS, before artist tries to gen. Click goes to Audio phase | Badge visible; clicking routes correctly |

**Acceptance for T6 as a whole:** Anime golden path: shot with visible character → lipsync strategy → generate TTS → generate video → output has lipsynced dialogue baked in. Shot with narrator → overlay strategy → generate TTS → generate video (silent) → render mixes TTS as voiceover. Both paths produce final mp4. Music video render path unchanged (no audio_plan present → no new branches taken).

---

### T7 — Final merge from main + branch rename

**Goal:** Pull every engine improvement from `main` (and `codex-native-studio` if it has unique commits) into this branch ONE LAST TIME so we start divergence from a clean baseline. Then rename the branch to `mirage` to reflect its permanent role.

After T7 completes, no more merges flow between `main` and `mirage`. Engine fixes are cherry-picked individually (per D16).

**Owner:** Codex
**Depends on:** none (do first; blocks T1)

| ID | Task | Files / Targets | Acceptance |
|---|---|---|---|
| T7.1 | Merge `main` into the Mirage lane | `git merge main` (or `git merge codex-native-studio` if more current). Resolve conflicts favoring Mirage where there's intent divergence (e.g. don't bring back the deleted Dashboard.tsx) | Merge commit lands; `packages/lahari-cli` present; Mirage-specific work preserved |
| T7.2 | Verify `packages/lahari-cli` and `packages/lahari-mcp-server` content | Confirm both packages match latest main; `npx tsc --noEmit` and `npm run build` pass | All pass |
| T7.3 | Verify backend `notebook-sync` route + `mint_cli_token` MCP tool present | These are what the CLI hits | Routes exist in `server/routes/notebook-sync.ts` and MCP tool registered |
| T7.4 | Rename branch to `mirage` | `git branch -m mirage` locally if needed. Push `mirage`, delete the old remote branch if it exists. Update any Railway watch branch, GitHub default for this lane, doc references | `git branch --show-current` returns `mirage`; remote tracking updated; no broken doc links |
| T7.5 | Update `AGENTS.md` and `CLAUDE.md` branch references | Replace old preset-branch references with `mirage` throughout | grep finds zero remaining old branch mentions in docs |
| T7.6 | Smoke test after merge + rename | `npm run dev` boots; can create a project end-to-end against current dev Supabase | Clean session works |

**Acceptance for T7 as a whole:** Branch is `mirage`, latest engine work from main is present, T1 can start forking @mirage packages from a known-good base. This is the last merge between the two branches.

---

### T8 — Tool Registry

**Goal:** Single source of truth for what tools exist, their input/output contracts, and what runs when. Both MCP packet (agent surface) and Web UI (overwatch surface) consume the same registry. D24 codifies the doctrine; T8 implements it.

**Owner:** Codex
**Depends on:** D23/D24 locked. Foundation for T9 + T10.

| ID | Task | Files / Targets | Acceptance |
|---|---|---|---|
| T8.1 | `ToolManifest` type | `server/tools/types.ts` (new) | Type declares: `key`, `label`, `description` (agent-facing prose), `enabledFor?` (workflow profile gate), `requires` (hard inputs), `contextInputs?` (soft inputs), `produces`, `surface` (web-UI placement), `buildPrompt?` (LLM tools) |
| T8.2 | Asset-presence resolver | `server/tools/assetState.ts` (new) | `hasAsset(project, key)` resolves project state → set of available assets (`audio`, `lyrics`, `concept`, `scriptText`, `cast`, `environments`, `scenes`, `shots`, `shotPrompts`, `storyboardPrompts`, `styleAsset`, `castLooks`, `envLooks`, `audioPlan`, `castVoices`, `ttsAssets`, `storyboards`, `keyframes`, `videos`, `render`) |
| T8.3 | Registry enumeration | `server/tools/registry.ts` (new) | All ~18 tools registered with accurate `requires`/`produces`/`description`. Includes generation tools (LLM-driven) AND apply tools (validators). See §7 for shape. |
| T8.4 | `availableTools` / `blockedTools` | `server/tools/registry.ts` | Pure functions over manifest + project. `blockedTools` returns each tool with the list of missing inputs. |
| T8.5 | MCP packet exposes registry | `server/services/codexStudio/packets.ts` | Packet includes `production.availableTools[]` and `production.blockedTools[]` each with `{ key, label, description, missing?: string[] }`. During proof gate this ships alongside the old `audioPhase` block; after validation, `audioPhase` can be retired. |
| T8.6 | Remove `WorkflowRecipe.stages` | `server/presets.ts`, MCP packet helpers | Workflow recipes keep source/planner metadata only. Audio phase packet derives skip/availability from registry tools. UI-facing phase visibility moves to `surface` field on tool manifests in T10. |

**Acceptance for T8 as a whole:** Agent (Codex) reads MCP packet, gets a clean list of what it can call right now and what's blocked with reasons. No hardcoded workflow stage logic. Web UI consumes the same lists.

---

### T9 — Prompt Composer Migration

**Goal:** Every LLM-driven tool builds its prompt via `composePrompt` with a shared `coreTask`, small `workflowContext`, explicit `inputs`, preset-owned taste/medium guard, and shared `outputContract`. Kills both fat-template drift and per-workflow prompt duplication (D25).

**Owner:** split — Codex (composer infra + script/audio/storyboard side) + Claude (style/concept/refine side)
**Depends on:** T8 (registry ties together)

| ID | Task | Files / Targets | Owner | Acceptance |
|---|---|---|---|---|
| T9.1 | `composePrompt` helper | `server/prompts/_composer.ts` (new) | Codex | Initial composer: `coreTask` + optional `INPUTS` + optional `TASTE` + `outputContract` + optional `USER NOTE`, joined with double-newlines + uppercase section headers. T9.12 extends it with `workflowContext`. |
| T9.2 | Migrate `brainstorm-style` | `server/prompts/styleBrainstorm.ts` (new) | Claude | **Single shared body**, not per-workflow. One `coreTask` ("Propose 4 distinct visual style directions, no story/scenes/characters, cover a real range, output JSON shape X"). One shared `outputContract`. **`workflowContext`** is a small string per workflow (music_led / scripted_narrative). **`presetTaste`** carries medium-guard + taste rules per preset (e.g. anime_default: "Medium is anime, 2D animation; stay inside anime production; no live-action photography or photoreal pastiche"; music_led_default: "Any medium fits — animation, live-action, mixed, abstract"). Medium-guard lives in presetTaste, NOT in coreTask. The contract is "don't accidentally leave the medium," delivered via taste injection. |
| T9.3 | Migrate `visualize-style` + `refine-style-direction` | `server/prompts/visualizeStyle.ts`, `refineStyle.ts` | Claude | Shared body; preset taste carries medium + style rules; workflow context kept small |
| T9.4 | Migrate `generate-concept` + `refine-concept` | `server/prompts/concept.ts` | Claude | Shared body; drop `deity` legacy params from signature |
| T9.5 | Migrate `planScenes` (`music_led`) | `server/prompts/planScenes.ts` | Codex | `music_led`-only tool (gated via `enabledFor`). lyrics/structure/meaning as `INPUTS`; preset shotPlanRules as `TASTE` |
| T9.6 | Migrate `parseScript` (`scripted_narrative`) | `server/prompts/parseScript.ts` | Codex | `scripted_narrative`-only tool (gated via `enabledFor`). scriptText + directorBrief + targetRuntime as `INPUTS` |
| T9.7 | Migrate `writeShotPrompts` | `server/prompts/shotPrompts.ts` | Claude | Shared body; preset taste carries acting/medium language |
| T9.8 | Migrate `refineScript` | `server/prompts/refineScript.ts` | Claude | Shared body; preset taste carries acting/medium language |
| T9.9 | Migrate `write-storyboard-prompt` + `refine-storyboard` | `server/prompts/storyboard.ts` | Codex | Shared body; Seedance routing stays inside |
| T9.10 | Migrate `write-audio-plan` | `server/prompts/audioPlan.ts` | Codex | `scripted_narrative`-only tool (gated via `enabledFor`). Already isolated. Routes through composer for consistency, becomes reference implementation. May need `workflowContext` slot added once composer signature extends. |
| T9.11 | Retire fat templates | `server/services/claude.ts`, `server/services/openai-script.ts` | Codex | Old `buildXPrompt` functions deleted; callers go through tool registry's `buildPrompt` |
| T9.12 | Extend `composePrompt` signature | `server/prompts/_composer.ts` | Codex | Add optional `workflowContext?: string` slot between `coreTask` and `INPUTS`. Section header `CONTEXT` if present. Non-breaking — existing `audioPlan.ts` keeps working. Land before T9.2. |

**Acceptance for T9 as a whole:** Running `scripted_narrative` + `anime_default` intake → style brainstorm produces directions that stay inside anime production without locking to one era or aesthetic. No live-action photography/documentary/polaroid drift unless the artist explicitly asks. Same for every other LLM-driven tool — no workflow noun leaks and no duplicated medium-specific bodies where a preset taste block is enough.

---

### T10 — Web UI Asset-Shelf Refactor

**Goal:** Blueprint phase tabs become "asset shelves" — visual organization stays, phase gating dies. Each tab shows the asset(s) it manages and the registry tools that produce/operate on them, enabled when their inputs exist.

**Owner:** Claude
**Depends on:** T8 (registry consumed by UI)

| ID | Task | Files / Targets | Acceptance |
|---|---|---|---|
| T10.1 | `useAvailableTools(project)` hook | `hooks/useAvailableTools.ts` (new) | Resolves registry against project state; returns `{ enabled, blocked }` per surface |
| T10.2 | `AssetShelf` wrapper component | `components/AssetShelf.tsx` (new) | Renders enabled tool buttons at top, dimmed blocked tools below with "needs: X" hint. Surface-aware filtering. |
| T10.3 | Migrate ConceptPhase | `components/ConceptPhase.tsx` | Phase tab survives; content becomes AssetShelf with concept tools. No status-gate enforcement. |
| T10.4 | Migrate ScriptPhase | `components/ScriptPhase.tsx` | Same. Dialogue tools surface for anime (per preset hint in manifest), hide for MV. |
| T10.5 | Migrate StylePhase | `components/StylePhase.tsx` | Same. |
| T10.6 | Migrate CharactersPhase | `components/CharactersPhase.tsx` | Same. Voice editor stays per cast. |
| T10.7 | Migrate EnvironmentsPhase | `components/EnvironmentsPhase.tsx` | Same. |
| T10.8 | Drop status-gate references | `components/BlueprintContextBar.tsx`, `constants/blueprintPhases.ts` | `isLockedPhase` retires; phase visibility comes from registry tool surfaces + preset hints |
| T10.9 | "Next move" hint per shelf | each phase | Top-of-shelf chip suggesting the highest-impact runnable tool (or the most-downstream-blocking missing input). Reads same `availableTools` data. |

**Acceptance for T10 as a whole:** A user clicking through Blueprint sees the same familiar tab layout but each tab is now an explicit registry of tools. No tab is "locked"; if a tool's inputs aren't satisfied it dims. The Codex agent operating against the same project sees the same available actions via MCP packet. Two surfaces, one truth.

**Refactor shape (one source of truth so neither agent reconstructs it):**

The split: each phase has two layers of content. **Asset display** (bespoke per phase — concept cards, script breakdown, style image grid, cast cards, env cards, dialogue table) survives because that's the visual cockpit Blueprint earns its keep on. **Tool buttons** (today: bespoke per-phase imperative buttons with handlers wired from AppShell) become registry-driven via `<AssetShelf>` wrapper.

Concrete `ConceptPhase` as worked example (other phases follow same pattern):

```tsx
// BEFORE — ~350 lines, three branches on phase status, four bespoke buttons
{isLockedPhase(project, 'concept', project.status) ? (
  <LockedConceptCard />
  <UnlockPill onClick={onUnlockConcept} />
  <RefineBox onSubmit={onRefineConcept} />
) : project.conceptOptions.length === 0 ? (
  <button onClick={onGenerateConcepts}>Generate Concepts</button>
) : (
  <ConceptCards />
  <button onClick={() => onLockConcept(i)}>Lock</button>
)}

// AFTER — ~150 lines, no status branching, registry decides buttons
<AssetShelf surface="asset:concept" project={project}>
  <ConceptCards concept={project.lockedConcept ?? project.conceptOptions} />
</AssetShelf>
```

`AssetShelf` internals (T10.2):

```tsx
const { enabled, blocked } = useAvailableTools(project, surface);
return (
  <>
    <div className="tool-row">
      {enabled.map(t => <ToolButton tool={t} onRun={runTool(t.key)} />)}
      {blocked.map(t => (
        <ToolButton tool={t} disabled title={`needs ${t.missing.join(', ')}`} />
      ))}
    </div>
    {children}
  </>
);
```

What stays bespoke per phase: the asset-render children inside `<AssetShelf>`. What gets deleted: status-branching logic, imperative button wiring, per-phase handler props on AppShell.

**Expected line-count delta as a sanity check:**

| Component | Today | After | Net |
|---|---|---|---|
| ConceptPhase | ~350 | ~150 | −200 |
| ScriptPhase | ~440 | ~280 | −160 |
| StylePhase | ~500 | ~280 | −220 |
| CharactersPhase | ~700 | ~480 | −220 |
| EnvironmentsPhase | ~400 | ~260 | −140 |
| AudioPhase | ~440 (already registry-shaped post-T5.4a) | ~360 | −80 |
| BlueprintContextBar (status-gate logic) | ~440 | ~360 | −80 |
| constants/blueprintPhases.ts | ~75 | ~55 | −20 |
| New: AssetShelf.tsx | 0 | ~80 | +80 |
| New: useAvailableTools.ts | 0 | ~40 | +40 |
| **Net** | | | **~−1,000 lines** |

If a migration PR diverges meaningfully from these numbers (e.g. ConceptPhase ends up at 280 instead of 150), it's a signal that bespoke logic is sneaking back in and should be pushed into either the registry manifest or a shared `AssetShelf` affordance instead.

**Mental shift in one sentence:** today each phase decides what buttons exist by reading project status; after T10, the registry decides what buttons exist by reading project assets, and the phase is just *where* those buttons land visually.

---

### T11 — Tool Recipes / Prompt Transparency

**Goal:** Replace the old Prompt Catalog mental model ("one giant template per prompt") with an artist-readable Tool Recipes surface that explains what each production tool does, what it reads, what it changes, and how composer sections assemble behind the scenes. This is not cosmetic: it is the product/debug surface that proves presets, composer sections, user notes, and project overrides are actually attached to tool calls.

**Owner:** Claude for UI/docs, Codex for registry/composer data plumbing if needed
**Timing:** Endgame polish after T10 asset shelves and before/alongside E2E hardening. Do not interrupt T10.

| ID | Task | Files / Targets | Acceptance |
|---|---|---|---|
| T11.1 | Rename/reframe Prompt Catalog UI | `components/PromptsLibrary.tsx` or replacement | Surface reads as "Tool Recipes" / "Production Brain", not a raw prompt dump |
| T11.2 | Registry-backed recipe cards | prompt/tool library UI + `server/tools` manifest | Each card shows what the tool does, what it reads, what it produces, and where it appears in Blueprint/Studio |
| T11.3 | Composer section viewer | prompt/tool library UI | Advanced drawer shows final composed sections: Core Task, Context, Inputs, Taste, User Note Policy, Output Contract, User Note |
| T11.4 | Composer-aware runtime logging | backend tool calls + `studio_ai_calls`/xray metadata | Every LLM/image/video tool call records the tool key, preset key, workflow key, and composed section labels so "what prompt actually ran?" is answerable from the UI/logs |
| T11.5 | Editable override layer | project config prompt override UI + agent notebook config | Artists/agents edit preset taste or project override notes as named composer sections; core task/output contract stay engine-level by default |
| T11.6 | Override application contract | prompt builders + project config loaders | Overrides apply by section (`presetTaste`, `workflowContext`, `userNotePolicy`, or project note) rather than replacing a whole fat template; final composed prompt preview shows the effective merged result |
| T11.7 | Permission boundary | UI copy + MCP/agent docs | Core task/output contract are engine-level surfaces; preset taste and project/director notes are artist/director surfaces |

**Acceptance for T11 as a whole:** Artists can understand "what happens behind the scenes" without reading a wall of raw prompt text. The UI makes the new composer architecture feel simpler: tool/action → inputs → preset taste → project override → output contract. It should not imply that a single static template is the truth. During E2E, Saul should be able to click from a generated result to the exact effective recipe sections that produced it and see whether the preset/taste/context/user note/project override attached correctly.

---

### T12 — MCP / Notebook / Packet Polish

**Goal:** Make the agent-facing Mirage surface as clean as the web/composer surface. Remote MCP packets, generated workspace instructions, project-local skills, notebook paths, and action results must teach Mirage's current concepts (`music_led`, `scripted_narrative`, `preset_key`, `seed_kind`, `availableTools` / `blockedTools`) and not old Lahari assumptions.

**Owner:** Codex
**Timing:** Before E2E. Do not start outside-artist testing until this passes.

| ID | Task | Files / Targets | Acceptance |
|---|---|---|---|
| T12.1 | Ledger + audit checklist | `docs/mirage-platform-v1-ledger.md` | MCP/notebook/skill/packet legacy surfaces are explicitly tracked |
| T12.2 | Mirage director skill | `.agents/skills/mirage-director/SKILL.md`, `server/services/codexStudio/notebook.ts` | Generated notebooks install `mirage-director`; visible text says Mirage, canonical workflow keys, and `mirage_capture_issue` |
| T12.3 | Skill shard canonicalization | `.agents/skills/audio-director`, `script-doctor`, `style-ref-critic`, `storyboard-prompt-craft`, `continuity-auditor`, `render-triage` | Shards read `seed_kind` / canonical workflow / preset from packet; no legacy workflow keys except labeled compatibility notes |
| T12.4 | Packet kind + action result branding | `server/services/codexStudio/packets.ts`, `storyboardOps.ts`, `audioPlan.ts`, `applies/*`, `plans.ts`, `core.ts` | MCP-exposed packet/result `kind` values use `mirage.*`; old `lahari.*` remains only as explicit compatibility alias or internal debug filename if justified |
| T12.5 | Notebook path / format names | `scriptMarkdown.ts`, `storyboardMarkdown.ts`, `notebook.ts` | Generated notebook files use `mirage/projects/...`; draft format labels stop saying `lahari-*` |
| T12.6 | CLI / action copy cleanup | `plans.ts`, notebook instructions, MCP descriptions | Artist-facing suggestions reference MCP tools or Mirage CLI, not `npm run lahari` engine-debug commands |
| T12.7 | MCP smoke test | hosted or local MCP | connect -> resolve/list -> attach -> packet -> notebook manifest/file -> mint_cli_token; packet has canonical keys and available/blocked tools |

**Acceptance for T12 as a whole:** A fresh empty workspace synced through Mirage MCP receives Mirage-branded `AGENTS.md` and skills. Project and shot packets expose canonical `workflowKey`, `presetKey`, `seedKind`, `availableTools`, and `blockedTools`. The generated skills teach the agent the current Mirage architecture without old Lahari workflow labels except explicit compatibility notes. Smoke testing proves an agent can attach and know the next action from packet/notebook without reading this engine repo.

---

## 5. Dependency Graph

```
T7 (merge CLI)
 └── T1.5 (fork MCP) ┐
 └── T1.6 (fork CLI) ┤
                     ├── T1 complete
T1.1-T1.4 (Supabase, Railway, domain) ──┘

T2 (BYOK) ──┐
            ├── T3.2 (TTS dispatcher reads tenant key)
            └── T3.5 (gen-dialogue-audio reads ElevenLabs key via BYOK)

T3 (audio backend) ──┐
                     ├── T4 (audio MCP — needs contracts)
                     ├── T5 (audio frontend — needs API shape)
                     └── T6 (render consumption — needs audio_plan shape)

T1 + T2 + T3 + T4 + T5 + T6 ──── v1 anime artist end-to-end test
```

**Critical path:** T7 → T1.5/T1.6 → T1.3 (Railway) → T2 (BYOK) → T3 (audio backend) → T4 + T5 + T6 parallel → end-to-end test.

**Parallelizable:**
- T1 (infra) and T2 (BYOK) can run in parallel — different files
- T4 (Codex MCP), T5 (frontend), T6 (render) can run in parallel once T3 stabilizes
- T2.8 (Account UI) can run in parallel with T2.1–T2.7 (backend)

---

## 6. Suggested Sequencing (working days)

Split: Codex owns the backend stack (T7 → T1 → T2 backend → T3 → T4 → T6 backend) mostly in sequence. Claude owns everything user-facing (T2 frontend account-keys + /connect gate UI, T5 audio frontend, T6 UI surface bits). Lanes don't collide on files until late in T6.

| Day | Claude | Codex |
|---|---|---|
| 1 | Write/finalize ledger; sketch Account Keys UI; sketch /connect BYOK gate | Read ledger; T7 (final merge from main + branch rename to `mirage`) |
| 2 | T2.4-shaped: stub `services/api.ts` BYOK endpoints; design Account Keys page | T7 finish; T1.1–T1.3 Supabase + Railway provision |
| 3 | T2.8 Account Keys UI (per-provider rows, set/rotate/delete modal) | T1.4 domain wiring; T1.5–T1.6 fork @mirage MCP + CLI |
| 4 | T2.7 /connect BYOK gate UI (required-keys checklist before token issuance) | T2.1–T2.3 migration + crypto + resolver (no env fallback per D5) |
| 5 | T5.1 Blueprint phase reorder; T5.9 workflow gating wiring | T2.4 account routes; T2.5 update provider services (touches ~9 files) |
| 6 | T5.2 Script-phase dialogue inline display + write button | T2.5 finish; T2.6 MCP/CLI error wrapper for missing_key |
| 7 | T5.3 Characters-phase voice editor (provider dropdown + voice_id input) | T2.9 daily-cap table + resolver; T3.1–T3.3 migration + TTS dispatcher + ElevenLabs |
| 8 | T5.4 Audio phase main view (dialogue lines table) | T3.4 write-audio-plan route + audio-director prompt |
| 9 | T5.4a Audio harness simplification; T5.5 cost preview modal; T5.6 strategy picker UI | T3.5 generate-dialogue-audio route (with D19 daily cap enforcement) + T3.6 cost preflight |
| 10 | T5.7 stale warnings; T5.8 API client wrappers | T3.7 voice patch route; T3.9–T3.11 recipes + staleness + catalog |
| 11 | T6.8 Studio shot-card lipsync-blocked warning | T4.1–T4.4 apply tools + generate_dialogue_audio MCP wrapper |
| 12 | Slack: visual polish; E2E anime test from web studio | T4.5–T4.10 packet + notebook draft + audio-director skill |
| 13 | Slack: bug fixes from E2E | T6.1–T6.4 video gen lipsync/overlay paths + render overlay tracks |
| 14 | Music video regression test; docs cleanup (AGENTS.md/CLAUDE.md branch refs per T7.5) | T6.5–T6.7 timeline sync + ffmpeg eligibility + cost warning; E2E anime test from Codex Desktop |
| 15 | Bug fixes | Bug fixes |

**Total: ~3 weeks if both lanes work clean.** One slack day each at end. Critical handoff points: end of day 2 (Codex finishes T7, Claude can start drafting Audio phase mocks); end of day 7 (Codex finishes T2 backend, Claude can wire BYOK UI to real endpoints); end of day 10 (Codex finishes T3, Claude's frontend has real APIs to call).

### Wave 2 — Agent-native pivot (T8-T10)

Post-foundation, pre-E2E. Triggered by the style-brainstorm leak that exposed the workflow-noun-stuffing drift (see D25 rationale and §9 checkpoint). Sequenced for handoff cleanliness:

| Day | Claude | Codex |
|---|---|---|
| W2.1 | Read D23-D26 + T8 manifest; sketch how UI will consume registry (do NOT start building); draft `presetTaste` rules for `anime_default` (medium-guard + range coverage) | T8.1-T8.4 (registry foundation: types, asset resolver, registry, available/blocked) |
| W2.2 | T9.12 composer signature extension + T9.2 brainstorm-style (single shared body + workflow contexts + preset taste injections) | T9.1 (composer) + T9.10 (audio_plan as reference migration) + T8.5 (MCP packet exposes registry) |
| **🚦 Proof gate** | **Before W2.3 begins: run one live `scripted_narrative` + `anime_default` style brainstorm against the migrated tool. Inspect full composed prompt + LLM output. Validate: (a) no music-led chrome leaks, (b) no taste-lock to a specific anime era, (c) directions vary across modern/retro/minimal/maximal/painterly/graphic possibilities inside anime production, (d) MCP packet `availableTools` + `blockedTools` reflect project state correctly, (e) no workflow/preset enum strings appear in the prompt body, (f) shared coreTask + workflowContext + presetTaste layering holds (no medium-guard leaking into coreTask). If any fail, fix the registry/composer/manifest BEFORE propagating to other tools or the UI. T10 UI work does not start until proof passes.** | |
| W2.3 | T9.3 visualizeStyle / refineStyle + T9.4 concept | T9.5 planScenes + T9.6 parseScript |
| W2.4 | T9.7 shotPrompts + T9.8 refineScript + T10.1-T10.2 (hook + AssetShelf component) | T9.9 storyboard + T9.11 retire fat templates |
| W2.5 | T10.3-T10.7 (per-phase migrations) | T8.6 (deprecate `WorkflowRecipe.stages`) |
| W2.6 | T10.8 (drop status-gate refs) + T10.9 (next-move chips) | Review pass + Codex MCP smoke test against new registry |
| W2.7 | Slack / E2E prep | Slack / E2E prep |

**Total Wave 2: ~7 working days if both lanes work clean.** Net code DELETED (fat templates + WorkflowRecipe.stages + phase-gate logic) is larger than what's added (registry + composer + AssetShelf).

**Why the proof gate exists:** Codex's 2026-05-20 review correctly flagged that putting the UI consumption layer (T10) ahead of validating the registry+composer is risky — if the foundation produces nonsense, the UI just spreads the nonsense. The proof gate is the smallest meaningful slice that proves the new shape works end-to-end (registry → composer → shared core task + workflow context + preset taste → sane LLM output → MCP packet exposure) on one broken seam (style brainstorm) and one already-clean reference (audio plan). If both look right, the rest of Wave 2 follows the established pattern. If either looks wrong, we fix the foundation first.

After Wave 2: resume v1 path — Mirage infra provisioning (T1), E2E golden path tests, music-video regression, ship.

---

## 7. Contracts (shapes both agents must respect)

### Shot `audio_plan` shape

```ts
type AudioPlan = {
  /**
   * Legacy mirror only. Runtime delivery mode is projectBrief.dialogueVideoMode:
   *   'lipsync' = video model is prompted to perform speech/mouth movement
   *               natively from dialogue text; no TTS prerequisite.
   *   'overlay' = generated TTS is mixed over the final render when available.
   * Do not use this field as a per-shot control surface.
   */
  dialogueStrategy: 'lipsync' | 'overlay';

  dialogue: Array<{
    id: string;              // stable per project, e.g. 'dlg_<uuid8>'
    characterId: string;     // references studio_cast_members.id
    text: string;            // ≤ 500 chars
    delivery?: string;       // ≤ 200 chars
    emotion?: string;        // ≤ 100 chars
    order: number;           // 1-indexed within shot
    paceHint?: 'slow' | 'natural' | 'fast';
    targetSec?: number;      // advisory; render uses actual TTS clip duration
    ttsAssetId: string | null;
    ttsStatus: 'pending' | 'generating' | 'success' | 'error';
    ttsError?: string;
    ttsCharCount?: number;
    ttsDurationSec?: number;
  }>;
  soundNotes?: string;       // ≤ 1000 chars, freeform, video-prompt context
};
```

**Dialogue-video mode constraint:** `projectBrief.dialogueVideoMode === 'lipsync'` must not require TTS, voices, or `ttsAssetId`s before video generation. `overlay` is the TTS path; missing TTS only affects render-time overlay audio, not video generation.

### Cast voice fields

```ts
type CastVoice = {
  voiceProvider: 'elevenlabs';  // v1
  voiceId: string;              // provider's raw ID
  voiceName?: string;           // human label
};
```

### Audio-plan apply input

```ts
type ApplyAudioPlanInput = {
  projectId: string;
  shots: Array<{
    shotId: string;
    audioPlan: AudioPlan;
    baseHash?: string;          // sha256 of current audio_plan
  }>;
  force?: boolean;
};
```

### TTS gen request

```ts
type GenerateDialogueAudioRequest = {
  // Pick one scope. Backend computes union.
  dialogueIds?: string[];
  shotIds?: string[];
  characterIds?: string[];
};

type GenerateDialogueAudioResponse = {
  generated: Array<{ dialogueId: string; assetId: string; durationSec: number }>;
  failed: Array<{ dialogueId: string; error: string }>;
  totalCostUsd: number;
  totalCharCount: number;
};
```

### Cost preview

```ts
type AudioPlanCostResponse = {
  totalChars: number;
  estimatedUsd: number;
  pendingLines: number;
  missingVoices: Array<{ characterId: string; name: string }>;
};
```

### BYOK error shape (returned by any provider call when key missing)

```ts
type MissingKeyError = {
  code: 'missing_key';
  provider: 'anthropic' | 'openai' | 'gemini' | 'segmind' | 'elevenlabs';
  setupUrl: string;             // '/account/keys'
  message: string;              // human-readable
};
```

### Tool manifest (D24)

```ts
type WorkflowKey =
  | 'music_led'            // v1 active. audio is the spine
  | 'scripted_narrative';  // v1 active. script/story is the spine
// Deferred (D26): 'campaign' (brief-spine), 'short_form' (hook-spine).

type ToolManifest = {
  key: string;                  // stable identifier, e.g. 'brainstorm-style'
  label: string;                // human-readable, e.g. 'Brainstorm style'
  description: string;          // agent-facing prose: "use this when X, returns Y"
  enabledFor?: WorkflowKey[];   // omit = available across all profiles; otherwise restrict
  requires: AssetKey[];         // hard inputs — tool can't run without
  contextInputs?: AssetKey[];   // soft inputs — used if present, fine without
  produces: AssetKey[];         // assets this tool creates/updates on success
  surface: ToolSurface;         // where the web UI shows it (e.g. 'asset:style')
  buildPrompt?: (project: ApiProject, userNote?: string) => string;  // LLM tools only
};

// NOTE: enabledFor gates on workflow profile, not preset. Preset means
// taste/defaults; workflow means "what kind of thing we're making."
// See D24 vocabulary discipline note.

type AssetKey =
  | 'audio' | 'scriptText' | 'directorBrief' | 'targetRuntime'
  | 'lyrics' | 'musicalStructure' | 'meaning'
  | 'concept' | 'styleDirections' | 'styleAsset'
  | 'cast' | 'environments' | 'scenes' | 'shots'
  | 'shotPrompts' | 'storyboardPrompts'
  | 'castLooks' | 'envLooks'
  | 'audioPlan' | 'castVoices' | 'ttsAssets'
  | 'storyboards' | 'keyframes' | 'videos' | 'render';

type ToolSurface =
  | `asset:${string}`           // asset shelf placement (e.g. 'asset:style')
  | 'agent-only';               // agent-callable but not surfaced in web UI
```

### Composed prompt shape (D25)

```ts
type ComposePromptParts = {
  coreTask: string;             // SHARED across workflows. "What this tool does"
                                // in workflow-agnostic production language.
  workflowContext?: string;     // small graph-context string. e.g.
                                // "This is a scripted narrative" / "music-led project".
                                // NOT enum labels — production language only.
  inputs?: string;              // formatted project context the tool received
  presetTaste?: string;         // taste + medium-guard from project preset.
                                // Medium-guard ("anime, 2D animation, no live-action
                                // photo pastiche") lives HERE, not in coreTask.
  userNotePolicy?: string;      // per-tool stance on user note. Generate-tools:
                                // "user note = hard constraint; range is variation
                                // inside it." Refine-tools: "apply note surgically;
                                // preserve locked structure." Some tools skip it.
  outputContract: string;       // shared. JSON schema or shape contract.
  userNote?: string;            // optional free-form artist direction
};

// Composed output (section order encodes the constraint hierarchy):
// <coreTask>                     ← tool contract (top of hierarchy)
//
// CONTEXT
// <workflowContext>
//
// INPUTS
// <inputs>
//
// TASTE
// <presetTaste>                  ← medium guard
//
// USER NOTE POLICY
// <userNotePolicy>               ← how to resolve user note vs other layers
//
// <outputContract>
//
// USER NOTE
// <userNote>                     ← actual artist direction
```

---

## 8. Open Questions

Resolved this round:
- ~~Mirage domain~~ → Railway issued `https://mirage-platform-production-05ca.up.railway.app`. No custom DNS in v1.
- ~~`MIRAGE_ENCRYPTION_KEY` value~~ → generated during Railway setup and stored in Railway service variables. Keep the backed-up value outside the repo; rotating it breaks decryption of existing BYOK rows.
- ~~Strategy picker location~~ → Audio phase (T5.6); Studio surfaces the lipsync-blocked warning only (T6.8)
- ~~Voice ID validation~~ → accept any string at save; fail at gen time with structured error. Cheaper, simpler. Add `/v1/voices` validation in v1.5 if support burden hits

Still open:
1. **Supabase Auth redirect configuration** — add the Mirage Railway domain to Supabase Auth / Google OAuth redirect allowlists before user sign-in smoke testing.
2. **Renderer wiring** — set `REMOTION_RENDERER_URL` and `RENDERER_SHARED_SECRET` once we decide whether Mirage reuses the existing renderer service or gets its own renderer service.

---

## 9. Checkpoints

Append a one-line note when finishing a task. Keep it dated.

```
2026-05-18 Claude: ledger drafted, awaiting Saul lock
2026-05-18 Claude: D16 added (permanent fork); §3 rewritten for two-branch architecture; T7 expanded to "final merge from main + rename to mirage"
2026-05-18 Claude: D3 corrected to two-value (`lipsync` and `overlay`) with the actual Seedance-lipsync semantics; §7 AudioPlan contract + lipsync-ordering constraint added; T3.4 documents default-strategy heuristic; T5.6 restored as per-shot picker with lipsync-blocked warning; T6 expanded to cover both video-gen paths (lipsync passes TTS to Seedance, overlay generates silent + mixes at render); T4.8 audio-director skill teaches the strategy choice + ordering
2026-05-18 Claude: D6 reworked (no internal env fallback — Saul BYOKs too); D17 (migration freeze), D18 (engine session protocol cherry-pick), D19 (TTS $20/day cap) added; T2.3 resolver simplified (no env fallback); T2.9 repurposed for daily-cap table; T3.5 enforces D19; §6 sequencing rewritten for the split (Claude: BYOK UI + audio frontend; Codex: T7→T1→T2 backend→T3→T4→T6 backend in sequence); §8 open questions resolved down to MIRAGE_ENCRYPTION_KEY operational item
2026-05-18 Claude: D6 corrected — required-at-connect keys are minimal (segmind+gemini for music_video; segmind+elevenlabs for anime). Anthropic is only needed for web-studio AI buttons (Codex users skip backend LLM via harness-native). T2.7 /connect gate enforces minimal set; optional providers prompted at feature invocation
2026-05-18 Claude: D20 added — Mirage uses Segmind for all image+video gen; no Vertex/GCP fallback in Mirage runtime. T1.9 added covering the routing change (Segmind serves Nano Banana Pro + 2; preset default switches to nano-banana-pro; Vertex fallback stripped from studio prefix). Lahari `main` keeps existing GCP fallback path unchanged
2026-05-18 Claude: D6 tightened — explicit that both Codex Desktop AND Claude Code are supported harnesses; both bring their own LLM subscription; Anthropic/OpenAI are pure web-studio-without-harness concerns. T2.8 Account Keys UI splits into Required vs Optional sections with explanatory copy
2026-05-18 🔒 LOCKED. Sandbox session ends. Next session opens in `lahari-preset-abstraction` worktree directly (not in the Claude Code sandbox) and starts execution from Day 1 of §6 sequencing
2026-05-18 Codex: T7 started. Dirty Mirage prep committed as cd3064a; merged latest `main` into the Mirage lane, preserving Mirage StartProject/mode-aware docs and taking main notebook-sync/CLI release plumbing. Verification passed: `npx tsc --noEmit`, `npm run build`, `git diff --check`.
2026-05-18 Codex: T7 complete locally and pushed to `origin/mirage`; old remote branch was absent. Started T1 package fork: copied Lahari MCP/CLI into `packages/mirage-mcp-server` and `packages/mirage-cli`, renamed package names/env vars/default URL/headers for Mirage. Syntax checks passed for both package entrypoints.
2026-05-18 Codex: T2 backend skeleton started while Claude owns frontend files. Added `studio_tenant_api_keys` migration/bootstrap table, app-level AES-GCM helper, BYOK resolver, and authenticated `/api/account/api-keys` GET/PUT/DELETE routes. Verification passed on combined tree: `npx tsc --noEmit`, `npm run build`, `git diff --check`.
2026-05-18 Codex: T2.5 first pass started. Added request-scoped user context, routed text/Gemini/OpenAI/Segmind provider clients through the BYOK resolver for authenticated web/MCP calls, and renamed newly minted MCP/CLI tokens/snippets to Mirage while accepting legacy `lahari_mcp_` tokens. Verification passed on combined tree: `npx tsc --noEmit`, `npm run build`, `git diff --check`.
2026-05-18 Codex: T2.5 review follow-up. Removed user-provider env fallback from `requireProviderApiKey`; provider calls now require request user context and BYOK. Added explicit system-provider helper for future background jobs. At the time, `@ssaulgoodman420/mirage-cli` was not published yet, so CLI sync snippets temporarily kept a configurable `MIRAGE_CLI_PACKAGE` fallback until the Mirage package publish step.
2026-05-18 Codex: T2.6 started. Added shared structured error normalization for `missing_key`, wired hosted MCP/director error wrapping to preserve provider/setupUrl, and updated provider-heavy web routes to return `{ ok:false, error:{ code:'missing_key', provider, setupUrl } }` instead of flattening BYOK failures to generic errors. Full app typecheck/build is temporarily blocked by Claude's in-progress T5.2 frontend edits; server-only route/typecheck passes.
2026-05-18 Claude: T2.7 + T2.8 done (commits 20b15e3, ec9a2c4). `AccountKeys.tsx` at `/account/keys` with Required (Segmind/Gemini/ElevenLabs) and Optional (Anthropic/OpenAI) sections per D6. `ConnectPage.tsx` rebranded Lahari→Mirage and added BYOK gate; minting blocked until a workflow lane is complete. `services/api.ts` BYOK stubs match Codex's `/api/account/api-keys` routes. Verification passed: tsc, build, diff-check.
2026-05-18 Claude: BYOK gate review fixes (commit 5fea85e). Killed `tokens.length > 0` bypass so revoked/expired tokens can't skip BYOK setup. Replaced flat 3-provider checklist with two workflow lanes (Music Video: Segmind+Gemini; Anime: Segmind+ElevenLabs); minting unlocks when either lane is complete. Token-mask copy uses actual minted prefix instead of hardcoding `mirage_mcp_` (until Codex's prefix rename landed in 66408bd).
2026-05-18 Claude: T5.1 + T5.9 done (commit 8547fcb). Added `constants/blueprintPhases.ts` as workflow-keyed phase config — adding ads/reels later means a new entry, no new branches across the UI. `BlueprintContextBar` phaseIndex/getActivePhase/getStatusLockedPhase/isLockedPhase now take the project; tab nav renders from the config. Anime gets Audio tab as a coming-soon disabled chip until T3 + T5.4 ship. Music video tab list unchanged. Verification passed.
2026-05-18 Claude: T5.2 done (commit ac15944). Added §7 AudioPlan/DialogueLine/CastMember-voice types, four audio API stubs (writeAudioPlan/generateDialogueAudio/getAudioPlanCost/updateCastVoice). DialogueBlock renders under each shot in ScriptPhase, gated by config helper `findPhase(project, 'audio').visible` — no workflowKey strings. Empty → "Write dialogue" CTA. Populated → speaker/text/delivery/TTS-status-pill. Stale → amber chip + Rewrite. Plus bulk "Write all dialogue" header button. Calls 404 until T3.4 backend lands.
2026-05-18 Codex: Future flags from T2/T3 reviews recorded before continuing Day 7 backend work: consider changing `missing_key`/daily-cap HTTP 402 to 409 if any client/proxy dislikes 402; replace message-string status inference with explicit status-bearing error classes; retire JSON-in-Error-message structured unwrapping once all throw sites use real classes; debounce `last_used_at` writes on hot provider paths; publish/switch `@ssaulgoodman420/mirage-cli` before removing Lahari CLI fallback; smoke-test AsyncLocalStorage through hosted MCP/provider paths.
2026-05-18 Codex: T2.9 + T3.1-T3.3/T3.7 backend foundation started. Added studio audio schema migration/bootstrap fields (`voice_provider`, `voice_id`, `voice_name`, `audio_plan`, `audio_plan_stale`, `studio_provider_usage_daily`), table mapping + usage-cap service, ElevenLabs TTS dispatcher using tenant BYOK, `DailyCapExceededError` structured shape, full-project hydration for voice/audio fields, and `PATCH /api/projects/:id/cast/:memberId/voice`. Verification on combined tree passed: `npx tsc --noEmit --pretty false`, `npm run build`, `git diff --check`.
2026-05-18 Claude: T2.6 frontend pickup done. Added `ApiError` class + `isMissingKeyError` helper to `services/api.ts`; `handleResponse` now throws the typed error carrying `code`/`message`/`provider`/`setupUrl`/`retryAfterSeconds`. AnalysisEditor's `showActionError` accepts `string | unknown` — strings pass through (37 existing call sites unchanged), `missing_key` ApiErrors produce a structured banner with a "Set up <Provider> key →" link to the setupUrl. BlueprintContextBar's audio-analysis catch handler updated to pass raw error so Gemini missing-key surfaces inline. Phase component `showActionError` prop types widened to match. Verification passed.
2026-05-18 Codex: Review fixes for e82e97f. Dropped `deliveryHint` from ElevenLabs spoken text so the model never reads direction aloud; delivery remains stored on `audio_plan` for later provider support. Replaced read-then-write provider usage increment with atomic `studio_increment_provider_usage_daily` RPC in bootstrap + additive migration, so concurrent TTS calls add cost/char counts instead of clobbering each other.
2026-05-19 Codex: T3.4 started. Added `server/services/audioDirector.ts` prompt/schema/sanitizer and mounted `POST /api/projects/:id/write-audio-plan` via `server/routes/generate-audio.ts`. Route selects requested/stale/empty shots, calls text-provider with structured output, persists validated `audio_plan`, clears `audio_plan_stale`, records `audio_plan_written`, and returns hydrated project. Verification passed: `npx tsc --noEmit --pretty false`, `npm run build`, `git diff --check`.
2026-05-19 Claude: T5.3 done. CharactersPhase voice editor renders inline on each cast card (provider dropdown — ElevenLabs only for v1 per D12 — voice_id input, optional voice_name label, save button with dirty/reset). Gated by `findPhase(project, 'audio').visible` so music_video sees nothing; same config-driven pattern as T5.2 dialogue UI. Sidebar shows "needs voice" amber pill when `voiceId` unset. Wired to `api.updateCastVoice()` against Codex's `PATCH /:id/cast/:memberId/voice` route. Errors pass through `showActionError(err)` so a missing ElevenLabs key surfaces a "Set up Elevenlabs key →" link to /account/keys via the T2.6 ApiError path. Verification passed: tsc, build, diff-check.
2026-05-19 Codex: Review fixes for 4886e6e. Relaxed audio-plan structured schema so only load-bearing fields are required (`dialogue`, plus `characterId`/`text`/`order` per line), and removed LLM-authored `dialogueStrategy` from the schema because server inference is canonical until T5.6 artist override. Also normalized write-audio-plan precondition failures through structured error handling. Future flags: batch write-audio-plan should use bounded concurrency/progress for large scripts; character look unlock should mark affected shot `audio_plan_stale` when an existing lipsync strategy may no longer be valid.
2026-05-19 Codex: T3.5 + T3.6 started. Added `GET /api/projects/:id/audio-plan-cost` and `POST /api/projects/:id/generate-dialogue-audio` to `generate-audio.ts`. Cost preview returns pending char count, estimated ElevenLabs cost, pending line count, and missing voices. Generate route resolves cast voices, checks D19 daily cap against generatable lines, calls tenant BYOK TTS, stores `dialogue_audio` assets, increments provider usage, writes `ttsAssetId`/status/char count back into `audio_plan`, records `dialogue_audio_generated`, and returns generated/failed line lists plus refreshed project. Verification passed: `npx tsc --noEmit --pretty false`, `npm run build`, `git diff --check`.
2026-05-19 Claude: T5.4 done. AudioPhase.tsx renders dialogue grouped by shot with scene context, dialogue-strategy pill (lipsync/overlay), per-line speaker/text/delivery/pace/duration. Header stats (lines/ready/pending/errored) + cost estimate with `getAudioPlanCost` and a local fallback computation if the route 404s. Filters by character + tts status. Bulk "Generate N pending" button + per-shot "Generate shot" + per-line Regen/Gen. `<audio controls>` plays `ttsAssetUrl` once a line succeeds. Missing-voice banner with deep-link to Characters phase. Audio tab flipped from coming-soon to live in `constants/blueprintPhases.ts`. Added optional `ttsAssetUrl?: string` to `DialogueLine` (backend hydration contract — Codex will need to enrich `audio_plan.dialogue[]` in `getFullProject`). Empty state when no plans exist routes back to Script. Errors pass through `showActionError(err)` so missing ElevenLabs key surfaces the T2.6 BYOK setup-link banner. Verification passed: tsc, build, diff-check.
2026-05-19 Codex: T5.4 review fixes. `getFullProject` now bulk-resolves `audio_plan.dialogue[].ttsAssetId` and hydrates `ttsAssetUrl` so the AudioPhase player has a real URL. AudioPhase now accepts the T3.5 response shape (`{ project, generated, failed }`) and refreshes from `resp.project` after generation.
2026-05-19 Codex: Future flags from T3.5 review recorded. `ttsDurationSec` stays empty until we add an audio-duration measure step after TTS generation (ffprobe/music-metadata). The D19 cap is enforced per request with atomic usage increments, but true cross-request hard locking needs a check-and-increment transaction/RPC before v1.5 if concurrent/multi-client generation becomes common.
2026-05-19 Claude: T5.4a done. Audio harness simplification pass after Saul's audit. Core principle saved as a feedback memory: **UI must not be stricter than the engine.** Bulk generation now targets "available" lines (pending/error AND cast has voiceId); missing voices appear as a nudge with link to Characters phase, never as a global blocker. Per-shot button uses the same available-only filter. Header replaced 4-stat grid + filter row + missing-voice red-bar with a single inline summary line ("N lines · X ready · Y available · Z waiting on voices · est. $0.XX") + a quieter waiting-on-voices nudge underneath. Removed character/status filters and the unused `Stat` helper. Cost preview now estimates over the available subset (what the bulk button would actually charge). Empty filter state copy reworded. Verification passed: tsc, build.
2026-05-19 Codex: T3.9–T3.11 backend contract slice done. `WorkflowRecipe.stages.audio` is now explicit (`music_video` skipped, `anime_scripted` optional), `PipelinePreset.audio` carries dialogue/sound/strategy rules, and the runtime audio-director prompt injects those preset rules. Added catalog entry for `write-audio-plan`. Added in-place audio staleness propagation for scene narrative, shot direction/cast/environment/duration, and cast/environment description edits: existing `audio_plan` JSON is preserved and `audio_plan_stale` flips true in studio/platform mode.
2026-05-19 Codex: T4.5 packet additions started/done. `get_project_packet` now includes `production.audioPhase` with state, missing voices, pending TTS count, total dialogue lines, and stale audio-plan shot IDs. Cast packet entries include voice assignment state. Project/shot packets include summarized `audioPlan` and `audioPlanStale` so harness agents can reason about dialogue/TTS/lipsync state without scraping the web UI.
2026-05-19 Claude: T5.5 done. New `components/TtsGenerateModal.tsx` interposes on bulk + per-shot generation per D14. Modal fetches a fresh cost preview against the exact dialogue subset, shows lines-to-generate / chars / estimated USD / already-ready count, and a quiet "Skipping N lines waiting on voices: Narrator (2 lines), …" nudge with link to Characters phase. Confirm button fires the actual generation; Cancel dismisses. Per-line Regen stays direct (single small call). Removed inline cost-estimate from the AudioPhase header — the modal owns cost display now, so the header summary line is one row of counts without dollars. Verification passed: tsc, build.
2026-05-19 Codex: T4.8–T4.9 audio-director skill added in both materialized resources and repo-local `.agents/skills`. Skill teaches source preservation, dialogue text vs delivery cues, lipsync/overlay choice, voice prerequisites, restrained soundNotes, staleness review, and the harness rule that missing voices are visible tasks rather than global blockers.
2026-05-19 Codex: Clarified T3.10 after review. In-place edits preserve existing `audio_plan` JSON and mark it stale; full script regeneration/apply remains a destructive topology replacement that can discard old shot-level audio plans. This keeps v1 simple and avoids inventing fuzzy shot matching before artists need it.
2026-05-19 Claude: T5.5 fix for Codex P2. `TtsRunScope` now carries `skippedVoices` baked in at trigger time. `openBulkRun` rolls up project-wide skipped voices; `openShotRun` rolls up only the selected shot's waiting-voice lines. Modal now describes the exact run — clicking "Generate 2" on shot S3 no longer lists waiting voices from S1/S5. Dropped the project-wide `skippedVoiceRollup` useMemo and the `skippedVoices` prop on the modal (now read from `scope.skippedVoices`). Verification passed: tsc, build.
2026-05-19 Codex: T5.6 backend prerequisite landed. Added per-shot audio-plan patch route for `dialogueStrategy`, backend validation that `lipsync` requires look references for every dialogue speaker, and API client wrapper. `write-audio-plan` now preserves an existing strategy during dialogue rewrites unless the preserved value would be invalid for the rewritten dialogue.
2026-05-19 Claude: T5.7 done. Audio phase now mirrors the `audio_plan_stale` surface ScriptPhase already shows. Per-shot header gets an amber "stale" chip next to the dialogueStrategy pill when the plan is stale, plus a "Rewrite" action that calls `writeAudioPlan(shotIds:[id], force:true)` and refreshes the project. Project-level header summary adds "N stale shots" so the artist sees the count at a glance without scanning every shot. Carries `audioPlanStale` through `EnrichedLine` and into the per-shot bucket so rendering is single-pass. Verification passed: tsc, build.
2026-05-19 Claude: T5.6 done. Replaced read-only StrategyPill on each shot header with `StrategyPicker` — inline two-segment toggle (lipsync / overlay). Active segment is highlighted; click on the inactive option calls `api.updateShotAudioPlan(projectId, shotId, { dialogueStrategy })` and refreshes the project. Lipsync segment is disabled when any dialogue speaker in the shot lacks a locked look reference (D3 constraint); tooltip names exactly which characters need looks ("Needs a locked look reference for: Mina, Ren"). Backend `lipsync_requires_look_reference` errors flow through `showActionError(err)` for the race-condition path. Added `castHasLook` map and a per-shot `noLookSpeakers` derivation. New `tts needed` amber chip on shot header when `dialogueStrategy === 'lipsync'` and any line lacks a successful TTS asset — tells the artist to generate TTS before video gen. Verification passed: tsc, build.
2026-05-19 Codex: T4 audio harness tools landed. Added shared `codexStudio/audioPlan` service, hosted `/mcp` tools and Mirage package facade tools for `apply_audio_plan`, `apply_audio_plan_markdown`, `apply_cast_voice`, `get_audio_plan_cost`, and `generate_dialogue_audio`. Notebook now materializes `mirrors/audio-plan.md`, `drafts/audio-plan.md`, and the audio-director skill; notebook version bumped to `2026-05-19.audio-plan-v1`. Verification passed: `npx tsc --noEmit --pretty false`, `npm run build`, `git diff --check`.
2026-05-19 Claude: T6.8 done. Studio's ShotCard now shows an amber `tts needed` chip on shots whose `audioPlan.dialogueStrategy === 'lipsync'` AND any dialogue line lacks a successful TTS asset — surfaces the prerequisite before the artist clicks Generate Video. Chip is clickable when `onJumpToAudioPhase` is wired: AppShell stashes `mirage:initialBlueprintPhase=audio` in sessionStorage and routes to BLUEPRINT; AnalysisEditor reads + clears the hint on mount so the artist lands on Audio. Threaded `onJumpToAudioPhase?: () => void` through Storyboard → ShotCard; the chip falls back to a static badge when the callback isn't provided. This is the Studio-side mirror of the T5.6 chip on the Audio phase header, closing the missing-TTS warning surface ahead of T6.2 backend lipsync wiring. Verification passed: tsc, build.

This closes Claude's non-blocked v1 frontend lane. Remaining for v1: Codex's T1 infra/provisioning, T6 backend video/render lipsync+overlay wiring, and shared golden-path/music-video regression E2E testing. Further UI affordances are deferred to post-E2E findings (per Codex review guidance on T5.6/T5.7 polish flags — wait for testing signal before pre-emptive de-emphasis).

2026-05-19 Claude: Rebranded surviving user-facing Lahari mentions to Mirage after Saul hit the SignIn page still saying "Lahari Media Engine". Fixed: SignIn title + tagline ("Mirage" / "AI video production studio"), AppHeader logo ("Mirage"), four bulk-complete notifications in AppShell ("Mirage · Prompts/Storyboards/Frames/Videos done"), index.html `<title>` ("Mirage — AI Video Studio") + favicon glyph (L → M), server boot log ("Mirage Studio API"). Frontend Lahari sweep is now clean except `server/prompts/catalog.ts` which stays as-is per its legacy/internal quarantine status (runtime prompts come from claude.ts and friends). Verification passed: tsc, build.

(Append below.)

2026-05-19 Codex: T6.1/T6.2/T6.3 backend video generation path landed. `generateShotVideo` now threads `audio_plan.soundNotes` into the video prompt as visible action cues only, explicitly not generated audio. It treats `shot.audio_plan.dialogueStrategy === 'lipsync'` as the Seedance dialogue-lipsync path: validates every dialogue line has successful TTS, resolves the `dialogue_audio` assets, concatenates multiple lines into one `shot_audio_ref` MP3 with ffmpeg, and passes that reference audio to Seedance for both storyboard and keyframe modes. Missing TTS fails before paid video gen with structured `{ code: 'lipsync_tts_missing', shotId, missingDialogueIds }`; non-Seedance lipsync attempts fail with `{ code: 'lipsync_requires_seedance' }`. `overlay` and absent audio plans remain silent video-gen paths and do not send dialogue text/audio to Seedance. Verification: `npx tsc --noEmit --pretty false` passed. Remaining T6 work is render-time overlay mixing (T6.4/T6.6/T6.7) and E2E validation.

2026-05-19 Codex: T6.4/T6.6 backend render overlay path landed. `/api/projects/:id/render` now augments the outgoing renderer snapshot with injected audio track items for shots whose `audio_plan.dialogueStrategy === 'overlay'` and whose dialogue lines have successful `ttsAssetId`s. Injection matches each shot to its current timeline video clip by video asset URL, then schedules dialogue audio sequentially inside that clip using `ttsDurationSec`, `targetSec`, or an even fallback slice. Lipsync shots are skipped because their dialogue audio is baked into video generation. Existing FFmpeg render path already supports delayed audio items and mixing, so overlay dialogue remains FFmpeg-eligible instead of forcing Remotion. Render-start director event records `overlayDialogueInjected`. Remaining T6 work: optional overrun warning affordance (T6.7) and golden-path validation.

2026-05-20 Codex: Schema audit decisions locked as D21/D22. The v1 schema doctrine is now explicit: `project_brief` carries artist intent, `source_payload` carries raw seed material, `target_duration` is per-shot pacing only, music-video analysis columns are compatibility-only, `audio_plan` owns dialogue/TTS/strategy, and `lipsync_enabled` remains legacy song-lipsync. Mirage frontend is backend-first, with direct Supabase usage limited to auth and explicit table-prefix-aware realtime surfaces with owner-scoped RLS.

2026-05-19 Codex: T1.9 partial provider consolidation. In `DB_TABLE_PREFIX=studio` / Mirage mode, `generateVideoWithFallback` no longer honors `VIDEO_PROVIDER=vertex` and no longer falls back from Segmind to Vertex; Segmind errors surface directly. Lahari/legacy mode keeps the existing Vertex backup path. Image-side Nano Banana Pro-on-Segmind routing still needs provider-endpoint verification before changing runtime image defaults.

2026-05-19 Codex/Claude: Post-E2E polish flags from T5/T6 reviews. Do not act on these before golden-path testing unless they become obvious: (1) Studio `tts needed` jump currently accepts an Audio-phase sessionStorage hint without re-checking workflow visibility; practically safe because only audio-plan shots show the chip, but guard it if a non-audio workflow ever gains stale audio data. (2) Audio phase can show both Rewrite and Generate on a stale shot with pending/error TTS; if testing shows artists generate stale dialogue by accident, de-emphasize or disable Generate while stale. (3) Render overlay currently schedules dialogue lines sequentially inside the shot using `ttsDurationSec`, `targetSec`, or equal fallback slices; if real TTS durations drift, add measured duration extraction and/or an overrun warning UI. (4) Overlay render caps dialogue at shot end and silently skips any remaining lines once `cursorMs >= shotEndMs`; if E2E exposes long-dialogue/short-shot cases, count dropped lines and surface a render warning/director event. (5) In Mirage/studio mode, `VIDEO_PROVIDER=vertex` is intentionally ignored; add a boot-time warning if that env var is present so ops/devs are not confused. (6) Lipsync concat joins TTS clips directly; v1.5 can insert ~150ms silence between lines for more natural pacing. (7) Replace JSON-stringified `Error` structured throw sites like `structuredVideoError` with typed error classes when doing the broader structured-error cleanup.

2026-05-19 Codex: T1.1/T1.2 complete on the new Mirage Supabase project. Verified `studio_projects`, `studio_scenes`, `studio_shots`, `studio_assets`, `studio_cast_members`, `studio_tenant_api_keys`, `studio_provider_usage_daily`, `studio_mcp_tokens`, and `studio_renders` through the service API. Applied missing additive BYOK/audio migrations via linked Supabase CLI because direct Postgres DNS did not resolve locally. Created the branded public storage bucket `mirage-assets` (the earlier `studio-assets` bucket also exists but Railway should use `mirage-assets`).

2026-05-19 Codex: T1.3/T1.4 started. Created Railway project/service `mirage-platform`, generated Railway domain `https://mirage-platform-production-05ca.up.railway.app`, set core production variables for `DB_TABLE_PREFIX=studio`, `SUPABASE_BUCKET=mirage-assets`, Supabase URL/keys, app URLs, CORS, and `MIRAGE_ENCRYPTION_KEY`. Updated Mirage MCP/CLI/server token defaults to the issued Railway URL. Render envs (`REMOTION_RENDERER_URL`, `RENDERER_SHARED_SECRET`) are still unset pending either a Mirage renderer service or reuse of the existing renderer secret.

2026-05-19 Codex: T1.3/T1.4 core app deploy complete. Railway deployment `c2da58cf-acc6-48ae-bcc1-22b2d4a4815a` succeeded; `https://mirage-platform-production-05ca.up.railway.app/api/health` returns 200; root HTML returns 200; deployed JS bundle points at the Mirage Supabase project. Fixed Dockerfile so Vite Supabase vars come from Railway build variables instead of hardcoded legacy values. Remaining infra before full E2E: Supabase/Google auth redirects and renderer env wiring.

2026-05-19 Codex: T1.5 MCP setup pass. Hosted `/mcp` route is reachable on the Mirage Railway app and returns JSON-RPC auth errors when called without a bearer token. Scrubbed hosted MCP server name/instructions/tool descriptions from Lahari/queue-first language to Mirage/project-first language, added `mirage_capture_issue` while keeping `lahari_capture_issue` as a legacy alias, exposed `workflowKey`/`presetKey`/`seedKind` in `list_projects`, and removed `deity` from Mirage MCP concept input schemas. `@ssaulgoodman420/mirage-mcp-server` is not published yet; `npm pack --dry-run ./packages/mirage-mcp-server` succeeds and confirms the 0.1.0 package shape.

2026-05-19 Codex: T1.5 live MCP smoke passed after applying `migrations/2026-05-19_add_studio_cli_notebook_sync_tokens.sql` to Mirage Supabase. Disposable auth user + temporary `studio_mcp_tokens` row initialized against live `/mcp`; server reports name `mirage`, protocol `2025-06-18`, 60 tools, all audio-plan/TTS tools, and `mirage_capture_issue`. Smoke user/token were deleted afterward; auth user count returned to 0.

2026-05-19 Codex: T1.5/T1.6 package naming updated to Saul's npm scope. Mirage CLI package is `@ssaulgoodman420/mirage-cli`; Mirage MCP facade package is `@ssaulgoodman420/mirage-mcp-server`. Generated `mint_cli_token` commands now default directly to `@ssaulgoodman420/mirage-cli@0.1.0` instead of the temporary Lahari CLI fallback.

2026-05-19 Codex: T1.5/T1.6 npm publish complete. Published `@ssaulgoodman420/mirage-cli@0.1.0` and `@ssaulgoodman420/mirage-mcp-server@0.1.0` with public access. Registry verification succeeded for both package names/versions/bins; `npm exec --package @ssaulgoodman420/mirage-cli@0.1.0 -- mirage --help` reaches the published CLI and returns its usage text via the unknown-command fallback.

2026-05-20 Claude: Agent-native pivot codified. D23 (agent harness is the primary product surface; web UI is overwatch), D24 (tool registry as cross-surface contract; `WorkflowRecipe.stages` deprecated), D25 (`composePrompt` is the prompt-build doctrine; per-workflow `coreTask` dispatch; no workflow noun leaks). Triggered by Saul's audit of `buildStyleBrainstormPrompt` — anime style brainstorm was leaking live-action/Polaroid examples because the prompt was a music-video-shaped fat template with nouns swapped. Added §4 tracks T8 (registry), T9 (composer migration, ~11 tools split across Codex + Claude), T10 (web UI asset-shelf refactor). §6 Wave 2 sequencing locked: ~7 working days, split lanes, net code deleted not added. §7 contracts updated with `ToolManifest` and `ComposePromptParts` shapes. Navigation aid added to preamble. **This pivot happens before E2E; v1 ships on the new shape.**

2026-05-20 Claude: Wave 2 corrections after Codex review. Four refinements landed in the ledger before work begins:
- **D25 sharpened** to explicitly ban workflow/preset enum labels (`anime_scripted`, `music_video_default`) from prompt text. Logs may reference keys; prompt bodies receive only human-readable production language. Caught because the old `buildStyleBrainstormPrompt` was injecting `Workflow: ${preset.workflowKey}` directly into the LLM input.
- **`ToolManifest` field renamed** `preset?: 'music_video' | 'anime_scripted'` → `enabledFor?: WorkflowKey[]`. The old name conflated preset (taste/defaults) with workflow profile (production kind). Vocabulary discipline note added to D24.
- **T9.2 reframed**: anime body is production-neutral within anime production, not taste-locked to OVA/cel/vintage. The contract is "don't accidentally leave the medium," not "be a specific era." Brainstorm output must span modern/retro/soft/harsh/photoreal-leaning. Saul's 2026-05-20 design example is illustrative of the medium-guard mechanism only.
- **§6 proof gate inserted** between W2.2 and W2.3. Before any UI (T10) or further tool migrations (T9.3+) begin, run one live anime style brainstorm against the migrated tool and validate the composed prompt + LLM output. Smallest meaningful slice that proves registry+composer+packet end-to-end on one broken seam + one clean reference.

2026-05-20 Codex: W2 Codex foundation slice started. Added `server/tools` registry primitives (`ToolManifest`, asset-state resolver, `availableTools`/`blockedTools`) using asset availability rather than phase status. The registry uses `enabledFor` for workflow gating and keeps produced assets precise (`write-shot-prompts` produces `shotPrompts`; `generate-keyframe` produces `keyframes`; storyboard planning/rendering split likewise). MCP project packets now expose `production.availableTools` and `production.blockedTools` alongside the existing `audioPhase` packet for the proof gate. Added `composePrompt` plus composer-routed `write-audio-plan` as the clean reference implementation; prompt text uses production language and no workflow/preset enum labels. Verified on live anime project `IT SAID OH`: packet lists available script/style/prompt tools and blocks character/env looks on `styleAsset`, dialogue audio on `audioPlan` + actual speaker voices, and render on `videos`. Validation passed: `npx tsc --noEmit --pretty false`, `npm run build`, packet smoke via `buildProjectPacket`.

2026-05-20 Claude: D26 archetype lock + D25 reframe. **D26**: workflow taxonomy locked at 4. v1 active = `music_led` (audio-spine), `scripted_narrative` (script-spine). Deferred = `campaign` (brief-spine), `short_form` (hook-spine). Anime moves from workflow to preset under `scripted_narrative`. Current code/rows may still use legacy keys `music_video` and `anime_scripted`; those become aliases until Codex performs the runtime migration. **D25 reframe**: Saul pushed first-principles on per-workflow `coreTask` burden — "5 workflows = 5 prompts feels like back where we started." Right diagnosis. The Polaroid leak was caused by taste being baked into the shared body, not by sharing the body. Fix the layering, not duplicate the bodies. New shape: shared `coreTask`, small `workflowContext` slot, `presetTaste` carries medium-guard + taste rules. Single body across workflows; workflow becomes a context string, medium-guard moves to preset taste injection. Added T9.12 (composer signature extension to add `workflowContext` slot, non-breaking). Updated T9.2 and §6 W2.x to reflect new shape. Composer/skills share doctrine, not text — composer governs API-tool calls; agent-native reasoning consumes skills+packet+registry. Doctrine-level change ahead of code-level rename; Codex owns the code rename in next slice on top of W2 foundation.

2026-05-20 Codex review note: Adjusted D26 to call `music_led` / `scripted_narrative` the canonical target keys, not already-migrated runtime truth. The migration must keep `music_video` / `anime_scripted` as compatibility aliases until code, DB rows, frontend refs, and MCP packets move together. Also corrected T9 wording so the new foundation is shared coreTask + workflowContext + presetTaste, not "workflow-aware coreTask" or anime-era examples.

2026-05-20 evening Codex: T9.2 style-brainstorm migration committed. Added `server/prompts/styleBrainstorm.ts` using composePrompt; removed the old raw-prompt path that injected `Workflow: ...` / `Preset: ...` labels; added `style.brainstormTaste` field to PipelinePreset (separate from shared `style.rules` per Codex's review of Claude's draft); populated anime/music-video preset taste with Claude's draft text (medium-guard bans the failure mode, not technical ingredients; aesthetic range named as starting points not a fixed menu); prompt catalog repointed at new file. Validation: tsc + build + diff-check passed. Claude reviewed in worktree pre-commit; no blockers.

2026-05-20 evening Saul: Proof gate effectively passed via local OpenAI substitute (Anthropic key out of credits; MIRAGE_ENCRYPTION_KEY missing locally so BYOK decrypt failed). X-Ray log `19f5abb4-de4b-4f4b-bed9-7d83139fc370`, model `gpt-5.5-local-system-key`. All six criteria held: no music-led chrome, no era-lock, four distinct corners (Rain-Soft Digital Minimal / Late-Nineties Cel Memory / Pastel Room Reverie / Black Glass Signal), no enum labels in prompt body, layering held. One behavioral observation: user-note "vintage" produced only one vintage direction out of four — the new prompt was treating user note as a nudge, where the old `buildStyleBrainstormPrompt` had treated it as a hard constraint ("All 4 must be variations within this preference"). Decision: user note IS a hard constraint, bounded by tool contract + medium guard.

2026-05-20 evening Claude: D25 refined to codify the constraint hierarchy (tool contract > medium guard > user note > range) and add `userNotePolicy?: string` slot to `composePrompt`. Composer extended; section ordering encodes the hierarchy. styleBrainstorm.ts updated with brainstorm-specific policy: "user note = hard creative constraint inside tool contract and TASTE; all 4 directions must satisfy it; if note conflicts with medium guard, translate to closest medium-safe analogue (e.g. 'Polaroid' on anime → printed-photo-inspired color/texture still rendered as drawn anime, not actual photograph); range means variety inside the note, not in spite of it." outputContract updated to match. Per-tool policy means each tool's stance on user notes is explicit: generate-tools = hard constraint; refine-tools = surgical preserve-locked-structure; script parser = no policy. §7 ComposePromptParts shape updated.

2026-05-20 Codex: T9.12 + D26 runtime alias slice landed. `composePrompt` now supports optional `workflowContext` with a `CONTEXT` section, and the audio-plan reference prompt uses it. `server/presets.ts` now defines canonical workflow keys `music_led` / `scripted_narrative` with legacy aliases `music_video` / `anime_scripted`; new intake writes canonical keys, old rows hydrate through `normalizeWorkflowKey`, registry `enabledFor` values use canonical keys, and MCP `list_projects` returns canonical workflow keys. Frontend intake, BYOK lanes, header labels, and Blueprint phases understand canonical keys while keeping legacy phase aliases for old project objects. Validation passed: `npx tsc --noEmit --pretty false`, `npm run build`, `git diff --check`, packet smoke on existing `IT SAID OH` row (`anime_scripted` stored → `scripted_narrative` hydrated), and intake resolver smoke for both old/new workflow strings.

2026-05-21 Codex: T9.5 + T9.6 migrated. Added `server/prompts/planScenes.ts` for the `music_led` script planner and `server/prompts/parseScript.ts` for direct `scripted_narrative` intake. Both use `composePrompt` with shared core task, `workflowContext`, `INPUTS`, `TASTE`, and output contract. `planScenes` keeps its hard user-note policy; `parseScript` has no user-note policy because director brief is source input. Scrubbed devotional examples from the Anthropic tool schema (`Goddess Mahalakshmi`, `Vaikuntha Palace`, etc.) and renamed the script-intake tool call from `parse_anime_script` to `parse_scripted_narrative` while preserving the existing exported function name for caller compatibility. Also restored `deity` as a legacy fallback in the shared `conceptSubject` helper after reviewing Claude's T9.3/T9.4 commit. Validation passed: `npx tsc --noEmit --pretty false`, `npm run build`, `git diff --check`, prompt render smoke for music-led + scripted-narrative builders.

2026-05-21 Codex: T9.9 + T9.11 cleanup migrated. Added `server/prompts/storyboard.ts` and routed storyboard planning/refine through `composePrompt` with `workflowContext`, preset taste, surgical `userNotePolicy`, and a compact JSON output contract. Retired the remaining OpenAI script fat templates by delegating plan/refine/write-shot-prompts to the composed prompt modules; renamed OpenAI schema labels away from music-video/Lahari wording. Synced the prompt catalog for audio plan, OpenAI planning, shot prompts, and storyboard planning so the reference surface no longer shows devotional examples or workflow enum labels. Per Saul's call, removed the concept `deity` compatibility fallback from shared helpers, Claude concept schemas, notebook/report mirrors, and concept apply inputs; remaining `deity` references are legacy song-catalog adapter fields only. Validation: `npx tsc --noEmit --pretty false`, `npm run build`, `git diff --check`, and storyboard prompt render smoke.

2026-05-21 Codex: T8.6 completed. Removed `WorkflowRecipe.stages` from `server/presets.ts`; workflows now describe planner/source spine only. MCP project packet audio-phase compatibility block derives `skipped` from the registry (`no asset:audio tools`) instead of stage metadata. Artist notebook copy now tells agents to use available/blocked tools as the source of truth for what can run next. Registry types were decoupled from the full project API type so adding `availableTools`/`blockedTools` to project responses cannot create type recursion. Validation: `npx tsc --noEmit --pretty false`, `npm run build`, `git diff --check`.

2026-05-21 Codex: T10.8 completed. Removed `getStatusLockedPhase` / `isLockedPhase` from `BlueprintContextBar`; tab checkmarks now derive from navigation progress (`activePhase`) rather than status-stage gates. Script/Style/Characters/Environments unlock affordances now use explicit `canReopenBlueprintPhase()` status checks that mirror backend rewind endpoints, keeping unlock UX separate from tool availability. Remaining phase visibility still comes from `constants/blueprintPhases.ts` until the next shelf-level pass; tool availability remains registry-owned. Validation: `npx tsc --noEmit --pretty false`, `npm run build`, `git diff --check`.

2026-05-21 Claude/Codex: T10.9 completed and reviewed. AssetShelf now shows a subtle "Next" chip for the first runnable tool on a shelf, or "Waiting on" with the missing assets when all visible tools are blocked. Codex review found and fixed one duplicate-click seam: the chip now disables while the shelf is externally disabled or while that tool key is already busy, matching the main tool-row behavior. This closes Wave 2 structurally: registry -> composer -> AssetShelf is now the shared web/agent contract.

2026-05-21 Codex: T11 first slice landed. Composer now has a structured section model (`composePromptSections`, `inspectComposedPrompt`) and rendered prompts include an explicit `OUTPUT CONTRACT` section so the final prompt can be inspected without guessing. X-Ray `ai_calls.context_chain.recipe` now records tool key, preset key, workflow key, section labels, and section bodies for every logged call using the actual prompt text; no schema migration required. The X-Ray drawer shows a "Tool recipe" section above the raw prompt. `/api/prompts` now returns registry tool recipes, and the Prompt Library page is reframed as "Tool Recipes" with cards for what each tool needs/reads/produces before the legacy prompt references. Also scrubbed the last X-Ray concept-summary `deity` fallback. This is the minimum product/debug surface for "why did this output happen?" before E2E.

2026-05-21 Codex: T12 added and first MCP polish slice completed. Ledger now tracks MCP/notebook/packet polish as a first-class pre-E2E lane. Generated notebooks now install `mirage-director` instead of `lahari-director`, use notebook version `2026-05-21.mcp-polish-v1`, and teach canonical `music_led` / `scripted_narrative` project mode. Script/audio skills were canonicalized, script/storyboard draft formats moved to `mirage-*`, storyboard draft paths use `mirage/projects/...`, project/shot packets use `mirage.project.packet` / `mirage.shot.packet`, and CodexStudio apply/generation/action result kinds now return `mirage.*`. Artist-facing action suggestions now point to MCP tools instead of `npm run lahari` engine-debug commands. Validation passed: `npx tsc --noEmit --pretty false`, `npm run build`, `git diff --check`.

2026-05-21 Codex: T12 follow-up after Claude review. Closed the mixed-namespace seam missed in `899111c`: root `server/services/codexStudio.ts` director-session/preview/apply/rollback/workbench responses now use `mirage.*` kinds, local engine desk-copy paths moved from `.lahari/*` to `.mirage/*`, and `server/services/lahariAudit.ts` was renamed to `mirageAudit.ts`. Hosted/director routes import `captureMirageIssue`; the old `captureLahariIssue` export remains only as a compatibility alias for the internal legacy `mcp/lahari.ts` adapter. Remaining `lahari_project_id` references are legacy queue DB column names, not agent-surface branding.

2026-05-22 Codex: Audio/video strategy simplified after local test. Removed the per-shot Audio phase `StrategyPicker` and its PATCH route; dialogue delivery is now a single project-level `projectBrief.dialogueVideoMode` with two modes. `lipsync` passes generated TTS into video generation and blocks when TTS is missing; `overlay` prompts the video model to perform the dialogue natively and injects generated TTS during render. Studio shot warnings and render overlay injection now read the project-level mode instead of `shot.audioPlan.dialogueStrategy`. The old per-shot field remains as legacy audio-plan data but is no longer a control surface. Validation passed: `npx tsc --noEmit --pretty false`, `npm run build`, `git diff --check`.

2026-05-22 Codex: Audio-plan shape trimmed after local UI review. Removed delivery/pace/emotion as generated audio-plan categories; new audio plans write only spoken dialogue, order, optional target timing, and restrained soundNotes. Audio phase no longer displays hidden delivery/pace metadata, TTS generation no longer passes delivery hints, MCP/notebook packets omit those fields, and the audio-director skill now says exact acting belongs in visible script/shot direction rather than hidden audio metadata. Validation passed: `npx tsc --noEmit --pretty false`, `npm run build`, `git diff --check`.

2026-05-25 Codex: Corrected dialogue video mode doctrine after live test friction. `lipsync` no longer means "generate TTS first and pass it as reference audio." It now means the video model is prompted to perform speech/lip movement natively from the dialogue text; no TTS prerequisite, no `lipsync_tts_missing` blocker, and no Studio/Audio `tts needed` badges. `overlay` remains the TTS path: generate dialogue audio when desired, then render mixes successful TTS assets over the timeline. Legacy song-lipsync via `shot.lipsync_enabled` still uses source audio for music-led storyboard shots. Historical T5/T6 notes above describe the old implementation, not current doctrine.

2026-05-25 Codex: Fixed the silent Seedance seam. Studio video generation now enables Segmind `generate_audio` for Seedance shots that have dialogue lines or soundNotes, and the prompt explicitly asks for audible synchronized speech/sound instead of only visible mouth movement. Storyboard-mode prompts no longer say "No generated audio" when native audio is enabled. Final renders in project-level `lipsync` mode preserve native video audio; old music-led renders and overlay-mode final renders keep video clips muted so song/TTS tracks remain authoritative.

---

## 10. References

- `docs/codex-native-doctrine.md` — operating contract (R28 apply-only, three editability tiers, two-surface convergence at apply layer)
- `docs/r28-apply-only-text-gen-design.md` — apply tool patterns
- `docs/r29-project-config-design.md` — project-level override pattern that pairs with workflow presets
- `docs/abstraction-platform-plan.md` — strategic shape; the audio Blueprint addition supersedes the "anime is just script→shots" framing
- `docs/preset-abstraction-plan.md` — preset/workflow/seed framework (still authoritative for that layer)
- `docs/studio-db-bootstrap.md` — clean Supabase setup steps
- `server/presets.ts` — runtime presets + workflow recipes (extending with `audio` stage state in T3.9)
- `migrations/2026-05-13_create_studio_workspace_schema.sql` — bootstrap migration (extending in T3.1)
- `packages/lahari-cli/src/index.js` — CLI to fork in T1.6
- `packages/lahari-mcp-server` — MCP server to fork in T1.5
