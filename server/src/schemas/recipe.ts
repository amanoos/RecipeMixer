import { z } from 'zod';
import { badRequest } from '../errors.js';

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Optional trimmed text: missing, null and empty all become null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const lines = (maxItems: number, maxLength: number) =>
  z.array(z.string().trim().min(1).max(maxLength)).max(maxItems).default([]);

export const recipeInputSchema = z
  .object({
    title: z.string().trim().min(1, 'is required').max(200),
    cuisine: optionalText(80),
    description: optionalText(5000),
    // Stored and shown as a link only; the server never fetches it.
    sourceUrl: optionalText(2048).refine(
      (value) => value === null || isHttpUrl(value),
      'must be an http or https URL',
    ),
    rating: z
      .number()
      .int()
      .min(1)
      .max(5)
      .nullish()
      .transform((value) => value ?? null),
    ingredients: lines(100, 200),
    steps: lines(100, 2000),
  })
  .strict();

export type RecipeInput = z.output<typeof recipeInputSchema>;

export const SORT_ORDERS = ['relevance', 'newest', 'rating', 'title'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

// An empty query parameter (?q=) means "not given".
const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
  cuisine: z.preprocess(blankToUndefined, z.string().trim().max(80).optional()),
  minRating: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(5).optional()),
  sort: z.preprocess(blankToUndefined, z.enum(SORT_ORDERS).optional()),
});

export interface ListQuery {
  limit: number;
  offset: number;
  /** Text to search for in title, cuisine, description and ingredients. */
  q?: string;
  cuisine?: string;
  minRating?: number;
  sort?: SortOrder;
}

export const ratingInputSchema = z.object({ rating: z.number().int().min(1).max(5).nullable() }).strict();

export interface RecipeSummary {
  id: number;
  title: string;
  cuisine: string | null;
  rating: number | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Who made the recipe's photo and under what licence, for photos found by the image search. */
export interface ImageCredit {
  text: string;
  /** An https link to the photo's page, or null. */
  url: string | null;
}

export interface RecipeDetail extends RecipeSummary {
  description: string | null;
  sourceUrl: string | null;
  ingredients: string[];
  steps: string[];
  imageCredit: ImageCredit | null;
}

/** Validates untrusted input; the thrown message names the field but never echoes the value. */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.') || 'body';
    throw badRequest(`Invalid ${field}: ${issue?.message ?? 'invalid value'}`);
  }
  return result.data;
}
