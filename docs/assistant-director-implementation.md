# Assistant Director — Implementation Tracker

Tracks rollout of the assistant-director agent across the Lahari pipeline (see [`pipeline-anatomy.md`](./pipeline-anatomy.md)). Update checkboxes as phases ship. Pairs with [`assistant-director.md`](./assistant-director.md) (agent reference) and [`floating-ai-chat.md`](./floating-ai-chat.md) (client tool wiring guide).

**Convention:**
- `[x]` shipped + tested in the UI
- `[~]` wired but not yet tested end-to-end
- `[ ]` not started

**Locations:**
- Tool definitions live in the Mastra repo (separate project): `src/mastra/tools/director-client-tools.ts`
- Client wiring lives here: `components/FloatingAiButton.tsx` + `hooks/useAssistantDirectorHandlers.ts`

---

## Phase 0 — Foundation

| | Tool | Purpose |
|---|---|---|
| [x] | `getActiveProject` | Read currently-loaded project (id, title, status, locked concept index) |
| [x] | `refreshProject` | Force UI refetch after server-side writes |

---

## Phase 1 — Blueprint

### 1a. Concept

| | Tool | Wraps | Notes |
|---|---|---|---|
| [x] | `generateConcepts` | `generateConcepts({ userNote?, directorBrief? })` | Long-running Opus call |
| [x] | `lockConcept` | `lockConcept(idx, { fork? })` | Approval-gated; destructive when switching from a previously locked concept with downstream scenes — agent should confirm + offer fork |
| [x] | `refineConcept` | `refineConcept(feedback)` | Non-destructive surgical refine |
| [x] | `unlockConcept` | `unlockConcept` | Pure UI nav — reopens options grid; does NOT rewind status |

### 1b. Script

| | Tool | Wraps | Notes |
|---|---|---|---|
| [~] | `generateScript` | `generateScript(userNote?, { fork? })` | First-time gen + re-gen path. Approval-gated when re-running (wipes downstream cast/env/scenes unless fork:true) |
| [~] | `refineScript` | `refineScript(feedback)` | Surgical, preserves unchanged scenes |
| [~] | `splitShot` | `splitShot(shotId, splitAt?)` | Splits a shot >4s into two halves. Agent gets shotIds via the existing `list-shots` server-side read tool |

Server-side write tools already cover surgical edits (use existing tools + `refreshProject`):
- [ ] verify `update-scene` works end-to-end via agent
- [ ] verify shot edits (`updateShot`) — cast/env/duration — work via agent

### 1c. Style

| | Tool | Wraps | Notes |
|---|---|---|---|
| [ ] | `brainstormStyles` | `brainstormStyles(userNotes?)` | Returns 4 directions |
| [ ] | `visualizeStyle` | `visualizeStyle(prompt)` | Generates image for one direction |
| [ ] | `refineStyleDirection` | `refineStyleDirection(desc, feedback)` | Rewrites direction text |
| [ ] | `lockStyle` | `lockStyle(assetId, styleDescription?)` | Picks one image as the visual ground truth |

`uploadAndLockStyle` and `analyzeStyleImage` are file-upload only — stay in UI, no agent tool.

Server-side: `update-style-description` (already exists) for editing the enriched DNA text post-lock.

### 1d. Characters

| | Tool | Wraps | Notes |
|---|---|---|---|
| [ ] | `generateCharacterLook` | `generateLooks(castId, feedback?)` | Generates 3 candidate portraits |
| [ ] | `lockCharacter` | `lockCharacter(castId, assetId)` | Picks reference portrait |
| [ ] | `unlockCharacterLook` | `unlockCharacterLook(castId)` | Reopen candidates without re-spending |
| [ ] | `addCastMember` | `addCastMember(name, description)` | New cast row |
| [ ] | `deleteCastMember` | `deleteCastMember(memberId)` | Approval-gated |
| [ ] | `advanceCharacters` | `advanceCharacters` | Phase advance to environments |

Server-side: `update-cast-member` (already exists) for name/desc/generation_prompt edits.

`uploadCharacterReference` is file-upload — stays in UI.

### 1e. Environments

Mirror of characters. Same shape.

