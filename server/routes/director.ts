import { Router, type Request, type Response } from 'express';
import { selectColumns, selectOne } from '../database.js';
import { getFullProject } from './projects.js';
import { listDirectorEvents } from '../services/directorEvents.js';
import { captureLahariIssue, recordMcpAudit } from '../services/lahariAudit.js';
import * as studio from '../services/codexStudio.js';

const router = Router();
const DIRECTOR_API_VERSION = '2026-05-14.r17-first-pass';

type DirectorHandler = (req: Request, res: Response) => Promise<unknown>;

const ok = (res: Response, data: unknown) => res.json({
  ok: true,
  data,
});

const fail = (res: Response, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || 'Unknown director API error');
  const status = message.includes('not found') ? 404
    : message.includes('Access denied') ? 403
      : message.includes('Invalid or expired') || message.includes('auth') ? 401
        : 400;
  return res.status(status).json({
    ok: false,
    error: {
      code: status === 401 ? 'auth_expired' : 'director_api_error',
      message,
    },
  });
};

const projectIdFromRequest = (req: Request): string | null => {
  return (req.params.projectId || req.body?.projectId || req.query.projectId || null) as string | null;
};

const paramStr = (value: string | string[] | undefined): string => Array.isArray(value) ? value[0] : value || '';

const audited = (tool: string, handler: DirectorHandler) => async (req: Request, res: Response) => {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const args = {
    projectId: projectIdFromRequest(req),
    params: req.params,
    query: req.query,
    body: req.body,
  };
  recordMcpAudit({ source: 'mcp-remote', phase: 'start', tool, args, startedAt });
  try {
    const data = await handler(req, res);
    recordMcpAudit({ source: 'mcp-remote', phase: 'finish', tool, args, result: data, durationMs: Date.now() - start, startedAt });
    return ok(res, data);
  } catch (error) {
    recordMcpAudit({ source: 'mcp-remote', phase: 'finish', tool, args, error, durationMs: Date.now() - start, startedAt });
    return fail(res, error);
  }
};

const assertProjectAccess = async (projectId: string, userId?: string) => {
  if (!projectId) throw new Error('projectId is required');
  const row = await selectOne('projects', { id: projectId });
  if (!row) throw new Error(`Project not found: ${projectId}`);
  if (row.user_id !== userId) throw new Error('Access denied');
  return row;
};

const fullProjectForUser = async (projectId: string, userId?: string) => {
  await assertProjectAccess(projectId, userId);
  const project = await getFullProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  return project;
};

const remoteSessionState = async (projectId: string, userId?: string, opts: { sinceSeq?: number | null; note?: string | null } = {}) => {
  const project = await fullProjectForUser(projectId, userId);
  const [packet, actions, status, events] = await Promise.all([
    studio.buildProjectPacket(project),
    studio.buildProjectActionList(project),
    studio.buildStoryboardStatus(project),
    listDirectorEvents(projectId, { afterSeq: opts.sinceSeq ?? null, limit: 50 }),
  ]);
  return {
    kind: 'lahari.director.remote_session',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      webUrl: studio.webStudioUrl(project.id, { step: 'studio' }),
    },
    note: opts.note || null,
    packet,
    actions,
    storyboardStatus: status,
    directorEvents: {
      newEvents: events.length,
      lastSeq: events.length ? events[events.length - 1].seq ?? opts.sinceSeq ?? null : opts.sinceSeq ?? null,
      recentEvents: events.slice(-10).map((event) => ({
        id: event.id,
        seq: event.seq ?? null,
        createdAt: event.created_at,
        source: event.source,
        eventType: event.event_type,
        entityType: event.entity_type,
        entityId: event.entity_id,
        summary: event.summary,
      })),
    },
    sourceOfTruth: 'Supabase is canonical. Remote MCP clients should keep local files as desk copies only.',
  };
};

router.get('/version', audited('director.version', async () => ({
  kind: 'lahari.director.version',
  version: DIRECTOR_API_VERSION,
  minimumMcpServerVersion: '0.1.0',
})));

