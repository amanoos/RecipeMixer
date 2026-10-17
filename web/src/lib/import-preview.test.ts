import { describe, expect, it } from 'vitest';
import { hostOf, readImportPreview } from './import-preview';

const valid = {
  draft: { title: 'Soup', cuisine: null, description: 'Warm', ingredients: ['1 onion'], steps: ['Chop'] },
  imageUrl: 'https://food.example/a.jpg',
  sourceUrl: 'https://food.example/soup',
  existingRecipeId: null,
};

describe('readImportPreview', () => {
  it('accepts a well-formed preview', () => {
    expect(readImportPreview({ importPreview: valid })).toEqual(valid);
  });

  it('fills in a missing photo and existing id', () => {
    const withoutOptionalFields = { draft: valid.draft, sourceUrl: valid.sourceUrl };
    expect(readImportPreview({ importPreview: withoutOptionalFields })).toMatchObject({ imageUrl: null, existingRecipeId: null });
  });

  it('keeps only the known fields', () => {
    const result = readImportPreview({ importPreview: { ...valid, draft: { ...valid.draft, admin: true }, extra: 1 } });
    expect(result).toEqual(valid);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'importPreview'],
    ['an empty object', {}],
    ['no draft', { importPreview: { ...valid, draft: undefined } }],
    ['a draft without a title', { importPreview: { ...valid, draft: { ...valid.draft, title: 5 } } }],
    ['ingredients that are not strings', { importPreview: { ...valid, draft: { ...valid.draft, ingredients: [1] } } }],
    ['steps that are not a list', { importPreview: { ...valid, draft: { ...valid.draft, steps: 'Chop' } } }],
    ['a missing source link', { importPreview: { ...valid, sourceUrl: undefined } }],
    ['a photo that is not text', { importPreview: { ...valid, imageUrl: 3 } }],
  ])('rejects %s', (_name, state) => {
    expect(readImportPreview(state)).toBeNull();
  });
});

describe('hostOf', () => {
  it('returns the host of an address and null for nonsense', () => {
    expect(hostOf('https://food.example/a/b?c=1')).toBe('food.example');
    expect(hostOf('not a url')).toBeNull();
  });
});
