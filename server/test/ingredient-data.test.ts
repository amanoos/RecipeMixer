import pluralize from 'pluralize';
import { describe, expect, it } from 'vitest';
import {
  EXACT_SYNONYMS,
  IDENTITY_WORDS,
  NORMALIZER_VERSION,
  PHRASE_SYNONYMS,
  STAPLE_HEAD_WORDS,
  STAPLE_NAMES,
  STOP_WORDS,
  UNCOUNTABLE_WORDS,
} from '../src/services/ingredient-data.js';

const clean = (value: string) => value === value.trim() && value === value.toLowerCase() && value.length > 0;

describe('ingredient rule data', () => {
  it('has a positive integer normaliser version', () => {
    expect(Number.isInteger(NORMALIZER_VERSION)).toBe(true);
    expect(NORMALIZER_VERSION).toBeGreaterThan(0);
  });

  it('keeps stop words as clean single words that are their own singular form', () => {
    for (const word of STOP_WORDS) {
      expect(clean(word), word).toBe(true);
      expect(word.includes(' '), word).toBe(false);
      expect(pluralize.singular(word), word).toBe(word);
    }
  });

  it('keeps identity words clean, singular, and not also stop words', () => {
    for (const word of IDENTITY_WORDS) {
      expect(clean(word), word).toBe(true);
      expect(pluralize.singular(word), word).toBe(word);
      expect(STOP_WORDS.has(word), word).toBe(false);
    }
  });

  it('keeps phrase synonyms well formed', () => {
    const keys = new Set<string>();
    for (const [phrase, replacement] of PHRASE_SYNONYMS) {
      expect(clean(phrase), phrase).toBe(true);
      expect(keys.has(phrase), `duplicate ${phrase}`).toBe(false);
      keys.add(phrase);
      for (const word of phrase.split(' ')) expect(pluralize.singular(word), `${phrase}: ${word}`).toBe(word);
      expect(replacement, phrase).toBe(replacement.trim().toLowerCase());
      expect(replacement.includes(' '), `${phrase} -> ${replacement}`).toBe(false);
      expect(replacement, phrase).not.toBe(phrase);
    }
  });

  it('never chains phrase synonyms (a replacement is not itself a key)', () => {
    const keys = new Set(PHRASE_SYNONYMS.map(([phrase]) => phrase));
    for (const [phrase, replacement] of PHRASE_SYNONYMS) {
      expect(keys.has(replacement), `${phrase} -> ${replacement}`).toBe(false);
    }
  });

  it('keeps exact synonyms well formed', () => {
    for (const [key, value] of EXACT_SYNONYMS) {
      expect(clean(key)).toBe(true);
      expect(clean(value)).toBe(true);
      expect(key).not.toBe(value);
    }
  });

  it('keeps staples clean and not overlapping with stop words', () => {
    for (const name of [...STAPLE_NAMES, ...STAPLE_HEAD_WORDS]) {
      expect(clean(name), name).toBe(true);
      expect(STOP_WORDS.has(name), name).toBe(false);
    }
  });

  it('keeps uncountable words clean and unique', () => {
    expect(new Set(UNCOUNTABLE_WORDS).size).toBe(UNCOUNTABLE_WORDS.length);
    for (const word of UNCOUNTABLE_WORDS) expect(clean(word), word).toBe(true);
  });
});
