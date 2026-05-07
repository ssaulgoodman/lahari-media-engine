# Learning Loop Plan

## Goal

Turn Lahari into a system that does not just generate outputs, but **learns from artist behavior while work is happening**.

This is not one loop. It is two:

- **Project loop** — learns what this project and artist want right now
- **Research loop** — learns across many projects what actually improves outcomes

Keep those separate.

## The core bet

The strongest feedback is not star ratings. It is behavior.

What matters most:

- which option got picked
- which option got ignored
- what got manually edited
- what got rerun
- which rerun finally got locked
- what got reverted later
- what the artist explicitly rejected and why

That is the real training signal.

## What to borrow from autoresearch

The useful part of autoresearch is not "let the agent run wild."

It is this:

- one clear surface to modify
- one fixed harness
- one fast score
- a ratchet: keep wins, discard losses

For Lahari, that translates to:

- modify **one prompt or policy at a time**
- test against a fixed eval set plus fresh production traces
- measure a small set of outcomes
- only keep changes that actually help

That is how we avoid fantasy.

## What to capture

For every important stage, log:

- what was sent
- what came back
- what the artist changed
- what the artist accepted
- what the artist rejected
- what the assistant suggested
- whether the artist agreed
- what finally got locked or kept

This should cover:

- concepts
- script
- style
- character looks
- environment looks
- shot prompts
- generated frames
- generated videos

Also capture the delta, not just the end state:

- prompt before vs after manual edit
- assistant note before vs after rerun
- candidate set before vs chosen winner
- locked output before vs reverted replacement

## Feedback grammar

Keep feedback short and structured.

Use tags like:

- `accepted`
- `rejected`
- `improved`
- `worse`
- `too_literal`
- `too_generic`
- `too_modern`
- `too_busy`
- `not_devotional_enough`
- `continuity_broke`
- `great_composition`
- `good_emotion`

Optional short note:

- one sentence max

The point is to make feedback easy to give and easy to aggregate.

## The metrics that matter

If we want a real learning loop, we need fast proxy metrics.

Start with these:

- **accept rate** — was this output chosen or ignored?
- **rerun-to-lock rate** — how many retries before something got locked?
- **manual edit distance** — how much did the artist rewrite the prompt before generating?
- **revert rate** — how often was a "good" output later thrown away?
- **time to lock** — how long did this stage take to get to something accepted?
- **assistant agreement rate** — how often did the artist agree with the assistant's critique?

These are much more useful than vague satisfaction scores.

## Where feedback comes from

### 1. Passive signals

No extra user effort required.

Examples:

- selected concept vs discarded concepts
- locked style vs ignored styles
- prompt before manual edit vs after manual edit
- generated candidate vs chosen candidate
- rerun count before lock
- revert history

This is the most reliable source because it reflects real taste in action.

### 2. Assistant Director interaction

The assistant can say:

- "This feels too plot-heavy."
- "This breaks continuity."
- "This prompt repeats the same visual logic."

Then the artist can:

- agree
- disagree
- dismiss
- accept rerun

That creates labeled critique data without asking for a big form.

### 3. Lightweight review UI

Sometimes we want explicit signals.

Examples:

- "Why did you reject this?"
- "What was wrong with this rerun?"
- "What worked here?"

But keep it lightweight. A tag picker is enough most of the time.

## The UX changes that actually matter

If this system does not change UX, it is fake progress.

The minimum UX changes that matter are:

### 1. One-tap verdicts beside real work

At the moment of selection, lock, rerun, or rejection, show tiny actions:

- `Good`
- `Off`
- `Too literal`
- `Too busy`
- `Try again`

No extra screen. No survey.

### 2. "Why this reran" badge

If the assistant triggers or suggests a rerun, show the exact reason in one line.

Example:

- "Reran because concepts were too plot-heavy for a meditative stotra."

This builds trust and creates labeled data.

### 3. Before/after diff for assistant rewrites

Whenever the assistant rewrites a prompt, show:

- old version
- new version
- short rationale

This lets artists teach the system by accepting, editing, or rejecting the rewrite.

### 4. Quick disagree path

If the assistant says something dumb, the artist should be able to say:

- `Not an issue`
- `Wrong reason`
- `Keep current`

That is extremely valuable training data.

### 5. "Teach Lahari" moments

When an artist makes a significant manual correction, invite one tiny tag:

- "What was wrong?"

That is where the learning loop becomes real.

## Two memory layers

### Project memory

Short-lived, project-specific.

Examples:

- this artist wants restraint
- avoid modern city imagery for this project
- prefers devotional atmosphere over plot
- previous rerun worked when we emphasized darshan and stillness

This helps the assistant during the current project.

### Global research memory

Cross-project, slower-moving.

Examples:

