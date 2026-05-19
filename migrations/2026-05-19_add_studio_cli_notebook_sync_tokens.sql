alter table public.studio_mcp_tokens
  add column if not exists token_kind text not null default 'mcp',
  add column if not exists scope_project_id text null references public.studio_projects(id) on delete cascade;

alter table public.studio_mcp_tokens
  drop constraint if exists studio_mcp_tokens_kind_check;

alter table public.studio_mcp_tokens
  add constraint studio_mcp_tokens_kind_check
  check (token_kind in ('mcp', 'cli'));

create index if not exists studio_mcp_tokens_scope_project_idx
  on public.studio_mcp_tokens (scope_project_id)
  where scope_project_id is not null;

comment on column public.studio_mcp_tokens.token_kind is
  'mcp tokens are long-lived harness tokens; cli tokens are short-lived project-scoped tokens for agent-run notebook sync.';

comment on column public.studio_mcp_tokens.scope_project_id is
  'Optional project scope for short-lived CLI notebook sync tokens.';
