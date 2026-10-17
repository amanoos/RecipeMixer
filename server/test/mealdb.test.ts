import { describe, expect, it } from 'vitest';
import {
  mealApiUrl,
  mealPageUrl,
  mealToExtracted,
  parseMeals,
  safePhotoUrl,
  toSearchResults,
} from '../src/services/mealdb.js';

function meal(overrides: Record<string, unknown> = {}) {
  return {
    idMeal: '52772',
    strMeal: 'Teriyaki Chicken Casserole',
    strCategory: 'Chicken',
    strArea: 'Japanese',
    strInstructions: 'Preheat oven.\r\nCombine sauce.\r\n\r\nSTEP 3\r\nBake 35 minutes.',
    strMealThumb: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg',
    strTags: 'Meat,Casserole',
    strIngredient1: 'soy sauce',
    strMeasure1: '3/4 cup',
    strIngredient2: 'water',
    strMeasure2: '1/2 cup',
    strIngredient3: '',
    strMeasure3: '',
    strIngredient4: null,
    strMeasure4: null,
    strIngredient5: 'salt',
    strMeasure5: ' ',
    ...overrides,
  };
}

const first = (record: Record<string, unknown>) => {
  const [parsed] = parseMeals({ meals: [record] });
  if (!parsed) throw new Error('record was dropped');
  return parsed;
};

describe('mealApiUrl', () => {
  it('uses the fixed host and encodes the value', () => {
    expect(mealApiUrl('1', 'search', { s: 'a b&c=d/../' })).toBe(
      'https://www.themealdb.com/api/json/v1/1/search.php?s=a%20b%26c%3Dd%2F..%2F',
    );
    expect(mealApiUrl('abc', 'lookup', { i: '52772' })).toBe('https://www.themealdb.com/api/json/v1/abc/lookup.php?i=52772');
  });

  it('cannot be pointed at another host by the value', () => {
    const url = new URL(mealApiUrl('1', 'search', { s: '@evil.example/#' }));
    expect(url.hostname).toBe('www.themealdb.com');
    expect(url.pathname).toBe('/api/json/v1/1/search.php');
  });
});

describe('parseMeals', () => {
  it.each([null, undefined, 'x', 5, [], {}, { meals: 'x' }, { meals: {} }])('gives nothing for %j', (payload) => {
    expect(parseMeals(payload)).toEqual([]);
  });

  it('gives nothing when the API says there is no meal', () => {
    expect(parseMeals({ meals: null })).toEqual([]);
  });

  it('drops records that do not look like meals and keeps the rest', () => {
    const parsed = parseMeals({
      meals: [meal(), { idMeal: 'abc', strMeal: 'Bad id' }, { idMeal: '1' }, 'x', null, meal({ idMeal: '2', strMeal: ' ' })],
    });
    expect(parsed.map((record) => record.idMeal)).toEqual(['52772']);
  });

  it('refuses ids that are not plain digits', () => {
    expect(parseMeals({ meals: [meal({ idMeal: '../1' }), meal({ idMeal: '1'.repeat(11) })] })).toEqual([]);
  });
});

describe('toSearchResults', () => {
  it('keeps the id, title, cuisine and category and nothing else', () => {
    expect(toSearchResults([first(meal())])).toEqual([
      { id: '52772', title: 'Teriyaki Chicken Casserole', cuisine: 'Japanese', category: 'Chicken' },
    ]);
  });

  it('treats an unknown area as no cuisine', () => {
    expect(toSearchResults([first(meal({ strArea: 'Unknown' }))])[0]!.cuisine).toBeNull();
  });

  it('returns at most 25 results', () => {
    const many = Array.from({ length: 40 }, (_, index) => first(meal({ idMeal: String(index + 1) })));
    expect(toSearchResults(many)).toHaveLength(25);
  });
});

