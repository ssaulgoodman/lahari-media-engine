import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET ?? 'lahari-assets';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

export interface UploadResult {
  path: string;
  publicUrl: string;
  sizeBytes: number;
}

// Uploads the rendered mp4 to Supabase Storage. Path layout matches the main
// app's convention: `videos/<projectId>/<timestamp>.mp4`. Same bucket the rest
// of the project's assets live in, so the existing public-URL plumbing works.
export const uploadRender = async (
  localPath: string,
  projectId: string,
): Promise<UploadResult> => {
  const buf = await readFile(localPath);
  const key = `videos/${projectId}/${Date.now()}-${path.basename(localPath)}`;

  const { error } = await supabase.storage.from(BUCKET).upload(key, buf, {
    contentType: 'video/mp4',
    upsert: false,
  });
  if (error) {
    console.error('[storage] upload failed', { key, sizeBytes: buf.byteLength, error });
    const status = String((error as any).statusCode || (error as any).status || '');
    const message = String((error as any).message || '');
    if (status === '413' || /maximum allowed size|exceeded/i.test(message)) {
      throw new Error(
        `Render output too large for Supabase Storage (${buf.byteLength} bytes). ` +
        `The renderer tried to upload past the configured object-size limit.`,
      );
    }
    throw new Error(
      `Supabase upload failed (${buf.byteLength} bytes): ${JSON.stringify(error)}`,
    );
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return { path: key, publicUrl: data.publicUrl, sizeBytes: buf.byteLength };
};

export const projectExists = async (projectId: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from('lahari_projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`Project precheck failed: ${error.message}`);
  return !!data;
};

export const writeTerminalFallback = async (
  renderId: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  const now = new Date().toISOString();
  const isError = typeof payload.error === 'string' && payload.error.length > 0;
  const updates: Record<string, unknown> = {
    status: isError ? 'failed' : 'pending_finalize',
    video_url: typeof payload.videoUrl === 'string' ? payload.videoUrl : null,
    storage_path: typeof payload.storagePath === 'string' ? payload.storagePath : null,
    render_ms: typeof payload.renderMs === 'number' ? payload.renderMs : null,
    render_engine: typeof payload.renderEngine === 'string' ? payload.renderEngine.slice(0, 40) : null,
    ffmpeg_fallback_reason: typeof payload.ffmpegFallbackReason === 'string' ? payload.ffmpegFallbackReason.slice(0, 500) : null,
    error: isError ? String(payload.error).slice(0, 2000) : null,
    error_code: isError
      ? typeof payload.errorCode === 'string' ? payload.errorCode.slice(0, 80) : 'renderer_failed'
      : null,
    stage: isError ? 'failed' : 'callback_pending',
    terminal_payload: payload,
    terminal_at: now,
    last_heartbeat_at: now,
    updated_at: now,
  };
  if (!isError) updates.progress = 1;

  const { error } = await supabase
    .from('lahari_renders')
    .update(updates)
    .eq('id', renderId)
    .in('status', ['rendering', 'pending_finalize']);
  if (error) throw new Error(`Terminal fallback write failed: ${error.message}`);
};
