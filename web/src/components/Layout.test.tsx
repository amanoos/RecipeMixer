import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth';
import { apiResponse, stubFetch } from '@/test-utils';
import { Layout } from './Layout';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('dark');
});

function Where() {
  const { pathname, hash } = useLocation();
  return <output data-testid="where">{pathname + hash}</output>;
}

function renderLayout() {
  stubFetch({ 'GET /api/health': () => apiResponse({ status: 'ok', schemaVersion: 4 }) });
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<><h1>Home page</h1><Where /></>} />
          <Route path="match" element={<h1>Match page</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Layout', () => {
  it('puts a skip link first, and using it moves focus to the page without changing the address', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.getByTestId('where')).toHaveTextContent('/');
    expect(screen.getByTestId('where')).not.toHaveTextContent('#');
  });

  it('has a main landmark that can take focus, and a labelled navigation with the three links', () => {
    renderLayout();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'What can I cook?',
      'Import',
      'New recipe',
    ]);
  });

  it('moves focus to the new page after following a link', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole('link', { name: 'What can I cook?' }));
    expect(await screen.findByRole('heading', { name: 'Match page' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('switches between the light and dark theme', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole('button', { name: /switch to (dark|light) theme/i }));
    const dark = document.documentElement.classList.contains('dark');
    await user.click(screen.getByRole('button', { name: /switch to (dark|light) theme/i }));
    expect(document.documentElement.classList.contains('dark')).toBe(!dark);
  });
});

describe('Layout log out', () => {
  function renderWithAuth(authRequired: boolean, logout: () => Promise<void>) {
    stubFetch({ 'GET /api/health': () => apiResponse({ status: 'ok', schemaVersion: 5 }) });
    return render(
      <AuthContext.Provider value={{ authRequired, features: { mealdb: false }, logout }}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<h1>Home page</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
  }

  it('has no log out button when there is no password', () => {
    renderWithAuth(false, async () => undefined);
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
  });

  it('has a log out button in the navigation when a password is set, and uses it', async () => {
    const user = userEvent.setup();
    const logout = vi.fn(async () => undefined);
    renderWithAuth(true, logout);

    const nav = screen.getByRole('navigation', { name: 'Main' });
    await user.click(within(nav).getByRole('button', { name: 'Log out' }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so, rather than pretending, when the server could not be told', async () => {
    const user = userEvent.setup();
    renderWithAuth(true, async () => {
      throw new Error('network');
    });
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not log out');
  });
});