router.get('/projects', audited('director.projects.list', async (req) => {
  const rows = await selectColumns(
    'projects',
    'id,title,status,song_type,is_narrative,is_meditative,image_model,storyboard_provider,video_model,text_provider,created_at,updated_at',
    { user_id: req.userId },
    { orderBy: 'updated_at', ascending: false, limit: Math.min(Number(req.query.limit || 20) || 20, 100) },
  );
  return {
    kind: 'lahari.project.list',
    generatedAt: new Date().toISOString(),
    projects: rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      songType: row.song_type || null,
      isNarrative: row.is_narrative ?? null,
      isMeditative: row.is_meditative ?? null,
      imageModel: row.image_model,
      storyboardProvider: row.storyboard_provider,
      videoModel: row.video_model,
      textProvider: row.text_provider,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}));

router.post('/session/attach', audited('director.session.attach', async (req) => remoteSessionState(req.body.projectId, req.userId, {
  sinceSeq: typeof req.body.sinceSeq === 'number' ? req.body.sinceSeq : null,
  note: req.body.note || null,
})));

router.get('/projects/:projectId/session', audited('director.session.get', async (req) => remoteSessionState(paramStr(req.params.projectId), req.userId, {
  sinceSeq: typeof req.query.sinceSeq === 'string' ? Number(req.query.sinceSeq) : null,
})));

router.get('/projects/:projectId/packet', audited('director.project.packet', async (req) => studio.buildProjectPacket(await fullProjectForUser(paramStr(req.params.projectId), req.userId))));

router.get('/projects/:projectId/actions', audited('director.project.actions', async (req) => studio.buildProjectActionList(await fullProjectForUser(paramStr(req.params.projectId), req.userId))));

router.get('/projects/:projectId/storyboard-status', audited('director.storyboard.status', async (req) => studio.buildStoryboardStatus(await fullProjectForUser(paramStr(req.params.projectId), req.userId))));

router.get('/projects/:projectId/shots/:shotId/packet', audited('director.shot.packet', async (req) => studio.buildShotPacket(await fullProjectForUser(paramStr(req.params.projectId), req.userId), paramStr(req.params.shotId))));

router.post('/apply/shot-prompts', audited('director.apply.shot_prompts', async (req) => studio.applyShotPrompts(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.shots,
  { force: !!req.body.force },
)));

router.post('/apply/storyboard-prompt', audited('director.apply.storyboard_prompt', async (req) => studio.applyStoryboardPrompt(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.shotId,
  req.body.storyboardPrompt,
  req.body.storyboardCutPlan || '',
  { baseHash: req.body.baseHash, force: !!req.body.force },
)));

router.post('/apply/storyboard-prompts-bulk', audited('director.apply.storyboard_prompts_bulk', async (req) => studio.applyStoryboardPromptsBulk(
  await fullProjectForUser(req.body.projectId, req.userId),
  { shots: req.body.shots, force: !!req.body.force },
)));

router.post('/apply/script', audited('director.apply.script', async (req) => studio.applyScript(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.script,
  { baseFingerprint: req.body.baseFingerprint, force: !!req.body.force },
)));

router.post('/apply/concept', audited('director.apply.concept', async (req) => studio.applyConcept(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.concept,
  { baseHash: req.body.baseHash, force: !!req.body.force },
)));

router.post('/apply/video-prompt', audited('director.apply.video_prompt', async (req) => studio.applyVideoPrompt(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.shotId,
  req.body.motionPrompt,
  { baseHash: req.body.baseHash, force: !!req.body.force },
)));

router.post('/apply/project-preferences', audited('director.apply.project_preferences', async (req) => studio.applyProjectPreferencesConfig(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.preferences,
  req.body.baseHash,
)));

router.post('/apply/project-prompt-override', audited('director.apply.project_prompt_override', async (req) => studio.applyProjectPromptOverrideConfig(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.kind,
  req.body.body,
  req.body.baseHash,
)));

router.post('/rollback/project-prompt-override', audited('director.rollback.project_prompt_override', async (req) => studio.revertProjectPromptOverrideConfig(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.kind,
  req.body.baseHash,
)));

router.post('/plan/generate-storyboard', audited('director.plan.generate_storyboard', async (req) => studio.planGenerateStoryboard(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.shotId,
)));

router.post('/plan/generate-video', audited('director.plan.generate_video', async (req) => studio.planGenerateVideo(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.shotId,
)));

router.post('/generate/storyboard', audited('director.generate.storyboard', async (req) => studio.applyGenerateStoryboard(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.shotId,
  req.body.artistNote,
)));

router.post('/generate/storyboards-bulk', audited('director.generate.storyboards_bulk', async (req) => studio.bulkGenerateStoryboards(
  await fullProjectForUser(req.body.projectId, req.userId),
  {
    shotIds: req.body.shotIds,
    force: !!req.body.force,
    artistNote: req.body.artistNote,
  },
)));

router.post('/generate/video', audited('director.generate.video', async (req) => studio.applyGenerateVideo(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.shotId,
  req.body.promptOverride,
)));

router.post('/refine/storyboard-image', audited('director.refine.storyboard_image', async (req) => studio.refineStoryboardImage(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.shotId,
  {
    feedback: req.body.feedback,
    previousVersionId: req.body.previousVersionId,
    artistReferenceImagePath: req.body.artistReferenceImagePath,
  },
)));

router.post('/storyboard/lock', audited('director.storyboard.lock', async (req) => studio.lockStoryboardBoard(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.shotId,
  req.body.versionId,
)));

router.post('/storyboard/unlock', audited('director.storyboard.unlock', async (req) => studio.unlockStoryboardBoard(
  await fullProjectForUser(req.body.projectId, req.userId),
  req.body.shotId,
)));

router.post('/issues/capture', audited('director.issues.capture', async (req) => {
  if (req.body.projectId) await assertProjectAccess(req.body.projectId, req.userId);
  return captureLahariIssue({
    projectId: req.body.projectId,
    severity: req.body.severity || 'mid',
    summary: req.body.summary,
    suggestedFix: req.body.suggestedFix,
    recentToolCalls: req.body.recentToolCalls,
  });
}));

export { router as directorRouter };
