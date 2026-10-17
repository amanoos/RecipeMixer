import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, makeTempDir, multipartBody } from './helpers.js';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

const SCRIPT = `console.log("${'recipe '.repeat(800)}");`;
const HTML = `<!doctype html><html><head><title>RecipeMixer</title></head><body>${'<p>hello</p>'.repeat(200)}</body></html>`;

let webDist: string;

beforeAll(() => {
  webDist = makeTempDir('recipemixer-web-');
  fs.mkdirSync(path.join(webDist, 'assets'));
  fs.writeFileSync(path.join(webDist, 'index.html'), HTML);
  fs.writeFileSync(path.join(webDist, 'assets', 'index-1a2b3c4d.js'), SCRIPT);
  fs.writeFileSync(path.join(webDist, 'assets', 'tiny-5e6f7a8b.css'), 'body{margin:0}');
  fs.writeFileSync(path.join(webDist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
});

const get = (url: string, encoding?: string) =>
  app.inject({ method: 'GET', url, headers: encoding ? { 'accept-encoding': encoding } : {} });

describe('caching of the built web app', () => {
  it('keeps the content-hashed files under assets/ for a year', async () => {
    app = await makeApp({ webDist });
    for (const file of ['/assets/index-1a2b3c4d.js', '/assets/tiny-5e6f7a8b.css']) {
      const res = await get(file);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    }
  });

  it('makes the browser check index.html, the favicon and the page it falls back to every time', async () => {
    app = await makeApp({ webDist });
    for (const url of ['/', '/index.html', '/favicon.svg', '/recipes/12', '/match']) {
      const res = await get(url);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('still sends the security headers with static files', async () => {
    app = await makeApp({ webDist });
    const res = await get('/assets/index-1a2b3c4d.js');
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('compression', () => {
  it('compresses a script with gzip or brotli when the browser accepts it, and the bytes decode back', async () => {
    app = await makeApp({ webDist });

    const gzip = await get('/assets/index-1a2b3c4d.js', 'gzip');
    expect(gzip.headers['content-encoding']).toBe('gzip');
    expect(gzip.headers.vary).toContain('accept-encoding');
    expect(zlib.gunzipSync(gzip.rawPayload).toString()).toBe(SCRIPT);
    expect(gzip.rawPayload.length).toBeLessThan(SCRIPT.length / 5);

    const brotli = await get('/assets/index-1a2b3c4d.js', 'br');
    expect(brotli.headers['content-encoding']).toBe('br');
    expect(zlib.brotliDecompressSync(brotli.rawPayload).toString()).toBe(SCRIPT);
  });

  it('sends the plain bytes to a client that does not ask for compression', async () => {
    app = await makeApp({ webDist });
    const res = await get('/assets/index-1a2b3c4d.js');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toBe(SCRIPT);
  });

  it('compresses the page itself, but not small API responses where it would not pay off', async () => {
    app = await makeApp({ webDist });
    expect((await get('/', 'gzip')).headers['content-encoding']).toBe('gzip');

    const health = await get('/api/health', 'gzip');
    expect(health.statusCode).toBe(200);
    expect(health.headers['content-encoding']).toBeUndefined();
    expect(health.json()).toMatchObject({ status: 'ok' });
  });

  it('compresses large API responses', async () => {
    app = await makeApp({ webDist });
    const created = await app.inject({
      method: 'POST',
      url: '/api/recipes',
      payload: { title: 'Soup', description: 'warm and simple '.repeat(250), ingredients: ['1 onion'], steps: ['Chop'] },
    });
    const { id } = created.json() as { id: number };

    const res = await app.inject({ method: 'GET', url: `/api/recipes/${id}`, headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(JSON.parse(zlib.gunzipSync(res.rawPayload).toString()).title).toBe('Soup');
  });

  it('leaves stored photos alone: they are already compressed', async () => {
    app = await makeApp({ webDist });
    const created = await app.inject({ method: 'POST', url: '/api/recipes', payload: { title: 'Soup' } });
    const { id } = created.json() as { id: number };

    const noisy = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 50 } },
    })
      .png()
      .toBuffer();
    const upload = multipartBody('image', 'photo.png', 'image/png', noisy);
    const saved = await app.inject({ method: 'PUT', url: `/api/recipes/${id}/image`, ...upload });
    const { imageUrl } = saved.json() as { imageUrl: string };

    const res = await get(imageUrl, 'gzip, br');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.rawPayload.length).toBeGreaterThan(1024);
    expect(res.headers['content-encoding']).toBeUndefined();
  });
});
