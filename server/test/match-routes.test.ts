import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp } from './helpers.js';

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
});

async function seed() {
  app = await makeApp();
  const recipes = [
    { title: 'Fried eggs on toast', ingredients: ['2 eggs', '2 slices bread', '1 tbsp butter', 'salt and pepper'] },
    { title: 'Omelette', ingredients: ['3 eggs', '2 tbsp milk', '1 tbsp butter'] },
    { title: 'Onion soup', ingredients: ['4 onions', '2 tbsp butter', '4 cups beef broth'] },
  ];
  for (const recipe of recipes) {
    await app.inject({ method: 'POST', url: '/api/recipes', payload: recipe });
  }
}

describe('GET /api/match', () => {
  it('returns ranked matches with what is matched and missing', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/match?i=egg&i=bread&i=butter' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items[0].recipe.title).toBe('Fried eggs on toast');
    expect(body.items[0]).toMatchObject({ coverage: 1, matchedCount: 3, totalCount: 3, missing: [] });
    expect(body.usedIngredients).toEqual(['egg', 'bread', 'butter']);
    expect(body.assumeStaples).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(2);
  });

  it('accepts a single ingredient', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/match?i=onion' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((item: { recipe: { title: string } }) => item.recipe.title)).toEqual(['Onion soup']);
  });

  it('honours staples=0', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/match?i=egg&i=bread&i=butter&staples=0' });
    const toast = res.json().items.find((item: { recipe: { title: string } }) => item.recipe.title === 'Fried eggs on toast');
    expect(res.json().assumeStaples).toBe(false);
    expect(toast).toMatchObject({ totalCount: 4, missing: ['salt and pepper'] });
  });

  it('paginates', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/match?i=butter&limit=1&offset=1' });
    expect(res.json().items).toHaveLength(1);
    expect(res.json().total).toBe(3);
  });

  it('returns an empty list when nothing matches', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/match?i=dragonfruit' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });

  it('treats a hostile ingredient as plain text', async () => {
    await seed();
    const injection = encodeURIComponent("x'); DROP TABLE recipe;--");
    const res = await app.inject({ method: 'GET', url: `/api/match?i=${injection}` });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/recipes' });
    expect(list.json().total).toBe(3);
  });

  it.each([
    ['no ingredient', '/api/match'],
    ['an empty ingredient', '/api/match?i='],
    ['31 ingredients', `/api/match?${Array.from({ length: 31 }, (_, n) => `i=item${n}`).join('&')}`],
    ['a 61-character ingredient', `/api/match?i=${'a'.repeat(61)}`],
    ['minCoverage above 1', '/api/match?i=egg&minCoverage=2'],
    ['a negative minCoverage', '/api/match?i=egg&minCoverage=-0.1'],
    ['limit 0', '/api/match?i=egg&limit=0'],
    ['limit 101', '/api/match?i=egg&limit=101'],
    ['a negative offset', '/api/match?i=egg&offset=-1'],
    ['an unknown staples value', '/api/match?i=egg&staples=maybe'],
  ])('rejects %s with 400', async (_name, url) => {
    app = await makeApp();
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/^Invalid /);
  });

  it('accepts exactly 30 ingredients of 60 characters', async () => {
    app = await makeApp();
    const items = Array.from({ length: 30 }, (_, n) => `i=${'b'.repeat(59)}${n % 10}`).join('&');
    const res = await app.inject({ method: 'GET', url: `/api/match?${items}` });
    expect(res.statusCode).toBe(200);
  });

  it('is not confused with the recipe id route', async () => {
    app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/recipes/match' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/ingredients/suggest', () => {
  it('suggests known ingredient names by prefix, most common first', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/ingredients/suggest?q=o' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [{ name: 'onion', count: 1 }] });
  });

  it('returns nothing without a prefix', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/ingredients/suggest' });
    expect(res.json()).toEqual({ items: [] });
  });

  it('respects the limit', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/ingredients/suggest?q=b&limit=1' });
    expect(res.json().items).toHaveLength(1);
  });

  it.each(['/api/ingredients/suggest?limit=0', '/api/ingredients/suggest?limit=21', `/api/ingredients/suggest?q=${'a'.repeat(41)}`])(
    'rejects %s',
    async (url) => {
      app = await makeApp();
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400);
    },
  );
});
