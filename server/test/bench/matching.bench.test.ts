import { beforeAll, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type Db } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { createRecipe, listRecipes } from '../../src/db/recipes.js';
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
const CUISINES = ['Italian', 'Indian', 'Mexican', 'Thai', 'French', 'Greek', 'Chinese', 'Japanese', 'Spanish', 'Turkish', 'Korean', 'Lebanese'];

let db: Db;
let vocabulary: string[];
const random = mulberry32(20261017);

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] as number;
}

function report(label: string, timings: number[]): number {
  const sorted = [...timings].sort((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  console.log(
    `${label}: ${timings.length} queries p50=${percentile(sorted, 0.5).toFixed(1)} ms ` +
      `p95=${p95.toFixed(1)} ms max=${(sorted[sorted.length - 1] as number).toFixed(1)} ms`,
  );
  return p95;
}

function time(run: () => number, count: number): { timings: number[]; results: number } {
  const timings: number[] = [];
  let results = 0;
  for (let n = 0; n < count; n++) {
    const started = performance.now();
    results += run();
    timings.push(performance.now() - started);
  }
  return { timings, results };
}

beforeAll(() => {
  vocabulary = makeVocabulary(random, 400);
  const units = ['cup', 'tbsp', 'tsp', 'oz', 'lb'];
  db = openMemoryDatabase();
  migrate(db);

  const started = performance.now();
  db.transaction(() => {
    for (let n = 0; n < RECIPE_COUNT; n++) {
      const lineCount = 6 + Math.floor(random() * 9);
      const ingredients = Array.from({ length: lineCount }, () => {
        const quantity = 1 + Math.floor(random() * 4);
        return `${quantity} ${pick(random, units)} ${pick(random, vocabulary)}`;
      });
      createRecipe(db, {
        title: `${pick(random, vocabulary)} ${pick(random, vocabulary)} ${pick(random, ['soup', 'salad', 'stew', 'bake', 'pie'])}`,
        cuisine: random() < 0.8 ? pick(random, CUISINES) : null,
        description: random() < 0.5 ? `${pick(random, vocabulary)} and ${pick(random, vocabulary)}` : null,
        sourceUrl: null,
        rating: random() < 0.3 ? 1 + Math.floor(random() * 5) : null,
        ingredients,
        steps: [],
      });
    }
  })();
  console.log(`library: ${RECIPE_COUNT} recipes indexed in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}, 600_000);

describe(`performance with ${RECIPE_COUNT} recipes (p95 budget ${P95_BUDGET_MS} ms)`, () => {
  it('answers ingredient matching queries', () => {
    const { timings, results } = time(() => {
      const have = Array.from({ length: 3 + Math.floor(random() * 6) }, () => pick(random, vocabulary));
      return findMatches(db, { i: have, staples: true, minCoverage: 0, limit: 24, offset: 0 }).items.length;
    }, QUERY_COUNT);
    expect(results).toBeGreaterThan(0);
    expect(report('ingredient matching', timings)).toBeLessThan(P95_BUDGET_MS);
  });

  it('answers text searches by name, by two words and while typing', () => {
    const { timings, results } = time(() => {
      const kind = Math.floor(random() * 3);
      const word = pick(random, vocabulary);
      const q = kind === 0 ? word : kind === 1 ? `${word} ${pick(random, vocabulary)}` : word.slice(0, 3);
      return listRecipes(db, { limit: 24, offset: 0, q }).items.length;
    }, QUERY_COUNT);
    expect(results).toBeGreaterThan(0);
    expect(report('text search', timings)).toBeLessThan(P95_BUDGET_MS);
  });

  it('answers searches with a cuisine filter and rating sort', () => {
    const { timings, results } = time(
      () =>
        listRecipes(db, {
          limit: 24,
          offset: 0,
          q: pick(random, vocabulary).slice(0, 3),
          cuisine: pick(random, CUISINES),
          sort: 'rating',
        }).items.length,
      QUERY_COUNT,
    );
    expect(results).toBeGreaterThan(0);
    expect(report('search + cuisine + rating sort', timings)).toBeLessThan(P95_BUDGET_MS);
  });

  it('lists and filters without a text search', () => {
    const { timings } = time(
      () => listRecipes(db, { limit: 24, offset: Math.floor(random() * 5000), cuisine: pick(random, CUISINES), minRating: 3, sort: 'rating' }).items.length,
      QUERY_COUNT,
    );
    expect(report('filter + rating sort, no text', timings)).toBeLessThan(P95_BUDGET_MS);
  });
});
