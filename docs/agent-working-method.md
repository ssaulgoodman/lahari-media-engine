# Agent Working Method

**Status:** Current operating discipline. Read with root `AGENTS.md` before substantive engine work.

How Claude and Codex should work on Mirage so good architecture lands earlier and bad ideas die at the whiteboard, not after implementation. This is a checklist to run, not a diary to read. It was distilled from the 2026-05-30 always-on-surface / payload / skills / workspace-layout session, where most defects were caught by reasoning about the architecture, not by testing.

## The failure mode

Agents optimize each artifact to be **locally coherent** and let global coherence emerge by luck. Almost every defect lives at a **seam** (between AGENTS / MCP / skills / notebook / sync), not inside a component. A skill reads fine but claims an action behavior never checked. AGENTS reads fine but duplicates the MCP payload. The per-project notebook is clean but assumes one project per workspace.

Two roots:
- **Plausibility can't see relationships.** A good architecture and a bad one are equally plausible in isolation; only tracing consequences discriminates them.
- **The model emits assumed claims and verified facts at identical confidence.** "`apply_concept` wipes downstream" was a prior stated in the voice of a fact. That single conflation caused most of the skill bugs.

## Four passes before writing

1. **Map the invariants first.** What are all the surfaces this touches? What is the single source for each fact? (One question — "what are the always-on surfaces?" — kills the AGENTS/MCP/director duplication before it's written.)
2. **Tag every behavioral claim `verified | assumed`, and make `assumed` cost something.** Any claim about what an action *does* gets a code read, or it ships marked "unverified."
3. **Consequence-trace against 2–3 concrete scenarios.** "Open project A then B" (catches per-project AGENTS). "Context compacts mid-session" (catches the durability flip). "Agent wants a prompt body" (catches the full-packet default).
4. **Check the design against the written invariants below.** Every bad idea this session violated one.

## Standing invariants (check designs against these)

- **The graph is truth.** Supabase is canonical; everything local is a desk copy. Never create a second source of truth.
- **One confident path per operation.** No happy-path forks; fallbacks are automatic-and-invisible or explicitly off-path (e.g. `detail='full'`), never a casual alternative.
- **One owner per fact.** A given instruction/schema/behavior lives in exactly one place; other surfaces point to it, never restate it. (Always-on surfaces especially: AGENTS.md is the durable base; the MCP payload is a thin starter that hands off; skills teach craft.)
- **Durable substrate is the file, not the protocol.** Operating content lives where it survives compaction and protocol changes (AGENTS.md / skills on disk), not in a connection-time handshake.
- **Schemas are the buttons; skills are how to play them.** Action contracts say what's callable; skills teach the maneuver/repair ladder. Don't put maneuverability in schemas or runtime discovery.
- **Lean by default, heavy opt-in.** Reads/payloads return the working set; full bodies are explicit. Over-fetching means a missing compact field to add, not a fatter default.
- **Translate intent into typed edits.** Never pipe raw artist notes into actions.
- **Workers are helpers, not operators.** Native subagents/background workers may inspect, draft, repair local media, or package evidence. The main director owns Mirage reads that establish truth, artist approval, paid actions, uploads/imports, locks, and every persisted state write.

## Native Worker Contract

Use Codex/Claude native workers only when they protect the main director context or create real parallelism: precise imagegen repair, visual triage across many boards/clips, prompt-payload contradiction checks, continuity audits, source-material cleanup, or editor handoff packaging. Do not spawn a worker for a normal single action, an ambiguous creative decision, or anything that needs direct artist approval before proceeding.

The director sends a bounded packet:

```md
Native worker packet
- Target: project/scene/shot/asset IDs and names
- Task: one concrete question or repair
- Inputs: exact files, image URLs/paths, `describe_prompt` snippets, or payload summaries to inspect
- Preserve: identity, style, geography, lock state, timing, text that must not change
- Allowed tools: e.g. imagegen, local visual inspection, local file packaging
- Forbidden: paid Mirage jobs, Supabase writes, lock/unlock, project text edits, secret/token handling
- Return: the receipt fields below
```

The worker returns a compact receipt:

```md
Native worker receipt
- Target:
- Inputs read:
- Tools used:
- Output path or asset candidate:
- Prompt/checks performed:
- Changes made or findings:
- Suggested Mirage action:
- Caveats/risks:
- Ready to apply: yes/no
```

The director then decides what to do. If bytes were produced, upload/import through the normal Mirage path (`/api/agent/uploads`, `import_storyboard_image`, `import_keyframe_image`, or the relevant typed action). If the receipt is an audit, translate it into a dry-run, `contextOverrides`, `apply_text_edits`, `apply_shot_prompts`, or another explicit action. Never treat a worker receipt as canonical project state by itself.

## Verification rules

- **"Clean" is a read verdict, never a grep verdict.** Grep proves a banned string is absent; it cannot prove the idea is right. Bad output comes from bad ideas, not banned words.
- **Behavior claims are code-verified, not doc-assumed.** Read the action implementation before writing what it does. (CLAUDE.md and prior docs can be stale.)
- **Verify against the committed tree, not local disk.** A check that reads the working tree passes for you while a fresh clone fails (the `.agents/skills` gitignore near-miss). Use `git ls-tree`/`git show` to confirm what actually shipped.
- **No lint for ideas.** A word-list gives false confidence and false positives and cannot catch wrong guidance. For a small set of files, the method is reading and judgment.

## Where to spend audit energy

- **Theoretical audit is the permanent front line for architecture.** Invariant and composition errors are visible to reasoning and invisible to a single test run (a test exercises one path; the bug is in the relationship between paths). We do not graduate from this.
- **Empirical testing catches leaves** — output quality, a single flow's correctness. Run it for those, not for architecture.

## The structural limit, and the actual fix

The generator and the critic are the same network, so an agent's confidence is not a reliable signal of correctness — especially for global properties. An agent cannot fully self-audit with the faculty that produced the error. So the fix is not "a smarter first pass"; it is **institutionalizing an adversarial first-principles critic** — a human, the other agent, or an explicit refute-pass checking against the invariants above — as a **required gate, not a backstop.** The win condition is not "no audit needed"; it is "the audit is cheap, fast, and adversarial enough that bad ideas die before they cost implementation."
