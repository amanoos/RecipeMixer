import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createRecipe, deleteRecipe, listRecipes, setRecipeImage, setRecipeRating, updateRecipe } from '../src/db/recipes.js';
import { buildMatchExpression, listCuisines } from '../src/db/search.js';
import type { ListQuery, RecipeInput } from '../src/schemas/recipe.js';
import { makeTempDir } from './helpers.js';

let db: Db;

beforeEach(() => {
  db = openMemoryDatabase();
  migrate(db);
});

afterEach(() => {
  db.close();
});

function add(overrides: Partial<RecipeInput> & { title: string }): number {
  return createRecipe(db, {
    cuisine: null,
    description: null,
    sourceUrl: null,
    rating: null,
    ingredients: [],
    steps: [],
    ...overrides,
  });
}

const search = (query: Partial<ListQuery>) => listRecipes(db, { limit: 50, offset: 0, ...query });
const titles = (result: ReturnType<typeof listRecipes>) => result.items.map((item) => item.title);

const ftsRows = () =>
  db.prepare('SELECT rowid, title, cuisine, description, ingredients FROM recipe_fts ORDER BY rowid').all();

describe('buildMatchExpression', () => {
  it.each([
    ['tomato soup', '"tomato" "soup"*'],
    ['  Tomato  ', '"Tomato"*'],
    ['onion', '"onion"*'],
    ['crème brûlée', '"crème" "brûlée"*'],
    ['寿司', '"寿司"*'],
    ['mac & cheese', '"mac" "cheese"*'],
    ["grandma's pie", '"grandma" "s" "pie"*'],
  ])('%s -> %s', (query, expression) => {
    expect(buildMatchExpression(query)).toBe(expression);
  });

  it.each([
    ['soup OR salad', '"soup" "OR" "salad"*'],
    ['soup AND NOT salad', '"soup" "AND" "NOT" "salad"*'],
    ['NEAR(a b)', '"NEAR" "a" "b"*'],
    ['title:soup', '"title" "soup"*'],
    ['-soup', '"soup"*'],
    ['so*', '"so"*'],
    ['"; DROP TABLE recipe;--', '"DROP" "TABLE" "recipe"*'],
    ['^soup', '"soup"*'],
    ['{title}: (soup)', '"title" "soup"*'],
  ])('keeps operator %j as plain words', (query, expression) => {
    expect(buildMatchExpression(query)).toBe(expression);
  });

  it.each(['', '   ', '!!!', '"""', '(*)', '--', '\u0000'])('finds nothing to search in %j', (query) => {
    expect(buildMatchExpression(query)).toBeNull();
  });

  it('limits the number and length of words', () => {
    const many = buildMatchExpression(Array.from({ length: 25 }, (_, n) => `w${n}`).join(' '));
    expect(many?.split(' ')).toHaveLength(10);
    const long = buildMatchExpression('a'.repeat(500));
    expect(long).toBe(`"${'a'.repeat(40)}"*`);
  });

  it('only ever produces quoted words and one trailing star', () => {
    for (const query of ['a b c', 'x"y', "it's", 'AND', 'a-b', 'foo*bar']) {
      const expression = buildMatchExpression(query) ?? '';
      expect(expression).toMatch(/^("[\p{L}\p{N}]+"\*? ?)+$/u);
      expect((expression.match(/\*/g) ?? []).length).toBeLessThanOrEqual(1);
    }
  });
});

