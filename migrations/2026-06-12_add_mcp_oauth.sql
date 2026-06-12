-- MCP OAuth support for tokenless Codex/Claude connection.
-- The OAuth protocol tables are prefix-mapped so Mirage and Lahari lanes can
-- both host MCP OAuth without sharing client/code state.

do $$
begin
  if to_regclass('public.studio_mcp_tokens') is not null then
    alter table public.studio_mcp_tokens
      add column if not exists oauth_client_id text null,
      add column if not exists oauth_scopes text[] null,
      add column if not exists oauth_resource text null;

    alter table public.studio_mcp_tokens
      drop constraint if exists studio_mcp_tokens_kind_check;

    alter table public.studio_mcp_tokens
      add constraint studio_mcp_tokens_kind_check
      check (token_kind in ('mcp', 'cli', 'oauth_access', 'oauth_refresh'));

    create index if not exists studio_mcp_tokens_oauth_client_idx
      on public.studio_mcp_tokens (oauth_client_id)
      where oauth_client_id is not null;

    create table if not exists public.studio_mcp_oauth_clients (
      client_id text primary key,
      client_info jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists public.studio_mcp_oauth_codes (
      approval_id uuid primary key default gen_random_uuid(),
      code_hash text unique,
      client_id text not null references public.studio_mcp_oauth_clients(client_id) on delete cascade,
      user_id text null,
      redirect_uri text not null,
      code_challenge text not null,
      scopes text[] not null default '{}'::text[],
      resource text null,
      state text null,
      expires_at timestamptz not null,
      approved_at timestamptz null,
      consumed_at timestamptz null,
      created_at timestamptz not null default now()
    );

    create index if not exists studio_mcp_oauth_codes_client_idx
      on public.studio_mcp_oauth_codes (client_id, created_at desc);

    create index if not exists studio_mcp_oauth_codes_code_hash_idx
      on public.studio_mcp_oauth_codes (code_hash)
      where code_hash is not null;

    alter table public.studio_mcp_oauth_clients enable row level security;
    alter table public.studio_mcp_oauth_codes enable row level security;
  end if;
end $$;

do $$
begin
  if to_regclass('public.lahari_mcp_tokens') is not null then
    alter table public.lahari_mcp_tokens
      add column if not exists oauth_client_id text null,
      add column if not exists oauth_scopes text[] null,
      add column if not exists oauth_resource text null;

    alter table public.lahari_mcp_tokens
      drop constraint if exists lahari_mcp_tokens_kind_check;

    alter table public.lahari_mcp_tokens
      add constraint lahari_mcp_tokens_kind_check
      check (token_kind in ('mcp', 'cli', 'oauth_access', 'oauth_refresh'));

    create index if not exists lahari_mcp_tokens_oauth_client_idx
      on public.lahari_mcp_tokens (oauth_client_id)
      where oauth_client_id is not null;

    create table if not exists public.lahari_mcp_oauth_clients (
      client_id text primary key,
      client_info jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists public.lahari_mcp_oauth_codes (
      approval_id uuid primary key default gen_random_uuid(),
      code_hash text unique,
      client_id text not null references public.lahari_mcp_oauth_clients(client_id) on delete cascade,
      user_id text null,
      redirect_uri text not null,
      code_challenge text not null,
      scopes text[] not null default '{}'::text[],
      resource text null,
      state text null,
      expires_at timestamptz not null,
      approved_at timestamptz null,
      consumed_at timestamptz null,
      created_at timestamptz not null default now()
    );

    create index if not exists lahari_mcp_oauth_codes_client_idx
      on public.lahari_mcp_oauth_codes (client_id, created_at desc);

    create index if not exists lahari_mcp_oauth_codes_code_hash_idx
      on public.lahari_mcp_oauth_codes (code_hash)
      where code_hash is not null;

    alter table public.lahari_mcp_oauth_clients enable row level security;
    alter table public.lahari_mcp_oauth_codes enable row level security;
  end if;
end $$;
