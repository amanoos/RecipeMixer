import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createRecipe, listRecipes } from '../src/db/recipes.js';
import { findMatches } from '../src/services/matching.js';
import { loadStarterRecipes, readStarterRecipes } from '../src/services/starter-recipes.js';
import { makeApp, makeTempDir } from './helpers.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function freshDb() {
  const db = openMemoryDatabase();
  migrate(db);
  return db;
}

describe('bundled starter recipes', () => {
  it('are all valid recipes with unique titles and enough of them to be useful', () => {
    const recipes = readStarterRecipes();
    expect(recipes.length).toBeGreaterThanOrEqual(40);
    expect(new Set(recipes.map((recipe) => recipe.title.toLowerCase())).size).toBe(recipes.length);
    for (const recipe of recipes) {
      expect(recipe.ingredients.length).toBeGreaterThanOrEqual(3);
      expect(recipe.steps.length).toBeGreaterThanOrEqual(2);
      expect(recipe.sourceUrl).toBeNull();
      expect(recipe.rating).toBeNull();
    }
  });

  it('carry a CC0 dedication next to the data', () => {
    const licence = fs.readFileSync(path.join(serverDir, 'src', 'data', 'LICENSE-starter-recipes.txt'), 'utf8');
    expect(licence).toContain('CC0 1.0');
  });

  it('are copied next to the compiled code by the build', () => {
    const script = fs.readFileSync(path.join(serverDir, 'scripts', 'copy-migrations.mjs'), 'utf8');
    expect(script).toContain("'data'");
  });
});

describe('loadStarterRecipes', () => {
  it('adds every recipe to an empty library and indexes the ingredients for matching', () => {
    const db = freshDb();
    const total = readStarterRecipes().length;

    expect(loadStarterRecipes(db)).toEqual({ added: total, skipped: 0 });
    expect(listRecipes(db, { limit: 100, offset: 0 }).total).toBe(total);

    const matches = findMatches(db, {
      i: ['onion', 'garlic', 'tomato', 'rice', 'egg'],
      staples: true,
      minCoverage: 0,
      limit: 24,
      offset: 0,
    });
    expect(matches.items.length).toBeGreaterThanOrEqual(5);
  });

  it('adds nothing the second time', () => {
    const db = freshDb();
    loadStarterRecipes(db);
    const again = loadStarterRecipes(db);
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(readStarterRecipes().length);
  });

  it('skips a title that is already there, ignoring case, and leaves that recipe unchanged', () => {
    const db = freshDb();
    const id = createRecipe(db, {
      title: 'BANANA BREAD',
      cuisine: null,
      description: 'My own',
      sourceUrl: null,
      rating: 5,
      ingredients: ['3 bananas'],
      steps: ['Bake'],
    });

    const result = loadStarterRecipes(db);
    expect(result.skipped).toBe(1);
    expect(result.added).toBe(readStarterRecipes().length - 1);
    const mine = listRecipes(db, { limit: 100, offset: 0 }).items.filter((item) => item.id === id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.rating).toBe(5);
  });
});

describe('POST /api/starter-recipes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it('loads the recipes, and a second call adds none', async () => {
    app = await makeApp();
    const first = await app.inject({ method: 'POST', url: '/api/starter-recipes' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ added: readStarterRecipes().length, skipped: 0 });

    const second = await app.inject({ method: 'POST', url: '/api/starter-recipes' });
    expect(second.json()).toEqual({ added: 0, skipped: readStarterRecipes().length });

    const list = await app.inject({ method: 'GET', url: '/api/recipes?limit=100' });
    expect(list.json().total).toBe(readStarterRecipes().length);
  });

  it('needs the login when a password is set', async () => {
    app = await makeApp({ appPassword: 'correct horse battery staple' });
    const res = await app.inject({ method: 'POST', url: '/api/starter-recipes' });
    expect(res.statusCode).toBe(401);
  });

  it('is rate limited', async () => {
    app = await makeApp();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await app.inject({ method: 'POST', url: '/api/starter-recipes' })).statusCode);
    expect(codes.filter((code) => code === 429).length).toBeGreaterThan(0);
  });
});

describe('seed-starter command', () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'scripts/seed-starter.ts', ...args], {
      cwd: serverDir,
      encoding: 'utf8',
      timeout: 60_000,
    });

  it('refuses to run without an explicit folder', () => {
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--dir');
  });

  it('fills a folder, and a second run adds nothing', () => {
    const dir = path.join(makeTempDir('recipemixer-starter-'), 'library');
    const total = readStarterRecipes().length;

    const first = run('--dir', dir);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(`Added ${total} starter recipes`);

    const second = run('--dir', dir);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain(`Added 0 starter recipes`);
    expect(second.stdout).toContain(`${total} already there`);
  });
});
