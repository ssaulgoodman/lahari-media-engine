# Editable Prompts System — Plan

## Goal
Let artists edit the main creative prompts (concept, script, style, shot prompts) without code changes. Version history so they can experiment and roll back.

## Current State
- Prompts hardcoded in `claude.ts` as template literals with JS conditionals
- `catalog.ts` is a read-only copy for the Prompts Library page (hand-synced)
- Two sources of truth

## Target Prompts (6)

| Prompt | What artists would tweak |
|--------|--------------------------|
| `generate-concepts` | Role, tone, how many directions, what to explore |
| `plan-scenes` | Shot direction style, what counts as good direction, meditative guidance |
| `write-shot-prompts` | Camera vocabulary, visual style rules, sequence thinking checks |
| `brainstorm-style-directions` | What visual axes to explore, reference vocabulary |
| `refine-style-direction` | How to incorporate feedback |
| `refine-script` | How to surgically edit vs rewrite |

## Architecture

### DB Table: `lahari_prompt_templates`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `prompt_key` | text | e.g. 'plan-scenes' |
| `template_text` | text | Full prompt body with `{{variable}}` placeholders |
| `version` | int | Auto-increment per key |
| `created_at` | timestamptz | |
| `created_by` | uuid | FK to auth.users |
| `notes` | text | What changed in this version |
| `is_active` | boolean | One active per key |

### Template Format

Prompt body with `{{variable}}` placeholders. NO template language (no Handlebars, no Mustache).

Conditionals (like meditative guidance) are pre-computed as variables:
- `{{meditativeGuidance}}` resolves to the block text or empty string
- Artist can edit the block text in the template
- When it fires is always driven by audio analysis (code, not template)

### Runtime

Each service function calls `getActiveTemplate('plan-scenes')`:
- Checks DB for active template for that key
- Falls back to hardcoded default if none
- One function, one DB query (can cache per request)

Tiny interpolator (~20 lines): replaces `{{var}}` with values from a context object.

### What stays in code (NOT editable)
- Tool schemas (JSON response format)
- Pacing math + validation loops
- Extended thinking budget
- Model selection
- Variable assembly (what data gets interpolated into which variable)

### Seed Migration
Extract current hardcoded templates as version 1 for each key.

### UI Changes to PromptsLibrary
- Edit button on each card (the 6 target prompts)
- Side-by-side diff against previous version
- Save = new version row
- Revert = set a previous version as active
- Variable chips already render in the current UI (reuse `TemplateBody`)

## Effort
~2-3 hours for the full loop: migration, resolver, refactor 6 prompts, UI edit mode, version history.