describe('mealToExtracted', () => {
  it('pairs measures with ingredients and skips empty slots', () => {
    const { draft } = mealToExtracted(first(meal()));
    expect(draft.ingredients).toEqual(['3/4 cup soy sauce', '1/2 cup water', 'salt']);
  });

  it('splits the instructions into steps and drops blank lines and bare step headings', () => {
    const { draft } = mealToExtracted(first(meal()));
    expect(draft.steps).toEqual(['Preheat oven.', 'Combine sauce.', 'Bake 35 minutes.']);
  });

  it('describes the category and tags and carries the cuisine', () => {
    const { draft } = mealToExtracted(first(meal()));
    expect(draft.title).toBe('Teriyaki Chicken Casserole');
    expect(draft.cuisine).toBe('Japanese');
    expect(draft.description).toBe('Category: Chicken. Tags: Meat, Casserole');
  });

  it('gives a null description when there is nothing to say', () => {
    const { draft } = mealToExtracted(first(meal({ strCategory: null, strTags: '' })));
    expect(draft.description).toBeNull();
  });

  it('reads all twenty ingredient slots and no more', () => {
    const slots: Record<string, unknown> = {};
    for (let slot = 1; slot <= 25; slot++) slots[`strIngredient${slot}`] = `item ${slot}`;
    const { draft } = mealToExtracted(first(meal(slots)));
    expect(draft.ingredients).toHaveLength(20);
    expect(draft.ingredients.at(-1)).toBe('item 20');
  });

  it('keeps every line inside the limits a saved recipe has', () => {
    const { draft } = mealToExtracted(
      first(
        meal({
          strMeal: 'T'.repeat(500),
          strIngredient1: 'i'.repeat(1000),
          strMeasure1: 'm'.repeat(1000),
          strInstructions: Array.from({ length: 300 }, () => 's'.repeat(5000)).join('\n'),
        }),
      ),
    );
    expect(draft.title.length).toBeLessThanOrEqual(200);
    expect(draft.ingredients[0]!.length).toBeLessThanOrEqual(200);
    expect(draft.steps).toHaveLength(100);
    expect(draft.steps.every((step) => step.length <= 2000)).toBe(true);
  });

  it('takes the photo only from TheMealDB, over https', () => {
    expect(mealToExtracted(first(meal())).imageUrl).toBe(
      'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg',
    );
    expect(mealToExtracted(first(meal({ strMealThumb: 'https://evil.example/x.jpg' }))).imageUrl).toBeNull();
    expect(mealToExtracted(first(meal({ strMealThumb: null }))).imageUrl).toBeNull();
  });
});

describe('safePhotoUrl', () => {
  it.each([
    'https://www.themealdb.com/images/a.jpg',
    'https://themealdb.com/a.jpg',
    'https://r2.themealdb.com/a.jpg#frag',
  ])('accepts %s', (value) => {
    const url = safePhotoUrl(value);
    expect(url).not.toBeNull();
    expect(url).not.toContain('#');
  });

  it.each([
    'http://www.themealdb.com/a.jpg',
    'https://themealdb.com.evil.example/a.jpg',
    'https://evilthemealdb.com/a.jpg',
    'https://www.themealdb.com@evil.example/a.jpg',
    'https://user:pw@www.themealdb.com/a.jpg',
    'https://www.themealdb.com:8443/a.jpg',
    'https://127.0.0.1/a.jpg',
    'ftp://www.themealdb.com/a.jpg',
    'javascript:alert(1)',
    '//www.themealdb.com/a.jpg',
    'not a url',
    '',
    null,
    42,
  ])('refuses %j', (value) => {
    expect(safePhotoUrl(value)).toBeNull();
  });
});

describe('mealPageUrl', () => {
  it('links back to the meal page', () => {
    expect(mealPageUrl('52772')).toBe('https://www.themealdb.com/meal/52772');
  });
});

describe('safePhotoUrl length', () => {
  it('refuses an address longer than the image importer accepts', () => {
    expect(safePhotoUrl(`https://www.themealdb.com/${'a'.repeat(2100)}.jpg`)).toBeNull();
    expect(safePhotoUrl(`https://www.themealdb.com/${'a'.repeat(100)}.jpg`)).not.toBeNull();
  });
});
