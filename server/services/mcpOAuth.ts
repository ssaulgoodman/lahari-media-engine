import crypto from 'node:crypto';
import type { Response } from 'express';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidGrantError, InvalidRequestError, InvalidScopeError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { getSB, T, updateRows } from '../database.js';
import {
  createOAuthBearerToken,
  getMirageMcpUrl,
  hashMcpToken,
  verifyMcpBearerToken,
} from './mcpTokens.js';

const DEFAULT_SCOPE = 'mcp:tools';
export const MIRAGE_MCP_OAUTH_SCOPES = [DEFAULT_SCOPE];
const AUTH_CODE_TTL_MINUTES = 10;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_DAYS = 30;

const nowIso = () => new Date().toISOString();
const minutesFromNowIso = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000).toISOString();
const secondsFromNowIso = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const daysFromNowIso = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

export const getMiragePublicAppUrl = () => (
  process.env.MIRAGE_APP_URL
  || process.env.PUBLIC_APP_URL
  || process.env.APP_URL
  || process.env.MIRAGE_API_URL
  || 'https://mirage-platform-production-05ca.up.railway.app'
).replace(/\/+$/, '');

const uniqueScopes = (scopes?: string[]) => {
  const normalized = (scopes || [])
    .map((scope) => String(scope || '').trim())
    .filter(Boolean);
  return Array.from(new Set(normalized.length > 0 ? normalized : [DEFAULT_SCOPE]));
};

const assertSupportedScopes = (scopes: string[]) => {
  const unsupported = scopes.filter((scope) => !MIRAGE_MCP_OAUTH_SCOPES.includes(scope));
  if (unsupported.length > 0) throw new InvalidScopeError(`Unsupported Mirage MCP scope: ${unsupported.join(', ')}`);
};

const tokenPrefix = (token: string) => token.slice(0, 18);
const clientName = (client: OAuthClientInformationFull) => client.client_name || client.client_id || 'MCP client';

const rowIsUsable = (row: any) => {
  return row
    && !row.consumed_at
    && row.approved_at
    && row.user_id
    && row.expires_at
    && Date.parse(row.expires_at) > Date.now();
};

class MirageOAuthClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const { data, error } = await getSB()
      .from(T.mcp_oauth_clients)
      .select('client_info')
      .eq('client_id', clientId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`DB select oauth client: ${error.message}`);
    return data?.client_info as OAuthClientInformationFull | undefined;
  }

  async registerClient(client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>): Promise<OAuthClientInformationFull> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fullClient: OAuthClientInformationFull = {
      ...client,
      client_id: crypto.randomUUID(),
      client_id_issued_at: nowSeconds,
    };
    const { error } = await getSB()
      .from(T.mcp_oauth_clients)
      .insert({
        client_id: fullClient.client_id,
        client_info: fullClient,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    if (error) throw new Error(`DB insert oauth client: ${error.message}`);
    return fullClient;
  }
}

const clientsStore = new MirageOAuthClientsStore();

const selectCodeByHash = async (code: string) => {
  const { data, error } = await getSB()
    .from(T.mcp_oauth_codes)
    .select('*')
    .eq('code_hash', hashMcpToken(code))
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`DB select oauth code: ${error.message}`);
  return data;
};

const validateCodeForClient = (row: any, client: OAuthClientInformationFull, redirectUri?: string) => {
  if (!row) throw new InvalidGrantError('Invalid authorization code');
  if (row.client_id !== client.client_id) throw new InvalidGrantError('Authorization code was issued to another client');
  if (!rowIsUsable(row)) throw new InvalidGrantError('Authorization code expired, unapproved, or already consumed');
  if (redirectUri && row.redirect_uri !== redirectUri) throw new InvalidGrantError('redirect_uri does not match authorization request');
};

const insertToken = async (input: {
  userId: string;
  clientId: string;
  label: string;
  tokenKind: 'oauth_access' | 'oauth_refresh';
  scopes: string[];
  resource?: string | null;
  expiresAt: string;
}) => {
  const token = createOAuthBearerToken();
  const { error } = await getSB()
    .from(T.mcp_tokens)
    .insert({
      user_id: input.userId,
      label: input.label,
      token_hash: hashMcpToken(token),
      token_prefix: tokenPrefix(token),
      expires_at: input.expiresAt,
      token_kind: input.tokenKind,
      oauth_client_id: input.clientId,
      oauth_scopes: input.scopes,
      oauth_resource: input.resource || null,
    });
  if (error) throw new Error(`DB insert oauth token: ${error.message}`);
  return token;
};

const issueOAuthTokens = async (input: {
  userId: string;
  client: OAuthClientInformationFull;
  scopes: string[];
  resource?: string | null;
  includeRefresh: boolean;
}): Promise<OAuthTokens> => {
  assertSupportedScopes(input.scopes);
  const label = `OAuth: ${clientName(input.client)}`;
  const accessToken = await insertToken({
    userId: input.userId,
    clientId: input.client.client_id,
    label,
    tokenKind: 'oauth_access',
    scopes: input.scopes,
    resource: input.resource,
    expiresAt: secondsFromNowIso(ACCESS_TOKEN_TTL_SECONDS),
  });
  const refreshToken = input.includeRefresh
    ? await insertToken({
      userId: input.userId,
      clientId: input.client.client_id,
      label,
      tokenKind: 'oauth_refresh',
      scopes: input.scopes,
      resource: input.resource,
      expiresAt: daysFromNowIso(REFRESH_TOKEN_TTL_DAYS),
    })
    : undefined;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: input.scopes.join(' '),
  };
};

