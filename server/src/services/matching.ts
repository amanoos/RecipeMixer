import type { Db } from '../db/connection.js';
import { getRecipeSummaries } from '../db/recipes.js';
import type { MatchItem, MatchQuery, MatchResponse } from '../schemas/match.js';
import { ingredientsMatch, isStapleLine, normalizeIngredient, wordsOf } from './ingredients.js';

/** Stage 1 keeps this many recipes (best word overlap first); stage 2 scores them precisely. */
const MAX_CANDIDATES = 500;
const MAX_LOOKUP_WORDS = 100;

interface Line {
  recipeId: number;
  raw: string;
  names: string[];
  rating: number | null;
}

interface Scored {
  recipeId: number;
  rating: number | null;
  matched: string[];
  missing: string[];
  coverage: number;
}

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(',');

function emptyResponse(query: MatchQuery, usedIngredients: string[], ignored: string[]): MatchResponse {
  return { items: [], total: 0, usedIngredients, ignored, assumeStaples: query.staples };
}

/** Stage 1: an indexed word lookup that narrows the library to the most promising recipes. */
function findCandidateIds(db: Db, words: string[]): number[] {
  const rows = db
    .prepare(
      `SELECT ri.recipe_id AS id
       FROM recipe_ingredient_word w
       JOIN recipe_ingredient ri ON ri.id = w.ingredient_id
       WHERE w.word IN (${placeholders(words.length)})
       GROUP BY ri.recipe_id
       ORDER BY COUNT(DISTINCT ri.id) DESC, ri.recipe_id DESC
       LIMIT ${MAX_CANDIDATES}`,
    )
    .all(...words) as { id: number }[];
  return rows.map((row) => row.id);
}

function loadLines(db: Db, recipeIds: number[]): Map<number, Line[]> {
  const rows = db
    .prepare(
      `SELECT ri.recipe_id AS recipeId, ri.raw_text AS raw, ri.normalized_names AS names, r.rating AS rating
       FROM recipe_ingredient ri
       JOIN recipe r ON r.id = ri.recipe_id
       WHERE ri.recipe_id IN (${placeholders(recipeIds.length)})
       ORDER BY ri.recipe_id, ri.position`,
    )
    .all(...recipeIds) as { recipeId: number; raw: string; names: string | null; rating: number | null }[];

  const byRecipe = new Map<number, Line[]>();
  for (const row of rows) {
    const lines = byRecipe.get(row.recipeId) ?? [];
    lines.push({ recipeId: row.recipeId, raw: row.raw, names: row.names ? row.names.split('|') : [], rating: row.rating });
    byRecipe.set(row.recipeId, lines);
  }
  return byRecipe;
}

function score(lines: Line[], userNames: string[], assumeStaples: boolean): Scored | null {
  // Lines with no usable ingredient name (section headers, junk) count for nothing either way.
  const counted = lines.filter((line) => line.names.length > 0 && !(assumeStaples && isStapleLine(line.names)));
  if (counted.length === 0) return null;

  const matched: string[] = [];
  const missing: string[] = [];
  for (const line of counted) {
    const satisfied = line.names.some((name) => userNames.some((user) => ingredientsMatch(user, name)));
    (satisfied ? matched : missing).push(line.raw);
  }
  if (matched.length === 0) return null;

  const first = lines[0] as Line;
  return {
    recipeId: first.recipeId,
    rating: first.rating,
    matched,
    missing,
    coverage: matched.length / counted.length,
  };
}

/** Best coverage first, then fewest missing, then own rating (unrated last), then newest. */
function compare(a: Scored, b: Scored): number {
  return (
    b.coverage - a.coverage ||
    a.missing.length - b.missing.length ||
    (b.rating ?? 0) - (a.rating ?? 0) ||
    b.recipeId - a.recipeId
  );
}

/**
 * Ranks the saved recipes by how much of each the user can already make from their ingredients.
 * Inputs and recipe lines go through the same normaliser, so "Onions" matches "2 cups chopped red onion".
 */
export function findMatches(db: Db, query: MatchQuery): MatchResponse {
  const usedIngredients: string[] = [];
  const ignored: string[] = [];
  const userNames: string[] = [];

  for (const raw of query.i) {
    const { names } = normalizeIngredient(raw);
    if (names.length === 0) {
      ignored.push(raw);
      continue;
    }
    usedIngredients.push(raw);
    for (const name of names) if (!userNames.includes(name)) userNames.push(name);
  }

  const words = [...new Set(userNames.flatMap(wordsOf))].slice(0, MAX_LOOKUP_WORDS);
  if (words.length === 0) return emptyResponse(query, usedIngredients, ignored);

  const candidateIds = findCandidateIds(db, words);
  if (candidateIds.length === 0) return emptyResponse(query, usedIngredients, ignored);

  const linesByRecipe = loadLines(db, candidateIds);
  const ranked: Scored[] = [];
  for (const lines of linesByRecipe.values()) {
    const scored = score(lines, userNames, query.staples);
    if (scored && scored.coverage >= query.minCoverage) ranked.push(scored);
  }
  ranked.sort(compare);

  const page = ranked.slice(query.offset, query.offset + query.limit);
  const summaries = getRecipeSummaries(db, page.map((entry) => entry.recipeId));

  const items: MatchItem[] = [];
  for (const entry of page) {
    const recipe = summaries.get(entry.recipeId);
    if (!recipe) continue;
    items.push({
      recipe,
      matchedCount: entry.matched.length,
      totalCount: entry.matched.length + entry.missing.length,
      coverage: entry.coverage,
      matched: entry.matched,
      missing: entry.missing,
    });
  }

  return { items, total: ranked.length, usedIngredients, ignored, assumeStaples: query.staples };
}
