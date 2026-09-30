import Database from 'better-sqlite3';
import sql from 'mssql';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type Statement = { text: string; values: (string | number)[] };
const tables: Record<string, Record<string, string>> = {
  users: {
    id: 'nvarchar(450) PRIMARY KEY',
    login: 'nvarchar(255) NOT NULL',
    avatar: 'nvarchar(max)',
  },
  connections: {
    user_id: 'nvarchar(450) PRIMARY KEY REFERENCES users(id)',
    token: 'nvarchar(max) NOT NULL',
  },
  sessions: {
    id: 'nvarchar(450) PRIMARY KEY',
    user_id: 'nvarchar(450) REFERENCES users(id)',
    expires: 'bigint NOT NULL',
  },
  ai_credentials: {
    user_id: 'nvarchar(450) PRIMARY KEY REFERENCES users(id)',
    provider: 'nvarchar(100) NOT NULL',
    model: 'nvarchar(255) NOT NULL',
    api_key: 'nvarchar(max) NOT NULL',
    updated_at: 'bigint NOT NULL',
  },
  repositories: {
    id: 'nvarchar(450) PRIMARY KEY',
    user_id: 'nvarchar(450) NOT NULL',
    data: 'nvarchar(max) NOT NULL',
  },
  analyses: {
    id: 'nvarchar(450) PRIMARY KEY',
    user_id: 'nvarchar(450) NOT NULL',
    head_sha: 'nvarchar(255)',
    data: 'nvarchar(max) NOT NULL',
    updated_at: 'bigint',
  },
  readmes: {
    id: 'nvarchar(450) PRIMARY KEY',
    user_id: 'nvarchar(450) NOT NULL',
    repo: 'nvarchar(255) NOT NULL',
    markdown: 'nvarchar(max) NOT NULL',
    updated_at: 'bigint',
  },
  readme_versions: {
    id: 'bigint IDENTITY(1,1) PRIMARY KEY',
    user_id: 'nvarchar(450) NOT NULL',
    repo: 'nvarchar(255) NOT NULL',
    markdown: 'nvarchar(max) NOT NULL',
    created_at: 'bigint',
  },
  screenshot_tasks: {
    id: 'nvarchar(450) PRIMARY KEY',
    user_id: 'nvarchar(450) NOT NULL',
    repo: 'nvarchar(255) NOT NULL',
    completed: 'int NOT NULL',
  },
  portfolio_descriptions: {
    id: 'nvarchar(450) PRIMARY KEY',
    user_id: 'nvarchar(450) NOT NULL',
    data: 'nvarchar(max) NOT NULL',
  },
  repository_scores: {
    id: 'nvarchar(450) PRIMARY KEY',
    user_id: 'nvarchar(450) NOT NULL',
    score: 'int NOT NULL',
    criteria: 'nvarchar(max) NOT NULL',
  },
};

/** Only the application's fixed SQL templates go here; all values stay parameterized. */
export function compileStatement(text: string, dialect: 'sqlite' | 'mssql') {
  const upsert = text.match(/^INSERT OR REPLACE INTO (\w+) VALUES \([?,]+\)$/i);
  if (upsert) {
    const table = upsert[1],
      definition = tables[table];
    if (!definition) throw new Error('Unknown database table.');
    const columns = Object.keys(definition),
      key = columns[0];
    if (dialect === 'sqlite') {
      return `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(${key}) DO UPDATE SET ${columns
        .slice(1)
        .map((c) => `${c}=excluded.${c}`)
        .join(',')}`;
    }
    return `MERGE ${table} WITH (HOLDLOCK) AS target USING (SELECT ${columns.map((c, i) => `@p${i} AS ${c}`).join(',')}) AS source ON target.${key}=source.${key} WHEN MATCHED THEN UPDATE SET ${columns
      .slice(1)
      .map((c) => `${c}=source.${c}`)
      .join(
        ',',
      )} WHEN NOT MATCHED THEN INSERT (${columns.join(',')}) VALUES (${columns.map((c) => `source.${c}`).join(',')});`;
  }
  if (dialect === 'sqlite') return text;
  let parameter = 0;
  return text
    .replace(/\?/g, () => `@p${parameter++}`)
    .replace(/^SELECT (.+) LIMIT (\d+)$/is, 'SELECT TOP ($2) $1');
}

