import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth';
import type { ImportPreview } from '@/lib/types';
import { apiResponse, findCall, stubFetch } from '@/test-utils';
import { ImportPage } from './ImportPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

function FormProbe() {
  const state = useLocation().state as { importPreview?: ImportPreview } | null;
  return <p>NEW RECIPE FORM: {state?.importPreview?.draft.title}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/import']}>
      <Routes>
        <Route path="/import" element={<ImportPage />} />
        <Route path="/recipes/new" element={<FormProbe />} />
        <Route path="/recipes/:id" element={<p>EXISTING RECIPE</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const preview = (overrides: Partial<ImportPreview> = {}): ImportPreview => ({
  draft: { title: 'Tomato soup', cuisine: null, description: null, ingredients: ['1 onion'], steps: ['Chop'] },
  imageUrl: null,
  sourceUrl: 'https://food.example/soup',
  existingRecipeId: null,
  ...overrides,
});

const importButton = () => screen.getByRole('button', { name: 'Import' });

describe('ImportPage', () => {
  it('asks for a link and sends nothing when the box is empty', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({});
    renderPage();
    await user.click(importButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Paste a recipe link first.');
    expect(mock).not.toHaveBeenCalled();
  });

  it('sends the trimmed link and opens the new-recipe form with the draft', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({ 'POST /api/import/preview': () => apiResponse(preview()) });
    renderPage();

    await user.type(screen.getByLabelText('Recipe link'), '  https://food.example/soup  ');
    await user.click(importButton());

    expect(await screen.findByText('NEW RECIPE FORM: Tomato soup')).toBeInTheDocument();
    const body = JSON.parse((findCall(mock, 'POST /api/import/preview')?.[1] as RequestInit).body as string);
    expect(body).toEqual({ url: 'https://food.example/soup' });
  });

  it('shows a busy state while the server reads the page', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    stubFetch({
      'POST /api/import/preview': () =>
        new Promise((resolve) => {
          release = () => resolve(apiResponse(preview()));
        }),
    });
    renderPage();

    await user.type(screen.getByLabelText('Recipe link'), 'https://food.example/soup');
    await user.click(importButton());
    expect(await screen.findByRole('button', { name: 'Reading...' })).toBeDisabled();

    release();
    expect(await screen.findByText(/NEW RECIPE FORM/)).toBeInTheDocument();
  });

  it('shows the server message and stays on the page when the import fails', async () => {
    const user = userEvent.setup();
    stubFetch({ 'POST /api/import/preview': () => apiResponse({ error: 'No recipe data found on that page' }, 422) });
    renderPage();

    await user.type(screen.getByLabelText('Recipe link'), 'https://food.example/blog');
    await user.click(importButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('No recipe data found on that page');
    expect(importButton()).toBeEnabled();
    expect(screen.queryByText(/NEW RECIPE FORM/)).not.toBeInTheDocument();
  });

  it('explains when importing is switched off', async () => {
    const user = userEvent.setup();
    stubFetch({ 'POST /api/import/preview': () => apiResponse({ error: 'Not Found' }, 404) });
    renderPage();

    await user.type(screen.getByLabelText('Recipe link'), 'https://food.example/soup');
    await user.click(importButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('turned off on this server');
  });

  it('reports an unreachable server', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderPage();

    await user.type(screen.getByLabelText('Recipe link'), 'https://food.example/soup');
    await user.click(importButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
  });

  it('warns about a recipe that was already saved from the link, and lets the user continue', async () => {
    const user = userEvent.setup();
    stubFetch({ 'POST /api/import/preview': () => apiResponse(preview({ existingRecipeId: 12 })) });
    renderPage();

    await user.type(screen.getByLabelText('Recipe link'), 'https://food.example/soup');
    await user.click(importButton());

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('You already have a recipe saved from this link');
    expect(screen.getByRole('link', { name: 'open it' })).toHaveAttribute('href', '/recipes/12');
    expect(screen.queryByText(/NEW RECIPE FORM/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Import anyway' }));
    expect(await screen.findByText('NEW RECIPE FORM: Tomato soup')).toBeInTheDocument();
  });
});

describe('ImportPage and TheMealDB', () => {
  function renderWithFeature(mealdb: boolean) {
    return render(
      <AuthContext.Provider value={{ authRequired: false, features: { mealdb, imageSearch: false }, logout: async () => undefined }}>
        <MemoryRouter initialEntries={['/import']}>
          <Routes>
            <Route path="/import" element={<ImportPage />} />
            <Route path="/recipes/new" element={<FormProbe />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
  }

  it('does not show the TheMealDB search unless the server has it on', () => {
    stubFetch({});
    renderWithFeature(false);
    expect(screen.queryByRole('heading', { name: 'Find on TheMealDB' })).not.toBeInTheDocument();
    renderPage();
    expect(screen.queryByLabelText('Recipe name')).not.toBeInTheDocument();
  });

  it('shows the search when it is on, and a chosen recipe opens the same review form as a link import', async () => {
    const user = userEvent.setup();
    stubFetch({
      'GET /api/mealdb/search?q=soup': () =>
        apiResponse({ items: [{ id: '5', title: 'Tomato soup', cuisine: null, category: 'Starter' }] }),
      'GET /api/mealdb/meals/5': () => apiResponse(preview({ sourceUrl: 'https://www.themealdb.com/meal/5' })),
    });
    renderWithFeature(true);

    expect(screen.getByRole('heading', { name: 'Find on TheMealDB' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Recipe name'), 'soup');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'Review Tomato soup' }));

    expect(await screen.findByText('NEW RECIPE FORM: Tomato soup')).toBeInTheDocument();
  });
});

describe('ImportPage and TheMealDB', () => {
  function renderWithFeature(mealdb: boolean) {
    return render(
      <AuthContext.Provider value={{ authRequired: false, features: { mealdb, imageSearch: false }, logout: async () => undefined }}>
        <MemoryRouter initialEntries={['/import']}>
          <Routes>
            <Route path="/import" element={<ImportPage />} />
            <Route path="/recipes/new" element={<FormProbe />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
  }

  it('does not show the TheMealDB search unless the server has it on', () => {
    stubFetch({});
    renderWithFeature(false);
    expect(screen.queryByRole('heading', { name: 'Find on TheMealDB' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Recipe name')).not.toBeInTheDocument();
  });

  it('shows the search when it is on, and a chosen recipe opens the same review form as a link import', async () => {
    const user = userEvent.setup();
    stubFetch({
      'GET /api/mealdb/search?q=soup': () =>
        apiResponse({ items: [{ id: '5', title: 'Tomato soup', cuisine: null, category: 'Starter' }] }),
      'GET /api/mealdb/meals/5': () => apiResponse(preview({ sourceUrl: 'https://www.themealdb.com/meal/5' })),
    });
    renderWithFeature(true);

    expect(screen.getByRole('heading', { name: 'Find on TheMealDB' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Recipe name'), 'soup');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'Review Tomato soup' }));

    expect(await screen.findByText('NEW RECIPE FORM: Tomato soup')).toBeInTheDocument();
  });
});
