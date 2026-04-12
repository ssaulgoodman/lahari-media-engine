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
  srts_ready?: boolean;
}

export const listQueue = async (filters?: {
  status?: string;
  deity?: string;
  search?: string;
}): Promise<QueueItem[]> => {
  const supabase = getClient();

  let query = supabase
    .from('music_video_queue')
    .select(`
      *,
      songs!inner (
        song_name, deity, original_language, duration_seconds,
        isrc, album, audio_uploaded, srts_ready
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

  // Flatten the join
  return (data || []).map((row: any) => ({
    ...row,
    song_name: row.songs?.song_name,
    deity: row.songs?.deity,
    original_language: row.songs?.original_language,
    duration_seconds: row.songs?.duration_seconds,
    isrc: row.songs?.isrc,
    album: row.songs?.album,
    audio_uploaded: row.songs?.audio_uploaded,
    srts_ready: row.songs?.srts_ready,
    songs: undefined,
  }));
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
