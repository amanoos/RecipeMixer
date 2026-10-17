import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

function stubHealth(response: Partial<Response> | Error) {
  const fetchMock =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const okResponse = {
  ok: true,
  status: 200,
  json: async () => ({ status: 'ok', schemaVersion: 1 }),
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('health status', () => {
  it('shows the server as running when the API responds', async () => {
    const fetchMock = stubHealth(okResponse);
    render(<App />);
    expect(await screen.findByText(/database schema v1/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('shows an error when the request fails', async () => {
    stubHealth(new Error('network down'));
    render(<App />);
    expect(await screen.findByText(/cannot reach the server/i)).toBeInTheDocument();
  });

  it('shows an error when the API returns a non-OK status', async () => {
    stubHealth({ ok: false, status: 500, json: async () => ({}) });
    render(<App />);
    expect(await screen.findByText(/cannot reach the server/i)).toBeInTheDocument();
  });
});

describe('theme toggle', () => {
  it('toggles the dark class and remembers the choice', async () => {
    stubHealth(okResponse);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /switch to dark theme/i }));
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('recipemixer-theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: /switch to light theme/i }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(window.localStorage.getItem('recipemixer-theme')).toBe('light');
  });

  it('starts in the stored theme', async () => {
    window.localStorage.setItem('recipemixer-theme', 'dark');
    stubHealth(okResponse);
    render(<App />);
    expect(document.documentElement).toHaveClass('dark');
    expect(await screen.findByText(/database schema v1/i)).toBeInTheDocument();
  });

  it('keeps working when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    stubHealth(okResponse);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /switch to dark theme/i }));
    expect(document.documentElement).toHaveClass('dark');
    expect(await screen.findByText(/database schema v1/i)).toBeInTheDocument();
  });
});
