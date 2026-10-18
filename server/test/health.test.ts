import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, makeTempDir } from './helpers.js';

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
});

describe('GET /api/health', () => {
  it('returns ok with the schema version', async () => {
    app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', schemaVersion: 6 });
  });
});

describe('error and not-found handling', () => {
  it('returns JSON 404 for unknown API routes', async () => {
    app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not Found' });
  });

  it('returns a generic 500 without internals when a route throws', async () => {
    app = await makeApp();
    app.get('/api/boom', async () => {
      throw new Error('secret detail at /home/user/db.sqlite');
    });
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal Server Error' });
    expect(res.body).not.toContain('secret detail');
    expect(res.body).not.toContain('at ');
  });
});

describe('serving the web build', () => {
  function makeWebDist(): string {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>RecipeMixer</title>');
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1);');
    return dir;
  }

  it('serves index.html at / and static assets', async () => {
    app = await makeApp({ webDist: makeWebDist() });
    const page = await app.inject({ method: 'GET', url: '/' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('RecipeMixer');
    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
  });

  it('falls back to index.html for client-side routes', async () => {
    app = await makeApp({ webDist: makeWebDist() });
    const res = await app.inject({ method: 'GET', url: '/recipes/42' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('RecipeMixer');
  });

  it('returns 404 for missing files instead of the HTML shell', async () => {
    app = await makeApp({ webDist: makeWebDist() });
    const res = await app.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(res.statusCode).toBe(404);
  });

  it('still returns JSON 404 for unknown API routes when the web build exists', async () => {
    app = await makeApp({ webDist: makeWebDist() });
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not Found' });
  });

  it('does not serve files outside the web build', async () => {
    app = await makeApp({ webDist: makeWebDist() });
    const res = await app.inject({ method: 'GET', url: '/..%2f..%2fpackage.json' });
    expect(res.statusCode).not.toBe(200);
  });
});
