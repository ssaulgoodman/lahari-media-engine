import { Router } from 'express';
import { createMcpToken, listMcpTokens, revokeMcpToken } from '../services/mcpTokens.js';
import { RateLimitError, assertRateLimit, envInt } from '../services/rateLimit.js';

const router = Router();
const TOKEN_CREATE_LIMIT_PER_HOUR = envInt('LAHARI_MCP_TOKEN_CREATES_PER_HOUR', 10);

const ok = (data: unknown) => ({ ok: true, data });

const fail = (res: any, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || 'Unknown MCP token error');
  const status = error instanceof RateLimitError ? 429
    : message.includes('Access denied') ? 403
    : message.includes('not found') ? 404
      : message.includes('Auth') ? 401
        : 400;
  return res.status(status).json({
    ok: false,
    error: {
      code: status === 401 ? 'auth_expired' : status === 429 ? 'rate_limited' : 'mcp_token_error',
      message,
      retryAfterSeconds: error instanceof RateLimitError ? error.retryAfterSeconds : undefined,
    },
  });
};

router.get('/', async (req, res) => {
  try {
    res.json(ok(await listMcpTokens(req.userId || '')));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/', async (req, res) => {
  try {
    assertRateLimit({
      key: `mcp-token:create:${req.userId || req.ip}`,
      limit: TOKEN_CREATE_LIMIT_PER_HOUR,
      windowMs: 60 * 60 * 1000,
      label: 'MCP token creation',
    });
    res.json(ok(await createMcpToken(req.userId || '', {
      label: req.body?.label,
      expiresInDays: req.body?.expiresInDays,
    })));
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/:tokenId', async (req, res) => {
  try {
    res.json(ok(await revokeMcpToken(req.userId || '', req.params.tokenId)));
  } catch (error) {
    fail(res, error);
  }
});

export { router as mcpTokensRouter };
