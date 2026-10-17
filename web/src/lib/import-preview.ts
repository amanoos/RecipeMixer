import type { ImportPreview } from '@/lib/types';

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';

/**
 * Reads an import preview handed over through router state. History state outlives the page and can
 * be anything, so only a value of exactly the expected shape is accepted; otherwise the form stays blank.
 */
export function readImportPreview(state: unknown): ImportPreview | null {
  if (typeof state !== 'object' || state === null) return null;
  const candidate = (state as { importPreview?: unknown }).importPreview;
  if (typeof candidate !== 'object' || candidate === null) return null;

  const { draft, imageUrl, sourceUrl, existingRecipeId } = candidate as Partial<ImportPreview>;
  if (typeof draft !== 'object' || draft === null) return null;
  if (typeof draft.title !== 'string' || !isTextOrNull(draft.cuisine) || !isTextOrNull(draft.description)) return null;
  if (!isStringList(draft.ingredients) || !isStringList(draft.steps)) return null;
  if (typeof sourceUrl !== 'string' || !isTextOrNull(imageUrl ?? null)) return null;

  return {
    draft: {
      title: draft.title,
      cuisine: draft.cuisine,
      description: draft.description,
      ingredients: draft.ingredients,
      steps: draft.steps,
    },
    imageUrl: imageUrl ?? null,
    sourceUrl,
    existingRecipeId: typeof existingRecipeId === 'number' ? existingRecipeId : null,
  };
}

/** The host to show in "Imported from ...", or null when the address cannot be read. */
export function hostOf(address: string): string | null {
  try {
    return new URL(address).hostname;
  } catch {
    return null;
  }
}
