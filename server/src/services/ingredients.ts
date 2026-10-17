import { parseIngredient } from 'parse-ingredient';
import pluralize from 'pluralize';
import {
  EXACT_SYNONYMS,
  GENERIC_KINDS,
  IDENTITY_WORDS,
  PHRASE_SYNONYMS,
  STAPLE_HEAD_WORDS,
  STAPLE_NAMES,
  STOP_WORDS,
  UNCOUNTABLE_WORDS,
} from './ingredient-data.js';

for (const word of UNCOUNTABLE_WORDS) pluralize.addUncountableRule(word);

/** Only the start of a line is ever processed, which also bounds the work done on hostile input. */
const MAX_LINE_LENGTH = 200;
const MAX_WORD_LENGTH = 30;
const MAX_NAMES = 4;

export interface NormalizedIngredient {
  quantity: number | null;
  unit: string | null;
  /** One canonical name per alternative ("butter or margarine" gives two). Empty when nothing usable. */
  names: string[];
}

// Longest phrases first so "all purpose flour" wins over any shorter overlap.
const PHRASES = PHRASE_SYNONYMS.map(([phrase, replacement]) => ({
  words: phrase.split(' '),
  replacement,
})).sort((a, b) => b.words.length - a.words.length);

const singularize = (word: string): string => pluralize.singular(word);

function startsWith(words: string[], phrase: string[], index: number): boolean {
  return phrase.every((word, offset) => words[index + offset] === word);
}

function applyPhrases(words: string[]): string[] {
  let current = words;
  for (const { words: phrase, replacement } of PHRASES) {
    const next: string[] = [];
    let i = 0;
    while (i < current.length) {
      if (startsWith(current, phrase, i)) {
        if (replacement) next.push(replacement);
        i += phrase.length;
      } else {
        next.push(current[i] as string);
        i += 1;
      }
    }
    current = next;
  }
  return current;
}

function canonicalName(text: string): string | null {
  const tokens = text
    .replace(/[^\p{L}\s-]/gu, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize);

  const words = applyPhrases(tokens).filter(
    (word) => word.length > 1 && word.length <= MAX_WORD_LENGTH && !STOP_WORDS.has(word),
  );
  if (words.length === 0) return null;

  const name = words.join(' ');
  return EXACT_SYNONYMS.get(name) ?? name;
}

function namesFromText(text: string): string[] {
  // "2 cloves garlic" is garlic, but a bare "cloves" is the spice, so only this exact shape is rewritten.
  const prepared = text.replace(/\bcloves?\s+(?:of\s+)?garlic\b/g, 'garlic');
  const names: string[] = [];
  for (const alternative of prepared.split(/\s+(?:or|and)\s+/)) {
    const name = canonicalName(alternative);
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= MAX_NAMES) break;
  }
  return names;
}

/**
 * Turns one free-text ingredient line ("2 cups chopped yellow onions") into a quantity, a unit and
 * canonical names (`onion`). Pure and total: it never throws, whatever the input.
 */
export function normalizeIngredient(raw: string): NormalizedIngredient {
  const line = raw.slice(0, MAX_LINE_LENGTH).toLowerCase().replace(/\([^)]*\)/g, ' ');
  // Everything after the first comma is preparation advice ("onion, finely chopped").
  const text = line.split(',')[0] ?? '';

  let parsed: ReturnType<typeof parseIngredient>[number] | undefined;
  try {
    parsed = parseIngredient(text)[0];
  } catch {
    parsed = undefined;
  }
  if (parsed?.isGroupHeader) return { quantity: null, unit: null, names: [] };

  let names = parsed ? namesFromText(parsed.description) : [];
  // A line like "2 cloves" is read as a quantity and a unit with no description; fall back to the words.
  if (names.length === 0) names = namesFromText(text);

  return { quantity: parsed?.quantity ?? null, unit: parsed?.unitOfMeasureID ?? null, names };
}

export function wordsOf(name: string): string[] {
  return name.split(' ').filter(Boolean);
}

const isSubset = (small: Set<string>, large: Set<string>): boolean => [...small].every((word) => large.has(word));

/** True when `large` has an extra word (not in `small`) that makes it a different product. */
const addsIdentity = (large: Set<string>, small: Set<string>): boolean =>
  [...large].some((word) => !small.has(word) && IDENTITY_WORDS.has(word));

/**
 * Whether what the user has (`userName`) satisfies a recipe line (`recipeName`): the same word set,
 * or one a subset of the other ("onion" and "red onion"), unless the extra words change the product
 * ("garlic" and "garlic powder", "chicken" and "chicken broth").
 */
export function ingredientsMatch(userName: string, recipeName: string): boolean {
  const user = new Set(wordsOf(userName));
  const recipe = new Set(wordsOf(recipeName));
  if (user.size === 0 || recipe.size === 0) return false;
  if (isSubset(user, recipe)) return !addsIdentity(recipe, user);
  if (isSubset(recipe, user)) return !addsIdentity(user, recipe);
  return kindCovers(user, recipe) || kindCovers(recipe, user);
}

/**
 * True when `general` holds a general word ("beef", "cheese") and `other` names one of its specific kinds
 * ("flank steak", "feta"). The general side may carry harmless extra words ("fish fillets"), but not
 * ones that make it another product ("cheese powder"), and the same goes for the specific side.
 */
function kindCovers(general: Set<string>, other: Set<string>): boolean {
  for (const [word, kinds] of GENERIC_KINDS) {
    if (!general.has(word) || addsIdentity(general, new Set([word]))) continue;
    const covered = kinds.some((kind) => {
      const kindWords = new Set(wordsOf(kind));
      return isSubset(kindWords, other) && !addsIdentity(other, kindWords);
    });
    if (covered) return true;
  }
  return false;
}

/**
 * Extra words worth looking up so a general name finds recipes that only name a specific kind, and a specific
 * kind finds recipes that only say the general name. Used to widen the first, indexed search stage.
 */
export function relatedWords(name: string): string[] {
  const words = new Set(wordsOf(name));
  const related = new Set<string>();
  for (const [general, kinds] of GENERIC_KINDS) {
    if (words.has(general)) for (const kind of kinds) for (const word of wordsOf(kind)) related.add(word);
    if (kinds.some((kind) => isSubset(new Set(wordsOf(kind)), words))) related.add(general);
  }
  return [...related];
}

export function isStapleName(name: string): boolean {
  const words = wordsOf(name);
  const last = words[words.length - 1];
  return STAPLE_NAMES.has(name) || (last !== undefined && STAPLE_HEAD_WORDS.has(last));
}

/** A line is a staple only when every alternative is one ("salt and pepper"). */
export function isStapleLine(names: string[]): boolean {
  return names.length > 0 && names.every(isStapleName);
}
