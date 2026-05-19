# Mirage Platform v1 — Source of Truth Ledger

**Status:** 🔒 LOCKED 2026-05-18 — execution begins next session
**Date:** 2026-05-18
**Branch:** `mirage`
**Owners:** Claude + Codex working in parallel tracks
**Supersedes:** `docs/v1-platform-finish-line-plan.md`, sections of `docs/abstraction-platform-plan.md`, sections of `docs/preset-abstraction-plan.md`

**Lock contract:** §2 (Locked Decisions), §3 (Architecture), §7 (Contracts) do not change without raising in §8 (Open Questions), discussing, and explicitly amending with a new D-number or contract-version. Track/task content (§4, §6) can be adjusted during execution as we learn; log every adjustment in §9 (Checkpoints).

This is the single source of truth for getting Mirage Platform v1 shipped. Every locked decision, contract, file path, and acceptance criterion lives here. If something contradicts an older doc, this wins.

Both Claude and Codex read from and append progress to this ledger. Pick a task by its ID (e.g. `T3.2`), do it, check it off, log a one-line note in the Checkpoints section.

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
| D1 | Three-axis decomposition: `SeedKind` + `WorkflowRecipe` + `PipelinePreset` | Already implemented in `server/presets.ts`. Workflow gates UI/required-stages; seed kind picks intake adapter; preset injects taste/prompt-rules/model-defaults |
| D2 | `audio_plan` is the only home for dialogue text. Script schema has no dialogue field | Single source of truth; protects TTS investment from script edits; independent staleness per layer |
| D3 | `dialogueStrategy` is per-shot, two values: `lipsync` and `overlay`. `lipsync` passes TTS audio to Seedance with `lipsync: true` + character target so the video renders with the character lipsynced. `overlay` doesn't pass TTS to Seedance; the TTS asset is mixed over silent video at render time | Both paths exist because: visible characters speaking want lipsync (proper performance), narrators / off-screen voices / inner monologue want overlay (no speaker visible to sync to). Default per line: `lipsync` if speaker has a look reference, `overlay` if not (e.g. narrator) |
| D4 | `soundNotes` is free text on `audio_plan`, not a structured SFX array. Video gen produces ambient | Aligns with Saul's "manage SFX via video gen" call; zero new render plumbing for v1 |
| D5 | BYOK across ALL providers for every Mirage tenant including Saul. No platform env fallback in Mirage app code | Dogfood the real path; one code path; one mental model; simpler |
| D6 | BYOK requirement scope split into "required at /connect" vs "optional, prompted at feature use". **Required at /connect per workflow:** `music_video` = segmind + gemini (video + image via Segmind; audio analysis via Gemini); `anime_scripted` = segmind + elevenlabs (video + image via Segmind; TTS via ElevenLabs). **Optional (only needed for pure web-studio users who never use a harness):** anthropic (web-studio AI buttons like Generate Concept / Script / Refine / Write Audio Plan); openai (gpt-image-2 storyboard, GPT script-writer option). Account Keys UI surfaces these as optional with copy like "Only needed if you generate via the web studio without using Codex Desktop or Claude Code." Google AI Studio key is required for music_video (audio analysis) and optional for anime (only if switching image gen back to Google directly) | Both supported harnesses bring their own LLM subscription: Codex Desktop uses its Claude/OpenAI; Claude Code uses Anthropic. Harness users do all text gen harness-native and never hit backend Anthropic/OpenAI endpoints. So those keys are pure-web-studio concerns and shouldn't block /connect onboarding for harness users |
| D7 | Separate npm package (`@mirage/mcp-server`), separate Railway app, separate Supabase, separate domain | Different MCP tool surface, different schema, different brand — same MCP url with route-by-tenant was wrong |
| D8 | Fork CLI: `packages/lahari-cli` → `packages/mirage-cli`, repoint URL/env var | CLI calls the studio backend; needs to point at Mirage Railway |
| D9 | Apply-only seam for audio (R28 pattern). Codex writes JSON, apply tool validates+persists | Doctrine §4; no double-hop; same pattern as `apply_script_markdown`, `apply_shot_prompts` |
| D10 | Blueprint phases reordered to: Concept → Script (with dialogue text) → Style → Characters (with voice IDs) → Environments → Audio (TTS production) → Studio | Dialogue is part of script reading; voice belongs with character identity; Audio phase becomes "produce speech" not "write speech" |
| D11 | `music_video.audio = 'skipped'` in WorkflowRecipe. Audio phase tab hidden for music_video | Music video already has audio (the song); no useful UX for v1 |
| D12 | First TTS provider: ElevenLabs. Voice provider is per-cast-member, not per-project | Per-voice provider future-proofs adding a second TTS later (`cast.voice_provider` switches per character) |
| D13 | `audio_plan_stale` is a separate flag from `prompts_stale` | Lahari already conflates two prompt-staleness signals on one column; don't repeat that mistake |
| D14 | Cost preview required before bulk TTS gen (route + UI modal) | BYOK = cost is visible to tenant; need to show before charging their ElevenLabs key |
| D15 | Tenant API keys encrypted at rest. App-level AES via `MIRAGE_ENCRYPTION_KEY` env, not pgcrypto | App-level keeps key out of DB backups; rotation is one env swap (with re-encrypt migration if needed) |
| D16 | Mirage (this branch) and Lahari (main) are permanently divergent. No merge-back. Engine bugfixes are cherry-picked between branches as needed | Product shapes differ at the entry surface (Lahari = curated queue, Mirage = open-signup intake), at /connect, at brand, at BYOK enforcement — too many fork points to gate cleanly in one codebase. Shared-engine package extraction is a v2 escape hatch when cherry-pick pain becomes real |
| D17 | Bootstrap migration `2026-05-13_create_studio_workspace_schema.sql` is frozen the moment first Mirage Supabase runs it. All new schema lands in dated additive migration files. No edits to the base after that | Avoids divergent reality between fresh deploys and existing instances; standard practice; closes the waffle the audit doc had on this |
| D18 | Engine session protocol: bugfix lands on the branch where the bug was discovered. Cherry-pick to the other branch in the same session if it applies. Lahari hotfixes start on `main`; Mirage features start on `mirage` | Forces the cherry-pick discipline to live in the moment, not "later". Annotate with `cherry-pick from <sha>` in commit message for traceability |
| D19 | Hard TTS spend cap per user per day: $20 USD equivalent, hardcoded in v1. Configurable per-tenant in v1.5 | Cost preview is a check, not a stop. Runaway agent loops could burn hundreds before noticed. $20 is a tight but workable ceiling for v1 |
| D20 | Mirage uses Segmind as the single provider for both image gen and video gen. Default models in Mirage presets resolve to Segmind routes (including Nano Banana Pro, Nano Banana 2, Seedance, Veo). No Vertex / GCP fallback in Mirage runtime. If a Segmind call fails, the call fails (no silent retry to Google) | Saul confirmed Segmind has all image models needed. Collapses required keys (anime = Segmind + ElevenLabs only). Drops GCP runtime dependency from Mirage entirely. Lahari (`main`) keeps Vertex fallback for its own continuity |

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
- Codex: Desktop → `@mirage/mcp-server` → `mirage.<domain>/mcp` → `mirage.<domain>/api/*` → Mirage Supabase
- CLI: Terminal → `@mirage/cli` (notebook sync) → `mirage.<domain>/api/notebook-sync/*`