describe('index sync', () => {
  it('indexes a new recipe with its ingredient text', () => {
    const id = add({ title: 'Tomato soup', cuisine: 'Italian', description: 'Warm', ingredients: ['4 tomatoes', '1 onion'] });
    expect(ftsRows()).toEqual([
      { rowid: id, title: 'Tomato soup', cuisine: 'Italian', description: 'Warm', ingredients: ' 4 tomatoes 1 onion' },
    ]);
  });

  it('stores missing cuisine and description as empty text', () => {
    const id = add({ title: 'Toast' });
    expect(ftsRows()).toEqual([{ rowid: id, title: 'Toast', cuisine: '', description: '', ingredients: '' }]);
  });

  it('follows updates to the text and drops removed ingredients', () => {
    const id = add({ title: 'Soup', ingredients: ['1 onion', '2 carrots'] });
    updateRecipe(db, id, {
      title: 'Stew',
      cuisine: 'Irish',
      description: 'Hearty',
      sourceUrl: null,
      rating: null,
      ingredients: ['3 potatoes'],
      steps: [],
    });
    expect(ftsRows()).toEqual([
      { rowid: id, title: 'Stew', cuisine: 'Irish', description: 'Hearty', ingredients: ' 3 potatoes' },
    ]);
    expect(titles(search({ q: 'onion' }))).toEqual([]);
    expect(titles(search({ q: 'potato' }))).toEqual(['Stew']);
  });

  it('removes the entry when a recipe is deleted', () => {
    const id = add({ title: 'Soup', ingredients: ['1 onion'] });
    deleteRecipe(db, id);
    expect(ftsRows()).toEqual([]);
  });

  it('leaves the index alone when only the rating or image changes', () => {
    const id = add({ title: 'Soup', ingredients: ['1 onion'] });
    const before = ftsRows();
    setRecipeRating(db, id, 5);
    setRecipeImage(db, id, `${'a'.repeat(64)}.webp`);
    expect(ftsRows()).toEqual(before);
  });

  it('indexes recipes that existed before the search migration', () => {
    const source = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
    const early = makeTempDir('recipemixer-migrations-');
    for (const file of ['001_init.sql', '002_recipe_indexes.sql', '003_ingredient_index.sql']) {
      fs.copyFileSync(path.join(source, file), path.join(early, file));
    }
    const legacy = openMemoryDatabase();
    expect(migrate(legacy, early)).toBe(3);
    const { lastInsertRowid } = legacy
      .prepare("INSERT INTO recipe (title, cuisine) VALUES ('Old chili', 'Tex-Mex')")
      .run();
    legacy
      .prepare("INSERT INTO recipe_ingredient (recipe_id, position, raw_text) VALUES (?, 0, '1 lb ground beef')")
      .run(lastInsertRowid);

    expect(migrate(legacy)).toBeGreaterThanOrEqual(4);
    expect(legacy.prepare('SELECT title, cuisine, ingredients FROM recipe_fts').all()).toEqual([
      { title: 'Old chili', cuisine: 'Tex-Mex', ingredients: '1 lb ground beef' },
    ]);
    legacy.close();
  });
});

