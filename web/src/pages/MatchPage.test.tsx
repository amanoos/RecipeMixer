import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchItem } from '@/lib/types';
import { apiResponse, findCall, stubFetch, summary } from '@/test-utils';
import { MatchPage } from './MatchPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

function LocationProbe() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderPage(path = '/match') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/match"
          element={
            <>
              <MatchPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function item(id: number, title: string, matched: number, total: number, missing: string[] = []): MatchItem {
  return {
    recipe: summary({ id, title }),
    matchedCount: matched,
    totalCount: total,
    coverage: matched / total,
    score: matched / total,
    matched: [],
    missing,
  };
}

const result = (items: MatchItem[], overrides: Record<string, unknown> = {}) =>
  apiResponse({ items, total: items.length, usedIngredients: [], ignored: [], assumeStaples: true, ...overrides });

const URL_CHICKEN_RICE = 'GET /api/match?i=chicken&i=rice&staples=1&limit=24&offset=0';

describe('MatchPage', () => {
  it('asks for ingredients first and does not call the server', () => {
    const mock = stubFetch({});
    renderPage();
    expect(screen.getByText(/Add the ingredients you have/)).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  });

  it('searches the ingredients in the URL and shows ranked results', async () => {
    stubFetch({
      [URL_CHICKEN_RICE]: () =>
        result([item(1, 'Chicken fried rice', 5, 7, ['2 cloves garlic']), item(2, 'Chicken soup', 2, 6, ['1 onion'])]),
    });
    renderPage('/match?i=chicken&i=rice');

    expect(await screen.findByRole('heading', { name: '2 recipes you could make or nearly make' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Chicken fried rice/ })).toHaveAttribute('href', '/recipes/1');
    expect(screen.getByText('You have 5 of 7')).toBeInTheDocument();
    expect(screen.getByText('Missing: 2 cloves garlic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove chicken' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('uses the singular for one result', async () => {
    stubFetch({ [URL_CHICKEN_RICE]: () => result([item(1, 'Chicken fried rice', 2, 2)]) });
    renderPage('/match?i=chicken&i=rice');
    expect(await screen.findByRole('heading', { name: '1 recipe you could make or nearly make' })).toBeInTheDocument();
  });

  it('respects staples=0 in the URL', async () => {
    const mock = stubFetch({
      'GET /api/match?i=egg&staples=0&limit=24&offset=0': () => result([item(1, 'Omelette', 1, 4)]),
    });
    renderPage('/match?i=egg&staples=0');
    await screen.findByText('Omelette');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(findCall(mock, 'GET /api/match?i=egg&staples=0&limit=24&offset=0')).toBeDefined();
  });

  it('searches again and updates the URL when the staples switch changes', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      'GET /api/match?i=egg&staples=1&limit=24&offset=0': () => result([item(1, 'Omelette', 1, 3)]),
      'GET /api/match?i=egg&staples=0&limit=24&offset=0': () => result([item(1, 'Omelette', 1, 4)]),
    });
    renderPage('/match?i=egg');
    expect(await screen.findByText('You have 1 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox'));
    expect(await screen.findByText('You have 1 of 4')).toBeInTheDocument();
    expect(screen.getByTestId('search')).toHaveTextContent('?i=egg&staples=0');
    expect(findCall(mock, 'GET /api/match?i=egg&staples=0&limit=24&offset=0')).toBeDefined();
  });

  it('searches as ingredients are added and keeps them in the URL', async () => {
    const user = userEvent.setup();
    stubFetch({
      'GET /api/match?i=egg&staples=1&limit=24&offset=0': () => result([item(1, 'Omelette', 1, 3)]),
    });
    renderPage();
    await user.type(screen.getByLabelText('Ingredients you have'), 'egg{Enter}');
    expect(await screen.findByText('Omelette')).toBeInTheDocument();
    expect(screen.getByTestId('search')).toHaveTextContent('?i=egg');
  });

  it('clears the results and the URL when the last ingredient is removed', async () => {
    const user = userEvent.setup();
    stubFetch({ 'GET /api/match?i=egg&staples=1&limit=24&offset=0': () => result([item(1, 'Omelette', 1, 3)]) });
    renderPage('/match?i=egg');
    await screen.findByText('Omelette');

    await user.click(screen.getByRole('button', { name: 'Remove egg' }));
    expect(screen.getByText(/Add the ingredients you have/)).toBeInTheDocument();
    expect(screen.queryByText('Omelette')).not.toBeInTheDocument();
    expect(screen.getByTestId('search')).toHaveTextContent('');
  });

  it('says when nothing is close and offers to add a recipe', async () => {
    stubFetch({ 'GET /api/match?i=dragonfruit&staples=1&limit=24&offset=0': () => result([]) });
    renderPage('/match?i=dragonfruit');
    expect(await screen.findByText('Nothing close yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a recipe' })).toHaveAttribute('href', '/recipes/new');
  });

  it('mentions inputs the server could not use', async () => {
    stubFetch({
      'GET /api/match?i=egg&i=%21%21%21&staples=1&limit=24&offset=0': () =>
        result([item(1, 'Omelette', 1, 3)], { ignored: ['!!!'] }),
    });
    renderPage('/match?i=egg&i=!!!');
    expect(await screen.findByText('Skipped (not recognised as ingredients): !!!')).toBeInTheDocument();
  });

  it('shows an error and recovers when the user retries', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    stubFetch({
      'GET /api/match?i=egg&staples=1&limit=24&offset=0': () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new TypeError('Failed to fetch'))
          : result([item(1, 'Omelette', 1, 3)]);
      },
    });
    renderPage('/match?i=egg');
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not search your recipes/i);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Omelette')).toBeInTheDocument();
  });

  it('loads more results on request', async () => {
    const user = userEvent.setup();
    stubFetch({
      'GET /api/match?i=egg&staples=1&limit=24&offset=0': () =>
        result([item(1, 'First', 3, 3), item(2, 'Second', 2, 3)], { total: 3 }),
      'GET /api/match?i=egg&staples=1&limit=24&offset=2': () => result([item(3, 'Third', 1, 3)], { total: 3 }),
    });
    renderPage('/match?i=egg');
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Third')).toBeInTheDocument();
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('keeps a hostile ingredient inert and encoded', async () => {
    const hostile = "x'); DROP TABLE recipe;--";
    const mock = stubFetch({
      [`GET /api/match?${new URLSearchParams({ i: hostile }).toString()}&staples=1&limit=24&offset=0`]: () => result([]),
    });
    renderPage(`/match?${new URLSearchParams({ i: hostile }).toString()}`);
    expect(await screen.findByText('Nothing close yet.')).toBeInTheDocument();
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
