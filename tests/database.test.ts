import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDatabase, compileStatement } from '../src/lib/database';

test('updating a connected user preserves sessions; a failed batch rolls back completely', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'roulette-db-'));
  const db = new AppDatabase(false, directory);
  try {
    await db.batch([
      {
        text: 'INSERT OR REPLACE INTO users VALUES (?,?,?)',
        values: ['u1', 'old-login', 'avatar'],
      },
      {
        text: 'INSERT OR REPLACE INTO connections VALUES (?,?)',
        values: ['u1', 'encrypted-token'],
      },
      { text: 'INSERT INTO sessions VALUES (?,?,?)', values: ['s1', 'u1', 1900000000000] },
    ]);
    await db
      .prepare('INSERT OR REPLACE INTO users VALUES (?,?,?)')
      .run('u1', 'new-login', 'avatar');
    const session = await db
      .prepare('SELECT s.id,u.login FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?')
      .get('s1');
    assert.deepEqual(session, { id: 's1', login: 'new-login' });
    await assert.rejects(
      db.batch([
        {
          text: 'INSERT OR REPLACE INTO users VALUES (?,?,?)',
          values: ['u2', 'rolled-back', 'avatar'],
        },
        { text: 'INSERT INTO sessions VALUES (?,?,?)', values: ['s1', 'u2', 1900000000000] },
      ]),
    );
    assert.equal(await db.prepare('SELECT id FROM users WHERE id=?').get('u2'), undefined);
    await db.close();
    assert.deepEqual(await db.prepare('SELECT login FROM users WHERE id=?').get('u1'), {
      login: 'new-login',
    });
  } finally {
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('version histories remain scoped to a user and keep newest versions first', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'roulette-db-'));
  const db = new AppDatabase(false, directory);
  try {
    for (const [user, text] of [
      ['u1', 'first'],
      ['u2', 'private'],
      ['u1', 'latest'],
    ])
      await db
        .prepare('INSERT INTO readme_versions (user_id,repo,markdown,created_at) VALUES (?,?,?,?)')
        .run(user, 'owner/repo', text, Date.now());
    const versions = await db
      .prepare(
        'SELECT markdown FROM readme_versions WHERE user_id=? AND repo=? ORDER BY id DESC LIMIT 30',
      )
      .all('u1', 'owner/repo');
    assert.deepEqual(versions, [{ markdown: 'latest' }, { markdown: 'first' }]);
  } finally {
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Azure SQL templates retain bound values, serialize upserts, and convert history limits', () => {
  const upsert = compileStatement('INSERT OR REPLACE INTO analyses VALUES (?,?,?,?,?)', 'mssql');
  assert.match(upsert, /WITH \(HOLDLOCK\)/);
  assert.match(upsert, /@p4 AS updated_at/);
  assert.match(upsert, /WHEN MATCHED THEN UPDATE/);
  const query = compileStatement(
    'SELECT id,markdown FROM readme_versions WHERE user_id=? AND repo=? ORDER BY id DESC LIMIT 30',
    'mssql',
  );
  assert.equal(
    query,
    'SELECT TOP (30) id,markdown FROM readme_versions WHERE user_id=@p0 AND repo=@p1 ORDER BY id DESC',
  );
});