describe('search', () => {
  beforeEach(() => {
    add({ title: 'Tomato soup', cuisine: 'Italian', rating: 4, description: 'A warm bowl for cold days', ingredients: ['4 tomatoes', '1 onion', '1 tbsp basil'] });
    add({ title: 'Chicken curry', cuisine: 'Indian', rating: 5, ingredients: ['1 lb chicken', '2 onions', '1 tbsp curry powder'] });
    add({ title: 'Spaghetti', cuisine: 'italian', rating: null, description: 'Pasta with tomato sauce', ingredients: ['8 oz spaghetti', '1 cup tomato sauce'] });
    add({ title: 'Basil pesto', cuisine: 'Italian', rating: 3, ingredients: ['2 cups basil', '1/2 cup pine nuts'] });
    add({ title: 'Pancakes', cuisine: null, rating: 2, description: 'Add a little basil if you like', ingredients: ['2 cups flour'] });
  });

  it('finds recipes by title, cuisine, ingredient and description', () => {
    expect(titles(search({ q: 'curry' }))).toEqual(['Chicken curry']);
    expect(titles(search({ q: 'indian' }))).toEqual(['Chicken curry']);
    expect(titles(search({ q: 'pine nuts' }))).toEqual(['Basil pesto']);
    expect(titles(search({ q: 'warm bowl' }))).toEqual(['Tomato soup']);
  });

  it('matches word forms and accents', () => {
    expect(titles(search({ q: 'tomatoes' })).sort()).toEqual(['Spaghetti', 'Tomato soup']);
    add({ title: 'Crème brûlée' });
    expect(titles(search({ q: 'creme brulee' }))).toEqual(['Crème brûlée']);
  });

  it('matches the start of the last word while typing', () => {
    expect(titles(search({ q: 'chick' }))).toEqual(['Chicken curry']);
    expect(titles(search({ q: 'tomato sou' }))).toEqual(['Tomato soup']);
  });

  it('requires every typed word', () => {
    expect(titles(search({ q: 'tomato curry' }))).toEqual([]);
  });

  it('ranks a title hit above a description hit', () => {
    expect(titles(search({ q: 'basil' }))[0]).toBe('Basil pesto');
    expect(titles(search({ q: 'basil' }))).toHaveLength(3);
  });

  it('filters by cuisine without regard to case', () => {
    expect(titles(search({ cuisine: 'ITALIAN' })).sort()).toEqual(['Basil pesto', 'Spaghetti', 'Tomato soup']);
    expect(titles(search({ q: 'tomato', cuisine: 'italian' })).sort()).toEqual(['Spaghetti', 'Tomato soup']);
  });

  it('filters by minimum rating, leaving out unrated recipes', () => {
    expect(titles(search({ minRating: 4 })).sort()).toEqual(['Chicken curry', 'Tomato soup']);
    expect(titles(search({ minRating: 1 }))).not.toContain('Spaghetti');
  });

  it('combines text, cuisine and rating', () => {
    expect(titles(search({ q: 'basil', cuisine: 'Italian', minRating: 4 }))).toEqual(['Tomato soup']);
  });

  it('sorts by rating (best first, unrated last), title and newest', () => {
    expect(titles(search({ sort: 'rating' }))).toEqual(['Chicken curry', 'Tomato soup', 'Basil pesto', 'Pancakes', 'Spaghetti']);
    expect(titles(search({ sort: 'title' }))).toEqual(['Basil pesto', 'Chicken curry', 'Pancakes', 'Spaghetti', 'Tomato soup']);
    expect(titles(search({ sort: 'newest' }))[0]).toBe('Pancakes');
  });

  it('defaults to newest without a search and to relevance with one', () => {
    expect(titles(search({}))[0]).toBe('Pancakes');
    expect(titles(search({ q: 'basil' }))[0]).toBe('Basil pesto');
    expect(titles(search({ sort: 'relevance' }))[0]).toBe('Pancakes');
  });

  it('sorts search results by rating when asked', () => {
    expect(titles(search({ q: 'basil', sort: 'rating' }))).toEqual(['Tomato soup', 'Basil pesto', 'Pancakes']);
  });

  it('paginates search results and reports the total', () => {
    const first = search({ q: 'basil', limit: 2, offset: 0 });
    const second = search({ q: 'basil', limit: 2, offset: 2 });
    expect(first.total).toBe(3);
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect([...titles(first), ...titles(second)].sort()).toEqual(['Basil pesto', 'Pancakes', 'Tomato soup']);
  });

  it('returns nothing, not an error, when there are no words to search for', () => {
    expect(search({ q: '!!!' })).toEqual({ items: [], total: 0 });
  });

  it('treats search operators and SQL as ordinary text', () => {
    for (const q of ['soup OR curry', 'NEAR(soup curry)', 'title:soup', '"', "'); DROP TABLE recipe;--", 'soup*', '-soup', '(']) {
      expect(() => search({ q })).not.toThrow();
    }
    expect(titles(search({ q: 'soup OR curry' }))).toEqual([]);
    expect(search({}).total).toBe(5);
  });
});

describe('listCuisines', () => {
  it('lists distinct cuisines case-insensitively with counts, most used first', () => {
    add({ title: 'a', cuisine: 'Italian' });
    add({ title: 'b', cuisine: 'italian' });
    add({ title: 'c', cuisine: 'Italian' });
    add({ title: 'd', cuisine: 'Indian' });
    add({ title: 'e', cuisine: null });
    expect(listCuisines(db)).toEqual([
      { name: 'Italian', count: 3 },
      { name: 'Indian', count: 1 },
    ]);
  });

  it('is empty when no recipe has a cuisine', () => {
    add({ title: 'a' });
    expect(listCuisines(db)).toEqual([]);
  });
});
