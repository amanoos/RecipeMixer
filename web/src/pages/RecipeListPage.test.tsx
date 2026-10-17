import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecipeListPage } from './RecipeListPage';
import { apiResponse, findCall, stubFetch, summary } from '@/test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <RecipeListPage />
    </MemoryRouter>,
  );

describe('RecipeListPage', () => {
  it('shows an empty state with a link to add a recipe', async () => {
    stubFetch({ 'GET /api/recipes?limit=24&offset=0': () => apiResponse({ items: [], total: 0 }) });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'No recipes yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add your first recipe' })).toHaveAttribute('href', '/recipes/new');
  });

  it('shows recipe cards that link to the detail page', async () => {
    stubFetch({
      'GET /api/recipes?limit=24&offset=0': () =>
        apiResponse({
          items: [
            summary({ id: 2, title: 'Curry', cuisine: 'Indian', rating: 5, imageUrl: '/api/images/a.webp' }),
            summary({ id: 1, title: 'Soup', cuisine: null, rating: null }),
          ],
          total: 2,
        }),
    });
    renderPage();
    const curry = await screen.findByRole('link', { name: /Curry/ });
    expect(curry).toHaveAttribute('href', '/recipes/2');
    expect(screen.getByText('Indian')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Rated 5 out of 5' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Not rated' })).toBeInTheDocument();
    expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('loads more recipes on request', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      'GET /api/recipes?limit=24&offset=0': () =>
        apiResponse({ items: [summary({ id: 3, title: 'Third' }), summary({ id: 2, title: 'Second' })], total: 3 }),
      'GET /api/recipes?limit=24&offset=2': () =>
        apiResponse({ items: [summary({ id: 1, title: 'First' })], total: 3 }),
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(screen.getByText('Showing 3 of 3')).toBeInTheDocument();
    expect(findCall(mock, 'GET /api/recipes?limit=24&offset=2')).toBeDefined();
  });

  it('shows an error and recovers when the user retries', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    stubFetch({
      'GET /api/recipes?limit=24&offset=0': () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new TypeError('Failed to fetch'))
          : apiResponse({ items: [summary({ title: 'Recovered' })], total: 1 });
      },
    });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your recipes/i);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Recovered')).toBeInTheDocument();
  });

  it('renders recipe titles as plain text', async () => {
    stubFetch({
      'GET /api/recipes?limit=24&offset=0': () =>
        apiResponse({ items: [summary({ title: '<img src=x onerror=alert(1)>' })], total: 1 }),
    });
    const { container } = renderPage();
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('RecipeListPage starter recipes', () => {
  it('loads the starter recipes from the empty state and then shows them', async () => {
    const user = userEvent.setup();
    let loaded = false;
    const mock = stubFetch({
      'GET /api/recipes?limit=24&offset=0': () =>
        apiResponse(loaded ? { items: [summary({ id: 1, title: 'Simple Tomato Soup' })], total: 1 } : { items: [], total: 0 }),
      'GET /api/cuisines': () => apiResponse({ items: [] }),
      'POST /api/starter-recipes': () => {
        loaded = true;
        return apiResponse({ added: 40, skipped: 0 });
      },
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Load starter recipes' }));

    expect(await screen.findByRole('link', { name: /Simple Tomato Soup/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No recipes yet' })).not.toBeInTheDocument();
    expect(mock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
  });

  it('says so when the starter recipes could not be loaded, and stays on the empty state', async () => {
    const user = userEvent.setup();
    stubFetch({
      'GET /api/recipes?limit=24&offset=0': () => apiResponse({ items: [], total: 0 }),
      'GET /api/cuisines': () => apiResponse({ items: [] }),
      'POST /api/starter-recipes': () => apiResponse({ error: 'Internal Server Error' }, 500),
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Load starter recipes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the starter recipes');
    expect(screen.getByRole('heading', { name: 'No recipes yet' })).toBeInTheDocument();
  });

  it('does not offer the button once the library has recipes', async () => {
    stubFetch({
      'GET /api/recipes?limit=24&offset=0': () => apiResponse({ items: [summary({ id: 1, title: 'Soup' })], total: 1 }),
      'GET /api/cuisines': () => apiResponse({ items: [] }),
    });
    renderPage();
    expect(await screen.findByRole('link', { name: /Soup/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load starter recipes' })).not.toBeInTheDocument();
  });
});
