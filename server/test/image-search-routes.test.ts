import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { openMemoryDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { badGateway } from '../src/errors.js';
import { FETCH_FAILED, type SafeFetcher } from '../src/services/safe-fetch.js';
import { multipartBody, testConfig, tinyPng } from './helpers.js';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

const commonsPage = (n: number) => ({
  title: `File:Soup ${n}.jpg`,
  index: n,
  imageinfo: [
    {
      thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/c${n}.jpg`,
      width: 1600,
      height: 1200,
      mime: 'image/jpeg',
      descriptionurl: `https://commons.wikimedia.org/wiki/File:Soup_${n}.jpg`,
      extmetadata: { Artist: { value: `Author ${n}` }, LicenseShortName: { value: 'CC BY 2.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/2.0' } },
    },
  ],
});
const openverseItem = (n: number) => ({
  title: `Flickr soup ${n}`,
  creator: `Flickr ${n}`,
  license: 'by-sa',
  license_version: '2.0',
  license_url: 'https://creativecommons.org/licenses/by-sa/2.0/',
  foreign_landing_url: `https://www.flickr.com/photos/1/${n}`,
  url: `https://live.staticflickr.com/o${n}.jpg`,
  width: 1024,
  height: 768,
});

const providerAnswer = (url: string, counts = { commons: 4, openverse: 4 }) =>
  new URL(url).hostname === 'commons.wikimedia.org'
    ? { query: { pages: Array.from({ length: counts.commons }, (_, n) => commonsPage(n + 1)) } }
    : { results: Array.from({ length: counts.openverse }, (_, n) => openverseItem(n + 1)) };

interface FakeOptions {
  json?: (url: string) => unknown;
  image?: (url: string) => Promise<Buffer>;
}

function fakeFetcher(options: FakeOptions = {}) {
  return {
    fetchPage: vi.fn(async () => {
      throw new Error('not used');
    }),
    fetchImage: vi.fn(async (url: string) => ({
      url: new URL(url),
      contentType: 'image/png',
      body: await (options.image ? options.image(url) : tinyPng()),
    })),
    fetchJson: vi.fn(async (url: string) => (options.json ? options.json(url) : providerAnswer(url))),
  };
}

async function start(
  fetcher: SafeFetcher,
  overrides: Parameters<typeof testConfig>[0] = {},
  extra: { clock?: () => number; logStream?: NodeJS.WritableStream } = {},
) {
  const db = openMemoryDatabase();
  migrate(db);
  app = await buildApp({ config: testConfig(overrides), db, fetcher, ...extra });
  return app;
}

const search = (q = 'Tomato Soup') => app.inject({ method: 'GET', url: `/api/image-search?q=${encodeURIComponent(q)}` });

async function createRecipe(title = 'Tomato Soup') {
  const res = await app.inject({ method: 'POST', url: '/api/recipes', payload: { title, ingredients: ['1 egg'], steps: ['Cook'] } });
  return res.json() as { id: number };
}

const choose = (id: number, payload: unknown) =>
  app.inject({ method: 'POST', url: `/api/recipes/${id}/image/from-search`, payload: payload as object });

interface Choice {
  token: string;
  thumbnail: string;
  title: string;
  creator: string | null;
  licence: string;
  provider: string;
}

describe('when image search is switched off', () => {
  it('has no routes and makes no request', async () => {
    const fetcher = fakeFetcher();
    await start(fetcher, { imageSearchEnabled: false });
    const { id } = await createRecipe();
    expect((await search()).statusCode).toBe(404);
    expect((await choose(id, { token: 'x' })).statusCode).toBe(404);
    expect(fetcher.fetchJson).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'GET', url: '/api/session' })).json().features.imageSearch).toBe(false);
  });
});

