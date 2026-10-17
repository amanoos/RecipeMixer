import type { RecipeDetail, RecipeInput, RecipeList } from '@/lib/types';

/** An error response from the server; `message` is the server's safe, user-facing text. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
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

export function listRecipes(
  options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
): Promise<RecipeList> {
  const { limit = 24, offset = 0, signal } = options;
  return request<RecipeList>(`/api/recipes?limit=${limit}&offset=${offset}`, { signal });
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

export function deleteImage(id: number): Promise<RecipeDetail> {
  return request<RecipeDetail>(`/api/recipes/${id}/image`, { method: 'DELETE' });
}
