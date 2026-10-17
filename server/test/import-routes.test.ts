import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { openMemoryDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { badGateway, unprocessable } from '../src/errors.js';
import { FETCH_FAILED, type FetchedBody, type SafeFetcher } from '../src/services/safe-fetch.js';
import { testConfig, tinyPng } from './helpers.js';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

const RECIPE_PAGE = `<html><head><script type="application/ld+json">${JSON.stringify({
  '@type': 'Recipe',
  name: 'Tomato Soup',
  recipeCuisine: 'Italian',
  recipeIngredient: ['2 tomatoes', '1 onion'],
  recipeInstructions: ['Chop.', 'Simmer.'],
  image: '/img/soup.jpg',
})}</script></head><body></body></html>`;

function page(html: string, url = 'https://food.example/soup'): FetchedBody {
  return { url: new URL(url), contentType: 'text/html; charset=utf-8', body: Buffer.from(html) };
}

function fakeFetcher(overrides: Partial<SafeFetcher> = {}) {
  const defaultImage = async (): Promise<FetchedBody> => ({
    url: new URL('https://food.example/img/soup.jpg'),
    contentType: 'image/png',
    body: await tinyPng(),
  });
  return {
    fetchPage: vi.fn(overrides.fetchPage ?? (async () => page(RECIPE_PAGE))),
    fetchImage: vi.fn(overrides.fetchImage ?? defaultImage),
    fetchJson: vi.fn(overrides.fetchJson ?? (async () => ({}))),
  };
}

async function makeImportApp(fetcher?: SafeFetcher, overrides: Parameters<typeof testConfig>[0] = {}) {
  const db = openMemoryDatabase();
  migrate(db);
  app = await buildApp({ config: testConfig(overrides), db, fetcher });
  return app;
}

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });

async function createRecipe(extra: Record<string, unknown> = {}) {
  const res = await post('/api/recipes', { title: 'Saved', ingredients: ['1 egg'], steps: ['Cook'], ...extra });
  return res.json() as { id: number; imageUrl: string | null };
}

