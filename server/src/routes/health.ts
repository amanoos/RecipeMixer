import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/connection.js';
import { getSchemaVersion } from '../db/migrate.js';
import type { AuthContext } from '../plugins/auth.js';

// Public so Docker and uptime checks work, but a caller who is not logged in learns nothing beyond "ok".
export const healthRoutes: FastifyPluginAsync<{ db: Db; auth: AuthContext }> = async (app, { db, auth }) => {
  app.get('/api/health', async (req) =>
    auth.isAuthenticated(req) ? { status: 'ok', schemaVersion: getSchemaVersion(db) } : { status: 'ok' },
  );
};
