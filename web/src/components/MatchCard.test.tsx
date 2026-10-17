import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { MatchItem } from '@/lib/types';
import { summary } from '@/test-utils';
import { MatchCard } from './MatchCard';

function item(overrides: Partial<MatchItem> = {}): MatchItem {
  return {
    recipe: summary({ id: 7, title: 'Chicken fried rice', rating: 4 }),
    matchedCount: 5,
    totalCount: 7,
    coverage: 5 / 7,
    score: 5 / 7,
    matched: [],
    missing: ['1 cup frozen peas and carrots', '2 cloves garlic, minced'],
    ...overrides,
  };
}

const renderCard = (value: MatchItem) =>
  render(
    <MemoryRouter>
      <MatchCard item={value} />
    </MemoryRouter>,
  );

describe('MatchCard', () => {
  it('links to the recipe and shows how much of it the user has', () => {
    renderCard(item());
    expect(screen.getByRole('link', { name: /Chicken fried rice/ })).toHaveAttribute('href', '/recipes/7');
    expect(screen.getByText('You have 5 of 7')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Rated 4 out of 5' })).toBeInTheDocument();
  });

  it('lists what is missing using the recipe text', () => {
    renderCard(item());
    expect(screen.getByText('Missing: 1 cup frozen peas and carrots; 2 cloves garlic, minced')).toBeInTheDocument();
  });

  it('shortens a long missing list', () => {
    const missing = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((letter) => `1 ${letter}`);
    renderCard(item({ missing, matchedCount: 1, totalCount: 8 }));
    expect(screen.getByText('Missing: 1 a; 1 b; 1 c; 1 d; 1 e +2 more')).toBeInTheDocument();
  });

  it('celebrates a complete match instead of listing nothing', () => {
    renderCard(item({ matchedCount: 3, totalCount: 3, coverage: 1, missing: [] }));
    expect(screen.getByText('You have 3 of 3')).toBeInTheDocument();
    expect(screen.getByText('You have everything.')).toBeInTheDocument();
    expect(screen.queryByText(/Missing/)).not.toBeInTheDocument();
  });

  it('shows the recipe photo when there is one and a placeholder when there is not', () => {
    const { container, rerender } = renderCard(item({ recipe: summary({ id: 1, imageUrl: '/api/images/a.webp' }) }));
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/images/a.webp');
    rerender(
      <MemoryRouter>
        <MatchCard item={item()} />
      </MemoryRouter>,
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders recipe text as plain text', () => {
    const { container } = renderCard(
      item({ recipe: summary({ title: '<img src=x onerror=alert(1)>' }), missing: ['<b>bold</b>'] }),
    );
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });
});
