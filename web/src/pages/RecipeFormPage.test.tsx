import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth';
import { RecipeFormPage } from './RecipeFormPage';
import { apiResponse, detail, findCall, pngFile, stubFetch } from '@/test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderForm(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>HOME PAGE</p>} />
        <Route path="/recipes/new" element={<RecipeFormPage />} />
        <Route path="/recipes/:id/edit" element={<RecipeFormPage />} />
        <Route path="/recipes/:id" element={<p>DETAIL PAGE</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const saveButton = () => screen.getByRole('button', { name: 'Save recipe' });

function bodyOf(call: ReturnType<typeof findCall>) {
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

describe('creating a recipe', () => {
  it('requires a title and sends nothing when it is missing', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({});
    renderForm('/recipes/new');
    await user.click(saveButton());
    expect(await screen.findByText('Title is required.')).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  });

  it('saves the recipe, splitting ingredients and steps into lines', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({ 'POST /api/recipes': () => apiResponse(detail({ id: 7 }), 201) });
    renderForm('/recipes/new');

    await user.type(screen.getByLabelText('Title'), '  Pasta  ');
    await user.type(screen.getByLabelText('Cuisine'), 'Italian');
    await user.type(screen.getByLabelText('Ingredients'), 'salt{Enter}{Enter}  pepper  ');
    await user.type(screen.getByLabelText('Steps'), 'Boil{Enter}Drain');
    await user.click(screen.getByRole('button', { name: 'Rate 4 out of 5' }));
    await user.click(saveButton());

    expect(await screen.findByText('DETAIL PAGE')).toBeInTheDocument();
    expect(bodyOf(findCall(mock, 'POST /api/recipes'))).toEqual({
      title: 'Pasta',
      cuisine: 'Italian',
      description: null,
      sourceUrl: null,
      rating: 4,
      ingredients: ['salt', 'pepper'],
      steps: ['Boil', 'Drain'],
    });
  });

  it('uploads the chosen image after the recipe is saved', async () => {
    const user = userEvent.setup();
    const file = pngFile('dish.png');
    const mock = stubFetch({
      'POST /api/recipes': () => apiResponse(detail({ id: 7 }), 201),
      'PUT /api/recipes/7/image': () => apiResponse(detail({ id: 7, imageUrl: '/api/images/a.webp' })),
    });
    renderForm('/recipes/new');

    await user.type(screen.getByLabelText('Title'), 'Pasta');
    await user.upload(screen.getByLabelText('Image'), file);
    await user.click(saveButton());

    expect(await screen.findByText('DETAIL PAGE')).toBeInTheDocument();
    const upload = findCall(mock, 'PUT /api/recipes/7/image');
    expect((upload?.[1] as RequestInit).body).toBeInstanceOf(FormData);
    expect(((upload?.[1] as RequestInit).body as FormData).get('image')).toBe(file);
  });

  it('shows the server message and stays on the form when saving fails', async () => {
    const user = userEvent.setup();
    stubFetch({
      'POST /api/recipes': () => apiResponse({ error: 'Invalid sourceUrl: must be an http or https URL' }, 400),
    });
    renderForm('/recipes/new');

    await user.type(screen.getByLabelText('Title'), 'Pasta');
    await user.type(screen.getByLabelText('Source link'), 'banana');
    await user.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid sourceUrl: must be an http or https URL');
    expect(screen.queryByText('DETAIL PAGE')).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('does not create a duplicate when only the image upload failed', async () => {
    const user = userEvent.setup();
    let imageAttempts = 0;
    const mock = stubFetch({
      'POST /api/recipes': () => apiResponse(detail({ id: 7 }), 201),
      'PUT /api/recipes/7': () => apiResponse(detail({ id: 7 })),
      'PUT /api/recipes/7/image': () => {
        imageAttempts += 1;
        return imageAttempts === 1
          ? apiResponse({ error: 'Only JPEG, PNG and WebP images are supported' }, 415)
          : apiResponse(detail({ id: 7, imageUrl: '/api/images/a.webp' }));
      },
    });
    renderForm('/recipes/new');

    await user.type(screen.getByLabelText('Title'), 'Pasta');
    await user.upload(screen.getByLabelText('Image'), pngFile());
    await user.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/recipe was saved, but the image could not be saved/i);

    await user.click(saveButton());
    expect(await screen.findByText('DETAIL PAGE')).toBeInTheDocument();
    const creates = mock.mock.calls.filter(([url, init]) => String(url) === '/api/recipes' && init?.method === 'POST');
    expect(creates).toHaveLength(1);
    expect(findCall(mock, 'PUT /api/recipes/7')).toBeDefined();
  });
});

describe('editing a recipe', () => {
  it('pre-fills the form and updates the recipe', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      'GET /api/recipes/7': () => apiResponse(detail({ id: 7 })),
      'PUT /api/recipes/7': () => apiResponse(detail({ id: 7, title: 'Better soup' })),
    });
    renderForm('/recipes/7/edit');

    const title = await screen.findByLabelText('Title');
    expect(title).toHaveValue('Tomato soup');
    expect(screen.getByLabelText('Cuisine')).toHaveValue('Italian');
    expect(screen.getByLabelText('Ingredients')).toHaveValue('4 tomatoes\n1 onion');
    expect(screen.getByRole('button', { name: 'Rate 4 out of 5' })).toHaveAttribute('aria-pressed', 'true');

    await user.clear(title);
    await user.type(title, 'Better soup');
    await user.click(saveButton());

    expect(await screen.findByText('DETAIL PAGE')).toBeInTheDocument();
    expect(bodyOf(findCall(mock, 'PUT /api/recipes/7')).title).toBe('Better soup');
  });

  it('removes the existing image when asked', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      'GET /api/recipes/7': () => apiResponse(detail({ id: 7, imageUrl: '/api/images/a.webp' })),
      'PUT /api/recipes/7': () => apiResponse(detail({ id: 7, imageUrl: '/api/images/a.webp' })),
      'DELETE /api/recipes/7/image': () => apiResponse(detail({ id: 7, imageUrl: null })),
    });
    renderForm('/recipes/7/edit');

    await user.click(await screen.findByRole('button', { name: 'Remove image' }));
    await user.click(saveButton());

    expect(await screen.findByText('DETAIL PAGE')).toBeInTheDocument();
    expect(findCall(mock, 'DELETE /api/recipes/7/image')).toBeDefined();
  });

  it('reports a recipe that cannot be found', async () => {
    stubFetch({ 'GET /api/recipes/9': () => apiResponse({ error: 'Recipe not found' }, 404) });
    renderForm('/recipes/9/edit');
    expect(await screen.findByRole('heading', { name: 'Recipe not found' })).toBeInTheDocument();
  });
});

