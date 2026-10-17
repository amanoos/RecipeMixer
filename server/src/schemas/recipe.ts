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

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListQuery = z.output<typeof listQuerySchema>;

export interface RecipeSummary {
  id: number;
  title: string;
  cuisine: string | null;
  rating: number | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeDetail extends RecipeSummary {
  description: string | null;
  sourceUrl: string | null;
  ingredients: string[];
  steps: string[];
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