**Branch lifecycle:**
- `main` is Lahari's permanent home. Maintenance mode acceptable. Saul-paid env keys, curated artist roster, music_video only
- `mirage` is Mirage's permanent home. Active development. Open-signup tenants, BYOK enforced, music_video + anime + future workflows
- Engine bugfixes get cherry-picked between branches when they apply to both (`server/services/claude.ts`, render pipeline, supabase plumbing, etc.). Product-shape changes never cross-port (Lahari keeps its queue; Mirage keeps its intake)
- v2 escape hatch when cherry-pick cost gets painful: extract shared engine into a package (`@mirage-core/engine`), restructure into a proper monorepo, both products import. Not v1 scope

---

## 4. The Seven Tracks

Each track is a coherent workstream. Tasks within a track are mostly sequential; tracks themselves can be parallelized except where noted in §5 (Dependency Graph).

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
| T1.5 | Fork MCP server package | Copy `packages/lahari-mcp-server` → `packages/mirage-mcp-server`. Rename package `@mirage/mcp-server`. Update internal namespace prefix from `lahari` to `mirage` (env vars, default API URL, audit header `X-Mirage-MCP-Version`) | `npm run build` succeeds in package; manifest exposes Mirage namespace; published version is 0.1.0 |
| T1.6 | Fork CLI package | Copy `packages/lahari-cli` → `packages/mirage-cli`. Rename package `@mirage/cli`. Update `DEFAULT_API_URL`, `LAHARI_CLI_TOKEN`→`MIRAGE_CLI_TOKEN` env var, help text | `npx @mirage/cli sync <projectId>` against a Mirage project pulls notebook correctly |
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
| T2.7 | `/connect` BYOK gate | `server/routes/connect.ts` modified — before issuing MCP token, check that the tenant has keys for the required-at-connect set (per D6): music_video needs segmind+gemini; anime needs segmind+elevenlabs. If missing, render setup checklist instead of token. Show optional providers (anthropic, openai, etc.) as "add when needed" hints, NOT blocking | New tenant at /connect sees minimal required checklist; after pasting required keys, gets MCP token snippet; optional providers visible but don't block |
| T2.8 | Account keys UI page | `components/AccountKeys.tsx` (new). Two sections: **Required** (per workflow — Segmind + ElevenLabs for anime; Segmind + Gemini for music_video). **Optional — only if generating via web studio without a harness** (Anthropic, OpenAI). Per-provider row: label, status (set/not set), last-used, "Set/Rotate" button (modal with password-style input + label), "Delete" button. Copy for optional section explains harness-vs-studio split | Page lists providers in required vs optional sections with clear copy; can add/rotate/delete each; PUT/DELETE call backend |
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
| T3.9 | WorkflowRecipe stages + presets | `server/presets.ts`: add `audio: WorkflowStageState` to `WorkflowRecipe.stages`. Set `music_video.audio = 'skipped'`, `anime_scripted.audio = 'optional'`. Update `PipelinePreset.audio` field with rules per preset | tsc passes; `getWorkflowRecipe('anime_scripted').stages.audio === 'optional'` |
| T3.10 | Staleness wiring | When `apply_script` or `POST /generate-script` runs and any shots are touched, set `audio_plan_stale = true` for any shot that already had `audio_plan != null`. Don't blow away the plan | Manual: write audio plan, regenerate script, audio_plan_stale flips true, plan content preserved |
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
| T5.1 | Phase order refactor | `components/AnalysisEditor.tsx` and phase children. Insert Audio phase between Environments and Studio. Hide it entirely when `workflow.stages.audio === 'skipped'` (music_video) | tsc passes; music video shows no Audio tab; anime shows it |
| T5.2 | Script phase dialogue inline | `components/ScriptPhase.tsx`. Under each shot, render dialogue lines (read mode by default, click to edit text/delivery). "Write dialogue" button per shot. "Write all dialogue" bulk button. Calls `POST /write-audio-plan`. Optimistic refresh from response | Anime artist can write + read dialogue without leaving Script |
| T5.3 | Characters phase voice editor | `components/CharactersPhase.tsx`. Add voice section to each character card: provider dropdown (just `elevenlabs` for v1), `voice_id` text input, `voice_name` optional label, "needs voice" amber pill if not set. PATCH on save | Voice IDs persist; missing-voice pill clears once set |
| T5.4 | Audio phase main view | `components/AudioPhase.tsx` (new). Table of all dialogue lines across all shots: character, line text, paceHint, ttsStatus pill, audio preview (`<audio>` element if asset exists), regenerate per-line button. Filters: by character, by shot, by ttsStatus | Visible audio surface; preview audio plays |
| T5.4a | Audio harness simplification pass | `components/AudioPhase.tsx`. Keep the Audio phase as a Codex-operable harness, not a production tracker. Bulk and per-shot generation should target only pending/error lines whose characters already have voice IDs. Missing voices remain visible as assignable tasks, but they do not block unrelated ready lines. Tone down any first-class dashboard/filter UI that makes the surface feel like a spreadsheet rather than a shot graph | "Generate available" works even if some characters still need voices; missing voices remain linked to Characters; no ready line is blocked by an unrelated missing voice |
| T5.5 | TTS cost preview modal | `components/TtsGenerateModal.tsx` (new). Triggered by "Generate available" / "Generate selected". Shows `totalChars`, `estimatedUsd`, missing voices omitted from this run, pending vs already-generated. "Generate" button calls backend, polls or awaits, refreshes project | Cost displayed before gen; missing voices are listed as skipped tasks rather than blocking ready dialogue |
| T5.6 | `dialogueStrategy` per-shot picker | Per-shot toggle in Audio phase row. Two options: "Lipsync (character speaks on screen)" → `lipsync`; "Overlay (voiceover / narrator / off-screen)" → `overlay`. Default reflects what write-audio-plan picked. Disable `lipsync` option (with tooltip "speaker has no look reference") if any line in the shot is from a no-look cast member. Show "Generate TTS before video gen" warning badge if shot is `lipsync` and TTS missing for any line | Artist picks per shot; correct enum stored; lipsync-blocked shots clearly flagged |
| T5.7 | Stale warnings | Amber badge on shots with `audio_plan_stale = true`, in both Script phase dialogue view and Audio phase. Click to rewrite | Badge appears when script changes; clears on rewrite |
| T5.8 | API client additions | `services/api.ts`: `writeAudioPlan(projectId, shotIds?, force?)`, `generateDialogueAudio(projectId, dialogueIds?, shotIds?)`, `getAudioPlanCost(projectId, scope)`, `updateCastVoice(projectId, castId, voice)` | tsc passes; all four wrappers used by components |
| T5.9 | Workflow stage gating | Existing `WorkflowRecipe.stages` consumed in `AnalysisEditor` to show/hide phase tabs. Cleanup any hardcoded phase order | Music video doesn't show Audio tab; anime does |

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

