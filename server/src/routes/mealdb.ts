import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/connection.js';
import { findRecipeIdBySourceUrl } from '../db/recipes.js';
import { notFound } from '../errors.js';
import type { ImportPreview } from '../schemas/import.js';
import { parseOrThrow } from '../schemas/recipe.js';
import type { Limiter } from '../services/concurrency.js';
import {
  mealApiUrl,
  mealPageUrl,
  mealToExtracted,
  parseMeals,
  toSearchResults,
  type MealSearchResult,
} from '../services/mealdb.js';
import type { SafeFetcher } from '../services/safe-fetch.js';
import { IMPORT_RATE_LIMIT } from './import.js';

export interface MealDbRouteDeps {
  db: Db;
  fetcher: SafeFetcher;
  limiter: Limiter;
  enabled: boolean;
  apiKey: string;
}

const searchQuerySchema = z.object({ q: z.string().trim().min(2).max(60) });
const idSchema = z.object({ id: z.string().regex(/^\d{1,10}$/) });

/** Optional TheMealDB lookups. Nothing is saved here: the web app reviews a result like any imported recipe. */
export const mealdbRoutes: FastifyPluginAsync<MealDbRouteDeps> = async (app, { db, fetcher, limiter, enabled, apiKey }) => {
  // When the feature is off the routes do not exist, so both addresses answer 404.
  if (!enabled) return;

  app.get('/api/mealdb/search', { config: { rateLimit: IMPORT_RATE_LIMIT } }, async (req): Promise<{ items: MealSearchResult[] }> => {
    const { q } = parseOrThrow(searchQuerySchema, req.query);
    const payload = await limiter(() => fetcher.fetchJson(mealApiUrl(apiKey, 'search', { s: q })));
    return { items: toSearchResults(parseMeals(payload)) };
  });

  app.get<{ Params: { id: string } }>(
    '/api/mealdb/meals/:id',
    { config: { rateLimit: IMPORT_RATE_LIMIT } },
    async (req): Promise<ImportPreview> => {
      const { id } = parseOrThrow(idSchema, req.params);
      const payload = await limiter(() => fetcher.fetchJson(mealApiUrl(apiKey, 'lookup', { i: id })));
      // The answer must be the meal that was asked for, not just any record.
      const record = parseMeals(payload).find((meal) => meal.idMeal === id);
      if (!record) throw notFound('That recipe was not found on TheMealDB');

      const sourceUrl = mealPageUrl(id);
      return { ...mealToExtracted(record), sourceUrl, existingRecipeId: findRecipeIdBySourceUrl(db, sourceUrl) };
    },
  );
};
