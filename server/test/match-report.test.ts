import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createRecipe } from '../src/db/recipes.js';
import { renderMatchReport } from '../src/services/match-report.js';
import { LIBRARY } from './fixtures/matching-library.js';

let db: Db;

beforeEach(() => {
  db = openMemoryDatabase();
  migrate(db);
  for (const recipe of LIBRARY) {
    createRecipe(db, {
      title: recipe.title,
      cuisine: null,
      description: null,
      sourceUrl: null,
      rating: recipe.rating ?? null,
      ingredients: recipe.ingredients,
      steps: [],
    });
  }
});

afterEach(() => {
  db.close();
});

describe('renderMatchReport', () => {
  it('lists the best matches for each set as a Markdown table', () => {
    const report = renderMatchReport(db, [['egg', 'bread', 'butter']], true);
    expect(report).toContain('### Set 1: egg, bread, butter');
    expect(report).toContain('| # | Recipe | You have | Coverage | Score | Missing |');
    expect(report).toContain('| 1 | Fried eggs on toast | 3 of 3 | 100% | 1.00 | - |');
  });

  it('numbers several sets and limits each to the top results', () => {
    const report = renderMatchReport(db, [['egg'], ['onion']], true, 2);
    expect(report).toContain('### Set 1: egg');
    expect(report).toContain('### Set 2: onion');
    const rowsInFirstSet = report.split('### Set 2')[0]?.split('\n').filter((line) => /^\| \d+ \|/.test(line)) ?? [];
    expect(rowsInFirstSet).toHaveLength(2);
  });

  it('says so when nothing matches and names ignored inputs', () => {
    const report = renderMatchReport(db, [['dragonfruit'], ['!!!', 'egg']], true);
    expect(report).toContain('_No matching recipes._');
    expect(report).toContain('Ignored (not ingredients): !!!');
  });

  it('shows missing ingredients and truncates long lists', () => {
    const report = renderMatchReport(db, [['egg']], true, 30);
    expect(report).toContain('2 slices bread; 1 tbsp butter');
    expect(report).toMatch(/\+\d+ more/);
  });

  it('keeps table cells intact when text contains pipes or line breaks', () => {
    createRecipe(db, {
      title: 'Odd | title\nwith break',
      cuisine: null,
      description: null,
      sourceUrl: null,
      rating: null,
      ingredients: ['1 dragonfruit'],
      steps: [],
    });
    const report = renderMatchReport(db, [['dragonfruit']], true);
    expect(report).toContain('Odd \\| title with break');
  });

  it('honours the staples setting', () => {
    expect(renderMatchReport(db, [['egg', 'bread', 'butter']], false)).toContain('3 of 4');
  });
});
