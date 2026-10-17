import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentTitle } from './use-document-title';

function Page({ title }: { title: string | null }) {
  useDocumentTitle(title);
  return null;
}

beforeEach(() => {
  document.title = 'RecipeMixer';
});

describe('useDocumentTitle', () => {
  it('sets "Page - RecipeMixer" and restores the previous title when the page goes away', () => {
    const { unmount } = render(<Page title="Your recipes" />);
    expect(document.title).toBe('Your recipes - RecipeMixer');
    unmount();
    expect(document.title).toBe('RecipeMixer');
  });

  it('follows the title as it changes', () => {
    const { rerender } = render(<Page title="Recipe" />);
    rerender(<Page title="Tomato soup" />);
    expect(document.title).toBe('Tomato soup - RecipeMixer');
  });

  it('leaves the title alone while there is nothing to show yet', () => {
    render(<Page title={null} />);
    expect(document.title).toBe('RecipeMixer');
  });

  it('shows the new page title when one page replaces another', () => {
    const { rerender } = render(<Page title="First" />);
    rerender(<Page title="Second" />);
    expect(document.title).toBe('Second - RecipeMixer');
  });
});