export class AppDatabase {
  private sqlite?: Database.Database;
  private pool?: Promise<sql.ConnectionPool>;
  constructor(
    private azure = Boolean(process.env.AZURE_SQL_SERVER),
    private directory = process.env.DATA_DIR || join(process.cwd(), '.data'),
  ) {}
  private local() {
    if (!this.sqlite) {
      mkdirSync(this.directory, { recursive: true });
      this.sqlite = new Database(join(this.directory, 'roulette.sqlite'));
      this.sqlite.pragma('journal_mode = WAL');
      this.sqlite.pragma('foreign_keys = ON');
      for (const [table, columns] of Object.entries(tables)) {
        const definitions = Object.entries(columns).map(
          ([column, type]) =>
            `${column} ${type
              .replace('bigint IDENTITY(1,1) PRIMARY KEY', 'INTEGER PRIMARY KEY AUTOINCREMENT')
              .replace(/nvarchar\((?:max|\d+)\)/g, 'TEXT')
              .replace(/bigint|\bint\b/g, 'INTEGER')}`,
        );
        this.sqlite.exec(`CREATE TABLE IF NOT EXISTS ${table} (${definitions.join(',')})`);
      }
    }
    return this.sqlite;
  }
  private remote() {
    if (!this.pool) {
      this.pool = (async () => {
        const pool = new sql.ConnectionPool({
          server: process.env.AZURE_SQL_SERVER!,
          database: process.env.AZURE_SQL_DATABASE,
          user: process.env.AZURE_SQL_USER,
          password: process.env.AZURE_SQL_PASSWORD,
          options: { encrypt: true, trustServerCertificate: false },
          // Empty pools let the free serverless database auto-pause when idle.
          pool: { min: 0, max: 4, idleTimeoutMillis: 10000 },
          connectionTimeout: 60000,
          requestTimeout: 60000,
        });
        pool.on('error', () => {
          /* Request errors are handled by the API. */
        });
        try {
          await pool.connect();
          for (const [table, columns] of Object.entries(tables)) {
            await pool.request().query(
              `IF OBJECT_ID(N'dbo.${table}', N'U') IS NULL CREATE TABLE dbo.${table} (${Object.entries(
                columns,
              )
                .map(([c, type]) => `${c} ${type}`)
                .join(',')})`,
            );
          }
          return pool;
        } catch (error) {
          await pool.close();
          throw error;
        }
      })().catch((error) => {
        this.pool = undefined;
        throw error;
      });
    }
    return this.pool;
  }
  private async execute(text: string, values: (string | number)[], transaction?: sql.Transaction) {
    const request = transaction ? new sql.Request(transaction) : (await this.remote()).request();
    values.forEach((value, i) =>
      request.input(`p${i}`, typeof value === 'number' ? sql.BigInt : sql.NVarChar(sql.MAX), value),
    );
    return request.query(compileStatement(text, 'mssql'));
  }
  prepare(text: string) {
    return {
      get: async (...values: (string | number)[]) =>
        this.azure
          ? (await this.execute(text, values)).recordset[0]
          : this.local()
              .prepare(compileStatement(text, 'sqlite'))
              .get(...values),
      all: async (...values: (string | number)[]) =>
        this.azure
          ? (await this.execute(text, values)).recordset
          : this.local()
              .prepare(compileStatement(text, 'sqlite'))
              .all(...values),
      run: async (...values: (string | number)[]) => {
        if (this.azure) await this.execute(text, values);
        else
          this.local()
            .prepare(compileStatement(text, 'sqlite'))
            .run(...values);
      },
    };
  }
  async batch(statements: Statement[]) {
    if (!this.azure) {
      const db = this.local();
      db.transaction(() => {
        for (const { text, values } of statements)
          db.prepare(compileStatement(text, 'sqlite')).run(...values);
      })();
      return;
    }
    const transaction = new sql.Transaction(await this.remote());
    await transaction.begin();
    try {
      for (const { text, values } of statements) await this.execute(text, values, transaction);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback().catch(() => {});
      throw error;
    }
  }
  async close() {
    this.sqlite?.close();
    this.sqlite = undefined;
    if (this.pool) await (await this.pool).close();
    this.pool = undefined;
  }
}
export default new AppDatabase();
