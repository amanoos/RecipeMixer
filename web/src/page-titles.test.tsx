import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { apiResponse, detail, stubFetch } from '@/test-utils';

beforeEach(() => {
  document.title = 'RecipeMixer';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const baseRoutes = {
  'GET /api/health': () => apiResponse({ status: 'ok', schemaVersion: 4 }),
  'GET /api/cuisines': () => apiResponse({ items: [] }),
  'GET /api/recipes?limit=24&offset=0': () => apiResponse({ items: [], total: 0 }),
};

describe('page titles', () => {
  it.each([
    ['/', 'Your recipes - RecipeMixer'],
    ['/match', 'What can I cook? - RecipeMixer'],
    ['/import', 'Import a recipe - RecipeMixer'],
    ['/recipes/new', 'New recipe - RecipeMixer'],
    ['/nowhere/at/all', 'Page not found - RecipeMixer'],
  ])('%s is titled %s', async (path, title) => {
    stubFetch(baseRoutes);
    renderAt(path);
    await screen.findByRole('main');
    expect(document.title).toBe(title);
  });

  it('titles a recipe page with the recipe name', async () => {
    stubFetch({ ...baseRoutes, 'GET /api/recipes/7': () => apiResponse(detail({ id: 7, title: 'Tomato soup' })) });
    renderAt('/recipes/7');
    await screen.findByRole('heading', { name: 'Tomato soup' });
    expect(document.title).toBe('Tomato soup - RecipeMixer');
  });

  it('titles an editing page, and a recipe that cannot be found', async () => {
    stubFetch({
      ...baseRoutes,
      'GET /api/recipes/7': () => apiResponse(detail({ id: 7 })),
      'GET /api/recipes/9': () => apiResponse({ error: 'Recipe not found' }, 404),
    });
    const edit = renderAt('/recipes/7/edit');
    await screen.findByLabelText('Title');
    expect(document.title).toBe('Edit recipe - RecipeMixer');
    edit.unmount();

    renderAt('/recipes/9');
    await screen.findByRole('heading', { name: 'Recipe not found' });
    expect(document.title).toBe('Recipe not found - RecipeMixer');
  });
});
