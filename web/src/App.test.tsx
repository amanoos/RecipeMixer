import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { apiResponse, stubFetch } from './test-utils';

const emptyList = () => apiResponse({ items: [], total: 0 });

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('server status footer', () => {
  it('shows the server as running when the API responds', async () => {
    const fetchMock = stubFetch({
      'GET /api/health': () => apiResponse({ status: 'ok', schemaVersion: 2 }),
      'GET /api/recipes?limit=24&offset=0': emptyList,
    });
    renderApp();
    expect(await screen.findByText(/database schema v2/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('shows an error when the request fails', async () => {
    stubFetch({
      'GET /api/health': () => Promise.reject(new Error('network down')),
      'GET /api/recipes?limit=24&offset=0': emptyList,
    });
    renderApp();
    expect(await screen.findByText(/cannot reach the server/i)).toBeInTheDocument();
  });

  it('shows an error when the API returns a non-OK status', async () => {
    stubFetch({
      'GET /api/health': () => apiResponse({}, 500),
      'GET /api/recipes?limit=24&offset=0': emptyList,
    });
    renderApp();
    expect(await screen.findByText(/cannot reach the server/i)).toBeInTheDocument();
  });
});

describe('theme toggle', () => {
  const routes = {
    'GET /api/health': () => apiResponse({ status: 'ok', schemaVersion: 2 }),
    'GET /api/recipes?limit=24&offset=0': emptyList,
  };

  it('toggles the dark class and remembers the choice', async () => {
    stubFetch(routes);
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /switch to dark theme/i }));
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('recipemixer-theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: /switch to light theme/i }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(window.localStorage.getItem('recipemixer-theme')).toBe('light');
  });

  it('starts in the stored theme', async () => {
    window.localStorage.setItem('recipemixer-theme', 'dark');
    stubFetch(routes);
    renderApp();
    expect(document.documentElement).toHaveClass('dark');
    expect(await screen.findByText(/database schema v2/i)).toBeInTheDocument();
  });

  it('keeps working when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    stubFetch(routes);
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /switch to dark theme/i }));
    expect(document.documentElement).toHaveClass('dark');
    expect(await screen.findByText(/database schema v2/i)).toBeInTheDocument();
  });
});

describe('routing', () => {
  const routes = {
    'GET /api/health': () => apiResponse({ status: 'ok', schemaVersion: 2 }),
    'GET /api/recipes?limit=24&offset=0': emptyList,
  };

  it('shows the empty state on the home page', async () => {
    stubFetch(routes);
    renderApp('/');
    expect(await screen.findByRole('heading', { name: /no recipes yet/i })).toBeInTheDocument();
  });

  it('shows the new recipe form', async () => {
    stubFetch(routes);
    renderApp('/recipes/new');
    expect(await screen.findByRole('heading', { name: /new recipe/i })).toBeInTheDocument();
  });

  it('links to the ingredient search from the header', async () => {
    stubFetch(routes);
    renderApp('/');
    expect(screen.getByRole('link', { name: 'What can I cook?' })).toHaveAttribute('href', '/match');
  });

  it('shows the ingredient search page', async () => {
    stubFetch(routes);
    renderApp('/match');
    expect(await screen.findByRole('heading', { name: 'What can I cook?' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ingredients you have')).toBeInTheDocument();
  });

  it('marks the ingredient search link as the current page on that page', async () => {
    stubFetch(routes);
    renderApp('/match');
    expect(screen.getByRole('link', { name: 'What can I cook?' })).toHaveAttribute('aria-current', 'page');
  });

  it('links to the import page from the header and shows it', async () => {
    stubFetch(routes);
    renderApp('/');
    expect(screen.getByRole('link', { name: 'Import' })).toHaveAttribute('href', '/import');

    stubFetch(routes);
    renderApp('/import');
    expect(await screen.findByRole('heading', { name: 'Import a recipe' })).toBeInTheDocument();
    expect(screen.getByLabelText('Recipe link')).toBeInTheDocument();
  });

  it('shows a friendly page for unknown routes', async () => {
    stubFetch(routes);
    renderApp('/definitely/not/here');
    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });
});