describe('GET /api/image-search', () => {
  it('gives at most five photos, each with a small inline picture, its credit and a token', async () => {
    await start(fakeFetcher());
    const res = await search();
    expect(res.statusCode).toBe(200);

    const { items } = res.json() as { items: Choice[] };
    expect(items).toHaveLength(5);
    expect(new Set(items.map((item) => item.provider))).toEqual(new Set(['Wikimedia Commons', 'Openverse']));
    for (const item of items) {
      expect(item.thumbnail).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/);
      expect(item.token.length).toBeGreaterThan(20);
      expect(item.licence).toMatch(/^CC BY/);
      expect(item.creator).toBeTruthy();
    }
  });

  it('never gives the browser an address to fetch a picture from, and makes the choice by token alone', async () => {
    await start(fakeFetcher());
    const body = (await search()).body;
    expect(body).not.toContain('upload.wikimedia.org');
    expect(body).not.toContain('staticflickr.com');
  });

  it('cleans the title before searching and asks both services', async () => {
    const fetcher = fakeFetcher();
    await start(fetcher);
    await search('Braised Pork Belly (Hong Shao Rou/红烧肉), an Easy Version');
    const asked = fetcher.fetchJson.mock.calls.map(([url]) => url as string);
    expect(asked.some((url) => new URL(url).hostname === 'commons.wikimedia.org')).toBe(true);
    expect(asked.some((url) => new URL(url).hostname === 'api.openverse.org')).toBe(true);
    expect(asked.join(' ')).not.toContain(encodeURIComponent('红烧肉'));
    expect(new URL(asked.find((url) => url.includes('openverse'))!).searchParams.get('q')).toBe('Braised Pork Belly');
  });

  it('leaves out a photo that cannot be downloaded or read, and keeps the rest', async () => {
    let calls = 0;
    await start(
      fakeFetcher({
        image: async () => {
          calls += 1;
          if (calls === 2) throw badGateway(FETCH_FAILED);
          if (calls === 3) return Buffer.from('this is not an image');
          return tinyPng();
        },
      }),
    );
    const { items } = (await search()).json() as { items: Choice[] };
    expect(items).toHaveLength(3);
  });

  it('gives an empty list when nothing matches', async () => {
    await start(fakeFetcher({ json: () => ({ results: [], query: { pages: [] } }) }));
    expect((await search()).json()).toEqual({ items: [] });
  });

  it('gives an empty list, without asking anyone, for a title with nothing to search for', async () => {
    const fetcher = fakeFetcher();
    await start(fetcher);
    expect((await search('红烧肉')).json()).toEqual({ items: [] });
    expect(fetcher.fetchJson).not.toHaveBeenCalled();
  });

  it.each(['', 'a', ' '.repeat(5), 'x'.repeat(201)])('refuses the query %j without asking anyone', async (q) => {
    const fetcher = fakeFetcher();
    await start(fetcher);
    expect((await search(q)).statusCode).toBe(400);
    expect(fetcher.fetchJson).not.toHaveBeenCalled();
  });

  it('answers a generic 502 when both services fail', async () => {
    await start(
      fakeFetcher({
        json: () => {
          throw badGateway(FETCH_FAILED);
        },
      }),
    );
    const res = await search();
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('Could not search for photos right now');
  });

  it('still answers when one service fails', async () => {
    await start(
      fakeFetcher({
        json: (url) => {
          if (new URL(url).hostname === 'api.openverse.org') throw badGateway(FETCH_FAILED);
          return providerAnswer(url);
        },
      }),
    );
    const { items } = (await search()).json() as { items: Choice[] };
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.provider === 'Wikimedia Commons')).toBe(true);
  });

  it('offers non-commercial photos only when the setting allows them', async () => {
    const nc = (url: string) =>
      new URL(url).hostname === 'api.openverse.org' ? { results: [{ ...openverseItem(1), license: 'by-nc' }] } : { query: { pages: [] } };
    const fetcher = fakeFetcher({ json: nc });
    await start(fetcher);
    expect(((await search()).json() as { items: Choice[] }).items).toEqual([]);
    await app.close();

    await start(fakeFetcher({ json: nc }), { imageSearchAllowNonCommercial: true });
    expect(((await search()).json() as { items: Choice[] }).items).toHaveLength(1);
  });

  it('needs the login when a password is set', async () => {
    const fetcher = fakeFetcher();
    await start(fetcher, { appPassword: 'correct horse battery staple' });
    expect((await search()).statusCode).toBe(401);
    expect(fetcher.fetchJson).not.toHaveBeenCalled();
  });
});

