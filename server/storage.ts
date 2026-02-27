import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_ROOT = path.join(__dirname, '..', 'storage');

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

// Ensure all storage directories exist
['audio', 'images', 'videos'].forEach(d => ensureDir(path.join(STORAGE_ROOT, d)));

/**
 * Save a buffer to storage. Returns the relative path (e.g. "images/abc123.png").
 */
export const saveBuffer = (buffer: Buffer, category: 'audio' | 'images' | 'videos', ext: string): string => {
  const filename = `${uuidv4()}.${ext}`;
  const relPath = path.join(category, filename);
  const absPath = path.join(STORAGE_ROOT, relPath);
  fs.writeFileSync(absPath, buffer);
  return relPath;
};

/**
 * Save base64 data to storage. Returns relative path.
 */
export const saveBase64 = (base64Data: string, category: 'audio' | 'images' | 'videos', ext: string): string => {
  const buffer = Buffer.from(base64Data, 'base64');
  return saveBuffer(buffer, category, ext);
};

/**
 * Get absolute path from relative storage path.
 */
export const getAbsPath = (relPath: string): string => {
  return path.join(STORAGE_ROOT, relPath);
};

/**
 * Read file as base64. Used for sending to AI APIs.
 */
export const readAsBase64 = (relPath: string): string => {
  const absPath = path.join(STORAGE_ROOT, relPath);
  return fs.readFileSync(absPath).toString('base64');
};

/**
 * Delete a file from storage.
 */
export const deleteFile = (relPath: string): void => {
  const absPath = path.join(STORAGE_ROOT, relPath);
  if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
};

/**
 * Get the MIME type from a file extension.
 */
export const mimeFromExt = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  };
  return map[ext] || 'application/octet-stream';
};

export const STORAGE_ROOT_PATH = STORAGE_ROOT;
