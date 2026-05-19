import crypto from 'node:crypto';
import { Router } from 'express';
import { selectOne } from '../database.js';
import { verifyMcpBearerToken } from '../services/mcpTokens.js';
import { buildProjectNotebook } from '../services/codexStudio.js';
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

router.post('/projects/:projectId/notebook', async (req, res) => {
  try {
    const projectId = paramStr(req.params.projectId);
    const auth = await verifyMcpBearerToken(bearerToken(req.headers.authorization));
    if (auth.tokenKind !== 'cli') {
      return fail(res, 403, 'wrong_token_kind', 'Notebook sync requires a short-lived Mirage CLI token minted by MCP.');
    }
    if (auth.scopeProjectId !== projectId) {
      return fail(res, 403, 'project_scope_mismatch', 'CLI token is not scoped to this project.', {
        scopeProjectId: auth.scopeProjectId,
        projectId,
      });
    }

    const projectRow = await selectOne('projects', { id: projectId });
    if (!projectRow) return fail(res, 404, 'project_not_found', `Project not found: ${projectId}`);
    if (projectRow.user_id !== auth.userId) return fail(res, 403, 'access_denied', 'Access denied');

    const knownHashes = req.body?.knownHashes && typeof req.body.knownHashes === 'object'
      ? req.body.knownHashes as Record<string, string>
      : {};
    const notebook = await buildProjectNotebook(await getFullProject(projectId));
    const manifest = notebook.files.map((file) => {
      const hash = sha256(file.content);
      return {
        path: file.path,
        mode: file.mode,
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

export { router as notebookSyncRouter };
