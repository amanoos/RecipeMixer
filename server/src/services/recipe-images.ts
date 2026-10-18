import type { Db } from '../db/connection.js';
import { countImageReferences, setRecipeImage } from '../db/recipes.js';
import type { ImageStore } from './images.js';

/** Image files are content-addressed and may be shared, so delete only when nothing references them. */
export async function removeImageIfUnused(db: Db, images: ImageStore, filename: string | null): Promise<void> {
  if (filename && countImageReferences(db, filename) === 0) {
    await images.remove(filename);
  }
}

/** Stores an already-processed image and makes it the recipe's photo, cleaning up the one it replaces. */
export async function attachImage(
  db: Db,
  images: ImageStore,
  recipeId: number,
  data: Buffer,
  filename: string,
  credit: { text: string; url: string | null } | null = null,
): Promise<void> {
  await images.save(filename, data);
  const { previous } = setRecipeImage(db, recipeId, filename, credit);
  if (previous && previous !== filename) await removeImageIfUnused(db, images, previous);
}
