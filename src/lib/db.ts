import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { Session } from './types';
const directory = process.env.DATA_DIR || join(process.cwd(), '.data');
mkdirSync(directory, { recursive: true });
const db = new Database(join(directory, 'roulette.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, login TEXT NOT NULL, avatar TEXT);
CREATE TABLE IF NOT EXISTS connections (user_id TEXT PRIMARY KEY REFERENCES users(id), token TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS repositories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, head_sha TEXT, data TEXT NOT NULL, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS readmes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, repo TEXT NOT NULL, markdown TEXT NOT NULL, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS readme_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, repo TEXT NOT NULL, markdown TEXT NOT NULL, created_at INTEGER);
CREATE TABLE IF NOT EXISTS screenshot_tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, repo TEXT NOT NULL, completed INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS portfolio_descriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS repository_scores (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, score INTEGER NOT NULL, criteria TEXT NOT NULL);`);
function key() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw new Error('SESSION_SECRET must contain at least 32 characters.');
  return createHash('sha256').update(process.env.SESSION_SECRET).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
function decrypt(value: string) {
  const b = Buffer.from(value, 'base64'),
    decipher = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  decipher.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString('utf8');
}
export function createSession(
  user: { id: number; login: string; avatar_url: string },
  token: string,
) {
  const id = randomBytes(32).toString('hex'),
    expires = Date.now() + 7 * 86400000;
  db.transaction(() => {
    db.prepare('INSERT OR REPLACE INTO users VALUES (?,?,?)').run(
      String(user.id),
      user.login,
      user.avatar_url,
    );
    db.prepare('INSERT OR REPLACE INTO connections VALUES (?,?)').run(
      String(user.id),
      encrypt(token),
    );
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(id, String(user.id), expires);
  })();
  return id;
}
export function getSession(id: string): Session | null {
  const row = db
    .prepare(
      'SELECT s.id,s.user_id as userId,s.expires,u.login,u.avatar,c.token FROM sessions s JOIN users u ON u.id=s.user_id JOIN connections c ON c.user_id=u.id WHERE s.id=? AND s.expires>?',
    )
    .get(id, Date.now()) as Session | undefined;
  return row ? { ...row, token: decrypt(row.token) } : null;
}
export function deleteSession(id: string) {
  db.prepare('DELETE FROM sessions WHERE id=?').run(id);
}
export default db;
