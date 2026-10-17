import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { demoRecipe, DEMO_RECIPE_COUNT, seedDemoLibrary } from '../scripts/demo-data.js';
import { openMemoryDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { listRecipes } from '../src/db/recipes.js';
import { recipeInputSchema } from '../src/schemas/recipe.js';
import { createImageStore } from '../src/services/images.js';
import { makeTempDir } from './helpers.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runSeedCli(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/seed-demo.ts', ...args], {
    cwd: serverDir,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

describe('demo recipes', () => {
  it('are all valid recipes, with a long title and some without a source link or rating', () => {
    const recipes = Array.from({ length: DEMO_RECIPE_COUNT }, (_, index) => demoRecipe(index));
    for (const recipe of recipes) expect(() => recipeInputSchema.parse(recipe)).not.toThrow();
    expect(Math.max(...recipes.map((recipe) => recipe.title.length))).toBeGreaterThan(60);
    expect(recipes.some((recipe) => recipe.sourceUrl === null)).toBe(true);
    expect(recipes.some((recipe) => recipe.rating === null)).toBe(true);
  });

  it('are seeded with photos on four in five of them', async () => {
    const db = openMemoryDatabase();
    migrate(db);
    const dir = makeTempDir('recipemixer-demo-');

    await expect(seedDemoLibrary(db, createImageStore(dir))).resolves.toBe(DEMO_RECIPE_COUNT);

    const { items, total } = listRecipes(db, { limit: 100, offset: 0 });
    expect(total).toBe(DEMO_RECIPE_COUNT);
    expect(items.filter((item) => item.imageUrl).length).toBe(DEMO_RECIPE_COUNT - Math.floor(DEMO_RECIPE_COUNT / 5));
    expect(fs.readdirSync(dir).every((file) => /^[a-f0-9]{64}\.webp$/.test(file))).toBe(true);
  });
});

describe('seed-demo command', () => {
  it('refuses to run without an explicit folder', () => {
    const result = runSeedCli();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--dir');
  });

  it('fills a new folder, then refuses to add to it again', () => {
    const dir = path.join(makeTempDir('recipemixer-seed-'), 'library');

    const first = runSeedCli('--dir', dir);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(`Created ${DEMO_RECIPE_COUNT} demo recipes`);
    expect(fs.existsSync(path.join(dir, 'recipemixer.db'))).toBe(true);

    const second = runSeedCli('--dir', dir);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('already contains');
  });
});
