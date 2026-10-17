import fs from 'node:fs';
import path from 'node:path';
import compress from '@fastify/compress';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type RouteOptions } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/connection.js';
import { HttpError } from './errors.js';
import { createAuthContext, registerAuth } from './plugins/auth.js';
import { registerSecurity } from './plugins/security.js';
import { healthRoutes } from './routes/health.js';
import { imageRoutes } from './routes/images.js';
import { importRoutes } from './routes/import.js';
import { matchRoutes } from './routes/match.js';
import { recipeRoutes } from './routes/recipes.js';
import { sessionRoutes } from './routes/session.js';
import { createImageStore, MAX_IMAGE_BYTES } from './services/images.js';
import { createSafeFetcher, type SafeFetcher } from './services/safe-fetch.js';

export interface AppDeps {
  config: Config;
  db: Db;
  /** Requests per client IP per minute. */
  rateLimitMax?: number;
  /** Fetches recipe pages and images from user-supplied URLs. Tests replace it; the default is the guarded fetcher. */
  fetcher?: SafeFetcher;
  /** The clock for sessions and the login limits, in milliseconds. Tests replace it. */
  clock?: () => number;
  /** Where log lines go. Tests capture them to prove that secrets never reach the log; normally stdout. */
  logStream?: NodeJS.WritableStream;
  /** Called for every route as it is registered. Tests use it to check that no route escapes the login. */
  onRoute?: (route: RouteOptions) => void;
}

const HAS_FILE_EXTENSION = /\.[a-z0-9]+$/i;

function isApiPath(url: string): boolean {
  const pathname = url.split('?')[0] ?? '';
  return pathname === '/api' || pathname.startsWith('/api/');
}

export async function buildApp({ config, db, rateLimitMax = 300, fetcher, clock, logStream, onRoute }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    // Behind a reverse proxy the real client address (for the login limits) comes from X-Forwarded-For, but only
    // for the number of proxies the owner configured; the default trusts none.
    trustProxy: config.trustProxy,
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      ...(logStream ? { stream: logStream } : {}),
    },
  });
  if (onRoute) app.addHook('onRoute', onRoute);

  // Never leak stack traces or internals to clients; the detail is logged server-side.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    req.log.error({ err }, 'request failed');
    // HttpError messages are written to be shown to clients, so they pass through at any status.
    // Anything else at 500 or above is an unexpected failure and stays generic.
    const status = err.statusCode && (err.statusCode < 500 || err instanceof HttpError) ? err.statusCode : 500;
    void reply.status(status).send({
      error: status === 500 ? 'Internal Server Error' : err.message,
    });
  });

  await registerSecurity(app, { rateLimitMax });

  // Login protection for the whole API, registered before any route so it covers all of them.
  const auth = createAuthContext(config, db, clock);
  await registerAuth(app, config, auth);
  if (auth.sessions) {
    auth.sessions.purgeExpired();
    const purgeTimer = setInterval(() => auth.sessions?.purgeExpired(), 60 * 60 * 1000);
    purgeTimer.unref();
    app.addHook('onClose', async () => clearInterval(purgeTimer));
  }
  // Text responses (pages, scripts, styles, JSON) are sent gzip or brotli compressed to clients that accept it.
  // Images are already compressed, and the library only skips content types that do not compress.
  await app.register(compress, { threshold: 1024 });
  // Registered after the security plugins so headers and rate limiting also cover uploads.
  // Only a single image file is accepted: no extra form fields, one part, capped size.
  await app.register(multipart, {
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 1 },
  });

  const images = createImageStore(config.imagesDir);
  await app.register(healthRoutes, { db, auth });
  await app.register(sessionRoutes, { auth });
  await app.register(recipeRoutes, { db, images });
  await app.register(imageRoutes, { images });
  await app.register(matchRoutes, { db });
  await app.register(importRoutes, {
    db,
    images,
    enabled: config.urlImportEnabled,
    // Why a target was refused goes to the log only; clients just see a generic message.
    fetcher:
      fetcher ?? createSafeFetcher({ onReject: (reason) => app.log.warn({ reason }, 'URL import target refused') }),
  });

  // The data directory is deliberately never served; images go through the validated /api/images route.
  const hasWebBuild = fs.existsSync(path.join(config.webDist, 'index.html'));
  if (hasWebBuild) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      cacheControl: false,
      // Files under assets/ have a hash of their content in the name, so they never change under that
      // name and can be kept for a year. Everything else (index.html) is checked again on every visit.
      setHeaders: (res, filePath) => {
        const hashed = path.relative(config.webDist, filePath).split(path.sep)[0] === 'assets';
        res.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
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
