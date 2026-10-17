import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FoodArt, seedOf } from './FoodArt';

const TITLES = ['Tomato Soup', 'Beef Tacos', 'Pad Thai', 'Greek Salad', 'Banana Bread', 'Shakshuka', 'Hummus', 'Mac and Cheese', 'Miso Soup', 'Fried Rice'];

function pictureOf(seed: string) {
  const { container } = render(<FoodArt seed={seed} />);
  const tile = container.querySelector('[data-slot="card-image"]') as HTMLElement;
  return { tileClass: tile.className, drawing: container.querySelector('svg')!.innerHTML };
}

describe('seedOf', () => {
  it('gives the same number for the same text and different numbers for different text', () => {
    expect(seedOf('Tomato Soup')).toBe(seedOf('Tomato Soup'));
    expect(seedOf('Tomato Soup')).not.toBe(seedOf('Tomato Soup '));
    expect(seedOf('')).toBe(0);
  });

  it('never gives a negative or fractional number, whatever the text', () => {
    for (const text of ['a'.repeat(5000), 'ünï©ode 🍅', '   ']) {
      const value = seedOf(text);
      expect(Number.isInteger(value) && value >= 0).toBe(true);
    }
  });
});

describe('FoodArt', () => {
  it('is hidden from screen readers, because the title beside it already says what the recipe is', () => {
    const { container } = render(<FoodArt seed="Tomato Soup" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.textContent).toBe('');
  });

  it('keeps the card-image marker the card layout relies on', () => {
    const { container } = render(<FoodArt seed="x" className="aspect-[4/3]" />);
    const tile = container.querySelector('[data-slot="card-image"]');
    expect(tile).toBeInTheDocument();
    expect(tile).toHaveClass('aspect-[4/3]');
  });

  it('always draws the same picture for the same title', () => {
    expect(pictureOf('Beef Tacos')).toEqual(pictureOf('Beef Tacos'));
  });

  it('draws a variety of pictures and colours across different titles', () => {
    const pictures = TITLES.map(pictureOf);
    expect(new Set(pictures.map((picture) => picture.drawing)).size).toBeGreaterThan(3);
    expect(new Set(pictures.map((picture) => picture.tileClass)).size).toBeGreaterThan(3);
  });

  it('works with no title at all', () => {
    expect(() => render(<FoodArt />)).not.toThrow();
  });

  it('gives every tile a light and a dark colour, so it reads in both themes', () => {
    for (const title of TITLES) {
      const { tileClass } = pictureOf(title);
      expect(tileClass).toMatch(/\bbg-\w+-100\b/);
      expect(tileClass).toMatch(/\bdark:bg-\w+-950\b/);
    }
  });
});
