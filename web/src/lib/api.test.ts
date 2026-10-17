import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createRecipe,
  deleteImage,
  deleteRecipe,
  getRecipe,
  getSession,
  importImageFromUrl,
  listCuisines,
  listRecipes,
  loadStarterRecipes,
  login,
  logout,
  matchRecipes,
  onUnauthorized,
  previewImport,
  previewMealDb,
  searchMealDb,
  setRating,
  suggestIngredients,
  updateRecipe,
  uploadImage,
} from './api';
import type { RecipeInput } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: unknown) {
  const mock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

const ok = (body: unknown, status = 200) => ({ ok: true, status, json: async () => body });
const fail = (status: number, body: unknown) => ({
  ok: false,
  status,
  json: async () => {
    if (body === undefined) throw new Error('not json');
    return body;
  },
});

const input: RecipeInput = {
  title: 'Soup',
  cuisine: null,
  description: null,
  sourceUrl: null,
  rating: 3,
  ingredients: ['1 onion'],
  steps: ['Chop'],
};

describe('api client', () => {
  it('lists recipes with pagination parameters', async () => {
    const mock = stubFetch(ok({ items: [], total: 0 }));
    await expect(listRecipes({ limit: 10, offset: 20 })).resolves.toEqual({ items: [], total: 0 });
    expect(mock.mock.calls[0]?.[0]).toBe('/api/recipes?limit=10&offset=20');
  });

  it('fetches one recipe', async () => {
    const mock = stubFetch(ok({ id: 7, title: 'Soup' }));
    await expect(getRecipe(7)).resolves.toMatchObject({ id: 7 });
    expect(mock.mock.calls[0]?.[0]).toBe('/api/recipes/7');
  });

  it('creates and updates with JSON bodies', async () => {
    const mock = stubFetch(ok({ id: 1 }, 201));
    await createRecipe(input);
    const [createUrl, createInit] = mock.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toBe('/api/recipes');
    expect(createInit.method).toBe('POST');
    expect(JSON.parse(createInit.body as string)).toEqual(input);
    expect((createInit.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    await updateRecipe(1, input);
    const [updateUrl, updateInit] = mock.mock.calls[1] as [string, RequestInit];
    expect(updateUrl).toBe('/api/recipes/1');
    expect(updateInit.method).toBe('PUT');
  });

  it('treats 204 as success without a body', async () => {
    stubFetch({ ok: true, status: 204, json: async () => Promise.reject(new Error('no body')) });
    await expect(deleteRecipe(3)).resolves.toBeUndefined();
  });

  it('turns an error response into an ApiError with the server message', async () => {
    stubFetch(fail(400, { error: 'Invalid title: is required' }));
    const error = await createRecipe(input).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: 'Invalid title: is required' });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    stubFetch(fail(502, undefined));
    await expect(getRecipe(1)).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' });
  });

  it('lets network failures reject', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(listRecipes()).rejects.toThrow('Failed to fetch');
  });

  it('uploads an image as multipart form data without setting Content-Type', async () => {
    const mock = stubFetch(ok({ id: 2 }));
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
    await uploadImage(2, file);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/recipes/2/image');
    expect(init.method).toBe('PUT');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('image')).toBeInstanceOf(File);
    expect(init.headers).toBeUndefined();
  });

  it('deletes an image', async () => {
    const mock = stubFetch(ok({ id: 2, imageUrl: null }));
    await deleteImage(2);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/recipes/2/image');
    expect(init.method).toBe('DELETE');
  });
});

