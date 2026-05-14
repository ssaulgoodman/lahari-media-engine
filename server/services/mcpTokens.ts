import crypto from 'node:crypto';
import { getSB, selectColumns, selectOne, updateRows } from '../database.js';

const TOKEN_PREFIX = 'lahari_mcp_';
const DEFAULT_EXPIRY_DAYS = 30;
const MAX_EXPIRY_DAYS = 90;

const nowIso = () => new Date().toISOString();

const daysFromNowIso = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

export const hashMcpToken = (token: string) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

const sanitizeLabel = (label?: string | null) => {
  const trimmed = (label || '').trim();
  return trimmed ? trimmed.slice(0, 80) : 'Lahari MCP';
};

const normalizeExpiryDays = (expiresInDays?: number | null) => {
  const n = Number(expiresInDays || DEFAULT_EXPIRY_DAYS);
  if (!Number.isFinite(n)) return DEFAULT_EXPIRY_DAYS;
  return Math.max(1, Math.min(Math.round(n), MAX_EXPIRY_DAYS));
};

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
  };
  const { data, error } = await getSB()
    .from('lahari_mcp_tokens')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(`DB insert mcp_tokens: ${error.message}`);
  return {
    kind: 'lahari.mcp_token.created',
    id: data.id,
    token,
    tokenPrefix: row.token_prefix,
    label: row.label,
    expiresAt: row.expires_at,
    install: {
      codex: `codex mcp add lahari --url ${process.env.LAHARI_MCP_URL || 'https://lahari-media-engine-production.up.railway.app/mcp'} --bearer-token-env-var LAHARI_MCP_TOKEN`,
      env: `export LAHARI_MCP_TOKEN=${token}`,
      claude: `claude mcp add-json lahari '{"type":"http","url":"${process.env.LAHARI_MCP_URL || 'https://lahari-media-engine-production.up.railway.app/mcp'}","headers":{"Authorization":"Bearer \${LAHARI_MCP_TOKEN}"}}'`,
      claudeFallback: `claude mcp add lahari --transport http --header "Authorization: Bearer ${token}" ${process.env.LAHARI_MCP_URL || 'https://lahari-media-engine-production.up.railway.app/mcp'}`,
    },
  };
};

export const listMcpTokens = async (userId: string) => {
  if (!userId) throw new Error('Auth required');
  const rows = await selectColumns(
    'mcp_tokens',
    'id,label,token_prefix,created_at,expires_at,last_used_at,revoked_at',
    { user_id: userId },
    { orderBy: 'created_at', ascending: false, limit: 50 },
  );
  return {
    kind: 'lahari.mcp_tokens.list',
    tokens: rows.map((row: any) => ({
      id: row.id,
      label: row.label,
      tokenPrefix: row.token_prefix,
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
    kind: 'lahari.mcp_token.revoked',
    id: tokenId,
  };
};

export const verifyMcpBearerToken = async (token: string | null | undefined) => {
  if (!token) throw new Error('Missing Lahari MCP bearer token');
  if (!token.startsWith(TOKEN_PREFIX)) throw new Error('Invalid Lahari MCP bearer token');
  const hash = hashMcpToken(token);
  const { data, error } = await getSB()
    .from('lahari_mcp_tokens')
    .select('id,user_id,label,expires_at,revoked_at')
    .eq('token_hash', hash)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`MCP token lookup failed: ${error.message}`);
  if (!data) throw new Error('Invalid Lahari MCP bearer token');
  if (data.revoked_at) throw new Error('Revoked Lahari MCP bearer token');
  if (data.expires_at && Date.parse(data.expires_at) <= Date.now()) throw new Error('Expired Lahari MCP bearer token');
  await updateRows('mcp_tokens', { id: data.id }, { last_used_at: nowIso() });
  return {
    tokenId: data.id as string,
    userId: data.user_id as string,
    label: data.label as string,
  };
};