- meditative stotras reject plot-heavy concepts
- explicit composition jargon in shot prompts gets rewritten often
- certain rerun notes consistently improve concept acceptance

This should only update when a pattern repeats and survives evaluation.

## The ratchet loop

This is the actual autoresearch pattern adapted for Lahari:

1. detect a repeated failure or strong win
2. generate one candidate change
   - prompt tweak
   - routing tweak
   - guardrail tweak
3. test it on:
   - a fixed eval set
   - recent real traces
4. compare against baseline
5. keep only if metrics improve
6. ship behind a flag

No silent global rewrites.
No changing five things at once.
No trusting model vibes over user behavior.

## The nightly research loop

Run a recurring research agent that:

1. collects recent traces, decisions, edits, locks, rejections
2. groups them into patterns
3. extracts hypotheses
4. proposes:
   - prompt tweaks
   - model-routing changes
   - new guardrails
   - UI feedback changes
5. tests those ideas against eval projects
6. outputs a short research report

This is the healthy version of autoresearch.

Not:

- "let the agent rewrite the whole product every night"

But:

- "let the agent surface strong hypotheses backed by real behavior"

Good examples of nightly outputs:

- "Shot prompts with explicit composition jargon are manually edited 42% more often than simpler prompts."
- "Concept reruns that mention 'contemplative presence' outperform generic 'make it devotional' notes on meditative songs."
- "Assistant continuity critiques are agreed with often enough to auto-suggest reruns, but not yet enough to auto-run them."

## What the research agent should output

Keep the output tight:

- top 5 failure patterns
- top 5 winning patterns
- prompt tweak candidates
- confidence level
- suggested experiments

Good example:

- "Concepts for meditative devotional songs are rejected when they introduce modern urban settings. Confidence: high. Suggested change: tighten concept prompt to treat 'modern' as treatment, not setting."

## The first experiments to run

Do not start by letting an agent rewrite everything.

Start with three tight loops:

### 1. Concept loop

Measure:

- which concept type gets chosen
- which rerun notes improve pick rate
- which rejection tags cluster by song type

### 2. Shot-prompt loop

Measure:

- manual edits after auto-write
- rerun-to-lock rate
- continuity-related rejections

### 3. Assistant-critique loop

Measure:

- artist agree/disagree on assistant comments
- whether assistant suggestions reduce retries

These are close enough to the artist's real work that improvements will show up in UX quickly.

## Promote slowly

Do not turn one project's preferences into global rules.

A pattern should only become a product-level change when:

- it repeats across multiple projects
- it appears in both passive and explicit feedback
- it survives evals

This is how we avoid overfitting.

## The minimum build

If we want a strong V1, build just this:

- durable stage event log
- decision log:
  - chosen
  - rejected
  - rerun
  - locked
  - reverted
- short reason tags
- assistant comments with agree/disagree
- one nightly research summarizer

That is enough to start learning for real.

## What not to do

Avoid these traps:

- asking artists for long written feedback
- letting the research agent mutate live prompts without evals
- optimizing only for model-graded quality
- combining project-specific taste with global rules too early
- running giant overnight loops with no product-facing output

If the system cannot answer:

- what changed
- why it changed
- whether artists liked it better

then it is not a real learning loop.

## Suggested tables

We do not need a giant ontology on day one.

Add a few clean records:

### `lahari_stage_events`

What happened at each step.

### `lahari_decisions`

What the artist or system chose.

Suggested fields:

- `project_id`
- `stage`
- `entity_type`
- `entity_id`
- `decision_type` (`selected`, `rejected`, `locked`, `rerun`, `reverted`, `dismissed`)
- `from_version`
- `to_version`
- `reason_tags`
- `reason_note`
- `actor` (`user`, `assistant_director`, `system`)
- `created_at`

### `lahari_research_notes`

Where the nightly agent writes hypotheses and experiment ideas.

Suggested fields:

- `period_start`
- `period_end`
- `kind` (`failure_pattern`, `winning_pattern`, `prompt_hypothesis`, `routing_hypothesis`)
- `summary`
- `evidence`
- `confidence`
- `status` (`new`, `accepted_for_eval`, `rejected`, `rolled_out`)
- `created_at`

## How this connects to the Assistant Director

The Assistant Director uses the **project loop**:

- current comments
- current memory
- current rerun patterns

The research agent uses the **global loop**:

- many projects
- many traces
- many decisions

One helps the current film.
The other improves the product.

## Recommendation

Build this as a separate system beside the Assistant Director, but let them share the same raw event stream.

That gives us:

- immediate in-project intelligence
- longer-term product learning
- real autoresearch grounded in artist behavior

That is the fertile version of Lahari:

not just a pipeline,
not just an agent,
but a system that actually gets better as it is used.
