import crypto from 'node:crypto';
import { getSB, selectColumns, selectOne, updateRows, T } from '../database.js';

const TOKEN_PREFIX = 'mirage_mcp_';
const LEGACY_TOKEN_PREFIX = 'lahari_mcp_';
const DEFAULT_EXPIRY_DAYS = 30;
const MAX_EXPIRY_DAYS = 90;
const DEFAULT_CLI_TTL_MINUTES = 60;
const MAX_CLI_TTL_MINUTES = 180;

const nowIso = () => new Date().toISOString();

const daysFromNowIso = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
const minutesFromNowIso = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000).toISOString();

export const hashMcpToken = (token: string) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

const sanitizeLabel = (label?: string | null) => {
  const trimmed = (label || '').trim();
  return trimmed ? trimmed.slice(0, 80) : 'Mirage MCP';
};

const mcpUrl = () => (
  process.env.MIRAGE_MCP_URL
  || process.env.LAHARI_MCP_URL
  || process.env.APP_URL && `${process.env.APP_URL.replace(/\/+$/, '')}/mcp`
  || process.env.PUBLIC_APP_URL && `${process.env.PUBLIC_APP_URL.replace(/\/+$/, '')}/mcp`
  || 'https://mirage-platform-production-05ca.up.railway.app/mcp'
);

const normalizeExpiryDays = (expiresInDays?: number | null) => {
  const n = Number(expiresInDays || DEFAULT_EXPIRY_DAYS);
  if (!Number.isFinite(n)) return DEFAULT_EXPIRY_DAYS;
  return Math.max(1, Math.min(Math.round(n), MAX_EXPIRY_DAYS));
};

const normalizeTtlMinutes = (ttlMinutes?: number | null) => {
  const n = Number(ttlMinutes || DEFAULT_CLI_TTL_MINUTES);
  if (!Number.isFinite(n)) return DEFAULT_CLI_TTL_MINUTES;
  return Math.max(5, Math.min(Math.round(n), MAX_CLI_TTL_MINUTES));
};

const posixCliCacheDir = '${TMPDIR:-/tmp}/mirage-npm-cache';
const posixCliCacheEnv = `NPM_CONFIG_CACHE="${posixCliCacheDir}" npm_config_cache="${posixCliCacheDir}"`;
const powershellCliCacheCommand = `$env:NPM_CONFIG_CACHE=(Join-Path ([System.IO.Path]::GetTempPath()) 'mirage-npm-cache'); $env:npm_config_cache=$env:NPM_CONFIG_CACHE`;
export const getConfiguredMirageCliPackage = () => process.env.MIRAGE_CLI_PACKAGE || '@ssaulgoodman420/mirage-cli@0.1.9';

export const createMcpToken = async (
  userId: string,
  opts: { label?: string | null; expiresInDays?: number | null } = {},
) => {
  if (!userId) throw new Error('Auth required');
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const expiresInDays = normalizeExpiryDays(opts.expiresInDays);
  const row = {
    user_id: userId,
    label: sanitizeLabel(opts.label),
    token_hash: hashMcpToken(token),
    token_prefix: token.slice(0, 18),
    expires_at: daysFromNowIso(expiresInDays),
    token_kind: 'mcp',
  };
  const { data, error } = await getSB()
    .from(T.mcp_tokens)
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(`DB insert mcp_tokens: ${error.message}`);
  return {
    kind: 'mirage.mcp_token.created',
    id: data.id,
    token,
    tokenPrefix: row.token_prefix,
    label: row.label,
    expiresAt: row.expires_at,
    install: {
      codexApp: `Name: mirage
Type: Streamable HTTP
URL: ${mcpUrl()}
Bearer token env var: leave blank
Header key: Authorization
Header value: Bearer ${token}`,
      codexAppVerify: `Fully quit and reopen Codex Desktop.
Start a new chat.
Ask: Call Mirage list_projects.`,
      codex: `codex mcp add mirage --url ${mcpUrl()} --bearer-token-env-var MIRAGE_MCP_TOKEN`,
      env: `export MIRAGE_MCP_TOKEN=${token}`,
      codexWindows: `[Environment]::SetEnvironmentVariable("MIRAGE_MCP_TOKEN", "${token}", "User")
codex mcp remove mirage
codex mcp add mirage --url ${mcpUrl()} --bearer-token-env-var MIRAGE_MCP_TOKEN
codex mcp get mirage --json
Get-Process *codex* -ErrorAction SilentlyContinue | Stop-Process -Force`,
      claude: `claude mcp add-json mirage '{"type":"http","url":"${mcpUrl()}","headers":{"Authorization":"Bearer \${MIRAGE_MCP_TOKEN}"}}'`,
      claudeFallback: `claude mcp add mirage --transport http --header "Authorization: Bearer ${token}" ${mcpUrl()}`,
    },
  };
};

