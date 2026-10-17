import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listRecipes } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { apiResponse, stubFetch } from '@/test-utils';
import { AuthGate } from './AuthGate';

afterEach(() => {
  vi.unstubAllGlobals();
});

function Child() {
  const { authRequired, logout } = useAuth();
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState('');
  return (
    <div>
      <h1>The app</h1>
      <input aria-label="draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button onClick={() => void listRecipes().catch(() => undefined)}>load</button>
      <button onClick={() => logout().catch(() => setProblem('logout failed'))}>out</button>
      <p>{problem}</p>
      <span>login needed: {String(authRequired)}</span>
    </div>
  );
}

const session = (authRequired: boolean, authenticated: boolean) => () => apiResponse({ authRequired, authenticated });
const ok = () => apiResponse(undefined, 204);
const LIST = 'GET /api/recipes?limit=24&offset=0';

function renderGate() {
  return render(
    <AuthGate>
      <Child />
    </AuthGate>,
  );
}

describe('AuthGate', () => {
  it('shows nothing but a quiet placeholder until the server has answered', async () => {
    let answer: () => void = () => undefined;
    stubFetch({
      'GET /api/session': () =>
        new Promise((resolve) => {
          answer = () => resolve(apiResponse({ authRequired: true, authenticated: false }));
        }),
    });
    renderGate();

    expect(screen.getByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();

    answer();
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('opens the app straight away when no password is set, and never shows the login', async () => {
    stubFetch({ 'GET /api/session': session(false, true) });
    renderGate();
    expect(await screen.findByRole('heading', { name: 'The app' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByText('login needed: false')).toBeInTheDocument();
  });

  it('opens the app when the browser is already logged in', async () => {
    stubFetch({ 'GET /api/session': session(true, true) });
    renderGate();
    expect(await screen.findByRole('heading', { name: 'The app' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByText('login needed: true')).toBeInTheDocument();
  });

  it('shows only the login, with none of the app in the page, when a password is needed', async () => {
    stubFetch({ 'GET /api/session': session(true, false) });
    renderGate();
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByText('The app')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('draft')).not.toBeInTheDocument();
  });

  it('opens the app after a correct password', async () => {
    const user = userEvent.setup();
    stubFetch({ 'GET /api/session': session(true, false), 'POST /api/session': ok });
    renderGate();

    await user.type(await screen.findByLabelText('Password'), 'correct-horse-battery-staple');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { name: 'The app' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('says so, and offers to try again, when the server cannot be reached', async () => {
    const user = userEvent.setup();
    let reachable = false;
    const mock = vi.fn(async () => {
      if (!reachable) throw new TypeError('Failed to fetch');
      return apiResponse({ authRequired: false, authenticated: true });
    });
    vi.stubGlobal('fetch', mock);
    renderGate();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
    expect(screen.queryByText('The app')).not.toBeInTheDocument();

    reachable = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'The app' })).toBeInTheDocument();
  });
});

describe('when the session ends while the app is open', () => {
  it('brings the login back but keeps the page, and what was typed, behind it', async () => {
    const user = userEvent.setup();
    stubFetch({
      'GET /api/session': session(true, true),
      [LIST]: () => apiResponse({ error: 'Login required' }, 401),
      'POST /api/session': ok,
    });
    renderGate();

    await user.type(await screen.findByLabelText('draft'), 'half-written recipe');
    await user.click(screen.getByRole('button', { name: 'load' }));

    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    const hiddenDraft = screen.getByLabelText('draft');
    expect(hiddenDraft.closest('[hidden]')).not.toBeNull();
    expect(hiddenDraft).toHaveValue('half-written recipe');
    expect(screen.queryByRole('heading', { name: 'The app' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery-staple');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByLabelText('draft')).toHaveValue('half-written recipe');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('does not treat a wrong password as an ended session', async () => {
    const user = userEvent.setup();
    stubFetch({
      'GET /api/session': session(true, false),
      'POST /api/session': () => apiResponse({ error: 'Incorrect password' }, 401),
    });
    renderGate();

    await user.type(await screen.findByLabelText('Password'), 'not-the-right-one-1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password.');
    // still only the login: nothing of the app was ever mounted behind it
    expect(screen.queryByLabelText('draft')).not.toBeInTheDocument();
  });
});

describe('logging out', () => {
  it('ends the session, removes the app from the page completely and shows the login', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({ 'GET /api/session': session(true, true), 'DELETE /api/session': ok, 'POST /api/session': ok });
    renderGate();

    await user.type(await screen.findByLabelText('draft'), 'private notes');
    await user.click(screen.getByRole('button', { name: 'out' }));

    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(mock.mock.calls.some(([url, init]) => String(url) === '/api/session' && init?.method === 'DELETE')).toBe(true);
    // nothing of the library is left in the page, not even hidden
    expect(screen.queryByLabelText('draft')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('private notes');

    // logging in again gives a fresh app
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery-staple');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByLabelText('draft')).toHaveValue('');
  });

  it('stays logged in, and says so, when the server could not be told', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
        if (init?.method === 'DELETE') throw new TypeError('Failed to fetch');
        return apiResponse({ authRequired: true, authenticated: true });
      }),
    );
    renderGate();

    await user.click(await screen.findByRole('button', { name: 'out' }));

    await waitFor(() => expect(screen.getByText('logout failed')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'The app' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });
});
