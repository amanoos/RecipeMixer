import fs from 'node:fs';
import path from 'node:path';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/connection.js';
import { registerSecurity } from './plugins/security.js';
import { healthRoutes } from './routes/health.js';
import { imageRoutes } from './routes/images.js';
import { matchRoutes } from './routes/match.js';
import { recipeRoutes } from './routes/recipes.js';
import { createImageStore, MAX_IMAGE_BYTES } from './services/images.js';

export interface AppDeps {
  config: Config;
  db: Db;
  /** Requests per client IP per minute. */
  rateLimitMax?: number;
}

const HAS_FILE_EXTENSION = /\.[a-z0-9]+$/i;

function isApiPath(url: string): boolean {
  const pathname = url.split('?')[0] ?? '';
  return pathname === '/api' || pathname.startsWith('/api/');
}

export async function buildApp({ config, db, rateLimitMax = 300 }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  });

  // Never leak stack traces or internals to clients; the detail is logged server-side.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    req.log.error({ err }, 'request failed');
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    void reply.status(status).send({
      error: status === 500 ? 'Internal Server Error' : err.message,
    });
  });

  await registerSecurity(app, { rateLimitMax });
  // Registered after the security plugins so headers and rate limiting also cover uploads.
  // Only a single image file is accepted: no extra form fields, one part, capped size.
  await app.register(multipart, {
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 1 },
  });

  const images = createImageStore(config.imagesDir);
  await app.register(healthRoutes, { db });
  await app.register(recipeRoutes, { db, images });
  await app.register(imageRoutes, { images });
  await app.register(matchRoutes, { db });

  // The data directory is deliberately never served; images go through the validated /api/images route.
  const hasWebBuild = fs.existsSync(path.join(config.webDist, 'index.html'));
  if (hasWebBuild) {
    await app.register(fastifyStatic, { root: config.webDist });
  }

  app.setNotFoundHandler((req, reply) => {
    const isPageRequest =
      req.method === 'GET' && !isApiPath(req.url) && !HAS_FILE_EXTENSION.test(req.url.split('?')[0] ?? '');
    if (hasWebBuild && isPageRequest) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: 'Not Found' });
  });

  return app;
}
