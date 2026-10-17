import { z } from 'zod';

export const importUrlSchema = z.object({ url: z.string().trim().min(1, 'is required').max(2048) }).strict();

/** What the parser could read from a page; the user reviews it before anything is saved. */
export interface RecipeDraft {
  title: string;
  cuisine: string | null;
  description: string | null;
  ingredients: string[];
  steps: string[];
}

export interface ExtractedRecipe {
  draft: RecipeDraft;
  /** Absolute http(s) address of the page's photo, if it names one. Not fetched until the user saves. */
  imageUrl: string | null;
}

export interface ImportPreview extends ExtractedRecipe {
  /** The address that answered, after redirects, without any fragment. */
  sourceUrl: string;
  /** Id of a saved recipe that already uses this source link, if any. */
  existingRecipeId: number | null;
}
