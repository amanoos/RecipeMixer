import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { createRecipe } from '../../src/db/recipes.js';
import { findMatches } from '../../src/services/matching.js';

/** Deterministic pseudo-random numbers so every run builds the same library. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONSONANTS = 'bdfgklmnprtvz';
const VOWELS = 'aeiou';

/** Made-up ingredient words (no real-word quirks), about 400 of them. */
function makeVocabulary(random: () => number, size: number): string[] {
  const words = new Set<string>();
  while (words.size < size) {
    let word = '';
    for (let syllable = 0; syllable < 3; syllable++) {
      word += CONSONANTS[Math.floor(random() * CONSONANTS.length)];
      word += VOWELS[Math.floor(random() * VOWELS.length)];
    }
    words.add(word);
  }
  return [...words];
}

const pick = <T>(random: () => number, items: T[]): T => items[Math.floor(random() * items.length)] as T;

const RECIPE_COUNT = 15_000;
const QUERY_COUNT = 200;
const P95_BUDGET_MS = 200;

describe('matching performance', () => {
  it(
    `answers queries over ${RECIPE_COUNT} recipes with p95 under ${P95_BUDGET_MS} ms`,
    () => {
      const random = mulberry32(20261017);
      const vocabulary = makeVocabulary(random, 400);
      const units = ['cup', 'tbsp', 'tsp', 'oz', 'lb'];

      const db = openMemoryDatabase();
      migrate(db);

      const insertStarted = performance.now();
      db.transaction(() => {
        for (let n = 0; n < RECIPE_COUNT; n++) {
          const lineCount = 6 + Math.floor(random() * 9);
          const ingredients = Array.from({ length: lineCount }, () => {
            const quantity = 1 + Math.floor(random() * 4);
            return `${quantity} ${pick(random, units)} ${pick(random, vocabulary)}`;
          });
          createRecipe(db, {
            title: `Recipe ${n}`,
            cuisine: null,
            description: null,
            sourceUrl: null,
            rating: random() < 0.3 ? 1 + Math.floor(random() * 5) : null,
            ingredients,
            steps: [],
          });
        }
      })();
      const insertMs = performance.now() - insertStarted;

      const timings: number[] = [];
      let resultCount = 0;
      for (let q = 0; q < QUERY_COUNT; q++) {
        const have = Array.from({ length: 3 + Math.floor(random() * 6) }, () => pick(random, vocabulary));
        const started = performance.now();
        const result = findMatches(db, { i: have, staples: true, minCoverage: 0, limit: 24, offset: 0 });
        timings.push(performance.now() - started);
        resultCount += result.items.length;
      }

      timings.sort((a, b) => a - b);
      const at = (fraction: number) => timings[Math.min(timings.length - 1, Math.floor(timings.length * fraction))] as number;
      const p50 = at(0.5);
      const p95 = at(0.95);
      const max = timings[timings.length - 1] as number;
      console.log(
        `matching benchmark: ${RECIPE_COUNT} recipes indexed in ${(insertMs / 1000).toFixed(1)} s; ` +
          `${QUERY_COUNT} queries p50=${p50.toFixed(1)} ms p95=${p95.toFixed(1)} ms max=${max.toFixed(1)} ms`,
      );

      expect(resultCount).toBeGreaterThan(0);
      expect(p95).toBeLessThan(P95_BUDGET_MS);
      db.close();
    },
    600_000,
  );
});
