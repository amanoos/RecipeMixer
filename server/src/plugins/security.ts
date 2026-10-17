import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { isApiRequest } from '../services/request-path.js';

export interface SecurityOptions {
  /** Maximum requests per client IP per minute. */
  rateLimitMax: number;
}

// Registered directly on the root instance (not as an encapsulated plugin) so the
// headers and rate limit apply to every route, including static files.
export async function registerSecurity(app: FastifyInstance, options: SecurityOptions): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  });

  await app.register(rateLimit, {
    max: options.rateLimitMax,
    timeWindow: '1 minute',
    // (The limiter counts an IPv6 range as one client and unwraps IPv4-mapped addresses by itself.)
  });

  app.addHook('onSend', async (req, reply, payload) => {
    void reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    // API answers hold private data: browsers may use them, shared caches (proxy, CDN) must never store them.
    if (isApiRequest(req.raw.url ?? '') && !reply.hasHeader('cache-control')) {
      void reply.header('Cache-Control', 'private, no-store');
    }
    return payload;
  });
}
