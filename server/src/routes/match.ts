import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/connection.js';
import { suggestIngredients } from '../db/ingredients.js';
import { parseOrThrow } from '../schemas/recipe.js';
import { matchQuerySchema, suggestQuerySchema } from '../schemas/match.js';
import { findMatches } from '../services/matching.js';

// Static routes: they cannot clash with /api/recipes/:id.
export const matchRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/api/match', async (req) => findMatches(db, parseOrThrow(matchQuerySchema, req.query)));

  app.get('/api/ingredients/suggest', async (req) => {
    const { q, limit } = parseOrThrow(suggestQuerySchema, req.query);
    return { items: suggestIngredients(db, q, limit) };
  });
};
