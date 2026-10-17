import { NORMALIZER_VERSION } from '../services/ingredient-data.js';
import { normalizeIngredient, wordsOf } from '../services/ingredients.js';
import type { Db } from './connection.js';

/**
 * Returns a function that (re)writes the normalised columns and word index of one ingredient row.
 * Statements are prepared once so bulk writes (a whole library) stay fast.
 */
export function createIngredientIndexer(db: Db): (rowId: number, raw: string) => void {
  const update = db.prepare(
    `UPDATE recipe_ingredient
     SET name_normalized = ?, normalized_names = ?, quantity = ?, unit = ?, normalizer_version = ?
     WHERE id = ?`,
  );
  const clearWords = db.prepare('DELETE FROM recipe_ingredient_word WHERE ingredient_id = ?');
  const addWord = db.prepare('INSERT OR IGNORE INTO recipe_ingredient_word (ingredient_id, word) VALUES (?, ?)');

  return (rowId, raw) => {
    const { quantity, unit, names } = normalizeIngredient(raw);
    update.run(names[0] ?? null, names.length > 0 ? names.join('|') : null, quantity, unit, NORMALIZER_VERSION, rowId);
    clearWords.run(rowId);
    for (const word of new Set(names.flatMap(wordsOf))) addWord.run(rowId, word);
  };
}

/**
 * Re-normalises every row produced by an older rule version (including rows that predate the index).
 * Idempotent and safe to run on every start; returns how many rows were updated.
 */
export function backfillIngredients(db: Db, batchSize = 500): number {
  const nextBatch = db.prepare(
    'SELECT id, raw_text FROM recipe_ingredient WHERE normalizer_version < ? ORDER BY id LIMIT ?',
  );
  const index = createIngredientIndexer(db);
  let updated = 0;

  for (;;) {
    const rows = nextBatch.all(NORMALIZER_VERSION, batchSize) as { id: number; raw_text: string }[];
    if (rows.length === 0) return updated;
    db.transaction(() => {
      for (const row of rows) index(row.id, row.raw_text);
    })();
    updated += rows.length;
  }
}

const MAX_SUGGEST_PREFIX = 40;
const MAX_SUGGEST_LIMIT = 20;

/** Known ingredient names starting with `prefix`, most common first. A range query, so wildcards are inert. */
export function suggestIngredients(db: Db, prefix: string, limit: number): { name: string; count: number }[] {
  const start = prefix.trim().toLowerCase().slice(0, MAX_SUGGEST_PREFIX);
  if (!start) return [];
  const end = start.slice(0, -1) + String.fromCharCode(start.charCodeAt(start.length - 1) + 1);

  const rows = db
    .prepare(
      `SELECT name_normalized AS name, COUNT(*) AS count
       FROM recipe_ingredient
       WHERE name_normalized >= ? AND name_normalized < ?
       GROUP BY name_normalized
       ORDER BY count DESC, name ASC
       LIMIT ?`,
    )
    .all(start, end, Math.max(1, Math.min(limit, MAX_SUGGEST_LIMIT))) as { name: string; count: number }[];

  // Compounds are stored hyphenated ("peanut-butter"); typing the spaced form normalises to the same name.
  return rows.map((row) => ({ name: row.name.replaceAll('-', ' '), count: row.count }));
}