export const createCliToken = async (
  userId: string,
  opts: { projectId: string; ttlMinutes?: number | null; label?: string | null } = { projectId: '' },
) => {
  if (!userId) throw new Error('Auth required');
  if (!opts.projectId) throw new Error('projectId is required');
  const project = await selectOne('projects', { id: opts.projectId });
  if (!project) throw new Error(`Project not found: ${opts.projectId}`);
  if (project.user_id !== userId) throw new Error('Access denied');

  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const ttlMinutes = normalizeTtlMinutes(opts.ttlMinutes);
  const row = {
    user_id: userId,
    label: sanitizeLabel(opts.label || `CLI sync: ${project.title || opts.projectId}`),
    token_hash: hashMcpToken(token),
    token_prefix: token.slice(0, 18),
    expires_at: minutesFromNowIso(ttlMinutes),
    token_kind: 'cli',
    scope_project_id: opts.projectId,
  };
  const { data, error } = await getSB()
    .from(T.mcp_tokens)
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(`DB insert cli token: ${error.message}`);
  const apiUrl = (process.env.MIRAGE_API_URL || process.env.LAHARI_API_URL || 'https://mirage-platform-production-05ca.up.railway.app').replace(/\/+$/, '');
  const cliPackage = getConfiguredMirageCliPackage();
  const uploadEndpoint = `${apiUrl}/api/agent/uploads`;
  const posixCommand = `${posixCliCacheEnv} MIRAGE_CLI_TOKEN=${token} MIRAGE_API_URL=${apiUrl} npx -y ${cliPackage} sync ${opts.projectId}`;
  const powershellCommand = `${powershellCliCacheCommand}; $env:MIRAGE_CLI_TOKEN='${token}'; $env:MIRAGE_API_URL='${apiUrl}'; cmd /c npx -y ${cliPackage} sync ${opts.projectId}`;
  const posixInstalledCommand = `MIRAGE_CLI_TOKEN=${token} MIRAGE_API_URL=${apiUrl} mirage sync ${opts.projectId}`;
  const powershellInstalledCommand = `$env:MIRAGE_CLI_TOKEN='${token}'; $env:MIRAGE_API_URL='${apiUrl}'; mirage sync ${opts.projectId}`;
  const posixUploadExample = `curl -sS -H "Authorization: Bearer ${token}" -F projectId=${opts.projectId} -F purpose=cast_reference -F entityId=<castMemberId> -F file=@<imagePath> ${uploadEndpoint}`;
  const powershellUploadExample = `curl.exe -sS -H "Authorization: Bearer ${token}" -F "projectId=${opts.projectId}" -F "purpose=cast_reference" -F "entityId=<castMemberId>" -F "file=@<imagePath>" "${uploadEndpoint}"`;
  return {
    kind: 'mirage.cli_token.created',
    id: data.id,
    token,
    tokenPrefix: row.token_prefix,
    tokenKind: row.token_kind,
    scopeProjectId: row.scope_project_id,
    expiresAt: row.expires_at,
    ttlMinutes,
    command: posixCommand,
    commands: {
      installCli: `npm install -g ${cliPackage}`,
      posix: posixCommand,
      powershell: powershellCommand,
      posixInstalled: posixInstalledCommand,
      powershellInstalled: powershellInstalledCommand,
    },
    upload: {
      endpoint: uploadEndpoint,
      method: 'POST',
      auth: 'Authorization: Bearer <token>',
      contentType: 'multipart/form-data',
      fileField: 'file',
      fields: {
        projectId: opts.projectId,
        purpose: 'cast_reference | env_reference | style_reference | cast_guide | env_guide | style_guide | storyboard_image | audio_source',
        entityId: 'required for cast_reference, env_reference, cast_guide, and env_guide',
      },
      examples: {
        posix: posixUploadExample,
        powershell: powershellUploadExample,
      },
      next: 'Use the returned assetId as sourceAssetId for lock_reference/apply_style_direction/import_storyboard_image, as guideAssetId for generation, or leave audio_source attached to the project.',
    },
    note: 'Short-lived project-scoped token. Do not store it. Use commands.posix/commands.powershell for one-shot notebook sync. On Windows/Codex, if npx is blocked because it downloads code while holding a live token, run commands.installCli once outside the token flow, then use commands.powershellInstalled for sync. For local image/audio files, POST multipart directly to upload.endpoint; Mirage CLI upload subcommands are not part of the agent path.',
    sync: {
      npmCache: {
        posix: posixCliCacheDir,
        powershell: '%TEMP%\\mirage-npm-cache',
        reason: 'The returned sync commands isolate npx/npm cache from ambient ~/.npm so root-owned global cache files cannot block notebook refresh.',
      },
    },
  };
};

