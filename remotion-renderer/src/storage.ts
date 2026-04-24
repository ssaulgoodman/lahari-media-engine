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
    throw new Error(
      `Supabase upload failed (${buf.byteLength} bytes): ${JSON.stringify(error)}`,
    );
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return { path: key, publicUrl: data.publicUrl, sizeBytes: buf.byteLength };
};
