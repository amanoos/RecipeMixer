import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/connection.js';
import { findRecipeIdBySourceUrl } from '../db/recipes.js';
import { tooManyRequests, unprocessable } from '../errors.js';
import { importUrlSchema, type ImportPreview } from '../schemas/import.js';
import { parseOrThrow } from '../schemas/recipe.js';
import { processImage, type ImageStore } from '../services/images.js';
import { decodePage, extractRecipe } from '../services/recipe-jsonld.js';
import { attachImage } from '../services/recipe-images.js';
import type { SafeFetcher } from '../services/safe-fetch.js';
import { parseId, requireRecipe } from './recipes.js';

export interface ImportRouteDeps {
  db: Db;
  images: ImageStore;
  fetcher: SafeFetcher;
  enabled: boolean;
}

const MAX_CONCURRENT_IMPORTS = 2;
// Stricter than the global limit: each call makes the server fetch something from the internet.
const IMPORT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

export const importRoutes: FastifyPluginAsync<ImportRouteDeps> = async (app, { db, images, fetcher, enabled }) => {
  // When the feature is off the routes do not exist, so both addresses answer 404.
  if (!enabled) return;

  let running = 0;
  async function limited<T>(work: () => Promise<T>): Promise<T> {
    if (running >= MAX_CONCURRENT_IMPORTS) {
      throw tooManyRequests('Another import is already running. Try again in a moment.');
    }
    running += 1;
    try {
      return await work();
    } finally {
      running -= 1;
    }
  }

  // Fetches and reads a page. Nothing is saved and the photo is not downloaded yet.
  app.post('/api/import/preview', { config: { rateLimit: IMPORT_RATE_LIMIT } }, async (req): Promise<ImportPreview> => {
    const { url } = parseOrThrow(importUrlSchema, req.body);

    return limited(async () => {
      const page = await fetcher.fetchPage(url);
      const extracted = extractRecipe(decodePage(page.body, page.contentType), page.url);
      if (!extracted) throw unprocessable('No recipe data found on that page');

      const sourceUrl = page.url.href;
      return { ...extracted, sourceUrl, existingRecipeId: findRecipeIdBySourceUrl(db, sourceUrl) };
    });
  });

  // Downloads a photo for a saved recipe, through the same checks and re-encoding as an upload.
  app.post<{ Params: { id: string } }>(
    '/api/recipes/:id/image/from-url',
    { config: { rateLimit: IMPORT_RATE_LIMIT } },
    async (req) => {
      const id = parseId(req.params.id);
      requireRecipe(db, id);
      const { url } = parseOrThrow(importUrlSchema, req.body);

      return limited(async () => {
        const fetched = await fetcher.fetchImage(url);
        const { data, filename } = await processImage(fetched.body);
        await attachImage(db, images, id, data, filename);
        return requireRecipe(db, id);
      });
    },
  );
};
