import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { isLoopbackHost } from '../config.js';
import type { Db } from '../db/connection.js';
import { createSessionStore, SESSION_ABSOLUTE_MS, type SessionStore } from '../db/sessions.js';
import { forbidden, unauthorized } from '../errors.js';
import { LoginThrottle } from '../services/login-throttle.js';
import { sessionKeyFor } from '../services/password.js';
import { isApiRequest, rawPathOf } from '../services/request-path.js';

/** The only API requests answered without a login. Matched on the exact method and the exact path. */
const PUBLIC_API = new Set([
  'GET /api/health',
  'HEAD /api/health',
  'GET /api/session',
  'POST /api/session',
  'DELETE /api/session',
]);

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Over HTTPS the "__Host-" prefix makes the browser insist on Secure, path "/" and no Domain,
// so a sibling subdomain cannot overwrite the cookie.
const SECURE_COOKIE = '__Host-rm_session';
const PLAIN_COOKIE = 'rm_session';

export interface AuthContext {
  /** Whether a password is set, and so whether login is required. */
  readonly enabled: boolean;
  readonly password: string | null;
  readonly sessions: SessionStore | null;
  readonly throttle: LoginThrottle;
  /** True when no login is needed or the request carries a live session. */
  isAuthenticated(req: FastifyRequest): boolean;
  sessionToken(req: FastifyRequest): string | undefined;
  setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string): void;
  clearSessionCookie(req: FastifyRequest, reply: FastifyReply): void;
}

export function createAuthContext(config: Config, db: Db, now: () => number = Date.now): AuthContext {
  const password = config.appPassword;
  const sessions = password === null ? null : createSessionStore(db, sessionKeyFor(password), now);
  const throttle = new LoginThrottle({ now });

  const isSecure = (req: FastifyRequest): boolean => config.cookieSecure === 'always' || req.protocol === 'https';

  const cookieOptions = (req: FastifyRequest) => ({
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: isSecure(req),
  });

  const context: AuthContext = {
    enabled: password !== null,
    password,
    sessions,
    throttle,

    sessionToken(req) {
      return req.cookies[isSecure(req) ? SECURE_COOKIE : PLAIN_COOKIE];
    },

    isAuthenticated(req) {
      if (sessions === null) return true;
      return sessions.find(context.sessionToken(req));
    },

    setSessionCookie(req, reply, token) {
      reply.setCookie(isSecure(req) ? SECURE_COOKIE : PLAIN_COOKIE, token, {
        ...cookieOptions(req),
        maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
      });
    },

    clearSessionCookie(req, reply) {
      reply.clearCookie(isSecure(req) ? SECURE_COOKIE : PLAIN_COOKIE, cookieOptions(req));
    },
  };
  return context;
}

/** The host name of a Host header value, without the port ("[::1]:3210" gives "[::1]"). */
function hostnameOf(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? value : value.slice(0, end + 1);
  }
  return value.split(':')[0] ?? value;
}

/**
 * With no password the app may only be reached by a loopback name (or one the owner lists), otherwise a
 * web page on another site could point its own name at 127.0.0.1 ("DNS rebinding") and read everything.
 */
function requireAllowedHost(req: FastifyRequest, extraHosts: string[]): void {
  const hostname = hostnameOf(req.host);
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isLoopbackHost(bare) || extraHosts.includes(hostname)) return;
  throw forbidden(
    'This address is not allowed while no password is set. Open the app at http://localhost, ' +
      'or set APP_PASSWORD to protect it, or list this name in ALLOWED_HOSTS.',
  );
}

/** Refuses a state-changing request that a browser says came from another site. Scripts without these headers pass. */
function requireSameOrigin(req: FastifyRequest): void {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    throw forbidden('Cross-site requests are not allowed.');
  }

  const origin = req.headers.origin;
  if (origin !== undefined) {
    let sameHost = false;
    try {
      sameHost = new URL(origin).host === req.host;
    } catch {
      // "null" and other unusable origins are refused below.
    }
    if (!sameHost) throw forbidden('Cross-site requests are not allowed.');
  }
}

/**
 * Registers login protection on the root instance so it covers every route, including ones added later.
 * Fail closed: with a password set, every /api request needs a session unless it is on the short public list.
 */
export async function registerAuth(app: FastifyInstance, config: Config, auth: AuthContext): Promise<void> {
  await app.register(cookie);

  let warnedAboutProxy = false;

  app.addHook('onRequest', async (req) => {
    // Headers added by a reverse proxy, but no proxy is trusted: client addresses (and so the login limits) and
    // HTTPS detection (and so the cookie flags) would be wrong. Say so once, so it does not go unnoticed.
    if (!warnedAboutProxy && config.trustProxy === false && (req.headers['x-forwarded-for'] || req.headers['x-forwarded-proto'])) {
      warnedAboutProxy = true;
      req.log.warn(
        'A request carried X-Forwarded-* headers but TRUST_PROXY is not set. If a reverse proxy is in front of the app, ' +
          'set TRUST_PROXY to its address; otherwise every visitor looks like the proxy to the login limits and HTTPS is not detected.',
      );
    }

    if (!auth.enabled) requireAllowedHost(req, config.allowedHosts);

    const url = req.raw.url ?? '';
    if (!isApiRequest(url)) return;

    if (auth.enabled && !PUBLIC_API.has(`${req.method} ${rawPathOf(url)}`) && !auth.isAuthenticated(req)) {
      throw unauthorized('Login required');
    }
    if (UNSAFE_METHODS.has(req.method)) requireSameOrigin(req);
  });
}
