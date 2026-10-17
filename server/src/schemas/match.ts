import { z } from 'zod';
import type { RecipeSummary } from './recipe.js';

export const MAX_MATCH_INGREDIENTS = 30;
export const MAX_INGREDIENT_LENGTH = 60;

// A single ?i=chicken arrives as a string and ?i=a&i=b as an array; accept both.
const ingredientList = z.preprocess(
  (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]),
  z
    .array(z.string().trim().min(1).max(MAX_INGREDIENT_LENGTH))
    .min(1, 'at least one ingredient is required')
    .max(MAX_MATCH_INGREDIENTS),
);

export const matchQuerySchema = z.object({
  i: ingredientList,
  staples: z
    .enum(['1', '0'])
    .default('1')
    .transform((value) => value === '1'),
  minCoverage: z.coerce.number().min(0).max(1).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

export type MatchQuery = z.output<typeof matchQuerySchema>;

export const suggestQuerySchema = z.object({
  q: z.string().trim().max(40).default(''),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export interface MatchItem {
  recipe: RecipeSummary;
  matchedCount: number;
  totalCount: number;
  /** matchedCount / totalCount, between 0 and 1. */
  coverage: number;
  /** The recipe's own ingredient lines that the user's ingredients satisfy. */
  matched: string[];
  /** The recipe's own ingredient lines the user still needs. */
  missing: string[];
}

export interface MatchResponse {
  items: MatchItem[];
  /** Number of matching recipes before pagination. */
  total: number;
  /** The inputs that were understood. */
  usedIngredients: string[];
  /** The inputs that did not look like an ingredient and were skipped. */
  ignored: string[];
  assumeStaples: boolean;
}
