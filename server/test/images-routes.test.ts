import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, makeTempDir, multipartBody, tinyPng } from './helpers.js';

let app: FastifyInstance;
let imagesDir: string;

afterEach(async () => {
  await app?.close();
});

async function setup() {
  imagesDir = makeTempDir('recipemixer-images-');
  app = await makeApp({ imagesDir });
}

async function createRecipe(title = 'Soup') {
  const res = await app.inject({ method: 'POST', url: '/api/recipes', payload: { title } });
  return res.json().id as number;
}

async function upload(id: number | string, data: Buffer, opts: { field?: string; type?: string; name?: string } = {}) {
  const { payload, headers } = multipartBody(
    opts.field ?? 'image',
    opts.name ?? 'photo.png',
    opts.type ?? 'image/png',
    data,
  );
  return app.inject({ method: 'PUT', url: `/api/recipes/${id}/image`, payload, headers });
}

const files = () => fs.readdirSync(imagesDir).sort();

describe('PUT /api/recipes/:id/image', () => {
  it('stores the image and serves it back as WebP with caching headers', async () => {
    await setup();
    const id = await createRecipe();
    const res = await upload(id, await tinyPng());
    expect(res.statusCode).toBe(200);
    const { imageUrl } = res.json();
    expect(imageUrl).toMatch(/^\/api\/images\/[a-f0-9]{64}\.webp$/);
    expect(files()).toHaveLength(1);

    const image = await app.inject({ method: 'GET', url: imageUrl });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/webp');
    expect(image.headers['cache-control']).toContain('immutable');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect((await sharp(image.rawPayload).metadata()).format).toBe('webp');
  });

  it('replaces an earlier image and deletes the old file', async () => {
    await setup();
    const id = await createRecipe();
    const first = (await upload(id, await tinyPng(20, 10, 10))).json().imageUrl;
    const second = (await upload(id, await tinyPng(20, 10, 250))).json().imageUrl;
    expect(second).not.toBe(first);
    expect(files()).toEqual([second.replace('/api/images/', '')]);
    expect((await app.inject({ method: 'GET', url: first })).statusCode).toBe(404);
  });

  it('keeps a shared image until the last recipe using it is deleted', async () => {
    await setup();
    const one = await createRecipe('One');
    const two = await createRecipe('Two');
    const png = await tinyPng();
    const urlOne = (await upload(one, png)).json().imageUrl;
    const urlTwo = (await upload(two, png)).json().imageUrl;
    expect(urlOne).toBe(urlTwo);
    expect(files()).toHaveLength(1);

    await app.inject({ method: 'DELETE', url: `/api/recipes/${one}` });
    expect(files()).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: urlTwo })).statusCode).toBe(200);

    await app.inject({ method: 'DELETE', url: `/api/recipes/${two}` });
    expect(files()).toHaveLength(0);
  });

  it('removes the image file when its recipe is deleted', async () => {
    await setup();
    const id = await createRecipe();
    await upload(id, await tinyPng());
    expect(files()).toHaveLength(1);
    await app.inject({ method: 'DELETE', url: `/api/recipes/${id}` });
    expect(files()).toHaveLength(0);
  });

  it('rejects an upload over 5 MB with 413', async () => {
    await setup();
    const id = await createRecipe();
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(6 * 1024 * 1024)]);
    const res = await upload(id, big);
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatch(/too large/i);
    expect(fs.existsSync(imagesDir) ? files() : []).toHaveLength(0);
  });

  it('rejects non-image content even when labelled image/png', async () => {
    await setup();
    const id = await createRecipe();
    const res = await upload(id, Buffer.from('not an image at all'), { type: 'image/png', name: 'x.png' });
    expect(res.statusCode).toBe(415);
  });

  it('rejects SVG', async () => {
    await setup();
    const id = await createRecipe();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await upload(id, svg, { type: 'image/svg+xml', name: 'x.svg' });
    expect(res.statusCode).toBe(415);
    expect(fs.existsSync(imagesDir) ? files() : []).toHaveLength(0);
  });

  it('rejects a corrupt image with 400', async () => {
    await setup();
    const id = await createRecipe();
    const whole = await tinyPng(200, 200);
    const res = await upload(id, whole.subarray(0, Math.floor(whole.length / 2)));
    expect(res.statusCode).toBe(400);
  });

  it('rejects a request that is not multipart', async () => {
    await setup();
    const id = await createRecipe();
    const res = await app.inject({ method: 'PUT', url: `/api/recipes/${id}/image`, payload: { image: 'x' } });
    expect(res.statusCode).toBe(415);
  });

  it('rejects a wrong field name', async () => {
    await setup();
    const id = await createRecipe();
    const res = await upload(id, await tinyPng(), { field: 'file' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for a missing recipe', async () => {
    await setup();
    const res = await upload(99, await tinyPng());
    expect(res.statusCode).toBe(404);
    expect((await upload('abc', await tinyPng())).statusCode).toBe(404);
  });

  it('ignores the client filename entirely', async () => {
    await setup();
    const id = await createRecipe();
    await upload(id, await tinyPng(), { name: '../../evil.png' });
    expect(files()[0]).toMatch(/^[a-f0-9]{64}\.webp$/);
  });
});

describe('DELETE /api/recipes/:id/image', () => {
  it('clears the image and removes the file', async () => {
    await setup();
    const id = await createRecipe();
    await upload(id, await tinyPng());
    const res = await app.inject({ method: 'DELETE', url: `/api/recipes/${id}/image` });
    expect(res.statusCode).toBe(200);
    expect(res.json().imageUrl).toBeNull();
    expect(files()).toHaveLength(0);
  });

  it('returns 404 for a missing recipe', async () => {
    await setup();
    const res = await app.inject({ method: 'DELETE', url: '/api/recipes/9/image' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/images/:filename', () => {
  it('returns 404 for unknown but well-formed names', async () => {
    await setup();
    const res = await app.inject({ method: 'GET', url: `/api/images/${'a'.repeat(64)}.webp` });
    expect(res.statusCode).toBe(404);
  });

  it.each([
    '..%2f..%2fpackage.json',
    '..%5c..%5cpackage.json',
    'recipemixer.db',
    `${'A'.repeat(64)}.webp`,
    `${'a'.repeat(64)}.png`,
    '%2e%2e%2fsecret.webp',
  ])('returns 404 for the suspicious name %s', async (name) => {
    await setup();
    const res = await app.inject({ method: 'GET', url: `/api/images/${name}` });
    expect(res.statusCode).toBe(404);
  });
});