describe('POST /api/recipes/:id/image/from-search', () => {
  async function firstChoice() {
    const { items } = (await search()).json() as { items: Choice[] };
    return items[0]!;
  }

  it('saves the chosen photo with its credit and shows it on the recipe', async () => {
    const fetcher = fakeFetcher();
    await start(fetcher);
    const { id } = await createRecipe();
    const choice = await firstChoice();

    const res = await choose(id, { token: choice.token });
    expect(res.statusCode).toBe(200);
    const recipe = res.json();
    expect(recipe.imageUrl).toMatch(/^\/api\/images\/[a-f0-9]{64}\.webp$/);
    expect(recipe.imageCredit.text).toContain(`"${choice.title}"`);
    expect(recipe.imageCredit.text).toContain('CC BY');
    expect(recipe.imageCredit.url).toMatch(/^https:\/\//);

    const stored = await app.inject({ method: 'GET', url: recipe.imageUrl });
    expect(stored.statusCode).toBe(200);
    expect(stored.headers['content-type']).toBe('image/webp');
    expect((await app.inject({ method: 'GET', url: `/api/recipes/${id}` })).json().imageCredit).toEqual(recipe.imageCredit);
  });

  it('downloads exactly the address the search found, never one from the request', async () => {
    const fetcher = fakeFetcher();
    await start(fetcher);
    const { id } = await createRecipe();
    const choice = await firstChoice();
    fetcher.fetchImage.mockClear();

    await choose(id, { token: choice.token });
    expect(fetcher.fetchImage).toHaveBeenCalledTimes(1);
    expect(fetcher.fetchImage.mock.calls[0]![0]).toMatch(/^https:\/\/(upload\.wikimedia\.org|live\.staticflickr\.com)\//);
  });

  it.each([
    ['an address instead of a token', { url: 'http://169.254.169.254/latest/meta-data/' }],
    ['a token and an address', { token: 'x', url: 'http://127.0.0.1/' }],
    ['no token', {}],
    ['an empty token', { token: '' }],
    ['a token that is not text', { token: 5 }],
    ['a token that is far too long', { token: 'a'.repeat(5000) }],
  ])('refuses %s, and fetches nothing', async (_name, payload) => {
    const fetcher = fakeFetcher();
    await start(fetcher);
    const { id } = await createRecipe();
    fetcher.fetchImage.mockClear();
    expect((await choose(id, payload)).statusCode).toBe(400);
    expect(fetcher.fetchImage).not.toHaveBeenCalled();
  });

  it('refuses a token that has been changed, one from another run of the app and a made-up one', async () => {
    const first = fakeFetcher();
    await start(first);
    const { id } = await createRecipe();
    const choice = await firstChoice();
    const [body, signature] = choice.token.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ imageUrl: 'http://127.0.0.1/', creditText: 'x', creditUrl: null, exp: Date.now() + 60_000 })).toString('base64url');

    for (const token of [`${forged}.${signature}`, `${body}.AAAA`, 'garbage', `${body}`]) {
      first.fetchImage.mockClear();
      expect((await choose(id, { token })).statusCode).toBe(400);
      expect(first.fetchImage).not.toHaveBeenCalled();
    }

    // a genuine token from a different run of the app (a different key)
    await app.close();
    const second = fakeFetcher();
    await start(second);
    const { id: otherId } = await createRecipe();
    expect((await choose(otherId, { token: choice.token })).statusCode).toBe(400);
    expect(second.fetchImage).not.toHaveBeenCalled();
  });

  it('refuses a token after 30 minutes', async () => {
    let now = 1_700_000_000_000;
    await start(fakeFetcher(), {}, { clock: () => now });
    const { id } = await createRecipe();
    const choice = await firstChoice();

    now += 31 * 60_000;
    const res = await choose(id, { token: choice.token });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Search again');
  });

  it('answers 404 for a recipe that does not exist and for an id that is not a number', async () => {
    await start(fakeFetcher());
    const choice = await firstChoice();
    expect((await choose(999, { token: choice.token })).statusCode).toBe(404);
    expect((await choose('abc' as never, { token: choice.token })).statusCode).toBe(404);
  });

  it('refuses a file that is not an image, and leaves the recipe as it was', async () => {
    const fetcher = fakeFetcher();
    await start(fetcher);
    const { id } = await createRecipe();
    const choice = await firstChoice();
    // the photo found turns out, when it is downloaded in full, to be a web page
    fetcher.fetchImage.mockImplementation(async (url: string) => ({
      url: new URL(url),
      contentType: 'text/html',
      body: Buffer.from('<html>not an image</html>'),
    }));

    const res = await choose(id, { token: choice.token });
    expect([400, 415]).toContain(res.statusCode);
    expect((await app.inject({ method: 'GET', url: `/api/recipes/${id}` })).json()).toMatchObject({ imageUrl: null, imageCredit: null });
  });

  it('replaces an earlier photo and its credit', async () => {
    await start(fakeFetcher());
    const { id } = await createRecipe();
    const { items } = (await search()).json() as { items: Choice[] };
    const first = (await choose(id, { token: items[0]!.token })).json();
    const second = (await choose(id, { token: items[1]!.token })).json();
    expect(second.imageCredit.text).not.toBe(first.imageCredit.text);
    expect(second.imageCredit.text).toContain(`"${items[1]!.title}"`);
  });

  it('needs the login when a password is set', async () => {
    await start(fakeFetcher(), { appPassword: 'correct horse battery staple' });
    const res = await choose(1, { token: 'x' });
    expect(res.statusCode).toBe(401);
  });
});

