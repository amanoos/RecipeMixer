import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type Db } from '../src/db/connection.js';
import { getSchemaVersion, migrate } from '../src/db/migrate.js';
import { makeTempDir } from './helpers.js';

let db: Db;

function freshDb(): Db {
  db = openMemoryDatabase();
  migrate(db);
  return db;
}

afterEach(() => {
  db?.close();
});

describe('migrate', () => {
  it('applies all migrations and reports the latest version', () => {
    db = openMemoryDatabase();
    expect(migrate(db)).toBe(2);
  });

  it('is idempotent', () => {
    freshDb();
    expect(migrate(db)).toBe(2);
    expect(getSchemaVersion(db)).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 2 });
  });

  it('applies new migrations in order and skips applied ones', () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id INTEGER);');
    fs.writeFileSync(path.join(dir, '002_b.sql'), 'CREATE TABLE b (id INTEGER);');
    db = openMemoryDatabase();
    expect(migrate(db, dir)).toBe(2);
    fs.writeFileSync(path.join(dir, '003_c.sql'), 'CREATE TABLE c (id INTEGER);');
    expect(migrate(db, dir)).toBe(3);
  });

  it('rolls back a failing migration and keeps the previous version', () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE ok (id INTEGER);');
    db = openMemoryDatabase();
    migrate(db, dir);
    fs.writeFileSync(
      path.join(dir, '002_bad.sql'),
      'CREATE TABLE half (id INTEGER); THIS IS NOT SQL;',
    );
    expect(() => migrate(db, dir)).toThrow();
    expect(getSchemaVersion(db)).toBe(1);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'half'").get(),
    ).toBeUndefined();
  });
});

describe('base schema', () => {
  it('cascades recipe deletion to ingredients and steps', () => {
    freshDb();
    const { lastInsertRowid } = db.prepare("INSERT INTO recipe (title) VALUES ('Soup')").run();
    db.prepare(
      "INSERT INTO recipe_ingredient (recipe_id, position, raw_text) VALUES (?, 0, '1 onion')",
    ).run(lastInsertRowid);
    db.prepare("INSERT INTO recipe_step (recipe_id, position, text) VALUES (?, 0, 'Chop')").run(
      lastInsertRowid,
    );

    db.prepare('DELETE FROM recipe WHERE id = ?').run(lastInsertRowid);

    expect(db.prepare('SELECT COUNT(*) AS n FROM recipe_ingredient').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM recipe_step').get()).toEqual({ n: 0 });
  });

  it.each([0, 6])('rejects rating %i', (rating) => {
    freshDb();
    expect(() =>
      db.prepare("INSERT INTO recipe (title, rating) VALUES ('Bad', ?)").run(rating),
    ).toThrow(/CHECK/);
  });

  it('accepts ratings 1 to 5 and no rating', () => {
    freshDb();
    for (const rating of [1, 5, null]) {
      db.prepare("INSERT INTO recipe (title, rating) VALUES ('Ok', ?)").run(rating);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM recipe').get()).toEqual({ n: 3 });
  });

  it('enforces foreign keys', () => {
    freshDb();
    expect(() =>
      db
        .prepare(
          "INSERT INTO recipe_ingredient (recipe_id, position, raw_text) VALUES (999, 0, 'ghost')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('creates the list and image reference indexes', () => {
    freshDb();
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'recipe'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining(['idx_recipe_created', 'idx_recipe_image_path']));
  });

  it('requires a title', () => {
    freshDb();
    expect(() => db.prepare('INSERT INTO recipe (title) VALUES (NULL)').run()).toThrow(/NOT NULL/);
  });
});
