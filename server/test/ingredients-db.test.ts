import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type Db } from '../src/db/connection.js';
import { backfillIngredients, suggestIngredients } from '../src/db/ingredients.js';
import { migrate } from '../src/db/migrate.js';
import { createRecipe, deleteRecipe, updateRecipe } from '../src/db/recipes.js';
import type { RecipeInput } from '../src/schemas/recipe.js';
import { NORMALIZER_VERSION } from '../src/services/ingredient-data.js';

let db: Db;

beforeEach(() => {
  db = openMemoryDatabase();
  migrate(db);
});

afterEach(() => {
  db.close();
});

function input(ingredients: string[], title = 'Test'): RecipeInput {
  return { title, cuisine: null, description: null, sourceUrl: null, rating: null, ingredients, steps: [] };
}

const rows = () =>
  db
    .prepare('SELECT id, raw_text, name_normalized, quantity, unit, normalizer_version FROM recipe_ingredient ORDER BY id')
    .all() as {
    id: number;
    raw_text: string;
    name_normalized: string | null;
    quantity: number | null;
    unit: string | null;
    normalizer_version: number;
  }[];

const words = () =>
  (db.prepare('SELECT word FROM recipe_ingredient_word ORDER BY word').all() as { word: string }[]).map(
    (row) => row.word,
  );

describe('write path', () => {
  it('fills the normalised columns, the rule version and the word index when a recipe is created', () => {
    createRecipe(db, input(['2 cups chopped yellow onions', 'salt and pepper', '1/2 cup milk']));
    expect(rows()).toMatchObject([
      { raw_text: '2 cups chopped yellow onions', name_normalized: 'onion', quantity: 2, unit: 'cup' },
      { raw_text: 'salt and pepper', name_normalized: 'salt' },
      { raw_text: '1/2 cup milk', name_normalized: 'milk', quantity: 0.5 },
    ]);
    expect(rows().every((row) => row.normalizer_version === NORMALIZER_VERSION)).toBe(true);
    expect(words()).toEqual(['black-pepper', 'milk', 'onion', 'salt']);
  });

  it('indexes every alternative of a line and keeps all names for matching', () => {
    createRecipe(db, input(['butter or margarine']));
    expect(words()).toEqual(['butter', 'margarine']);
    expect(db.prepare('SELECT name_normalized AS first, normalized_names AS names FROM recipe_ingredient').get()).toEqual({
      first: 'butter',
      names: 'butter|margarine',
    });
  });

  it('stores a line with nothing usable without a name or words, keeping the text', () => {
    createRecipe(db, input(['For the sauce:']));
    expect(rows()).toMatchObject([{ raw_text: 'For the sauce:', name_normalized: null }]);
    expect(words()).toEqual([]);
  });

  it('replaces the words when a recipe is updated', () => {
    const id = createRecipe(db, input(['1 onion', '2 tomatoes']));
    updateRecipe(db, id, input(['3 carrots']));
    expect(words()).toEqual(['carrot']);
    expect(rows()).toHaveLength(1);
  });

  it('removes the words when a recipe is deleted', () => {
    const id = createRecipe(db, input(['1 onion']));
    expect(words()).toEqual(['onion']);
    deleteRecipe(db, id);
    expect(words()).toEqual([]);
  });
});

describe('backfillIngredients', () => {
  function insertLegacyRows(count: number) {
    const { lastInsertRowid } = db.prepare("INSERT INTO recipe (title) VALUES ('Legacy')").run();
    const insert = db.prepare('INSERT INTO recipe_ingredient (recipe_id, position, raw_text) VALUES (?, ?, ?)');
    for (let i = 0; i < count; i++) insert.run(lastInsertRowid, i, `${i + 1} cups chopped onions`);
  }

  it('indexes rows that predate the index, once', () => {
    insertLegacyRows(5);
    expect(rows().every((row) => row.normalizer_version === 0 && row.name_normalized === null)).toBe(true);

    expect(backfillIngredients(db)).toBe(5);
    expect(rows().every((row) => row.name_normalized === 'onion' && row.normalizer_version === NORMALIZER_VERSION)).toBe(true);
    expect(words()).toEqual(['onion', 'onion', 'onion', 'onion', 'onion']);

    expect(backfillIngredients(db)).toBe(0);
  });

  it('processes everything across several batches', () => {
    insertLegacyRows(7);
    expect(backfillIngredients(db, 2)).toBe(7);
    expect(rows().every((row) => row.normalizer_version === NORMALIZER_VERSION)).toBe(true);
  });

  it('never changes the original text', () => {
    insertLegacyRows(3);
    const before = rows().map((row) => row.raw_text);
    backfillIngredients(db);
    expect(rows().map((row) => row.raw_text)).toEqual(before);
  });

  it('re-processes rows made by an older rule version', () => {
    createRecipe(db, input(['1 onion']));
    db.prepare('UPDATE recipe_ingredient SET name_normalized = NULL, normalizer_version = ?').run(NORMALIZER_VERSION - 1);
    expect(backfillIngredients(db)).toBe(1);
    expect(rows()[0]?.name_normalized).toBe('onion');
  });

  it('does nothing on an empty database', () => {
    expect(backfillIngredients(db)).toBe(0);
  });
});

describe('suggestIngredients', () => {
  beforeEach(() => {
    createRecipe(db, input(['1 onion', '2 tomatoes', '1 cup oats'], 'One'));
    createRecipe(db, input(['2 onions', '1 orange'], 'Two'));
    createRecipe(db, input(['3 onions', '1 oregano'], 'Three'));
  });

  it('returns names with the given prefix, most common first', () => {
    expect(suggestIngredients(db, 'o', 10)).toEqual([
      { name: 'onion', count: 3 },
      { name: 'oat', count: 1 },
      { name: 'orange', count: 1 },
      { name: 'oregano', count: 1 },
    ]);
  });

  it('shows compound names with spaces', () => {
    createRecipe(db, input(['1/4 cup peanut butter'], 'Four'));
    expect(suggestIngredients(db, 'pea', 10)).toEqual([{ name: 'peanut butter', count: 1 }]);
  });

  it('is case-insensitive and ignores surrounding spaces', () => {
    expect(suggestIngredients(db, '  ONI ', 10)).toEqual([{ name: 'onion', count: 3 }]);
  });

  it('respects the limit and caps it at 20', () => {
    expect(suggestIngredients(db, 'o', 2)).toHaveLength(2);
    expect(suggestIngredients(db, 'o', 1000).length).toBeLessThanOrEqual(20);
  });

  it('returns nothing for an empty prefix or no match', () => {
    expect(suggestIngredients(db, '', 10)).toEqual([]);
    expect(suggestIngredients(db, '   ', 10)).toEqual([]);
    expect(suggestIngredients(db, 'zzz', 10)).toEqual([]);
  });

  it('treats wildcard characters as plain text', () => {
    expect(suggestIngredients(db, '%', 10)).toEqual([]);
    expect(suggestIngredients(db, '_', 10)).toEqual([]);
    expect(suggestIngredients(db, "o'; DROP TABLE recipe;--", 10)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM recipe').get()).toEqual({ n: 3 });
  });
});
