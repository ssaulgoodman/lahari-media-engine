> Archived. Historical preset abstraction ledger from the Codex-native Lahari phase; current Mirage direction lives in `docs/mirage-platform-v1-ledger.md` and `docs/mirage-convergence-ledger.md`.

# Preset Abstraction Ledger

Use this while building Codex-native Lahari. Do not stop every implementation to generalize the engine. Ship the Codex-native workflow, and record each Bhakti-specific assumption when it appears.

The goal is to separate the core audiovisual production engine from the first preset: `bhakti-music-video`.

## Rule

If an artifact is about production mechanics, it is core.

If an artifact is about domain vocabulary, taste, cultural rules, examples, genre structure, or scoring, it is preset-owned.

## Ledger

| Current Artifact | Current Bhakti Assumption | Core Equivalent | Preset Owner | Priority |
|---|---|---|---|---|
| `lockedConcept.deity` | Deity is the primary subject | primary subject / focus entity | `bhakti-music-video` maps deity into primary subject | High |
| `songType` enum | stotra, chant, bhajan, kirtan, song | content form classification | `bhakti-music-video` owns devotional music forms | High |
| `isMeditative` / `isNarrative` | Used for devotional pacing and restraint | tone / energy / narrative axes | Core fields, preset interprets them | Medium |
| Concept prompts | Indian devotional cinema, deity, song meaning | concept generation doctrine | Preset prompt pack | High |
| Script prompts | darshan, invocation, ritual progression, symbolic manifestation | scene/shot planning doctrine | Preset prompt pack | High |
| Style brainstorm | Indian audience, cultural authenticity, no generic fantasy | style direction generation | Preset taste rules | High |
| `cast` | deity/devotee figures | characters/entities | Core | Low |
| `environments` | temple, shrine, sanctum, sacred spaces | locations/world references | Core object, preset default vocabulary | Medium |
| Shot direction | devotional beat language | narrative beat / action moment | Core | Low |
| Shot visual/motion prompts | devotional restraint, sacred presence, anti-VFX rules | renderable shot prompt writing | Preset guidance layered onto core prompt writer | High |
| Character looks | deity identity, costume, ornaments, cultural correctness | entity reference generation | Preset reference rules | High |
| Environment looks | Dravidian temple, home shrine, sacred geography | location reference generation | Preset reference rules | High |
| Style reference frame | devotional motif/environment detail | reusable style reference | Core prompt shape, preset motifs | Medium |
| Project packet `preset: bhakti-music-video` | Hardcoded first preset | active preset id | Core project metadata later | High |
| CLI wording | character/entity, environment/location mix | generic production language | Core CLI should move toward neutral terms | Medium |
| `lahari-director` skill | Bhakti taste checks embedded | director operating loop + active preset skill | Split into core director + Bhakti skill | High |

## Extraction Path

First keep the live branch useful:

1. Build read-only packets and reports.
2. Wrap packets as MCP tools.
3. Add contact sheets and project journals.
4. Add permissioned preview tools.

Then extract preset boundaries:

1. Add `presetId` to project packet and eventually project schema.
2. Create a `presets/bhakti-music-video` package for doctrine, fields, rubrics, and examples.
3. Rename internal neutral concepts where cheap: cast -> entities, environments -> locations.
4. Parameterize concept/script/style/shot prompt builders by active preset.
5. Add a second preset only after Bhakti is extracted enough to prove the seam.

Do not create a separate codebase until the engine/preset boundary is proven in this branch.
