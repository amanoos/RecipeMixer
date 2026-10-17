import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecipeSummary } from '@/lib/types';
import { apiResponse, stubFetch, summary } from '@/test-utils';
import { RecipeListPage } from './RecipeListPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

function LocationProbe() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderList(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <RecipeListPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const page = (items: RecipeSummary[], total = items.length) => apiResponse({ items, total });
const BASE = 'GET /api/recipes?limit=24&offset=0';
const cuisines = {
  'GET /api/cuisines': () =>
    apiResponse({
      items: [
        { name: 'Italian', count: 2 },
        { name: 'Indian', count: 1 },
      ],
    }),
};
const soup = summary({ id: 1, title: 'Tomato soup', cuisine: 'Italian', rating: 4 });
const curry = summary({ id: 2, title: 'Chicken curry', cuisine: 'Indian', rating: 5 });

const optionLabels = (select: HTMLElement) => [...select.querySelectorAll('option')].map((option) => option.textContent);

describe('search and filter controls', () => {
  it('offers a search box, the cuisines in use, rating choices and sort orders', async () => {
    stubFetch({ ...cuisines, [BASE]: () => page([soup, curry]) });
    renderList();
    expect(await screen.findByText('Tomato soup')).toBeInTheDocument();

    expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toBeInTheDocument();
    await vi.waitFor(() => expect(optionLabels(screen.getByLabelText('Cuisine'))).toEqual(['All cuisines', 'Italian', 'Indian']));
    expect(optionLabels(screen.getByLabelText('Rating'))).toEqual(['Any rating', '2 stars and up', '3 stars and up', '4 stars and up', '5 stars']);
    expect(optionLabels(screen.getByLabelText('Sort by'))).toEqual(['Newest first', 'Highest rated', 'Title A to Z']);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('hides the controls for a brand new, empty collection', async () => {
    stubFetch({ ...cuisines, [BASE]: () => page([]) });
    renderList();
    expect(await screen.findByRole('heading', { name: 'No recipes yet' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('still works when the cuisine list cannot be loaded', async () => {
    stubFetch({ [BASE]: () => page([soup]) });
    renderList();
    expect(await screen.findByText('Tomato soup')).toBeInTheDocument();
    expect(optionLabels(screen.getByLabelText('Cuisine'))).toEqual(['All cuisines']);
  });
});

describe('searching', () => {
  it('searches after a short pause and keeps the words in the URL', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      ...cuisines,
      [BASE]: () => page([soup, curry]),
      [`${BASE}&q=tomato`]: () => page([soup]),
    });
    renderList();
    await screen.findByText('Chicken curry');

    await user.type(screen.getByRole('searchbox', { name: 'Search recipes' }), 'tomato');
    expect(await screen.findByText('1 recipe for "tomato"')).toBeInTheDocument();
    expect(screen.queryByText('Chicken curry')).not.toBeInTheDocument();
    expect(screen.getByTestId('search')).toHaveTextContent('?q=tomato');
    // One search for the finished word, not one per keystroke.
    expect(mock.mock.calls.filter(([url]) => String(url).includes('q='))).toHaveLength(1);
    expect(optionLabels(screen.getByLabelText('Sort by'))).toEqual(['Best match', 'Newest first', 'Highest rated', 'Title A to Z']);
    expect(screen.getByLabelText('Sort by')).toHaveValue('relevance');
  });

  it('encodes what was typed', async () => {
    const user = userEvent.setup();
    stubFetch({
      ...cuisines,
      [BASE]: () => page([soup]),
      [`${BASE}&q=mac+%26+cheese`]: () => page([soup]),
    });
    renderList();
    await screen.findByText('Tomato soup');
    await user.type(screen.getByRole('searchbox'), 'mac & cheese');
    expect(await screen.findByText('1 recipe for "mac & cheese"')).toBeInTheDocument();
  });

  it('restores a search from the URL', async () => {
    stubFetch({
      ...cuisines,
      [`${BASE}&q=tomato&cuisine=Italian&minRating=4&sort=rating`]: () => page([soup]),
    });
    renderList('/?q=tomato&cuisine=Italian&minRating=4&sort=rating');
    expect(await screen.findByText('1 recipe for "tomato"')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('tomato');
    expect(screen.getByLabelText('Cuisine')).toHaveValue('Italian');
    expect(screen.getByLabelText('Rating')).toHaveValue('4');
    expect(screen.getByLabelText('Sort by')).toHaveValue('rating');
  });

  it('ignores filter values in the URL that the server would refuse', async () => {
    stubFetch({ ...cuisines, [BASE]: () => page([soup]) });
    renderList('/?minRating=9&sort=bogus&cuisine=');
    expect(await screen.findByText('Tomato soup')).toBeInTheDocument();
  });

  it('says so when nothing matches and offers to clear the search', async () => {
    const user = userEvent.setup();
    stubFetch({
      ...cuisines,
      [BASE]: () => page([soup]),
      [`${BASE}&q=zzz`]: () => page([]),
    });
    renderList('/?q=zzz');
    expect(await screen.findByRole('heading', { name: 'No recipes match your search' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No recipes yet' })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0] as HTMLElement);
    expect(await screen.findByText('Tomato soup')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByTestId('search')).toHaveTextContent('');
  });
});

describe('filtering and sorting', () => {
  it('filters by cuisine', async () => {
    const user = userEvent.setup();
    stubFetch({
      ...cuisines,
      [BASE]: () => page([soup, curry]),
      [`${BASE}&cuisine=Indian`]: () => page([curry]),
    });
    renderList();
    await screen.findByText('Tomato soup');
    await vi.waitFor(() => expect(optionLabels(screen.getByLabelText('Cuisine'))).toContain('Indian'));

    await user.selectOptions(screen.getByLabelText('Cuisine'), 'Indian');
    expect(await screen.findByText('1 recipe')).toBeInTheDocument();
    expect(screen.queryByText('Tomato soup')).not.toBeInTheDocument();
    expect(screen.getByTestId('search')).toHaveTextContent('?cuisine=Indian');
  });

  it('filters by minimum rating', async () => {
    const user = userEvent.setup();
    stubFetch({
      ...cuisines,
      [BASE]: () => page([soup, curry]),
      [`${BASE}&minRating=5`]: () => page([curry]),
    });
    renderList();
    await screen.findByText('Tomato soup');

    await user.selectOptions(screen.getByLabelText('Rating'), '5');
    expect(await screen.findByText('1 recipe')).toBeInTheDocument();
    expect(screen.getByTestId('search')).toHaveTextContent('?minRating=5');
  });

  it('sorts by rating', async () => {
    const user = userEvent.setup();
    stubFetch({
      ...cuisines,
      [BASE]: () => page([soup, curry]),
      [`${BASE}&sort=rating`]: () => page([curry, soup]),
    });
    renderList();
    await screen.findByText('Tomato soup');

    await user.selectOptions(screen.getByLabelText('Sort by'), 'rating');
    await vi.waitFor(() => {
      const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
      expect(headings).toEqual(['Chicken curry', 'Tomato soup']);
    });
    expect(screen.getByTestId('search')).toHaveTextContent('?sort=rating');
  });

  it('keeps the filters when loading more', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      ...cuisines,
      [`${BASE}&q=soup`]: () => page([soup, summary({ id: 3, title: 'Onion soup' })], 3),
      'GET /api/recipes?limit=24&offset=2&q=soup': () => page([summary({ id: 4, title: 'Pea soup' })], 3),
    });
    renderList('/?q=soup');
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Pea soup')).toBeInTheDocument();
    expect(screen.getByText('Tomato soup')).toBeInTheDocument();
    expect(mock.mock.calls.some(([url]) => String(url) === '/api/recipes?limit=24&offset=2&q=soup')).toBe(true);
  });

  it('clears every filter at once', async () => {
    const user = userEvent.setup();
    stubFetch({
      ...cuisines,
      [BASE]: () => page([soup, curry]),
      [`${BASE}&cuisine=Indian&minRating=5&sort=title`]: () => page([curry]),
    });
    renderList('/?cuisine=Indian&minRating=5&sort=title');
    expect(await screen.findByText('1 recipe')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Tomato soup')).toBeInTheDocument();
    expect(screen.getByLabelText('Rating')).toHaveValue('');
    expect(screen.getByTestId('search')).toHaveTextContent('');
  });
});