export const listMcpTokens = async (userId: string) => {
  if (!userId) throw new Error('Auth required');
  const rows = await selectColumns(
    'mcp_tokens',
    'id,label,token_prefix,token_kind,scope_project_id,created_at,expires_at,last_used_at,revoked_at',
    { user_id: userId },
    { orderBy: 'created_at', ascending: false, limit: 50 },
  );
  return {
    kind: 'mirage.mcp_tokens.list',
    tokens: rows.map((row: any) => ({
      id: row.id,
      label: row.label,
      tokenPrefix: row.token_prefix,
      tokenKind: row.token_kind || 'mcp',
      scopeProjectId: row.scope_project_id || null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
      active: !row.revoked_at && (!row.expires_at || Date.parse(row.expires_at) > Date.now()),
    })),
  };
};

export const revokeMcpToken = async (userId: string, tokenId: string) => {
  if (!userId) throw new Error('Auth required');
  if (!tokenId) throw new Error('tokenId is required');
  const row = await selectOne('mcp_tokens', { id: tokenId });
  if (!row) throw new Error(`MCP token not found: ${tokenId}`);
  if (row.user_id !== userId) throw new Error('Access denied');
  await updateRows('mcp_tokens', { id: tokenId }, { revoked_at: nowIso() });
  return {
    kind: 'mirage.mcp_token.revoked',
    id: tokenId,
  };
};

export const verifyMcpBearerToken = async (token: string | null | undefined) => {
  if (!token) throw new Error('Missing Mirage MCP bearer token');
  if (!token.startsWith(TOKEN_PREFIX) && !token.startsWith(LEGACY_TOKEN_PREFIX)) throw new Error('Invalid Mirage MCP bearer token');
  const hash = hashMcpToken(token);
  const { data, error } = await getSB()
    .from(T.mcp_tokens)
    .select('id,user_id,label,token_kind,scope_project_id,expires_at,revoked_at')
    .eq('token_hash', hash)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`MCP token lookup failed: ${error.message}`);
  if (!data) throw new Error('Invalid Mirage MCP bearer token');
  if (data.revoked_at) throw new Error('Revoked Mirage MCP bearer token');
  if (data.expires_at && Date.parse(data.expires_at) <= Date.now()) throw new Error('Expired Mirage MCP bearer token');
  await updateRows('mcp_tokens', { id: data.id }, { last_used_at: nowIso() });
  return {
    tokenId: data.id as string,
    userId: data.user_id as string,
    label: data.label as string,
    tokenKind: (data.token_kind || 'mcp') as string,
    scopeProjectId: (data.scope_project_id || null) as string | null,
  };
};
