import { describe, expect, it } from 'vitest';
import { badRequest, HttpError, notFound, payloadTooLarge, unsupportedMediaType } from '../src/errors.js';
import { listQuerySchema, parseOrThrow, recipeInputSchema } from '../src/schemas/recipe.js';

describe('HttpError', () => {
  it('carries a status code and message', () => {
    const err = new HttpError(418, 'teapot');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(418);
    expect(err.message).toBe('teapot');
  });

  it('has helpers for common statuses', () => {
    expect(badRequest('x').statusCode).toBe(400);
    expect(notFound().statusCode).toBe(404);
    expect(notFound().message).toBe('Not Found');
    expect(payloadTooLarge('x').statusCode).toBe(413);
    expect(unsupportedMediaType('x').statusCode).toBe(415);
  });
});

describe('recipeInputSchema', () => {
  it('accepts a full valid recipe', () => {
    const parsed = parseOrThrow(recipeInputSchema, {
      title: '  Tomato soup ',
      cuisine: 'Italian',
      description: 'Warm.',
      sourceUrl: 'https://example.com/soup',
      rating: 4,
      ingredients: ['4 tomatoes', ' 1 onion '],
      steps: ['Chop', 'Simmer'],
    });
    expect(parsed).toEqual({
      title: 'Tomato soup',
      cuisine: 'Italian',
      description: 'Warm.',
      sourceUrl: 'https://example.com/soup',
      rating: 4,
      ingredients: ['4 tomatoes', '1 onion'],
      steps: ['Chop', 'Simmer'],
    });
  });

  it('applies defaults and turns empty optional text into null', () => {
    const parsed = parseOrThrow(recipeInputSchema, { title: 'Toast', cuisine: '  ', description: '' });
    expect(parsed).toEqual({
      title: 'Toast',
      cuisine: null,
      description: null,
      sourceUrl: null,
      rating: null,
      ingredients: [],
      steps: [],
    });
  });

  it.each([
    ['empty title', { title: '   ' }],
    ['missing title', {}],
    ['rating too high', { title: 'x', rating: 6 }],
    ['rating zero', { title: 'x', rating: 0 }],
    ['fractional rating', { title: 'x', rating: 2.5 }],
    ['javascript url', { title: 'x', sourceUrl: 'javascript:alert(1)' }],
    ['ftp url', { title: 'x', sourceUrl: 'ftp://example.com/file' }],
    ['not a url', { title: 'x', sourceUrl: 'banana' }],
    ['too many ingredients', { title: 'x', ingredients: Array.from({ length: 101 }, () => 'salt') }],
    ['blank ingredient', { title: 'x', ingredients: ['salt', ''] }],
    ['overlong step', { title: 'x', steps: ['a'.repeat(2001)] }],
    ['unknown key', { title: 'x', admin: true }],
    ['title not a string', { title: 42 }],
  ])('rejects %s', (_name, body) => {
    expect(() => parseOrThrow(recipeInputSchema, body)).toThrow(HttpError);
  });

  it('reports the field but never echoes the submitted value', () => {
    try {
      parseOrThrow(recipeInputSchema, { title: 'x', sourceUrl: 'javascript:secret-token' });
      expect.unreachable();
    } catch (err) {
      const error = err as HttpError;
      expect(error.statusCode).toBe(400);
      expect(error.message).toContain('sourceUrl');
      expect(error.message).not.toContain('secret-token');
    }
  });

  it('rejects a missing body', () => {
    expect(() => parseOrThrow(recipeInputSchema, undefined)).toThrow(/Invalid body/);
  });
});

describe('listQuerySchema', () => {
  it('uses defaults', () => {
    expect(parseOrThrow(listQuerySchema, {})).toEqual({ limit: 24, offset: 0 });
  });

  it('coerces numeric strings', () => {
    expect(parseOrThrow(listQuerySchema, { limit: '10', offset: '5' })).toEqual({ limit: 10, offset: 5 });
  });

  it.each([{ limit: '0' }, { limit: '101' }, { offset: '-1' }, { limit: 'abc' }])('rejects %j', (query) => {
    expect(() => parseOrThrow(listQuerySchema, query)).toThrow(HttpError);
  });
});
