import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/connection.js';
import { badRequest } from '../errors.js';
import { parseOrThrow } from '../schemas/recipe.js';
import type { CandidateTokens } from '../services/candidate-token.js';
import type { Limiter } from '../services/concurrency.js';
import { MAX_TOKEN_LENGTH } from '../services/candidate-token.js';
import { creditFor, findPhotoCandidates, type SearchOptions } from '../services/image-search.js';
import { processImage, type ImageStore } from '../services/images.js';
import { attachImage } from '../services/recipe-images.js';
import type { SafeFetcher } from '../services/safe-fetch.js';
import { IMPORT_RATE_LIMIT } from './import.js';
import { parseId, requireRecipe } from './recipes.js';

export interface ImageSearchRouteDeps {
  db: Db;
  images: ImageStore;
  fetcher: SafeFetcher;
  limiter: Limiter;
  tokens: CandidateTokens;
  enabled: boolean;
  options: SearchOptions;
}

/** One photo offered to the user. The picture is a small inline copy, so the browser loads nothing from another site. */
export interface PhotoChoice {
  token: string;
  thumbnail: string;
  title: string;
  creator: string | null;
  licence: string;
  licenceUrl: string | null;
  landingUrl: string | null;
  provider: string;
}

const searchQuerySchema = z.object({ q: z.string().trim().min(2).max(200) });
const chooseSchema = z.object({ token: z.string().min(1).max(MAX_TOKEN_LENGTH) }).strict();

const THUMBNAIL_EDGE = 360;

/** Finds photos for a recipe title and saves the one the user picks. Both routes are absent when switched off. */
export const imageSearchRoutes: FastifyPluginAsync<ImageSearchRouteDeps> = async (
  app,
  { db, images, fetcher, limiter, tokens, enabled, options },
) => {
  if (!enabled) return;

  app.get('/api/image-search', { config: { rateLimit: IMPORT_RATE_LIMIT } }, async (req): Promise<{ items: PhotoChoice[] }> => {
    const { q } = parseOrThrow(searchQuerySchema, req.query);

    return limiter(async () => {
      const candidates = await findPhotoCandidates(fetcher, q, options, (reason) => req.log.warn({ reason }, 'photo search'));

      // Each candidate is downloaded once and shrunk to a thumbnail; one that cannot be read is simply left out.
      const settled = await Promise.allSettled(
        candidates.map(async (candidate) => {
          const fetched = await fetcher.fetchImage(candidate.imageUrl);
          const { data } = await processImage(fetched.body, { maxEdge: THUMBNAIL_EDGE });
          const credit = creditFor(candidate);
          return {
            token: tokens.sign({ imageUrl: candidate.imageUrl, creditText: credit.text, creditUrl: credit.url }),
            thumbnail: `data:image/webp;base64,${data.toString('base64')}`,
            title: candidate.title,
            creator: candidate.creator,
            licence: candidate.licence,
            licenceUrl: candidate.licenceUrl,
            landingUrl: candidate.landingUrl,
            provider: candidate.provider,
          } satisfies PhotoChoice;
        }),
      );

      return { items: settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])) };
    });
  });

  // Makes a found photo the recipe's photo, through the same checks and re-encoding as an upload.
  app.post<{ Params: { id: string } }>(
    '/api/recipes/:id/image/from-search',
    { config: { rateLimit: IMPORT_RATE_LIMIT } },
    async (req) => {
      const id = parseId(req.params.id);
      requireRecipe(db, id);
      const { token } = parseOrThrow(chooseSchema, req.body);

      const chosen = tokens.verify(token);
      if (!chosen) throw badRequest('That photo choice is not valid any more. Search again.');

      return limiter(async () => {
        const fetched = await fetcher.fetchImage(chosen.imageUrl);
        const { data, filename } = await processImage(fetched.body);
        await attachImage(db, images, id, data, filename, { text: chosen.creditText, url: chosen.creditUrl });
        return requireRecipe(db, id);
      });
    },
  );
};