describe('credit and later changes to the photo', () => {
  async function recipeWithFoundPhoto() {
    await start(fakeFetcher());
    const { id } = await createRecipe();
    const { items } = (await search()).json() as { items: Choice[] };
    const recipe = (await choose(id, { token: items[0]!.token })).json();
    expect(recipe.imageCredit).not.toBeNull();
    return id;
  }

  it('goes when the photo is uploaded over', async () => {
    const id = await recipeWithFoundPhoto();
    const { payload, headers } = multipartBody('image', 'mine.png', 'image/png', await tinyPng(30, 20, 90));
    const res = await app.inject({ method: 'PUT', url: `/api/recipes/${id}/image`, payload, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ imageCredit: null });
    expect(res.json().imageUrl).not.toBeNull();
  });

  it('goes when the photo is removed', async () => {
    const id = await recipeWithFoundPhoto();
    const res = await app.inject({ method: 'DELETE', url: `/api/recipes/${id}/image` });
    expect(res.json()).toMatchObject({ imageUrl: null, imageCredit: null });
  });

  it('goes when a photo is attached from a link', async () => {
    const id = await recipeWithFoundPhoto();
    const res = await app.inject({ method: 'POST', url: `/api/recipes/${id}/image/from-url`, payload: { url: 'https://food.example/x.png' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().imageCredit).toBeNull();
  });

  it('stays when the recipe text is edited', async () => {
    const id = await recipeWithFoundPhoto();
    const before = (await app.inject({ method: 'GET', url: `/api/recipes/${id}` })).json();
    const res = await app.inject({ method: 'PUT', url: `/api/recipes/${id}`, payload: { title: 'Renamed', ingredients: ['1 egg'], steps: ['Cook'] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().imageCredit).toEqual(before.imageCredit);
  });
});

describe('logs', () => {
  it('say which service failed but never contain the photo addresses or tokens', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    await start(
      fakeFetcher({
        json: (url) => {
          if (new URL(url).hostname === 'api.openverse.org') throw badGateway(FETCH_FAILED);
          return providerAnswer(url);
        },
      }),
      { logLevel: 'info' },
      { logStream: stream },
    );
    const { items } = (await search()).json() as { items: Choice[] };
    const { id } = await createRecipe();
    await choose(id, { token: items[0]!.token });

    const log = lines.join('');
    expect(log).toContain('Openverse search failed');
    expect(log).not.toContain(items[0]!.token);
    expect(log).not.toContain('upload.wikimedia.org');
  });
});

describe('requests from another website', () => {
  it.each([
    ['sec-fetch-site', 'cross-site'],
    ['sec-fetch-site', 'same-site'],
    ['origin', 'http://evil.example'],
  ])('are refused for the search when the browser says %s is %s, and nothing is fetched', async (header, value) => {
    const fetcher = fakeFetcher();
    await start(fetcher);
    const res = await app.inject({ method: 'GET', url: '/api/image-search?q=Tomato+Soup', headers: { [header]: value } });
    expect(res.statusCode).toBe(403);
    expect(fetcher.fetchJson).not.toHaveBeenCalled();
  });

  it('are refused for any other API read too', async () => {
    await start(fakeFetcher());
    const res = await app.inject({ method: 'GET', url: '/api/recipes', headers: { 'sec-fetch-site': 'cross-site' } });
    expect(res.statusCode).toBe(403);
  });

  it('are not confused with the app\'s own page, a typed address or a script', async () => {
    await start(fakeFetcher());
    for (const headers of [{ 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' }, {}]) {
      expect((await app.inject({ method: 'GET', url: '/api/image-search?q=Tomato+Soup', headers })).statusCode).toBe(200);
    }
  });
});

describe('a genuine token of the longest possible length', () => {
  it('is accepted by the pick route', async () => {
    const fetcher = fakeFetcher();
    await start(fetcher);
    const { id } = await createRecipe();
    const { items } = (await search()).json() as { items: Choice[] };
    expect(items.length).toBeGreaterThan(0);
    // the route's own limit lets a token of up to 8192 characters through to be checked (and refused as a forgery)
    expect((await choose(id, { token: 'a'.repeat(8192) })).statusCode).toBe(400);
    expect((await choose(id, { token: 'a'.repeat(8193) })).statusCode).toBe(400);
  });
});

describe('the pick body is strict', () => {
  it('refuses a genuine token that comes with an address, instead of quietly ignoring the address', async () => {
    const fetcher = fakeFetcher();
    await start(fetcher);
    const { id } = await createRecipe();
    const { items } = (await search()).json() as { items: Choice[] };
    fetcher.fetchImage.mockClear();

    const res = await choose(id, { token: items[0]!.token, url: 'http://169.254.169.254/latest/meta-data/' });
    expect(res.statusCode).toBe(400);
    expect(fetcher.fetchImage).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'GET', url: `/api/recipes/${id}` })).json().imageUrl).toBeNull();
  });
});