---

## 7. Contracts (shapes both agents must respect)

### Shot `audio_plan` shape

```ts
type AudioPlan = {
  /**
   * Per-shot dialogue delivery path.
   *   'lipsync' = TTS passed to Seedance with lipsync params + character target;
   *               video gen produces a lipsynced shot. Requires TTS to exist
   *               before video gen runs.
   *   'overlay' = TTS not passed to Seedance; video gen produces normal silent
   *               video; render mixes TTS over the video timeline.
   * Default per line is derived in write-audio-plan based on whether the
   * speaker has a look reference (has_look=true → lipsync, false → overlay).
   * Artist can override per shot in the Audio phase UI.
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

**Lipsync ordering constraint:** for any shot with `dialogueStrategy: 'lipsync'`, all dialogue lines must have a successful `ttsAssetId` before video gen for that shot can run. Video gen route validates this and returns a structured `{ code: 'lipsync_tts_missing', shotId, missingDialogueIds }` error if not. UI and Codex packet surface this dependency clearly (Audio phase shows "Generate TTS before Studio gen for these shots").

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

---

## 8. Open Questions

Resolved this round:
- ~~Mirage domain~~ → use Railway default `mirage-platform-production.up.railway.app` (or whatever Railway issues for the project named `mirage-platform`). No custom DNS in v1
- ~~Strategy picker location~~ → Audio phase (T5.6); Studio surfaces the lipsync-blocked warning only (T6.8)
- ~~Voice ID validation~~ → accept any string at save; fail at gen time with structured error. Cheaper, simpler. Add `/v1/voices` validation in v1.5 if support burden hits

Still open:
1. **`MIRAGE_ENCRYPTION_KEY` value** — 32 random bytes base64. Generate at Railway-setup time, store in Railway secrets. Back up offline. Same key MUST be used across all instances or decryption breaks. (Operational, resolves during T1.3)

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
2026-05-18 Codex: T2.5 review follow-up. Removed user-provider env fallback from `requireProviderApiKey`; provider calls now require request user context and BYOK. Added explicit system-provider helper for future background jobs. Verified `@mirage/cli` is not published yet, so CLI sync snippets keep a configurable `MIRAGE_CLI_PACKAGE` with Lahari CLI fallback until publish.
2026-05-18 Codex: T2.6 started. Added shared structured error normalization for `missing_key`, wired hosted MCP/director error wrapping to preserve provider/setupUrl, and updated provider-heavy web routes to return `{ ok:false, error:{ code:'missing_key', provider, setupUrl } }` instead of flattening BYOK failures to generic errors. Full app typecheck/build is temporarily blocked by Claude's in-progress T5.2 frontend edits; server-only route/typecheck passes.
2026-05-18 Claude: T2.7 + T2.8 done (commits 20b15e3, ec9a2c4). `AccountKeys.tsx` at `/account/keys` with Required (Segmind/Gemini/ElevenLabs) and Optional (Anthropic/OpenAI) sections per D6. `ConnectPage.tsx` rebranded Lahari→Mirage and added BYOK gate; minting blocked until a workflow lane is complete. `services/api.ts` BYOK stubs match Codex's `/api/account/api-keys` routes. Verification passed: tsc, build, diff-check.
2026-05-18 Claude: BYOK gate review fixes (commit 5fea85e). Killed `tokens.length > 0` bypass so revoked/expired tokens can't skip BYOK setup. Replaced flat 3-provider checklist with two workflow lanes (Music Video: Segmind+Gemini; Anime: Segmind+ElevenLabs); minting unlocks when either lane is complete. Token-mask copy uses actual minted prefix instead of hardcoding `mirage_mcp_` (until Codex's prefix rename landed in 66408bd).
2026-05-18 Claude: T5.1 + T5.9 done (commit 8547fcb). Added `constants/blueprintPhases.ts` as workflow-keyed phase config — adding ads/reels later means a new entry, no new branches across the UI. `BlueprintContextBar` phaseIndex/getActivePhase/getStatusLockedPhase/isLockedPhase now take the project; tab nav renders from the config. Anime gets Audio tab as a coming-soon disabled chip until T3 + T5.4 ship. Music video tab list unchanged. Verification passed.
2026-05-18 Claude: T5.2 done (commit ac15944). Added §7 AudioPlan/DialogueLine/CastMember-voice types, four audio API stubs (writeAudioPlan/generateDialogueAudio/getAudioPlanCost/updateCastVoice). DialogueBlock renders under each shot in ScriptPhase, gated by config helper `findPhase(project, 'audio').visible` — no workflowKey strings. Empty → "Write dialogue" CTA. Populated → speaker/text/delivery/TTS-status-pill. Stale → amber chip + Rewrite. Plus bulk "Write all dialogue" header button. Calls 404 until T3.4 backend lands.
2026-05-18 Codex: Future flags from T2/T3 reviews recorded before continuing Day 7 backend work: consider changing `missing_key`/daily-cap HTTP 402 to 409 if any client/proxy dislikes 402; replace message-string status inference with explicit status-bearing error classes; retire JSON-in-Error-message structured unwrapping once all throw sites use real classes; debounce `last_used_at` writes on hot provider paths; publish/switch `@mirage/cli` before removing Lahari CLI fallback; smoke-test AsyncLocalStorage through hosted MCP/provider paths.
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

(Append below.)

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
