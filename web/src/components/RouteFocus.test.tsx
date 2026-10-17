import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteFocus } from './RouteFocus';

let navigate: NavigateFunction;

function Harness({ target = 'main' }: { target?: string }) {
  navigate = useNavigate();
  return (
    <>
      <main id="main" tabIndex={-1}>
        content
      </main>
      <input aria-label="search" />
      <RouteFocus targetId={target} />
    </>
  );
}

function renderHarness(target?: string) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="*" element={<Harness target={target} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const scrollTo = window.scrollTo as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollTo.mockClear();
});

describe('RouteFocus', () => {
  it('does nothing on the first render', () => {
    renderHarness();
    expect(document.body).toHaveFocus();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('moves focus to the main region and to the top when the path changes', () => {
    renderHarness();
    screen.getByLabelText('search').focus();

    act(() => {
      void navigate('/recipes/7');
    });

    expect(screen.getByRole('main')).toHaveFocus();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('leaves focus alone when only the query string changes (typing in a search box)', () => {
    renderHarness();
    const search = screen.getByLabelText('search');
    search.focus();

    act(() => {
      void navigate('/?q=tom');
    });
    act(() => {
      void navigate('/?q=toma');
    });

    expect(search).toHaveFocus();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('focuses the page but does not scroll to the top when going Back', () => {
    renderHarness();
    act(() => {
      void navigate('/recipes/7');
    });
    scrollTo.mockClear();
    screen.getByLabelText('search').focus();

    act(() => {
      void navigate(-1);
    });

    expect(screen.getByRole('main')).toHaveFocus();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('copes with a target that does not exist', () => {
    renderHarness('missing');
    expect(() =>
      act(() => {
        void navigate('/recipes/7');
      }),
    ).not.toThrow();
  });
});
