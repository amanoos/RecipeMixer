import { vi } from 'vitest';
import type { RecipeDetail, RecipeSummary } from '@/lib/types';

export function apiResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;

/** Stubs fetch with exact `METHOD /path` routes; an unrouted request fails the test loudly. */
export function stubFetch(routes: Record<string, Handler>) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Finds the first recorded call matching `METHOD /path`. */
export function findCall(mock: ReturnType<typeof stubFetch>, key: string) {
  return mock.mock.calls.find(([url, init]) => `${(init?.method ?? 'GET').toUpperCase()} ${String(url)}` === key);
}

export function summary(overrides: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id: 1,
    title: 'Tomato soup',
    cuisine: 'Italian',
    rating: 4,
    imageUrl: null,
    createdAt: '2026-01-01 10:00:00',
    updatedAt: '2026-01-01 10:00:00',
    ...overrides,
  };
}

export function detail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    ...summary(),
    description: 'Warm and simple.',
    sourceUrl: 'https://example.com/soup',
    ingredients: ['4 tomatoes', '1 onion'],
    steps: ['Chop everything', 'Simmer for 20 minutes'],
    imageCredit: null,
    ...overrides,
  };
}

export function pngFile(name = 'photo.png', size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: 'image/png' });
}
