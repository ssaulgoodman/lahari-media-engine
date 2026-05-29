import { getSB, T, usesLegacyQueueAdapter } from '../../database.js';
import { listQueue, type QueueItem } from '../supabase.js';
import { webStudioUrl } from './core.js';

const appBaseUrl = () => (
  process.env.MIRAGE_STUDIO_URL
  || process.env.LAHARI_STUDIO_URL
  || process.env.APP_URL
  || process.env.PUBLIC_APP_URL
  || 'https://mirage-platform-production-05ca.up.railway.app'
).replace(/\/+$/, '');

const clampLimit = (limit?: number, fallback = 20, max = 100) => {
  const parsed = Number(limit || fallback);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), max) : fallback;
};

const normalize = (value: unknown) => String(value || '').trim().toLowerCase();

const includesQuery = (value: unknown, query: string) => normalize(value).includes(query);

const formatDuration = (seconds?: number | null) => {
  const total = Number(seconds || 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  const mins = Math.floor(total / 60);
  const secs = Math.round(total % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

type UserProjectRow = {
  id: string;
  title: string | null;
  status: string | null;
  source_queue_id: string | null;
  updated_at?: string | null;
};

const loadUserProjectsByQueue = async (userId: string, queueIds: string[]) => {
  const byQueue = new Map<string, UserProjectRow>();
  if (!queueIds.length) return byQueue;
  const { data, error } = await getSB()
    .from(T.projects)
    .select('id,title,status,source_queue_id,updated_at')
    .eq('user_id', userId)
    .in('source_queue_id', queueIds)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`DB queue project lookup: ${error.message}`);
  for (const row of (data as UserProjectRow[]) || []) {
    if (!row.source_queue_id) continue;
    const existing = byQueue.get(row.source_queue_id);
    if (!existing || existing.status === 'completed') byQueue.set(row.source_queue_id, row);
  }
  return byQueue;
};

const queueNextAction = (item: QueueItem, project?: UserProjectRow | null) => {
  if (project) {
    return {
      kind: 'attach_project',
      label: 'Attach to this project',
      projectId: project.id,
      webUrl: webStudioUrl(project.id, { step: project.status === 'completed' ? 'render' : 'blueprint' }),
    };
  }
  if (!item.audio_uploaded) {
    return {
      kind: 'missing_audio',
      label: 'Audio is not uploaded yet',
      webUrl: `${appBaseUrl()}/`,
    };
  }
  return {
    kind: 'start_from_queue',
    label: 'Start this queue item in the web studio',
    queueId: item.id,
    webUrl: `${appBaseUrl()}/`,
  };
};

const normalizeQueueItem = (item: QueueItem, project?: UserProjectRow | null) => ({
  type: 'queue_item',
  queueId: item.id,
  songId: item.song_id,
  title: item.song_name || 'Untitled',
  userNote: item.user_note || null,
  deity: item.deity || null,
  originalLanguage: item.original_language || null,
  durationSeconds: item.duration_seconds || null,
  duration: formatDuration(item.duration_seconds),
  queueStatus: item.status || null,
  priority: item.priority ?? null,
  audioUploaded: !!item.audio_uploaded,
  srtsReady: !!item.srts_ready,
  currentUserProjectId: project?.id || null,
  currentUserProjectStatus: project?.status || null,
  linkedProjectId: item.lahari_project_id || null,
  hasActiveFork: !!item.has_active_fork,
  hasDoneFork: !!item.has_done_fork,
  othersDone: item.others_done || 0,
  othersWip: item.others_wip || 0,
  renderCount: item.render_count || 0,
  updatedAt: item.updated_at,
  nextAction: queueNextAction(item, project),
});

const normalizeProjectMatch = (project: UserProjectRow) => ({
  type: 'project',
  projectId: project.id,
  title: project.title || 'Untitled',
  status: project.status || null,
  sourceQueueId: project.source_queue_id || null,
  updatedAt: project.updated_at || null,
  webUrl: webStudioUrl(project.id, { step: project.status === 'completed' ? 'render' : 'blueprint' }),
  nextAction: {
    kind: 'attach_project',
    label: 'Attach to this project',
    projectId: project.id,
    webUrl: webStudioUrl(project.id, { step: project.status === 'completed' ? 'render' : 'blueprint' }),
  },
});

export const listQueueForDirector = async (userId: string, opts: { status?: string; query?: string; limit?: number } = {}) => {
  const limit = clampLimit(opts.limit);
  if (!usesLegacyQueueAdapter()) {
    return {
      kind: 'mirage.queue.list',
      generatedAt: new Date().toISOString(),
      limit,
      query: opts.query || null,
      status: opts.status || 'all',
      message: 'Legacy music queue is disabled for this studio workspace. Use direct project intake or search projects by title.',
      items: [],
    };
  }
  const query = normalize(opts.query);
  let rows: QueueItem[] = [];
  try {
    rows = await listQueue({ status: opts.status || 'all', currentUserId: userId });
  } catch (error) {
    console.warn('[mirage] legacy queue lookup unavailable', error);
    return {
      kind: 'mirage.queue.list',
      generatedAt: new Date().toISOString(),
      limit,
      query: opts.query || null,
      status: opts.status || 'all',
      message: 'Legacy music queue lookup is unavailable in this workspace. Use direct project intake or search projects by title.',
      items: [],
    };
  }
  const filtered = query
    ? rows.filter((item) => includesQuery(item.song_name, query)
      || includesQuery(item.user_note, query)
      || includesQuery(item.deity, query)
      || includesQuery(item.original_language, query))
    : rows;
  const sliced = filtered.slice(0, limit);
  const projectsByQueue = await loadUserProjectsByQueue(userId, sliced.map((item) => item.id));
  return {
    kind: 'mirage.queue.list',
    generatedAt: new Date().toISOString(),
    limit,
    query: opts.query || null,
    status: opts.status || 'all',
    items: sliced.map((item) => normalizeQueueItem(item, projectsByQueue.get(item.id))),
  };
};

export const searchCatalogForDirector = async (userId: string, query: string, opts: { limit?: number } = {}) => {
  const clean = String(query || '').trim();
  if (!clean) throw new Error('query is required');
  const limit = clampLimit(opts.limit, 20, 50);
  const pattern = `%${clean.replace(/[%_]/g, '\\$&')}%`;
  const { data: projects, error } = await getSB()
    .from(T.projects)
    .select('id,title,status,source_queue_id,updated_at')
    .eq('user_id', userId)
    .ilike('title', pattern)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`DB project search: ${error.message}`);

  const queue = usesLegacyQueueAdapter()
    ? await listQueueForDirector(userId, { query: clean, limit })
    : { items: [] as any[] };
  const projectMatches = ((projects as UserProjectRow[]) || []).map(normalizeProjectMatch);
  const queueMatches = queue.items.filter((item: any) => !projectMatches.some((project: any) => project.sourceQueueId && project.sourceQueueId === item.queueId));
  return {
    kind: 'mirage.catalog.search',
    generatedAt: new Date().toISOString(),
    query: clean,
    matches: [...projectMatches, ...queueMatches].slice(0, limit),
  };
};

export const resolveProjectForDirector = async (userId: string, query: string) => {
  const clean = String(query || '').trim();
  if (!clean) throw new Error('query is required');

  const { data: exactProject } = await getSB()
    .from(T.projects)
    .select('id,title,status,source_queue_id,updated_at,user_id')
    .eq('id', clean)
    .limit(1)
    .maybeSingle();
  if (exactProject && exactProject.user_id !== userId) {
    return {
      kind: 'mirage.project.resolve',
      query: clean,
      status: 'not_owned_by_this_account',
      message: 'A project with this ID exists, but it is not owned by the authenticated Mirage account.',
      matches: [],
    };
  }
  if (exactProject) {
    const project = normalizeProjectMatch(exactProject as UserProjectRow);
    return {
      kind: 'mirage.project.resolve',
      query: clean,
      status: 'project_found',
      project,
      nextAction: project.nextAction,
      matches: [project],
    };
  }

  const search = await searchCatalogForDirector(userId, clean, { limit: 10 });
  const attachable = search.matches.filter((match: any) => match.type === 'project' || match.currentUserProjectId);
  if (attachable.length === 1) {
    const match: any = attachable[0];
    const projectId = match.type === 'project' ? match.projectId : match.currentUserProjectId;
    return {
      kind: 'mirage.project.resolve',
      query: clean,
      status: 'project_found',
      projectId,
      match,
      nextAction: {
        kind: 'attach_project',
        label: 'Attach to this project',
        projectId,
        webUrl: webStudioUrl(projectId, { step: match.currentUserProjectStatus === 'completed' || match.status === 'completed' ? 'render' : 'blueprint' }),
      },
      matches: search.matches,
    };
  }
  if (search.matches.length === 1) {
    const match: any = search.matches[0];
    return {
      kind: 'mirage.project.resolve',
      query: clean,
      status: match.type === 'queue_item' ? 'queue_item_found_not_started' : 'project_found',
      match,
      nextAction: match.nextAction,
      matches: search.matches,
    };
  }
  return {
    kind: 'mirage.project.resolve',
    query: clean,
    status: search.matches.length ? 'multiple_matches' : 'not_found',
    matches: search.matches,
    nextAction: search.matches.length ? {
      kind: 'choose_match',
      label: 'Ask the artist which match to open',
    } : {
      kind: 'not_found',
      label: 'No matching project or queue item was found for this account.',
    },
  };
};
