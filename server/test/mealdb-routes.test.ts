import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { openMemoryDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { badGateway } from '../src/errors.js';
import { FETCH_FAILED, type SafeFetcher } from '../src/services/safe-fetch.js';
import { testConfig, tinyPng } from './helpers.js';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

const KEY = 'secret-supporter-key';

const meal = (overrides: Record<string, unknown> = {}) => ({
  idMeal: '52772',
  strMeal: 'Teriyaki Chicken Casserole',
  strCategory: 'Chicken',
  strArea: 'Japanese',
  strInstructions: 'Preheat oven.\r\nBake.',
  strMealThumb: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg',
  strTags: null,
  strIngredient1: 'soy sauce',
  strMeasure1: '3/4 cup',
  strIngredient2: 'chicken breasts',
  strMeasure2: '2',
  ...overrides,
});

function fakeFetcher(fetchJson: SafeFetcher['fetchJson']) {
  return {
    fetchPage: vi.fn(async () => {
      throw new Error('not used');
    }),
    fetchImage: vi.fn(async () => ({ url: new URL('https://www.themealdb.com/x.jpg'), contentType: 'image/png', body: await tinyPng() })),
    fetchJson: vi.fn(fetchJson),
  };
}

async function start(
  fetcher: SafeFetcher,
  overrides: Parameters<typeof testConfig>[0] = {},
  logStream?: NodeJS.WritableStream,
) {
  const db = openMemoryDatabase();
  migrate(db);
  app = await buildApp({
    config: testConfig({ mealdbEnabled: true, mealdbApiKey: KEY, ...overrides }),
    db,
    fetcher,
    logStream,
  });
  return app;
}

const get = (url: string) => app.inject({ method: 'GET', url });

describe('when TheMealDB is switched off', () => {
  it.each(['/api/mealdb/search?q=pasta', '/api/mealdb/meals/52772'])('answers 404 for %s and never fetches', async (url) => {
    const fetcher = fakeFetcher(async () => ({ meals: [meal()] }));
    await start(fetcher, { mealdbEnabled: false });
    expect((await get(url)).statusCode).toBe(404);
    expect(fetcher.fetchJson).not.toHaveBeenCalled();
  });

  it('reports the feature as off', async () => {
    await start(fakeFetcher(async () => ({})), { mealdbEnabled: false });
    expect((await get('/api/session')).json().features).toEqual({ mealdb: false, imageSearch: true });
  });
});

describe('GET /api/mealdb/search', () => {
  it('asks the official search endpoint with the encoded query and returns plain summaries', async () => {
    const fetcher = fakeFetcher(async () => ({ meals: [meal(), meal({ idMeal: '2', strMeal: 'Other' })] }));
    await start(fetcher);

    const res = await get('/api/mealdb/search?q=' + encodeURIComponent(' chicken & rice '));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [
        { id: '52772', title: 'Teriyaki Chicken Casserole', cuisine: 'Japanese', category: 'Chicken' },
        { id: '2', title: 'Other', cuisine: 'Japanese', category: 'Chicken' },
      ],
    });
    expect(fetcher.fetchJson).toHaveBeenCalledWith(
      `https://www.themealdb.com/api/json/v1/${KEY}/search.php?s=chicken%20%26%20rice`,
    );
  });

  it('reports the feature as on', async () => {
    await start(fakeFetcher(async () => ({})));
    expect((await get('/api/session')).json().features).toEqual({ mealdb: true, imageSearch: true });
  });

  it('gives an empty list when nothing matches', async () => {
    await start(fakeFetcher(async () => ({ meals: null })));
    const res = await get('/api/mealdb/search?q=zzzz');
    expect(res.json()).toEqual({ items: [] });
  });

  it.each(['', '?q=', '?q=a', `?q=${'a'.repeat(61)}`, '?q=%20%20'])('refuses the query %j without fetching', async (query) => {
    const fetcher = fakeFetcher(async () => ({ meals: [] }));
    await start(fetcher);
    const res = await get(`/api/mealdb/search${query}`);
    expect(res.statusCode).toBe(400);
    expect(fetcher.fetchJson).not.toHaveBeenCalled();
  });

  it('answers a generic 502 when TheMealDB cannot be reached, without the key', async () => {
    await start(
      fakeFetcher(async () => {
        throw badGateway(FETCH_FAILED);
      }),
    );
    const res = await get('/api/mealdb/search?q=pasta');
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain(KEY);
    expect(res.json().error).toBe(FETCH_FAILED);
  });

  it('is limited to two lookups at a time, shared with page imports', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetcher = fakeFetcher(async () => {
      await gate;
      return { meals: [] };
    });
    await start(fetcher);

    const pending = [get('/api/mealdb/search?q=one'), get('/api/mealdb/search?q=two')];
    await vi.waitFor(() => expect(fetcher.fetchJson).toHaveBeenCalledTimes(2));
    const refused = await get('/api/mealdb/search?q=three');
    expect(refused.statusCode).toBe(429);
    release();
    expect((await Promise.all(pending)).map((res) => res.statusCode)).toEqual([200, 200]);
  });
});

