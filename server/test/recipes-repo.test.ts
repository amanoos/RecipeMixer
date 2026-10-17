import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import {
  countImageReferences,
  createRecipe,
  deleteRecipe,
  findRecipeIdBySourceUrl,
  getRecipe,
  listRecipes,
  setRecipeImage,
  updateRecipe,
} from '../src/db/recipes.js';
import type { RecipeInput } from '../src/schemas/recipe.js';

let db: Db;

beforeEach(() => {
  db = openMemoryDatabase();
  migrate(db);
});

afterEach(() => {
  db.close();
});

function input(overrides: Partial<RecipeInput> = {}): RecipeInput {
  return {
    title: 'Tomato soup',
    cuisine: 'Italian',
    description: 'Warm.',
    sourceUrl: 'https://example.com/soup',
    rating: 4,
    ingredients: ['4 tomatoes', '1 onion', '2 cups stock'],
    steps: ['Chop', 'Simmer'],
    ...overrides,
  };
}

const HASH_A = `${'a'.repeat(64)}.webp`;
const HASH_B = `${'b'.repeat(64)}.webp`;

describe('createRecipe and getRecipe', () => {
  it('round-trips a recipe with ingredient and step order preserved', () => {
    const id = createRecipe(db, input());
    const recipe = getRecipe(db, id);
    expect(recipe).toMatchObject({
      id,
      title: 'Tomato soup',
      cuisine: 'Italian',
      description: 'Warm.',
      sourceUrl: 'https://example.com/soup',
      rating: 4,
      imageUrl: null,
      ingredients: ['4 tomatoes', '1 onion', '2 cups stock'],
      steps: ['Chop', 'Simmer'],
    });
  });

  it('stores a minimal recipe with nulls and empty lists', () => {
    const id = createRecipe(
      db,
      input({ cuisine: null, description: null, sourceUrl: null, rating: null, ingredients: [], steps: [] }),
    );
    expect(getRecipe(db, id)).toMatchObject({ cuisine: null, rating: null, ingredients: [], steps: [] });
  });

  it('returns undefined for a missing recipe', () => {
    expect(getRecipe(db, 999)).toBeUndefined();
  });

  it('round-trips unicode and markup-like text unchanged', () => {
    const id = createRecipe(db, input({ title: 'Crème brûlée 🍮 <script>alert(1)</script>' }));
    expect(getRecipe(db, id)?.title).toBe('Crème brûlée 🍮 <script>alert(1)</script>');
  });

  it('keeps SQL metacharacters inert', () => {
    const id = createRecipe(db, input({ title: "Robert'); DROP TABLE recipe;--" }));
    expect(getRecipe(db, id)?.title).toBe("Robert'); DROP TABLE recipe;--");
    expect(listRecipes(db, { limit: 10, offset: 0 }).total).toBe(1);
  });
});

describe('listRecipes', () => {
  it('returns newest first with the total count', () => {
    const first = createRecipe(db, input({ title: 'First' }));
    const second = createRecipe(db, input({ title: 'Second' }));
    const { items, total } = listRecipes(db, { limit: 10, offset: 0 });
    expect(total).toBe(2);
    expect(items.map((item) => item.id)).toEqual([second, first]);
    expect(items[0]).not.toHaveProperty('ingredients');
  });

  it('paginates', () => {
    for (let i = 1; i <= 30; i++) createRecipe(db, input({ title: `Recipe ${i}` }));
    const page = listRecipes(db, { limit: 10, offset: 25 });
    expect(page.total).toBe(30);
    expect(page.items).toHaveLength(5);
  });

  it('returns an empty list when there are no recipes', () => {
    expect(listRecipes(db, { limit: 24, offset: 0 })).toEqual({ items: [], total: 0 });
  });
});

