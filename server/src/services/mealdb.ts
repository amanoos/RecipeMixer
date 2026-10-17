import { z } from 'zod';
import type { ExtractedRecipe } from '../schemas/import.js';

// TheMealDB (https://www.themealdb.com) is a community recipe database. It is not open source, so this is an
// optional feature that is off unless the owner turns it on. Its terms ask users to go through the official
// API endpoints (never to scrape the site), to keep its notices and to link back to it.

export const MEALDB_ORIGIN = 'https://www.themealdb.com';
const MEALDB_HOST = 'themealdb.com';
const MAX_RESULTS = 25;
const MAX_PHOTO_URL_LENGTH = 2048;
const MAX_INGREDIENT_SLOTS = 20;

const text = z.string().nullish();

/** One meal as the API returns it. Unknown fields are ignored; the numbered ingredient fields are read by name. */
const mealRecordSchema = z.looseObject({
  idMeal: z.string().regex(/^\d{1,10}$/),
  strMeal: z.string().trim().min(1),
  strCategory: text,
  strArea: text,
  strInstructions: text,
  strMealThumb: text,
  strTags: text,
});

export type MealRecord = z.infer<typeof mealRecordSchema>;

const responseSchema = z.object({ meals: z.array(z.unknown()).nullable() });

export interface MealSearchResult {
  id: string;
  title: string;
  cuisine: string | null;
  category: string | null;
}

export const mealPageUrl = (id: string): string => `${MEALDB_ORIGIN}/meal/${id}`;

/** The address of an API call. Only the fixed host and the key from the settings are ever used. */
export function mealApiUrl(apiKey: string, endpoint: 'search' | 'lookup', params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('&');
  return `${MEALDB_ORIGIN}/api/json/v1/${apiKey}/${endpoint}.php?${query}`;
}

/** Reads a list of meals from an API answer. Records that do not look like meals are dropped, not trusted. */
export function parseMeals(payload: unknown): MealRecord[] {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.meals === null) return [];
  const meals: MealRecord[] = [];
  for (const item of parsed.data.meals) {
    const record = mealRecordSchema.safeParse(item);
    if (record.success) meals.push(record.data);
  }
  return meals;
}

const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

function cuisineOf(record: MealRecord): string | null {
  const area = clean(record.strArea, 80);
  return area && area.toLowerCase() !== 'unknown' ? area : null;
}

export function toSearchResults(meals: MealRecord[]): MealSearchResult[] {
  return meals.slice(0, MAX_RESULTS).map((record) => ({
    id: record.idMeal,
    title: record.strMeal.slice(0, 200),
    cuisine: cuisineOf(record),
    category: clean(record.strCategory, 80),
  }));
}

/** Only a secure address on TheMealDB's own domain may be offered as the photo. */
export function safePhotoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const onTheirDomain = url.hostname === MEALDB_HOST || url.hostname.endsWith(`.${MEALDB_HOST}`);
  if (url.protocol !== 'https:' || !onTheirDomain || url.port !== '' || url.username || url.password) return null;
  url.hash = '';
  // The photo is fetched later by the image importer, which refuses longer addresses.
  return url.href.length > MAX_PHOTO_URL_LENGTH ? null : url.href;
}

function ingredientLines(record: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (let slot = 1; slot <= MAX_INGREDIENT_SLOTS; slot++) {
    const name = clean(record[`strIngredient${slot}`], 150);
    if (!name) continue;
    const measure = clean(record[`strMeasure${slot}`], 50);
    lines.push((measure ? `${measure} ${name}` : name).slice(0, 200));
  }
  return lines;
}

function stepLines(instructions: unknown): string[] {
  if (typeof instructions !== 'string') return [];
  return instructions
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^step\s*\d+\.?$/i.test(line))
    .slice(0, 100)
    .map((line) => line.slice(0, 2000));
}

/** Turns a meal into the same draft a URL import produces, to be reviewed before anything is saved. */
export function mealToExtracted(record: MealRecord): ExtractedRecipe {
  const category = clean(record.strCategory, 80);
  const tags = clean(record.strTags, 120);
  const description = [category && `Category: ${category}`, tags && `Tags: ${tags.split(',').join(', ')}`]
    .filter(Boolean)
    .join('. ');
  return {
    draft: {
      title: record.strMeal.slice(0, 200),
      cuisine: cuisineOf(record),
      description: description || null,
      ingredients: ingredientLines(record),
      steps: stepLines(record.strInstructions),
    },
    imageUrl: safePhotoUrl(record.strMealThumb),
  };
}
