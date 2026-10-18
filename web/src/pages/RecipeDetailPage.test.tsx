import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth';
import { RecipeDetailPage } from './RecipeDetailPage';
import { apiResponse, detail, findCall, stubFetch } from '@/test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>HOME PAGE</p>} />
        <Route path="/recipes/:id" element={<RecipeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RecipeDetailPage', () => {
  it('shows the recipe with ingredients and ordered steps', async () => {
    stubFetch({
      'GET /api/recipes/1': () => apiResponse(detail({ imageUrl: '/api/images/a.webp' })),
    });
    renderAt('/recipes/1');

    expect(await screen.findByRole('heading', { level: 1, name: 'Tomato soup' })).toBeInTheDocument();
    expect(screen.getByText('Warm and simple.')).toBeInTheDocument();
    expect(screen.getByAltText('Photo of Tomato soup')).toHaveAttribute('src', '/api/images/a.webp');
    expect(screen.getByRole('button', { name: 'Rate 4 out of 5' })).toHaveAttribute('aria-pressed', 'true');

    const [ingredientList, stepList] = screen.getAllByRole('list');
    expect(within(ingredientList!).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '4 tomatoes',
      '1 onion',
    ]);
    expect(within(stepList!).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Chop everything',
      'Simmer for 20 minutes',
    ]);
    expect(stepList?.tagName).toBe('OL');
    expect(screen.getByRole('link', { name: /Edit/ })).toHaveAttribute('href', '/recipes/1/edit');
  });

  it('links an http(s) source with safe attributes', async () => {
    stubFetch({ 'GET /api/recipes/1': () => apiResponse(detail()) });
    renderAt('/recipes/1');
    const link = await screen.findByRole('link', { name: 'https://example.com/soup' });
    expect(link).toHaveAttribute('href', 'https://example.com/soup');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('shows a non-http source as plain text, never as a link', async () => {
    stubFetch({ 'GET /api/recipes/1': () => apiResponse(detail({ sourceUrl: 'javascript:alert(1)' })) });
    renderAt('/recipes/1');
    expect(await screen.findByText('javascript:alert(1)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'javascript:alert(1)' })).not.toBeInTheDocument();
  });

  it('reports a recipe that does not exist', async () => {
    stubFetch({ 'GET /api/recipes/9': () => apiResponse({ error: 'Recipe not found' }, 404) });
    renderAt('/recipes/9');
    expect(await screen.findByRole('heading', { name: 'Recipe not found' })).toBeInTheDocument();
  });

  it('does not call the server for a nonsense id', async () => {
    const mock = stubFetch({});
    renderAt('/recipes/abc');
    expect(await screen.findByRole('heading', { name: 'Recipe not found' })).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  });

  it('shows an error when the server cannot be reached', async () => {
    stubFetch({ 'GET /api/recipes/1': () => Promise.reject(new TypeError('Failed to fetch')) });
    renderAt('/recipes/1');
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load this recipe/i);
  });

  it('asks for confirmation and does nothing when cancelled', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({ 'GET /api/recipes/1': () => apiResponse(detail()) });
    renderAt('/recipes/1');

    await user.click(await screen.findByRole('button', { name: /Delete/ }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/cannot be undone/i);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(findCall(mock, 'DELETE /api/recipes/1')).toBeUndefined();
    expect(screen.getByRole('heading', { level: 1, name: 'Tomato soup' })).toBeInTheDocument();
  });

  it('deletes after confirmation and returns to the list', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      'GET /api/recipes/1': () => apiResponse(detail()),
      'DELETE /api/recipes/1': () => apiResponse(undefined, 204),
    });
    renderAt('/recipes/1');

    await user.click(await screen.findByRole('button', { name: /Delete/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete recipe' }));

    expect(await screen.findByText('HOME PAGE')).toBeInTheDocument();
    expect(findCall(mock, 'DELETE /api/recipes/1')).toBeDefined();
  });

  it('saves a new rating at once when a star is clicked', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      'GET /api/recipes/1': () => apiResponse(detail()),
      'PATCH /api/recipes/1/rating': () => apiResponse(detail({ rating: 5 })),
    });
    renderAt('/recipes/1');

    await user.click(await screen.findByRole('button', { name: 'Rate 5 out of 5' }));
    expect(screen.getByRole('button', { name: 'Rate 5 out of 5' })).toHaveAttribute('aria-pressed', 'true');
    const call = findCall(mock, 'PATCH /api/recipes/1/rating');
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({ rating: 5 });
  });

  it('clears the rating when the current star is clicked again', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      'GET /api/recipes/1': () => apiResponse(detail()),
      'PATCH /api/recipes/1/rating': () => apiResponse(detail({ rating: null })),
    });
    renderAt('/recipes/1');

    await user.click(await screen.findByRole('button', { name: 'Rate 4 out of 5' }));
    expect(screen.getByRole('button', { name: 'Rate 4 out of 5' })).toHaveAttribute('aria-pressed', 'false');
    const call = findCall(mock, 'PATCH /api/recipes/1/rating');
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({ rating: null });
  });

  it('puts the old rating back and says so when saving fails', async () => {
    const user = userEvent.setup();
    stubFetch({
      'GET /api/recipes/1': () => apiResponse(detail()),
      'PATCH /api/recipes/1/rating': () => apiResponse({ error: 'nope' }, 500),
    });
    renderAt('/recipes/1');

    await user.click(await screen.findByRole('button', { name: 'Rate 2 out of 5' }));
    expect(await screen.findByText(/could not save your rating/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rate 4 out of 5' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Rate 2 out of 5' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the recipe and shows an error when deletion fails', async () => {
    const user = userEvent.setup();
    stubFetch({
      'GET /api/recipes/1': () => apiResponse(detail()),
      'DELETE /api/recipes/1': () => apiResponse({ error: 'nope' }, 500),
    });
    renderAt('/recipes/1');

    await user.click(await screen.findByRole('button', { name: /Delete/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete recipe' }));

    expect(await screen.findByText(/could not delete the recipe/i)).toBeInTheDocument();
    expect(screen.queryByText('HOME PAGE')).not.toBeInTheDocument();
  });
});

describe('RecipeDetailPage and titles in other scripts', () => {
  const TITLE = 'Braised Pork Belly (Hong Shao Rou/红烧肉), an Easy Version';
  const SHOWN = 'Braised Pork Belly (Hong Shao Rou), an Easy Version';

  it('shows the title without the other-script text in the heading, the tab title and the photo description', async () => {
    stubFetch({ 'GET /api/recipes/1': () => apiResponse(detail({ title: TITLE, imageUrl: '/api/images/a.webp' })) });
    renderAt('/recipes/1');

    expect(await screen.findByRole('heading', { level: 1, name: SHOWN })).toBeInTheDocument();
    expect(document.title).toBe(`${SHOWN} - RecipeMixer`);
    expect(screen.getByAltText(`Photo of ${SHOWN}`)).toBeInTheDocument();
    expect(screen.queryByText(/红烧肉/)).not.toBeInTheDocument();
  });

  it('still shows a title that is entirely in another script', async () => {
    stubFetch({ 'GET /api/recipes/1': () => apiResponse(detail({ title: '红烧肉' })) });
    renderAt('/recipes/1');
    expect(await screen.findByRole('heading', { level: 1, name: '红烧肉' })).toBeInTheDocument();
  });
});

describe('RecipeDetailPage photo search', () => {
  const photo = (n: number) => ({
    token: `token-${n}`,
    thumbnail: 'data:image/webp;base64,AAAA',
    title: `Soup photo ${n}`,
    creator: `Author ${n}`,
    licence: 'CC BY 2.0',
    licenceUrl: null,
    landingUrl: `https://www.flickr.com/photos/1/${n}`,
    provider: 'Openverse',
  });

  function renderWithFeature(imageSearch: boolean) {
    return render(
      <AuthContext.Provider value={{ authRequired: false, features: { mealdb: false, imageSearch }, logout: async () => undefined }}>
        <MemoryRouter initialEntries={['/recipes/1']}>
          <Routes>
            <Route path="/recipes/:id" element={<RecipeDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
  }

  it('offers no photo search unless the server has it on', async () => {
    stubFetch({ 'GET /api/recipes/1': () => apiResponse(detail()) });
    renderWithFeature(false);
    await screen.findByRole('heading', { level: 1, name: 'Tomato soup' });
    expect(screen.queryByRole('button', { name: /Find a photo|Change photo/ })).not.toBeInTheDocument();
  });

  it('says "Find a photo" for a recipe without one and "Change photo" for one with a photo', async () => {
    stubFetch({ 'GET /api/recipes/1': () => apiResponse(detail()) });
    const first = renderWithFeature(true);
    expect(await screen.findByRole('button', { name: 'Find a photo' })).toBeInTheDocument();
    first.unmount();

    stubFetch({ 'GET /api/recipes/1': () => apiResponse(detail({ imageUrl: '/api/images/a.webp' })) });
    renderWithFeature(true);
    expect(await screen.findByRole('button', { name: 'Change photo' })).toBeInTheDocument();
  });

  it('searches for the title, saves the chosen photo and shows it with its credit', async () => {
    const user = userEvent.setup();
    const credit = { text: 'Photo: "Soup photo 1" by Author 1, CC BY 2.0, via Openverse', url: 'https://www.flickr.com/photos/1/1' };
    const mock = stubFetch({
      'GET /api/recipes/1': () => apiResponse(detail()),
      'GET /api/image-search?q=Tomato+soup': () => apiResponse({ items: [photo(1), photo(2)] }),
      'POST /api/recipes/1/image/from-search': () =>
        apiResponse(detail({ imageUrl: '/api/images/found.webp', imageCredit: credit })),
    });
    renderWithFeature(true);

    await user.click(await screen.findByRole('button', { name: 'Find a photo' }));
    await user.click(await screen.findByRole('button', { name: 'Use the photo Soup photo 1' }));

    expect(await screen.findByAltText('Photo of Tomato soup')).toHaveAttribute('src', '/api/images/found.webp');
    expect(screen.getByText(/Photo: "Soup photo 1" by Author 1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Photo page' })).toHaveAttribute('href', 'https://www.flickr.com/photos/1/1');
    expect(JSON.parse((findCall(mock, 'POST /api/recipes/1/image/from-search')?.[1] as RequestInit).body as string)).toEqual({ token: 'token-1' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the dialog open when saving the choice fails', async () => {
    const user = userEvent.setup();
    stubFetch({
      'GET /api/recipes/1': () => apiResponse(detail()),
      'GET /api/image-search?q=Tomato+soup': () => apiResponse({ items: [photo(1)] }),
      'POST /api/recipes/1/image/from-search': () => apiResponse({ error: 'That photo choice is not valid any more. Search again.' }, 400),
    });
    renderWithFeature(true);

    await user.click(await screen.findByRole('button', { name: 'Find a photo' }));
    await user.click(await screen.findByRole('button', { name: 'Use the photo Soup photo 1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Search again');
    expect(screen.getByRole('button', { name: 'Use the photo Soup photo 1' })).toBeEnabled();
  });

  it('shows a credit without a link when its link is not https', async () => {
    stubFetch({ 'GET /api/recipes/1': () => apiResponse(detail({ imageUrl: '/api/images/a.webp', imageCredit: { text: 'Photo by X', url: 'javascript:alert(1)' } })) });
    renderWithFeature(false);
    expect(await screen.findByText('Photo by X')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Photo page' })).not.toBeInTheDocument();
  });

  it('shows no caption for a photo without a credit', async () => {
    stubFetch({ 'GET /api/recipes/1': () => apiResponse(detail({ imageUrl: '/api/images/a.webp' })) });
    renderWithFeature(false);
    await screen.findByAltText('Photo of Tomato soup');
    expect(screen.queryByText(/^Photo:/)).not.toBeInTheDocument();
  });
});
