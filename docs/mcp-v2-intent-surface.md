# MCP V2 Intent Surface

Status: design note  
Raised: 2026-05-25  
Owner: future cleanup pass, not blocking current Lahari work

## Problem

The current Lahari MCP surface exposes too many mechanical backend verbs: generate, lock, unlock, apply, refine, and plan variants for each asset family. That mirrors implementation details, but it is not how artists or director agents think. The worst example is reference/board work: "lock/unlock" mixes selection, protection, and stage progress into one word.

This is becoming tool-sprawl:

- style reference generation + selection
- character reference generation + selection
- environment reference generation + selection
- storyboard board generation + selection
- future media-library clips, uploaded clips, and timeline placement

The V2 goal is not fewer features. It is fewer, more intention-shaped verbs.

## Principle

Expose director intentions, not database actions.

Preferred grammar:

- create options
- choose one
- revise it
- clear it only when necessary
- place/use media where needed

The backend can still store `*_asset_id`, storyboard version IDs, lock flags, status fields, stale flags, and history rows. Agents should not need to reason in those internal terms.

## Proposed V2 Clusters

### References

Replace style/character/environment-specific generate/lock/unlock tools with:

- `create_reference_candidates`
- `choose_reference`
- `revise_reference`
- `clear_reference`

Input shape:

```json
{
  "kind": "style | character | environment",
  "targetId": "castMemberId or environmentId when relevant",
  "brief": "what to create or improve",
  "currentAssetId": "optional",
  "count": 3,
  "modelOverride": {}
}
```

Current rough count: 8 visual-reference tools.  
V2 rough count: 4 tools.

### Storyboard Boards

Replace board-specific generate/refine/lock/unlock naming with:

- `create_storyboard_board`
- `choose_storyboard_board`
- `revise_storyboard_board`
- optional `clear_storyboard_board`

Current rough count: 5-6 storyboard-board tools depending on aliases.  
V2 rough count: 3-4 tools.

### Video And Media Clips

New media/library work should start in the V2 grammar rather than inheriting the older lock language:

- `create_media_clip`
- `import_media_clip`
- `place_media_clip`
- `hide_media_clip`
- `export_timeline`

This covers generated B-roll, insert shots, uploaded off-platform clips, montage material, and timeline placement without making a new tool per media type.

## What Not To Genericize Yet

Keep text apply tools specific for now:

- `apply_script_markdown`
- `apply_storyboard_scene_markdown`
- `apply_project_prompt_override`
- `apply_project_preferences`

These are already file-native, drift-checked, and schema-specific. Over-genericizing them would reduce tool count but weaken validation clarity.

## Migration Plan

1. Build V2 tools as additive aliases/wrappers over existing services.
2. Update MCP init instructions and project-local skills to prefer V2 names.
3. Keep old tools available but mark descriptions as deprecated.
4. After real artist sessions no longer call old names, hide/remove old tools from the default hosted MCP surface.
5. Keep internal CLI/debug commands verb-rich; this cleanup is for artist-facing MCP.

## Product Rationale

The director agent should sound like a collaborator:

- "I created three references."
- "Choose this one."
- "Revise it with this note."
- "Place this clip after the chorus."

Not:

- "I locked this asset."
- "Unlock before editing."
- "Call a different tool for the same shape of action on a different table."

This is mainly a creative-UX cleanup, but it also helps tool selection accuracy as the product grows.