describe('POST /api/import/preview', () => {
  it('returns the draft, the photo address and the final source link without saving anything', async () => {
    const fetcher = fakeFetcher();
    await makeImportApp(fetcher);

    const res = await post('/api/import/preview', { url: ' https://food.example/soup ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      draft: {
        title: 'Tomato Soup',
        cuisine: 'Italian',
        description: null,
        ingredients: ['2 tomatoes', '1 onion'],
        steps: ['Chop.', 'Simmer.'],
      },
      imageUrl: 'https://food.example/img/soup.jpg',
      sourceUrl: 'https://food.example/soup',
      existingRecipeId: null,
    });
    expect(fetcher.fetchPage).toHaveBeenCalledWith('https://food.example/soup');
    expect(fetcher.fetchImage).not.toHaveBeenCalled();

    const list = await app.inject({ method: 'GET', url: '/api/recipes' });
    expect(list.json().total).toBe(0);
  });

  it('reports a recipe that already uses the same source link', async () => {
    await makeImportApp(fakeFetcher());
    const saved = await createRecipe({ sourceUrl: 'https://food.example/soup' });

    const res = await post('/api/import/preview', { url: 'https://food.example/soup' });
    expect(res.json().existingRecipeId).toBe(saved.id);
  });

  it('uses the address after redirects as the source link', async () => {
    const fetcher = fakeFetcher({ fetchPage: vi.fn(async () => page(RECIPE_PAGE, 'https://food.example/final?id=1')) });
    await makeImportApp(fetcher);
    const res = await post('/api/import/preview', { url: 'https://short.example/x' });
    expect(res.json().sourceUrl).toBe('https://food.example/final?id=1');
  });

  it('decodes a page using the charset it declares', async () => {
    const html = RECIPE_PAGE.replace('Tomato Soup', 'Crème brûlée');
    const fetcher = fakeFetcher({
      fetchPage: vi.fn(async () => ({
        url: new URL('https://food.example/x'),
        contentType: 'text/html; charset=iso-8859-1',
        body: Buffer.from(html, 'latin1'),
      })),
    });
    await makeImportApp(fetcher);
    const res = await post('/api/import/preview', { url: 'https://food.example/x' });
    expect(res.json().draft.title).toBe('Crème brûlée');
  });

  it('answers 422 when the page has no recipe data', async () => {
    await makeImportApp(fakeFetcher({ fetchPage: vi.fn(async () => page('<html><body>No recipe</body></html>')) }));
    const res = await post('/api/import/preview', { url: 'https://food.example/blog' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('No recipe data found on that page');
  });

  it('passes through the fetcher’s own safe errors', async () => {
    await makeImportApp(fakeFetcher({ fetchPage: vi.fn(async () => Promise.reject(unprocessable('That address is not a web page'))) }));
    const notPage = await post('/api/import/preview', { url: 'https://food.example/menu.pdf' });
    expect(notPage.statusCode).toBe(422);

    await makeImportApp(fakeFetcher({ fetchPage: vi.fn(async () => Promise.reject(badGateway(FETCH_FAILED))) }));
    const failed = await post('/api/import/preview', { url: 'https://food.example/down' });
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error).toBe(FETCH_FAILED);
  });

  it('validates the body strictly and never echoes it', async () => {
    const fetcher = fakeFetcher();
    await makeImportApp(fetcher);

    for (const body of [undefined, {}, { url: '' }, { url: '   ' }, { url: 42 }, { url: ['a'] }, { url: 'https://x.example/', extra: 1 }, { url: 'a'.repeat(2049) }]) {
      const res = await post('/api/import/preview', body);
      expect(res.statusCode).toBe(400);
    }
    const secret = await post('/api/import/preview', { url: 'https://x.example/', secret: 'hunter2' });
    expect(secret.body).not.toContain('hunter2');
    expect(fetcher.fetchPage).not.toHaveBeenCalled();
  });

  it('with the real guarded fetcher, refuses private targets without detail and bad schemes with a hint', async () => {
    await makeImportApp();
    for (const url of ['http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://10.0.0.1/', 'http://2130706433/']) {
      const res = await post('/api/import/preview', { url });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: FETCH_FAILED });
    }
  });

  it('with the real guarded fetcher, rejects unusable addresses with a hint about the address', async () => {
    await makeImportApp();
    for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'http://example.com:8080/', 'http://user:pw@example.com/', 'not a url']) {
      const res = await post('/api/import/preview', { url });
      expect(res.statusCode).toBe(400);
    }
  });

  it('is rate limited to ten calls a minute', async () => {
    await makeImportApp(fakeFetcher());
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await post('/api/import/preview', { url: 'https://food.example/soup' })).statusCode);
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('allows only two imports at once', async () => {
    const release: Array<() => void> = [];
    const fetcher = fakeFetcher({
      fetchPage: vi.fn(() => new Promise<FetchedBody>((resolve) => release.push(() => resolve(page(RECIPE_PAGE))))),
    });
    await makeImportApp(fetcher);

    const first = post('/api/import/preview', { url: 'https://food.example/a' });
    const second = post('/api/import/preview', { url: 'https://food.example/b' });
    await vi.waitFor(() => expect(release).toHaveLength(2));

    const third = await post('/api/import/preview', { url: 'https://food.example/c' });
    expect(third.statusCode).toBe(429);

    release.forEach((resolve) => resolve());
    expect((await first).statusCode).toBe(200);
    expect((await second).statusCode).toBe(200);

    const next = post('/api/import/preview', { url: 'https://food.example/d' });
    await vi.waitFor(() => expect(release).toHaveLength(3));
    release[2]!();
    expect((await next).statusCode).toBe(200);
  });

  it('frees its slot when a fetch fails', async () => {
    const fetcher = fakeFetcher({ fetchPage: vi.fn(async () => Promise.reject(badGateway(FETCH_FAILED))) });
    await makeImportApp(fetcher);
    for (let i = 0; i < 4; i++) {
      expect((await post('/api/import/preview', { url: 'https://food.example/x' })).statusCode).toBe(502);
    }
  });

  it('does not exist when URL import is switched off', async () => {
    const fetcher = fakeFetcher();
    await makeImportApp(fetcher, { urlImportEnabled: false });
    const saved = await createRecipe();

    expect((await post('/api/import/preview', { url: 'https://food.example/soup' })).statusCode).toBe(404);
    expect((await post(`/api/recipes/${saved.id}/image/from-url`, { url: 'https://food.example/a.png' })).statusCode).toBe(404);
    expect(fetcher.fetchPage).not.toHaveBeenCalled();
  });
});

