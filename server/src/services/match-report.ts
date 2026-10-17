import type { Db } from '../db/connection.js';
import { findMatches } from './matching.js';

const MAX_MISSING_SHOWN = 5;

const cell = (text: string): string => text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

/**
 * Renders the best matches for several "what I have" lists as Markdown, so the author can judge
 * by eye whether the top recipes are ones they would actually cook.
 */
export function renderMatchReport(db: Db, sets: string[][], assumeStaples: boolean, top = 5): string {
  const lines: string[] = [];

  sets.forEach((have, index) => {
    const result = findMatches(db, { i: have, staples: assumeStaples, minCoverage: 0, limit: top, offset: 0 });
    lines.push(`### Set ${index + 1}: ${cell(have.join(', '))}`, '');
    if (result.ignored.length > 0) lines.push(`Ignored (not ingredients): ${cell(result.ignored.join(', '))}`, '');

    if (result.items.length === 0) {
      lines.push('_No matching recipes._', '');
      return;
    }

    lines.push('| # | Recipe | You have | Coverage | Score | Missing |', '|---|---|---|---|---|---|');
    result.items.forEach((item, position) => {
      const shown = item.missing.slice(0, MAX_MISSING_SHOWN).join('; ');
      const more = item.missing.length > MAX_MISSING_SHOWN ? ` (+${item.missing.length - MAX_MISSING_SHOWN} more)` : '';
      lines.push(
        `| ${position + 1} | ${cell(item.recipe.title)} | ${item.matchedCount} of ${item.totalCount} | ` +
          `${Math.round(item.coverage * 100)}% | ${item.score.toFixed(2)} | ${shown ? cell(shown + more) : '-'} |`,
      );
    });
    lines.push('');
  });

  return lines.join('\n');
}
