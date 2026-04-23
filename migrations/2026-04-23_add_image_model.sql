alter table lahari_projects
  add column if not exists image_model text;

alter table lahari_projects
  alter column image_model set default 'gemini-3-pro';