describe('POST /api/recipes/:id/image/from-url', () => {
  it('downloads the photo, re-encodes it and attaches it to the recipe', async () => {
    const fetcher = fakeFetcher();
    await makeImportApp(fetcher);
    const saved = await createRecipe();

    const res = await post(`/api/recipes/${saved.id}/image/from-url`, { url: 'https://food.example/img/soup.jpg' });
    expect(res.statusCode).toBe(200);
    const { imageUrl } = res.json() as { imageUrl: string };
    expect(imageUrl).toMatch(/^\/api\/images\/[a-f0-9]{64}\.webp$/);
    expect(fetcher.fetchImage).toHaveBeenCalledWith('https://food.example/img/soup.jpg');

    const served = await app.inject({ method: 'GET', url: imageUrl });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
  });

  it('replaces an existing photo and removes the old file when nothing else uses it', async () => {
    const fetcher = fakeFetcher();
    await makeImportApp(fetcher);
    const saved = await createRecipe();

    fetcher.fetchImage.mockResolvedValueOnce({ url: new URL('https://f.example/1.png'), contentType: 'image/png', body: await tinyPng(20, 10, 10) });
    const first = (await post(`/api/recipes/${saved.id}/image/from-url`, { url: 'https://f.example/1.png' })).json() as { imageUrl: string };

    fetcher.fetchImage.mockResolvedValueOnce({ url: new URL('https://f.example/2.png'), contentType: 'image/png', body: await tinyPng(30, 30, 250) });
    const second = (await post(`/api/recipes/${saved.id}/image/from-url`, { url: 'https://f.example/2.png' })).json() as { imageUrl: string };

    expect(second.imageUrl).not.toBe(first.imageUrl);
    expect((await app.inject({ method: 'GET', url: first.imageUrl })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: second.imageUrl })).statusCode).toBe(200);
  });

  it('refuses anything that is not a JPEG, PNG or WebP, whatever the server claimed', async () => {
    const cases: Buffer[] = [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      Buffer.from('<html>not an image</html>'),
      Buffer.from('GIF89a\u0001\u0000\u0001\u0000'),
      Buffer.alloc(0),
    ];
    for (const body of cases) {
      const fetcher = fakeFetcher({ fetchImage: vi.fn(async () => ({ url: new URL('https://f.example/x'), contentType: 'image/png', body })) });
      await makeImportApp(fetcher);
      const saved = await createRecipe();
      const res = await post(`/api/recipes/${saved.id}/image/from-url`, { url: 'https://f.example/x' });
      expect([400, 415]).toContain(res.statusCode);
      const after = await app.inject({ method: 'GET', url: `/api/recipes/${saved.id}` });
      expect(after.json().imageUrl).toBeNull();
    }
  });

  it('answers 404 for an unknown or malformed recipe id without fetching anything', async () => {
    const fetcher = fakeFetcher();
    await makeImportApp(fetcher);
    for (const id of ['999', '0', 'abc', '1e3']) {
      const res = await post(`/api/recipes/${id}/image/from-url`, { url: 'https://f.example/x.png' });
      expect(res.statusCode).toBe(404);
    }
    expect(fetcher.fetchImage).not.toHaveBeenCalled();
  });

  it('validates the body and passes through fetch failures', async () => {
    const fetcher = fakeFetcher();
    await makeImportApp(fetcher);
    const saved = await createRecipe();
    expect((await post(`/api/recipes/${saved.id}/image/from-url`, {})).statusCode).toBe(400);
    expect(fetcher.fetchImage).not.toHaveBeenCalled();

    fetcher.fetchImage.mockRejectedValueOnce(badGateway(FETCH_FAILED));
    const res = await post(`/api/recipes/${saved.id}/image/from-url`, { url: 'https://f.example/x.png' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe(FETCH_FAILED);
  });

  it('with the real guarded fetcher, refuses a private photo address', async () => {
    await makeImportApp();
    const saved = await createRecipe();
    const res = await post(`/api/recipes/${saved.id}/image/from-url`, { url: 'http://169.254.169.254/latest/meta-data/' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: FETCH_FAILED });
  });
});
