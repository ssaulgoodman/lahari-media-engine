# Clean Studio DB Bootstrap

This is the path for a fresh non-Lahari Supabase project. It keeps the current
Lahari/Bhakti production workspace untouched while letting this same codebase
run against a clean studio database.

## 1. Create The Supabase Project

Create a new paid Supabase project for the platform workspace. Do not connect
this app to the existing Lahari production project for generic artists.

Create one public Storage bucket. The default backend bucket is still
`lahari-assets` for compatibility, but the clean project should use a new name:

```bash
SUPABASE_BUCKET=studio-assets
```

If `SUPABASE_BUCKET` is unset, the backend falls back to `lahari-assets`.

## 2. Apply The Schema

In the new Supabase project's SQL editor, run:

```sql
-- migrations/2026-05-13_create_studio_workspace_schema.sql
```

That creates the core production tables:

- `studio_projects`, `studio_scenes`, `studio_shots`
- `studio_assets`, `studio_cast_members`, `studio_environments`
- `studio_storyboard_versions`, `studio_chat_messages`, `studio_ai_calls`
- `studio_renders`

It also creates the Codex-native harness tables needed by the MCP/director
surface:

- `studio_director_events`
- `studio_agent_operations`
- `studio_mcp_tokens`
- `studio_project_config`
- `studio_project_prompt_overrides`

It intentionally does not create `songs`, `files`, or `music_video_queue`.
Those are legacy Lahari source-catalog tables, not part of the clean studio v1.

## 3. Point The App At It

Use a separate env file/deployment for the clean studio workspace:

```bash
SUPABASE_URL=<new project url>
SUPABASE_SERVICE_KEY=<new service role key>
VITE_SUPABASE_URL=<new project url>
VITE_SUPABASE_ANON_KEY=<new anon key>
DB_TABLE_PREFIX=studio
SUPABASE_BUCKET=studio-assets
```

`DB_TABLE_PREFIX=studio` is the switch that makes the backend use the clean
tables. Without it, the backend keeps using `lahari_*` for current production.

## 4. What Works First

The clean DB is meant for direct project creation:

- Music video from uploaded audio
- Anime from uploaded/pasted script
- Future brief/document/idea intake

The old queue screen may be empty or unavailable because the clean DB has no
`music_video_queue`. That is expected. Queue becomes just one optional source
adapter, not the platform's default intake model.

## 5. First Smoke Test

After env vars are pointed at the new Supabase project:

```bash
npx tsc --noEmit
npm run build
npm run dev
```

Then test:

- Anime script-first: paste a script and confirm scenes/shots/cast/environments are created.
- Music video: upload audio and confirm analysis reaches Blueprint.
- MCP/director surface: attach to the created project and confirm packets/actions load without missing-table errors.

## 6. Production Safety Rule

Do not run the studio migration on the Lahari production project unless we
explicitly decide to keep both `lahari_*` and `studio_*` schemas in that same
Supabase project. The intended v1 boundary is a new Supabase project.
