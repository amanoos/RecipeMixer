import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createRecipe,
  deleteImage,
  deleteRecipe,
  getRecipe,
  listRecipes,
  matchRecipes,
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
