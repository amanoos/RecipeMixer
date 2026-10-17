import { describe, expect, it } from 'vitest';
import {
  ingredientsMatch,
  isStapleLine,
  isStapleName,
  normalizeIngredient,
  wordsOf,
} from '../src/services/ingredients.js';

describe('normalizeIngredient names', () => {
  it.each([
    ['2 cups chopped yellow onions', ['onion']],
    ['1 (14 oz) can diced tomatoes', ['tomato']],
    ['3 large eggs, beaten', ['egg']],
    ['1 lb ground beef', ['beef']],
    ['fresh cilantro leaves', ['cilantro']],
    ['scallions', ['green-onion']],
    ['2 cloves garlic, minced', ['garlic']],
    ['1 tsp ground cloves', ['clove']],
    ['salt and pepper to taste', ['salt', 'black-pepper']],
    ['butter or margarine', ['butter', 'margarine']],
    ['½ cup milk', ['milk']],
    ['1 can chickpeas, drained and rinsed', ['chickpea']],
    ['2 tablespoons olive oil', ['olive oil']],
    ['1 cup all-purpose flour', ['flour']],
    ['3 cups low-fat milk', ['milk']],
    ['1/2 teaspoon baking soda', ['baking-soda']],
    ['2 red bell peppers, sliced', ['red bell-pepper']],
    ['4 tomatoes', ['tomato']],
    ['1 pound chicken breasts, boneless, skinless', ['chicken breast']],
    ['peanut butter', ['peanut-butter']],
    ['molasses', ['molasses']],
    ['1 sprig of fresh thyme', ['thyme']],
    ['Salt', ['salt']],
    ['1 teaspoon pepper', ['black-pepper']],
    ['1 teaspoon ground black pepper', ['black-pepper']],
    ['2 spring onions', ['green-onion']],
    ['1 courgette', ['zucchini']],
    ['2 cloves', ['clove']],
  ])('%s -> %j', (line, names) => {
    expect(normalizeIngredient(line).names).toEqual(names);
  });

  it.each(['', '   ', 'For the sauce:', '🍅🍅🍅', '1234', '(optional)'])('finds no ingredient in %j', (line) => {
    expect(normalizeIngredient(line).names).toEqual([]);
  });

  it('never throws and stays harmless on markup and SQL-like text', () => {
    for (const line of ['<script>alert(1)</script>', "Robert'); DROP TABLE recipe;--", '\u0000\u0001\u0002', '%s %d {{x}}']) {
      expect(() => normalizeIngredient(line)).not.toThrow();
      expect(Array.isArray(normalizeIngredient(line).names)).toBe(true);
    }
  });

  it('handles very long input quickly and without a result', () => {
    const started = performance.now();
    const junk = normalizeIngredient('a'.repeat(5000));
    const repeated = normalizeIngredient('onion '.repeat(1000));
    expect(performance.now() - started).toBeLessThan(50);
    expect(junk.names).toEqual([]);
    expect(repeated.names.length).toBeLessThanOrEqual(4);
  });

  it('caps the number of alternatives', () => {
    expect(normalizeIngredient('a1 or b1 or c1 or d1 or e1 or f1').names.length).toBeLessThanOrEqual(4);
  });
});

describe('normalizeIngredient quantity and unit', () => {
  it('reads whole numbers and units', () => {
    expect(normalizeIngredient('2 cups chopped yellow onions')).toMatchObject({ quantity: 2, unit: 'cup' });
  });

  it('reads fractions, including unicode ones', () => {
    expect(normalizeIngredient('½ cup milk')).toMatchObject({ quantity: 0.5, unit: 'cup' });
    expect(normalizeIngredient('1 1/2 cups sugar')).toMatchObject({ quantity: 1.5, unit: 'cup' });
  });

  it('reports null when there is none', () => {
    expect(normalizeIngredient('salt')).toMatchObject({ quantity: null, unit: null });
  });
});

describe('ingredientsMatch', () => {
  const match = (user: string, recipe: string) => {
    const userNames = normalizeIngredient(user).names;
    const recipeNames = normalizeIngredient(recipe).names;
    return userNames.some((u) => recipeNames.some((r) => ingredientsMatch(u, r)));
  };

  it.each([
    ['onion', '2 red onions'],
    ['red onion', '1 onion'],
    ['chicken', '1 lb chicken breasts'],
    ['pepper', '1 tsp black pepper'],
    ['tomato', '2 tomatoes'],
    ['flour', '2 cups all-purpose flour'],
    ['eggs', '1 egg'],
    ['broth', '1 cup chicken broth'],
    ['salt', '1 tsp sea salt'],
    ['scallions', '3 spring onions'],
    ['butter', '2 tbsp unsalted butter'],
    ['milk', '1 cup whole milk'],
    ['cheddar', '1 cup shredded cheddar cheese'],
  ])('%s satisfies "%s"', (user, recipe) => {
    expect(match(user, recipe)).toBe(true);
  });

  it.each([
    ['green onion', '1 onion'],
    ['onion', '4 scallions'],
    ['butter', '2 tbsp peanut butter'],
    ['milk', '1 cup coconut milk'],
    ['chicken breast', '1 lb chicken thighs'],
    ['pepper', '1 red bell pepper'],
    ['garlic', '1 tsp garlic powder'],
    ['tomato', '1 can tomato paste'],
    ['flour', '1 cup almond flour'],
    ['rice', '1 tbsp rice vinegar'],
    ['chicken', '1 cup chicken broth'],
    ['garlic powder', '2 cloves garlic'],
    ['sweet potato', '2 potatoes'],
    ['cream', '1 cup sour cream'],
    ['', '1 onion'],
    ['onion', ''],
  ])('%s does not satisfy "%s"', (user, recipe) => {
    expect(match(user, recipe)).toBe(false);
  });

  it('does not match unrelated names', () => {
    expect(ingredientsMatch('apple', 'orange')).toBe(false);
  });
});

describe('staples', () => {
  it.each(['salt', 'sea salt', 'olive oil', 'vegetable oil', 'water', 'black-pepper', 'cooking-spray'])(
    '%s is a staple',
    (name) => {
      expect(isStapleName(name)).toBe(true);
    },
  );

  it.each(['butter', 'peanut-butter', 'coconut water', 'onion', ''])('%s is not a staple', (name) => {
    expect(isStapleName(name)).toBe(false);
  });

  it('treats a line as a staple only when every alternative is one', () => {
    expect(isStapleLine(['salt', 'black-pepper'])).toBe(true);
    expect(isStapleLine(['salt', 'butter'])).toBe(false);
    expect(isStapleLine([])).toBe(false);
  });
});

describe('wordsOf', () => {
  it('splits a name into words', () => {
    expect(wordsOf('red bell-pepper')).toEqual(['red', 'bell-pepper']);
    expect(wordsOf('')).toEqual([]);
  });
});
