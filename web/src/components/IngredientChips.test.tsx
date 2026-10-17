import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IngredientSuggestion } from '@/lib/types';
import { IngredientChips } from './IngredientChips';

type Suggest = (prefix: string, signal: AbortSignal) => Promise<IngredientSuggestion[]>;

function Harness({ initial = [], max, suggest }: { initial?: string[]; max?: number; suggest?: Suggest }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <IngredientChips value={value} onChange={setValue} max={max} suggest={suggest ?? (async () => [])} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const current = () => JSON.parse(screen.getByTestId('value').textContent ?? '[]') as string[];
const input = () => screen.getByLabelText('Ingredients you have');

describe('IngredientChips', () => {
  it('adds a chip on Enter and clears the box', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(input(), 'chicken{Enter}');
    expect(current()).toEqual(['chicken']);
    expect(input()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Remove chicken' })).toBeInTheDocument();
  });

  it('adds a chip when a comma is typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(input(), 'rice,spinach');
    expect(current()).toEqual(['rice']);
    expect(input()).toHaveValue('spinach');
  });

  it('splits a pasted list into several chips', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(input());
    await user.paste('eggs, milk,  butter ,flour');
    expect(current()).toEqual(['eggs', 'milk', 'butter']);
    expect(input()).toHaveValue('flour');
  });

  it('adds what is typed when the box loses focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(input(), 'garlic');
    await user.tab();
    expect(current()).toEqual(['garlic']);
  });

  it('ignores blank entries and case-insensitive duplicates', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['Onion']} />);
    await user.type(input(), '   {Enter}onion{Enter}ONION{Enter}');
    expect(current()).toEqual(['Onion']);
  });

  it('removes a chip with its button', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['egg', 'milk']} />);
    await user.click(screen.getByRole('button', { name: 'Remove egg' }));
    expect(current()).toEqual(['milk']);
  });

  it('removes the last chip with Backspace on an empty box, but not while typing', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['egg', 'milk']} />);
    await user.type(input(), 'x{Backspace}');
    expect(current()).toEqual(['egg', 'milk']);
    await user.keyboard('{Backspace}');
    expect(current()).toEqual(['egg']);
  });

  it('stops at the maximum and says so', async () => {
    const user = userEvent.setup();
    render(<Harness max={2} />);
    await user.type(input(), 'a1{Enter}b1{Enter}c1{Enter}');
    expect(current()).toEqual(['a1', 'b1']);
    expect(screen.getByRole('alert')).toHaveTextContent('You can add up to 2 ingredients.');
  });

  it('refuses an over-long ingredient and says so', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(input());
    await user.paste('x'.repeat(61));
    await user.keyboard('{Enter}');
    expect(current()).toEqual([]);
    expect(screen.getByRole('alert')).toHaveTextContent('at most 60 characters');
  });

  it('renders ingredient text as plain text', () => {
    render(<Harness initial={['<img src=x onerror=alert(1)>']} />);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('offers suggestions for what is being typed, after a short pause', async () => {
    const suggest = vi.fn<Suggest>(async () => [
      { name: 'onion', count: 3 },
      { name: 'oregano', count: 1 },
    ]);
    const user = userEvent.setup();
    render(<Harness suggest={suggest} />);
    await user.type(input(), 'o');
    expect(suggest).not.toHaveBeenCalled();
    await user.type(input(), 'n');
    await waitFor(() => expect(suggest).toHaveBeenCalledWith('on', expect.any(AbortSignal)));
    await waitFor(() => {
      const options = [...document.querySelectorAll('datalist option')].map((option) => option.getAttribute('value'));
      expect(options).toEqual(['onion', 'oregano']);
    });
  });

  it('keeps working when suggestions fail', async () => {
    const suggest = vi.fn<Suggest>(async () => {
      throw new Error('offline');
    });
    const user = userEvent.setup();
    render(<Harness suggest={suggest} />);
    await user.type(input(), 'on');
    await waitFor(() => expect(suggest).toHaveBeenCalled());
    await user.keyboard('{Enter}');
    expect(current()).toEqual(['on']);
  });
});
