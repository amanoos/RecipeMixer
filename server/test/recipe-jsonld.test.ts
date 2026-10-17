import { describe, expect, it } from 'vitest';
import { decodePage, extractRecipe } from '../src/services/recipe-jsonld.js';

const PAGE = new URL('https://food.example/recipes/soup');

const ld = (data: unknown, attrs = 'type="application/ld+json"') =>
  `<script ${attrs}>${typeof data === 'string' ? data : JSON.stringify(data)}</script>`;

const page = (...scripts: string[]) => `<html><head><title>x</title>${scripts.join('\n')}</head><body>hi</body></html>`;

const soup = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Tomato Soup',
  description: 'Simple &amp; quick.',
  recipeCuisine: 'Italian',
  recipeIngredient: ['2 cups chopped tomatoes', '1 onion', '  1 tbsp   olive oil '],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Chop everything.' },
    { '@type': 'HowToStep', text: 'Simmer for 20 minutes.' },
  ],
  image: 'https://food.example/img/soup.jpg',
};

describe('extractRecipe', () => {
  it('reads a plain Recipe block', () => {
    const result = extractRecipe(page(ld(soup)), PAGE);
    expect(result).toEqual({
      draft: {
        title: 'Tomato Soup',
        cuisine: 'Italian',
        description: 'Simple & quick.',
        ingredients: ['2 cups chopped tomatoes', '1 onion', '1 tbsp olive oil'],
        steps: ['Chop everything.', 'Simmer for 20 minutes.'],
      },
      imageUrl: 'https://food.example/img/soup.jpg',
    });
  });

  it('finds a Recipe inside @graph, arrays of types, prefixed types and mainEntity', () => {
    expect(extractRecipe(page(ld({ '@graph': [{ '@type': 'WebSite' }, { ...soup }] })), PAGE)?.draft.title).toBe('Tomato Soup');
    expect(extractRecipe(page(ld({ ...soup, '@type': ['Recipe', 'NewsArticle'] })), PAGE)?.draft.title).toBe('Tomato Soup');
    expect(extractRecipe(page(ld({ ...soup, '@type': 'http://schema.org/Recipe' })), PAGE)?.draft.title).toBe('Tomato Soup');
    expect(extractRecipe(page(ld({ '@type': 'WebPage', mainEntity: soup })), PAGE)?.draft.title).toBe('Tomato Soup');
    expect(extractRecipe(page(ld([{ '@type': 'Person' }, soup])), PAGE)?.draft.title).toBe('Tomato Soup');
  });

  it('accepts script attributes in any order, with single quotes or odd case', () => {
    expect(extractRecipe(page(ld(soup, "id=a type='application/ld+json' data-x=1")), PAGE)).not.toBeNull();
    expect(extractRecipe(page(ld(soup, 'TYPE="application/LD+JSON"')), PAGE)).not.toBeNull();
    expect(extractRecipe(`<SCRIPT type="application/ld+json">${JSON.stringify(soup)}</SCRIPT >`, PAGE)).not.toBeNull();
  });

  it('ignores other scripts and skips blocks that are not valid JSON', () => {
    const html = page(
      '<script>var a = 1;</script>',
      ld('{ this is not json'),
      ld({ '@type': 'Organization', name: 'Acme' }),
      ld(soup),
    );
    expect(extractRecipe(html, PAGE)?.draft.title).toBe('Tomato Soup');
  });

  it('uses the first Recipe when a page has several', () => {
    const html = page(ld({ ...soup, name: 'First' }), ld({ ...soup, name: 'Second' }));
    expect(extractRecipe(html, PAGE)?.draft.title).toBe('First');
  });

  it('returns null when there is no Recipe or no title', () => {
    expect(extractRecipe('<html><body>nothing</body></html>', PAGE)).toBeNull();
    expect(extractRecipe(page(ld({ '@type': 'Article', name: 'News' })), PAGE)).toBeNull();
    expect(extractRecipe(page(ld({ '@type': 'Recipe', recipeIngredient: ['1 egg'] })), PAGE)).toBeNull();
    expect(extractRecipe(page(ld({ '@type': 'Recipe', name: '   ' })), PAGE)).toBeNull();
    expect(extractRecipe('', PAGE)).toBeNull();
  });

  describe('instructions', () => {
    const steps = (recipeInstructions: unknown) =>
      extractRecipe(page(ld({ '@type': 'Recipe', name: 'R', recipeInstructions })), PAGE)?.draft.steps;

    it('splits a text block into lines', () => {
      expect(steps('Mix.\nBake.\r\n\nServe.')).toEqual(['Mix.', 'Bake.', 'Serve.']);
    });

    it('accepts a list of strings and of HowToStep objects (text or name)', () => {
      expect(steps(['One', 'Two'])).toEqual(['One', 'Two']);
      expect(steps([{ '@type': 'HowToStep', name: 'Named step' }, { '@type': 'HowToStep', text: 'Text step' }])).toEqual([
        'Named step',
        'Text step',
      ]);
    });

    it('flattens HowToSection groups', () => {
      expect(
        steps([
          { '@type': 'HowToSection', name: 'Dough', itemListElement: [{ '@type': 'HowToStep', text: 'Knead' }] },
          { '@type': 'HowToSection', name: 'Sauce', itemListElement: [{ '@type': 'HowToStep', text: 'Simmer' }, 'Season'] },
        ]),
      ).toEqual(['Knead', 'Simmer', 'Season']);
    });

    it('turns <br> and paragraphs into separate steps and strips other tags', () => {
      expect(steps('<p>Chop the <b>onion</b>.</p><p>Fry it.</p>')).toEqual(['Chop the onion .', 'Fry it.']);
      expect(steps('Boil<br>Drain<br/>Serve')).toEqual(['Boil', 'Drain', 'Serve']);
    });

    it('returns an empty list for missing or odd values', () => {
      expect(steps(undefined)).toEqual([]);
      expect(steps(42)).toEqual([]);
      expect(steps({})).toEqual([]);
    });
  });

  describe('images', () => {
    const image = (value: unknown) =>
      extractRecipe(page(ld({ '@type': 'Recipe', name: 'R', image: value })), PAGE)?.imageUrl;

    it('accepts a string, an ImageObject and an array, and resolves relative addresses', () => {
      expect(image('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
      expect(image({ '@type': 'ImageObject', url: 'https://cdn.example/b.jpg' })).toBe('https://cdn.example/b.jpg');
      expect(image(['', 'https://cdn.example/c.jpg', 'https://cdn.example/d.jpg'])).toBe('https://cdn.example/c.jpg');
      expect(image('/img/e.jpg')).toBe('https://food.example/img/e.jpg');
      expect(image('//cdn.example/f.jpg')).toBe('https://cdn.example/f.jpg');
    });

    it('drops anything that is not an http(s) address', () => {
      expect(image('javascript:alert(1)')).toBeNull();
      expect(image('data:image/png;base64,AAAA')).toBeNull();
      expect(image('file:///etc/passwd')).toBeNull();
      expect(image(`https://cdn.example/${'a'.repeat(3000)}`)).toBeNull();
      expect(image(undefined)).toBeNull();
      expect(image({})).toBeNull();
    });
  });

  describe('text cleaning and limits', () => {
    it('removes tags, decodes entities once and collapses whitespace', () => {
      const result = extractRecipe(
        page(
          ld({
            '@type': 'Recipe',
            name: 'Mac &amp; Cheese <i>deluxe</i>',
            description: 'Rich&nbsp;and  creamy &#8211; &#x2764; &amp;amp; more',
            recipeIngredient: ['1&nbsp;cup <b>milk</b>'],
          }),
        ),
        PAGE,
      )!;
      expect(result.draft.title).toBe('Mac & Cheese deluxe');
      expect(result.draft.description).toBe('Rich and creamy – ❤ &amp; more');
      expect(result.draft.ingredients).toEqual(['1 cup milk']);
    });

    it('leaves unknown or invalid entities alone', () => {
      const result = extractRecipe(page(ld({ '@type': 'Recipe', name: 'A &bogus; B &#0; C &#xD800; D' })), PAGE)!;
      expect(result.draft.title).toBe('A &bogus; B &#0; C &#xD800; D');
    });

    it('takes the first cuisine of a list and ignores non-text values', () => {
      const cuisine = (value: unknown) =>
        extractRecipe(page(ld({ '@type': 'Recipe', name: 'R', recipeCuisine: value })), PAGE)?.draft.cuisine;
      expect(cuisine(['', 'Thai', 'Asian'])).toBe('Thai');
      expect(cuisine(123)).toBeNull();
      expect(cuisine(undefined)).toBeNull();
    });

    it('clips fields to the recipe limits instead of rejecting them', () => {
      const result = extractRecipe(
        page(
          ld({
            '@type': 'Recipe',
            name: 'T'.repeat(500),
            recipeCuisine: 'C'.repeat(300),
            description: 'D'.repeat(9000),
            recipeIngredient: ['I'.repeat(400)],
            recipeInstructions: ['S'.repeat(5000)],
          }),
        ),
        PAGE,
      )!;
      expect(result.draft.title).toHaveLength(200);
      expect(result.draft.cuisine).toHaveLength(80);
      expect(result.draft.description).toHaveLength(5000);
      expect(result.draft.ingredients[0]).toHaveLength(200);
      expect(result.draft.steps[0]).toHaveLength(2000);
    });

    it('caps the number of ingredients and steps at 100 and drops blanks and non-strings', () => {
      const many = Array.from({ length: 300 }, (_, i) => `item ${i}`);
      const result = extractRecipe(
        page(ld({ '@type': 'Recipe', name: 'R', recipeIngredient: ['', 7, null, ...many], recipeInstructions: many })),
        PAGE,
      )!;
      expect(result.draft.ingredients).toHaveLength(100);
      expect(result.draft.ingredients[0]).toBe('item 0');
      expect(result.draft.steps).toHaveLength(100);
    });

    it('accepts a single ingredient string with line breaks', () => {
      const result = extractRecipe(page(ld({ '@type': 'Recipe', name: 'R', recipeIngredient: '1 egg\n2 cups flour' })), PAGE)!;
      expect(result.draft.ingredients).toEqual(['1 egg', '2 cups flour']);
    });
  });

  describe('hostile input', () => {
    it('does not hang on deeply nested JSON', () => {
      const nested = '['.repeat(500) + ']'.repeat(500);
      const started = Date.now();
      expect(extractRecipe(page(ld(nested)), PAGE)).toBeNull();
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('does not find a Recipe buried deeper than the depth limit', () => {
      let node: unknown = soup;
      for (let i = 0; i < 12; i++) node = { mainEntity: node };
      expect(extractRecipe(page(ld(node)), PAGE)).toBeNull();
    });

    it('stays fast on a page full of unclosed script tags', () => {
      const html = '<script type="application/ld+json">'.repeat(20_000);
      const started = Date.now();
      expect(extractRecipe(html, PAGE)).toBeNull();
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('stays fast on a long run of "<" characters and on huge arrays', () => {
      const started = Date.now();
      extractRecipe(page(ld({ '@type': 'Recipe', name: 'R', description: '<'.repeat(100_000) })), PAGE);
      extractRecipe(page(ld({ '@type': 'Recipe', name: 'R', recipeIngredient: Array.from({ length: 200_000 }, () => 'x') })), PAGE);
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it('ignores only a few blocks beyond the cap', () => {
      const filler = Array.from({ length: 60 }, () => ld({ '@type': 'Thing' }));
      expect(extractRecipe(page(...filler, ld(soup)), PAGE)).toBeNull();
    });

    it('treats script-like text in a recipe as plain text', () => {
      // Inside a script element the closing tag has to be escaped as <\/script>, which is valid JSON.
      const json = '{"@type":"Recipe","name":"<script>alert(1)<\\/script>Soup"}';
      const result = extractRecipe(page(ld(json)), PAGE)!;
      expect(result.draft.title).toBe('alert(1) Soup');
    });
  });
});

describe('decodePage', () => {
  it('uses the charset the page declares', () => {
    const body = Buffer.from('Crème brûlée', 'latin1');
    expect(decodePage(body, 'text/html; charset=iso-8859-1')).toBe('Crème brûlée');
    expect(decodePage(body, 'text/html; charset="ISO-8859-1"')).toBe('Crème brûlée');
  });

  it('defaults to UTF-8 and survives an unknown charset name', () => {
    const body = Buffer.from('Crème brûlée', 'utf8');
    expect(decodePage(body, 'text/html')).toBe('Crème brûlée');
    expect(decodePage(body, 'text/html; charset=not-a-charset')).toBe('Crème brûlée');
  });
});
