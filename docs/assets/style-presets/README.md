# Style preset anchor images

These are the curated reference images for the 4 style presets in
`server/style-presets.ts`. Filenames match the preset `key` field exactly,
so `<key>` here == `<key>` in the registry == the Supabase Storage path.

## Canonical store

The runtime fetches these from **Supabase Storage**, not from the repo:

```
lahari-assets / styles / presets / <key>.png
```

The repo copies are a **source-of-truth backup** in case the bucket gets
wiped or the files need to be re-curated. They are NOT served to the
frontend at runtime — `GET /api/projects/:id/style-presets` resolves
each preset's `previewImagePath` via `storageUrl()` which returns the
Supabase public URL.

## If you re-curate

When swapping any of these images:

1. Replace the file in this directory (keep the kebab-case filename).
2. Re-upload to Supabase at the same `styles/presets/<key>.png` path
   with `x-upsert: true` so the public URL stays stable.
3. No code change required — the registry references the path, not the
   image content.

If you change the preset slug itself, update `key` and `previewImagePath`
in `server/style-presets.ts` AND rename the file here AND re-upload to
the new Supabase path. Old per-project `styleExploration.presetSlots`
entries keyed by the old slug will quietly become orphans on next render.

## Why both repo + Supabase?

- Supabase is the runtime store (CDN-served, public URLs, fork-friendly).
- Repo is the durable backup so the curated set survives bucket
  accidents, regional migrations, or anyone wanting to fork the project
  with the original aesthetic baked in.

Sizes are small (~7 MB total for all 4) — well within sensible
repo-tracked-binary limits.
