import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createRecipe } from '../src/db/recipes.js';
import type { MatchQuery } from '../src/schemas/match.js';
import { findMatches } from '../src/services/matching.js';
import { INGREDIENT_SETS, LIBRARY } from './fixtures/matching-library.js';

let db: Db;

beforeEach(() => {
  db = openMemoryDatabase();
  migrate(db);
});

afterEach(() => {
  db.close();
});

function add(title: string, ingredients: string[], rating: number | null = null): number {
  return createRecipe(db, { title, cuisine: null, description: null, sourceUrl: null, rating, ingredients, steps: [] });
}

function query(i: string[], overrides: Partial<MatchQuery> = {}): MatchQuery {
  return { i, staples: true, minCoverage: 0, limit: 24, offset: 0, ...overrides };
}

const titles = (result: ReturnType<typeof findMatches>) => result.items.map((item) => item.recipe.title);

function loadLibrary() {
  for (const recipe of LIBRARY) add(recipe.title, recipe.ingredients, recipe.rating ?? null);
}

describe('fixture library', () => {
  beforeEach(loadLibrary);

  it.each(INGREDIENT_SETS)('$name', (set) => {
    const found = titles(findMatches(db, query(set.have, { limit: 100 })));
    if (set.first) expect(found[0]).toBe(set.first);
    for (const title of set.topThree ?? []) expect(found.slice(0, 3)).toContain(title);
    for (const title of set.present ?? []) expect(found).toContain(title);
    for (const title of set.absent ?? []) expect(found).not.toContain(title);
  });

  it('reports what the user has and what they still need, using the recipe text', () => {
    const result = findMatches(db, query(['egg']));
    const eggs = result.items.find((item) => item.recipe.title === 'Fried eggs on toast');
    expect(eggs).toMatchObject({
      matched: ['2 eggs'],
      missing: ['2 slices bread', '1 tbsp butter'],
      matchedCount: 1,
      totalCount: 3,
    });
    expect(eggs?.coverage).toBeCloseTo(1 / 3);
  });

  it('puts a complete match first with full coverage', () => {
    const result = findMatches(db, query(['egg', 'bread', 'butter']));
    expect(result.items[0]).toMatchObject({ coverage: 1, missing: [] });
  });

  it('echoes the understood inputs', () => {
    const result = findMatches(db, query(['Eggs', 'BREAD']));
    expect(result.usedIngredients).toEqual(['Eggs', 'BREAD']);
    expect(result.ignored).toEqual([]);
    expect(result.assumeStaples).toBe(true);
  });
});

describe('pantry staples', () => {
  beforeEach(loadLibrary);

  it('assumes staples are on hand by default: they are not counted or listed as missing', () => {
    const result = findMatches(db, query(['egg', 'bread', 'butter']));
    const toast = result.items.find((item) => item.recipe.title === 'Fried eggs on toast');
    expect(toast).toMatchObject({ totalCount: 3, missing: [] });
  });

  it('counts staples like any other ingredient when switched off', () => {
    const result = findMatches(db, query(['egg', 'bread', 'butter'], { staples: false }));
    const toast = result.items.find((item) => item.recipe.title === 'Fried eggs on toast');
    expect(toast).toMatchObject({ totalCount: 4, missing: ['salt and pepper'] });
    expect(result.assumeStaples).toBe(false);
  });

  it('never returns a recipe made only of staples while staples are assumed', () => {
    add('Salt water', ['salt', 'water']);
    expect(titles(findMatches(db, query(['salt'])))).not.toContain('Salt water');
    expect(titles(findMatches(db, query(['salt'], { staples: false })))).toContain('Salt water');
  });
});

describe('ranking', () => {
  it('breaks ties by fewer missing ingredients, then rating, then newest', () => {
    const a = add('A', ['egg', 'milk'], 3);
    const b = add('B', ['egg', 'milk'], 5);
    const e = add('E', ['egg', 'milk'], 3);
    const full = add('Full', ['egg'], null);
    const result = findMatches(db, query(['egg']));
    expect(titles(result)).toEqual(['Full', 'B', 'E', 'A']);
    expect(result.items.map((item) => item.recipe.id)).toEqual([full, b, e, a]);
  });

  it('prefers fewer missing ingredients at equal coverage', () => {
    add('Many missing', ['egg', 'milk', 'flour', 'sugar']);
    add('Few missing', ['egg', 'flour']);
    expect(titles(findMatches(db, query(['egg', 'milk'])))).toEqual(['Few missing', 'Many missing']);
  });

  it('applies the minimum coverage', () => {
    add('Half', ['egg', 'milk']);
    expect(titles(findMatches(db, query(['egg'], { minCoverage: 0.5 })))).toEqual(['Half']);
    expect(titles(findMatches(db, query(['egg'], { minCoverage: 0.6 })))).toEqual([]);
  });

  it('paginates and reports the total', () => {
    for (let n = 0; n < 30; n++) add(`Recipe ${n}`, ['egg']);
    const page = findMatches(db, query(['egg'], { limit: 10, offset: 25 }));
    expect(page.total).toBe(30);
    expect(page.items).toHaveLength(5);
    const ids = page.items.map((item) => item.recipe.id);
    expect(ids).toEqual([...ids].sort((x, y) => y - x));
  });
});

describe('inputs', () => {
  beforeEach(loadLibrary);

  it('matches either side of "or" in a recipe line', () => {
    add('Spread', ['butter or margarine', 'bread']);
    const result = findMatches(db, query(['margarine']));
    expect(result.items.find((item) => item.recipe.title === 'Spread')?.matched).toEqual(['butter or margarine']);
  });

  it('skips inputs that are not ingredients and says so', () => {
    const result = findMatches(db, query(['!!!', 'egg', '123']));
    expect(result.ignored).toEqual(['!!!', '123']);
    expect(result.usedIngredients).toEqual(['egg']);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('returns an empty result when nothing can be understood', () => {
    expect(findMatches(db, query(['!!!']))).toEqual({
      items: [],
      total: 0,
      usedIngredients: [],
      ignored: ['!!!'],
      assumeStaples: true,
    });
  });

  it('returns an empty result when no recipe shares an ingredient', () => {
    const result = findMatches(db, query(['dragonfruit']));
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.usedIngredients).toEqual(['dragonfruit']);
  });

  it('treats SQL metacharacters as plain text', () => {
    expect(() => findMatches(db, query(["x'); DROP TABLE recipe;--", '%', '_']))).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM recipe').get()).toEqual({ n: LIBRARY.length });
  });

  it('handles an empty library', () => {
    const empty = openMemoryDatabase();
    migrate(empty);
    expect(findMatches(empty, query(['egg'])).items).toEqual([]);
    empty.close();
  });

  it('copes with the maximum number of ingredients', () => {
    const many = Array.from({ length: 30 }, (_, n) => `ingredient${'abcdefghijklmnopqrstuvwxyzabcd'[n]}`);
    expect(() => findMatches(db, query(many))).not.toThrow();
  });
});
