import type { Db } from './connection.js';

const MAX_TOKENS = 10;
const MAX_TOKEN_LENGTH = 40;

/**
 * Turns what the user typed into a safe FTS5 expression, or null when there is nothing to search for.
 *
 * Raw text must never reach MATCH: quotes, `*`, `-`, AND/OR/NOT, NEAR( and `column:` are all operators.
 * Only letters and digits are kept, so every token can be double-quoted and is then searched as plain text.
 * The last token is a prefix match so results appear while the user is still typing.
 */
export function buildMatchExpression(query: string): string | null {
  const tokens = (query.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [])
    .slice(0, MAX_TOKENS)
    .map((token) => token.slice(0, MAX_TOKEN_LENGTH));
  if (tokens.length === 0) return null;
  return tokens.map((token, index) => `"${token}"${index === tokens.length - 1 ? '*' : ''}`).join(' ');
}

/** The distinct cuisines in use with how many recipes each has, most used first (case-insensitive). */
export function listCuisines(db: Db): { name: string; count: number }[] {
  return db
    .prepare(
      `SELECT MIN(cuisine) AS name, COUNT(*) AS count
       FROM recipe
       WHERE cuisine IS NOT NULL AND cuisine <> ''
       GROUP BY LOWER(cuisine)
       ORDER BY count DESC, name COLLATE NOCASE`,
    )
    .all() as { name: string; count: number }[];
}
