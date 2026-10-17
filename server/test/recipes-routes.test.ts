import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp } from './helpers.js';

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
});

const valid = {
  title: 'Tomato soup',
  cuisine: 'Italian',
  description: 'Warm.',
  sourceUrl: 'https://example.com/soup',
  rating: 4,
  ingredients: ['4 tomatoes', '1 onion'],
  steps: ['Chop', 'Simmer'],
};

async function create(body: unknown = valid) {
  return app.inject({ method: 'POST', url: '/api/recipes', payload: body as object });
}

describe('POST /api/recipes', () => {
  it('creates a recipe and returns its detail', async () => {
    app = await makeApp();
    const res = await create();
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ...valid, id: 1, imageUrl: null });
  });

  it('accepts a minimal recipe', async () => {
    app = await makeApp();
    const res = await create({ title: 'Toast' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ title: 'Toast', ingredients: [], steps: [], rating: null });
  });

  it.each([
    ['empty title', { title: '' }],
    ['missing title', {}],
    ['rating 6', { title: 'x', rating: 6 }],
    ['javascript URL', { title: 'x', sourceUrl: 'javascript:alert(1)' }],
    ['unknown field', { title: 'x', isAdmin: true }],
    ['too many ingredients', { title: 'x', ingredients: Array.from({ length: 101 }, () => 'a') }],
  ])('rejects %s with 400', async (_name, body) => {
    app = await makeApp();
    const res = await create(body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/^Invalid /);
  });

  it('rejects a request without a body', async () => {
    app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/recipes' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects plain text bodies as invalid and unsupported content types with 415', async () => {
    app = await makeApp();
    const text = await app.inject({
      method: 'POST',
      url: '/api/recipes',
      payload: 'title=x',
      headers: { 'content-type': 'text/plain' },
    });
    expect(text.statusCode).toBe(400);
    const xml = await app.inject({
      method: 'POST',
      url: '/api/recipes',
      payload: '<recipe/>',
      headers: { 'content-type': 'application/xml' },
    });
    expect(xml.statusCode).toBe(415);
  });

  it('stores script-like text as plain data', async () => {
    app = await makeApp();
    const title = '<img src=x onerror=alert(1)>';
    const res = await create({ title });
    expect(res.json().title).toBe(title);
    const fetched = await app.inject({ method: 'GET', url: '/api/recipes/1' });
    expect(fetched.headers['content-type']).toContain('application/json');
    expect(fetched.json().title).toBe(title);
  });
});

describe('GET /api/recipes', () => {
  it('lists newest first with a total', async () => {
    app = await makeApp();
    await create({ title: 'First' });
    await create({ title: 'Second' });
    const res = await app.inject({ method: 'GET', url: '/api/recipes' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.items.map((item: { title: string }) => item.title)).toEqual(['Second', 'First']);
    expect(body.items[0]).not.toHaveProperty('ingredients');
  });

  it('paginates', async () => {
    app = await makeApp();
    for (let i = 1; i <= 5; i++) await create({ title: `Recipe ${i}` });
    const res = await app.inject({ method: 'GET', url: '/api/recipes?limit=2&offset=4' });
    expect(res.json().items).toHaveLength(1);
    expect(res.json().total).toBe(5);
  });

  it('returns an empty list', async () => {
    app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/recipes' });
    expect(res.json()).toEqual({ items: [], total: 0 });
  });

  it.each(['limit=0', 'limit=101', 'offset=-1', 'limit=abc'])('rejects %s', async (query) => {
    app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/recipes?${query}` });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/recipes/:id', () => {
  it('returns the recipe', async () => {
    app = await makeApp();
    await create();
    const res = await app.inject({ method: 'GET', url: '/api/recipes/1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'Tomato soup', ingredients: ['4 tomatoes', '1 onion'] });
  });

  it.each(['999', 'abc', '0', '-1', '1.5', '99999999999', '1;DROP'])('returns 404 for id %s', async (id) => {
    app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/api/recipes/${id}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Recipe not found' });
  });
});

describe('PUT /api/recipes/:id', () => {
  it('replaces the recipe', async () => {
    app = await makeApp();
    await create();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/recipes/1',
      payload: { title: 'Better soup', rating: 5, ingredients: ['5 tomatoes'], steps: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      title: 'Better soup',
      rating: 5,
      cuisine: null,
      ingredients: ['5 tomatoes'],
      steps: [],
    });
  });

  it('returns 404 for a missing recipe and 400 for invalid input', async () => {
    app = await makeApp();
    const missing = await app.inject({ method: 'PUT', url: '/api/recipes/5', payload: { title: 'x' } });
    expect(missing.statusCode).toBe(404);
    await create();
    const invalid = await app.inject({ method: 'PUT', url: '/api/recipes/1', payload: { title: '' } });
    expect(invalid.statusCode).toBe(400);
  });
});

describe('DELETE /api/recipes/:id', () => {
  it('deletes and then reports not found', async () => {
    app = await makeApp();
    await create();
    const res = await app.inject({ method: 'DELETE', url: '/api/recipes/1' });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect((await app.inject({ method: 'GET', url: '/api/recipes/1' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/recipes/1' })).statusCode).toBe(404);
  });
});
