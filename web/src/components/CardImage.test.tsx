import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { summary } from '@/test-utils';
import { CardImage, imagePriority } from './CardImage';
import { RecipeCard } from './RecipeCard';

describe('imagePriority', () => {
  it('fetches the first photo first, the rest of the first row eagerly and everything else lazily', () => {
    expect([0, 1, 2, 3, 10].map(imagePriority)).toEqual(['high', 'eager', 'eager', 'lazy', 'lazy']);
  });
});

describe('CardImage', () => {
  const image = () => document.querySelector('img') as HTMLImageElement;

  it('marks the first photo as high priority and not lazy', () => {
    render(<CardImage src="/api/images/a.webp" priority="high" />);
    expect(image()).toHaveAttribute('fetchpriority', 'high');
    expect(image()).toHaveAttribute('loading', 'eager');
  });

  it('loads other first-row photos eagerly without raising their priority', () => {
    render(<CardImage src="/api/images/a.webp" priority="eager" />);
    expect(image()).toHaveAttribute('loading', 'eager');
    expect(image()).toHaveAttribute('fetchpriority', 'auto');
  });

  it('lazy-loads photos below the fold by default', () => {
    render(<CardImage src="/api/images/a.webp" />);
    expect(image()).toHaveAttribute('loading', 'lazy');
  });

  it('reserves the photo box and stays decorative', () => {
    render(<CardImage src="/api/images/a.webp" />);
    expect(image()).toHaveAttribute('width', '400');
    expect(image()).toHaveAttribute('height', '300');
    expect(image()).toHaveAttribute('alt', '');
    expect(image().className).toContain('aspect-[4/3]');
  });

  it('shows a same-sized placeholder tile when there is no photo', () => {
    const { container } = render(<CardImage src={null} />);
    expect(container.querySelector('img')).toBeNull();
    const tile = container.querySelector('[data-slot="card-image"]');
    expect(tile).not.toBeNull();
    expect(tile?.className).toContain('aspect-[4/3]');
  });
});

describe('RecipeCard', () => {
  it('links to the recipe, keeps two lines for the title and passes the priority on', () => {
    render(
      <MemoryRouter>
        <RecipeCard recipe={summary({ id: 4, title: 'Soup', imageUrl: '/api/images/a.webp' })} priority="high" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', '/recipes/4');
    expect(screen.getByRole('heading', { name: 'Soup' }).className).toContain('min-h-[2lh]');
    expect(document.querySelector('img')).toHaveAttribute('fetchpriority', 'high');
  });

  it('uses the placeholder tile for a recipe without a photo', () => {
    render(
      <MemoryRouter>
        <RecipeCard recipe={summary({ imageUrl: null })} />
      </MemoryRouter>,
    );
    expect(document.querySelector('[data-slot="card-image"]')).not.toBeNull();
  });
});