describe('photo search on the form', () => {
  const photo = {
    token: 'token-1',
    thumbnail: 'data:image/webp;base64,AAAA',
    title: 'Pasta photo',
    creator: 'Jane',
    licence: 'CC BY 2.0',
    licenceUrl: null,
    landingUrl: null,
    provider: 'Wikimedia Commons',
  };

  function renderWithSearch(path: string) {
    return render(
      <AuthContext.Provider value={{ authRequired: false, features: { mealdb: false, imageSearch: true }, logout: async () => undefined }}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/recipes/new" element={<RecipeFormPage />} />
            <Route path="/recipes/:id" element={<p>DETAIL PAGE</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
  }

  async function pickPhoto(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('Title'), 'Pasta');
    await user.click(screen.getByRole('button', { name: 'Find a photo for this title' }));
    await user.click(await screen.findByRole('button', { name: 'Use the photo Pasta photo' }));
  }

  it('offers no search when the server has it off', () => {
    stubFetch({});
    renderForm('/recipes/new');
    expect(screen.queryByRole('button', { name: 'Find a photo for this title' })).not.toBeInTheDocument();
  });

  it('keeps the button off until there is a title', async () => {
    const user = userEvent.setup();
    stubFetch({});
    renderWithSearch('/recipes/new');
    const button = screen.getByRole('button', { name: 'Find a photo for this title' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Title'), 'Pasta');
    expect(button).toBeEnabled();
  });

  it('holds the chosen photo, and attaches it once the recipe is saved', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      'GET /api/image-search?q=Pasta': () => apiResponse({ items: [photo] }),
      'POST /api/recipes': () => apiResponse(detail({ id: 7 }), 201),
      'POST /api/recipes/7/image/from-search': () => apiResponse(detail({ id: 7, imageUrl: '/api/images/a.webp' })),
    });
    renderWithSearch('/recipes/new');
    await pickPhoto(user);

    expect(await screen.findByText(/Photo found: Pasta photo/)).toBeInTheDocument();
    expect(findCall(mock, 'POST /api/recipes/7/image/from-search')).toBeUndefined();

    await user.click(saveButton());
    expect(await screen.findByText('DETAIL PAGE')).toBeInTheDocument();
    expect(bodyOf(findCall(mock, 'POST /api/recipes/7/image/from-search'))).toEqual({ token: 'token-1' });
  });

  it('forgets the chosen photo when Remove is pressed', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      'GET /api/image-search?q=Pasta': () => apiResponse({ items: [photo] }),
      'POST /api/recipes': () => apiResponse(detail({ id: 7 }), 201),
    });
    renderWithSearch('/recipes/new');
    await pickPhoto(user);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText(/Photo found/)).not.toBeInTheDocument();

    await user.click(saveButton());
    expect(await screen.findByText('DETAIL PAGE')).toBeInTheDocument();
    expect(findCall(mock, 'POST /api/recipes/7/image/from-search')).toBeUndefined();
  });

  it('prefers a file chosen from the computer over a found photo', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      'GET /api/image-search?q=Pasta': () => apiResponse({ items: [photo] }),
      'POST /api/recipes': () => apiResponse(detail({ id: 7 }), 201),
      'PUT /api/recipes/7/image': () => apiResponse(detail({ id: 7, imageUrl: '/api/images/a.webp' })),
    });
    renderWithSearch('/recipes/new');
    await pickPhoto(user);
    await user.upload(screen.getByLabelText('Image'), pngFile('mine.png'));

    expect(screen.queryByText(/Photo found/)).not.toBeInTheDocument();
    await user.click(saveButton());
    expect(await screen.findByText('DETAIL PAGE')).toBeInTheDocument();
    expect(findCall(mock, 'PUT /api/recipes/7/image')).toBeDefined();
    expect(findCall(mock, 'POST /api/recipes/7/image/from-search')).toBeUndefined();
  });

  it('says the recipe was saved but the photo was not, when the choice has expired', async () => {
    const user = userEvent.setup();
    stubFetch({
      'GET /api/image-search?q=Pasta': () => apiResponse({ items: [photo] }),
      'POST /api/recipes': () => apiResponse(detail({ id: 7 }), 201),
      'POST /api/recipes/7/image/from-search': () => apiResponse({ error: 'That photo choice is not valid any more. Search again.' }, 400),
    });
    renderWithSearch('/recipes/new');
    await pickPhoto(user);
    await user.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('The recipe was saved, but the image could not be saved');
    // an expired choice is not offered again, so saving a second time does not repeat the failure
    expect(screen.queryByText(/Photo found/)).not.toBeInTheDocument();
  });
});
