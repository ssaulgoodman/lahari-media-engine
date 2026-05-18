import { Router } from 'express';
import {
  MissingProviderKeyError,
  deleteTenantApiKey,
  listTenantApiKeys,
  upsertTenantApiKey,
} from '../services/byok/resolver.js';

const router = Router();
const ok = (data: unknown) => ({ ok: true, data });

const fail = (res: any, error: unknown) => {
  if (error instanceof MissingProviderKeyError) {
    return res.status(400).json({ ok: false, error: error.toJSON() });
  }

  const message = error instanceof Error ? error.message : String(error || 'Unknown account error');
  const status = message.includes('Auth') ? 401
    : message.includes('Unsupported provider') ? 400
      : 400;
  return res.status(status).json({
    ok: false,
    error: {
      code: status === 401 ? 'auth_expired' : 'account_error',
      message,
    },
  });
};

router.get('/api-keys', async (req, res) => {
  try {
    res.json(ok(await listTenantApiKeys(req.userId || '')));
  } catch (error) {
    fail(res, error);
  }
});

router.put('/api-keys/:provider', async (req, res) => {
  try {
    const value = typeof req.body?.value === 'string' ? req.body.value : '';
    const label = typeof req.body?.label === 'string' ? req.body.label : null;
    res.json(ok(await upsertTenantApiKey(req.userId || '', req.params.provider, value, label)));
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/api-keys/:provider', async (req, res) => {
  try {
    res.json(ok(await deleteTenantApiKey(req.userId || '', req.params.provider)));
  } catch (error) {
    fail(res, error);
  }
});

export { router as accountRouter };