| | Tool | Wraps | Notes |
|---|---|---|---|
| [ ] | `generateEnvironmentLook` | `generateEnvironmentLook(envId, note?)` | 3 candidates |
| [ ] | `lockEnvironment` | `lockEnvironment(envId, assetId)` | |
| [ ] | `unlockEnvironmentLook` | `unlockEnvironmentLook(envId)` | |
| [ ] | `addEnvironment` | `addEnvironment(name, description)` | |
| [ ] | `deleteEnvironment` | `deleteEnvironment(envId)` | Approval-gated |
| [ ] | `advanceEnvironments` | `advanceEnvironments` | Bridge to Studio |

### 1f. Cross-phase Blueprint

| | Tool | Wraps | Notes |
|---|---|---|---|
| [ ] | `rewindToPhase` | `unlockScript` / `unlockStyle` / `unlockCharacters` / `unlockEnvironments` | Single tool with `phase` arg. Pure status rewind, no data deletion |
| [ ] | `writeShotPrompts` | `writeShotPrompts(userNote?)` | Bulk Opus call — bridges Blueprint → Studio |

---

## Phase 2 — Studio (per-shot)

### 2a. Frame generation

| | Tool | Wraps | Notes |
|---|---|---|---|
| [ ] | `generateShotImage` | `generateShotImage(shotId, refs?)` | Gemini 3 Pro Image. Long-running |
| [ ] | `refineShotPrompt` | `refineShotPrompt(shotId, feedback)` | Claude rewrites visual_prompt |
| [ ] | `clearShotFrame` | `clearShotFrame(shotId)` | Discard current start frame |
| [ ] | `revertShotFrame` | `revertShotFrame(shotId, assetId)` | Pick from version history |

### 2b. End frame

| | Tool | Wraps | Notes |
|---|---|---|---|
| [ ] | `generateEndFrame` | `generateEndFrame(shotId, refs?)` | |
| [ ] | `refineEndFramePrompt` | `refineEndFramePrompt(shotId, feedback)` | |
| [ ] | `clearEndFrame` | `clearEndFrame(shotId)` | |
| [ ] | `usePrevLastFrame` | `usePrevLastFrame(shotId)` | Pull prev shot's extracted last frame as continuity ref |
| [ ] | `useShotAsPrevEnd` | `useShotAsPrevEnd(shotId)` | Reverse chain: this shot's start → prev shot's end |
| [ ] | `revertShotEndFrame` | `revertShotEndFrame(shotId, assetId)` | |

### 2c. Video generation

| | Tool | Wraps | Notes |
|---|---|---|---|
| [ ] | `generateShotVideo` | `generateShotVideo(shotId, promptOverride?, refs?)` | Segmind. Long-running |
| [ ] | `refineVideoPrompt` | `refineVideoPrompt(shotId, feedback)` | Claude rewrites motion_prompt |
| [ ] | `revertShotVideo` | `revertShotVideo(shotId, assetId)` | |

### 2d. Lock + scene-level

| | Tool | Wraps | Notes |
|---|---|---|---|
| [ ] | `lockShot` | `lockShot(shotId)` | Requires start frame + video |
| [ ] | `unlockShot` | `unlockShot(shotId)` | |
| [ ] | `lockAllSceneShots` | `lockAllSceneShots(sceneId)` | Batch |
| [ ] | `unlockAllSceneShots` | `unlockAllSceneShots(sceneId)` | Batch |

Server-side: existing `update-shot-prompts`, `update-shot-feedback`, `update-shot-continuity`, `update-shot-cast-env`, `set-shot-locked` — already approval-gated DB tools, work via `refreshProject`.

### 2e. Bulk fan-out

| | Tool | Wraps | Notes |
|---|---|---|---|
| [ ] | `generateAllFrames` | existing bulk handler | Multi-pass, throttled at 10. Fire-and-forget — agent returns immediately, UI shows progress |
| [ ] | `generateAllVideos` | existing bulk handler | Throttled at 5. Long-running (15+ min total) — needs separate UX thinking |

---

## Phase 3 — Render

| | Tool | Wraps | Notes |
|---|---|---|---|
| [ ] | `startRender` | `startRender(timeline)` | Async — returns renderId immediately |
| [ ] | `getRenderStatus` | `getRenderStatus()` | Poll until complete/failed |
| [ ] | `listRenders` | `listRenders()` | Render history |
| [ ] | `deleteRender` | `deleteRender(assetId)` | Approval-gated |

Open question: should the agent kick off renders, or only report status? Renders cost real money and take 15+ min — likely user-triggered with the agent only able to read status.

