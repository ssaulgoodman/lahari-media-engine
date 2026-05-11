/**
 * Supabase client — reads from the shared song catalog and manages
 * the music_video_queue table. Does NOT modify existing echo tables.
 */
import { createClient } from '@supabase/supabase-js';

const getClient = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY required in .env');
  return createClient(url, key);
};

// ─── Queue ──────────────────────────────────────────────────────────

export interface QueueItem {
  id: string;
  song_id: string;
  priority: number;
  status: string;
  lahari_project_id: string | null;
  video_url: string | null;
  notes: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  // Joined from songs
  song_name?: string;
  deity?: string;
  original_language?: string;
  duration_seconds?: number;
  isrc?: string;
  album?: string;
  audio_uploaded?: boolean;
  audio_url?: string | null;
  srts_ready?: boolean;
  render_count?: number;
  // Per-user fork stats — computed when `currentUserId` is passed to listQueue.
  others_done?: number;          // Other users who have published a render for this queue row.
  others_wip?: number;           // Other users with an in-progress fork.
  has_active_fork?: boolean;     // Current user has a fork that isn't `completed`.
  has_done_fork?: boolean;       // Current user has a fork that is `completed`.
}

export const listQueue = async (filters?: {
  status?: string;
  deity?: string;
  search?: string;
  currentUserId?: string;
}): Promise<QueueItem[]> => {
  const supabase = getClient();

  let query = supabase
    .from('music_video_queue')
    .select(`
      *,
      songs!inner (
        song_name, deity, original_language, duration_seconds,
        isrc, album, audio_uploaded, srts_ready,
        audio_storage_url, drive_audio_url
      )
    `)
    .order('priority', { ascending: true });

  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  }
  if (filters?.deity) {
    query = query.eq('songs.deity', filters.deity);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Supabase error: ${error.message}`);

  // One extra round-trip: count final_render assets for every linked project
  // so the queue table can show/hide a "Renders (N)" button without per-row
  // requests. Single IN-list query, aggregated client-side.
  const projectIds = (data || [])
    .map((r: any) => r.lahari_project_id)
    .filter((id: string | null): id is string => !!id);
  const renderCounts = new Map<string, number>();
  if (projectIds.length > 0) {
    const { data: assetRows, error: aErr } = await supabase
      .from('lahari_assets')
      .select('project_id')
      .eq('category', 'final_render')
      .in('project_id', projectIds);
    if (aErr) throw new Error(`Supabase error: ${aErr.message}`);
    for (const a of (assetRows as any[]) || []) {
      renderCounts.set(a.project_id, (renderCounts.get(a.project_id) || 0) + 1);
    }
  }

  // Second aggregation: per-queue-row fork stats, partitioned by current user
  // vs everyone else. Powers the action button (Start/Continue/Open) and the
  // "Others" dots. Single query, ~one row per fork — small even at scale.
  const queueIds = (data || []).map((r: any) => r.id);
  const forkStats = new Map<string, {
    othersDone: number;
    othersWip: number;
    hasActiveFork: boolean;
    hasDoneFork: boolean;
  }>();
  if (queueIds.length > 0 && filters?.currentUserId) {
    const { data: projectRows, error: pErr } = await supabase
      .from('lahari_projects')
      .select('source_queue_id, user_id, status')
      .in('source_queue_id', queueIds);
    if (pErr) throw new Error(`Supabase error: ${pErr.message}`);
    for (const p of (projectRows as any[]) || []) {
      const qid = p.source_queue_id as string;
      if (!qid) continue;
      const isCurrent = p.user_id === filters.currentUserId;
      const isDone = p.status === 'completed';
      const slot = forkStats.get(qid) || { othersDone: 0, othersWip: 0, hasActiveFork: false, hasDoneFork: false };
      if (isCurrent) {
        if (isDone) slot.hasDoneFork = true;
        else slot.hasActiveFork = true;
      } else {
        if (isDone) slot.othersDone++;
        else slot.othersWip++;
      }
      forkStats.set(qid, slot);
    }
  }

  // Flatten the join
  return (data || []).map((row: any) => {
    const stats = forkStats.get(row.id);
    return {
      ...row,
      song_name: row.songs?.song_name,
      deity: row.songs?.deity,
      original_language: row.songs?.original_language,
      duration_seconds: row.songs?.duration_seconds,
      isrc: row.songs?.isrc,
      album: row.songs?.album,
      audio_uploaded: !!(row.songs?.audio_storage_url || row.songs?.drive_audio_url),
      audio_url: row.songs?.audio_storage_url || row.songs?.drive_audio_url || null,
      srts_ready: row.songs?.srts_ready,
      render_count: row.lahari_project_id ? (renderCounts.get(row.lahari_project_id) || 0) : 0,
      others_done: stats?.othersDone ?? 0,
      others_wip: stats?.othersWip ?? 0,
      has_active_fork: stats?.hasActiveFork ?? false,
      has_done_fork: stats?.hasDoneFork ?? false,
      songs: undefined,
    };
  });
};

export const updateQueueItem = async (
  id: string,
  updates: Partial<Pick<QueueItem, 'status' | 'lahari_project_id' | 'video_url' | 'notes' | 'assigned_to'>>
) => {
  const supabase = getClient();
  const { error } = await supabase
    .from('music_video_queue')
    .update(updates)
    .eq('id', id);
  if (error) throw new Error(`Supabase error: ${error.message}`);
};

/**
 * Find the queue row that started any project in the given id list — used
 * when marking a project complete: we walk up the fork chain locally, then
 * ask Supabase which queue row owns any project in that lineage.
 */
export const findQueueByProjectIds = async (projectIds: string[]): Promise<QueueItem | null> => {
  if (projectIds.length === 0) return null;
  const supabase = getClient();
  const { data, error } = await supabase
    .from('music_video_queue')
    .select('*')
    .in('lahari_project_id', projectIds)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Supabase error: ${error.message}`);
  return (data as any) || null;
};

// ─── Song Files ─────────────────────────────────────────────────────

export const getSongFiles = async (songId: string) => {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('files')
    .select('*')
    .eq('song_id', songId);
  if (error) throw new Error(`Supabase error: ${error.message}`);
  return data || [];
};

// ─── Deities (for filter dropdown) ──────────────────────────────────

export const getDeities = async (): Promise<string[]> => {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('music_video_queue')
    .select('songs!inner(deity)')
    .order('priority');
  if (error) throw new Error(`Supabase error: ${error.message}`);
  const deities = [...new Set((data || []).map((r: any) => r.songs?.deity).filter(Boolean))];
  return deities.sort();
};

// ─── Download file from storage URL ─────────────────────────────────

export const downloadFile = async (storageUrl: string): Promise<Buffer> => {
  const res = await fetch(storageUrl);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};
