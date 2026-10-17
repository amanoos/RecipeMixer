import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './connection.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));
const MIGRATION_FILE = /^(\d+)_.+\.sql$/;

export function getSchemaVersion(db: Db): number {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null;
  };
  return row.version ?? 0;
}

/**
 * Applies every unapplied `NNN_name.sql` file in order, each inside its own transaction,
 * and returns the resulting schema version. Safe to call on every start.
 */
export function migrate(db: Db, dir: string = MIGRATIONS_DIR): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (row) => row.version,
    ),
  );

  const files = fs
    .readdirSync(dir)
    .filter((file) => MIGRATION_FILE.test(file))
    .sort();

  for (const file of files) {
    const version = Number.parseInt(MIGRATION_FILE.exec(file)?.[1] ?? '', 10);
    if (applied.has(version)) continue;

    // Static SQL files from the repo only: never build migration SQL from user input.
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
    })();
  }

  return getSchemaVersion(db);
}
