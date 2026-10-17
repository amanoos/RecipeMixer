import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/connection.js';
import { loadStarterRecipes, type StarterResult } from '../services/starter-recipes.js';

// Nothing here touches the network; the limit only stops a script from hammering the database.
const STARTER_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

export const starterRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  // Adds the bundled starter recipes that are not in the library yet. Repeating it adds nothing.
  app.post('/api/starter-recipes', { config: { rateLimit: STARTER_RATE_LIMIT } }, async (): Promise<StarterResult> =>
    loadStarterRecipes(db),
  );
};
