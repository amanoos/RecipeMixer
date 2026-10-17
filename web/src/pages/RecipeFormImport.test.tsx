import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import type { ImportPreview } from '@/lib/types';
import { apiResponse, detail, findCall, pngFile, stubFetch } from '@/test-utils';
import { RecipeFormPage } from './RecipeFormPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

const preview = (overrides: Partial<ImportPreview> = {}): ImportPreview => ({
  draft: {
    title: 'Tomato soup',
    cuisine: 'Italian',
    description: 'Warm and simple.',
    ingredients: ['4 tomatoes', '1 onion'],
    steps: ['Chop', 'Simmer'],
  },
  imageUrl: 'https://food.example/img/soup.jpg',
  sourceUrl: 'https://food.example/soup',
  existingRecipeId: null,
  ...overrides,
});

function renderForm(entry: string | { pathname: string; state: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/import" element={<p>IMPORT PAGE</p>} />
        <Route path="/recipes/new" element={<RecipeFormPage />} />
        <Route path="/recipes/:id/edit" element={<RecipeFormPage />} />
        <Route path="/recipes/:id" element={<p>DETAIL PAGE</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const imported = (value: ImportPreview = preview()) => ({ pathname: '/recipes/new', state: { importPreview: value } });
const saveButton = () => screen.getByRole('button', { name: 'Save recipe' });
const bodyOf = (call: ReturnType<typeof findCall>) => JSON.parse((call?.[1] as RequestInit).body as string);

describe('creating a recipe from an imported page', () => {
  it('pre-fills every field, names the source and leaves the rating empty', () => {
    stubFetch({});
    renderForm(imported());

    expect(screen.getByLabelText('Title')).toHaveValue('Tomato soup');
    expect(screen.getByLabelText('Cuisine')).toHaveValue('Italian');
    expect(screen.getByLabelText('Source link')).toHaveValue('https://food.example/soup');
    expect(screen.getByLabelText('Description')).toHaveValue('Warm and simple.');
    expect(screen.getByLabelText('Ingredients')).toHaveValue('4 tomatoes\n1 onion');
    expect(screen.getByLabelText('Steps')).toHaveValue('Chop\nSimmer');
    expect(screen.getByRole('status')).toHaveTextContent('Imported from food.example');
    for (const star of screen.getAllByRole('button', { name: /Rate \d out of 5/ })) {
      expect(star).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('saves the reviewed values, then downloads the photo once', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      'POST /api/recipes': () => apiResponse(detail({ id: 7 }), 201),
      'POST /api/recipes/7/image/from-url': () => apiResponse(detail({ id: 7, imageUrl: '/api/images/a.webp' })),
    });
    renderForm(imported());

    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'My tomato soup');
    await user.click(saveButton());

    expect(await screen.findByText('DETAIL PAGE')).toBeInTheDocument();
    expect(bodyOf(findCall(mock, 'POST /api/recipes'))).toEqual({
      title: 'My tomato soup',
      cuisine: 'Italian',
      description: 'Warm and simple.',
      sourceUrl: 'https://food.example/soup',
      rating: null,
      ingredients: ['4 tomatoes', '1 onion'],
      steps: ['Chop', 'Simmer'],
    });
    expect(bodyOf(findCall(mock, 'POST /api/recipes/7/image/from-url'))).toEqual({
      url: 'https://food.example/img/soup.jpg',
    });
  });

  it('skips the photo when the box is unticked', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({ 'POST /api/recipes': () => apiResponse(detail({ id: 7 }), 201) });
    renderForm(imported());

    await user.click(screen.getByLabelText('Also download the photo from the page'));
    await user.click(saveButton());

    expect(await screen.findByText('DETAIL PAGE')).toBeInTheDocument();
    expect(findCall(mock, 'POST /api/recipes/7/image/from-url')).toBeUndefined();
  });

  it('uploads a chosen file instead of downloading the page photo', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      'POST /api/recipes': () => apiResponse(detail({ id: 7 }), 201),
      'PUT /api/recipes/7/image': () => apiResponse(detail({ id: 7, imageUrl: '/api/images/a.webp' })),
    });
    renderForm(imported());

    await user.upload(screen.getByLabelText('Image'), pngFile());
    expect(screen.getByLabelText('Also download the photo from the page')).toBeDisabled();
    await user.click(saveButton());

    expect(await screen.findByText('DETAIL PAGE')).toBeInTheDocument();
    expect(findCall(mock, 'PUT /api/recipes/7/image')).toBeDefined();
    expect(findCall(mock, 'POST /api/recipes/7/image/from-url')).toBeUndefined();
  });

  it('offers no photo option when the page had none', () => {
    stubFetch({});
    renderForm(imported(preview({ imageUrl: null })));
    expect(screen.queryByLabelText('Also download the photo from the page')).not.toBeInTheDocument();
  });

  it('keeps the saved recipe and retries only the photo when it cannot be downloaded', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const mock = stubFetch({
      'POST /api/recipes': () => apiResponse(detail({ id: 7 }), 201),
      'PUT /api/recipes/7': () => apiResponse(detail({ id: 7 })),
      'POST /api/recipes/7/image/from-url': () => {
        attempts += 1;
        return attempts === 1
          ? apiResponse({ error: 'Could not fetch that page' }, 502)
          : apiResponse(detail({ id: 7, imageUrl: '/api/images/a.webp' }));
      },
    });
    renderForm(imported());

    await user.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The recipe was saved, but the image could not be saved: Could not fetch that page',
    );

    await user.click(saveButton());
    expect(await screen.findByText('DETAIL PAGE')).toBeInTheDocument();
    const creates = mock.mock.calls.filter(([url, init]) => String(url) === '/api/recipes' && init?.method === 'POST');
    expect(creates).toHaveLength(1);
    expect(attempts).toBe(2);
  });

  it('ignores router state that is not a valid preview and opens a blank form', () => {
    stubFetch({});
    renderForm({ pathname: '/recipes/new', state: { importPreview: { draft: 'nope' } } });
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not pre-fill an existing recipe that is being edited', async () => {
    stubFetch({ 'GET /api/recipes/7': () => apiResponse(detail({ id: 7 })) });
    renderForm({ pathname: '/recipes/7/edit', state: { importPreview: preview() } });
    expect(await screen.findByLabelText('Title')).toHaveValue('Tomato soup');
    expect(screen.getByLabelText('Ingredients')).toHaveValue('4 tomatoes\n1 onion');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Also download the photo from the page')).not.toBeInTheDocument();
  });
});

describe('leaving an imported form', () => {
  it('opens a blank form when "New recipe" is chosen from the header', async () => {
    const user = userEvent.setup();
    stubFetch({ 'GET /api/health': () => apiResponse({ status: 'ok', schemaVersion: 4 }) });
    render(
      <MemoryRouter initialEntries={[imported()]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Title')).toHaveValue('Tomato soup');

    await user.click(screen.getByRole('link', { name: 'New recipe' }));

    expect(await screen.findByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Ingredients')).toHaveValue('');
    expect(screen.queryByRole('status', { name: /imported/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Imported from/)).not.toBeInTheDocument();
  });
});
