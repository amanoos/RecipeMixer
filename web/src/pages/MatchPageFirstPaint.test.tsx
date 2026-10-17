import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { MatchPage } from './MatchPage';

// The very first frame, before any effect has run: this is what the browser paints first.
function firstFrame(path: string): string {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <MatchPage />
    </MemoryRouter>,
  );
}

describe('MatchPage first frame', () => {
  it('already shows the loading placeholders when opened with ingredients, so the page does not jump', () => {
    const html = firstFrame('/match?i=chicken&i=rice');
    expect(html).toContain('aria-label="Finding recipes"');
    expect(html).toContain('aria-busy="true"');
  });

  it('shows the invitation, not placeholders, when there are no ingredients yet', () => {
    const html = firstFrame('/match');
    expect(html).toContain('Add the ingredients you have');
    expect(html).not.toContain('Finding recipes');
  });
});
