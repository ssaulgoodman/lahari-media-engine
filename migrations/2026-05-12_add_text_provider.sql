-- Per-project setting for which text-generation model handles concept,
-- style brainstorm, script writer, and storyboard prompt writer. Three
-- options mapped via constants/textProviders.ts — see TEXT_PROVIDERS for
-- the runtime model id per provider. Nullable so existing projects keep
-- the code default (Claude Opus 4.7); explicit values override.

alter table lahari_projects
  add column if not exists text_provider text default null;
