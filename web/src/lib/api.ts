import type {
  Cuisine,
  ImportPreview,
  MealSearchResult,
  IngredientSuggestion,
  MatchResult,
  RecipeDetail,
  RecipeInput,
  RecipeList,
  SortOrder,
} from '@/lib/types';

/** An error response from the server; `message` is the server's safe, user-facing text. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/** Calls the listener when the server says the login has ended (a 401 from anywhere except the login itself). */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    // A wrong password is also a 401, but that is the login form's own business, not an expired session.
    if (response.status === 401 && !url.startsWith('/api/session')) {
      for (const listener of unauthorizedListeners) listener();
    }
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') message = body.error;
    } catch {
      // The error body was not JSON; keep the generic message.
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export interface ListOptions {
  limit?: number;
  offset?: number;
  /** Text to search for in title, cuisine, description and ingredients. */
  q?: string;
  cuisine?: string;
  minRating?: number;
  sort?: SortOrder;
  signal?: AbortSignal;
}

export function listRecipes(options: ListOptions = {}): Promise<RecipeList> {
  const { limit = 24, offset = 0, q, cuisine, minRating, sort, signal } = options;
  // URLSearchParams encodes whatever the user typed, so it can never change the shape of the query.
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (q) params.set('q', q);
  if (cuisine) params.set('cuisine', cuisine);
  if (minRating !== undefined) params.set('minRating', String(minRating));
  if (sort) params.set('sort', sort);
  return request<RecipeList>(`/api/recipes?${params.toString()}`, { signal });
}

export async function listCuisines(signal?: AbortSignal): Promise<Cuisine[]> {
  const { items } = await request<{ items: Cuisine[] }>('/api/cuisines', { signal });
  return items;
}

/** Sets the user's own rating (1 to 5), or clears it with null. */
export function setRating(id: number, rating: number | null): Promise<RecipeDetail> {
  return request<RecipeDetail>(`/api/recipes/${id}/rating`, jsonRequest('PATCH', { rating }));
}

export function getRecipe(id: number, signal?: AbortSignal): Promise<RecipeDetail> {
  return request<RecipeDetail>(`/api/recipes/${id}`, { signal });
}

export function createRecipe(input: RecipeInput): Promise<RecipeDetail> {
  return request<RecipeDetail>('/api/recipes', jsonRequest('POST', input));
}

export function updateRecipe(id: number, input: RecipeInput): Promise<RecipeDetail> {
  return request<RecipeDetail>(`/api/recipes/${id}`, jsonRequest('PUT', input));
}

export function deleteRecipe(id: number): Promise<void> {
  return request<void>(`/api/recipes/${id}`, { method: 'DELETE' });
}

export function uploadImage(id: number, file: File): Promise<RecipeDetail> {
  const form = new FormData();
  form.append('image', file);
  // No Content-Type header: the browser adds the multipart boundary itself.
  return request<RecipeDetail>(`/api/recipes/${id}/image`, { method: 'PUT', body: form });
}

export function matchRecipes(options: {
  ingredients: string[];
  /** Assume pantry staples (salt, pepper, water, oil) are on hand. Defaults to true. */
  staples?: boolean;
  minCoverage?: number;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<MatchResult> {
  const { ingredients, staples = true, minCoverage, limit = 24, offset = 0, signal } = options;
  // URLSearchParams encodes the user's text, so it can never change the shape of the query.
  const params = new URLSearchParams();
  for (const ingredient of ingredients) params.append('i', ingredient);
  params.set('staples', staples ? '1' : '0');
  if (minCoverage !== undefined) params.set('minCoverage', String(minCoverage));
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return request<MatchResult>(`/api/match?${params.toString()}`, { signal });
}

export async function suggestIngredients(prefix: string, signal?: AbortSignal): Promise<IngredientSuggestion[]> {
  const params = new URLSearchParams({ q: prefix });
  const { items } = await request<{ items: IngredientSuggestion[] }>(`/api/ingredients/suggest?${params.toString()}`, {
    signal,
  });
  return items;
}

export function deleteImage(id: number): Promise<RecipeDetail> {
  return request<RecipeDetail>(`/api/recipes/${id}/image`, { method: 'DELETE' });
}

/** Asks the server to fetch and read a recipe page. Nothing is saved. */
export function previewImport(url: string, signal?: AbortSignal): Promise<ImportPreview> {
  return request<ImportPreview>('/api/import/preview', { ...jsonRequest('POST', { url }), signal });
}

/** Asks the server to download a photo from a link and attach it to a saved recipe. */
export function importImageFromUrl(id: number, url: string): Promise<RecipeDetail> {
  return request<RecipeDetail>(`/api/recipes/${id}/image/from-url`, jsonRequest('POST', { url }));
}

/** Adds the bundled starter recipes that are not in the library yet. */
export function loadStarterRecipes(): Promise<{ added: number; skipped: number }> {
  return request<{ added: number; skipped: number }>('/api/starter-recipes', { method: 'POST' });
}

/** Searches TheMealDB by name (only when the server has that feature on). */
export async function searchMealDb(query: string, signal?: AbortSignal): Promise<MealSearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const { items } = await request<{ items: MealSearchResult[] }>(`/api/mealdb/search?${params.toString()}`, { signal });
  return items;
}

/** Reads one TheMealDB recipe for review. Nothing is saved. */
export function previewMealDb(id: string, signal?: AbortSignal): Promise<ImportPreview> {
  return request<ImportPreview>(`/api/mealdb/meals/${encodeURIComponent(id)}`, { signal });
}

export interface SessionStatus {
  /** Whether the server has a password set. */
  authRequired: boolean;
  authenticated: boolean;
  /** Optional features this server has switched on. Absent on older servers. */
  features?: { mealdb: boolean };
}

export function getSession(signal?: AbortSignal): Promise<SessionStatus> {
  return request<SessionStatus>('/api/session', { signal });
}

/** Logs in; the server answers with a cookie the browser keeps, so there is nothing to store here. */
export function login(password: string): Promise<void> {
  return request<void>('/api/session', jsonRequest('POST', { password }));
}

export function logout(): Promise<void> {
  return request<void>('/api/session', { method: 'DELETE' });
}