---

## Tool budget & scaling strategy

**Soft ceiling: ~20-40 tools per agent.** Hard limits (OpenAI 128, Gemini 128, Claude unbounded) are not the bottleneck. The real degradations are:

1. **Tool-schema tokens on every turn.** Each tool ≈ 150-300 tokens. 50 tools = ~10-15k tokens per request before user message + memory.
2. **Selection accuracy.** Models pick the wrong tool more often past ~25-30, especially with overlapping names (`generateConcepts` vs `generateShotImage` vs `generateAllFrames`).
3. **Latency.** More tokens in = slower first token. Not huge, compounds.

**Lahari's projected total** (everything in this doc): ~35-45 tools. Right at the edge.

### Mitigation playbook

1. **Consolidate mirrored tools** before they ship:
   - One `rewindToPhase({ phase })` instead of four `unlock*` tools (saves 3)
   - One `generateLook({ kind: 'character'|'environment', id })` instead of two (saves 1)
   - One `clearShotAsset({ shotId, kind })` instead of three `clear*` tools (saves 2)
2. **Split into sub-agents at the Blueprint/Studio boundary** when tool count crosses ~30. Mastra pattern: router agent with `delegate({ to: 'blueprint'|'studio'|'render', request })` + foundation tools, plus three specialist agents each holding their own tool map. Shared thread/resource IDs preserve memory continuity.
3. **Dynamic tool selection** (load tools based on `project.status`) only past 50+ — added complexity not worth it before that.

### Mastra cost notes

Mastra itself is free; cost = LLM tokens. Watch:
- **`semanticRecall`** in memory config — default `topK: 2, messageRange: { before: 2, after: 1 }` is fine. Bumping these pulls more history into every turn.
- **Working memory block** — gets injected into the system prompt every turn.
- **Tool schemas** — same overhead as raw API; consolidate to keep this lean.

### Cost ballpark (Claude Opus, ~25 tools, 5-msg history)

- Input: ~12-15k tokens × $15/M = **~$0.20/turn**
- Output: ~500 tokens × $75/M = **~$0.04/turn**
- ≈ **$0.24/turn**, **$3.60-$7.20** for a 15-30 turn Blueprint session

Drop to Sonnet → **$0.50-$1.00 per session**.

Long-running pipeline calls (Opus concept/script generation, image/video gen) are billed via the existing services, not through the chat agent — those don't multiply by tool count.

### Triggers for action

| Symptom | Action |
|---|---|
| Tool count > 30 on a single agent | Plan the split |
| Input tokens per turn > 10k | Audit `semanticRecall` + tool descriptions |
| Agent calling wrong tool > 10% of turns | Consolidate mirrors, sharpen descriptions |
| Phase 2 (Studio) about to start | Split Blueprint vs Studio agents |

---

## Out of scope (intentionally excluded)

- **Audio analysis (Step 1)** — pipeline-owned, no editable surface
- **File uploads** — `uploadAndLockStyle`, `uploadCharacterReference`, `uploadEnvironmentReference`, `uploadShotRef`, `uploadEndFrame`, `analyzeStyleImage`. Stay in UI, user-driven
- **Asset deletion at the row level** — assets are append-only; replacement is via FK swap (already covered by `revert*` tools)
- **Project deletion / fork as standalone** — too destructive; fork happens implicitly via approval-gated lock/regen flows
- **Pacing / video model / aspect ratio** — already exposed via the server-side `update-project-meta` tool. Agent can call it; UI controls also exist
- **Queue management** — Dashboard concern, not the director's chair

---

## Cross-cutting work

| | Item | Status |
|---|---|---|
| [x] | Approval gating for destructive client tools (lock-concept fork path) | Pattern established; agent confirms in chat |
| [ ] | Client-side approval UI (modal) for irreversible actions | TBD — currently the agent confirms via plain text |
| [ ] | Long-running tool UX (15+ min renders, bulk videos) | TBD — current pattern is fire-and-forget but tool card stays "Running" |
| [ ] | Update `docs/assistant-director.md` to document the client-tool surface | After Phase 1 complete |
| [ ] | Update `docs/TOOLS.md` with client vs server tool split | After Phase 1 complete |
| [ ] | Agent instructions in Mastra repo updated per phase | Per-phase |

---

*Last updated: 2026-05-01*
