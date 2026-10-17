import type { ListQuery, RecipeDetail, RecipeInput, RecipeSummary } from '../schemas/recipe.js';
import type { Db } from './connection.js';
import { createIngredientIndexer } from './ingredients.js';

interface RecipeRow {
  id: number;
  title: string;
  cuisine: string | null;
  description: string | null;
  source_url: string | null;
  image_path: string | null;
  rating: number | null;
  created_at: string;
  updated_at: string;
}

const SUMMARY_COLUMNS = 'id, title, cuisine, rating, image_path, created_at, updated_at';

const toImageUrl = (imagePath: string | null): string | null =>
  imagePath ? `/api/images/${imagePath}` : null;

function toSummary(
  row: Pick<RecipeRow, 'id' | 'title' | 'cuisine' | 'rating' | 'image_path' | 'created_at' | 'updated_at'>,
): RecipeSummary {
  return {
    id: row.id,
    title: row.title,
    cuisine: row.cuisine,
    rating: row.rating,
    imageUrl: toImageUrl(row.image_path),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function insertChildren(db: Db, recipeId: number, input: RecipeInput): void {
  const insertIngredient = db.prepare(
    'INSERT INTO recipe_ingredient (recipe_id, position, raw_text) VALUES (?, ?, ?)',
  );
  const indexIngredient = createIngredientIndexer(db);
  input.ingredients.forEach((text, position) => {
    const { lastInsertRowid } = insertIngredient.run(recipeId, position, text);
    indexIngredient(Number(lastInsertRowid), text);
  });

  const insertStep = db.prepare('INSERT INTO recipe_step (recipe_id, position, text) VALUES (?, ?, ?)');
  input.steps.forEach((text, position) => insertStep.run(recipeId, position, text));
}

export function createRecipe(db: Db, input: RecipeInput): number {
  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare(
        'INSERT INTO recipe (title, cuisine, description, source_url, rating) VALUES (?, ?, ?, ?, ?)',
      )
      .run(input.title, input.cuisine, input.description, input.sourceUrl, input.rating);
    const id = Number(lastInsertRowid);
    insertChildren(db, id, input);
    return id;
  })();
}

export function getRecipe(db: Db, id: number): RecipeDetail | undefined {
  const row = db.prepare('SELECT * FROM recipe WHERE id = ?').get(id) as RecipeRow | undefined;
  if (!row) return undefined;

  const ingredients = db
    .prepare('SELECT raw_text FROM recipe_ingredient WHERE recipe_id = ? ORDER BY position')
    .all(id) as { raw_text: string }[];
  const steps = db
    .prepare('SELECT text FROM recipe_step WHERE recipe_id = ? ORDER BY position')
    .all(id) as { text: string }[];

  return {
    ...toSummary(row),
    description: row.description,
    sourceUrl: row.source_url,
    ingredients: ingredients.map((item) => item.raw_text),
    steps: steps.map((item) => item.text),
  };
}

export function listRecipes(db: Db, { limit, offset }: ListQuery): { items: RecipeSummary[]; total: number } {
  const rows = db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM recipe ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(limit, offset) as RecipeRow[];
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM recipe').get() as { total: number };
  return { items: rows.map(toSummary), total };
}

/** Summaries for a set of recipe ids (callers keep the set small: it becomes SQL placeholders). */
export function getRecipeSummaries(db: Db, ids: number[]): Map<number, RecipeSummary> {
  if (ids.length === 0) return new Map();
  const rows = db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM recipe WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as RecipeRow[];
  return new Map(rows.map((row) => [row.id, toSummary(row)]));
}

/** Replaces the recipe's fields, ingredients and steps. Returns false when the recipe does not exist. */
export function updateRecipe(db: Db, id: number, input: RecipeInput): boolean {
  return db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE recipe
         SET title = ?, cuisine = ?, description = ?, source_url = ?, rating = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(input.title, input.cuisine, input.description, input.sourceUrl, input.rating, id);
    if (result.changes === 0) return false;

    db.prepare('DELETE FROM recipe_ingredient WHERE recipe_id = ?').run(id);
    db.prepare('DELETE FROM recipe_step WHERE recipe_id = ?').run(id);
    insertChildren(db, id, input);
    return true;
  })();
}

/** Deletes the recipe (ingredients and steps cascade) and returns its image filename so the file can be cleaned up. */
export function deleteRecipe(db: Db, id: number): { deleted: boolean; imagePath: string | null } {
  return db.transaction(() => {
    const row = db.prepare('SELECT image_path FROM recipe WHERE id = ?').get(id) as
      | { image_path: string | null }
      | undefined;
    if (!row) return { deleted: false, imagePath: null };
    db.prepare('DELETE FROM recipe WHERE id = ?').run(id);
    return { deleted: true, imagePath: row.image_path };
  })();
}

export function setRecipeImage(
  db: Db,
  id: number,
  filename: string | null,
): { updated: boolean; previous: string | null } {
  return db.transaction(() => {
    const row = db.prepare('SELECT image_path FROM recipe WHERE id = ?').get(id) as
      | { image_path: string | null }
      | undefined;
    if (!row) return { updated: false, previous: null };
    db.prepare("UPDATE recipe SET image_path = ?, updated_at = datetime('now') WHERE id = ?").run(filename, id);
    return { updated: true, previous: row.image_path };
  })();
}

export function countImageReferences(db: Db, filename: string): number {
  const { count } = db
    .prepare('SELECT COUNT(*) AS count FROM recipe WHERE image_path = ?')
    .get(filename) as { count: number };
  return count;
}
