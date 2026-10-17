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
    { title: 'Tomato soup', cuisine: 'Italian', rating: 4, ingredients: ['4 tomatoes', '1 onion'] },
    { title: 'Chicken curry', cuisine: 'Indian', rating: 5, ingredients: ['1 lb chicken', '1 tbsp curry powder'] },
    { title: 'Spaghetti', cuisine: 'Italian', ingredients: ['8 oz spaghetti', '1 cup tomato sauce'] },
    { title: 'Pancakes', ingredients: ['2 cups flour'] },
  ];
  for (const recipe of recipes) await app.inject({ method: 'POST', url: '/api/recipes', payload: recipe });
}

async function list(query: string) {
  const res = await app.inject({ method: 'GET', url: `/api/recipes${query}` });
  return { status: res.statusCode, body: res.json(), titles: (res.json().items ?? []).map((item: { title: string }) => item.title) };
}

describe('GET /api/recipes search', () => {
  it('searches title, cuisine and ingredients', async () => {
    await seed();
    expect((await list('?q=curry')).titles).toEqual(['Chicken curry']);
    expect((await list('?q=indian')).titles).toEqual(['Chicken curry']);
    expect((await list('?q=flour')).titles).toEqual(['Pancakes']);
    expect((await list('?q=tomato')).titles.sort()).toEqual(['Spaghetti', 'Tomato soup']);
  });

  it('matches the start of the last word and word forms', async () => {
    await seed();
    expect((await list('?q=chick')).titles).toEqual(['Chicken curry']);
    expect((await list('?q=tomatoes')).titles.sort()).toEqual(['Spaghetti', 'Tomato soup']);
  });

  it('filters by cuisine and minimum rating and combines them with the search', async () => {
    await seed();
    expect((await list('?cuisine=italian')).titles.sort()).toEqual(['Spaghetti', 'Tomato soup']);
    expect((await list('?minRating=5')).titles).toEqual(['Chicken curry']);
    expect((await list('?q=tomato&cuisine=Italian&minRating=4')).titles).toEqual(['Tomato soup']);
  });

  it('sorts by rating and by title', async () => {
    await seed();
    expect((await list('?sort=rating')).titles).toEqual(['Chicken curry', 'Tomato soup', 'Pancakes', 'Spaghetti']);
    expect((await list('?sort=title')).titles).toEqual(['Chicken curry', 'Pancakes', 'Spaghetti', 'Tomato soup']);
  });

  it('reports the total and paginates', async () => {
    await seed();
    const page = await list('?q=tomato&limit=1&offset=1');
    expect(page.body.total).toBe(2);
    expect(page.titles).toHaveLength(1);
  });

  it('treats an empty parameter as not given', async () => {
    await seed();
    const all = await list('?q=&cuisine=&minRating=&sort=');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(4);
  });

  it('returns an empty list, not an error, for text with no searchable words', async () => {
    await seed();
    const none = await list(`?q=${encodeURIComponent('!!!')}`);
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ items: [], total: 0 });
  });

  it.each(['soup OR curry', 'NEAR(soup curry)', 'title:soup', '"', "'); DROP TABLE recipe;--", 'soup*', '-soup', '('])(
    'treats %j as ordinary text',
    async (q) => {
      await seed();
      const result = await list(`?q=${encodeURIComponent(q)}`);
      expect(result.status).toBe(200);
      expect((await list('')).body.total).toBe(4);
    },
  );

  it.each([
    ['minRating 0', '?minRating=0'],
    ['minRating 6', '?minRating=6'],
    ['minRating text', '?minRating=high'],
    ['minRating fraction', '?minRating=2.5'],
    ['unknown sort', '?sort=random'],
    ['a 101-character query', `?q=${'a'.repeat(101)}`],
    ['an 81-character cuisine', `?cuisine=${'a'.repeat(81)}`],
  ])('rejects %s with 400', async (_name, query) => {
    app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/recipes${query}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/^Invalid /);
  });
});

describe('index stays in step through the API', () => {
  it('follows edits and deletes', async () => {
    await seed();
    await app.inject({
      method: 'PUT',
      url: '/api/recipes/4',
      payload: { title: 'Waffles', ingredients: ['2 cups flour', '1 egg'] },
    });
    expect((await list('?q=pancakes')).titles).toEqual([]);
    expect((await list('?q=waffle')).titles).toEqual(['Waffles']);
    expect((await list('?q=egg')).titles).toEqual(['Waffles']);

    await app.inject({ method: 'DELETE', url: '/api/recipes/4' });
    expect((await list('?q=waffle')).titles).toEqual([]);
  });
});

describe('GET /api/cuisines', () => {
  it('lists cuisines with counts', async () => {
    await seed();
    const res = await app.inject({ method: 'GET', url: '/api/cuisines' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [
        { name: 'Italian', count: 2 },
        { name: 'Indian', count: 1 },
      ],
    });
  });

  it('is empty without recipes', async () => {
    app = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/cuisines' })).json()).toEqual({ items: [] });
  });
});

describe('PATCH /api/recipes/:id/rating', () => {
  const patch = (id: number | string, payload?: unknown) =>
    app.inject({ method: 'PATCH', url: `/api/recipes/${id}/rating`, payload: payload as object });

  it('sets and clears the rating and returns the recipe', async () => {
    await seed();
    const set = await patch(4, { rating: 3 });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ id: 4, title: 'Pancakes', rating: 3 });

    const cleared = await patch(4, { rating: null });
    expect(cleared.json().rating).toBeNull();
  });

  it('changes the order when sorting by rating, without disturbing search', async () => {
    await seed();
    await patch(4, { rating: 5 });
    expect((await list('?sort=rating')).titles.slice(0, 2).sort()).toEqual(['Chicken curry', 'Pancakes']);
    expect((await list('?q=flour')).titles).toEqual(['Pancakes']);
  });

  it.each([
    ['zero', { rating: 0 }],
    ['six', { rating: 6 }],
    ['a fraction', { rating: 2.5 }],
    ['text', { rating: '5' }],
    ['missing', {}],
    ['an extra field', { rating: 3, title: 'x' }],
  ])('rejects %s with 400', async (_name, payload) => {
    await seed();
    expect((await patch(1, payload)).statusCode).toBe(400);
  });

  it('rejects a request without a body', async () => {
    await seed();
    const res = await app.inject({ method: 'PATCH', url: '/api/recipes/1/rating' });
    expect(res.statusCode).toBe(400);
  });

  it.each(['99', 'abc', '0'])('returns 404 for recipe %s', async (id) => {
    await seed();
    expect((await patch(id, { rating: 3 })).statusCode).toBe(404);
  });
});