describe('updateRecipe', () => {
  it('replaces fields, ingredients and steps', () => {
    const id = createRecipe(db, input());
    const updated = updateRecipe(
      db,
      id,
      input({ title: 'Better soup', rating: 5, ingredients: ['5 tomatoes'], steps: ['Blend'] }),
    );
    expect(updated).toBe(true);
    expect(getRecipe(db, id)).toMatchObject({
      title: 'Better soup',
      rating: 5,
      ingredients: ['5 tomatoes'],
      steps: ['Blend'],
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM recipe_ingredient').get()).toEqual({ n: 1 });
  });

  it('returns false for a missing recipe and changes nothing', () => {
    createRecipe(db, input());
    expect(updateRecipe(db, 999, input({ title: 'Ghost' }))).toBe(false);
    expect(listRecipes(db, { limit: 10, offset: 0 }).total).toBe(1);
  });

  it('keeps the existing image', () => {
    const id = createRecipe(db, input());
    setRecipeImage(db, id, HASH_A);
    updateRecipe(db, id, input({ title: 'Renamed' }));
    expect(getRecipe(db, id)?.imageUrl).toBe(`/api/images/${HASH_A}`);
  });
});

describe('deleteRecipe', () => {
  it('removes the recipe and its children and returns the image filename', () => {
    const id = createRecipe(db, input());
    setRecipeImage(db, id, HASH_A);
    expect(deleteRecipe(db, id)).toEqual({ deleted: true, imagePath: HASH_A });
    expect(getRecipe(db, id)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM recipe_ingredient').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM recipe_step').get()).toEqual({ n: 0 });
  });

  it('reports a missing recipe', () => {
    expect(deleteRecipe(db, 999)).toEqual({ deleted: false, imagePath: null });
  });

  it('returns a null image path when the recipe had no image', () => {
    const id = createRecipe(db, input());
    expect(deleteRecipe(db, id)).toEqual({ deleted: true, imagePath: null });
  });
});

describe('images', () => {
  it('sets, replaces and clears the image, reporting the previous one', () => {
    const id = createRecipe(db, input());
    expect(setRecipeImage(db, id, HASH_A)).toEqual({ updated: true, previous: null });
    expect(setRecipeImage(db, id, HASH_B)).toEqual({ updated: true, previous: HASH_A });
    expect(setRecipeImage(db, id, null)).toEqual({ updated: true, previous: HASH_B });
    expect(getRecipe(db, id)?.imageUrl).toBeNull();
  });

  it('reports a missing recipe', () => {
    expect(setRecipeImage(db, 999, HASH_A)).toEqual({ updated: false, previous: null });
  });

  it('counts recipes that share an image file', () => {
    const one = createRecipe(db, input({ title: 'One' }));
    const two = createRecipe(db, input({ title: 'Two' }));
    setRecipeImage(db, one, HASH_A);
    setRecipeImage(db, two, HASH_A);
    expect(countImageReferences(db, HASH_A)).toBe(2);
    deleteRecipe(db, one);
    expect(countImageReferences(db, HASH_A)).toBe(1);
    expect(countImageReferences(db, HASH_B)).toBe(0);
  });
});

describe('findRecipeIdBySourceUrl', () => {
  it('finds the oldest recipe saved from exactly that address', () => {
    const first = createRecipe(db, input({ title: 'First', sourceUrl: 'https://food.example/soup' }));
    createRecipe(db, input({ title: 'Second', sourceUrl: 'https://food.example/soup' }));
    createRecipe(db, input({ title: 'Other', sourceUrl: 'https://food.example/stew' }));
    expect(findRecipeIdBySourceUrl(db, 'https://food.example/soup')).toBe(first);
  });

  it('returns null for an unknown, similar or empty address', () => {
    createRecipe(db, input({ sourceUrl: 'https://food.example/soup' }));
    createRecipe(db, input({ sourceUrl: null }));
    expect(findRecipeIdBySourceUrl(db, 'https://food.example/soup/')).toBeNull();
    expect(findRecipeIdBySourceUrl(db, 'https://FOOD.example/soup')).toBeNull();
    expect(findRecipeIdBySourceUrl(db, '')).toBeNull();
  });

  it('treats the address as data, never as SQL', () => {
    createRecipe(db, input({ sourceUrl: 'https://food.example/soup' }));
    expect(findRecipeIdBySourceUrl(db, "x' OR '1'='1")).toBeNull();
  });
});
