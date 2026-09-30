import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
function key() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw new Error('Server encryption is not configured.');
  return createHash('sha256').update(process.env.SESSION_SECRET).digest();
}
export function encryptSecret(value: string, context = '') {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  if (context) cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function decryptSecret(value: string, context = '') {
  const bytes = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  if (context) decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}