describe('search api', () => {
  it('sends only the options that were given', async () => {
    const mock = stubFetch(ok({ items: [], total: 0 }));
    await listRecipes({ q: 'tomato soup', cuisine: 'Italian', minRating: 4, sort: 'rating', limit: 10, offset: 20 });
    await listRecipes({ q: '', cuisine: '' });
    expect(mock.mock.calls[0]?.[0]).toBe('/api/recipes?limit=10&offset=20&q=tomato+soup&cuisine=Italian&minRating=4&sort=rating');
    expect(mock.mock.calls[1]?.[0]).toBe('/api/recipes?limit=24&offset=0');
  });

  it('encodes search text so it cannot change the query', async () => {
    const mock = stubFetch(ok({ items: [], total: 0 }));
    await listRecipes({ q: 'a&sort=title', cuisine: 'x=y#z' });
    const url = new URL(String(mock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.searchParams.get('q')).toBe('a&sort=title');
    expect(url.searchParams.get('cuisine')).toBe('x=y#z');
    expect(url.searchParams.has('sort')).toBe(false);
  });

  it('lists cuisines', async () => {
    const mock = stubFetch(ok({ items: [{ name: 'Italian', count: 2 }] }));
    await expect(listCuisines()).resolves.toEqual([{ name: 'Italian', count: 2 }]);
    expect(mock.mock.calls[0]?.[0]).toBe('/api/cuisines');
  });

  it('sets and clears a rating with a JSON body', async () => {
    const mock = stubFetch(ok({ id: 3, rating: 5 }));
    await setRating(3, 5);
    await setRating(3, null);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/recipes/3/rating');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ rating: 5 });
    expect(JSON.parse((mock.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual({ rating: null });
  });

  it('maps a rejected rating to an ApiError', async () => {
    stubFetch(fail(400, { error: 'Invalid rating: too big' }));
    await expect(setRating(3, 5)).rejects.toMatchObject({ status: 400, message: 'Invalid rating: too big' });
  });
});

describe('matching api', () => {
  const emptyMatch = { items: [], total: 0, usedIngredients: [], ignored: [], assumeStaples: true };

  it('sends each ingredient as a repeated "i" parameter with the defaults', async () => {
    const mock = stubFetch(ok(emptyMatch));
    await matchRecipes({ ingredients: ['chicken', 'rice'] });
    expect(mock.mock.calls[0]?.[0]).toBe('/api/match?i=chicken&i=rice&staples=1&limit=24&offset=0');
  });

  it('sends staples, coverage, limit and offset when given', async () => {
    const mock = stubFetch(ok(emptyMatch));
    await matchRecipes({ ingredients: ['egg'], staples: false, minCoverage: 0.5, limit: 10, offset: 20 });
    expect(mock.mock.calls[0]?.[0]).toBe('/api/match?i=egg&staples=0&minCoverage=0.5&limit=10&offset=20');
  });

  it('encodes ingredient text so it cannot change the query', async () => {
    const mock = stubFetch(ok(emptyMatch));
    await matchRecipes({ ingredients: ['mac & cheese', 'a=b&staples=0', '100% juice'] });
    const url = new URL(String(mock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.searchParams.getAll('i')).toEqual(['mac & cheese', 'a=b&staples=0', '100% juice']);
    expect(url.searchParams.get('staples')).toBe('1');
  });

  it('returns the parsed result and maps errors to ApiError', async () => {
    stubFetch(ok({ ...emptyMatch, total: 3 }));
    await expect(matchRecipes({ ingredients: ['egg'] })).resolves.toMatchObject({ total: 3 });

    stubFetch(fail(400, { error: 'Invalid i: at least one ingredient is required' }));
    await expect(matchRecipes({ ingredients: [] })).rejects.toMatchObject({
      status: 400,
      message: 'Invalid i: at least one ingredient is required',
    });
  });

  it('asks for suggestions with an encoded prefix and returns the list', async () => {
    const mock = stubFetch(ok({ items: [{ name: 'onion', count: 3 }] }));
    await expect(suggestIngredients('o&n')).resolves.toEqual([{ name: 'onion', count: 3 }]);
    expect(mock.mock.calls[0]?.[0]).toBe('/api/ingredients/suggest?q=o%26n');
  });
});

describe('import api', () => {
  it('asks the server to read a page and returns the preview', async () => {
    const preview = { draft: { title: 'Soup' }, imageUrl: null, sourceUrl: 'https://food.example/soup', existingRecipeId: null };
    const mock = stubFetch(ok(preview));
    await expect(previewImport('https://food.example/soup')).resolves.toEqual(preview);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/import/preview');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://food.example/soup' });
  });

  it('keeps the address inside the JSON body so it cannot change the request', async () => {
    const mock = stubFetch(ok({}));
    await previewImport('https://x.example/?a=1&b=2#frag');
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/import/preview');
    expect(JSON.parse(init.body as string).url).toBe('https://x.example/?a=1&b=2#frag');
  });

  it('maps a refused import to an ApiError with the server message', async () => {
    stubFetch(fail(422, { error: 'No recipe data found on that page' }));
    await expect(previewImport('https://food.example/blog')).rejects.toMatchObject({
      status: 422,
      message: 'No recipe data found on that page',
    });
  });

  it('asks the server to download a photo for a saved recipe', async () => {
    const mock = stubFetch(ok({ id: 4, imageUrl: '/api/images/a.webp' }));
    await expect(importImageFromUrl(4, 'https://food.example/a.jpg')).resolves.toMatchObject({ id: 4 });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/recipes/4/image/from-url');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://food.example/a.jpg' });
  });
});

describe('session api', () => {
  it('asks who is logged in', async () => {
    const mock = stubFetch(ok({ authRequired: true, authenticated: false }));
    await expect(getSession()).resolves.toEqual({ authRequired: true, authenticated: false });
    expect(mock.mock.calls[0]?.[0]).toBe('/api/session');
  });

  it('logs in with the password in the body only, and logs out with a DELETE', async () => {
    const mock = stubFetch({ ok: true, status: 204, json: async () => Promise.reject(new Error('no body')) });
    await login('correct-horse-battery-staple');
    const [loginUrl, loginInit] = mock.mock.calls[0] as [string, RequestInit];
    expect(loginUrl).toBe('/api/session');
    expect(loginInit.method).toBe('POST');
    expect(JSON.parse(loginInit.body as string)).toEqual({ password: 'correct-horse-battery-staple' });

    await logout();
    const [logoutUrl, logoutInit] = mock.mock.calls[1] as [string, RequestInit];
    expect(logoutUrl).toBe('/api/session');
    expect(logoutInit.method).toBe('DELETE');
  });

  it('maps a wrong password and a lockout to ApiError with the server message', async () => {
    stubFetch(fail(401, { error: 'Incorrect password' }));
    await expect(login('x')).rejects.toMatchObject({ status: 401, message: 'Incorrect password' });
    stubFetch(fail(429, { error: 'Too many wrong passwords. Try again in 15 minutes.' }));
    await expect(login('x')).rejects.toMatchObject({ status: 429 });
  });
});

describe('an ended session', () => {
  it('tells the listeners when any call is answered with 401, and still throws the error', async () => {
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    stubFetch(fail(401, { error: 'Login required' }));
    await expect(listRecipes()).rejects.toMatchObject({ status: 401 });
    await expect(getRecipe(1)).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not treat the login form\'s own 401 (a wrong password) as an ended session', async () => {
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    stubFetch(fail(401, { error: 'Incorrect password' }));
    await expect(login('x')).rejects.toMatchObject({ status: 401 });
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it('does not notify for other errors, and stops notifying after the listener is removed', async () => {
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    stubFetch(fail(404, { error: 'Not Found' }));
    await expect(getRecipe(1)).rejects.toMatchObject({ status: 404 });
    stubFetch(fail(403, { error: 'Cross-site requests are not allowed.' }));
    await expect(listRecipes()).rejects.toMatchObject({ status: 403 });
    expect(listener).not.toHaveBeenCalled();

    stop();
    stubFetch(fail(401, { error: 'Login required' }));
    await expect(listRecipes()).rejects.toMatchObject({ status: 401 });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('starter recipes and TheMealDB api', () => {
  it('asks the server to load the starter recipes with a POST and no body', async () => {
    const mock = stubFetch(ok({ added: 40, skipped: 0 }));
    await expect(loadStarterRecipes()).resolves.toEqual({ added: 40, skipped: 0 });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/starter-recipes');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('searches TheMealDB with the text encoded and returns the items', async () => {
    const mock = stubFetch(ok({ items: [{ id: '1', title: 'Soup', cuisine: null, category: null }] }));
    await expect(searchMealDb('a&b=c d')).resolves.toEqual([{ id: '1', title: 'Soup', cuisine: null, category: null }]);
    expect(mock.mock.calls[0]?.[0]).toBe('/api/mealdb/search?q=a%26b%3Dc+d');
  });

  it('reads one meal by id, with the id encoded', async () => {
    const mock = stubFetch(ok({ draft: {}, imageUrl: null, sourceUrl: 'x', existingRecipeId: null }));
    await previewMealDb('12/3');
    expect(mock.mock.calls[0]?.[0]).toBe('/api/mealdb/meals/12%2F3');
  });
});
