import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

export const DB_FILENAME = 'recipemixer.db';

function configure(db: Db): Db {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function openDatabase(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return configure(new Database(path.join(dataDir, DB_FILENAME)));
}

export function openMemoryDatabase(): Db {
  return configure(new Database(':memory:'));
}
