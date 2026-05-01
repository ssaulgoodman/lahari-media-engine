Here's the full Blueprint surface, phase by phase. Anything in **bold** is what I'd recommend exposing as a client tool. Anything in *italics* is server-side write only (text/field edits — agent uses existing approval-gated DB tools, then `refreshProject`).

## Concept

| Action                                    | API                                   | Tool?                       |
| ----------------------------------------- | ------------------------------------- | --------------------------- |
| Generate 3 options (preset directions)    | `generateConcepts({ userNote? })`     | **client**                  |
| Generate 1 from director's brief (Path B) | `generateConcepts({ directorBrief })` | **client**                  |
| Lock option N                             | `lockConcept(idx, { fork? })`         | **client** (approval-gated) |
| Refine locked concept                     | `refineConcept(feedback)`             | **client**                  |
| Reopen options grid                       | `unlockConcept`                       | **client**                  |
| Edit deity/mood/theme/direction inline    | `updateConcept(updates)`              | *server write + refresh*    |

## Script

| Action                                        | API                                                                                             | Tool?                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------- |
| First-time script gen                         | `generateScript(userNote?)`                                                                     | **client**                      |
| Re-gen on existing script (wipes downstream)  | `generateScript(userNote, { fork: true })`                                                      | **client** (approval-gated)     |
| Surgical refine ("make scene 3 warmer")       | `refineScript(feedback)`                                                                        | **client**                      |
| Edit scene narrative                          | `updateScene(updates)`                                                                          | *server write + refresh*        |
| Edit shot direction / cast / env / continuity | `updateShot(...)`                                                                               | *server write* (already exists) |
| Split a shot >4s                              | `splitShot(shotId, splitAt?)`                                                                   | **client**                      |
| Director mode toggle (Montage/Cinematic)      | `updateProject({ video_model... })` — actually it's a setting consumed by next `generateScript` | *not a tool — set before regen* |
| Pacing / minShotDuration                      | same — config consumed at gen time                                                              | *server write*                  |

## Style

| Action                                     | API                                     | Tool?                              |
| ------------------------------------------ | --------------------------------------- | ---------------------------------- |
| Brainstorm 4 directions                    | `brainstormStyles(userNotes?)`          | **client**                         |
| Visualize one direction → image            | `visualizeStyle(prompt)`                | **client**                         |
| Refine a direction's text                  | `refineStyleDirection(desc, feedback)`  | **client**                         |
| Lock a generated style image               | `lockStyle(assetId, styleDescription?)` | **client**                         |
| Upload a custom image and lock immediately | `uploadAndLockStyle(file)`              | **N/A** — file upload, user-driven |
| Analyze user's reference image             | `analyzeStyleImage(file)`               | **N/A** — file upload              |
| Edit style DNA text after enrich           | `update-style-description`              | *server write* (already exists)    |
| Rewind to brainstorm view                  | `unlockStyle`                           | **client** (via `rewindToPhase`)   |

## Characters

| Action                                                  | API                                | Tool?                                                |
| ------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------- |
| Generate 3 candidate looks for one cast member          | `generateLooks(castId, feedback?)` | **client**                                           |
| Lock a candidate as the reference                       | `lockCharacter(castId, assetId)`   | **client**                                           |
| Reopen candidates without re-spending                   | `unlockCharacterLook(castId)`      | **client**                                           |
| Refine the gen prompt with feedback (next gen rebuilds) | `generateLooks(castId, feedback)`  | same tool, just pass feedback                        |
| Add a new cast member                                   | `addCastMember(name, desc)`        | **client**                                           |
| Edit name / description / generation_prompt             | `updateCastMember(id, updates)`    | *server write* (already exists)                      |
| Delete a cast member                                    | `deleteCastMember(id)`             | **client** (approval-gated)                          |
| Upload a director-supplied reference image              | `uploadCharacterReference(...)`    | **N/A** — file upload                                |
| Advance to environments phase                           | `advanceCharacters`                | **client** (or auto on `rewindToPhase`-style helper) |

## Environments

| Action                                      | API                                     | Tool?                       |
| ------------------------------------------- | --------------------------------------- | --------------------------- |
| Generate 3 candidate looks for one env      | `generateEnvironmentLook(envId, note?)` | **client**                  |
| Lock a candidate                            | `lockEnvironment(envId, assetId)`       | **client**                  |
| Reopen candidates                           | `unlockEnvironmentLook(envId)`          | **client**                  |
| Add a new environment                       | `addEnvironment(name, desc)`            | **client**                  |
| Edit name / description / generation_prompt | `updateEnvironment(id, updates)`        | *server write*              |
| Delete                                      | `deleteEnvironment(id)`                 | **client** (approval-gated) |
| Upload reference image                      | `uploadEnvironmentReference(...)`       | **N/A** — file upload       |
| Advance to studio                           | `advanceEnvironments`                   | **client**                  |

## Cross-phase

| Action                                    | API                                                                        | Tool?                                          |
| ----------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| Rewind to any earlier phase               | `unlockScript` / `unlockStyle` / `unlockCharacters` / `unlockEnvironments` | **client** — single `rewindToPhase` tool       |
| Bridge to Studio (write all shot prompts) | `writeShotPrompts(userNote?)`                                              | **client**                                     |
| Refresh UI state                          | `getProject`                                                               | **client** (`refreshProject`, already wired)   |
| Read current project                      | —                                                                          | **client** (`getActiveProject`, already wired) |

---

## Tool count if we expose everything

- **Concept**: 4 (generate, lock, refine, unlock) ← *done*
- **Script**: 4 (generate, refine, splitShot, + the existing `update-scene`/`update-shot` server tools)
- **Style**: 4 (brainstorm, visualize, refine-direction, lock)
- **Characters**: 4 (generate, lock, unlock-look, addCast, deleteCast — count varies)
- **Environments**: 4 (mirror of characters)
- **Cross-phase**: 3 (rewindToPhase, writeShotPrompts, advance-* possibly merged)

**~20 client tools total to fully drive Blueprint via chat.** Plus the existing server-side write tools for surgical text edits (those just need `refreshProject` after).

## Things AI **can't** do (and shouldn't try)

- Upload arbitrary user images — file pickers stay in the UI.
- Change pacing / video model / aspect ratio — tied to UI controls before generation; the agent could call `update-project-meta` (already a server write tool) but the user typically picks these manually.
- Anything in Audio Analysis (step 1) — pipeline-owned, no editable surface.

## My recommendation

Stick with the phased rollout. Phase 1a (Concept, done) → 1b (Script: 3 client tools) → 1c (Style: 4) → 1d (Characters+Envs: ~6 combined since they mirror each other) → 1e (`writeShotPrompts` + `rewindToPhase`).

Want me to do **Phase 1b (Script)** next? That's `generateScript`, `refineScript`, `splitShot` on the client side, plus the agent gets the existing server-side `update-scene` / shot-edit tools for free.