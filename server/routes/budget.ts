import { Router } from 'express';
import { getSB, T } from '../database.js';

const router = Router();

const parseList = (value?: string) =>
  (value || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);

const isAllowedViewerEmail = (email: string | null | undefined) => {
  const normalized = (email || '').toLowerCase();
  const configured = parseList(process.env.DEV_BUDGET_VIEWER_EMAILS || process.env.DEV_BUDGET_ADMIN_EMAILS);
  if (configured.length === 0) return normalized === 'dev@companions.gg';
  return configured.includes(normalized);
};

const dayKey = (iso: string) => iso.slice(0, 10);

const weekKey = (iso: string) => {
  const date = new Date(iso);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

const addAgg = <T extends { calls: number; errors: number; cost: number; durationMs: number }>(
  map: Map<string, T>,
  key: string,
  call: any,
  seed: () => T,
) => {
  const next = map.get(key) || seed();
  next.calls += 1;
  next.errors += call.error ? 1 : 0;
  next.cost += Number(call.cost_estimate || 0);
  next.durationMs += Number(call.duration_ms || 0);
  map.set(key, next);
};

const sortByCost = <T extends { cost: number }>(rows: T[]) => rows.sort((a, b) => b.cost - a.cost);

const listAuthUsers = async () => {
  const sb = getSB();
  const users: any[] = [];
  for (let page = 1; page < 100; page += 1) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const batch = data.users || [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return users;
};

router.get('/dev', async (req, res) => {
  const viewerUserId = req.userId;
  if (!viewerUserId) return res.status(401).json({ error: 'Auth required' });

  try {
    const sb = getSB();
    const { data: authUser, error: userError } = await sb.auth.admin.getUserById(viewerUserId);
    if (userError) throw new Error(userError.message);
    const viewerEmail = authUser.user?.email || null;
    if (!isAllowedViewerEmail(viewerEmail)) {
      return res.status(403).json({ error: 'Budget dashboard viewer is not allowlisted.', viewerEmail });
    }

    const authUsers = await listAuthUsers();
    const userById = new Map(authUsers.map((user) => [user.id, user]));
    const accountParam = String(req.query.account || 'all');
    let selectedUserId: string | null = null;
    if (accountParam !== 'all') {
      const normalizedAccount = accountParam.toLowerCase();
      const matched = authUsers.find((user) => user.id === accountParam || (user.email || '').toLowerCase() === normalizedAccount);
      if (!matched) return res.status(400).json({ error: `Unknown budget account: ${accountParam}` });
      selectedUserId = matched.id;
    }

    const rawDays = String(req.query.days || '30');
    const days = rawDays === 'all' ? null : Math.min(Math.max(parseInt(rawDays, 10) || 30, 1), 365);
    const sinceIso = days ? new Date(Date.now() - days * 86400000).toISOString() : null;

    const { data: projects, error: projectError } = await sb
      .from(T.projects)
      .select('id,user_id,title,song_type,source_queue_id,created_at,cost_estimate');
    if (projectError) throw new Error(projectError.message);

    const allProjectRows = (projects || []) as any[];
    const projectRows = selectedUserId ? allProjectRows.filter(p => p.user_id === selectedUserId) : allProjectRows;
    const allProjectIds = allProjectRows.map(p => p.id).filter(Boolean);
    const projectById = new Map(allProjectRows.map(p => [p.id, p]));
    const queueIds = [...new Set(allProjectRows.map(p => p.source_queue_id).filter(Boolean))];

    const queueSongById = new Map<string, any>();
    if (queueIds.length > 0) {
      const { data: queueRows, error: queueError } = await sb
        .from('music_video_queue')
        .select('id,song_id,songs(song_name,isrc,album,deity,original_language,duration_seconds)')
        .in('id', queueIds);
      if (queueError) throw new Error(queueError.message);
      for (const row of (queueRows as any[]) || []) queueSongById.set(row.id, row.songs || {});
    }

    const allCalls: any[] = [];
    if (allProjectIds.length > 0) {
      for (let from = 0; from < 20000; from += 1000) {
        let query = sb
          .from(T.ai_calls)
          .select('project_id,stage,model,cost_estimate,duration_ms,error,created_at')
          .in('project_id', allProjectIds)
          .order('created_at', { ascending: false })
          .range(from, from + 999);
        if (sinceIso) query = query.gte('created_at', sinceIso);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        const batch = (data || []) as any[];
        allCalls.push(...batch);
        if (batch.length < 1000) break;
      }
    }
    const calls = selectedUserId
      ? allCalls.filter(call => projectById.get(call.project_id)?.user_id === selectedUserId)
      : allCalls;

    const totals = {
      cost: 0,
      calls: calls.length,
      errors: 0,
      durationMs: 0,
      projects: projectRows.length,
      songs: new Set(projectRows.map(p => p.source_queue_id || p.id)).size,
    };
    const byDay = new Map<string, any>();
    const byWeek = new Map<string, any>();
    const byModel = new Map<string, any>();
    const byStage = new Map<string, any>();
    const bySongType = new Map<string, any>();
    const bySong = new Map<string, any>();
    const byAccount = new Map<string, any>();
    const accountProjects = new Map<string, Set<string>>();
    const accountSongs = new Map<string, Set<string>>();

    for (const project of allProjectRows) {
      const userId = project.user_id || 'unknown';
      if (!accountProjects.has(userId)) accountProjects.set(userId, new Set());
      if (!accountSongs.has(userId)) accountSongs.set(userId, new Set());
      accountProjects.get(userId)!.add(project.id);
      accountSongs.get(userId)!.add(project.source_queue_id || project.id);
      if (!byAccount.has(userId)) {
        const accountUser = userById.get(userId);
        byAccount.set(userId, {
          userId,
          email: accountUser?.email || userId,
          calls: 0,
          errors: 0,
          cost: 0,
          durationMs: 0,
          projects: 0,
          songs: 0,
        });
      }
    }

    for (const call of allCalls) {
      const project = projectById.get(call.project_id) || {};
      const accountUserId = project.user_id || 'unknown';
      const accountUser = userById.get(accountUserId);
      addAgg(byAccount, accountUserId, call, () => ({
        userId: accountUserId,
        email: accountUser?.email || accountUserId,
        calls: 0,
        errors: 0,
        cost: 0,
        durationMs: 0,
        projects: 0,
        songs: 0,
      }));
    }

    for (const call of calls) {
      const project = projectById.get(call.project_id) || {};
      const accountUserId = project.user_id || 'unknown';
      const accountUser = userById.get(accountUserId);
      const song = project.source_queue_id ? queueSongById.get(project.source_queue_id) : null;
      const songName = song?.song_name || project.title || 'Untitled';
      const songType = project.song_type || 'unknown';
      const cost = Number(call.cost_estimate || 0);
      totals.cost += cost;
      totals.errors += call.error ? 1 : 0;
      totals.durationMs += Number(call.duration_ms || 0);

      addAgg(byDay, dayKey(call.created_at), call, () => ({ date: dayKey(call.created_at), calls: 0, errors: 0, cost: 0, durationMs: 0 }));
      addAgg(byWeek, weekKey(call.created_at), call, () => ({ week: weekKey(call.created_at), calls: 0, errors: 0, cost: 0, durationMs: 0 }));
      addAgg(byModel, call.model || 'unknown', call, () => ({ model: call.model || 'unknown', calls: 0, errors: 0, cost: 0, durationMs: 0 }));
      addAgg(byStage, call.stage || 'unknown', call, () => ({ stage: call.stage || 'unknown', calls: 0, errors: 0, cost: 0, durationMs: 0 }));
      addAgg(bySongType, songType, call, () => ({ songType, calls: 0, errors: 0, cost: 0, durationMs: 0 }));
      addAgg(bySong, call.project_id, call, () => ({
        projectId: call.project_id,
        userId: accountUserId,
        accountEmail: accountUser?.email || accountUserId,
        title: songName,
        isrc: song?.isrc || null,
        album: song?.album || null,
        deity: song?.deity || null,
        songType,
        calls: 0,
        errors: 0,
        cost: 0,
        durationMs: 0,
      }));
    }

    for (const [userId, row] of byAccount) {
      row.projects = accountProjects.get(userId)?.size || 0;
      row.songs = accountSongs.get(userId)?.size || 0;
    }

    const accounts = sortByCost([...byAccount.values()]);
    const selectedUser = selectedUserId ? userById.get(selectedUserId) : null;

    res.json({
      account: {
        selectedUserId,
        selectedEmail: selectedUser?.email || null,
        accounts: accounts.map(({ userId, email, cost, calls, projects, songs }) => ({ userId, email, cost, calls, projects, songs })),
        viewerEmail,
      },
      window: { days: days || 'all', sinceIso, generatedAt: new Date().toISOString() },
      totals,
      daily: [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date)),
      weekly: [...byWeek.values()].sort((a, b) => b.week.localeCompare(a.week)),
      byModel: sortByCost([...byModel.values()]),
      byStage: sortByCost([...byStage.values()]),
      bySongType: sortByCost([...bySongType.values()]),
      byAccount: accounts,
      bySong: sortByCost([...bySong.values()]),
      note: 'Estimated app spend from lahari_ai_calls.cost_estimate, not the provider invoice.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as budgetRouter };
