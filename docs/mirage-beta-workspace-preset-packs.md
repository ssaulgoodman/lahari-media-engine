# Mirage Beta Workspace And Preset Packs

**Status:** Product-shape reference. Use with `docs/mirage-convergence-ledger.md` when planning workspaces, packs, and gated beta onboarding.

Working note for turning Mirage from an internal studio into a friend/beta-user product where different creators can mass-produce repeatable video formats.

## Product Shape

Mirage should onboard beta users through accounts, workspaces, and preset packs.

An **account** is the signed-in artist or producer, usually by chosen email.

A **workspace** is the production home for a team, client, channel, or workflow. Projects, reusable assets, permissions, and spend should belong to a workspace rather than to a loose global user.

A **preset pack** is the repeatable production system: default project structure, taste rules, required inputs, reusable assets, action availability, skills, prompt recipes, model choices, and render defaults.

A **project** is one episode, listing, reel, ad, or video made from a preset pack.

## Example Preset Packs

### Stop-Motion Turiya Podcast

For short dialogue videos between Krishna and popular fictional or cultural characters, used as a funnel into the Turiya/Krishna companion product.

Likely defaults:
- Dialogue-first script structure with hook, tension, payoff, and Turiya CTA.
- Recurring Krishna character reference, voice, and visual rules.
- Guest-character setup path for each episode.
- Stop-motion or miniature-set visual style.
- Mostly two-character staging with simple blocking and expressive gestures.
- Short-form render format, captions, CTA card, and series branding.

### Real Estate Agent Walkthrough

For listing videos where an agent explains a house, neighborhood, or investment story.

Likely defaults:
- Inputs: listing photos, drone/FPV clips if available, house facts, neighborhood notes, agent bio or voice.
- Structure: exterior hook, hero rooms, amenities, neighborhood, price/value framing, CTA.
- Premium factual style, not fantasy architecture.
- Voiceover or agent-avatar narration.
- Lower thirds, captions, brokerage logo, map/area cards, final contact card.

## Required Platform Primitives

### Workspace Membership

Minimum roles:
- Owner: members, billing, preset access, workspace assets.
- Producer: create projects, generate media, edit and approve.
- Reviewer: view, comment, approve.

### Preset Access

Admin should be able to invite a user by email and assign one or more preset packs to their workspace.

The beta experience should be:

> You have access to the Krishna Podcast workflow. Click New Episode, enter the premise, and Mirage knows the production pipeline.

### Workspace Asset Library

Mass production needs reusable assets:
- Characters and identity refs.
- Environments and sets.
- Style references.
- Voices and soundtrack beds.
- Logos, CTA cards, overlays, captions, and render templates.
- Prompt recipes and project overrides that proved useful.

These should be workspace-scoped and reusable across projects, so artists do not re-upload Krishna, a brokerage logo, a recurring host, or a house-show branding kit every time.

### Limits And Spend

Even free beta work needs limits:
- Monthly paid generation cap.
- Max videos per day.
- Max concurrent jobs.
- Model/provider access by workspace or preset.
- Spend dashboard by workspace and project.

## First Useful Slice

Do not start with a public preset marketplace.

Start with a small admin/beta layer:

1. `workspaces`
2. `workspace_members`
3. `preset_packs`
4. `workspace_preset_access`
5. `workspace_assets`
6. Admin invite and assign screen
7. Project creation from preset pack
8. Per-workspace generation limits

This gives Saul a real way to create custom accounts for friends, assign workflows, and let each person produce inside a bounded, repeatable system.

## Open Questions

- Should preset packs be code-defined first, DB-defined first, or hybrid?
- How much of a preset pack should be visible/editable by the artist?
- Should reusable characters/styles live as workspace assets, preset-pack assets, or both?
- How do shared assets flow into local workbench sync without bloating every project?
- Which beta workflows should be first: Turiya podcast, real estate, product reels, music videos, or scripted shorts?
