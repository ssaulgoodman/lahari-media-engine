import crypto from 'node:crypto';
import { Router } from 'express';
import { selectOne } from '../database.js';
import { createCliToken, verifyMcpBearerToken } from '../services/mcpTokens.js';
import { buildProjectNotebook, uploadCastReference, uploadEnvironmentReference } from '../services/codexStudio.js';
import { getFullProject } from './projects.js';
import { paramStr } from './scope-helpers.js';

const router = Router();

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const bearerToken = (header?: string | null) => {
  const match = (header || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const fail = (res: any, status: number, code: string, message: string, details?: unknown) => res.status(status).json({
  ok: false,
  error: { code, message, details },
});

const verifiedCliProject = async (req: any, res: any) => {
  const projectId = paramStr(req.params.projectId);
  const auth = await verifyMcpBearerToken(bearerToken(req.headers.authorization));
  if (auth.tokenKind !== 'cli') {
    fail(res, 403, 'wrong_token_kind', 'This endpoint requires a short-lived Mirage CLI token minted by MCP.');
    return null;
  }
  if (auth.scopeProjectId !== projectId) {
    fail(res, 403, 'project_scope_mismatch', 'CLI token is not scoped to this project.', {
      scopeProjectId: auth.scopeProjectId,
      projectId,
    });
    return null;
  }

  const projectRow = await selectOne('projects', { id: projectId });
  if (!projectRow) {
    fail(res, 404, 'project_not_found', `Project not found: ${projectId}`);
    return null;
  }
  if (projectRow.user_id !== auth.userId) {
    fail(res, 403, 'access_denied', 'Access denied');
    return null;
  }
  return { projectId, auth };
};

router.get('/auth/status', async (req, res) => {
  try {
    const rawToken = bearerToken(req.headers.authorization);
    const auth = await verifyMcpBearerToken(rawToken);
    return res.json({
      ok: true,
      data: {
        kind: 'mirage.cli.auth.status',
        tokenKind: auth.tokenKind,
        scopeProjectId: auth.scopeProjectId,
        tokenPrefix: rawToken ? rawToken.slice(0, 18) : null,
        authenticated: true,
      },
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown auth status error');
    return fail(res, 401, 'auth_failed', message);
  }
});

router.post('/projects/:projectId/cli-token', async (req, res) => {
  try {
    const projectId = paramStr(req.params.projectId);
    const rawToken = bearerToken(req.headers.authorization);
    const auth = await verifyMcpBearerToken(rawToken);
    if (auth.tokenKind !== 'mcp') {
      return fail(res, 403, 'wrong_token_kind', 'This endpoint requires an account-scoped Mirage MCP token from /connect.');
    }
    const ttlMinutes = Number.isFinite(Number(req.body?.ttlMinutes)) ? Number(req.body.ttlMinutes) : undefined;
    const minted = await createCliToken(auth.userId, {
      projectId,
      ttlMinutes,
      label: `CLI sync: ${projectId.slice(0, 8)}`,
    });
    return res.json({
      ok: true,
      data: {
        kind: 'mirage.cli_token.minted',
        token: minted.token,
        tokenPrefix: minted.tokenPrefix,
        tokenKind: minted.tokenKind,
        scopeProjectId: minted.scopeProjectId,
        expiresAt: minted.expiresAt,
        ttlMinutes: minted.ttlMinutes,
      },
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown CLI token mint error');
    const status = message.includes('Missing') || message.includes('Invalid') || message.includes('Expired') || message.includes('Revoked') ? 401
      : message.includes('Access denied') ? 403
        : message.includes('not found') || message.includes('Not found') ? 404
          : 500;
    return fail(res, status, status === 401 ? 'auth_failed' : 'cli_token_mint_failed', message);
  }
});

router.post('/projects/:projectId/notebook', async (req, res) => {
  try {
    const verified = await verifiedCliProject(req, res);
    if (!verified) return;
    const { projectId } = verified;

    const knownHashes = req.body?.knownHashes && typeof req.body.knownHashes === 'object'
      ? req.body.knownHashes as Record<string, string>
      : {};
    const notebook = await buildProjectNotebook(await getFullProject(projectId));
    const manifest = notebook.files.map((file) => {
      const hash = sha256(file.content);
      return {
        path: file.path,
        mode: file.mode,
        scope: file.scope || 'project',
        writePolicy: file.writePolicy,
        description: file.description,
        hash,
        size: Buffer.byteLength(file.content, 'utf8'),
      };
    });
    const files = notebook.files.flatMap((file, index) => (
      knownHashes[file.path] === manifest[index].hash
        ? []
        : [{ ...manifest[index], content: file.content }]
    ));
    const manifestPaths = new Set(manifest.map((file) => file.path));
    const removedFiles = Object.keys(knownHashes).filter((filePath) => !manifestPaths.has(filePath));

    return res.json({
      ok: true,
      data: {
        kind: 'mirage.notebook.sync',
        notebookVersion: notebook.notebookVersion,
        generatedAt: notebook.generatedAt,
        actionsHash: notebook.actionsHash,
        skillsHash: notebook.skillsHash,
        project: notebook.project,
        baseDir: notebook.baseDir,
        manifest,
        files,
        removedFiles,
      },
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown notebook sync error');
    const status = message.includes('Missing') || message.includes('Invalid') || message.includes('Expired') || message.includes('Revoked') ? 401 : 500;
    return fail(res, status, status === 401 ? 'auth_failed' : 'notebook_sync_failed', message);
  }
});

router.post('/projects/:projectId/references/cast/:castMemberId/upload', async (req, res) => {
  try {
    const verified = await verifiedCliProject(req, res);
    if (!verified) return;
    const { projectId } = verified;
    const castMemberId = paramStr(req.params.castMemberId);
    const result = await uploadCastReference(await getFullProject(projectId), {
      castMemberId,
      filename: typeof req.body?.filename === 'string' ? req.body.filename : undefined,
      mimeType: typeof req.body?.mimeType === 'string' ? req.body.mimeType : undefined,
      base64: typeof req.body?.base64 === 'string' ? req.body.base64 : '',
      note: typeof req.body?.note === 'string' ? req.body.note : undefined,
    });
    return res.json({ ok: !('error' in result), data: result });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown reference upload error');
    const status = message.includes('Missing') || message.includes('Invalid') || message.includes('Expired') || message.includes('Revoked') ? 401 : 500;
    return fail(res, status, status === 401 ? 'auth_failed' : 'reference_upload_failed', message);
  }
});

router.post('/projects/:projectId/references/environments/:environmentId/upload', async (req, res) => {
  try {
    const verified = await verifiedCliProject(req, res);
    if (!verified) return;
    const { projectId } = verified;
    const environmentId = paramStr(req.params.environmentId);
    const result = await uploadEnvironmentReference(await getFullProject(projectId), {
      environmentId,
      filename: typeof req.body?.filename === 'string' ? req.body.filename : undefined,
      mimeType: typeof req.body?.mimeType === 'string' ? req.body.mimeType : undefined,
      base64: typeof req.body?.base64 === 'string' ? req.body.base64 : '',
      note: typeof req.body?.note === 'string' ? req.body.note : undefined,
    });
    return res.json({ ok: !('error' in result), data: result });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown reference upload error');
    const status = message.includes('Missing') || message.includes('Invalid') || message.includes('Expired') || message.includes('Revoked') ? 401 : 500;
    return fail(res, status, status === 401 ? 'auth_failed' : 'reference_upload_failed', message);
  }
});

export { router as notebookSyncRouter };
