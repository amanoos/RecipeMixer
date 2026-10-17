import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/connection.js';
import { getSchemaVersion } from '../db/migrate.js';

export const healthRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/api/health', async () => ({
    status: 'ok',
    schemaVersion: getSchemaVersion(db),
  }));
};
