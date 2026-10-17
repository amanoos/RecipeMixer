import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { tooManyRequests, unauthorized } from '../errors.js';
import type { AuthContext } from '../plugins/auth.js';
import { parseOrThrow } from '../schemas/recipe.js';
import { throttleKey } from '../services/login-throttle.js';
import { MAX_PASSWORD_LENGTH, passwordMatches } from '../services/password.js';

const loginSchema = z.object({ password: z.string().min(1).max(MAX_PASSWORD_LENGTH) }).strict();

// Stricter than the global limit; the lockout in LoginThrottle is a second, separate layer.
const LOGIN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const minutes = (seconds: number): number => Math.max(1, Math.ceil(seconds / 60));

/** Login, logout and "who am I". Public: these three are the only API routes that work without a session. */
export const sessionRoutes: FastifyPluginAsync<{ auth: AuthContext; features: { mealdb: boolean } }> = async (
  app,
  { auth, features },
) => {
  app.get('/api/session', async (req) => ({
    authRequired: auth.enabled,
    authenticated: auth.isAuthenticated(req),
    // Which optional features this server has switched on, so the page can show or hide them. Nothing secret.
    features,
  }));

  app.post('/api/session', { config: { rateLimit: LOGIN_RATE_LIMIT } }, async (req, reply) => {
    const { password } = parseOrThrow(loginSchema, req.body);
    // With no password configured there is nothing to log in to.
    if (!auth.enabled || auth.password === null || auth.sessions === null) return reply.status(204).send();

    const client = throttleKey(req.ip);
    const refuseIfLocked = () => {
      const current = auth.throttle.check(client);
      if (current.locked) {
        void reply.header('Retry-After', String(current.retryAfterSeconds));
        throw tooManyRequests(`Too many wrong passwords. Try again in ${minutes(current.retryAfterSeconds)} minutes.`);
      }
      return current;
    };
    const status = refuseIfLocked();

    // After a burst of wrong passwords from anywhere, every attempt waits a moment. It slows guessing down
    // without locking anyone out, so it cannot be used to keep the owner out.
    if (status.delayMs > 0) {
      await sleep(status.delayMs);
      // Attempts that arrived together all got past the first check; look again, so a burst cannot try more passwords
      // than the lockout allows.
      refuseIfLocked();
    }

    if (!passwordMatches(auth.password, password)) {
      auth.throttle.fail(client);
      // The attempt is logged without the password, so repeated guessing is visible in the server log.
      req.log.warn({ ip: req.ip }, 'login failed');
      throw unauthorized('Incorrect password');
    }

    auth.throttle.succeed(client);
    auth.sessions.purgeExpired();
    auth.setSessionCookie(req, reply, auth.sessions.create());
    return reply.status(204).send();
  });

  app.delete('/api/session', async (req, reply) => {
    auth.sessions?.revoke(auth.sessionToken(req));
    auth.clearSessionCookie(req, reply);
    // Photos are kept by the browser for a long time; ask it to empty its cache for this site on logout, so they
    // are not left on a shared device. (Browsers honour this over HTTPS and on localhost.)
    void reply.header('Clear-Site-Data', '"cache"');
    return reply.status(204).send();
  });
};
