import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiResponse, findCall, stubFetch } from '@/test-utils';
import { LoginPage } from './LoginPage';

beforeEach(() => {
  document.title = 'RecipeMixer';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const field = () => screen.getByLabelText('Password');
const submit = () => screen.getByRole('button', { name: 'Log in' });

describe('LoginPage', () => {
  it('shows a labelled password field that is focused, hidden and meant for a password manager', () => {
    render(<LoginPage onLoggedIn={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(field()).toHaveAttribute('type', 'password');
    expect(field()).toHaveAttribute('autocomplete', 'current-password');
    expect(field()).toHaveFocus();
    expect(document.title).toBe('Log in - RecipeMixer');
  });

  it('gives password managers a fixed, hidden user name to file the login under, and never sends it', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({ 'POST /api/session': () => apiResponse(undefined, 204) });
    render(<LoginPage onLoggedIn={() => undefined} />);

    const username = document.querySelector('input[name="username"]') as HTMLInputElement;
    expect(username).not.toBeNull();
    expect(username).toHaveAttribute('autocomplete', 'username');
    expect(username).toHaveAttribute('aria-hidden', 'true');
    expect(username).toHaveAttribute('tabindex', '-1');
    expect(username.readOnly).toBe(true);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await user.type(field(), 'correct-horse-battery-staple');
    await user.click(submit());
    await waitFor(() => expect(mock).toHaveBeenCalled());
    const body = JSON.parse((findCall(mock, 'POST /api/session')?.[1] as RequestInit).body as string);
    expect(Object.keys(body)).toEqual(['password']);
  });

  it('asks for a password instead of sending an empty one', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({});
    render(<LoginPage onLoggedIn={() => undefined} />);
    await user.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the password.');
    expect(mock).not.toHaveBeenCalled();
  });

  it('sends the password in the request body, never in the address, then reports success', async () => {
    const user = userEvent.setup();
    const onLoggedIn = vi.fn();
    const mock = stubFetch({ 'POST /api/session': () => apiResponse(undefined, 204) });
    render(<LoginPage onLoggedIn={onLoggedIn} />);

    await user.type(field(), 'correct-horse-battery-staple');
    await user.click(submit());

    await waitFor(() => expect(onLoggedIn).toHaveBeenCalledTimes(1));
    const call = findCall(mock, 'POST /api/session');
    expect(String(call?.[0])).toBe('/api/session');
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({ password: 'correct-horse-battery-staple' });
  });

  it('says the password is wrong, empties the field and puts the cursor back in it', async () => {
    const user = userEvent.setup();
    const onLoggedIn = vi.fn();
    stubFetch({ 'POST /api/session': () => apiResponse({ error: 'Incorrect password' }, 401) });
    render(<LoginPage onLoggedIn={onLoggedIn} />);

    await user.type(field(), 'not-the-right-one-1');
    await user.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password.');
    expect(field()).toHaveValue('');
    expect(field()).toHaveFocus();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByDisplayValue('not-the-right-one-1')).not.toBeInTheDocument();
    expect(onLoggedIn).not.toHaveBeenCalled();
  });

  it("shows the server's message when the address is locked for a while", async () => {
    const user = userEvent.setup();
    stubFetch({
      'POST /api/session': () => apiResponse({ error: 'Too many wrong passwords. Try again in 15 minutes.' }, 429),
    });
    render(<LoginPage onLoggedIn={() => undefined} />);
    await user.type(field(), 'whatever-it-is-1234');
    await user.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many wrong passwords. Try again in 15 minutes.');
  });

  it('says when the server cannot be reached', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<LoginPage onLoggedIn={() => undefined} />);
    await user.type(field(), 'whatever-it-is-1234');
    await user.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
  });

  it('cannot be submitted twice while the server is thinking', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const mock = stubFetch({
      'POST /api/session': () =>
        new Promise((resolve) => {
          release = () => resolve(apiResponse(undefined, 204));
        }),
    });
    render(<LoginPage onLoggedIn={() => undefined} />);
    await user.type(field(), 'correct-horse-battery-staple');
    await user.click(submit());

    expect(await screen.findByRole('button', { name: 'Checking...' })).toBeDisabled();
    expect(mock).toHaveBeenCalledTimes(1);
    release();
  });
});
