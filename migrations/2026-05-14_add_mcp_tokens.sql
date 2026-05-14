create table if not exists public.lahari_mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  label text not null default 'Lahari MCP',
  token_hash text not null unique,
  token_prefix text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_lahari_mcp_tokens_user_created
  on public.lahari_mcp_tokens (user_id, created_at desc);

create index if not exists idx_lahari_mcp_tokens_active
  on public.lahari_mcp_tokens (token_hash)
  where revoked_at is null;

alter table public.lahari_mcp_tokens enable row level security;
