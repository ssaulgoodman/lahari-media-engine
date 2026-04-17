import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'lahari-assets';

let _sb: SupabaseClient | null = null;
const getSB = (): SupabaseClient => {
  if (!_sb) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL + SUPABASE_SERVICE_KEY required');
    _sb = createClient(url, key);
  }
  return _sb;
};

const MIME_MAP: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

export const mimeFromExt = (filePath: string): string => {
  return MIME_MAP[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
};

/**
 * Upload a buffer to Supabase Storage. Returns the storage key
 * (e.g. "images/abc123.png") — same shape as the old local path.
 */
export const saveBuffer = async (
  buffer: Buffer,
  category: 'audio' | 'images' | 'videos',
  ext: string
): Promise<string> => {
  const filename = `${uuidv4()}.${ext}`;
  const key = `${category}/${filename}`;
  const contentType = mimeFromExt(`.${ext}`);
  const { error } = await getSB().storage
    .from(BUCKET)
    .upload(key, buffer, { contentType, upsert: false });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return key;
};

/**
 * Upload base64 data to Supabase Storage. Returns storage key.
 */
export const saveBase64 = async (
  base64Data: string,
  category: 'audio' | 'images' | 'videos',
  ext: string
): Promise<string> => {
  const buffer = Buffer.from(base64Data, 'base64');
  return saveBuffer(buffer, category, ext);
};

/**
 * Construct the public URL for a storage key. Used in API responses
 * so the frontend can render images/videos directly.
 */
export const storageUrl = (key: string): string => {
  const { data } = getSB().storage.from(BUCKET).getPublicUrl(key);
  return data.publicUrl;
};

// Local /tmp cache so we don't re-download the same ref image for every
// shot in a bulk generation run. TTL is "until the process restarts".
const _cache = new Map<string, string>();

/**
 * Download a file from Supabase Storage and return it as base64.
 * Caches to /tmp so repeated reads of the same key within a session
 * don't incur network round-trips (critical for bulk frame gen where
 * the same character/style ref is read once per shot).
 */
export const readAsBase64 = async (key: string): Promise<string> => {
  const cached = _cache.get(key);
  if (cached && fs.existsSync(cached)) {
    return fs.readFileSync(cached).toString('base64');
  }

  const { data, error } = await getSB().storage.from(BUCKET).download(key);
  if (error || !data) throw new Error(`Storage download failed (${key}): ${error?.message || 'no data'}`);
  const buffer = Buffer.from(await data.arrayBuffer());

  // Cache to /tmp for fast re-reads
  const tmpPath = path.join(os.tmpdir(), 'lahari-cache', key.replace(/\//g, '_'));
  fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
  fs.writeFileSync(tmpPath, buffer);
  _cache.set(key, tmpPath);

  return buffer.toString('base64');
};

/**
 * Download a file from Supabase Storage to a local /tmp path.
 * Used by ffmpeg (extractLastFrame) and fal.ai (uploadImage) which
 * need an actual file on disk.
 */
export const downloadToTmp = async (key: string): Promise<string> => {
  const cached = _cache.get(key);
  if (cached && fs.existsSync(cached)) return cached;

  const { data, error } = await getSB().storage.from(BUCKET).download(key);
  if (error || !data) throw new Error(`Storage download failed (${key}): ${error?.message || 'no data'}`);
  const buffer = Buffer.from(await data.arrayBuffer());

  const tmpPath = path.join(os.tmpdir(), 'lahari-cache', key.replace(/\//g, '_'));
  fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
  fs.writeFileSync(tmpPath, buffer);
  _cache.set(key, tmpPath);

  return tmpPath;
};

/**
 * Upload a local /tmp file to Supabase Storage. Returns the storage key.
 * Used after ffmpeg generates an output in /tmp.
 */
export const uploadFromTmp = async (
  localPath: string,
  category: 'audio' | 'images' | 'videos',
  ext: string
): Promise<string> => {
  const buffer = fs.readFileSync(localPath);
  return saveBuffer(buffer, category, ext);
};

/**
 * Delete a file from Supabase Storage.
 */
export const deleteFile = async (key: string): Promise<void> => {
  await getSB().storage.from(BUCKET).remove([key]);
  _cache.delete(key);
};

/**
 * Get absolute path — downloads to /tmp first. Needed for code that
 * expects a local file path (ffmpeg, fal upload).
 */
export const getAbsPath = async (key: string): Promise<string> => {
  return downloadToTmp(key);
};

// Legacy export — callers that used path.join(STORAGE_ROOT_PATH, relPath)
// should now use downloadToTmp(key) instead. Kept for grep-ability during
// migration; points to /tmp so it doesn't crash but won't have files in it.
export const STORAGE_ROOT_PATH = path.join(os.tmpdir(), 'lahari-cache');
