import db from './database';
import { randomBytes } from 'node:crypto';
import { encryptSecret as encrypt, decryptSecret as decrypt } from './secret-crypto';
import { Session } from './types';
export async function createSession(
  user: { id: number; login: string; avatar_url: string },
  token: string,
) {
  const id = randomBytes(32).toString('hex'),
    expires = Date.now() + 7 * 86400000;
  await db.batch([
    {
      text: 'INSERT OR REPLACE INTO users VALUES (?,?,?)',
      values: [String(user.id), user.login, user.avatar_url],
    },
    {
      text: 'INSERT OR REPLACE INTO connections VALUES (?,?)',
      values: [String(user.id), encrypt(token)],
    },
    { text: 'INSERT INTO sessions VALUES (?,?,?)', values: [id, String(user.id), expires] },
  ]);
  return id;
}
export async function getSession(id: string): Promise<Session | null> {
  if (!id) return null;
  const row = (await db
    .prepare(
      'SELECT s.id,s.user_id as userId,s.expires,u.login,u.avatar,c.token FROM sessions s JOIN users u ON u.id=s.user_id JOIN connections c ON c.user_id=u.id WHERE s.id=? AND s.expires>?',
    )
    .get(id, Date.now())) as Session | undefined;
  return row ? { ...row, token: decrypt(row.token) } : null;
}
export async function deleteSession(id: string) {
  await db.prepare('DELETE FROM sessions WHERE id=?').run(id);
}
export default db;