class MirageOAuthProvider implements OAuthServerProvider {
  get clientsStore(): OAuthRegisteredClientsStore {
    return clientsStore;
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const scopes = uniqueScopes(params.scopes);
    assertSupportedScopes(scopes);
    const approvalId = crypto.randomUUID();
    const { error } = await getSB()
      .from(T.mcp_oauth_codes)
      .insert({
        approval_id: approvalId,
        client_id: client.client_id,
        redirect_uri: params.redirectUri,
        code_challenge: params.codeChallenge,
        scopes,
        resource: params.resource?.href || null,
        state: params.state || null,
        expires_at: minutesFromNowIso(AUTH_CODE_TTL_MINUTES),
      });
    if (error) throw new Error(`DB insert oauth code: ${error.message}`);

    const url = new URL('/connect', getMiragePublicAppUrl());
    url.searchParams.set('oauth', approvalId);
    res.redirect(302, url.href);
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const row = await selectCodeByHash(authorizationCode);
    validateCodeForClient(row, client);
    return row.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const row = await selectCodeByHash(authorizationCode);
    validateCodeForClient(row, client, redirectUri);
    const { data: claimed, error: claimError } = await getSB()
      .from(T.mcp_oauth_codes)
      .update({ consumed_at: nowIso() })
      .eq('approval_id', row.approval_id)
      .is('consumed_at', null)
      .select('approval_id');
    if (claimError) throw new Error(`DB consume oauth code: ${claimError.message}`);
    if (!claimed?.length) throw new InvalidGrantError('Authorization code already consumed');
    const scopes = uniqueScopes(row.scopes);
    return issueOAuthTokens({
      userId: row.user_id,
      client,
      scopes,
      resource: resource?.href || row.resource || getMirageMcpUrl(),
      includeRefresh: true,
    });
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const verified = await verifyMcpBearerToken(refreshToken);
    if (verified.tokenKind !== 'oauth_refresh') throw new InvalidGrantError('Invalid refresh token');
    if (verified.oauthClientId !== client.client_id) throw new InvalidGrantError('Refresh token was issued to another client');
    const storedScopes = uniqueScopes(verified.oauthScopes);
    const requestedScopes = scopes ? uniqueScopes(scopes) : storedScopes;
    const disallowed = requestedScopes.filter((scope) => !storedScopes.includes(scope));
    if (disallowed.length > 0) throw new InvalidScopeError(`Refresh token cannot grant scope: ${disallowed.join(', ')}`);
    return issueOAuthTokens({
      userId: verified.userId,
      client,
      scopes: requestedScopes,
      resource: resource?.href || verified.oauthResource || getMirageMcpUrl(),
      includeRefresh: false,
    });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const verified = await verifyMcpBearerToken(token);
    if (verified.tokenKind !== 'oauth_access') throw new InvalidRequestError('Token is not an OAuth access token');
    return {
      token,
      clientId: verified.oauthClientId || 'mirage-oauth-client',
      scopes: uniqueScopes(verified.oauthScopes),
      expiresAt: undefined,
      resource: verified.oauthResource ? new URL(verified.oauthResource) : new URL(getMirageMcpUrl()),
      extra: {
        userId: verified.userId,
        tokenId: verified.tokenId,
        label: verified.label,
      },
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const hash = hashMcpToken(request.token);
    const { data, error } = await getSB()
      .from(T.mcp_tokens)
      .select('id,oauth_client_id')
      .eq('token_hash', hash)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`DB select oauth token: ${error.message}`);
    if (!data || data.oauth_client_id !== client.client_id) return;
    await updateRows('mcp_tokens', { id: data.id }, { revoked_at: nowIso() });
  }
}

export const mirageOAuthProvider = new MirageOAuthProvider();

export const getMcpOAuthRequest = async (approvalId: string) => {
  const { data, error } = await getSB()
    .from(T.mcp_oauth_codes)
    .select('approval_id,client_id,scopes,resource,expires_at,approved_at,consumed_at,created_at')
    .eq('approval_id', approvalId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`DB select oauth request: ${error.message}`);
  if (!data) throw new Error('OAuth request not found');
  const client = await clientsStore.getClient(data.client_id);
  if (!client) throw new Error('OAuth client not found');
  const expired = Date.parse(data.expires_at) <= Date.now();
  return {
    kind: 'mirage.oauth_request',
    approvalId: data.approval_id,
    clientId: data.client_id,
    clientName: clientName(client),
    clientUri: client.client_uri || null,
    scopes: uniqueScopes(data.scopes),
    resource: data.resource || getMirageMcpUrl(),
    expiresAt: data.expires_at,
    expired,
    approved: Boolean(data.approved_at),
    consumed: Boolean(data.consumed_at),
  };
};

export const approveMcpOAuthRequest = async (approvalId: string, userId: string) => {
  if (!userId) throw new Error('Auth required');
  const { data, error } = await getSB()
    .from(T.mcp_oauth_codes)
    .select('*')
    .eq('approval_id', approvalId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`DB select oauth request: ${error.message}`);
  if (!data) throw new Error('OAuth request not found');
  if (data.consumed_at) throw new Error('OAuth request already consumed');
  if (Date.parse(data.expires_at) <= Date.now()) throw new Error('OAuth request expired');
  const code = crypto.randomBytes(32).toString('base64url');
  await updateRows('mcp_oauth_codes', { approval_id: approvalId }, {
    user_id: userId,
    code_hash: hashMcpToken(code),
    approved_at: nowIso(),
  });
  const redirectUrl = new URL(data.redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (data.state) redirectUrl.searchParams.set('state', data.state);
  return {
    kind: 'mirage.oauth_request.approved',
    approvalId,
    redirectUrl: redirectUrl.href,
  };
};
