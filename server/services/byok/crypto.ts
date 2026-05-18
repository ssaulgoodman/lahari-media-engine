import crypto from 'node:crypto';

const KEY_ENV = 'MIRAGE_ENCRYPTION_KEY';
const VERSION = 'v1';

const decodeKey = (): Buffer => {
  const raw = process.env[KEY_ENV];
  if (!raw) throw new Error(`${KEY_ENV} is required for Mirage BYOK encryption`);

  const base64 = Buffer.from(raw, 'base64');
  if (base64.length === 32) return base64;

  const utf8 = Buffer.from(raw, 'utf8');
  if (utf8.length === 32) return utf8;

  throw new Error(`${KEY_ENV} must decode to exactly 32 bytes`);
};

export const encryptKey = (plaintext: string): string => {
  const value = plaintext.trim();
  if (!value) throw new Error('API key value is required');

  const key = decodeKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
};

export const decryptKey = (ciphertext: string): string => {
  const [version, ivB64, tagB64, encryptedB64] = String(ciphertext || '').split('.');
  if (version !== VERSION || !ivB64 || !tagB64 || !encryptedB64) {
    throw new Error('Unsupported encrypted API key format');
  }

  const key = decodeKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
};
