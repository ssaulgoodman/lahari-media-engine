import { Router } from 'express';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import {
  approveMcpOAuthRequest,
  getMcpOAuthRequest,
  getMiragePublicAppUrl,
  MIRAGE_MCP_OAUTH_SCOPES,
  mirageOAuthProvider,
} from '../services/mcpOAuth.js';
import { getMirageMcpUrl } from '../services/mcpTokens.js';

const ok = (data: unknown) => ({ ok: true, data });

const statusForMessage = (message: string) => {
  if (/auth/i.test(message)) return 401;
  if (/not found/i.test(message)) return 404;
  if (/expired|consumed/i.test(message)) return 410;
  return 400;
};

const fail = (res: any, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || 'OAuth error');
  const status = statusForMessage(message);
  return res.status(status).json({
    ok: false,
    error: {
      code: status === 401 ? 'auth_expired' : 'mcp_oauth_error',
      message,
    },
  });
};

export const mcpOAuthRouter = mcpAuthRouter({
  provider: mirageOAuthProvider,
  issuerUrl: new URL(getMiragePublicAppUrl()),
  resourceServerUrl: new URL(getMirageMcpUrl()),
  scopesSupported: MIRAGE_MCP_OAUTH_SCOPES,
  resourceName: 'Mirage MCP',
});

const apiRouter = Router();

apiRouter.get('/requests/:approvalId', async (req, res) => {
  try {
    res.json(ok(await getMcpOAuthRequest(req.params.approvalId)));
  } catch (error) {
    fail(res, error);
  }
});

apiRouter.post('/requests/:approvalId/approve', async (req, res) => {
  try {
    res.json(ok(await approveMcpOAuthRequest(req.params.approvalId, req.userId || '')));
  } catch (error) {
    fail(res, error);
  }
});

export { apiRouter as mcpOAuthApiRouter };
