import type { ListQuery, RecipeDetail, RecipeInput, RecipeSummary } from '../schemas/recipe.js';
import type { Db } from './connection.js';
import { createIngredientIndexer } from './ingredients.js';
import { buildMatchExpression } from './search.js';

interface RecipeRow {
  id: number;
  title: string;
  cuisine: string | null;
  description: string | null;
  source_url: string | null;
  image_path: string | null;
  image_credit: string | null;
  image_credit_url: string | null;
  rating: number | null;
  created_at: string;
  updated_at: string;
}

const SUMMARY_COLUMNS = 'id, title, cuisine, rating, image_path, created_at, updated_at';
// Qualified for queries that join the search index, which has its own title and cuisine columns.
const RECIPE_SUMMARY_COLUMNS = SUMMARY_COLUMNS.split(', ')
  .map((column) => `r.${column}`)
  .join(', ');

// Sort orders are fixed SQL fragments chosen in code; user input only ever picks a key, never SQL.
const ORDER_BY = {
  newest: 'r.created_at DESC, r.id DESC',
  rating: 'r.rating IS NULL, r.rating DESC, r.created_at DESC, r.id DESC',
  title: 'LOWER(r.title) ASC, r.id DESC',
  relevance: 'bm25(recipe_fts, 10.0, 4.0, 1.0, 2.0), r.id DESC',
} as const;

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

/** The oldest saved recipe whose source link is exactly this address, if any. */
export function findRecipeIdBySourceUrl(db: Db, sourceUrl: string): number | null {
  const row = db.prepare('SELECT id FROM recipe WHERE source_url = ? ORDER BY id LIMIT 1').get(sourceUrl) as
    | { id: number }
    | undefined;
  return row?.id ?? null;
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
    imageCredit: row.image_credit ? { text: row.image_credit, url: row.image_credit_url } : null,
  };
}

/**
 * Lists recipes, optionally narrowed by a text search (title, cuisine, description, ingredients),
 * a cuisine and a minimum rating. Sorted by relevance when searching, otherwise newest first,
 * unless `sort` says otherwise.
 */
export function listRecipes(db: Db, query: ListQuery): { items: RecipeSummary[]; total: number } {
  const { limit, offset, q, cuisine, minRating, sort } = query;
  const where: string[] = [];
  const params: (string | number)[] = [];
  let from = 'recipe r';

  if (q !== undefined) {
    const match = buildMatchExpression(q);
    if (match === null) return { items: [], total: 0 };
    from = 'recipe_fts JOIN recipe r ON r.id = recipe_fts.rowid';
    where.push('recipe_fts MATCH ?');
    params.push(match);
  }
  if (cuisine !== undefined) {
    where.push('LOWER(r.cuisine) = LOWER(?)');
    params.push(cuisine);
  }
  if (minRating !== undefined) {
    where.push('r.rating >= ?');
    params.push(minRating);
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const requested = sort ?? (q !== undefined ? 'relevance' : 'newest');
  // Relevance only exists when there is a text search.
  const order = requested === 'relevance' && q === undefined ? ORDER_BY.newest : ORDER_BY[requested];

  const rows = db
    .prepare(`SELECT ${RECIPE_SUMMARY_COLUMNS} FROM ${from} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as RecipeRow[];
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM ${from} ${clause}`).get(...params) as { total: number };
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

/**
 * Sets or clears the recipe's photo. The credit is replaced together with it, so a photo without a credit (an
 * upload, an import) never keeps the credit of the photo before it.
 */
export function setRecipeImage(
  db: Db,
  id: number,
  filename: string | null,
  credit: { text: string; url: string | null } | null = null,
): { updated: boolean; previous: string | null } {
  return db.transaction(() => {
    const row = db.prepare('SELECT image_path FROM recipe WHERE id = ?').get(id) as
      | { image_path: string | null }
      | undefined;
    if (!row) return { updated: false, previous: null };
    db.prepare(
      "UPDATE recipe SET image_path = ?, image_credit = ?, image_credit_url = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(filename, filename ? (credit?.text ?? null) : null, filename ? (credit?.url ?? null) : null, id);
    return { updated: true, previous: row.image_path };
  })();
}

/** Sets or clears (null) the user's own rating. Returns false when the recipe does not exist. */
export function setRecipeRating(db: Db, id: number, rating: number | null): boolean {
  const result = db
    .prepare("UPDATE recipe SET rating = ?, updated_at = datetime('now') WHERE id = ?")
    .run(rating, id);
  return result.changes > 0;
}

export function countImageReferences(db: Db, filename: string): number {
  const { count } = db
    .prepare('SELECT COUNT(*) AS count FROM recipe WHERE image_path = ?')
    .get(filename) as { count: number };
  return count;
}
