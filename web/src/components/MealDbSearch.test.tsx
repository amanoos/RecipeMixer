import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportPreview } from '@/lib/types';
import { apiResponse, findCall, stubFetch } from '@/test-utils';
import { MealDbSearch } from './MealDbSearch';

afterEach(() => {
  vi.unstubAllGlobals();
});

const preview = (overrides: Partial<ImportPreview> = {}): ImportPreview => ({
  draft: { title: 'Arrabiata', cuisine: 'Italian', description: null, ingredients: ['1 onion'], steps: ['Cook'] },
  imageUrl: 'https://www.themealdb.com/images/media/meals/a.jpg',
  sourceUrl: 'https://www.themealdb.com/meal/52771',
  existingRecipeId: null,
  ...overrides,
});

const results = {
  items: [
    { id: '52771', title: 'Spicy Arrabiata Penne', cuisine: 'Italian', category: 'Vegetarian' },
    { id: '1', title: 'Plain Soup', cuisine: null, category: null },
  ],
};

function renderSearch(onReview = vi.fn()) {
  render(
    <MemoryRouter>
      <MealDbSearch onReview={onReview} />
    </MemoryRouter>,
  );
  return onReview;
}

const search = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByLabelText('Recipe name'), text);
  await user.click(screen.getByRole('button', { name: 'Search' }));
};

describe('MealDbSearch', () => {
  it('says where the recipes come from and what the terms limit, with a link to TheMealDB', () => {
    stubFetch({});
    renderSearch();
    expect(screen.getByText(/not open source/)).toBeInTheDocument();
    expect(screen.getByText(/app store/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'TheMealDB' })).toHaveAttribute('href', 'https://www.themealdb.com');
  });

  it('asks for at least two letters and sends nothing for less', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({});
    renderSearch();
    await search(user, 'a');
    expect(await screen.findByRole('alert')).toHaveTextContent('at least two letters');
    expect(mock).not.toHaveBeenCalled();
  });

  it('lists the results with cuisine and category', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({ 'GET /api/mealdb/search?q=arrabiata': () => apiResponse(results) });
    renderSearch();
    await search(user, '  arrabiata ');

    expect(await screen.findByText('Spicy Arrabiata Penne')).toBeInTheDocument();
    expect(screen.getByText('Italian · Vegetarian')).toBeInTheDocument();
    expect(screen.getByText('No details')).toBeInTheDocument();
    expect(findCall(mock, 'GET /api/mealdb/search?q=arrabiata')).toBeDefined();
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    stubFetch({ 'GET /api/mealdb/search?q=zzz': () => apiResponse({ items: [] }) });
    renderSearch();
    await search(user, 'zzz');
    expect(await screen.findByText(/No recipes found for/)).toBeInTheDocument();
  });

  it('opens the chosen recipe for review', async () => {
    const user = userEvent.setup();
    stubFetch({
      'GET /api/mealdb/search?q=arrabiata': () => apiResponse(results),
      'GET /api/mealdb/meals/52771': () => apiResponse(preview()),
    });
    const onReview = renderSearch();
    await search(user, 'arrabiata');
    await user.click(await screen.findByRole('button', { name: 'Review Spicy Arrabiata Penne' }));

    await vi.waitFor(() => expect(onReview).toHaveBeenCalledWith(preview()));
  });

  it('warns about a recipe that is already saved and lets the user carry on anyway', async () => {
    const user = userEvent.setup();
    const saved = preview({ existingRecipeId: 7 });
    stubFetch({
      'GET /api/mealdb/search?q=arrabiata': () => apiResponse(results),
      'GET /api/mealdb/meals/52771': () => apiResponse(saved),
    });
    const onReview = renderSearch();
    await search(user, 'arrabiata');
    await user.click(await screen.findByRole('button', { name: 'Review Spicy Arrabiata Penne' }));

    expect(await screen.findByRole('link', { name: 'open it' })).toHaveAttribute('href', '/recipes/7');
    expect(onReview).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Import anyway' }));
    expect(onReview).toHaveBeenCalledWith(saved);
  });

  it('shows the server message when the search fails', async () => {
    const user = userEvent.setup();
    stubFetch({ 'GET /api/mealdb/search?q=pasta': () => apiResponse({ error: 'Could not fetch that page' }, 502) });
    renderSearch();
    await search(user, 'pasta');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not fetch that page');
  });

  it('says the search is off when the server has switched it off', async () => {
    const user = userEvent.setup();
    stubFetch({ 'GET /api/mealdb/search?q=pasta': () => apiResponse({ error: 'Not Found' }, 404) });
    renderSearch();
    await search(user, 'pasta');
    expect(await screen.findByRole('alert')).toHaveTextContent('turned off');
  });
});
