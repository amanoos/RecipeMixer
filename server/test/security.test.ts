import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp } from './helpers.js';

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
});

describe('security headers', () => {
  it('sets a strict CSP, nosniff and hides the framework', async () => {
    app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('also sets headers on 404 responses', async () => {
    app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('rate limiting', () => {
  it('returns 429 once the per-minute limit is exceeded', async () => {
    app = await makeApp({}, 5);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await app.inject({ method: 'GET', url: '/api/health' })).statusCode);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
    expect(statuses[6]).toBe(429);
  });
});