describe('GET /api/mealdb/meals/:id', () => {
  it('returns a reviewable draft with a link back and the photo address', async () => {
    const fetcher = fakeFetcher(async () => ({ meals: [meal()] }));
    await start(fetcher);

    const res = await get('/api/mealdb/meals/52772');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      draft: {
        title: 'Teriyaki Chicken Casserole',
        cuisine: 'Japanese',
        description: 'Category: Chicken',
        ingredients: ['3/4 cup soy sauce', '2 chicken breasts'],
        steps: ['Preheat oven.', 'Bake.'],
      },
      imageUrl: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg',
      sourceUrl: 'https://www.themealdb.com/meal/52772',
      existingRecipeId: null,
    });
    expect(fetcher.fetchJson).toHaveBeenCalledWith(`https://www.themealdb.com/api/json/v1/${KEY}/lookup.php?i=52772`);
  });

  it('points at a recipe that was already saved from the same meal', async () => {
    await start(fakeFetcher(async () => ({ meals: [meal()] })));
    const saved = await app.inject({
      method: 'POST',
      url: '/api/recipes',
      payload: { title: 'Mine', sourceUrl: 'https://www.themealdb.com/meal/52772', ingredients: ['1 egg'], steps: ['Cook'] },
    });
    const res = await get('/api/mealdb/meals/52772');
    expect(res.json().existingRecipeId).toBe(saved.json().id);
  });

  it('answers 404 when the service has no such meal, or sends a different one', async () => {
    await start(fakeFetcher(async () => ({ meals: null })));
    expect((await get('/api/mealdb/meals/999')).statusCode).toBe(404);
    await app.close();

    await start(fakeFetcher(async () => ({ meals: [meal({ idMeal: '111' })] })));
    expect((await get('/api/mealdb/meals/52772')).statusCode).toBe(404);
  });

  it('drops a photo address that is not on TheMealDB', async () => {
    await start(fakeFetcher(async () => ({ meals: [meal({ strMealThumb: 'http://169.254.169.254/latest/meta-data/' })] })));
    expect((await get('/api/mealdb/meals/52772')).json().imageUrl).toBeNull();
  });

  it.each(['abc', '1.5', '12345678901', '0x10', '%2e%2e', '1%2f2'])('refuses the id %j without fetching', async (id) => {
    const fetcher = fakeFetcher(async () => ({ meals: [meal()] }));
    await start(fetcher);
    const res = await get(`/api/mealdb/meals/${id}`);
    expect([400, 404]).toContain(res.statusCode);
    expect(fetcher.fetchJson).not.toHaveBeenCalled();
  });
});

describe('login and secrets', () => {
  it('needs a login for both routes when a password is set', async () => {
    const fetcher = fakeFetcher(async () => ({ meals: [meal()] }));
    await start(fetcher, { appPassword: 'correct horse battery staple' });
    expect((await get('/api/mealdb/search?q=pasta')).statusCode).toBe(401);
    expect((await get('/api/mealdb/meals/52772')).statusCode).toBe(401);
    expect(fetcher.fetchJson).not.toHaveBeenCalled();
  });

  it('keeps the API key out of every response and every log line', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    let calls = 0;
    await start(
      fakeFetcher(async () => {
        calls += 1;
        if (calls === 3) throw badGateway(FETCH_FAILED);
        return { meals: [meal()] };
      }),
      { logLevel: 'info' },
      stream,
    );

    const bodies = [
      (await get('/api/mealdb/search?q=pasta')).body,
      (await get('/api/mealdb/meals/52772')).body,
      (await get('/api/mealdb/search?q=fail')).body,
      (await get('/api/mealdb/meals/abc')).body,
    ];
    for (const body of bodies) expect(body).not.toContain(KEY);
    expect(lines.join('')).not.toContain(KEY);
  });
});

describe('the cap on simultaneous fetches', () => {
  it('is shared with page imports, so the two features cannot together exceed it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetcher = {
      ...fakeFetcher(async () => ({ meals: [] })),
      fetchPage: vi.fn(async () => {
        await gate;
        return { url: new URL('https://food.example/x'), contentType: 'text/html', body: Buffer.from('<html></html>') };
      }),
    };
    await start(fetcher);

    const imports = [1, 2].map((n) =>
      app.inject({ method: 'POST', url: '/api/import/preview', payload: { url: `https://food.example/${n}` } }),
    );
    await vi.waitFor(() => expect(fetcher.fetchPage).toHaveBeenCalledTimes(2));

    const refused = await get('/api/mealdb/search?q=pasta');
    expect(refused.statusCode).toBe(429);
    expect(fetcher.fetchJson).not.toHaveBeenCalled();

    release();
    await Promise.all(imports);
    expect((await get('/api/mealdb/search?q=pasta')).statusCode).toBe(200);
  });
});
